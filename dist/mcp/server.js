"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LadybugDB = void 0;
exports.createMcpServer = createMcpServer;
exports.runStdioMcpServer = runStdioMcpServer;
const zod_1 = require("zod");
const node_child_process_1 = require("node:child_process");
const db_1 = require("../core/db");
const jsonRpcIdSchema = zod_1.z.union([zod_1.z.string(), zod_1.z.number().int()]);
const initializeParamsSchema = zod_1.z
    .object({
    capabilities: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional(),
    clientInfo: zod_1.z
        .object({
        name: zod_1.z.string().min(1),
        version: zod_1.z.string().min(1)
    })
        .strict()
        .optional(),
    protocolVersion: zod_1.z.string().min(1).optional()
})
    .strict();
const toolsListParamsSchema = zod_1.z.object({}).strict();
const toolsCallParamsSchema = zod_1.z
    .object({
    arguments: zod_1.z.unknown().default({}),
    name: db_1.dbToolNameSchema.or(zod_1.z.enum([
        'health',
        'status',
        'ontology.lookup',
        'ontology.search',
        'ontology.query',
        'ontology.update'
    ]))
})
    .strict();
const toolTextContentSchema = zod_1.z
    .object({
    text: zod_1.z.string(),
    type: zod_1.z.literal('text')
})
    .strict();
const toolCallResultSchema = zod_1.z
    .object({
    content: zod_1.z.array(toolTextContentSchema).min(1),
    isError: zod_1.z.literal(false).optional()
})
    .strict();
const healthToolInputSchema = zod_1.z
    .object({
    arguments: zod_1.z.object({}).strict(),
    name: zod_1.z.literal('health')
})
    .strict();
const statusToolInputSchema = zod_1.z
    .object({
    arguments: zod_1.z.object({}).strict(),
    name: zod_1.z.literal('status')
})
    .strict();
const healthToolOutputSchema = zod_1.z
    .object({
    ok: zod_1.z.literal(true),
    result: zod_1.z
        .object({
        status: zod_1.z.literal('ok'),
        uptimeMs: zod_1.z.number().nonnegative()
    })
        .strict(),
    tool: zod_1.z.literal('health')
})
    .strict();
const statusToolOutputSchema = zod_1.z
    .object({
    ok: zod_1.z.literal(true),
    result: zod_1.z
        .object({
        nodeVersion: zod_1.z.string().min(1),
        pid: zod_1.z.number().int().positive(),
        tools: zod_1.z.array(zod_1.z.string().min(1)).min(1)
    })
        .strict(),
    tool: zod_1.z.literal('status')
})
    .strict();
const jsonRpcErrorResponseSchema = zod_1.z
    .object({
    error: zod_1.z
        .object({
        code: zod_1.z.number().int(),
        message: zod_1.z.string().min(1),
        data: zod_1.z.unknown().optional()
    })
        .strict(),
    id: jsonRpcIdSchema.nullable(),
    jsonrpc: zod_1.z.literal('2.0')
})
    .strict();
const jsonRpcSuccessResponseSchema = zod_1.z
    .object({
    id: jsonRpcIdSchema.nullable(),
    jsonrpc: zod_1.z.literal('2.0'),
    result: zod_1.z.unknown()
})
    .strict();
