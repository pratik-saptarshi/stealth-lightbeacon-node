"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMcpServer = createMcpServer;
exports.runStdioMcpServer = runStdioMcpServer;
const node_readline_1 = require("node:readline");
const client_1 = require("./client");
function createMcpServer(options = {}) {
    const bridge = options.transport ?? new client_1.ProcessJsonRpcClient(options);
    return {
        handleRequest(message) {
            return bridge.send(message);
        },
        stop() {
            bridge.stop?.();
        }
    };
}
function runStdioMcpServer(options = {}) {
    const server = createMcpServer(options);
    const reader = (0, node_readline_1.createInterface)({ input: process.stdin, crlfDelay: Infinity });
    reader.on('line', async (line) => {
        if (!line.trim())
            return;
        let request;
        try {
            request = JSON.parse(line);
        }
        catch {
            process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
            return;
        }
        const response = await server.handleRequest(request);
        if (response)
            process.stdout.write(`${JSON.stringify(response)}\n`);
    });
}
