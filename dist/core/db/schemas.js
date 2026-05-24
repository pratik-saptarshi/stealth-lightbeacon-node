"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pageSpeedSummarySchema = exports.dbToolInputSchema = exports.dbToolOutputSchema = exports.dbToolErrorSchema = exports.dbToolSuccessOutputSchema = exports.lanceDbSearchToolOutputSchema = exports.lanceDbInsertToolOutputSchema = exports.lanceDbCreateTableToolOutputSchema = exports.lanceDbSearchToolInputSchema = exports.lanceDbInsertToolInputSchema = exports.lanceDbCreateTableToolInputSchema = exports.lanceDbSearchOutputSchema = exports.lanceDbSearchInputSchema = exports.lanceDbInsertOutputSchema = exports.lanceDbInsertInputSchema = exports.lanceDbCreateTableOutputSchema = exports.lanceDbCreateTableInputSchema = exports.lanceDbRuntimeInputSchema = exports.duckDbExecToolOutputSchema = exports.duckDbExecToolInputSchema = exports.duckDbExecOutputSchema = exports.duckDbExecInputSchema = exports.duckDbQueryToolOutputSchema = exports.duckDbQueryToolInputSchema = exports.duckDbQueryOutputSchema = exports.duckDbQueryInputSchema = exports.duckDbRuntimeInputSchema = exports.dbRuntimeInputSchema = exports.dbToolNameSchema = exports.dbRowsSchema = exports.dbRowSchema = exports.jsonValueSchema = void 0;
const zod_1 = require("zod");
const timeouts_1 = require("./timeouts");
const jsonPrimitiveSchema = zod_1.z.union([zod_1.z.string(), zod_1.z.number().finite(), zod_1.z.boolean(), zod_1.z.null()]);
exports.jsonValueSchema = zod_1.z.lazy(() => zod_1.z.union([jsonPrimitiveSchema, zod_1.z.array(exports.jsonValueSchema), zod_1.z.record(zod_1.z.string(), exports.jsonValueSchema)]));
exports.dbRowSchema = zod_1.z.record(zod_1.z.string(), exports.jsonValueSchema);
exports.dbRowsSchema = zod_1.z.array(exports.dbRowSchema);
exports.dbToolNameSchema = zod_1.z.enum([
    'duckdb.query',
    'duckdb.exec',
    'lancedb.createTable',
    'lancedb.insert',
    'lancedb.search'
]);
exports.dbRuntimeInputSchema = zod_1.z
    .object({
    timeoutMs: zod_1.z.number().int().positive().max(60_000).default(timeouts_1.DEFAULT_DB_TIMEOUT_MS)
})
    .strict();
exports.duckDbRuntimeInputSchema = zod_1.z
    .object({
    databasePath: zod_1.z.string().min(1).default(':memory:'),
    memoryLimit: zod_1.z.string().min(1).default('256MB'),
    tempDirectory: zod_1.z.string().min(1).optional(),
    threads: zod_1.z.number().int().positive().max(64).default(2),
    timeoutMs: zod_1.z.number().int().positive().max(60_000).default(timeouts_1.DEFAULT_DB_TIMEOUT_MS)
})
    .strict();
exports.duckDbQueryInputSchema = zod_1.z
    .object({
    sql: zod_1.z.string().min(1),
    params: zod_1.z.union([zod_1.z.array(exports.jsonValueSchema), zod_1.z.record(zod_1.z.string(), exports.jsonValueSchema)]).optional(),
    timeoutMs: zod_1.z.number().int().positive().max(60_000).default(timeouts_1.DEFAULT_DB_TIMEOUT_MS)
})
    .strict();
exports.duckDbQueryOutputSchema = zod_1.z
    .object({
    columns: zod_1.z.array(zod_1.z.string()),
    elapsedMs: zod_1.z.number().nonnegative(),
    rowCount: zod_1.z.number().int().nonnegative(),
    rows: exports.dbRowsSchema
})
    .strict();