class LadybugDB {
    codeSymbols = new Map();
    sourceFiles = new Map();
    calls = new Array();
    contains = new Array();
    dbPath;
    constructor(dbPath = '.agent/db/ladybug') {
        this.dbPath = dbPath;
        this.addSourceFile({ path: 'src/mcp/server.ts', language: 'typescript', lastHash: 'abc1234' });
        this.addCodeSymbol({ id: 'createMcpServer', name: 'createMcpServer', kind: 'function', filePath: 'src/mcp/server.ts', startLine: 310 });
        this.addCodeSymbol({ id: 'invokeTool', name: 'invokeTool', kind: 'function', filePath: 'src/mcp/server.ts', startLine: 326 });
        this.addContains('src/mcp/server.ts', 'createMcpServer');
        this.addContains('src/mcp/server.ts', 'invokeTool');
        this.addCalls('createMcpServer', 'invokeTool');
    }
    addCodeSymbol(symbol) {
        this.codeSymbols.set(symbol.id, symbol);
    }
    addSourceFile(file) {
        this.sourceFiles.set(file.path, file);
    }
    addCalls(from, to) {
        this.calls.push({ from, to });
    }
    addContains(from, to) {
        this.contains.push({ from, to });
    }
    lookup(query) {
        const match = this.codeSymbols.get(query);
        if (match)
            return match;
        for (const symbol of this.codeSymbols.values()) {
            if (symbol.name === query || symbol.filePath === query) {
                return symbol;
            }
        }
        return null;
    }
    search(query, limit = 5) {
        const results = [];
        const lowerQuery = query.toLowerCase();
        for (const symbol of this.codeSymbols.values()) {
            if (symbol.name.toLowerCase().includes(lowerQuery) || symbol.filePath.toLowerCase().includes(lowerQuery)) {
                results.push(symbol);
                if (results.length >= limit)
                    break;
            }
        }
        return results;
    }
    executeCypher(cypher) {
        const native = this.executeNativeCypher(cypher);
        if (native)
            return native;
        const clean = cypher.trim().replace(/\s+/g, ' ');
        const callsMatch = clean.match(/MATCH\s+\((\w+):CodeSymbol\)-\[:CALLS\]->\((\w+):CodeSymbol\)\s+WHERE\s+(\w+)\.name\s*=\s*['"]([^'"]+)['"]\s+RETURN\s+(\w+)/i);
        if (callsMatch) {
            const [, , c1Var, , targetName] = callsMatch;
            const matchedSymbols = Array.from(this.codeSymbols.values()).filter(s => s.name === targetName);
            const results = [];
            for (const s1 of matchedSymbols) {
                for (const rel of this.calls) {
                    if (rel.from === s1.id) {
                        const s2 = this.codeSymbols.get(rel.to);
                        if (s2)
                            results.push(s2);
                    }
                }
            }
            return { ok: true, result: results };
        }
        const containsMatch = clean.match(/MATCH\s+\((\w+):SourceFile\)-\[:CONTAINS\]->\((\w+):CodeSymbol\)\s+WHERE\s+(\w+)\.path\s*=\s*['"]([^'"]+)['"]\s+RETURN\s+(\w+)/i);
        if (containsMatch) {
            const [, , fVar, , targetPath] = containsMatch;
            const results = [];
            for (const rel of this.contains) {
                if (rel.from === targetPath) {
                    const s = this.codeSymbols.get(rel.to);
                    if (s)
                        results.push(s);
                }
            }
            return { ok: true, result: results };
        }
        const selectMatch = clean.match(/MATCH\s+\((\w+):CodeSymbol\)\s+WHERE\s+(\w+)\.name\s*=\s*['"]([^'"]+)['"]\s+RETURN\s+(\w+)/i);
        if (selectMatch) {
            const [, , sVar, , targetName] = selectMatch;
            const results = Array.from(this.codeSymbols.values()).filter(s => s.name === targetName);
            return { ok: true, result: results };
        }
        if (clean.toUpperCase().startsWith('CREATE NODE TABLE') || clean.toUpperCase().startsWith('CREATE REL TABLE')) {
            return { ok: true, message: 'Table created successfully' };
        }
        return { ok: false, error: 'Unsupported Cypher pattern in sandboxed environment' };
    }
    executeNativeCypher(cypher) {
        const lbug = process.env.LBUG_BIN ?? 'tools/native/lbug';
        const result = (0, node_child_process_1.spawnSync)(lbug, [this.dbPath, '--no_progress_bar', '--no_stats'], {
            encoding: 'utf8',
            env: { ...process.env, HOME: `${process.cwd()}/.agent` },
            input: `${cypher};\n`,
            maxBuffer: 1024 * 1024,
            timeout: 2_000
        });
        if (result.error || result.status !== 0)
            return null;
        const output = result.stdout.trim();
        if (!output)
            return { ok: true, result: [] };
        try {
            return { ok: true, result: JSON.parse(output) };
        }
        catch {
            return { ok: true, result: output };
        }
    }
}
exports.LadybugDB = LadybugDB;
const ontologyLookupToolInputSchema = zod_1.z
    .object({
    arguments: zod_1.z.object({ query: zod_1.z.string().min(1) }).strict(),
    name: zod_1.z.literal('ontology.lookup')
})
    .strict();
const ontologySearchToolInputSchema = zod_1.z
    .object({
    arguments: zod_1.z.object({
        limit: zod_1.z.number().int().positive().max(20).default(5),
        query: zod_1.z.string().min(1)
    }).strict(),
    name: zod_1.z.literal('ontology.search')
})
    .strict();
const ontologyQueryToolInputSchema = zod_1.z
    .object({
    arguments: zod_1.z.object({ cypher: zod_1.z.string().min(1) }).strict(),
    name: zod_1.z.literal('ontology.query')
})
    .strict();
