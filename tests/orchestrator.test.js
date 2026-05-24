const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function loadModule(relativePath) {
  const modulePath = path.join(__dirname, '..', 'dist', relativePath);
  try {
    return await import(pathToFileURL(modulePath).href);
  } catch (error) {
    assert.fail(`Failed to load ${relativePath}: ${error.message}`);
  }
}

test('runAudit aggregates crawled pages and evaluator results into a report', async () => {
  const mod = await loadModule(path.join('core', 'orchestrator.js'));
  assert.equal(typeof mod.runAudit, 'function');

  const report = await mod.runAudit({
    targetUrl: 'https://example.com/',
    options: {
      outputDir: '.',
      reportFormat: 'both',
      crawlDepth: 1,
      maxUrls: 2,
      render: false,
      engine: 'http',
      checkLinks: false,
      checkApi: false,
      allowPrivate: false,
      http2: false,
      pdf: false,
      concurrency: 2,
      throttleMs: 0
    },
    fetchPage: async (url) => {
      const fixtures = {
        'https://example.com/': '<html><body><a href="/about">About</a></body></html>',
        'https://example.com/about': '<html><body>About</body></html>'
      };

      return {
        url,
        html: fixtures[url],
        headers: {},
        status: 200,
        responseTimeMs: 125
      };
    },
    evaluators: [
      {
        id: 'stub',
        domain: 'Stub',
        async evaluate(context) {
          return {
            id: 'stub',
            domain: 'Stub',
            score: 8,
            issues: context.url.endsWith('/about')
              ? [{ id: 'STUB-1', severity: 'warning', message: 'About page issue', location: '/about', remedy: 'Fix it' }]
              : [],
            metadata: { page: context.url }
          };
        }
      }
    ]
  });

  assert.equal(report.targetUrl, 'https://example.com/');
  assert.equal(report.crawledPagesCount, 2);
  assert.equal(report.domains.length, 1);
  assert.equal(report.domains[0].score, 8);
  assert.equal(report.domains[0].issues.length, 1);
});