exports.duckDbQueryToolInputSchema = zod_1.z
    .object({
    arguments: exports.duckDbQueryInputSchema,
    tool: zod_1.z.literal('duckdb.query')
})
    .strict();
exports.duckDbQueryToolOutputSchema = zod_1.z
    .object({
    elapsedMs: zod_1.z.number().nonnegative(),
    ok: zod_1.z.literal(true),
    result: exports.duckDbQueryOutputSchema,
    tool: zod_1.z.literal('duckdb.query')
})
    .strict();
exports.duckDbExecInputSchema = zod_1.z
    .object({
    sql: zod_1.z.string().min(1),
    params: zod_1.z.union([zod_1.z.array(exports.jsonValueSchema), zod_1.z.record(zod_1.z.string(), exports.jsonValueSchema)]).optional(),
    timeoutMs: zod_1.z.number().int().positive().max(60_000).default(timeouts_1.DEFAULT_DB_TIMEOUT_MS)
})
    .strict();
exports.duckDbExecOutputSchema = zod_1.z
    .object({
    elapsedMs: zod_1.z.number().nonnegative(),
    ok: zod_1.z.literal(true),
    result: zod_1.z.object({}).strict(),
    tool: zod_1.z.literal('duckdb.exec')
})
    .strict();
exports.duckDbExecToolInputSchema = zod_1.z
    .object({
    arguments: exports.duckDbExecInputSchema,
    tool: zod_1.z.literal('duckdb.exec')
})
    .strict();
exports.duckDbExecToolOutputSchema = exports.duckDbExecOutputSchema;
exports.lanceDbRuntimeInputSchema = zod_1.z
    .object({
    timeoutMs: zod_1.z.number().int().positive().max(60_000).default(timeouts_1.DEFAULT_DB_TIMEOUT_MS),
    uri: zod_1.z.string().min(1)
})
    .strict();
exports.lanceDbCreateTableInputSchema = zod_1.z
    .object({
    data: exports.dbRowsSchema.min(1),
    mode: zod_1.z.enum(['create', 'overwrite']).default('create'),
    name: zod_1.z.string().min(1),
    timeoutMs: zod_1.z.number().int().positive().max(60_000).default(timeouts_1.DEFAULT_DB_TIMEOUT_MS)
})
    .strict();
exports.lanceDbCreateTableOutputSchema = zod_1.z
    .object({
    elapsedMs: zod_1.z.number().nonnegative(),
    mode: zod_1.z.enum(['create', 'overwrite']),
    ok: zod_1.z.literal(true),
    rowCount: zod_1.z.number().int().nonnegative(),
    table: zod_1.z.string().min(1)
})
    .strict();
exports.lanceDbInsertInputSchema = zod_1.z
    .object({
    data: exports.dbRowsSchema.min(1),
    table: zod_1.z.string().min(1),
    timeoutMs: zod_1.z.number().int().positive().max(60_000).default(timeouts_1.DEFAULT_DB_TIMEOUT_MS)
})
    .strict();
exports.lanceDbInsertOutputSchema = zod_1.z
    .object({
    elapsedMs: zod_1.z.number().nonnegative(),
    ok: zod_1.z.literal(true),
    rowCount: zod_1.z.number().int().nonnegative(),
    table: zod_1.z.string().min(1)
})
    .strict();
exports.lanceDbSearchInputSchema = zod_1.z
    .object({
    limit: zod_1.z.number().int().positive().max(100).default(10),
    table: zod_1.z.string().min(1),
    timeoutMs: zod_1.z.number().int().positive().max(60_000).default(timeouts_1.DEFAULT_DB_TIMEOUT_MS),
    vector: zod_1.z.array(zod_1.z.number().finite()).min(1),
    where: zod_1.z.string().min(1).optional()
})
    .strict();