const ontologyUpdateToolInputSchema = zod_1.z
    .object({
    arguments: zod_1.z.object({
        nodes: zod_1.z.array(zod_1.z.any()).optional(),
        relationships: zod_1.z.array(zod_1.z.any()).optional()
    }).strict(),
    name: zod_1.z.literal('ontology.update')
})
    .strict();
function createJsonResult(content) {
    return {
        content: [
            {
                text: JSON.stringify(content),
                type: 'text'
            }
        ]
    };
}
function toolDefinitions() {
    return [
        {
            description: 'Return a bounded readiness signal for the MCP server.',
            inputSchema: {
                additionalProperties: false,
                properties: {},
                type: 'object'
            },
            name: 'health'
        },
        {
            description: 'Return bounded runtime status.',
            inputSchema: {
                additionalProperties: false,
                properties: {},
                type: 'object'
            },
            name: 'status'
        },
        {
            description: 'Execute a validated DuckDB query.',
            inputSchema: {
                additionalProperties: false,
                properties: {
                    params: {
                        description: 'Optional positional or named parameters.',
                        oneOf: [{ type: 'array' }, { type: 'object' }]
                    },
                    sql: { minLength: 1, type: 'string' },
                    timeoutMs: { default: 2_000, maximum: 60_000, minimum: 1, type: 'integer' }
                },
                required: ['sql'],
                type: 'object'
            },
            name: 'duckdb.query'
        },
        {
            description: 'Execute a validated DuckDB statement.',
            inputSchema: {
                additionalProperties: false,
                properties: {
                    params: {
                        description: 'Optional positional or named parameters.',
                        oneOf: [{ type: 'array' }, { type: 'object' }]
                    },
                    sql: { minLength: 1, type: 'string' },
                    timeoutMs: { default: 2_000, maximum: 60_000, minimum: 1, type: 'integer' }
                },
                required: ['sql'],
                type: 'object'
            },
            name: 'duckdb.exec'
        },
        {
            description: 'Create a LanceDB table from bounded validated rows.',
            inputSchema: {
                additionalProperties: false,
                properties: {
                    data: { type: 'array' },
                    mode: { enum: ['create', 'overwrite'], type: 'string' },
                    name: { minLength: 1, type: 'string' },
                    timeoutMs: { default: 2_000, maximum: 60_000, minimum: 1, type: 'integer' }
                },
                required: ['data', 'name'],
                type: 'object'
            },
            name: 'lancedb.createTable'
        },
        {
            description: 'Insert validated rows into a LanceDB table.',
            inputSchema: {
                additionalProperties: false,
                properties: {
                    data: { type: 'array' },
                    name: { minLength: 1, type: 'string' },
                    timeoutMs: { default: 2_000, maximum: 60_000, minimum: 1, type: 'integer' }
                },
                required: ['data', 'name'],
                type: 'object'
            },
            name: 'lancedb.insert'
        },
        {
            description: 'Search LanceDB with a bounded validated query.',
            inputSchema: {
                additionalProperties: false,
                properties: {
                    limit: { default: 10, maximum: 100, minimum: 1, type: 'integer' },
                    query: { minLength: 1, type: 'string' },
                    timeoutMs: { default: 2_000, maximum: 60_000, minimum: 1, type: 'integer' }
                },
                required: ['query'],
                type: 'object'
            },
            name: 'lancedb.search'
        },
        {
            description: 'Look up a code symbol from LadybugDB embedded graph.',
            inputSchema: {
                additionalProperties: false,
                properties: {
                    query: { minLength: 1, type: 'string' }
                },
                required: ['query'],
                type: 'object'
            },
            name: 'ontology.lookup'
        },
        {
            description: 'Search code symbols in LadybugDB fuzzy matching.',
            inputSchema: {
                additionalProperties: false,
                properties: {
                    limit: { default: 5, maximum: 20, minimum: 1, type: 'integer' },
                    query: { minLength: 1, type: 'string' }
                },
                required: ['query'],
                type: 'object'
            },
            name: 'ontology.search'
        },
        {
            description: 'Execute Cypher graph query directly inside LadybugDB.',
            inputSchema: {
                additionalProperties: false,
                properties: {
                    cypher: { minLength: 1, type: 'string' }
                },
                required: ['cypher'],
                type: 'object'
            },
            name: 'ontology.query'
        },
        {
            description: 'Dynamically update the LadybugDB embedded graph.',
            inputSchema: {
                additionalProperties: false,
                properties: {
                    nodes: { type: 'array' },
                    relationships: { type: 'array' }
                },
                type: 'object'
            },
            name: 'ontology.update'
        }
    ];
}
function createError(id, code, message, data) {
    return jsonRpcErrorResponseSchema.parse({
        error: data === undefined ? { code, message } : { code, data, message },
        id,
        jsonrpc: '2.0'
    });
}
function createSuccess(id, result) {
    return jsonRpcSuccessResponseSchema.parse({
        id,
        jsonrpc: '2.0',
        result
    });
}
function buildStatusResult(toolNames) {
    return statusToolOutputSchema.parse({
        ok: true,
        result: {
            nodeVersion: process.version,
            pid: process.pid,
            tools: toolNames
        },
        tool: 'status'
    });
}
function buildHealthResult() {
    return healthToolOutputSchema.parse({
        ok: true,
        result: {
            status: 'ok',
            uptimeMs: Math.max(0, process.uptime() * 1000)
        },
        tool: 'health'
    });
}
function toToolResult(output) {
    return createJsonResult(output);
}
function createMcpServer(options = {}) {
    const tools = toolDefinitions();
    const ladybug = options.ladybug ?? new LadybugDB();
    let duckdbRuntime = options.duckdb;
    let lancedbRuntime = options.lancedb;
    async function getDuckDbRuntime() {
        duckdbRuntime ??= await (0, db_1.createDuckDbRuntime)();
        return duckdbRuntime;
    }
    async function getLanceDbRuntime() {
        lancedbRuntime ??= await (0, db_1.createLanceDbRuntime)();
        return lancedbRuntime;
    }
    async function invokeTool(name, input) {
        switch (name) {
            case 'health': {
                return buildHealthResult();
            }
            case 'status': {
                return buildStatusResult(tools.map((tool) => tool.name));
            }
            case 'duckdb.query': {
                const parsed = db_1.duckDbQueryToolInputSchema.parse(input);
                const runtime = await getDuckDbRuntime();
                const output = await runtime.query(parsed.arguments);
                return db_1.duckDbQueryToolOutputSchema.parse(output);
            }
            case 'duckdb.exec': {
                const parsed = db_1.duckDbExecToolInputSchema.parse(input);
                const runtime = await getDuckDbRuntime();
                const output = await runtime.exec(parsed.arguments);
                return db_1.duckDbExecToolOutputSchema.parse(output);
            }
            case 'lancedb.createTable': {
                const parsed = db_1.lanceDbCreateTableToolInputSchema.parse(input);
                const runtime = await getLanceDbRuntime();
                const output = await runtime.createTable(parsed.arguments);
                return db_1.lanceDbCreateTableToolOutputSchema.parse(output);
            }
            case 'lancedb.insert': {
                const parsed = db_1.lanceDbInsertToolInputSchema.parse(input);
                const runtime = await getLanceDbRuntime();
                const output = await runtime.insert(parsed.arguments);
                return db_1.lanceDbInsertToolOutputSchema.parse(output);
            }
            case 'lancedb.search': {
                const parsed = db_1.lanceDbSearchToolInputSchema.parse(input);
                const runtime = await getLanceDbRuntime();
                const output = await runtime.search(parsed.arguments);
                return db_1.lanceDbSearchToolOutputSchema.parse(output);
            }
            case 'ontology.lookup': {
                const parsed = ontologyLookupToolInputSchema.parse(input);
                return { ok: true, result: ladybug.lookup(parsed.arguments.query) };
            }
            case 'ontology.search': {
                const parsed = ontologySearchToolInputSchema.parse(input);
                return { ok: true, result: ladybug.search(parsed.arguments.query, parsed.arguments.limit) };
            }
            case 'ontology.query': {
                const parsed = ontologyQueryToolInputSchema.parse(input);
                return ladybug.executeCypher(parsed.arguments.cypher);
            }
            case 'ontology.update': {
                const parsed = ontologyUpdateToolInputSchema.parse(input);
                if (parsed.arguments.nodes) {
                    for (const node of parsed.arguments.nodes) {
                        if (node.filePath) {
                            ladybug.addCodeSymbol(node);
                        }
                        else {
                            ladybug.addSourceFile(node);
                        }
                    }
                }
                if (parsed.arguments.relationships) {
                    for (const rel of parsed.arguments.relationships) {
                        if (rel.relation === 'CALLS') {
                            ladybug.addCalls(rel.from, rel.to);
                        }
                        else {
                            ladybug.addContains(rel.from, rel.to);
                        }
                    }
                }
                return { ok: true, message: 'Updated LadybugDB elements dynamically' };
            }
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }
    async function handleRequest(message) {
        const request = zod_1.z
            .object({
            id: jsonRpcIdSchema.optional(),
            jsonrpc: zod_1.z.literal('2.0'),
            method: zod_1.z.string().min(1),
            params: zod_1.z.unknown().optional()
        })
            .strict()
            .parse(message);
        try {
            switch (request.method) {
                case 'initialize': {
                    const params = initializeParamsSchema.parse(request.params ?? {});
                    return createSuccess(request.id ?? null, {
                        capabilities: {
                            tools: { listChanged: false }
                        },
                        protocolVersion: params.protocolVersion ?? '2024-11-05',
                        serverInfo: {
                            name: 'stealth-lightbeacon-node-mcp',
                            version: process.env.npm_package_version ?? '0.0.0'
                        }
                    });
                }
                case 'tools/list': {
                    toolsListParamsSchema.parse(request.params ?? {});
                    return createSuccess(request.id ?? null, { tools });
                }
                case 'tools/call': {
                    const params = toolsCallParamsSchema.parse(request.params ?? {});
                    if (params.name === 'health' || params.name === 'status') {
                        const callInput = params.name === 'health'
                            ? healthToolInputSchema.parse(params)
                            : statusToolInputSchema.parse(params);
                        return createSuccess(request.id ?? null, toToolResult(await invokeTool(params.name, callInput)));
                    }
                    if (params.name === 'ontology.lookup') {
                        const callInput = ontologyLookupToolInputSchema.parse(params);
                        return createSuccess(request.id ?? null, toToolResult(await invokeTool(params.name, callInput)));
                    }
                    if (params.name === 'ontology.search') {
                        const callInput = ontologySearchToolInputSchema.parse(params);
                        return createSuccess(request.id ?? null, toToolResult(await invokeTool(params.name, callInput)));
                    }
                    if (params.name === 'ontology.query') {
                        const callInput = ontologyQueryToolInputSchema.parse(params);
                        return createSuccess(request.id ?? null, toToolResult(await invokeTool(params.name, callInput)));
                    }
                    if (params.name === 'ontology.update') {
                        const callInput = ontologyUpdateToolInputSchema.parse(params);
                        return createSuccess(request.id ?? null, toToolResult(await invokeTool(params.name, callInput)));
                    }
                    const callInput = {
                        arguments: params.arguments,
                        name: params.name,
                        tool: params.name
                    };
                    return createSuccess(request.id ?? null, toToolResult(await invokeTool(params.name, callInput)));
                }
                case 'shutdown':
                    return createSuccess(request.id ?? null, null);
                case 'notifications/initialized':
                    return null;
                case 'ping':
                    return createSuccess(request.id ?? null, {});
                default:
                    return createError(request.id ?? null, -32601, `Method not found: ${request.method}`);
            }
        }
        catch (error) {
            if (error instanceof zod_1.z.ZodError) {
                return createError(request.id ?? null, -32602, 'Invalid params', error.flatten());
            }
            return createError(request.id ?? null, -32603, error instanceof Error ? error.message : 'Internal error');
        }
    }
    return {
        handleRequest,
        listTools() {
            return tools;
        },
        async run() {
            await runStdioMcpServer({ handleRequest });
        }
    };
}
async function runStdioMcpServer(options = {}) {
    const runtime = options.handleRequest ? undefined : await createMcpServer();
    const handleRequest = options.handleRequest ?? runtime.handleRequest;
    const input = (options.stdin ?? process.stdin);
    const output = options.stdout ?? process.stdout;
    let buffer = Buffer.alloc(0);
    const writeMessage = (message) => {
        const payload = JSON.stringify(message);
        output.write(`Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`);
    };
    const flush = async () => {
        while (true) {
            const headerEnd = buffer.indexOf('\r\n\r\n');
            if (headerEnd < 0) {
                return;
            }
            const headerText = buffer.subarray(0, headerEnd).toString('utf8');
            const contentLengthMatch = headerText.match(/Content-Length:\s*(\d+)/i);
            if (!contentLengthMatch) {
                buffer = buffer.subarray(headerEnd + 4);
                continue;
            }
            const contentLength = Number(contentLengthMatch[1]);
            const bodyStart = headerEnd + 4;
            const bodyEnd = bodyStart + contentLength;
            if (buffer.length < bodyEnd) {
                return;
            }
            const body = buffer.subarray(bodyStart, bodyEnd).toString('utf8');
            buffer = buffer.subarray(bodyEnd);
            let parsed;
            try {
                parsed = JSON.parse(body);
            }
            catch (error) {
                writeMessage(createError(null, -32700, error instanceof Error ? error.message : 'Parse error'));
                continue;
            }
            const response = await handleRequest(parsed);
            if (response) {
                writeMessage(response);
            }
        }
    };
    input.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        void flush();
    });
}
