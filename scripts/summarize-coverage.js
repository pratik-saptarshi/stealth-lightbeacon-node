#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function usage() {
  console.log('Usage: node scripts/summarize-coverage.js <out_base> [domain ...]');
  console.log('Example: node scripts/summarize-coverage.js .tmp/reports/external prudential.com empower.com');
}

const outBase = process.argv[2];
if (!outBase || outBase === '--help') {
  usage();
  process.exit(outBase ? 0 : 1);
}

let domains = process.argv.slice(3);
if (domains.length === 0) {
  domains = fs
    .readdirSync(outBase, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

const rows = [];

for (const domain of domains) {
  const reportPath = path.join(outBase, domain, 'report.json');
  const row = {
    domain,
    reportPath,
    targetUrl: `https://${domain}`,
    crawledPages: 0,
    brokenPages: 0,
    discoveredUrls: 0,
    discoveredCoveragePct: 0,
    sitemapUrlCount: null,
    sitemapCoveragePct: null,
    domainsScored: 0,
    status: 'ok',
    error: ''
  };

  try {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    row.targetUrl = report.targetUrl || row.targetUrl;
    row.crawledPages = Number(report.crawledPagesCount || 0);
    row.brokenPages = Object.keys(report.brokenPages || {}).length;
    row.discoveredUrls = row.crawledPages + row.brokenPages;
    row.discoveredCoveragePct =
      row.discoveredUrls > 0 ? pct(row.crawledPages / row.discoveredUrls) : 0;
    row.domainsScored = Array.isArray(report.domains) ? report.domains.length : 0;

    const sitemapCount = fetchSitemapCount(row.targetUrl);
    if (sitemapCount !== null) {
      row.sitemapUrlCount = sitemapCount;
      row.sitemapCoveragePct =
        sitemapCount > 0 ? pct(row.crawledPages / sitemapCount) : null;
    }
  } catch (error) {
    row.status = 'error';
    row.error = error instanceof Error ? error.message : String(error);
  }

  rows.push(row);
}

console.log(JSON.stringify(rows, null, 2));
console.log('');
console.log(
  [
    'domain',
    'status',
    'crawledPages',
    'brokenPages',
    'discoveredUrls',
    'discoveredCoveragePct',
    'sitemapUrlCount',
    'sitemapCoveragePct',
    'domainsScored',
    'reportPath',
    'error'
  ].join(',')
);

for (const row of rows) {
  console.log(
    [
      row.domain,
      row.status,
      row.crawledPages,
      row.brokenPages,
      row.discoveredUrls,
      formatNum(row.discoveredCoveragePct),
      row.sitemapUrlCount === null ? '' : row.sitemapUrlCount,
      row.sitemapCoveragePct === null ? '' : formatNum(row.sitemapCoveragePct),
      row.domainsScored,
      csvEscape(row.reportPath),
      csvEscape(row.error)
    ].join(',')
  );
}

function pct(value) {
  return Number((value * 100).toFixed(2));
}

function formatNum(value) {
  return Number.isFinite(value) ? value.toFixed(2) : '';
}

function csvEscape(value) {
  const s = String(value || '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function fetchSitemapCount(targetUrl) {
  try {
    const url = new URL('/sitemap.xml', targetUrl).toString();
    const xml = execFileSync('curl', ['-Ls', '--max-time', '20', url], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    if (!xml || !xml.trim()) {
      return null;
    }

    const locMatches = xml.match(/<loc>/g);
    if (!locMatches) {
      return null;
    }
    return locMatches.length;
  } catch {
    return null;
  }
}

