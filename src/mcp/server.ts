import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  createDuckDbRuntime,
  createLanceDbRuntime,
  duckDbExecToolInputSchema,
  duckDbExecToolOutputSchema,
  duckDbQueryToolInputSchema,
  duckDbQueryToolOutputSchema,
  dbToolNameSchema,
  lanceDbCreateTableToolInputSchema,
  lanceDbCreateTableToolOutputSchema,
  lanceDbInsertToolInputSchema,
  lanceDbInsertToolOutputSchema,
  lanceDbSearchToolInputSchema,
  lanceDbSearchToolOutputSchema
} from '../core/db';

const jsonRpcIdSchema = z.union([z.string(), z.number().int()]);

const initializeParamsSchema = z
  .object({
    capabilities: z.record(z.string(), z.unknown()).optional(),
    clientInfo: z
      .object({
        name: z.string().min(1),
        version: z.string().min(1)
      })
      .strict()
      .optional(),
    protocolVersion: z.string().min(1).optional()
  })
  .strict();

const toolsListParamsSchema = z.object({}).strict();

const toolsCallParamsSchema = z
  .object({
    arguments: z.unknown().default({}),
    name: dbToolNameSchema.or(
      z.enum(['health', 'status', 'ontology.lookup', 'ontology.search'])
    )
  })
  .strict();

const toolTextContentSchema = z
  .object({
    text: z.string(),
    type: z.literal('text')
  })
  .strict();

const toolCallResultSchema = z
  .object({
    content: z.array(toolTextContentSchema).min(1),
    isError: z.literal(false).optional()
  })
  .strict();

const ontologyNodeSchema = z
  .object({
    community: z.number().int().nonnegative(),
    file_type: z.string().min(1),
    id: z.string().min(1),
    label: z.string().min(1),
    norm_label: z.string().min(1),
    source_file: z.string().min(1),
    source_location: z.string().min(1)
  })
  .strict();

const graphNodeSchema = ontologyNodeSchema.passthrough();

const ontologyLookupArgsSchema = z
  .object({
    query: z.string().min(1).max(256)
  })
  .strict();

const ontologySearchArgsSchema = z
  .object({
    limit: z.number().int().positive().max(20).default(5),
    query: z.string().min(1).max(256)
  })
  .strict();

const healthToolInputSchema = z
  .object({
    arguments: z.object({}).strict(),
    name: z.literal('health')
  })
  .strict();

const statusToolInputSchema = z
  .object({
    arguments: z.object({}).strict(),
    name: z.literal('status')
  })
  .strict();

const ontologyLookupToolInputSchema = z
  .object({
    arguments: ontologyLookupArgsSchema,
    name: z.literal('ontology.lookup')
  })
  .strict();

const ontologySearchToolInputSchema = z
  .object({
    arguments: ontologySearchArgsSchema,
    name: z.literal('ontology.search')
  })
  .strict();

const healthToolOutputSchema = z
  .object({
    ok: z.literal(true),
    result: z
      .object({
        status: z.literal('ok'),
        uptimeMs: z.number().nonnegative()
      })
      .strict(),
    tool: z.literal('health')
  })
  .strict();

const statusToolOutputSchema = z
  .object({
    ok: z.literal(true),
    result: z
      .object({
        graph: z
          .object({
            links: z.number().int().nonnegative(),
            nodes: z.number().int().nonnegative()
          })
          .strict(),
        nodeVersion: z.string().min(1),
        pid: z.number().int().positive(),
        tools: z.array(z.string().min(1)).min(1)
      })
      .strict(),
    tool: z.literal('status')
  })
  .strict();

const ontologyLookupToolOutputSchema = z
  .object({
    ok: z.literal(true),
    result: z
      .object({
        match: ontologyNodeSchema.nullable()
      })
      .strict(),
    tool: z.literal('ontology.lookup')
  })
  .strict();

const ontologySearchToolOutputSchema = z
  .object({
    ok: z.literal(true),
    result: z
      .object({
        items: z.array(ontologyNodeSchema).max(20),
        query: z.string().min(1),
        total: z.number().int().nonnegative()
      })
      .strict(),
    tool: z.literal('ontology.search')
  })
  .strict();

const jsonRpcErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.number().int(),
        message: z.string().min(1),
        data: z.unknown().optional()
      })
      .strict(),
    id: jsonRpcIdSchema.nullable(),
    jsonrpc: z.literal('2.0')
  })
  .strict();

