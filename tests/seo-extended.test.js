/**
 * seo-extended.test.js
 * Covers branches not reached by seo.test.js:
 *  - Missing title (R-SEO-TITLE-MISS)
 *  - Title too long (R-SEO-TITLE-LEN)
 *  - Missing meta description (R-SEO-DESC-MISS)
 *  - Missing canonical (R-SEO-CAN-MISS)
 *  - Canonical hostname mismatch (R-SEO-CAN-MISMATCH)
 *  - Robots noindex meta (R-SEO-ROBOTS-NOINDEX)
 *  - Multiple H1 tags (R-SEO-H1-MULTI)
 *  - Missing OG title (R-SEO-OG-MISS)
 *  - Missing JSON-LD (R-SEO-LD-MISS)
 *  - JSON-LD invalid @context (R-SEO-LD-CTX-0)
 *  - JSON-LD missing @type (R-SEO-LD-TYPE-0)
 *  - JSON-LD malformed JSON (R-SEO-LD-PARSE-0)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function loadEvaluator() {
  const modulePath = path.join(__dirname, '..', 'dist', 'evaluators', 'seo.js');
  return import(pathToFileURL(modulePath).href);
}

/** Minimal valid HTML fixture — passes all non-targeted rules */
function validHtml({
  title = 'A Valid Twenty-Character Title',
  desc = 'A valid meta description that is long enough to pass the length check and not raise any warning at all, staying clearly within bounds.',
  canonical = 'https://example.com/',
  extra = '',
  h1 = '<h1>Heading</h1>',
} = {}) {
  return `<html><head>
    ${title !== null ? `<title>${title}</title>` : ''}
    ${desc !== null ? `<meta name="description" content="${desc}">` : ''}
    ${canonical !== null ? `<link rel="canonical" href="${canonical}">` : ''}
    <meta property="og:title" content="OG Title">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage"}</script>
    ${extra}
  </head><body>${h1}</body></html>`;
}

const BASE_CTX = {
  url: 'https://example.com/',
  headers: {},
  robotsContent: 'User-agent: *\nSitemap: https://example.com/sitemap.xml',
};

test('SeoEvaluator: flags missing title tag', async () => {
  const mod = await loadEvaluator();
  const ev = new mod.SeoEvaluator();
  const html = `<html><head>
    <meta name="description" content="A valid meta description long enough to not trigger the length warning, kept well within the 110-160 character range for this test.">
    <link rel="canonical" href="https://example.com/">
    <meta property="og:title" content="OG">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage"}</script>
  </head><body><h1>H</h1></body></html>`;

  const res = await ev.evaluate({ ...BASE_CTX, html });
  assert.ok(res.issues.find((i) => i.id === 'R-SEO-TITLE-MISS'), 'Expected R-SEO-TITLE-MISS');
});

test('SeoEvaluator: flags title length out of range', async () => {
  const mod = await loadEvaluator();
  const ev = new mod.SeoEvaluator();
  const longTitle = 'A'.repeat(70);
  const res = await ev.evaluate({ ...BASE_CTX, html: validHtml({ title: longTitle }) });
  assert.ok(res.issues.find((i) => i.id === 'R-SEO-TITLE-LEN'), 'Expected R-SEO-TITLE-LEN for long title');
});

test('SeoEvaluator: flags missing meta description', async () => {
  const mod = await loadEvaluator();
  const ev = new mod.SeoEvaluator();
  const html = `<html><head>
    <title>Valid Title Here</title>
    <link rel="canonical" href="https://example.com/">
    <meta property="og:title" content="OG">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage"}</script>
  </head><body><h1>H</h1></body></html>`;
  const res = await ev.evaluate({ ...BASE_CTX, html });
  assert.ok(res.issues.find((i) => i.id === 'R-SEO-DESC-MISS'), 'Expected R-SEO-DESC-MISS');
});

test('SeoEvaluator: flags missing canonical link', async () => {
  const mod = await loadEvaluator();
  const ev = new mod.SeoEvaluator();
  const res = await ev.evaluate({ ...BASE_CTX, html: validHtml({ canonical: null }) });
  assert.ok(res.issues.find((i) => i.id === 'R-SEO-CAN-MISS'), 'Expected R-SEO-CAN-MISS');
});

test('SeoEvaluator: flags canonical hostname mismatch', async () => {
  const mod = await loadEvaluator();
  const ev = new mod.SeoEvaluator();
  const res = await ev.evaluate({ ...BASE_CTX, html: validHtml({ canonical: 'https://other.com/' }) });
  assert.ok(res.issues.find((i) => i.id === 'R-SEO-CAN-MISMATCH'), 'Expected R-SEO-CAN-MISMATCH');
});

