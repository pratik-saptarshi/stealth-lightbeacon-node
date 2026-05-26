"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMcpServer = createMcpServer;
exports.runStdioMcpServer = runStdioMcpServer;
const node_readline_1 = require("node:readline");
const client_1 = require("./client");
const diffEngine_1 = require("../core/diffEngine");
const duckdb_1 = require("../core/db/duckdb");
const ontology_1 = require("../core/ontology");
const defaultEvaluators_1 = require("../core/defaultEvaluators");
const fetcher_1 = require("../core/fetcher");
const orchestrator_1 = require("../core/orchestrator");
function createMcpServer(options = {}) {
    const bridge = options.transport ?? new client_1.ProcessJsonRpcClient(options);
    const paths = (0, ontology_1.resolveOntologyPaths)({});
    const activeDbPath = options.duckDbPath ?? paths.duckDbPath;
    const tsTools = [
        {
            name: 'audit.diff',
            description: 'Compare two historical audit runs stored in the DuckDB database to isolate improvements, regressions, and unchanged findings.',
            inputSchema: {
                type: 'object',
                properties: {
                    runIdA: { type: 'string', description: 'The first/older run ID to compare' },
                    runIdB: { type: 'string', description: 'The second/newer run ID to compare' }
                },
                required: ['runIdA', 'runIdB'],
                additionalProperties: false
            }
        },
        {
            name: 'audit.run',
            description: 'Execute a page or site audit on a target URL with configurable depth, concurrency, and optional canary deployment mode.',
            inputSchema: {
                type: 'object',
                properties: {
                    url: { type: 'string', description: 'The target URL to audit' },
                    depth: { type: 'integer', description: 'Crawl depth', default: 1 },
                    maxUrls: { type: 'integer', description: 'Maximum number of URLs to crawl', default: 2 },
                    concurrency: { type: 'integer', description: 'Crawl concurrency', default: 2 },
                    isCanary: { type: 'boolean', description: 'Simulate canary deployment audit', default: false }
                },
                required: ['url'],
                additionalProperties: false
            }
        },
        {
            name: 'agent.metadata',
            description: 'Retrieve standardized Multi-Agent Framework cards and deployment schemas compatible with CrewAI and AutoGen specifications.',
            inputSchema: {
                type: 'object',
                properties: {},
                additionalProperties: false
            }
        }
    ];
    return {
        async handleRequest(message) {
            const request = message;
            if (!request)
                return null;
            // Intercept list of tools
            if (request.method === 'tools/list') {
                let rustTools = [];
                try {
                    const rustResponse = await bridge.send(request);
                    if (rustResponse && rustResponse.result && rustResponse.result.tools) {
                        rustTools = rustResponse.result.tools;
                    }
                }
                catch {
                    // rust bridge offline/degraded; fallback to TS tools only
                }
                return {
                    jsonrpc: '2.0',
                    id: request.id ?? null,
                    result: {
                        tools: [...rustTools, ...tsTools]
                    }
                };
            }
            // Intercept tool call
            if (request.method === 'tools/call') {
                const params = request.params;
                const toolName = params?.name;
                const args = params?.arguments ?? {};
                if (toolName === 'audit.diff') {
                    try {
                        const { runIdA, runIdB } = args;
                        if (!runIdA || !runIdB) {
                            return {
                                jsonrpc: '2.0',
                                id: request.id ?? null,
                                error: { code: -32602, message: 'Missing runIdA or runIdB arguments' }
                            };
                        }
                        const duck = await (0, duckdb_1.createDuckDbRuntime)({ databasePath: activeDbPath });
                        try {
                            const engine = new diffEngine_1.DiffEngine(duck);
                            const diffResult = await engine.compareRuns(runIdA, runIdB);
                            return {
                                jsonrpc: '2.0',
                                id: request.id ?? null,
                                result: {
                                    content: [
                                        {
                                            type: 'text',
                                            text: JSON.stringify({ ok: true, result: diffResult })
                                        }
                                    ]
                                }
                            };
                        }
                        finally {
                            await duck.close();
                        }
                    }
                    catch (err) {
                        return {
                            jsonrpc: '2.0',
                            id: request.id ?? null,
                            error: { code: -32603, message: `audit.diff failed: ${err.message}` }
                        };
                    }
                }
                if (toolName === 'audit.run') {
                    try {
                        const { url, depth, maxUrls, concurrency, isCanary } = args;
                        if (!url) {
                            return {
                                jsonrpc: '2.0',
                                id: request.id ?? null,
                                error: { code: -32602, message: 'Missing target URL' }
                            };
                        }
                        const store = await (0, ontology_1.createOntologyStore)({
                            duckDbPath: activeDbPath
                        });
                        try {
                            const evaluators = (0, defaultEvaluators_1.createDefaultEvaluators)();
                            const fetchPage = (0, fetcher_1.createFetchPage)({ allowPrivate: false, engine: 'http' });
                            const report = await (0, orchestrator_1.runAudit)({
                                targetUrl: url,
                                options: {
                                    crawlDepth: depth ?? 1,
                                    maxUrls: maxUrls ?? 2,
                                    concurrency: concurrency ?? 2
                                },
                                fetchPage,
                                evaluators,
                                persistence: store,
                                enrichContext: async () => ({})
                            });
                            const resultPayload = isCanary
                                ? { ok: true, isCanary: true, report, message: 'Canary deployment staging run complete' }
                                : { ok: true, report };
                            return {
                                jsonrpc: '2.0',
                                id: request.id ?? null,
                                result: {
                                    content: [
                                        {
                                            type: 'text',
                                            text: JSON.stringify(resultPayload)
                                        }
                                    ]
                                }
                            };
                        }
                        finally {
                            await store.close();
                        }
                    }
                    catch (err) {
                        return {
                            jsonrpc: '2.0',
                            id: request.id ?? null,
                            error: { code: -32603, message: `audit.run failed: ${err.message}` }
                        };
                    }
                }
                if (toolName === 'agent.metadata') {
                    const metadata = {
                        frameworks: ['CrewAI', 'AutoGen'],
                        agentCards: [
                            {
                                role: 'Security Auditor',
                                description: 'Performs SSRF and DNS security analysis, verifies redirect chains, and checks Drupal-specific security settings.',
                                capabilities: ['SSRF Guard', 'Secure Proxy Interception', 'Canonical Checks'],
                                tools: ['audit.run', 'audit.diff']
                            },
                            {
                                role: 'SEO & AEO Optimizer',
                                description: 'Evaluates Schema.org structured data, AEO question-answer directness, cite-worthiness, and PageSpeed metrics.',
                                capabilities: ['AEO Scoring', 'Structured Data Validation', 'LCP/CLS Optimization Auditing'],
                                tools: ['audit.run', 'audit.diff']
                            },
                            {
                                role: 'Canary Release Evaluator',
                                description: 'Orchestrates multi-agent canary validation for staging environments prior to production release.',
                                capabilities: ['Canary Deployment Auditing', 'Time-Series Regression Comparison'],
                                tools: ['audit.run', 'audit.diff']
                            }
                        ]
                    };
                    return {
                        jsonrpc: '2.0',
                        id: request.id ?? null,
                        result: {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify(metadata)
                                }
                            ]
                        }
                    };
                }
            }
            // Forward standard requests to Rust bridge
            return bridge.send(request);
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
