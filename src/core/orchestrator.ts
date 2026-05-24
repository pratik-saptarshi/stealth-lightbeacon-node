import { randomUUID } from 'node:crypto';
import { crawlSite, type CrawledPage } from './crawler';
import type { AuditReport, DomainResult, Evaluator } from './types';

export interface RunAuditInput {
  targetUrl: string;
  options: {
    crawlDepth: number;
    maxUrls: number;
    concurrency?: number;
    throttleMs?: number;
  };
  fetchPage: (url: string) => Promise<CrawledPage>;
  evaluators: Evaluator[];
  enrichContext?: (page: CrawledPage) => Promise<Partial<Parameters<Evaluator['evaluate']>[0]>>;
  persistence?: AuditPersistence;
}

export interface AuditPersistence {
  beginRun?(input: {
    runId: string;
    startedAt: string;
    targetUrl: string;
    options: RunAuditInput['options'];
  }): Promise<void> | void;
  recordFinding?(input: {
    page: CrawledPage;
    result: DomainResult;
    runId: string;
  }): Promise<void> | void;
  recordPage?(input: {
    page: CrawledPage;
    runId: string;
  }): Promise<void> | void;
  finishRun?(input: {
    finishedAt: string;
    pages: CrawledPage[];
    report: AuditReport;
    runId: string;
  }): Promise<void> | void;
}

export async function runAudit(input: RunAuditInput): Promise<AuditReport> {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const crawl = await crawlSite({
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

  const resultsByEvaluator = new Map<string, DomainResult[]>();

  for (const page of crawl.pages) {
    for (const evaluator of input.evaluators) {
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
  const report: AuditReport = {
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

function consolidateDomainResults(results: DomainResult[]): DomainResult {
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
