"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMcpServer = createMcpServer;
exports.runStdioMcpServer = runStdioMcpServer;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const zod_1 = require("zod");
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
    name: db_1.dbToolNameSchema.or(zod_1.z.enum(['health', 'status', 'ontology.lookup', 'ontology.search']))
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
const ontologyNodeSchema = zod_1.z
    .object({
    community: zod_1.z.number().int().nonnegative(),
    file_type: zod_1.z.string().min(1),
    id: zod_1.z.string().min(1),
    label: zod_1.z.string().min(1),
    norm_label: zod_1.z.string().min(1),
    source_file: zod_1.z.string().min(1),
    source_location: zod_1.z.string().min(1)
})
    .strict();
const graphNodeSchema = ontologyNodeSchema.passthrough();
const ontologyLookupArgsSchema = zod_1.z
    .object({
    query: zod_1.z.string().min(1).max(256)
})
    .strict();
const ontologySearchArgsSchema = zod_1.z
    .object({
    limit: zod_1.z.number().int().positive().max(20).default(5),
    query: zod_1.z.string().min(1).max(256)
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
const ontologyLookupToolInputSchema = zod_1.z
    .object({
    arguments: ontologyLookupArgsSchema,
    name: zod_1.z.literal('ontology.lookup')
})
    .strict();
const ontologySearchToolInputSchema = zod_1.z
    .object({
    arguments: ontologySearchArgsSchema,
    name: zod_1.z.literal('ontology.search')
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
        graph: zod_1.z
            .object({
            links: zod_1.z.number().int().nonnegative(),
            nodes: zod_1.z.number().int().nonnegative()
        })
            .strict(),
        nodeVersion: zod_1.z.string().min(1),
        pid: zod_1.z.number().int().positive(),
        tools: zod_1.z.array(zod_1.z.string().min(1)).min(1)
    })
        .strict(),
    tool: zod_1.z.literal('status')
})
    .strict();
const ontologyLookupToolOutputSchema = zod_1.z
    .object({
    ok: zod_1.z.literal(true),
    result: zod_1.z
        .object({
        match: ontologyNodeSchema.nullable()
    })
        .strict(),
    tool: zod_1.z.literal('ontology.lookup')
})
    .strict();
const ontologySearchToolOutputSchema = zod_1.z
    .object({
    ok: zod_1.z.literal(true),
    result: zod_1.z
        .object({
        items: zod_1.z.array(ontologyNodeSchema).max(20),
        query: zod_1.z.string().min(1),
        total: zod_1.z.number().int().nonnegative()
    })
        .strict(),
    tool: zod_1.z.literal('ontology.search')
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
const graphLinkSchema = zod_1.z
    .object({
    confidence: zod_1.z.string().min(1),
    confidence_score: zod_1.z.number(),
    relation: zod_1.z.string().min(1),
    source: zod_1.z.string().min(1),
    source_file: zod_1.z.string().min(1),
    source_location: zod_1.z.string().min(1),
    target: zod_1.z.string().min(1),
    weight: zod_1.z.number()
})
    .passthrough();
const graphSchema = zod_1.z
    .object({
    links: zod_1.z.array(graphLinkSchema),
    nodes: zod_1.z.array(graphNodeSchema)
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
function normalizeQuery(query) {
    return query.trim().toLowerCase();
}
function loadGraph(graphPath) {
    try {
        const parsed = graphSchema.parse(JSON.parse((0, node_fs_1.readFileSync)(graphPath, 'utf8')));
        return {
            links: parsed.links,
            nodes: parsed.nodes,
            path: graphPath
        };
    }
    catch {
        return {
            links: [],
            nodes: [],
            path: graphPath
        };
    }
}
function createOntologyIndex(graphPath) {
    const graph = loadGraph(graphPath);
    const sanitizeNode = (node) => ontologyNodeSchema.parse({
        community: node.community,
        file_type: node.file_type,
        id: node.id,
        label: node.label,
        norm_label: node.norm_label,
        source_file: node.source_file,
        source_location: node.source_location
    });
    return {
        lookup(input) {
            const parsed = ontologyLookupArgsSchema.parse(input);
            const query = normalizeQuery(parsed.query);
            const match = graph.nodes.find((node) => {
                return (node.id === parsed.query ||
                    node.label === parsed.query ||
                    node.norm_label === query ||
                    node.source_file === parsed.query);
            });
            return ontologyLookupToolOutputSchema.parse({
                ok: true,
                result: {
                    match: match ? sanitizeNode(match) : null
                },
                tool: 'ontology.lookup'
            });
        },
        search(input) {
            const parsed = ontologySearchArgsSchema.parse(input);
            const query = normalizeQuery(parsed.query);
            const ranked = graph.nodes
                .filter((node) => {
                const haystack = [
                    node.id,
                    node.label,
                    node.norm_label,
                    node.source_file,
                    node.source_location
                ]
                    .join(' ')
                    .toLowerCase();
                return haystack.includes(query);
            })
                .sort((left, right) => {
                const leftExact = Number(left.id === parsed.query || left.label === parsed.query || left.norm_label === query);
                const rightExact = Number(right.id === parsed.query || right.label === parsed.query || right.norm_label === query);
                if (leftExact !== rightExact) {
                    return rightExact - leftExact;
                }
                return left.label.localeCompare(right.label);
            })
                .slice(0, parsed.limit);
            return ontologySearchToolOutputSchema.parse({
                ok: true,
                result: {
                    items: ranked.map(sanitizeNode),
                    query: parsed.query,
                    total: ranked.length
                },
                tool: 'ontology.search'
            });
        }
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
            description: 'Return bounded runtime status and graph counts.',
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
            description: 'Look up an ontology node by exact id, label, or source file.',
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
            description: 'Search ontology nodes with bounded fuzzy matching.',
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
function buildStatusResult(graphPath, toolNames) {
    const graph = loadGraph(graphPath);
    return statusToolOutputSchema.parse({
        ok: true,
        result: {
            graph: {
                links: graph.links.length,
                nodes: graph.nodes.length
            },
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
    const graphPath = options.graphPath ?? (0, node_path_1.join)(process.cwd(), 'graphify-out', 'graph.json');
    const ontology = options.ontology ?? createOntologyIndex(graphPath);
    const tools = toolDefinitions();
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
                return buildStatusResult(graphPath, tools.map((tool) => tool.name));
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
                return ontology.lookup(parsed.arguments);
            }
            case 'ontology.search': {
                const parsed = ontologySearchToolInputSchema.parse(input);
                return ontology.search(parsed.arguments);
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
