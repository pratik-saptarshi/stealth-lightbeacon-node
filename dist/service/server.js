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
const defaultEvaluators_1 = require("../core/defaultEvaluators");
const config_1 = require("./config");
const ENGINES = ['http', 'rendered', 'fast', 'stealth'];
const FORMATS = ['json', 'html', 'both', 'llm', 'geo-xml'];
const ENDPOINTS = ['/health', '/capabilities'];
async function startService(input = {}) {
    const config = (0, config_1.loadServiceConfig)(input);
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
                evaluators: (0, defaultEvaluators_1.listDefaultEvaluatorPlugins)().map((plugin) => plugin.id),
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
