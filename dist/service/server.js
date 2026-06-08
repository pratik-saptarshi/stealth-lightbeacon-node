"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.startService = startService;
const http = __importStar(require("node:http"));
const https = __importStar(require("node:https"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const defaultEvaluators_1 = require("../core/defaultEvaluators");
const artifacts_1 = require("./artifacts");
const config_1 = require("./config");
const jobs_1 = require("./jobs");
const reconRunner_1 = require("./reconRunner");
const ENGINES = ['http', 'rendered', 'fast', 'stealth'];
const FORMATS = ['json', 'html', 'both', 'llm', 'geo-xml'];
const ENDPOINTS = [
    '/health',
    '/capabilities',
    '/evaluations',
    '/evaluations/{id}',
    '/evaluations/{id}/result',
    '/evaluations/{id}/artifacts',
    '/evaluations/{id}/artifacts/{name}',
    '/recon'
];
async function startService(input = {}) {
    const config = (0, config_1.loadServiceConfig)(input);
    const startedAt = config.clock();
    const jobs = new jobs_1.EvaluationJobStore({
        auditRunner: config.auditRunner,
        clock: config.clock,
        statePath: config.persistence ? (0, node_path_1.join)(config.artifactRoot, 'jobs.json') : undefined
    });
    const artifacts = new artifacts_1.ArtifactStore(config.artifactRoot);
    const reconRunner = config.reconRunner ?? reconRunner_1.defaultReconRunner;
    const server = createHttpServer(config.tls, async (request, response) => {
        const path = request.url ? new URL(request.url, `http://${config.host}`).pathname : '/';
        if (request.method === 'GET' && path === '/health') {
            writeJson(response, 200, {
                ok: !jobs.recoveryError,
                status: jobs.recoveryError ? 'degraded' : 'ok',
                version: config.version,
                uptimeMs: Math.max(0, config.clock() - startedAt),
                persistence: { enabled: config.persistence },
                ...(jobs.recoveryError ? { recovery: { ok: false, error: jobs.recoveryError } } : {})
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
                evaluators: (0, defaultEvaluators_1.listDefaultEvaluatorPlugins)().map((plugin) => plugin.id),
                endpoints: [...ENDPOINTS],
                security: {
                    ssrfGuard: true,
                    auth: Boolean(config.authToken),
                    tls: Boolean(config.tls)
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
        url: `${config.tls ? 'https' : 'http'}://${config.host}:${address.port}`,
        close: () => closeServer(server)
    };
}
function createHttpServer(tls, listener) {
    if (!tls) {
        return http.createServer(listener);
    }
    try {
        return https.createServer({
            key: (0, node_fs_1.readFileSync)(tls.keyPath),
            cert: (0, node_fs_1.readFileSync)(tls.certPath)
        }, listener);
    }
    catch (error) {
        throw new Error(`TLS config is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
}
function isAuthorized(request, authToken) {
    if (!authToken) {
        return true;
    }
    return request.headers.authorization === `Bearer ${authToken}`;
}
function readJsonBody(request) {
    return new Promise((resolve) => {
        const chunks = [];
        request.on('data', (chunk) => {
            chunks.push(chunk);
        });
        request.on('end', () => {
            try {
                const text = Buffer.concat(chunks).toString('utf8');
                resolve(isRecord(JSON.parse(text)) ? JSON.parse(text) : undefined);
            }
            catch {
                resolve(undefined);
            }
        });
        request.on('error', () => {
            resolve(undefined);
        });
    });
}
function errorEnvelope(code, message) {
    return {
        ok: false,
        error: {
            code,
            message
        }
    };
}
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function writeJson(response, statusCode, body) {
    response.writeHead(statusCode, {
        'content-type': 'application/json; charset=utf-8'
    });
    response.end(JSON.stringify(body));
}
function listen(server, port, host) {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
            server.off('error', reject);
            resolve();
        });
    });
}
function closeServer(server) {
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
