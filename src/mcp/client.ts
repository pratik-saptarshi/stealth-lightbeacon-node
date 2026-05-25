import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';

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

export type ProcessJsonRpcClientOptions = {
  command?: string;
  commandArgs?: string[];
  cwd?: string;
  idleShutdownMs?: number;
};

type Pending = {
  reject: (error: Error) => void;
  resolve: (value: JsonRpcResponse | null) => void;
};

export class ProcessJsonRpcClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private pending = new Map<string, Pending>();
  private reader: Interface | null = null;
  private sequence = 0;

  constructor(private readonly options: ProcessJsonRpcClientOptions = {}) {
    process.once('exit', () => this.stop());
  }

  async send(message: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    if (message.method === 'notifications/initialized') return null;
    this.start();
    if (!this.child) {
      return {
        id: (message.id ?? null) as string | number | null,
        jsonrpc: '2.0',
        error: { code: -32603, message: 'MCP process unavailable' }
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

  stop(): void {
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

  private start() {
    if (this.child) return;
    const command = this.options.command ?? process.env.CONTEXT_MCP_BIN ?? 'target/debug/context-mcp';
    const commandArgs = this.options.commandArgs ?? [];
    const cwd = this.options.cwd ?? process.cwd();
    this.child = spawn(command, [...commandArgs, cwd], {
      cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.child.unref();

    this.child.on('exit', (code, signal) => {
      const message = `MCP process exited (${code ?? 'null'} ${signal ?? 'null'})`;
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
}
