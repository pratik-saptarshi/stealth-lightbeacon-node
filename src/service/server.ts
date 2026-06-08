import * as http from 'node:http';
import { listDefaultEvaluatorPlugins } from '../core/defaultEvaluators';
import { ArtifactStore } from './artifacts';
import { loadServiceConfig, type ServiceConfigInput } from './config';
import { EvaluationJobStore } from './jobs';
import { defaultReconRunner } from './reconRunner';

export interface StartedService {
  address: {
    host: string;
    port: number;
  };
  url: string;
  close(): Promise<void>;
}

const ENGINES = ['http', 'rendered', 'fast', 'stealth'] as const;
const FORMATS = ['json', 'html', 'both', 'llm', 'geo-xml'] as const;
const ENDPOINTS = [
  '/health',
  '/capabilities',
  '/evaluations',
  '/evaluations/{id}',
  '/evaluations/{id}/result',
  '/evaluations/{id}/artifacts',
  '/evaluations/{id}/artifacts/{name}',
  '/recon'
] as const;

export async function startService(input: ServiceConfigInput = {}): Promise<StartedService> {
  const config = loadServiceConfig(input);
  const startedAt = config.clock();
  const jobs = new EvaluationJobStore({
    auditRunner: config.auditRunner,
    clock: config.clock
  });
  const artifacts = new ArtifactStore(config.artifactRoot);
  const reconRunner = config.reconRunner ?? defaultReconRunner;
  const server = http.createServer(async (request, response) => {
    const path = request.url ? new URL(request.url, `http://${config.host}`).pathname : '/';

    if (request.method === 'GET' && path === '/health') {
      writeJson(response, 200, {
        ok: true,
        status: 'ok',
        version: config.version,
        uptimeMs: Math.max(0, config.clock() - startedAt),
        persistence: { enabled: config.persistence }
      });
      return;
    }

    if (request.method === 'GET' && path === '/capabilities') {
      writeJson(response, 200, {
        ok: true,
        engines: [...ENGINES],
        formats: [...FORMATS],
        evaluators: listDefaultEvaluatorPlugins().map((plugin) => plugin.id),
        endpoints: [...ENDPOINTS],
        security: {
          ssrfGuard: true,
          auth: false,
          tls: false
        }
      });
      return;
    }

    if (request.method === 'POST' && path === '/evaluations') {
      const body = await readJsonBody(request);
      if (!body || typeof body.targetUrl !== 'string' || !body.targetUrl.trim()) {
        writeJson(response, 400, errorEnvelope('invalid_request', 'targetUrl is required'));
        return;
      }

      const options = isRecord(body.options) ? body.options : {};
      const job = jobs.create(body.targetUrl.trim(), options);
      writeJson(response, 202, {
        ok: true,
        id: job.id,
        status: job.status
      });
      return;
    }

    const evaluationArtifactsMatch = path.match(/^\/evaluations\/([^/]+)\/artifacts$/);
    if (request.method === 'GET' && evaluationArtifactsMatch) {
      const id = evaluationArtifactsMatch[1];
      const job = jobs.get(id);
      if (!job) {
        writeJson(response, 404, errorEnvelope('evaluation_not_found', 'Evaluation not found'));
        return;
      }
      if (job.status !== 'succeeded') {
        writeJson(response, 409, errorEnvelope('result_not_ready', 'Evaluation result is not ready'));
        return;
      }
      writeJson(response, 200, {
        ok: true,
        id,
        artifacts: artifacts.list(id)
      });
      return;
    }

    const evaluationArtifactMatch = path.match(/^\/evaluations\/([^/]+)\/artifacts\/(.+)$/);
    if (request.method === 'GET' && evaluationArtifactMatch) {
      const id = evaluationArtifactMatch[1];
      const job = jobs.get(id);
      if (!job) {
        writeJson(response, 404, errorEnvelope('evaluation_not_found', 'Evaluation not found'));
        return;
      }
      const artifact = artifacts.open(id, decodeURIComponent(evaluationArtifactMatch[2]));
      if (artifact === 'invalid') {
        writeJson(response, 400, errorEnvelope('invalid_artifact_path', 'Artifact path is invalid'));
        return;
      }
      if (!artifact) {
        writeJson(response, 404, errorEnvelope('artifact_not_found', 'Artifact not found'));
        return;
      }
      response.writeHead(200, {
        'content-type': `${artifact.contentType}; charset=utf-8`
      });
      artifact.stream.pipe(response);
      return;
    }

    if (request.method === 'POST' && path === '/recon') {
      const body = await readJsonBody(request);
      if (!body || typeof body.targetUrl !== 'string' || !body.targetUrl.trim()) {
        writeJson(response, 400, errorEnvelope('invalid_request', 'targetUrl is required'));
        return;
      }
      const recon = await reconRunner({
        targetUrl: body.targetUrl.trim(),
        allowPrivate: body.allowPrivate === true
      });
      writeJson(response, 200, {
        ok: true,
        recon
      });
      return;
    }

    const evaluationResultMatch = path.match(/^\/evaluations\/([^/]+)\/result$/);
    if (request.method === 'GET' && evaluationResultMatch) {
      const id = evaluationResultMatch[1];
      const { job, result } = jobs.getResult(id);
      if (!job) {
        writeJson(response, 404, errorEnvelope('evaluation_not_found', 'Evaluation not found'));
        return;
      }
      if (job.status !== 'succeeded') {
        writeJson(response, 409, errorEnvelope('result_not_ready', 'Evaluation result is not ready'));
        return;
      }
      writeJson(response, 200, {
        ok: true,
        id,
        status: job.status,
        result
      });
      return;
    }

    const evaluationMatch = path.match(/^\/evaluations\/([^/]+)$/);
    if (request.method === 'GET' && evaluationMatch) {
      const job = jobs.get(evaluationMatch[1]);
      if (!job) {
        writeJson(response, 404, errorEnvelope('evaluation_not_found', 'Evaluation not found'));
        return;
      }
      writeJson(response, 200, {
        ok: true,
        job
      });
      return;
    }

    writeJson(response, 404, {
      ok: false,
      error: {
        code: 'not_found',
        message: 'Route not found'
      }
    });
  });

  await listen(server, config.port, config.host);
  const address = server.address();
  if (!address || typeof address === 'string') {
    await closeServer(server);
    throw new Error('Service did not bind to a TCP address.');
  }

  return {
    address: {
      host: config.host,
      port: address.port
    },
    url: `http://${config.host}:${address.port}`,
    close: () => closeServer(server)
  };
}

function readJsonBody(request: http.IncomingMessage): Promise<Record<string, unknown> | undefined> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(isRecord(JSON.parse(text)) ? JSON.parse(text) : undefined);
      } catch {
        resolve(undefined);
      }
    });
    request.on('error', () => {
      resolve(undefined);
    });
  });
}

function errorEnvelope(code: string, message: string): { ok: false; error: { code: string; message: string } } {
  return {
    ok: false,
    error: {
      code,
      message
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function writeJson(response: http.ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify(body));
}

function listen(server: http.Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
