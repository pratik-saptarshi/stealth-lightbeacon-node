"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.semanticMemoryRecordSchema = exports.auditFindingRecordSchema = exports.auditPageRecordSchema = exports.auditRunRecordSchema = exports.semanticSourceTypeSchema = void 0;
exports.createAuditRunRecord = createAuditRunRecord;
exports.createAuditPageRecord = createAuditPageRecord;
exports.createAuditFindingRecord = createAuditFindingRecord;
exports.createSemanticMemoryRecord = createSemanticMemoryRecord;
exports.buildPageSemanticText = buildPageSemanticText;
exports.buildFindingSemanticText = buildFindingSemanticText;
exports.embedSemanticText = embedSemanticText;
const node_crypto_1 = require("node:crypto");
const zod_1 = require("zod");
const schemas_1 = require("./schemas");
exports.semanticSourceTypeSchema = zod_1.z.enum(['page', 'finding', 'run']);
const timestampSchema = zod_1.z.string().datetime({ offset: true });
const semanticVectorDimension = 64;
exports.auditRunRecordSchema = zod_1.z
    .object({
    brokenPageCount: zod_1.z.number().int().nonnegative(),
    crawledPagesCount: zod_1.z.number().int().nonnegative(),
    crawlDepth: zod_1.z.number().int().nonnegative(),
    domainCount: zod_1.z.number().int().nonnegative(),
    durationMs: zod_1.z.number().nonnegative(),
    evaluatorIds: zod_1.z.array(zod_1.z.string().min(1)),
    findingCount: zod_1.z.number().int().nonnegative(),
    finishedAt: timestampSchema,
    maxUrls: zod_1.z.number().int().positive(),
    report: schemas_1.jsonValueSchema,
    runId: zod_1.z.string().min(1),
    startedAt: timestampSchema,
    targetUrl: zod_1.z.string().min(1),
    throttleMs: zod_1.z.number().int().nonnegative().optional(),
    concurrency: zod_1.z.number().int().positive().optional()
})
    .strict();
exports.auditPageRecordSchema = zod_1.z
    .object({
    headerCount: zod_1.z.number().int().nonnegative(),
    headers: zod_1.z.record(zod_1.z.string(), schemas_1.jsonValueSchema),
    htmlExcerpt: zod_1.z.string(),
    htmlLength: zod_1.z.number().int().nonnegative(),
    pageId: zod_1.z.string().min(1),
    pageIndex: zod_1.z.number().int().nonnegative(),
    responseTimeMs: zod_1.z.number().nonnegative(),
    runId: zod_1.z.string().min(1),
    status: zod_1.z.number().int().nonnegative(),
    url: zod_1.z.string().min(1)
})
    .strict();
exports.auditFindingRecordSchema = zod_1.z
    .object({
    domainId: zod_1.z.string().min(1),
    findingId: zod_1.z.string().min(1),
    issueId: zod_1.z.string().min(1),
    location: zod_1.z.string().min(1),
    message: zod_1.z.string().min(1),
    metadata: zod_1.z.record(zod_1.z.string(), schemas_1.jsonValueSchema),
    pageId: zod_1.z.string().min(1),
    pageIndex: zod_1.z.number().int().nonnegative(),
    pageUrl: zod_1.z.string().min(1),
    remedy: zod_1.z.string().min(1),
    runId: zod_1.z.string().min(1),
    score: zod_1.z.number().nonnegative(),
    severity: zod_1.z.enum(['critical', 'warning', 'info']),
    summary: zod_1.z.string().min(1)
})
    .strict();
exports.semanticMemoryRecordSchema = zod_1.z
    .object({
    createdAt: timestampSchema,
    domainId: zod_1.z.string().min(1).optional(),
    findingId: zod_1.z.string().min(1).optional(),
    memoryId: zod_1.z.string().min(1),
    pageId: zod_1.z.string().min(1).optional(),
    pageUrl: zod_1.z.string().min(1).optional(),
    runId: zod_1.z.string().min(1),
    sourceId: zod_1.z.string().min(1),
    sourceType: exports.semanticSourceTypeSchema,
    text: zod_1.z.string().min(1),
    vector: zod_1.z.array(zod_1.z.number().finite()).length(semanticVectorDimension)
})
    .strict();
