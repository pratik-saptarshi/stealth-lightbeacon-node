import * as http from 'node:http';
import * as https from 'node:https';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listDefaultEvaluatorPlugins } from '../core/defaultEvaluators';
import { ArtifactStore } from './artifacts';
import { loadServiceConfig, type ServiceConfig, type ServiceConfigInput } from './config';
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
  assertSafeBindConfig(config);
  const startedAt = config.clock();
  const canEvaluate = Boolean(config.auditRunner);
  const jobs = new EvaluationJobStore({
    auditRunner: config.auditRunner,
    clock: config.clock,
    statePath: config.persistence ? join(config.artifactRoot, 'jobs.json') : undefined
  });
  const artifacts = new ArtifactStore(config.artifactRoot);
  const reconRunner = config.reconRunner ?? defaultReconRunner;
  const server = createHttpServer(config.tls, (request, response) => {
    void handleRequest(request, response).catch((error) => {
      if (!response.headersSent) {
        if (error instanceof PayloadTooLargeError) {
          writeJson(response, 413, errorEnvelope('payload_too_large', error.message));
          return;
        }
        writeJson(response, 500, errorEnvelope(
          'internal_error',
          error instanceof Error ? error.message : String(error)
        ));
      } else {
        response.destroy(error instanceof Error ? error : undefined);
      }
    });
  });

  async function handleRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const path = request.url ? new URL(request.url, `http://${config.host}`).pathname : '/';

    if (request.method === 'GET' && path === '/health') {
      writeJson(response, 200, {
        ok: !jobs.recoveryError,
        status: jobs.recoveryError ? 'degraded' : 'ok',
        version: config.version,
        uptimeMs: Math.max(0, config.clock() - startedAt),
        persistence: { enabled: config.persistence },
        ...(jobs.recoveryError ? { recovery: { ok: false } } : {})
      });
      return;
    }

    if (request.method === 'GET' && path === '/health/recovery') {
      if (!config.authToken) {
        writeJson(response, 404, errorEnvelope('not_found', 'Route not found'));
        return;
      }
      if (!isAuthorized(request, config.authToken)) {
        writeJson(response, 401, errorEnvelope('unauthorized', 'Bearer token is required'));
        return;
      }
      writeJson(response, 200, {
        ok: !jobs.recoveryError,
        recovery: jobs.recoveryError
          ? { ok: false, error: jobs.recoveryError }
          : { ok: true }
      });
      return;
    }

    if (!isAuthorized(request, config.authToken)) {
      writeJson(response, 401, errorEnvelope('unauthorized', 'Bearer token is required'));
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
          auth: Boolean(config.authToken),
          tls: Boolean(config.tls)
        },
        execution: {
          evaluations: canEvaluate
        }
      });
      return;
    }

    if (request.method === 'POST' && path === '/evaluations') {
      if (!canEvaluate) {
        writeJson(response, 501, errorEnvelope('not_implemented', 'Evaluation execution is not available in this service'));
        return;
      }
      const body = await readJsonBody(request, config.jsonBodyLimitBytes);
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
      if (job.status !== 'succeeded') {
        writeJson(response, 409, errorEnvelope('result_not_ready', 'Evaluation result is not ready'));
        return;
      }
      const artifactName = decodeArtifactName(evaluationArtifactMatch[2]);
      if (!artifactName) {
        writeJson(response, 400, errorEnvelope('invalid_artifact_path', 'Artifact path is invalid'));
        return;
      }
      const artifact = artifacts.open(id, artifactName);
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
      const body = await readJsonBody(request, config.jsonBodyLimitBytes);
      if (!body || typeof body.targetUrl !== 'string' || !body.targetUrl.trim()) {
        writeJson(response, 400, errorEnvelope('invalid_request', 'targetUrl is required'));
        return;
      }
      if (body.allowPrivate === true && !config.allowPrivateRecon) {
        writeJson(response, 403, errorEnvelope('private_recon_disabled', 'Private recon targets are disabled for this service'));
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
  }

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
    url: `${config.tls ? 'https' : 'http'}://${config.host}:${address.port}`,
    close: async () => {
      await jobs.close();
      await closeServer(server);
    }
  };
}

function createHttpServer(
  tls: { keyPath: string; certPath: string } | undefined,
  listener: http.RequestListener
): http.Server | https.Server {
  if (!tls) {
    return http.createServer(listener);
  }

  try {
    return https.createServer({
      key: readFileSync(tls.keyPath),
      cert: readFileSync(tls.certPath)
    }, listener);
  } catch (error) {
    throw new Error(`TLS config is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isAuthorized(request: http.IncomingMessage, authToken: string | undefined): boolean {
  if (!authToken) {
    return true;
  }
  return request.headers.authorization === `Bearer ${authToken}`;
}

function assertSafeBindConfig(config: ServiceConfig): void {
  if (!isPublicBindHost(config.host)) {
    return;
  }
  if (!config.authToken) {
    throw new Error('An auth token is required for public service binds.');
  }
  if (!config.tls && !config.allowUnsafePublicHttp) {
    throw new Error('Public cleartext service requires --unsafe-public-http.');
  }
}

function isPublicBindHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === '0.0.0.0' ||
    normalized === '::' ||
    normalized === '[::]' ||
    normalized === '';
}

class PayloadTooLargeError extends Error {
  constructor(limitBytes: number) {
    super(`JSON request body exceeds ${limitBytes} bytes`);
  }
}

function readJsonBody(request: http.IncomingMessage, limitBytes: number): Promise<Record<string, unknown> | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let sizeBytes = 0;
    let done = false;

    request.on('data', (chunk: Buffer) => {
      if (done) {
        return;
      }
      sizeBytes += chunk.length;
      if (sizeBytes > limitBytes) {
        done = true;
        request.pause();
        reject(new PayloadTooLargeError(limitBytes));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (done) {
        return;
      }
      done = true;
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        const parsed = JSON.parse(text);
        resolve(isRecord(parsed) ? parsed : undefined);
      } catch {
        resolve(undefined);
      }
    });
    request.on('error', (error) => {
      if (done) {
        return;
      }
      done = true;
      reject(error);
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

function decodeArtifactName(rawName: string): string | undefined {
  try {
    return decodeURIComponent(rawName);
  } catch {
    return undefined;
  }
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
