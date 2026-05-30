"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOntologyStore = createOntologyStore;
exports.resolveOntologyPaths = resolveOntologyPaths;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const cheerio = __importStar(require("cheerio"));
const zod_1 = require("zod");
const duckdb_1 = require("./db/duckdb");
const lancedb_1 = require("./db/lancedb");
const ontologyStoreOptionsSchema = zod_1.z
    .object({
    collectionName: zod_1.z.string().min(1).default('ontology_memory'),
    duckDbPath: zod_1.z.string().min(1).optional(),
    lanceDbUri: zod_1.z.string().min(1).optional(),
    rootDir: zod_1.z.string().min(1).optional(),
    vectorDimensions: zod_1.z.number().int().min(16).max(256).default(64)
})
    .strict();
async function createOntologyStore(options = {}) {
    const parsed = resolveOntologyPaths(options);
    const rootDir = parsed.rootDir;
    const duckDbPath = parsed.duckDbPath;
    const lanceDbUri = parsed.lanceDbUri;
    (0, node_fs_1.mkdirSync)(rootDir, { recursive: true });
    const runtime = await createRuntimeBundle({ duckDbPath, lanceDbUri });
    let memoryTableReady = false;
    const runContext = new Map();
    await initializeSchema(runtime.duck);
    const insertMemoryRows = async (rows) => {
        if (rows.length === 0) {
            return;
        }
        if (!memoryTableReady) {
            await runtime.lance.createTable({
                data: rows.map(row => ({ ...row })),
                mode: 'overwrite',
                name: parsed.collectionName
            });
            memoryTableReady = true;
            return;
        }
        await runtime.lance.insert({
            data: rows.map(row => ({ ...row })),
            table: parsed.collectionName
        });
    };
    const store = {
        async beginRun(input) {
            runContext.set(input.runId, {
                options: input.options,
                startedAt: input.startedAt,
                targetUrl: input.targetUrl
            });
            await runtime.duck.exec({
                sql: `DELETE FROM audit_runs WHERE run_id = ?`,
                params: [input.runId]
            });
            await runtime.duck.exec({
                sql: `INSERT INTO audit_runs (run_id, target_url, started_at, created_at, options_json) VALUES (?, ?, ?, ?, ?)`,
                params: [
                    input.runId,
                    input.targetUrl,
                    input.startedAt,
                    input.startedAt,
                    JSON.stringify(input.options)
                ]
            });
        },
        async recordFinding(input) {
            const rows = flattenFinding(input.runId, input.page, input.result);
            for (const row of rows) {
                await runtime.duck.exec({
                    sql: `INSERT INTO audit_findings (run_id, page_url, domain_id, issue_id, severity, message, location, remedy, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    params: [
                        row.runId,
                        row.pageUrl,
                        row.domainId,
                        row.issueId,
                        row.severity,
                        row.message,
                        row.location,
                        row.remedy,
                        JSON.stringify(row.metadata)
                    ]
                });
            }
            await insertMemoryRows(rows.map(row => ({
                id: row.id,
                kind: row.kind,
                label: row.label,
                metadata: row.metadata,
                runId: row.runId,
                score: row.score,
                text: row.text,
                url: row.pageUrl,
                vector: makeVector(row.text, parsed.vectorDimensions)
            })));
        },
        async recordPage(input) {
            const row = buildPageRow(input.runId, input.page);
            await runtime.duck.exec({
                sql: `INSERT INTO audit_pages (run_id, page_url, status, response_time_ms, page_hash, title, headers_json, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                params: [
                    row.runId,
                    row.pageUrl,
                    row.status,
                    row.responseTimeMs,
                    row.pageHash,
                    row.title,
                    JSON.stringify(row.headers),
                    JSON.stringify(row.metadata)
                ]
            });
            await insertMemoryRows([
                {
                    id: row.id,
                    kind: row.kind,
                    label: row.label,
                    metadata: row.metadata,
                    runId: row.runId,
                    score: row.score,
                    text: row.text,
                    url: row.pageUrl,
                    vector: makeVector(row.text, parsed.vectorDimensions)
                }
            ]);
        },
        async finishRun(input) {
            const context = runContext.get(input.runId);
            const summaryRow = buildRunRow(input.runId, input.report, input.pages, context);
            await runtime.duck.exec({
                sql: `DELETE FROM audit_runs WHERE run_id = ?`,
                params: [input.runId]
            });
            await runtime.duck.exec({
                sql: `INSERT INTO audit_runs (run_id, target_url, started_at, completed_at, created_at, page_count, domain_count, report_json, options_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                params: [
                    summaryRow.runId,
                    summaryRow.targetUrl,
                    summaryRow.startedAt,
                    summaryRow.completedAt,
                    summaryRow.createdAt,
                    summaryRow.pageCount,
                    summaryRow.domainCount,
                    JSON.stringify(summaryRow.report),
                    JSON.stringify(summaryRow.options)
                ]
            });
            runContext.delete(input.runId);
            await insertMemoryRows([
                {
                    id: summaryRow.id,
                    kind: summaryRow.kind,
                    label: summaryRow.label,
                    metadata: summaryRow.metadata,
                    runId: summaryRow.runId,
                    score: summaryRow.score,
                    text: summaryRow.text,
                    url: summaryRow.targetUrl,
                    vector: makeVector(summaryRow.text, parsed.vectorDimensions)
                }
            ]);
        },
        async health() {
            const duckDbReady = await runtime.duck
                .query({ sql: 'select 1 as ok' })
                .then(() => true)
                .catch(() => false);
            const lanceDbReady = await runtime.lance
                .search({
                limit: 1,
                table: parsed.collectionName,
                vector: new Array(parsed.vectorDimensions).fill(0)
            })
                .then(() => true)
                .catch(() => memoryTableReady);
            return { duckDbReady, lanceDbReady };
        },
        async search(query, limit = 10) {
            if (!memoryTableReady) {
                return [];
            }
            try {
                const result = await runtime.lance.search({
                    limit,
                    table: parsed.collectionName,
                    vector: makeVector(query, parsed.vectorDimensions)
                });
                return result.rows.map(row => ({
                    id: String(row.id),
                    kind: String(row.kind),
                    label: String(row.label),
                    metadata: isRecord(row.metadata) ? row.metadata : undefined,
                    runId: String(row.runId),
                    score: typeof row.score === 'number' ? row.score : undefined,
                    text: String(row.text),
                    url: typeof row.url === 'string' ? row.url : undefined
                }));
            }
            catch {
                return [];
            }
        },
        async close() {
            await runtime.lance.close();
            await runtime.duck.close();
        }
    };
    return store;
}
function resolveOntologyPaths(options = {}) {
    const parsed = ontologyStoreOptionsSchema.parse(options);
    const rootDir = parsed.rootDir ?? (0, node_path_1.join)(process.cwd(), '.data');
    return {
        collectionName: parsed.collectionName,
        duckDbPath: parsed.duckDbPath ?? (0, node_path_1.join)(rootDir, 'ontology.duckdb'),
        lanceDbUri: parsed.lanceDbUri ?? (0, node_path_1.join)(rootDir, 'ontology.lancedb'),
        rootDir,
        vectorDimensions: parsed.vectorDimensions
    };
}
async function createRuntimeBundle(input) {
    return {
        duck: await (0, duckdb_1.createDuckDbRuntime)({ databasePath: input.duckDbPath, tempDirectory: (0, node_path_1.join)(process.cwd(), '.tmp', 'duckdb') }),
        lance: await (0, lancedb_1.createLanceDbRuntime)({ uri: input.lanceDbUri })
    };
}
async function initializeSchema(duck) {
    await duck.exec({
        sql: `CREATE TABLE IF NOT EXISTS audit_runs (
      run_id VARCHAR PRIMARY KEY,
      target_url VARCHAR NOT NULL,
      started_at VARCHAR NOT NULL,
      completed_at VARCHAR,
      created_at VARCHAR NOT NULL,
      page_count INTEGER,
      domain_count INTEGER,
      report_json VARCHAR,
      options_json VARCHAR
    )`
    });
    await duck.exec({
        sql: `CREATE TABLE IF NOT EXISTS audit_pages (
      run_id VARCHAR NOT NULL,
      page_url VARCHAR NOT NULL,
      status INTEGER NOT NULL,
      response_time_ms INTEGER NOT NULL,
      page_hash VARCHAR NOT NULL,
      title VARCHAR,
      headers_json VARCHAR NOT NULL,
      metadata_json VARCHAR NOT NULL
    )`
    });
    await duck.exec({
        sql: `CREATE TABLE IF NOT EXISTS audit_findings (
      run_id VARCHAR NOT NULL,
      page_url VARCHAR NOT NULL,
      domain_id VARCHAR NOT NULL,
      issue_id VARCHAR NOT NULL,
      severity VARCHAR NOT NULL,
      message VARCHAR NOT NULL,
      location VARCHAR NOT NULL,
      remedy VARCHAR NOT NULL,
      metadata_json VARCHAR NOT NULL
    )`
    });
}
function buildPageRow(runId, page) {
    const title = extractTitle(page.html);
    const text = summarizeHtml(page.html, title);
    const pageHash = (0, node_crypto_1.createHash)('sha256').update(page.html).digest('hex');
    return {
        id: `page:${hashId(page.url, pageHash)}`,
        kind: 'page',
        label: title ?? page.url,
        headers: page.headers,
        metadata: {
            headers: page.headers,
            pageHash,
            responseTimeMs: page.responseTimeMs,
            status: page.status
        },
        pageHash,
        pageUrl: page.url,
        responseTimeMs: page.responseTimeMs,
        runId,
        score: Math.max(0, 10 - page.responseTimeMs / 500),
        status: page.status,
        text,
        title: title ?? page.url,
        url: page.url,
        vector: []
    };
}
function buildRunRow(runId, report, pages, context) {
    const completedAt = new Date().toISOString();
    const pageCount = pages.length;
    const domainCount = report.domains.length;
    const summaryText = [
        `Audit run for ${report.targetUrl}`,
        `Pages: ${pageCount}`,
        `Domains: ${domainCount}`,
        `Broken pages: ${Object.keys(report.brokenPages ?? {}).length}`
    ].join('. ');
    return {
        completedAt,
        createdAt: completedAt,
        domainCount,
        id: `run:${runId}`,
        kind: 'run',
        label: report.targetUrl,
        metadata: {
            brokenPages: report.brokenPages ?? {},
            domainCount,
            pageCount
        },
        options: context?.options ?? {},
        pageCount,
        report,
        runId,
        score: averageDomainScore(report.domains),
        startedAt: context?.startedAt ?? completedAt,
        targetUrl: context?.targetUrl ?? report.targetUrl,
        text: summaryText,
        url: report.targetUrl,
        vector: []
    };
}
function flattenFinding(runId, page, result) {
    return result.issues.map(issue => ({
        domainId: result.id,
        id: `finding:${hashId(page.url, result.id, issue.id, issue.message)}`,
        issueId: issue.id,
        kind: 'finding',
        label: issue.id,
        location: issue.location,
        metadata: {
            domain: result.domain,
            pageStatus: page.status,
            remedy: issue.remedy
        },
        message: issue.message,
        pageUrl: page.url,
        remedy: issue.remedy,
        runId,
        score: issueSeverityScore(issue),
        severity: issue.severity,
        text: `${result.domain} ${issue.id} ${issue.message} ${issue.location} ${issue.remedy}`
    }));
}
function averageDomainScore(domains) {
    if (domains.length === 0) {
        return 0;
    }
    return Number((domains.reduce((total, domain) => total + domain.score, 0) / domains.length).toFixed(1));
}
function issueSeverityScore(issue) {
    switch (issue.severity) {
        case 'critical':
            return 10;
        case 'warning':
            return 6;
        case 'info':
            return 3;
        case 'pass':
            return 1;
    }
}
function hashId(...parts) {
    return (0, node_crypto_1.createHash)('sha256').update(parts.join('|')).digest('hex').slice(0, 24);
}
function extractTitle(html) {
    const $ = cheerio.load(html);
    const title = $('title').first().text().replace(/\s+/g, ' ').trim();
    return title || undefined;
}
function summarizeHtml(html, title) {
    const $ = cheerio.load(html);
    $('script, style').remove();
    const bodyText = $.root().text().replace(/\s+/g, ' ').trim();
    const text = title ? `${title}. ${bodyText}` : bodyText;
    return text.slice(0, 512);
}
function makeVector(text, dimensions) {
    const vector = new Array(dimensions).fill(0);
    const tokens = text
        .toLowerCase()
        .replace(/[^a-z0-9\s]+/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
    for (const token of tokens) {
        vector[hashToken(token) % dimensions] += 1;
    }
    const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    if (magnitude === 0) {
        return vector;
    }
    return vector.map(value => Number((value / magnitude).toFixed(6)));
}
function hashToken(token) {
    let hash = 2166136261;
    for (let index = 0; index < token.length; index += 1) {
        hash ^= token.charCodeAt(index);
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return hash >>> 0;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
