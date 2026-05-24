import { z } from 'zod';
import { DEFAULT_DB_TIMEOUT_MS } from './timeouts';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

const jsonPrimitiveSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([jsonPrimitiveSchema, z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)])
) as z.ZodType<JsonValue>;

export const dbRowSchema = z.record(z.string(), jsonValueSchema);
export const dbRowsSchema = z.array(dbRowSchema);

export const dbToolNameSchema = z.enum([
  'duckdb.query',
  'duckdb.exec',
  'lancedb.createTable',
  'lancedb.insert',
  'lancedb.search'
]);

export const dbRuntimeInputSchema = z
  .object({
    timeoutMs: z.number().int().positive().max(60_000).default(DEFAULT_DB_TIMEOUT_MS)
  })
  .strict();

export const duckDbRuntimeInputSchema = z
  .object({
    databasePath: z.string().min(1).default(':memory:'),
    memoryLimit: z.string().min(1).default('256MB'),
    tempDirectory: z.string().min(1).optional(),
    threads: z.number().int().positive().max(64).default(2),
    timeoutMs: z.number().int().positive().max(60_000).default(DEFAULT_DB_TIMEOUT_MS)
  })
  .strict();

export const duckDbQueryInputSchema = z
  .object({
    sql: z.string().min(1),
    params: z.union([z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)]).optional(),
    timeoutMs: z.number().int().positive().max(60_000).default(DEFAULT_DB_TIMEOUT_MS)
  })
  .strict();

export const duckDbQueryOutputSchema = z
  .object({
    columns: z.array(z.string()),
    elapsedMs: z.number().nonnegative(),
    rowCount: z.number().int().nonnegative(),
    rows: dbRowsSchema
  })
  .strict();

export const duckDbQueryToolInputSchema = z
  .object({
    arguments: duckDbQueryInputSchema,
    tool: z.literal('duckdb.query')
  })
  .strict();

export const duckDbQueryToolOutputSchema = z
  .object({
    elapsedMs: z.number().nonnegative(),
    ok: z.literal(true),
    result: duckDbQueryOutputSchema,
    tool: z.literal('duckdb.query')
  })
  .strict();

export const duckDbExecInputSchema = z
  .object({
    sql: z.string().min(1),
    params: z.union([z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)]).optional(),
    timeoutMs: z.number().int().positive().max(60_000).default(DEFAULT_DB_TIMEOUT_MS)
  })
  .strict();

export const duckDbExecOutputSchema = z
  .object({
    elapsedMs: z.number().nonnegative(),
    ok: z.literal(true),
    result: z.object({}).strict(),
    tool: z.literal('duckdb.exec')
  })
  .strict();

export const duckDbExecToolInputSchema = z
  .object({
    arguments: duckDbExecInputSchema,
    tool: z.literal('duckdb.exec')
  })
  .strict();

export const duckDbExecToolOutputSchema = duckDbExecOutputSchema;

export const lanceDbRuntimeInputSchema = z
  .object({
    timeoutMs: z.number().int().positive().max(60_000).default(DEFAULT_DB_TIMEOUT_MS),
    uri: z.string().min(1)
  })
  .strict();

export const lanceDbCreateTableInputSchema = z
  .object({
    data: dbRowsSchema.min(1),
    mode: z.enum(['create', 'overwrite']).default('create'),
    name: z.string().min(1),
    timeoutMs: z.number().int().positive().max(60_000).default(DEFAULT_DB_TIMEOUT_MS)
  })
  .strict();

export const lanceDbCreateTableOutputSchema = z
  .object({
    elapsedMs: z.number().nonnegative(),
    mode: z.enum(['create', 'overwrite']),
    ok: z.literal(true),
    rowCount: z.number().int().nonnegative(),
    table: z.string().min(1)
  })
  .strict();

export const lanceDbInsertInputSchema = z
  .object({
    data: dbRowsSchema.min(1),
    table: z.string().min(1),
    timeoutMs: z.number().int().positive().max(60_000).default(DEFAULT_DB_TIMEOUT_MS)
  })
  .strict();

export const lanceDbInsertOutputSchema = z
  .object({
    elapsedMs: z.number().nonnegative(),
    ok: z.literal(true),
    rowCount: z.number().int().nonnegative(),
    table: z.string().min(1)
  })
  .strict();

export const lanceDbSearchInputSchema = z
  .object({
    limit: z.number().int().positive().max(100).default(10),
    table: z.string().min(1),
    timeoutMs: z.number().int().positive().max(60_000).default(DEFAULT_DB_TIMEOUT_MS),
    vector: z.array(z.number().finite()).min(1),
    where: z.string().min(1).optional()
  })
  .strict();

export const lanceDbSearchOutputSchema = z
  .object({
    elapsedMs: z.number().nonnegative(),
    ok: z.literal(true),
    rowCount: z.number().int().nonnegative(),
    rows: dbRowsSchema,
    table: z.string().min(1)
  })
  .strict();