const jsonRpcSuccessResponseSchema = z
  .object({
    id: jsonRpcIdSchema.nullable(),
    jsonrpc: z.literal('2.0'),
    result: z.unknown()
  })
  .strict();

const graphLinkSchema = z
  .object({
    confidence: z.string().min(1),
    confidence_score: z.number(),
    relation: z.string().min(1),
    source: z.string().min(1),
    source_file: z.string().min(1),
    source_location: z.string().min(1),
    target: z.string().min(1),
    weight: z.number()
  })
  .passthrough();

const graphSchema = z
  .object({
    links: z.array(graphLinkSchema),
    nodes: z.array(graphNodeSchema)
  })
  .strict();

type JsonRpcId = z.infer<typeof jsonRpcIdSchema>;

type DuckDbRuntimeLike = {
  exec(input: unknown): Promise<unknown>;
  query(input: unknown): Promise<unknown>;
};

type LanceDbRuntimeLike = {
  createTable(input: unknown): Promise<unknown>;
  insert(input: unknown): Promise<unknown>;
  search(input: unknown): Promise<unknown>;
};

type OntologyIndex = {
  lookup(input: z.input<typeof ontologyLookupArgsSchema>): z.infer<typeof ontologyLookupToolOutputSchema>;
  search(input: z.input<typeof ontologySearchArgsSchema>): z.infer<typeof ontologySearchToolOutputSchema>;
};

export type CreateMcpServerOptions = {
  duckdb?: DuckDbRuntimeLike;
  graphPath?: string;
  lancedb?: LanceDbRuntimeLike;
  ontology?: OntologyIndex;
};

type ToolDefinition = {
  description: string;
  inputSchema: Record<string, unknown>;
  name: string;
};

export type JsonRpcRequest = {
  id?: JsonRpcId;
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
};

export type JsonRpcResponse = z.infer<typeof jsonRpcErrorResponseSchema> | z.infer<typeof jsonRpcSuccessResponseSchema>;

function createJsonResult(content: unknown) {
  return {
    content: [
      {
        text: JSON.stringify(content),
        type: 'text' as const
      }
    ]
  };
}

function normalizeQuery(query: string) {
  return query.trim().toLowerCase();
}

function loadGraph(graphPath: string) {
  try {
    const parsed = graphSchema.parse(JSON.parse(readFileSync(graphPath, 'utf8')));

    return {
      links: parsed.links,
      nodes: parsed.nodes,
      path: graphPath
    };
  } catch {
    return {
      links: [],
      nodes: [],
      path: graphPath
    };
  }
}

