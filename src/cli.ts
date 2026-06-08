#!/usr/bin/env node
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import ora from 'ora';
import { createDefaultEvaluators } from './core/defaultEvaluators';
import { createFetchPage, discoverBrokenLinks, fetchHttpPage, secureFetch } from './core/fetcher';
import { loadRuntimeOptions, type RuntimeOptions } from './core/config';
import { runAudit } from './core/orchestrator';
import { Reporter } from './core/reporter';
import { PageSpeedService } from './core/pagespeed';
import { validateBudgets } from './core/budget';
import { SSRFGuard } from './core/ssrf';
import { createOntologyStore, type OntologySearchResult, type OntologyStore, type OntologyStoreOptions } from './core/ontology';
import { BrowserPool } from './core/scraping/browserPool';
import { PreAuditRecon, type ReconRecommendation } from './core/recon';

const DEFAULT_OUTPUT_DIR = 'reports';
const DEFAULT_SEARCH_LIMIT = 10;

interface SearchSemanticOptions {
  createStore?: (options: OntologyStoreOptions) => Promise<Pick<OntologyStore, 'close' | 'search'>>;
  dataDir?: unknown;
  format?: unknown;
  limit?: unknown;
}

export async function main(): Promise<void> {
  const cleanup = async () => {
    try {
      await BrowserPool.getInstance().close();
    } catch {
      // Ignore cleanup error
    }
    process.exit(130);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  const program = new Command();

  program
    .name('stealth-lightbeacon')
    .description('TypeScript crawl orchestration and multi-domain site auditing CLI with security checks, SEO, AEO, GEO, and performance reporting.')
    .version('2.0.0');

  program
    .command('evaluate')
    .argument('<url>', 'Target Drupal site URL')
    .option('-o, --out <dir>', 'Output directory', DEFAULT_OUTPUT_DIR)
    .option('-f, --format <format>', 'Report format: json, html, both, llm, geo-xml', 'both')
    .option('-d, --crawl-depth <depth>', 'Crawl depth', '0')
    .option('-n, --max-urls <count>', 'Maximum crawled URLs', '10')
    .option('--render', 'Render JS via Playwright', false)
    .option('--engine <engine>', 'Fetch engine: http, rendered, fast, or stealth', 'http')
    .option('--recon-auto', 'Run pre-audit recon and apply the recommended engine/throttle', false)
    .option('--http2', 'Reserved flag for HTTP/2 transport support', false)
    .option('--budget <path>', 'Budget configuration path')
    .option('--check-links', 'Check discovered outbound links', false)
    .option('--check-api', 'Probe Drupal JSON:API user endpoint', false)
    .option('--allow-private', 'Allow private or loopback targets', false)
    .option('--api-key <key>', 'Google PageSpeed Insights API key')
    .option('--persist', 'Persist audit and ontology state', true)
    .option('--no-persist', 'Skip audit and ontology persistence')
    .option('--no-pdf', 'Skip PDF output')
    .action(async (url: string, options: Record<string, unknown>) => {
      await evaluateCommand(url, options);
    });

  program
    .command('search-semantic')
    .argument('<query>', 'Semantic query for persisted audit and ontology data')
    .option('--data-dir <dir>', 'Persistence data directory')
    .option('--format <format>', 'Output format: json or llm', 'json')
    .option('--limit <count>', 'Maximum result count', String(DEFAULT_SEARCH_LIMIT))
    .action(async (query: string, options: Record<string, unknown>) => {
      await searchSemanticCommand(query, options);
      process.exit(0);
    });

  program
    .command('recon')
    .argument('<url>', 'Target URL')
    .option('--allow-private', 'Allow private or loopback targets', false)
    .action(async (url: string, options: Record<string, unknown>) => {
      await reconCommand(url, options);
      process.exit(0);
    });

  program
    .argument('[url]', 'Compatibility mode target URL')
    .option('-o, --output <dir>', 'Output directory', DEFAULT_OUTPUT_DIR)
    .option('-k, --api-key <key>', 'Google PageSpeed Insights API key')
    .option('--search-semantic <query>', 'Semantic query for persisted audit and ontology data')
    .option('--search-format <format>', 'Semantic search output format: json or llm', 'json')
    .option('--search-limit <count>', 'Maximum semantic search result count', String(DEFAULT_SEARCH_LIMIT))
    .option('--data-dir <dir>', 'Persistence data directory')
    .option('--no-pdf', 'Skip PDF generation')
    .action(async (url: string | undefined, options: Record<string, unknown>) => {
      if (typeof options.searchSemantic === 'string') {
        await searchSemanticCommand(options.searchSemantic, {
          dataDir: options.dataDir,
          format: options.searchFormat,
          limit: options.searchLimit
        });
        return;
      }

      if (!url) {
        program.outputHelp();
        return;
      }

      await evaluateCommand(url, {
        out: options.output,
        format: 'both',
        crawlDepth: 0,
        maxUrls: 1,
        engine: 'http',
        render: false,
        checkLinks: false,
        checkApi: false,
        allowPrivate: false,
        http2: false,
        persist: true,
        apiKey: options.apiKey,
        pdf: options.pdf
      });
    });

  await program.parseAsync(process.argv);
}

export async function searchSemanticCommand(
  rawQuery: string,
  rawOptions: SearchSemanticOptions = {}
): Promise<void> {
  const query = rawQuery.trim();
  if (!query) {
    console.error('Semantic search query is required.');
    process.exitCode = 1;
    return;
  }

  const limit = parseSearchLimit(rawOptions.limit);
  const format = parseSearchFormat(rawOptions.format);
  const createStore = rawOptions.createStore ?? createOntologyStore;
  const rootDir = typeof rawOptions.dataDir === 'string' && rawOptions.dataDir.trim()
    ? rawOptions.dataDir
    : process.env.STEALTH_LIGHTBEACON_DATA_DIR ?? join(process.cwd(), '.data');
  const store = await createStore({ rootDir });

  try {
    const hits = await store.search(query, limit);
    if (format === 'llm') {
      console.log(formatSearchResultsForLlm(query, limit, hits));
      return;
    }

    console.log(JSON.stringify({ query, limit, hits }));
  } finally {
    await store.close();
  }
}

function parseSearchLimit(rawLimit: unknown): number {
  const limit = Number(rawLimit ?? DEFAULT_SEARCH_LIMIT);
  if (!Number.isInteger(limit) || limit < 1) {
    return DEFAULT_SEARCH_LIMIT;
  }
  return limit;
}

function parseSearchFormat(rawFormat: unknown): 'json' | 'llm' {
  return rawFormat === 'llm' ? 'llm' : 'json';
}

function formatSearchResultsForLlm(query: string, limit: number, hits: OntologySearchResult[]): string {
  const lines = [
    `query: ${query}`,
    `limit: ${limit}`,
    `hits: ${hits.length}`
  ];

  for (const hit of hits) {
    const score = typeof hit.score === 'number' ? hit.score.toFixed(4) : 'n/a';
    lines.push(`- ${hit.kind} ${hit.label} score=${score} id=${hit.id}`);
    if (hit.url) {
      lines.push(`  url: ${hit.url}`);
    }
    lines.push(`  text: ${hit.text}`);
  }

  return lines.join('\n');
}

export async function evaluateCommand(rawUrl: string, rawOptions: Record<string, unknown>): Promise<void> {
  const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
  const options = loadRuntimeOptions({
    outputDir: rawOptions.out,
    format: rawOptions.format,
    crawlDepth: rawOptions.crawlDepth,
    maxUrls: rawOptions.maxUrls,
    render: rawOptions.render,
    engine: rawOptions.engine,
    budgetPath: rawOptions.budget,
    checkLinks: rawOptions.checkLinks,
    checkApi: rawOptions.checkApi,
    allowPrivate: rawOptions.allowPrivate,
    http2: rawOptions.http2,
    persist: rawOptions.persist,
    apiKey: rawOptions.apiKey,
    throttleMs: rawOptions.throttleMs,
    pdf: rawOptions.pdf
  });

  if (options.http2) {
    console.error('HTTP/2 transport is not supported yet; rerun without --http2.');
    process.exitCode = 1;
    return;
  }

  const spinner = ora(`Auditing ${url}`).start();
  let ontologyStore: Awaited<ReturnType<typeof createOntologyStore>> | undefined;
  let pageSpeedService: PageSpeedService | undefined;

  try {
    ontologyStore = !options.persist || process.env.STEALTH_LIGHTBEACON_ONTOLOGY === '0'
      ? undefined
      : await createOntologyStore({
        rootDir: process.env.STEALTH_LIGHTBEACON_DATA_DIR ?? join(process.cwd(), '.data')
      });

    const fetchPage = createFetchPage({
      allowPrivate: options.allowPrivate,
      engine: options.render ? 'rendered' : options.engine
    });
    mkdirSync(join(options.outputDir, '.cache'), { recursive: true });
    pageSpeedService = new PageSpeedService({
      cachePath: join(options.outputDir, '.cache', 'pagespeed.duckdb')
    });
    const evaluators = createDefaultEvaluators();
    const guard = new SSRFGuard({ allowPrivate: options.allowPrivate });
    const reconRecommendation = rawOptions.reconAuto
      ? await new PreAuditRecon(guard).analyze(url)
      : undefined;
    const auditOptions = reconRecommendation
      ? applyReconRecommendation(options, reconRecommendation)
      : options;

    let robotsContent: string | undefined = undefined;
    try {
      const robotsUrl = new URL('/robots.txt', url).toString();
      const robotsResponse = await secureFetch(robotsUrl, { method: 'GET', guard });
      if (robotsResponse.ok) {
        robotsContent = await robotsResponse.text();
      }
    } catch {
      // Ignore robots.txt load error
    }

    const report = await runAudit({
      targetUrl: url,
      options: auditOptions,
      fetchPage,
      evaluators,
      persistence: ontologyStore,
      enrichContext: async (page) => {
        const auxiliaryResponses: Record<string, { status: number; body: string }> = {};
        if (options.checkApi) {
          const jsonApiUrl = new URL('/jsonapi/user/user', page.url).toString();
          try {
            const response = await secureFetch(jsonApiUrl, { method: 'GET', guard });
            auxiliaryResponses.jsonApiUser = {
              status: response.status,
              body: await response.text()
            };
          } catch {
            auxiliaryResponses.jsonApiUser = { status: 0, body: '' };
          }
        }

        const pageSpeed = await pageSpeedService!.getSummary(page.url, options.apiKey);
        return {
          auxiliaryResponses,
          pageSpeed: pageSpeed ?? undefined,
          robotsContent
        };
      }
    });

    if (reconRecommendation) {
      report.domains.push({
        id: 'recon',
        domain: 'recon',
        score: 10,
        issues: [],
        metadata: {
          recommendation: reconRecommendation
        }
      });
    }

    if (options.checkLinks) {
      const outboundFindings = await checkBrokenLinks(report.targetUrl, fetchPage);
      const seoDomain = report.domains.find((domain) => domain.id === 'seo');
      if (seoDomain && outboundFindings.length > 0) {
        seoDomain.issues.push(
          ...outboundFindings.map((finding) => ({
            id: 'R-SEO-BROKEN-LINK',
            severity: 'warning' as const,
            message: `Broken outbound link: ${finding}`,
            location: 'Anchor href',
            remedy: 'Fix or remove the broken link.'
          }))
        );
      }
    }

    const reporter = new Reporter(options.outputDir);
    const outputs: string[] = [];
    if (options.reportFormat === 'json' || options.reportFormat === 'both') {
      outputs.push(reporter.writeJson(report));
    }
    if (options.reportFormat === 'html' || options.reportFormat === 'both') {
      outputs.push(reporter.writeHtml(report));
      if (options.pdf) {
        const pdfPath = await reporter.writePdf(report);
        if (pdfPath) {
          outputs.push(pdfPath);
        }
      }
    }
    if (options.reportFormat === 'llm') {
      outputs.push(reporter.writeLlm(report));
    }
    if (options.reportFormat === 'geo-xml') {
      outputs.push(reporter.writeGeoXml(report));
    }

    if (options.budgetPath) {
      const budgetConfig = JSON.parse(readFileSync(options.budgetPath, 'utf8')) as Record<string, unknown>;
      const failures = validateBudgets(report, budgetConfig);
      if (failures.length > 0) {
        spinner.fail('Audit completed with budget failures');
        for (const failure of failures) {
          console.error(`- ${failure}`);
        }
        process.exitCode = 2;
        return;
      }
    }

    spinner.succeed(`Audit complete for ${url}`);
    for (const output of outputs) {
      console.log(output);
    }
  } catch (error) {
    spinner.fail(`Audit failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    await pageSpeedService?.close();
    await ontologyStore?.close();
    await BrowserPool.getInstance().close();
  }
}

export async function reconCommand(rawUrl: string, rawOptions: Record<string, unknown>): Promise<void> {
  const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
  const guard = new SSRFGuard({ allowPrivate: Boolean(rawOptions.allowPrivate) });
  const fetchFn = typeof rawOptions.fetchFn === 'function'
    ? rawOptions.fetchFn as typeof secureFetch
    : undefined;
  const result = await new PreAuditRecon(guard, fetchFn).analyze(url);
  console.log(JSON.stringify(result));
}

export function applyReconRecommendation(
  options: RuntimeOptions,
  recommendation: ReconRecommendation
): RuntimeOptions & { reconRecommendation: ReconRecommendation } {
  return {
    ...options,
    engine: recommendation.recommendedEngine,
    throttleMs: recommendation.recommendedThrottleMs,
    reconRecommendation: recommendation
  };
}

export async function checkBrokenLinks(
  startUrl: string,
  fetchPage: (url: string) => Promise<{ url: string; html: string; headers: Record<string, string | string[] | undefined>; status: number; responseTimeMs: number }>
): Promise<string[]> {
  const page = await fetchPage(startUrl);
  const candidates = discoverBrokenLinks(page.html, page.url);
  const broken: string[] = [];

  for (const candidate of candidates) {
    try {
      const response = await fetchHttpPage(candidate, new SSRFGuard(), 'StealthLightbeaconNode/2.0');
      if (response.status >= 400) {
        broken.push(candidate);
      }
    } catch {
      broken.push(candidate);
    }
  }

  return broken;
}

if (require.main === module) {
  void main();
}
