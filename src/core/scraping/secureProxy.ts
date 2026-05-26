import * as http from 'node:http';
import * as net from 'node:net';
import { isIP } from 'node:net';
import { SSRFGuard } from '../ssrf';

export class SecureProxy {
  private server: http.Server;
  private port = 0;
  private readonly guard: SSRFGuard;

  constructor(guard: SSRFGuard) {
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
              cb(null, pinnedIp, isIP(pinnedIp));
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
      } catch {
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

  public start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server.address() as net.AddressInfo;
        this.port = addr.port;
        resolve(this.port);
      });
      this.server.on('error', (err) => {
        reject(err);
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }

  public getProxyUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }
}