function createAuditRunRecord(input) {
    return exports.auditRunRecordSchema.parse({
        ...input,
        runId: input.runId ?? (0, node_crypto_1.randomUUID)()
    });
}
function createAuditPageRecord(input) {
    const headers = normalizeRecord(input.headers);
    const htmlExcerpt = summarizeHtml(input.html);
    return exports.auditPageRecordSchema.parse({
        headerCount: Object.keys(headers).length,
        headers,
        htmlExcerpt,
        htmlLength: input.html.length,
        pageId: `${input.runId}:page:${input.pageIndex}`,
        pageIndex: input.pageIndex,
        responseTimeMs: input.responseTimeMs,
        runId: input.runId,
        status: input.status,
        url: input.url
    });
}
function createAuditFindingRecord(input) {
    return exports.auditFindingRecordSchema.parse({
        domainId: input.domainId,
        findingId: `${input.runId}:finding:${input.pageIndex}:${input.domainId}:${input.issueIndex}`,
        issueId: input.issueId,
        location: input.location,
        message: input.message,
        metadata: normalizeRecord(input.metadata),
        pageId: input.pageId,
        pageIndex: input.pageIndex,
        pageUrl: input.pageUrl,
        remedy: input.remedy,
        runId: input.runId,
        score: input.score,
        severity: input.severity,
        summary: input.summary
    });
}
function createSemanticMemoryRecord(input) {
    const createdAt = input.createdAt ?? new Date().toISOString();
    return exports.semanticMemoryRecordSchema.parse({
        createdAt,
        domainId: input.domainId,
        findingId: input.findingId,
        memoryId: `${input.runId}:memory:${input.sourceType}:${input.sourceId}`,
        pageId: input.pageId,
        pageUrl: input.pageUrl,
        runId: input.runId,
        sourceId: input.sourceId,
        sourceType: input.sourceType,
        text: input.text,
        vector: embedSemanticText(input.text)
    });
}
function buildPageSemanticText(url, html) {
    return normalizeSemanticText(`${url} ${summarizeHtml(html)}`);
}
function buildFindingSemanticText(input) {
    return normalizeSemanticText(`${input.domainId} ${input.issueId} ${input.pageUrl} ${input.summary} ${input.message} ${input.location} ${input.remedy}`);
}
function embedSemanticText(text) {
    const vector = Array.from({ length: semanticVectorDimension }, () => 0);
    const tokens = tokenizeSemanticText(text);
    if (tokens.length === 0) {
        return vector;
    }
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index] ?? '';
        if (!token) {
            continue;
        }
        const hash = hashToken(token);
        vector[hash % semanticVectorDimension] += 1;
        vector[(hash >>> 11) % semanticVectorDimension] += token.length / 12;
        const next = tokens[index + 1];
        if (next) {
            const pairHash = hashToken(`${token} ${next}`);
            vector[pairHash % semanticVectorDimension] += 0.5;
        }
    }
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    if (norm === 0) {
        return vector;
    }
    return vector.map((value) => Number((value / norm).toFixed(6)));
}
function normalizeSemanticText(text) {
    return text.replace(/\s+/g, ' ').trim();
}
function tokenizeSemanticText(text) {
    return normalizeSemanticText(text.toLowerCase())
        .replace(/<[^>]+>/g, ' ')
        .split(/[^a-z0-9]+/g)
        .map((token) => token.trim())
        .filter((token) => token.length > 1);
}
function summarizeHtml(html) {
    const stripped = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ');
    return normalizeSemanticText(stripped).slice(0, 1_500);
}
function normalizeRecord(input) {
    const output = {};
    for (const [key, value] of Object.entries(input)) {
        if (value === undefined) {
            continue;
        }
        output[key] = value;
    }
    return output;
}
function hashToken(token) {
    let hash = 2166136261;
    for (let index = 0; index < token.length; index += 1) {
        hash ^= token.charCodeAt(index) ?? 0;
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}
