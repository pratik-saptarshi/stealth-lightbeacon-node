const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');

async function loadModule(relativePath) {
  const modulePath = path.join(__dirname, '..', '..', 'dist', relativePath);
  try {
    return await import(pathToFileURL(modulePath).href);
  } catch (error) {
    assert.fail(`Failed to load ${relativePath}: ${error.message}`);
  }
}

test('Integration: full audit pipeline runs successfully against local mock HTTP server', async (t) => {
  // 1. Spin up ephemeral HTTP server
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (req.url === '/') {
      res.end(`
        <html>
          <head>
            <title>Home Page</title>
            <meta name="description" content="A very nice direct description of the homepage of our website that exceeds one hundred and ten characters so we do not trigger meta length errors.">
            <link rel="canonical" href="http://${req.headers.host}/">
            <script type="application/ld+json">{"@context": "https://schema.org", "@type": "WebPage"}</script>
          </head>
          <body>
            <h1>Home heading</h1>
            <a href="/about">About Us</a>
          </body>
        </html>
      `);
    } else if (req.url === '/about') {
      res.end(`
        <html>
          <head>
            <title>About Us Page</title>
            <meta name="description" content="A very nice direct description of the about page of our website that exceeds one hundred and ten characters so we do not trigger meta length errors.">
            <link rel="canonical" href="http://${req.headers.host}/about">
            <script type="application/ld+json">{"@context": "https://schema.org", "@type": "WebPage"}</script>
          </head>
          <body>
            <h1>About heading</h1>
            <p>We are a high performance Drupal team building TS ports.</p>
          </body>
        </html>
      `);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  const address = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(server.address());
    });
  });

  const baseUrl = `http://${address.address}:${address.port}/`;

  t.after(() => {
    server.close();
  });

  // 2. Load orchestrator and setup configs
  const orchestratorMod = await loadModule(path.join('core', 'orchestrator.js'));
  const configMod = await loadModule(path.join('core', 'config.js'));
  const fetcherMod = await loadModule(path.join('core', 'fetcher.ts'));
  const defaultEvaluatorsMod = await loadModule(path.join('core', 'defaultEvaluators.js'));

  const options = configMod.loadRuntimeOptions({
    outputDir: '.',
    format: 'json',
    crawlDepth: 1,
    maxUrls: 5,
    allowPrivate: true,
    concurrency: 2
  });

  const fetchPage = fetcherMod.createFetchPage({
    allowPrivate: true,
    engine: 'http'
  });

  const evaluators = defaultEvaluatorsMod.createDefaultEvaluators();

  // 3. Run audit
  const report = await orchestratorMod.runAudit({
    targetUrl: baseUrl,
    options,
    fetchPage,
    evaluators
  });

  // 4. Assert report details
  assert.equal(report.targetUrl, baseUrl);
  assert.ok(report.crawledPagesCount >= 2, `Expected crawledPagesCount >= 2, got ${report.crawledPagesCount}`);
  assert.ok(Array.isArray(report.domains));
  assert.ok(report.domains.length > 0);

  const seoDomain = report.domains.find(d => d.id === 'seo');
  assert.ok(seoDomain);
  assert.equal(typeof seoDomain.score, 'number');
});
