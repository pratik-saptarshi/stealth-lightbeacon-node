import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';

export type CreateMcpServerOptions = {
  command?: string;
  cwd?: string;
  idleShutdownMs?: number;
};

export type JsonRpcRequest = {
  id?: string | number | null;
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
};

export type JsonRpcResponse = {
  id: string | number | null;
  jsonrpc: '2.0';
  result?: unknown;
  error?: { code: number; data?: unknown; message: string };
};

type Pending = {
  reject: (error: Error) => void;
  resolve: (value: JsonRpcResponse | null) => void;
};

class RustMcpBridge {
  private child: ChildProcessWithoutNullStreams | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private pending = new Map<string, Pending>();
  private reader: Interface | null = null;
  private sequence = 0;

  constructor(private readonly options: CreateMcpServerOptions = {}) {
    process.once('exit', () => this.stop());
  }

  private start() {
    if (this.child) return;
    const command = this.options.command ?? process.env.CONTEXT_MCP_BIN ?? 'target/debug/context-mcp';
    const cwd = this.options.cwd ?? process.cwd();
    this.child = spawn(command, [cwd], {
      cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.child.unref();

    this.child.on('exit', (code, signal) => {
      const message = `Rust MCP exited (${code ?? 'null'} ${signal ?? 'null'})`;
      for (const [, pending] of this.pending) pending.reject(new Error(message));
      this.pending.clear();
      this.child = null;
      if (this.reader) {
        this.reader.close();
        this.reader = null;
      }
    });

    this.reader = createInterface({ input: this.child.stdout });
    this.reader.on('line', (line) => {
      let response: JsonRpcResponse;
      try {
        response = JSON.parse(line) as JsonRpcResponse;
      } catch {
        return;
      }
      const key = String(response.id ?? '');
      const pending = this.pending.get(key);
      if (!pending) return;
      this.pending.delete(key);
      pending.resolve(response);
    });
  }

  private touchIdleTimer() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const timeout = this.options.idleShutdownMs ?? 5_000;
    this.idleTimer = setTimeout(() => {
      if (this.pending.size === 0) this.stop();
    }, timeout);
    this.idleTimer.unref();
  }

  private stop() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (!this.child) return;
    this.child.kill('SIGTERM');
    this.child = null;
    if (this.reader) {
      this.reader.close();
      this.reader = null;
    }
  }

  async send(message: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    if (message.method === 'notifications/initialized') return null;
    this.start();
    if (!this.child) {
      return {
        id: (message.id ?? null) as string | number | null,
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Rust MCP process unavailable' }
      };
    }

    const id = message.id ?? ++this.sequence;
    const key = String(id);
    const payload = JSON.stringify({ ...message, id });

    const response = await new Promise<JsonRpcResponse | null>((resolve, reject) => {
      this.pending.set(key, { resolve, reject });
      this.child?.stdin.write(`${payload}\n`, (error) => {
        if (!error) return;
        this.pending.delete(key);
        reject(error);
      });
    }).catch((error) => ({
      id: (id ?? null) as string | number | null,
      jsonrpc: '2.0' as const,
      error: { code: -32603, message: error instanceof Error ? error.message : 'Request failed' }
    }));

    if (message.method === 'shutdown') {
      this.stop();
    } else {
      this.touchIdleTimer();
    }
    return response;
  }
}

export function createMcpServer(options: CreateMcpServerOptions = {}) {
  const bridge = new RustMcpBridge(options);
  return {
    handleRequest(message: unknown) {
      return bridge.send(message as JsonRpcRequest);
    }
  };
}

export function runStdioMcpServer(options: CreateMcpServerOptions = {}) {
  const server = createMcpServer(options);
  const reader = createInterface({ input: process.stdin, crlfDelay: Infinity });
  reader.on('line', async (line) => {
    if (!line.trim()) return;
    let request: JsonRpcRequest;
    try {
      request = JSON.parse(line) as JsonRpcRequest;
    } catch {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`
      );
      return;
    }
    const response = await server.handleRequest(request);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  });
}
