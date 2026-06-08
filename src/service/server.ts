import * as http from 'node:http';
import { listDefaultEvaluatorPlugins } from '../core/defaultEvaluators';
import { loadServiceConfig, type ServiceConfigInput } from './config';

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
const ENDPOINTS = ['/health', '/capabilities'] as const;

export async function startService(input: ServiceConfigInput = {}): Promise<StartedService> {
  const config = loadServiceConfig(input);
  const startedAt = config.clock();
  const server = http.createServer((request, response) => {
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
