"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.engineSchema = exports.reportFormatSchema = void 0;
exports.loadRuntimeOptions = loadRuntimeOptions;
const zod_1 = require("zod");
exports.reportFormatSchema = zod_1.z.enum(['json', 'html', 'both']);
exports.engineSchema = zod_1.z.enum(['http', 'rendered', 'fast', 'stealth']);
const runtimeOptionsSchema = zod_1.z.object({
    outputDir: zod_1.z.string().default('.'),
    format: exports.reportFormatSchema.default('both'),
    crawlDepth: zod_1.z.coerce.number().int().min(0).default(0),
    maxUrls: zod_1.z.coerce.number().int().min(1).default(10),
    render: zod_1.z.coerce.boolean().default(false),
    engine: exports.engineSchema.default('http'),
    budgetPath: zod_1.z.string().optional(),
    checkLinks: zod_1.z.coerce.boolean().default(false),
    checkApi: zod_1.z.coerce.boolean().default(false),
    allowPrivate: zod_1.z.coerce.boolean().default(false),
    http2: zod_1.z.coerce.boolean().default(false),
    pdf: zod_1.z.coerce.boolean().default(true),
    apiKey: zod_1.z.string().optional(),
    concurrency: zod_1.z.coerce.number().int().min(1).max(20).default(4),
    throttleMs: zod_1.z.coerce.number().int().min(0).max(60_000).default(0)
});
function loadRuntimeOptions(input) {
    const parsed = runtimeOptionsSchema.parse(input);
    return {
        outputDir: parsed.outputDir,
        reportFormat: parsed.format,
        crawlDepth: parsed.crawlDepth,
        maxUrls: parsed.maxUrls,
        render: parsed.render,
        engine: parsed.engine,
        budgetPath: parsed.budgetPath,
        checkLinks: parsed.checkLinks,
        checkApi: parsed.checkApi,
        allowPrivate: parsed.allowPrivate,
        http2: parsed.http2,
        pdf: parsed.pdf,
        apiKey: parsed.apiKey,
        concurrency: parsed.concurrency,
        throttleMs: parsed.throttleMs
    };
}