export const lanceDbCreateTableToolInputSchema = z
  .object({
    arguments: lanceDbCreateTableInputSchema,
    tool: z.literal('lancedb.createTable')
  })
  .strict();

export const lanceDbInsertToolInputSchema = z
  .object({
    arguments: lanceDbInsertInputSchema,
    tool: z.literal('lancedb.insert')
  })
  .strict();

export const lanceDbSearchToolInputSchema = z
  .object({
    arguments: lanceDbSearchInputSchema,
    tool: z.literal('lancedb.search')
  })
  .strict();

export const lanceDbCreateTableToolOutputSchema = z
  .object({
    elapsedMs: z.number().nonnegative(),
    ok: z.literal(true),
    result: lanceDbCreateTableOutputSchema,
    tool: z.literal('lancedb.createTable')
  })
  .strict();

export const lanceDbInsertToolOutputSchema = z
  .object({
    elapsedMs: z.number().nonnegative(),
    ok: z.literal(true),
    result: lanceDbInsertOutputSchema,
    tool: z.literal('lancedb.insert')
  })
  .strict();

export const lanceDbSearchToolOutputSchema = z
  .object({
    elapsedMs: z.number().nonnegative(),
    ok: z.literal(true),
    result: lanceDbSearchOutputSchema,
    tool: z.literal('lancedb.search')
  })
  .strict();

export const dbToolSuccessOutputSchema = z.union([
  duckDbQueryToolOutputSchema,
  duckDbExecToolOutputSchema,
  lanceDbCreateTableToolOutputSchema,
  lanceDbInsertToolOutputSchema,
  lanceDbSearchToolOutputSchema
]);

export const dbToolErrorSchema = z
  .object({
    elapsedMs: z.number().nonnegative(),
    error: z
      .object({
        code: z.string().min(1),
        details: jsonValueSchema.optional(),
        message: z.string().min(1)
      })
      .strict(),
    ok: z.literal(false),
    tool: dbToolNameSchema
  })
  .strict();

export const dbToolOutputSchema = z.union([dbToolSuccessOutputSchema, dbToolErrorSchema]);

export const dbToolInputSchema = z
  .object({
    arguments: z.record(z.string(), jsonValueSchema),
    timeoutMs: z.number().int().positive().max(60_000).default(DEFAULT_DB_TIMEOUT_MS),
    tool: dbToolNameSchema
  })
  .strict();

export type DbRuntimeInput = z.infer<typeof dbRuntimeInputSchema>;
export type DuckDbRuntimeInput = z.infer<typeof duckDbRuntimeInputSchema>;
export type DuckDbQueryInput = z.infer<typeof duckDbQueryInputSchema>;
export type DuckDbQueryOutput = z.infer<typeof duckDbQueryOutputSchema>;
export type DuckDbQueryToolInput = z.infer<typeof duckDbQueryToolInputSchema>;
export type DuckDbQueryToolOutput = z.infer<typeof duckDbQueryToolOutputSchema>;
export type DuckDbExecInput = z.infer<typeof duckDbExecInputSchema>;
export type DuckDbExecOutput = z.infer<typeof duckDbExecOutputSchema>;
export type DuckDbExecToolInput = z.infer<typeof duckDbExecToolInputSchema>;
export type DuckDbExecToolOutput = z.infer<typeof duckDbExecToolOutputSchema>;
export type LanceDbRuntimeInput = z.infer<typeof lanceDbRuntimeInputSchema>;
export type LanceDbCreateTableInput = z.infer<typeof lanceDbCreateTableInputSchema>;
export type LanceDbCreateTableOutput = z.infer<typeof lanceDbCreateTableOutputSchema>;
export type LanceDbInsertInput = z.infer<typeof lanceDbInsertInputSchema>;
export type LanceDbInsertOutput = z.infer<typeof lanceDbInsertOutputSchema>;
export type LanceDbSearchInput = z.infer<typeof lanceDbSearchInputSchema>;
export type LanceDbSearchOutput = z.infer<typeof lanceDbSearchOutputSchema>;
export type DbToolInput = z.infer<typeof dbToolInputSchema>;
export type DbToolOutput = z.infer<typeof dbToolOutputSchema>;

export const pageSpeedSummarySchema = z
  .object({
    lighthousePerformanceScore: z.number().int().min(0).max(100).optional(),
    cwv: z
      .object({
        lcp: z.string().optional(),
        inp: z.string().optional(),
        cls: z.string().optional()
      })
      .partial()
      .optional(),
    lcpMs: z.number().nonnegative().optional(),
    clsScore: z.number().nonnegative().optional(),
    inpMs: z.number().nonnegative().optional(),
    ttfbMs: z.number().nonnegative().optional()
  })
  .strict();

export type PageSpeedSummary = z.infer<typeof pageSpeedSummarySchema>;
