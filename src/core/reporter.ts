import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Handlebars = require('handlebars');
import type { AuditReport } from './types';

export interface PdfRenderer {
  render(html: string, outputPath: string): Promise<void>;
}

type BrowserPdfPage = {
  setContent(html: string, options: Record<string, unknown>): Promise<void>;
  pdf(options: Record<string, unknown>): Promise<unknown>;
};

type BrowserPdfBrowser = {
  newPage(): Promise<BrowserPdfPage>;
  close(): Promise<void>;
};

type PlaywrightModule = {
  chromium?: {
    launch(options: Record<string, unknown>): Promise<BrowserPdfBrowser>;
  };
  default?: PlaywrightModule;
};

export class Reporter {
  constructor(
    private readonly outputDir: string,
    private readonly pdfRenderer: PdfRenderer = new BrowserPdfRenderer()
  ) {}

  writeJson(report: AuditReport): string {
    mkdirSync(this.outputDir, { recursive: true });
    const outputPath = join(this.outputDir, 'report.json');
    writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');
    return outputPath;
  }

  writeHtml(report: AuditReport): string {
    mkdirSync(this.outputDir, { recursive: true });
    const outputPath = join(this.outputDir, 'report.html');
    const html = this.renderHtml(report);
    writeFileSync(outputPath, html, 'utf8');
    return outputPath;
  }

  async writePdf(report: AuditReport): Promise<string | null> {
    mkdirSync(this.outputDir, { recursive: true });
    const html = this.renderHtml(report);
    writeFileSync(join(this.outputDir, 'report.html'), html, 'utf8');
    const outputPath = join(this.outputDir, 'report.pdf');

    try {
      await this.pdfRenderer.render(html, outputPath);
      return outputPath;
    } catch {
      return null;
    }
  }

  private renderHtml(report: AuditReport): string {
    return Handlebars.compile(DEFAULT_REPORT_TEMPLATE)({
      report,
      generatedAt: new Date().toISOString(),
      summary: summarize(report)
    });
  }
}

class BrowserPdfRenderer implements PdfRenderer {
  async render(html: string, outputPath: string): Promise<void> {
    const playwrightModule = await importOptional<PlaywrightModule>('playwright-core');
    const chromium = playwrightModule?.chromium ?? playwrightModule?.default?.chromium;

    if (!chromium) {
      throw new Error("PDF generation requires the 'playwright-core' package and a Chromium executable.");
    }

    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROME_BIN
    });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle' });
      await page.pdf(pdfOptions(outputPath));
    } finally {
      await browser.close();
    }
  }
}

function pdfOptions(outputPath: string): Record<string, unknown> {
  return {
    path: outputPath,
    format: 'A4',
    margin: {
      top: '12mm',
      right: '12mm',
      bottom: '12mm',
      left: '12mm'
    },
    printBackground: true
  };
}

async function importOptional<T>(packageName: string): Promise<T | null> {
  try {
    return await new Function('packageName', 'return import(packageName)')(packageName) as T;
  } catch {
    return null;
  }
}

export function summarize(report: AuditReport): { totalIssues: number; critical: number; warning: number; info: number; averageScore: number } {
  const allIssues = report.domains.flatMap((domain) => domain.issues);
  const totalScore = report.domains.reduce((sum, domain) => sum + domain.score, 0);

  return {
    totalIssues: allIssues.length,
    critical: allIssues.filter((issue) => issue.severity === 'critical').length,
    warning: allIssues.filter((issue) => issue.severity === 'warning').length,
    info: allIssues.filter((issue) => issue.severity === 'info').length,
    averageScore: report.domains.length > 0 ? Number((totalScore / report.domains.length).toFixed(1)) : 0
  };
}

const DEFAULT_REPORT_TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Drupal Audit Report</title>
    <style>
      :root {
        --bg: #f5f3ed;
        --panel: #fffdf8;
        --ink: #1f1b16;
        --muted: #6d655d;
        --border: #d4c9bb;
        --critical: #b63f2f;
        --warning: #b27a12;
        --info: #346b9a;
      }
      body { margin: 0; padding: 32px; font-family: Georgia, "Times New Roman", serif; background: radial-gradient(circle at top, #efe7d9, var(--bg)); color: var(--ink); }
      .shell { max-width: 1080px; margin: 0 auto; display: grid; gap: 20px; }
      .panel { background: var(--panel); border: 1px solid var(--border); border-radius: 18px; padding: 24px; box-shadow: 0 18px 60px rgba(52, 40, 26, 0.08); }
      h1, h2, h3 { margin: 0 0 12px; }
      .meta, .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
      .stat { padding: 16px; border-radius: 14px; background: rgba(36, 79, 61, 0.06); }
      .issue { border-top: 1px solid var(--border); padding-top: 12px; margin-top: 12px; }
      .critical { color: var(--critical); }
      .warning { color: var(--warning); }
      .info { color: var(--info); }
      .muted { color: var(--muted); }
      code { font-family: "SFMono-Regular", Consolas, monospace; }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="panel">
        <h1>Drupal Audit Report</h1>
        <div class="meta">
          <div class="stat"><strong>Target</strong><div>{{report.targetUrl}}</div></div>
          <div class="stat"><strong>Generated</strong><div>{{generatedAt}}</div></div>
          <div class="stat"><strong>Crawled Pages</strong><div>{{report.crawledPagesCount}}</div></div>
          <div class="stat"><strong>Average Score</strong><div>{{summary.averageScore}} / 10</div></div>
        </div>
      </section>
      <section class="panel">
        <h2>Summary</h2>
        <div class="summary">
          <div class="stat"><strong>Total Issues</strong><div>{{summary.totalIssues}}</div></div>
          <div class="stat"><strong>Critical</strong><div class="critical">{{summary.critical}}</div></div>
          <div class="stat"><strong>Warnings</strong><div class="warning">{{summary.warning}}</div></div>
          <div class="stat"><strong>Info</strong><div class="info">{{summary.info}}</div></div>
        </div>
      </section>
      {{#each report.domains}}
        <section class="panel">
          <h2>{{domain}}</h2>
          <p class="muted">Domain ID: <code>{{id}}</code> | Score: {{score}} / 10</p>
          {{#if issues.length}}
            {{#each issues}}
              <div class="issue">
                <h3 class="{{severity}}">{{id}} · {{severity}}</h3>
                <p>{{message}}</p>
                <p class="muted">Location: {{location}}</p>
                <p><strong>Recommended action:</strong> {{remedy}}</p>
              </div>
            {{/each}}
          {{else}}
            <p>No issues detected for this domain.</p>
          {{/if}}
        </section>
      {{/each}}
    </main>
  </body>
</html>`;
