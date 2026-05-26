"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Reporter = void 0;
exports.summarize = summarize;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const Handlebars = require("handlebars");
class Reporter {
    outputDir;
    pdfRenderer;
    constructor(outputDir, pdfRenderer = new BrowserPdfRenderer()) {
        this.outputDir = outputDir;
        this.pdfRenderer = pdfRenderer;
    }
    writeJson(report) {
        (0, node_fs_1.mkdirSync)(this.outputDir, { recursive: true });
        const outputPath = (0, node_path_1.join)(this.outputDir, 'report.json');
        (0, node_fs_1.writeFileSync)(outputPath, JSON.stringify(report, null, 2), 'utf8');
        return outputPath;
    }
    writeLlm(report) {
        (0, node_fs_1.mkdirSync)(this.outputDir, { recursive: true });
        const outputPath = (0, node_path_1.join)(this.outputDir, 'report.llm.md');
        let md = `# Audit Report: ${report.targetUrl}\n\n`;
        const sum = summarize(report);
        md += `<summary>\n`;
        md += `- Total Issues: ${sum.totalIssues}\n`;
        md += `- Critical: ${sum.critical}\n`;
        md += `- Warning: ${sum.warning}\n`;
        md += `- Info: ${sum.info}\n`;
        md += `- Average Score: ${sum.averageScore}/10\n`;
        md += `</summary>\n\n`;
        for (const domain of report.domains) {
            md += `<domain id="${domain.id}" name="${domain.domain}" score="${domain.score}">\n`;
            if (domain.issues.length === 0) {
                md += `  No issues detected.\n`;
            }
            else {
                for (const issue of domain.issues) {
                    md += `  <issue id="${issue.id}" severity="${issue.severity}">\n`;
                    md += `    <message>${issue.message}</message>\n`;
                    md += `    <location>${issue.location}</location>\n`;
                    md += `    <remedy>${issue.remedy}</remedy>\n`;
                    md += `  </issue>\n`;
                }
            }
            md += `</domain>\n\n`;
        }
        (0, node_fs_1.writeFileSync)(outputPath, md, 'utf8');
        return outputPath;
    }
    writeGeoXml(report) {
        (0, node_fs_1.mkdirSync)(this.outputDir, { recursive: true });
        const outputPath = (0, node_path_1.join)(this.outputDir, 'report.xml');
        let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
        xml += `<audit_report target="${escapeXml(report.targetUrl)}">\n`;
        const sum = summarize(report);
        xml += `  <summary>\n`;
        xml += `    <total_issues>${sum.totalIssues}</total_issues>\n`;
        xml += `    <critical>${sum.critical}</critical>\n`;
        xml += `    <warning>${sum.warning}</warning>\n`;
        xml += `    <info>${sum.info}</info>\n`;
        xml += `    <average_score>${sum.averageScore}</average_score>\n`;
        xml += `  </summary>\n`;
        for (const domain of report.domains) {
            xml += `  <domain id="${escapeXml(domain.id)}" score="${domain.score}">\n`;
            xml += `    <name>${escapeXml(domain.domain)}</name>\n`;
            xml += `    <issues>\n`;
            for (const issue of domain.issues) {
                xml += `      <issue id="${escapeXml(issue.id)}" severity="${escapeXml(issue.severity)}">\n`;
                xml += `        <message>${escapeXml(issue.message)}</message>\n`;
                xml += `        <location>${escapeXml(issue.location)}</location>\n`;
                xml += `        <remedy>${escapeXml(issue.remedy)}</remedy>\n`;
                xml += `      </issue>\n`;
            }
            xml += `    </issues>\n`;
            xml += `  </domain>\n`;
        }
        xml += `</audit_report>\n`;
        (0, node_fs_1.writeFileSync)(outputPath, xml, 'utf8');
        return outputPath;
    }
    writeHtml(report) {
        (0, node_fs_1.mkdirSync)(this.outputDir, { recursive: true });
        const outputPath = (0, node_path_1.join)(this.outputDir, 'report.html');
        const html = this.renderHtml(report);
        (0, node_fs_1.writeFileSync)(outputPath, html, 'utf8');
        return outputPath;
    }
    async writePdf(report) {
        (0, node_fs_1.mkdirSync)(this.outputDir, { recursive: true });
        const html = this.renderHtml(report);
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(this.outputDir, 'report.html'), html, 'utf8');
        const outputPath = (0, node_path_1.join)(this.outputDir, 'report.pdf');
        try {
            await this.pdfRenderer.render(html, outputPath);
            return outputPath;
        }
        catch {
            return null;
        }
    }
    renderHtml(report) {
        return Handlebars.compile(DEFAULT_REPORT_TEMPLATE)({
            report,
            generatedAt: new Date().toISOString(),
            summary: summarize(report)
        });
    }
}
exports.Reporter = Reporter;
class BrowserPdfRenderer {
    async render(html, outputPath) {
        const playwrightModule = await importOptional('playwright-core');
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
        }
        finally {
            await browser.close();
        }
    }
}
function pdfOptions(outputPath) {
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
async function importOptional(packageName) {
    try {
        return await new Function('packageName', 'return import(packageName)')(packageName);
    }
    catch {
        return null;
    }
}
function summarize(report) {
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
function escapeXml(unsafe) {
    return unsafe.replace(/[<>&'"]/g, (c) => {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
            default: return c;
        }
    });
}
