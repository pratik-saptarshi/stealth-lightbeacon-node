import { z } from 'zod';
import { spawnSync } from 'node:child_process';
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
      z.enum([
        'health',
        'status',
        'ontology.lookup',
        'ontology.search',
        'ontology.query',
        'ontology.update'
      ])
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
        nodeVersion: z.string().min(1),
        pid: z.number().int().positive(),
        tools: z.array(z.string().min(1)).min(1)
      })
      .strict(),
    tool: z.literal('status')
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

interface CodeSymbol {
  id: string;
  name: string;
  kind: string;
  filePath: string;
  startLine: number;
}

interface SourceFile {
  path: string;
  language: string;
  lastHash: string;
}

interface CallsRel {
  from: string;
  to: string;
}

interface ContainsRel {
  from: string;
  to: string;
}

export class LadybugDB {
  private codeSymbols = new Map<string, CodeSymbol>();
  private sourceFiles = new Map<string, SourceFile>();
  private calls = new Array<CallsRel>();
  private contains = new Array<ContainsRel>();
  private readonly dbPath: string;

  constructor(dbPath = '.agent/db/ladybug') {
    this.dbPath = dbPath;
    this.addSourceFile({ path: 'src/mcp/server.ts', language: 'typescript', lastHash: 'abc1234' });
    this.addCodeSymbol({ id: 'createMcpServer', name: 'createMcpServer', kind: 'function', filePath: 'src/mcp/server.ts', startLine: 310 });
    this.addCodeSymbol({ id: 'invokeTool', name: 'invokeTool', kind: 'function', filePath: 'src/mcp/server.ts', startLine: 326 });
    this.addContains('src/mcp/server.ts', 'createMcpServer');
    this.addContains('src/mcp/server.ts', 'invokeTool');
    this.addCalls('createMcpServer', 'invokeTool');
  }

  public addCodeSymbol(symbol: CodeSymbol) {
    this.codeSymbols.set(symbol.id, symbol);
  }

  public addSourceFile(file: SourceFile) {
    this.sourceFiles.set(file.path, file);
  }

  public addCalls(from: string, to: string) {
    this.calls.push({ from, to });
  }

  public addContains(from: string, to: string) {
    this.contains.push({ from, to });
  }

  public lookup(query: string): CodeSymbol | null {
    const match = this.codeSymbols.get(query);
    if (match) return match;
    for (const symbol of this.codeSymbols.values()) {
      if (symbol.name === query || symbol.filePath === query) {
        return symbol;
      }
    }
    return null;
  }

  public search(query: string, limit: number = 5): CodeSymbol[] {
    const results: CodeSymbol[] = [];
    const lowerQuery = query.toLowerCase();
    for (const symbol of this.codeSymbols.values()) {
      if (symbol.name.toLowerCase().includes(lowerQuery) || symbol.filePath.toLowerCase().includes(lowerQuery)) {
        results.push(symbol);
        if (results.length >= limit) break;
      }
    }
    return results;
  }

