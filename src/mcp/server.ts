import { createInterface, type Interface } from 'node:readline';
import { ProcessJsonRpcClient, type JsonRpcRequest, type JsonRpcResponse } from './client';
export type { JsonRpcRequest, JsonRpcResponse } from './client';

export type CreateMcpServerOptions = {
  command?: string;
  commandArgs?: string[];
  cwd?: string;
  idleShutdownMs?: number;
};

export function createMcpServer(options: CreateMcpServerOptions = {}) {
  const bridge = new ProcessJsonRpcClient(options);
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
