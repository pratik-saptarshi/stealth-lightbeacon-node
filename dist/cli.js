#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const commander_1 = require("commander");
const ora_1 = __importDefault(require("ora"));
const defaultEvaluators_1 = require("./core/defaultEvaluators");
const fetcher_1 = require("./core/fetcher");
const config_1 = require("./core/config");
const orchestrator_1 = require("./core/orchestrator");
const reporter_1 = require("./core/reporter");
const pagespeed_1 = require("./core/pagespeed");
const budget_1 = require("./core/budget");
const ssrf_1 = require("./core/ssrf");
const ontology_1 = require("./core/ontology");
const DEFAULT_OUTPUT_DIR = 'reports';
async function main() {
    const program = new commander_1.Command();
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
        .action(async (url, options) => {
        await evaluateCommand(url, options);
    });
    program
        .argument('[url]', 'Compatibility mode target URL')
        .option('-o, --output <dir>', 'Output directory', DEFAULT_OUTPUT_DIR)
        .option('-k, --api-key <key>', 'Google PageSpeed Insights API key')
        .option('--no-pdf', 'Skip PDF generation')
        .action(async (url, options) => {
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
async function evaluateCommand(rawUrl, rawOptions) {
    const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
    const options = (0, config_1.loadRuntimeOptions)({
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
    const spinner = (0, ora_1.default)(`Auditing ${url}`).start();
    let ontologyStore;
    let pageSpeedService;
    try {
        ontologyStore = process.env.STEALTH_LIGHTBEACON_ONTOLOGY === '0'
            ? undefined
            : await (0, ontology_1.createOntologyStore)({
                rootDir: process.env.STEALTH_LIGHTBEACON_DATA_DIR ?? (0, node_path_1.join)(process.cwd(), '.data')
            });
        const fetchPage = (0, fetcher_1.createFetchPage)({
            allowPrivate: options.allowPrivate,
            engine: options.render ? 'rendered' : options.engine
        });
        pageSpeedService = new pagespeed_1.PageSpeedService({
            cachePath: (0, node_path_1.join)(options.outputDir, '.cache', 'pagespeed.duckdb')
        });
        const evaluators = (0, defaultEvaluators_1.createDefaultEvaluators)();
        const guard = new ssrf_1.SSRFGuard({ allowPrivate: options.allowPrivate });
        let robotsContent = undefined;
        try {
            const robotsUrl = new URL('/robots.txt', url).toString();
            await guard.validate(robotsUrl);
            const robotsResponse = await fetch(robotsUrl, { method: 'GET', redirect: 'follow' });
            if (robotsResponse.ok) {
                robotsContent = await robotsResponse.text();
            }
        }
        catch {
            // Ignore robots.txt load error
        }
        const report = await (0, orchestrator_1.runAudit)({
            targetUrl: url,
            options,
            fetchPage,
            evaluators,
            persistence: ontologyStore,
            enrichContext: async (page) => {
                const auxiliaryResponses = {};
                if (options.checkApi) {
                    const jsonApiUrl = new URL('/jsonapi/user/user', page.url).toString();
                    await guard.validate(jsonApiUrl);
                    try {
                        const response = await fetch(jsonApiUrl, { method: 'GET', redirect: 'follow' });
                        auxiliaryResponses.jsonApiUser = {
                            status: response.status,
                            body: await response.text()
                        };
                    }
                    catch {
                        auxiliaryResponses.jsonApiUser = { status: 0, body: '' };
                    }
                }
                const pageSpeed = await pageSpeedService.getSummary(page.url, options.apiKey);
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
                seoDomain.issues.push(...outboundFindings.map((finding) => ({
                    id: 'R-SEO-BROKEN-LINK',
                    severity: 'warning',
                    message: `Broken outbound link: ${finding}`,
                    location: 'Anchor href',
                    remedy: 'Fix or remove the broken link.'
                })));
            }
        }
        const reporter = new reporter_1.Reporter(options.outputDir);
        const outputs = [];
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
            const budgetConfig = JSON.parse((0, node_fs_1.readFileSync)(options.budgetPath, 'utf8'));
            const failures = (0, budget_1.validateBudgets)(report, budgetConfig);
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
    }
    catch (error) {
        spinner.fail(`Audit failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
    }
    finally {
        await pageSpeedService?.close();
        await ontologyStore?.close();
    }
}
async function checkBrokenLinks(startUrl, fetchPage) {
    const page = await fetchPage(startUrl);
    const candidates = (0, fetcher_1.discoverBrokenLinks)(page.html, page.url);
    const broken = [];
    for (const candidate of candidates) {
        try {
            const response = await (0, fetcher_1.fetchHttpPage)(candidate, new ssrf_1.SSRFGuard(), 'StealthLightbeaconNode/2.0');
            if (response.status >= 400) {
                broken.push(candidate);
            }
        }
        catch {
            broken.push(candidate);
        }
    }
    return broken;
}
void main();
