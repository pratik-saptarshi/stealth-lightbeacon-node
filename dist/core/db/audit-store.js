"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAuditStore = createAuditStore;
exports.createAuditPersistence = createAuditPersistence;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const zod_1 = require("zod");
const duckdb_1 = require("./duckdb");
const ontology_1 = require("./ontology");
const lancedb_1 = require("./lancedb");
const auditRunTableName = 'audit_runs';
const auditPageTableName = 'audit_pages';
const auditFindingTableName = 'audit_findings';
const semanticMemoryTableName = 'audit_semantic_memory';
async function createAuditStore(options) {
    if (options.duckDbPath !== ':memory:') {
        (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(options.duckDbPath), { recursive: true });
    }
    (0, node_fs_1.mkdirSync)(options.lanceDbPath, { recursive: true });
    const duckDb = await (0, duckdb_1.createDuckDbRuntime)({
        databasePath: options.duckDbPath,
        timeoutMs: options.timeoutMs
    });
    const lanceDb = await (0, lancedb_1.createLanceDbRuntime)({
        timeoutMs: options.timeoutMs,
        uri: options.lanceDbPath
    });
    let closed = false;
    return {
        async close() {
            if (closed) {
                return;
            }
            closed = true;
            await Promise.all([duckDb.close(), lanceDb.close()]);
        },
        async getRun(runId) {
            await ensureDuckTables(duckDb);
            const result = await duckDb.query({
                sql: `SELECT * FROM ${auditRunTableName} WHERE run_id = ? LIMIT 1`,
                params: [runId]
            });
            const row = result.rows[0];
            if (!row) {
                return null;
            }
            return parseRunRow(row);
        },
        async listFindings(runId) {
            await ensureDuckTables(duckDb);
            const result = await duckDb.query({
                sql: `SELECT * FROM ${auditFindingTableName} WHERE run_id = ? ORDER BY page_index, finding_id`,
                params: [runId]
            });
            return result.rows.map((row) => parseFindingRow(row));
        },
        async listPages(runId) {
            await ensureDuckTables(duckDb);
            const result = await duckDb.query({
                sql: `SELECT * FROM ${auditPageTableName} WHERE run_id = ? ORDER BY page_index`,
                params: [runId]
            });
            return result.rows.map((row) => parsePageRow(row));
        },
        async persistAudit(payload) {
            await ensureDuckTables(duckDb);
            await insertRun(duckDb, payload.run);
            await insertPages(duckDb, payload.pages);
            await insertFindings(duckDb, payload.findings);
            await upsertSemanticMemory(lanceDb, payload.semanticMemory);
        },
        async searchSemanticMemory(query, limit = 5) {
            try {
                const result = await lanceDb.search({
                    limit,
                    table: semanticMemoryTableName,
                    vector: (0, ontology_1.embedSemanticText)(query)
                });
                return result.rows.map((row) => parseSemanticLookupRow(row));
            }
            catch {
                return [];
            }
        }
    };
}
async function createAuditPersistence(options) {
    const store = await createAuditStore(options);
    const pagesByUrl = new Map();
    const accumulatedPages = [];
    const accumulatedFindings = [];
    const accumulatedSemanticMemory = [];
    let runContext = null;
    return {
        async beginRun(input) {
            runContext = input;
            pagesByUrl.clear();
            accumulatedPages.length = 0;
            accumulatedFindings.length = 0;
            accumulatedSemanticMemory.length = 0;
        },
        async close() {
            await store.close();
        },
        async finishRun(input) {
            if (!runContext) {
                return;
            }
            try {
                await store.persistAudit({
                    findings: accumulatedFindings,
                    pages: accumulatedPages,
                    run: createAuditRunRecord({
                        brokenPageCount: input.report.brokenPages ? Object.keys(input.report.brokenPages).length : 0,
                        crawledPagesCount: input.report.crawledPagesCount,
                        crawlDepth: runContext.options.crawlDepth,
                        concurrency: runContext.options.concurrency,
                        domainCount: input.report.domains.length,
                        durationMs: new Date(input.finishedAt).getTime() - new Date(runContext.startedAt).getTime(),
                        evaluatorIds: input.report.domains.map((domain) => domain.id),
                        findingCount: accumulatedFindings.length,
                        finishedAt: input.finishedAt,
                        maxUrls: runContext.options.maxUrls,
                        report: input.report,
                        startedAt: runContext.startedAt,
                        targetUrl: runContext.targetUrl,
                        throttleMs: runContext.options.throttleMs
                    }),
                    semanticMemory: accumulatedSemanticMemory
                });
            }
            catch {
                // Persistence is best-effort so the CLI report path stays unchanged.
            }
        },
        async recordFinding(input) {
            const pageRecord = pagesByUrl.get(input.page.url);
            if (!pageRecord) {
                return;
            }
            for (const [issueIndex, issue] of input.result.issues.entries()) {
                const finding = createAuditFindingRecord({
                    domainId: input.result.domain,
                    issueId: issue.id,
                    issueIndex,
                    location: issue.location,
                    message: issue.msg,
                    metadata: input.result.metadata,
                    pageId: pageRecord.pageId,
                    pageIndex: pageRecord.pageIndex,
                    pageUrl: input.page.url,
                    remedy: issue.remedy,
                    runId: input.runId,
                    score: input.result.score,
                    severity: issue.severity === 'pass' ? 'info' : issue.severity,
                    summary: `${input.result.domain}:${issue.id}`
                });
                accumulatedFindings.push(finding);
                accumulatedSemanticMemory.push(createSemanticMemoryRecord({
                    domainId: finding.domainId,
                    findingId: finding.findingId,
                    pageId: finding.pageId,
                    pageUrl: finding.pageUrl,
                    runId: finding.runId,
                    sourceId: finding.findingId,
                    sourceType: 'finding',
                    text: buildFindingSemanticText({
                        domainId: finding.domainId,
                        issueId: finding.issueId,
                        location: finding.location,
                        message: finding.message,
                        pageUrl: finding.pageUrl,
                        remedy: finding.remedy,
                        summary: finding.summary
                    })
                }));
            }
        },
        async recordPage(input) {
            const pageRecord = createAuditPageRecord({
                headers: input.page.headers,
                html: input.page.html,
                pageIndex: accumulatedPages.length,
                responseTimeMs: input.page.responseTimeMs,
                runId: input.runId,
                status: input.page.status,
                url: input.page.url
            });
            pagesByUrl.set(input.page.url, pageRecord);
            accumulatedPages.push(pageRecord);
            accumulatedSemanticMemory.push(createSemanticMemoryRecord({
                pageId: pageRecord.pageId,
                pageUrl: pageRecord.url,
                runId: pageRecord.runId,
                sourceId: pageRecord.pageId,
                sourceType: 'page',
                text: buildPageSemanticText(pageRecord.url, input.page.html)
            }));
        }
    };
}
async function ensureDuckTables(duckDb) {
    await duckDb.query({
        sql: `CREATE TABLE IF NOT EXISTS ${auditRunTableName} (
      run_id VARCHAR PRIMARY KEY,
      target_url VARCHAR NOT NULL,
      started_at VARCHAR NOT NULL,
      finished_at VARCHAR NOT NULL,
      duration_ms DOUBLE NOT NULL,
      crawl_depth INTEGER NOT NULL,
      max_urls INTEGER NOT NULL,
      concurrency INTEGER,
      throttle_ms INTEGER,
      evaluator_ids VARCHAR NOT NULL,
      crawled_pages_count INTEGER NOT NULL,
      domain_count INTEGER NOT NULL,
      finding_count INTEGER NOT NULL,
      broken_page_count INTEGER NOT NULL,
      report_json VARCHAR NOT NULL
    )`
    });
    await duckDb.query({
        sql: `CREATE TABLE IF NOT EXISTS ${auditPageTableName} (
      page_id VARCHAR PRIMARY KEY,
      run_id VARCHAR NOT NULL,
      page_index INTEGER NOT NULL,
      url VARCHAR NOT NULL,
      status INTEGER NOT NULL,
      response_time_ms DOUBLE NOT NULL,
      header_count INTEGER NOT NULL,
      headers_json VARCHAR NOT NULL,
      html_excerpt VARCHAR NOT NULL,
      html_length INTEGER NOT NULL
    )`
    });
    await duckDb.query({
        sql: `CREATE TABLE IF NOT EXISTS ${auditFindingTableName} (
      finding_id VARCHAR PRIMARY KEY,
      run_id VARCHAR NOT NULL,
      page_id VARCHAR NOT NULL,
      page_index INTEGER NOT NULL,
      page_url VARCHAR NOT NULL,
      domain_id VARCHAR NOT NULL,
      issue_id VARCHAR NOT NULL,
      severity VARCHAR NOT NULL,
      message VARCHAR NOT NULL,
      location VARCHAR NOT NULL,
      remedy VARCHAR NOT NULL,
      score DOUBLE NOT NULL,
      summary VARCHAR NOT NULL,
      metadata_json VARCHAR NOT NULL
    )`
    });
}
async function insertRun(duckDb, run) {
    await duckDb.query({
        sql: `DELETE FROM ${auditRunTableName} WHERE run_id = ?`,
        params: [run.runId]
    });
    await duckDb.query({
        sql: `INSERT INTO ${auditRunTableName} VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
            run.runId,
            run.targetUrl,
            run.startedAt,
            run.finishedAt,
            run.durationMs,
            run.crawlDepth,
            run.maxUrls,
            run.concurrency ?? null,
            run.throttleMs ?? null,
            JSON.stringify(run.evaluatorIds),
            run.crawledPagesCount,
            run.domainCount,
            run.findingCount,
            run.brokenPageCount,
            JSON.stringify(run.report)
        ]
    });
}
async function insertPages(duckDb, pages) {
    for (const page of pages) {
        await duckDb.query({
            sql: `DELETE FROM ${auditPageTableName} WHERE page_id = ?`,
            params: [page.pageId]
        });
        await duckDb.query({
            sql: `INSERT INTO ${auditPageTableName} VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            params: [
                page.pageId,
                page.runId,
                page.pageIndex,
                page.url,
                page.status,
                page.responseTimeMs,
                page.headerCount,
                JSON.stringify(page.headers),
                page.htmlExcerpt,
                page.htmlLength
            ]
        });
    }
}
async function insertFindings(duckDb, findings) {
    for (const finding of findings) {
        await duckDb.query({
            sql: `DELETE FROM ${auditFindingTableName} WHERE finding_id = ?`,
            params: [finding.findingId]
        });
        await duckDb.query({
            sql: `INSERT INTO ${auditFindingTableName} VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            params: [
                finding.findingId,
                finding.runId,
                finding.pageId,
                finding.pageIndex,
                finding.pageUrl,
                finding.domainId,
                finding.issueId,
                finding.severity,
                finding.message,
                finding.location,
                finding.remedy,
                finding.score,
                finding.summary,
                JSON.stringify(finding.metadata)
            ]
        });
    }
}
async function upsertSemanticMemory(lanceDb, rows) {
    if (rows.length === 0) {
        return;
    }
    try {
        await lanceDb.insert({
            data: rows,
            table: semanticMemoryTableName
        });
    }
    catch {
        await lanceDb.createTable({
            data: rows,
            mode: 'create',
            name: semanticMemoryTableName
        });
    }
}
function parseRunRow(row) {
    return ontology_1.auditRunRecordSchema.parse({
        brokenPageCount: row.broken_page_count,
        crawledPagesCount: row.crawled_pages_count,
        crawlDepth: row.crawl_depth,
        domainCount: row.domain_count,
        durationMs: row.duration_ms,
        evaluatorIds: parseJsonArray(row.evaluator_ids),
        findingCount: row.finding_count,
        finishedAt: row.finished_at,
        maxUrls: row.max_urls,
        concurrency: row.concurrency === null ? undefined : row.concurrency,
        report: JSON.parse(row.report_json),
        runId: row.run_id,
        startedAt: row.started_at,
        targetUrl: row.target_url,
        throttleMs: row.throttle_ms === null ? undefined : row.throttle_ms
    });
}
function parsePageRow(row) {
    return ontology_1.auditPageRecordSchema.parse({
        headerCount: row.header_count,
        headers: JSON.parse(row.headers_json),
        htmlExcerpt: row.html_excerpt,
        htmlLength: row.html_length,
        pageId: row.page_id,
        pageIndex: row.page_index,
        responseTimeMs: row.response_time_ms,
        runId: row.run_id,
        status: row.status,
        url: row.url
    });
}
function parseFindingRow(row) {
    return ontology_1.auditFindingRecordSchema.parse({
        domainId: row.domain_id,
        findingId: row.finding_id,
        issueId: row.issue_id,
        location: row.location,
        message: row.message,
        metadata: JSON.parse(row.metadata_json),
        pageId: row.page_id,
        pageIndex: row.page_index,
        pageUrl: row.page_url,
        remedy: row.remedy,
        runId: row.run_id,
        score: row.score,
        severity: row.severity,
        summary: row.summary
    });
}
function parseJsonArray(value) {
    const parsed = JSON.parse(value);
    return zod_1.z.array(zod_1.z.string()).parse(parsed);
}
function parseSemanticLookupRow(row) {
    return {
        createdAt: zod_1.z.string().parse(row.createdAt),
        domainId: row.domainId === undefined ? undefined : zod_1.z.string().parse(row.domainId),
        distance: typeof row.distance === 'number' ? row.distance : typeof row._distance === 'number' ? row._distance : undefined,
        findingId: row.findingId === undefined ? undefined : zod_1.z.string().parse(row.findingId),
        memoryId: zod_1.z.string().parse(row.memoryId),
        pageId: row.pageId === undefined ? undefined : zod_1.z.string().parse(row.pageId),
        pageUrl: row.pageUrl === undefined ? undefined : zod_1.z.string().parse(row.pageUrl),
        runId: zod_1.z.string().parse(row.runId),
        sourceId: zod_1.z.string().parse(row.sourceId),
        sourceType: zod_1.z.enum(['page', 'finding', 'run']).parse(row.sourceType),
        text: zod_1.z.string().parse(row.text),
        vector: zod_1.z.array(zod_1.z.number()).parse(Array.from(row.vector ?? []))
    };
}
