"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMcpServer = createMcpServer;
exports.runStdioMcpServer = runStdioMcpServer;
const node_child_process_1 = require("node:child_process");
const node_readline_1 = require("node:readline");
class RustMcpBridge {
    options;
    child = null;
    idleTimer = null;
    pending = new Map();
    reader = null;
    sequence = 0;
    constructor(options = {}) {
        this.options = options;
        process.once('exit', () => this.stop());
    }
    start() {
        if (this.child)
            return;
        const command = this.options.command ?? process.env.CONTEXT_MCP_BIN ?? 'target/debug/context-mcp';
        const cwd = this.options.cwd ?? process.cwd();
        this.child = (0, node_child_process_1.spawn)(command, [cwd], {
            cwd,
            env: process.env,
            stdio: ['pipe', 'pipe', 'pipe']
        });
        this.child.unref();
        this.child.on('exit', (code, signal) => {
            const message = `Rust MCP exited (${code ?? 'null'} ${signal ?? 'null'})`;
            for (const [, pending] of this.pending)
                pending.reject(new Error(message));
            this.pending.clear();
            this.child = null;
            if (this.reader) {
                this.reader.close();
                this.reader = null;
            }
        });
        this.reader = (0, node_readline_1.createInterface)({ input: this.child.stdout });
        this.reader.on('line', (line) => {
            let response;
            try {
                response = JSON.parse(line);
            }
            catch {
                return;
            }
            const key = String(response.id ?? '');
            const pending = this.pending.get(key);
            if (!pending)
                return;
            this.pending.delete(key);
            pending.resolve(response);
        });
    }
    touchIdleTimer() {
        if (this.idleTimer)
            clearTimeout(this.idleTimer);
        const timeout = this.options.idleShutdownMs ?? 5_000;
        this.idleTimer = setTimeout(() => {
            if (this.pending.size === 0)
                this.stop();
        }, timeout);
        this.idleTimer.unref();
    }
    stop() {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
        if (!this.child)
            return;
        this.child.kill('SIGTERM');
        this.child = null;
        if (this.reader) {
            this.reader.close();
            this.reader = null;
        }
    }
    async send(message) {
        if (message.method === 'notifications/initialized')
            return null;
        this.start();
        if (!this.child) {
            return {
                id: (message.id ?? null),
                jsonrpc: '2.0',
                error: { code: -32603, message: 'Rust MCP process unavailable' }
            };
        }
        const id = message.id ?? ++this.sequence;
        const key = String(id);
        const payload = JSON.stringify({ ...message, id });
        const response = await new Promise((resolve, reject) => {
            this.pending.set(key, { resolve, reject });
            this.child?.stdin.write(`${payload}\n`, (error) => {
                if (!error)
                    return;
                this.pending.delete(key);
                reject(error);
            });
        }).catch((error) => ({
            id: (id ?? null),
            jsonrpc: '2.0',
            error: { code: -32603, message: error instanceof Error ? error.message : 'Request failed' }
        }));
        if (message.method === 'shutdown') {
            this.stop();
        }
        else {
            this.touchIdleTimer();
        }
        return response;
    }
}
function createMcpServer(options = {}) {
    const bridge = new RustMcpBridge(options);
    return {
        handleRequest(message) {
            return bridge.send(message);
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
