"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAudit = runAudit;
const node_crypto_1 = require("node:crypto");
const crawler_1 = require("./crawler");
const evaluatorRegistry_1 = require("./evaluatorRegistry");
async function runAudit(input) {
    const runId = (0, node_crypto_1.randomUUID)();
    const startedAt = new Date().toISOString();
    const crawl = await (0, crawler_1.crawlSite)({
        startUrl: input.targetUrl,
        maxDepth: input.options.crawlDepth,
        maxUrls: input.options.maxUrls,
        fetchPage: input.fetchPage,
        concurrency: input.options.concurrency,
        throttleMs: input.options.throttleMs
    });
    await input.persistence?.beginRun?.({
        options: input.options,
        runId,
        startedAt,
        targetUrl: input.targetUrl
    });
    if (input.persistence?.recordPage) {
        for (const page of crawl.pages) {
            await input.persistence.recordPage({
                page,
                runId
            });
        }
    }
    const registry = (0, evaluatorRegistry_1.createDefaultEvaluatorRegistry)();
    const baseEvaluators = input.evaluators && input.evaluators.length > 0
        ? input.evaluators
        : registry.createEvaluators();
    const filterIds = input.options.evaluators;
    const evaluatorsToRun = filterIds && filterIds.length > 0
        ? baseEvaluators.filter((e) => filterIds.includes(e.id))
        : baseEvaluators;
    const resultsByEvaluator = new Map();
    for (const page of crawl.pages) {
        for (const evaluator of evaluatorsToRun) {
            const result = await evaluator.evaluate({
                url: page.url,
                html: page.html,
                headers: page.headers,
                status: page.status,
                responseTimeMs: page.responseTimeMs,
                ...(input.enrichContext ? await input.enrichContext(page) : {})
            });
            const current = resultsByEvaluator.get(evaluator.id) ?? [];
            current.push(result);
            resultsByEvaluator.set(evaluator.id, current);
            await input.persistence?.recordFinding?.({
                page,
                result,
                runId
            });
        }
    }
    const domains = [...resultsByEvaluator.values()].map(consolidateDomainResults);
    const report = {
        targetUrl: input.targetUrl,
        crawledPagesCount: crawl.pages.length,
        domains,
        brokenPages: Object.fromEntries(crawl.brokenPages)
    };
    await input.persistence?.finishRun?.({
        finishedAt: new Date().toISOString(),
        pages: crawl.pages,
        report,
        runId
    });
    return report;
}
function consolidateDomainResults(results) {
    const [first] = results;
    const issues = results.flatMap((result) => result.issues);
    const score = results.reduce((total, result) => total + result.score, 0) / results.length;
    const metadata = Object.assign({}, ...results.map((result) => result.metadata));
    return {
        id: first.id,
        domain: first.domain,
        score: Number(score.toFixed(1)),
        issues,
        metadata
    };
}