exports.lanceDbSearchOutputSchema = zod_1.z
    .object({
    elapsedMs: zod_1.z.number().nonnegative(),
    ok: zod_1.z.literal(true),
    rowCount: zod_1.z.number().int().nonnegative(),
    rows: exports.dbRowsSchema,
    table: zod_1.z.string().min(1)
})
    .strict();
exports.lanceDbCreateTableToolInputSchema = zod_1.z
    .object({
    arguments: exports.lanceDbCreateTableInputSchema,
    tool: zod_1.z.literal('lancedb.createTable')
})
    .strict();
exports.lanceDbInsertToolInputSchema = zod_1.z
    .object({
    arguments: exports.lanceDbInsertInputSchema,
    tool: zod_1.z.literal('lancedb.insert')
})
    .strict();
exports.lanceDbSearchToolInputSchema = zod_1.z
    .object({
    arguments: exports.lanceDbSearchInputSchema,
    tool: zod_1.z.literal('lancedb.search')
})
    .strict();
exports.lanceDbCreateTableToolOutputSchema = zod_1.z
    .object({
    elapsedMs: zod_1.z.number().nonnegative(),
    ok: zod_1.z.literal(true),
    result: exports.lanceDbCreateTableOutputSchema,
    tool: zod_1.z.literal('lancedb.createTable')
})
    .strict();
exports.lanceDbInsertToolOutputSchema = zod_1.z
    .object({
    elapsedMs: zod_1.z.number().nonnegative(),
    ok: zod_1.z.literal(true),
    result: exports.lanceDbInsertOutputSchema,
    tool: zod_1.z.literal('lancedb.insert')
})
    .strict();
exports.lanceDbSearchToolOutputSchema = zod_1.z
    .object({
    elapsedMs: zod_1.z.number().nonnegative(),
    ok: zod_1.z.literal(true),
    result: exports.lanceDbSearchOutputSchema,
    tool: zod_1.z.literal('lancedb.search')
})
    .strict();
exports.dbToolSuccessOutputSchema = zod_1.z.union([
    exports.duckDbQueryToolOutputSchema,
    exports.duckDbExecToolOutputSchema,
    exports.lanceDbCreateTableToolOutputSchema,
    exports.lanceDbInsertToolOutputSchema,
    exports.lanceDbSearchToolOutputSchema
]);
exports.dbToolErrorSchema = zod_1.z
    .object({
    elapsedMs: zod_1.z.number().nonnegative(),
    error: zod_1.z
        .object({
        code: zod_1.z.string().min(1),
        details: exports.jsonValueSchema.optional(),
        message: zod_1.z.string().min(1)
    })
        .strict(),
    ok: zod_1.z.literal(false),
    tool: exports.dbToolNameSchema
})
    .strict();
exports.dbToolOutputSchema = zod_1.z.union([exports.dbToolSuccessOutputSchema, exports.dbToolErrorSchema]);
exports.dbToolInputSchema = zod_1.z
    .object({
    arguments: zod_1.z.record(zod_1.z.string(), exports.jsonValueSchema),
    timeoutMs: zod_1.z.number().int().positive().max(60_000).default(timeouts_1.DEFAULT_DB_TIMEOUT_MS),
    tool: exports.dbToolNameSchema
})
    .strict();
exports.pageSpeedSummarySchema = zod_1.z
    .object({
    lighthousePerformanceScore: zod_1.z.number().int().min(0).max(100).optional(),
    cwv: zod_1.z
        .object({
        lcp: zod_1.z.string().optional(),
        inp: zod_1.z.string().optional(),
        cls: zod_1.z.string().optional()
    })
        .partial()
        .optional(),
    lcpMs: zod_1.z.number().nonnegative().optional(),
    clsScore: zod_1.z.number().nonnegative().optional(),
    inpMs: zod_1.z.number().nonnegative().optional(),
    ttfbMs: zod_1.z.number().nonnegative().optional()
})
    .strict();
