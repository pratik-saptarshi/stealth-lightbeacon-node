#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import ora from 'ora';
import { createDefaultEvaluators } from './core/defaultEvaluators';
import { createFetchPage, discoverBrokenLinks, fetchHttpPage } from './core/fetcher';
import { loadRuntimeOptions } from './core/config';
import { runAudit } from './core/orchestrator';
import { Reporter } from './core/reporter';
import { PageSpeedService } from './core/pagespeed';
import { validateBudgets } from './core/budget';
import { SSRFGuard } from './core/ssrf';
import { createOntologyStore } from './core/ontology';

const DEFAULT_OUTPUT_DIR = 'reports';

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('stealth-lightbeacon')
    .description('TypeScript crawl orchestration and multi-domain site auditing CLI with security checks, SEO, AEO, GEO, and performance reporting.')
    .version('2.0.0');

  program
    .command('evaluate')
    .argument('<url>', 'Target Drupal site URL')
    .option('-o, --out <dir>', 'Output directory', DEFAULT_OUTPUT_DIR)
    .option('-f, --format <format>', 'Report format: json, html, both', 'both')
    .option('-d, --crawl-depth <depth>', 'Crawl depth', '0')
    .option('-n, --max-urls <count>', 'Maximum crawled URLs', '10')
    .option('--render', 'Render JS via Playwright', false)
    .option('--engine <engine>', 'Fetch engine: http, rendered, fast, or stealth', 'http')
    .option('--http2', 'Reserved flag for HTTP/2 transport support', false)
    .option('--budget <path>', 'Budget configuration path')
    .option('--check-links', 'Check discovered outbound links', false)
    .option('--check-api', 'Probe Drupal JSON:API user endpoint', false)
    .option('--allow-private', 'Allow private or loopback targets', false)
    .option('--api-key <key>', 'Google PageSpeed Insights API key')
    .option('--no-pdf', 'Skip PDF output')
    .action(async (url: string, options: Record<string, unknown>) => {
      await evaluateCommand(url, options);
    });

  program
    .argument('[url]', 'Compatibility mode target URL')
    .option('-o, --output <dir>', 'Output directory', DEFAULT_OUTPUT_DIR)
    .option('-k, --api-key <key>', 'Google PageSpeed Insights API key')
    .option('--no-pdf', 'Skip PDF generation')
    .action(async (url: string | undefined, options: Record<string, unknown>) => {
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
        apiKey: options.apiKey,
        pdf: options.pdf
      });
    });

  await program.parseAsync(process.argv);
}

async function evaluateCommand(rawUrl: string, rawOptions: Record<string, unknown>): Promise<void> {
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
    apiKey: rawOptions.apiKey,
    pdf: rawOptions.pdf
  });

  const spinner = ora(`Auditing ${url}`).start();
  let ontologyStore: Awaited<ReturnType<typeof createOntologyStore>> | undefined;
  let pageSpeedService: PageSpeedService | undefined;

  try {
    ontologyStore = process.env.STEALTH_LIGHTBEACON_ONTOLOGY === '0'
      ? undefined
      : await createOntologyStore({
        rootDir: process.env.STEALTH_LIGHTBEACON_DATA_DIR ?? join(process.cwd(), '.data')
      });

    const fetchPage = createFetchPage({
      allowPrivate: options.allowPrivate,
      engine: options.render ? 'rendered' : options.engine
    });
    pageSpeedService = new PageSpeedService({
      cachePath: join(options.outputDir, '.cache', 'pagespeed.duckdb')
    });
    const evaluators = createDefaultEvaluators();
    const guard = new SSRFGuard({ allowPrivate: options.allowPrivate });

    let robotsContent: string | undefined = undefined;
    try {
      const robotsUrl = new URL('/robots.txt', url).toString();
      await guard.validate(robotsUrl);
      const robotsResponse = await fetch(robotsUrl, { method: 'GET', redirect: 'follow' });
      if (robotsResponse.ok) {
        robotsContent = await robotsResponse.text();
      }
    } catch {
      // Ignore robots.txt load error
    }

    const report = await runAudit({
      targetUrl: url,
      options,
      fetchPage,
      evaluators,
      persistence: ontologyStore,
      enrichContext: async (page) => {
        const auxiliaryResponses: Record<string, { status: number; body: string }> = {};
        if (options.checkApi) {
          const jsonApiUrl = new URL('/jsonapi/user/user', page.url).toString();
          await guard.validate(jsonApiUrl);
          try {
            const response = await fetch(jsonApiUrl, { method: 'GET', redirect: 'follow' });
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
  }
}

async function checkBrokenLinks(
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

void main();