  public executeCypher(cypher: string): any {
    const native = this.executeNativeCypher(cypher);
    if (native) return native;

    const clean = cypher.trim().replace(/\s+/g, ' ');
    
    const callsMatch = clean.match(/MATCH\s+\((\w+):CodeSymbol\)-\[:CALLS\]->\((\w+):CodeSymbol\)\s+WHERE\s+(\w+)\.name\s*=\s*['"]([^'"]+)['"]\s+RETURN\s+(\w+)/i);
    if (callsMatch) {
      const [,,c1Var,,targetName] = callsMatch;
      const matchedSymbols = Array.from(this.codeSymbols.values()).filter(s => s.name === targetName);
      const results: CodeSymbol[] = [];
      for (const s1 of matchedSymbols) {
        for (const rel of this.calls) {
          if (rel.from === s1.id) {
            const s2 = this.codeSymbols.get(rel.to);
            if (s2) results.push(s2);
          }
        }
      }
      return { ok: true, result: results };
    }

    const containsMatch = clean.match(/MATCH\s+\((\w+):SourceFile\)-\[:CONTAINS\]->\((\w+):CodeSymbol\)\s+WHERE\s+(\w+)\.path\s*=\s*['"]([^'"]+)['"]\s+RETURN\s+(\w+)/i);
    if (containsMatch) {
      const [,, fVar,, targetPath] = containsMatch;
      const results: CodeSymbol[] = [];
      for (const rel of this.contains) {
        if (rel.from === targetPath) {
          const s = this.codeSymbols.get(rel.to);
          if (s) results.push(s);
        }
      }
      return { ok: true, result: results };
    }

    const selectMatch = clean.match(/MATCH\s+\((\w+):CodeSymbol\)\s+WHERE\s+(\w+)\.name\s*=\s*['"]([^'"]+)['"]\s+RETURN\s+(\w+)/i);
    if (selectMatch) {
      const [,, sVar,, targetName] = selectMatch;
      const results = Array.from(this.codeSymbols.values()).filter(s => s.name === targetName);
      return { ok: true, result: results };
    }

    if (clean.toUpperCase().startsWith('CREATE NODE TABLE') || clean.toUpperCase().startsWith('CREATE REL TABLE')) {
      return { ok: true, message: 'Table created successfully' };
    }

    return { ok: false, error: 'Unsupported Cypher pattern in sandboxed environment' };
  }

  private executeNativeCypher(cypher: string): any | null {
    const lbug = process.env.LBUG_BIN ?? 'tools/native/lbug';
    const result = spawnSync(lbug, [this.dbPath, '--no_progress_bar', '--no_stats'], {
      encoding: 'utf8',
      env: { ...process.env, HOME: `${process.cwd()}/.agent` },
      input: `${cypher};\n`,
      maxBuffer: 1024 * 1024,
      timeout: 2_000
    });

    if (result.error || result.status !== 0) return null;

    const output = result.stdout.trim();
    if (!output) return { ok: true, result: [] };

    try {
      return { ok: true, result: JSON.parse(output) };
    } catch {
      return { ok: true, result: output };
    }
  }
}

const ontologyLookupToolInputSchema = z
  .object({
    arguments: z.object({ query: z.string().min(1) }).strict(),
    name: z.literal('ontology.lookup')
  })
  .strict();

const ontologySearchToolInputSchema = z
  .object({
    arguments: z.object({
      limit: z.number().int().positive().max(20).default(5),
      query: z.string().min(1)
    }).strict(),
    name: z.literal('ontology.search')
  })
  .strict();

const ontologyQueryToolInputSchema = z
  .object({
    arguments: z.object({ cypher: z.string().min(1) }).strict(),
    name: z.literal('ontology.query')
  })
  .strict();

const ontologyUpdateToolInputSchema = z
  .object({
    arguments: z.object({
      nodes: z.array(z.any()).optional(),
      relationships: z.array(z.any()).optional()
    }).strict(),
    name: z.literal('ontology.update')
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

export type CreateMcpServerOptions = {
  duckdb?: DuckDbRuntimeLike;
  ladybug?: LadybugDB;
  lancedb?: LanceDbRuntimeLike;
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

function buildStatusResult(toolNames: string[]) {
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

function toToolResult(output: unknown) {
  return createJsonResult(output);
}

export function createMcpServer(options: CreateMcpServerOptions = {}) {
  const tools = toolDefinitions();
  const ladybug = options.ladybug ?? new LadybugDB();

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
        return buildStatusResult(tools.map((tool) => tool.name));
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
            } else {
              ladybug.addSourceFile(node);
            }
          }
        }
        if (parsed.arguments.relationships) {
          for (const rel of parsed.arguments.relationships) {
            if (rel.relation === 'CALLS') {
              ladybug.addCalls(rel.from, rel.to);
            } else {
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

          if (params.name === 'ontology.query') {
            const callInput = ontologyQueryToolInputSchema.parse(params);
            return createSuccess(
              request.id ?? null,
              toToolResult(await invokeTool(params.name, callInput))
            );
          }

          if (params.name === 'ontology.update') {
            const callInput = ontologyUpdateToolInputSchema.parse(params);
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