function createOntologyIndex(graphPath: string): OntologyIndex {
  const graph = loadGraph(graphPath);

  const sanitizeNode = (node: z.infer<typeof graphNodeSchema>) =>
    ontologyNodeSchema.parse({
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
        return (
          node.id === parsed.query ||
          node.label === parsed.query ||
          node.norm_label === query ||
          node.source_file === parsed.query
        );
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
          const leftExact = Number(
            left.id === parsed.query || left.label === parsed.query || left.norm_label === query
          );
          const rightExact = Number(
            right.id === parsed.query || right.label === parsed.query || right.norm_label === query
          );

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

function toolDefinitions(): ToolDefinition[] {
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

function createError(id: JsonRpcId | null, code: number, message: string, data?: unknown) {
  return jsonRpcErrorResponseSchema.parse({
    error: data === undefined ? { code, message } : { code, data, message },
    id,
    jsonrpc: '2.0'
  });
}

function createSuccess(id: JsonRpcId | null, result: unknown) {
  return jsonRpcSuccessResponseSchema.parse({
    id,
    jsonrpc: '2.0',
    result
  });
}

function buildStatusResult(graphPath: string, toolNames: string[]) {
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

function toToolResult(output: unknown) {
  return createJsonResult(output);
}

export function createMcpServer(options: CreateMcpServerOptions = {}) {
  const graphPath = options.graphPath ?? join(process.cwd(), 'graphify-out', 'graph.json');
  const ontology = options.ontology ?? createOntologyIndex(graphPath);
  const tools = toolDefinitions();

  let duckdbRuntime: DuckDbRuntimeLike | undefined = options.duckdb;
  let lancedbRuntime: LanceDbRuntimeLike | undefined = options.lancedb;

  async function getDuckDbRuntime() {
    duckdbRuntime ??= await createDuckDbRuntime();
    return duckdbRuntime;
  }

  async function getLanceDbRuntime() {
    lancedbRuntime ??= await createLanceDbRuntime();
    return lancedbRuntime;
  }

  async function invokeTool(name: string, input: unknown) {
    switch (name) {
      case 'health': {
        return buildHealthResult();
      }
      case 'status': {
        return buildStatusResult(graphPath, tools.map((tool) => tool.name));
      }
      case 'duckdb.query': {
        const parsed = duckDbQueryToolInputSchema.parse(input);
        const runtime = await getDuckDbRuntime();
        const output = await runtime.query(parsed.arguments);
        return duckDbQueryToolOutputSchema.parse(output);
      }
      case 'duckdb.exec': {
        const parsed = duckDbExecToolInputSchema.parse(input);
        const runtime = await getDuckDbRuntime();
        const output = await runtime.exec(parsed.arguments);
        return duckDbExecToolOutputSchema.parse(output);
      }
      case 'lancedb.createTable': {
        const parsed = lanceDbCreateTableToolInputSchema.parse(input);
        const runtime = await getLanceDbRuntime();
        const output = await runtime.createTable(parsed.arguments);
        return lanceDbCreateTableToolOutputSchema.parse(output);
      }
      case 'lancedb.insert': {
        const parsed = lanceDbInsertToolInputSchema.parse(input);
        const runtime = await getLanceDbRuntime();
        const output = await runtime.insert(parsed.arguments);
        return lanceDbInsertToolOutputSchema.parse(output);
      }
      case 'lancedb.search': {
        const parsed = lanceDbSearchToolInputSchema.parse(input);
        const runtime = await getLanceDbRuntime();
        const output = await runtime.search(parsed.arguments);
        return lanceDbSearchToolOutputSchema.parse(output);
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

  async function handleRequest(message: unknown): Promise<JsonRpcResponse | null> {
    const request = z
      .object({
        id: jsonRpcIdSchema.optional(),
        jsonrpc: z.literal('2.0'),
        method: z.string().min(1),
        params: z.unknown().optional()
      })
      .strict()
      .parse(message) as JsonRpcRequest;

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
            const callInput =
              params.name === 'health'
                ? healthToolInputSchema.parse(params)
                : statusToolInputSchema.parse(params);

            return createSuccess(
              request.id ?? null,
              toToolResult(await invokeTool(params.name, callInput))
            );
          }

          if (params.name === 'ontology.lookup') {
            const callInput = ontologyLookupToolInputSchema.parse(params);
            return createSuccess(
              request.id ?? null,
              toToolResult(await invokeTool(params.name, callInput))
            );
          }

          if (params.name === 'ontology.search') {
            const callInput = ontologySearchToolInputSchema.parse(params);
            return createSuccess(
              request.id ?? null,
              toToolResult(await invokeTool(params.name, callInput))
            );
          }

          const callInput = {
            arguments: params.arguments,
            name: params.name,
            tool: params.name
          };

          return createSuccess(
            request.id ?? null,
            toToolResult(await invokeTool(params.name, callInput))
          );
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
    } catch (error) {
      if (error instanceof z.ZodError) {
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

export async function runStdioMcpServer(
  options: {
    handleRequest?: (message: unknown) => Promise<JsonRpcResponse | null>;
    stdin?: NodeJS.ReadableStream;
    stdout?: NodeJS.WritableStream;
  } = {}
) {
  const runtime = options.handleRequest ? undefined : await createMcpServer();
  const handleRequest = options.handleRequest ?? runtime!.handleRequest;
  const input = (options.stdin ?? process.stdin) as NodeJS.ReadableStream & {
    on(event: 'data', listener: (chunk: Buffer) => void): unknown;
  };
  const output = options.stdout ?? process.stdout;
  let buffer = Buffer.alloc(0);

  const writeMessage = (message: JsonRpcResponse) => {
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

      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch (error) {
        writeMessage(createError(null, -32700, error instanceof Error ? error.message : 'Parse error'));
        continue;
      }

      const response = await handleRequest(parsed);
      if (response) {
        writeMessage(response);
      }
    }
  };

  input.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    void flush();
  });
}