test('SeoEvaluator: flags robots meta noindex', async () => {
  const mod = await loadEvaluator();
  const ev = new mod.SeoEvaluator();
  const extra = '<meta name="robots" content="noindex, follow">';
  const res = await ev.evaluate({ ...BASE_CTX, html: validHtml({ extra }) });
  assert.ok(res.issues.find((i) => i.id === 'R-SEO-ROBOTS-NOINDEX'), 'Expected R-SEO-ROBOTS-NOINDEX');
});

test('SeoEvaluator: flags multiple H1 tags', async () => {
  const mod = await loadEvaluator();
  const ev = new mod.SeoEvaluator();
  const res = await ev.evaluate({ ...BASE_CTX, html: validHtml({ h1: '<h1>One</h1><h1>Two</h1>' }) });
  assert.ok(res.issues.find((i) => i.id === 'R-SEO-H1-MULTI'), 'Expected R-SEO-H1-MULTI');
});

test('SeoEvaluator: flags missing OG title', async () => {
  const mod = await loadEvaluator();
  const ev = new mod.SeoEvaluator();
  const html = `<html><head>
    <title>Valid Title Here</title>
    <meta name="description" content="A valid meta description long enough to not trigger the length warning, kept well within the 110-160 character range for this test.">
    <link rel="canonical" href="https://example.com/">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage"}</script>
  </head><body><h1>H</h1></body></html>`;
  const res = await ev.evaluate({ ...BASE_CTX, html });
  assert.ok(res.issues.find((i) => i.id === 'R-SEO-OG-MISS'), 'Expected R-SEO-OG-MISS');
});

test('SeoEvaluator: flags missing JSON-LD structured data', async () => {
  const mod = await loadEvaluator();
  const ev = new mod.SeoEvaluator();
  const html = `<html><head>
    <title>Valid Title Here</title>
    <meta name="description" content="A valid meta description long enough to not trigger the length warning, kept well within the 110-160 character range for this test.">
    <link rel="canonical" href="https://example.com/">
    <meta property="og:title" content="OG">
  </head><body><h1>H</h1></body></html>`;
  const res = await ev.evaluate({ ...BASE_CTX, html });
  assert.ok(res.issues.find((i) => i.id === 'R-SEO-LD-MISS'), 'Expected R-SEO-LD-MISS');
});

test('SeoEvaluator: flags JSON-LD with invalid @context', async () => {
  const mod = await loadEvaluator();
  const ev = new mod.SeoEvaluator();
  // Use a @context that does NOT contain the substring "schema.org"
  const html = `<html><head>
    <title>Valid Title Here</title>
    <meta name="description" content="A valid meta description long enough to not trigger the length warning, kept well within the 110-160 character range for this test.">
    <link rel="canonical" href="https://example.com/">
    <meta property="og:title" content="OG">
    <script type="application/ld+json">{"@context":"https://example.com/vocab","@type":"WebPage"}</script>
  </head><body><h1>H</h1></body></html>`;
  const res = await ev.evaluate({ ...BASE_CTX, html });
  assert.ok(res.issues.find((i) => i.id === 'R-SEO-LD-CTX-0'), 'Expected R-SEO-LD-CTX-0');
});

test('SeoEvaluator: flags JSON-LD block missing @type', async () => {
  const mod = await loadEvaluator();
  const ev = new mod.SeoEvaluator();
  const extra = `<script type="application/ld+json">{"@context":"https://schema.org"}</script>`;
  const html = `<html><head>
    <title>Valid Title Here</title>
    <meta name="description" content="A valid meta description long enough to not trigger the length warning, kept well within the 110-160 character range for this test.">
    <link rel="canonical" href="https://example.com/">
    <meta property="og:title" content="OG">
    ${extra}
  </head><body><h1>H</h1></body></html>`;
  const res = await ev.evaluate({ ...BASE_CTX, html });
  assert.ok(res.issues.find((i) => i.id === 'R-SEO-LD-TYPE-0'), 'Expected R-SEO-LD-TYPE-0');
});

test('SeoEvaluator: flags malformed JSON-LD', async () => {
  const mod = await loadEvaluator();
  const ev = new mod.SeoEvaluator();
  const extra = `<script type="application/ld+json">{THIS IS NOT JSON}</script>`;
  const html = `<html><head>
    <title>Valid Title Here</title>
    <meta name="description" content="A valid meta description long enough to not trigger the length warning, kept well within the 110-160 character range for this test.">
    <link rel="canonical" href="https://example.com/">
    <meta property="og:title" content="OG">
    ${extra}
  </head><body><h1>H</h1></body></html>`;
  const res = await ev.evaluate({ ...BASE_CTX, html });
  assert.ok(res.issues.find((i) => i.id === 'R-SEO-LD-PARSE-0'), 'Expected R-SEO-LD-PARSE-0');
});
