const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function loadModule(relativePath) {
  const modulePath = path.join(__dirname, '..', '..', 'dist', relativePath);
  try {
    return await import(pathToFileURL(modulePath).href);
  } catch (error) {
    assert.fail(`Failed to load ${relativePath}: ${error.message}`);
  }
}

test('Integration: full audit pipeline runs successfully against deterministic crawl fixture', async () => {
  const baseUrl = 'https://fixture.test/';
  const pages = new Map([
    [baseUrl, `
      <html>
        <head>
          <title>Home Page</title>
          <meta name="description" content="A very nice direct description of the homepage of our website that exceeds one hundred and ten characters so we do not trigger meta length errors.">
          <link rel="canonical" href="${baseUrl}">
          <script type="application/ld+json">{"@context": "https://schema.org", "@type": "WebPage"}</script>
        </head>
        <body>
          <h1>Home heading</h1>
          <a href="/about">About Us</a>
        </body>
      </html>
    `],
    [`${baseUrl}sitemap.xml`, '<?xml version="1.0" encoding="UTF-8"?><urlset></urlset>'],
    [`${baseUrl}about`, `
      <html>
        <head>
          <title>About Us Page</title>
          <meta name="description" content="A very nice direct description of the about page of our website that exceeds one hundred and ten characters so we do not trigger meta length errors.">
          <link rel="canonical" href="${baseUrl}about">
          <script type="application/ld+json">{"@context": "https://schema.org", "@type": "WebPage"}</script>
        </head>
        <body>
          <h1>About heading</h1>
          <p>We are a high performance Drupal team building TypeScript ports.</p>
        </body>
      </html>
    `]
  ]);

  const orchestratorMod = await loadModule(path.join('core', 'orchestrator.js'));
  const configMod = await loadModule(path.join('core', 'config.js'));
  const defaultEvaluatorsMod = await loadModule(path.join('core', 'defaultEvaluators.js'));

  const options = configMod.loadRuntimeOptions({
    outputDir: '.',
    format: 'json',
    crawlDepth: 1,
    maxUrls: 5,
    allowPrivate: true,
    concurrency: 1
  });

  const fetchPage = async (url) => {
    const html = pages.get(url);
    return {
      url,
      html: html ?? 'Not found',
      headers: { 'content-type': 'text/html' },
      status: html ? 200 : 404,
      responseTimeMs: 5
    };
  };

  const report = await orchestratorMod.runAudit({
    targetUrl: baseUrl,
    options,
    fetchPage,
    evaluators: defaultEvaluatorsMod.createDefaultEvaluators()
  });

  assert.equal(report.targetUrl, baseUrl);
  assert.ok(report.crawledPagesCount >= 2, `Expected crawledPagesCount >= 2, got ${report.crawledPagesCount}`);
  assert.ok(Array.isArray(report.domains));
  assert.ok(report.domains.length > 0);

  const seoDomain = report.domains.find((domain) => domain.id === 'seo');
  assert.ok(seoDomain);
  assert.equal(typeof seoDomain.score, 'number');
});
