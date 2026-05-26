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
exports.SecureProxy = void 0;
const http = __importStar(require("node:http"));
const net = __importStar(require("node:net"));
const node_net_1 = require("node:net");
class SecureProxy {
    server;
    port = 0;
    guard;
    constructor(guard) {
        this.guard = guard;
        this.server = http.createServer((req, res) => {
            const urlStr = req.url;
            if (!urlStr) {
                res.writeHead(400);
                res.end();
                return;
            }
            try {
                const parsed = new URL(urlStr);
                this.guard.validate(urlStr).then(async () => {
                    const pinnedIp = this.guard.getPinnedAddress(parsed.hostname) || parsed.hostname;
                    const connector = http.request({
                        hostname: pinnedIp,
                        port: parsed.port ? Number(parsed.port) : 80,
                        path: parsed.pathname + parsed.search,
                        method: req.method,
                        headers: req.headers,
                        lookup: (hostname, opts, cb) => {
                            cb(null, pinnedIp, (0, node_net_1.isIP)(pinnedIp));
                        }
                    }, (proxyRes) => {
                        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
                        proxyRes.pipe(res);
                    });
                    connector.on('error', () => {
                        res.writeHead(502);
                        res.end();
                    });
                    req.pipe(connector);
                }).catch(() => {
                    res.writeHead(403);
                    res.end('Blocked by SSRFGuard');
                });
            }
            catch {
                res.writeHead(400);
                res.end();
            }
        });
        this.server.on('connect', (req, clientSocket, head) => {
            const parts = req.url?.split(':');
            if (!parts || parts.length !== 2) {
                clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
                return;
            }
            const host = parts[0];
            const port = Number(parts[1]);
            const dummyUrl = `https://${host}:${port}`;
            this.guard.validate(dummyUrl).then(() => {
                const pinnedIp = this.guard.getPinnedAddress(host) || host;
                const serverSocket = net.connect(port, pinnedIp, () => {
                    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
                    if (head && head.length > 0) {
                        serverSocket.write(head);
                    }
                    clientSocket.pipe(serverSocket);
                    serverSocket.pipe(clientSocket);
                });
                serverSocket.on('error', () => {
                    clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
                });
                clientSocket.on('error', () => {
                    serverSocket.end();
                });
            }).catch(() => {
                clientSocket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
            });
        });
    }
    start() {
        return new Promise((resolve, reject) => {
            this.server.listen(0, '127.0.0.1', () => {
                const addr = this.server.address();
                this.port = addr.port;
                resolve(this.port);
            });
            this.server.on('error', (err) => {
                reject(err);
            });
        });
    }
    stop() {
        return new Promise((resolve) => {
            this.server.close(() => resolve());
        });
    }
    getProxyUrl() {
        return `http://127.0.0.1:${this.port}`;
    }
}
exports.SecureProxy = SecureProxy;
