const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function loadModule(relativePath) {
  const fullPath = path.join(__dirname, '..', 'dist', relativePath);
  try {
    return await import(pathToFileURL(fullPath).href);
  } catch (error) {
    assert.fail(`Failed to load ${relativePath}: ${error.message}`);
  }
}

const baseCtx = (overrides = {}) => ({
  url: 'https://example.com/',
  html: '<html><head><link rel="stylesheet" href="css_123.css"></head><body><script src="js_123.js"></script></body></html>',
  headers: { 'x-drupal-cache': 'HIT' },
  status: 200,
  responseTimeMs: 100,
  ...overrides
});

test('R-PERF-TTFB: critical when responseTimeMs >= 600', async () => {
  const { PerformanceEvaluator } = await loadModule('evaluators/performance.js');
  const ev = new PerformanceEvaluator();
  const result = await ev.evaluate(baseCtx({ responseTimeMs: 650 }));
  assert.ok(result.issues.some(i => i.id === 'R-PERF-TTFB' && i.severity === 'critical'));
});

test('R-PERF-TTFB: warning when responseTimeMs >= 200 and < 600', async () => {
  const { PerformanceEvaluator } = await loadModule('evaluators/performance.js');
  const ev = new PerformanceEvaluator();
  const result = await ev.evaluate(baseCtx({ responseTimeMs: 250 }));
  assert.ok(result.issues.some(i => i.id === 'R-PERF-TTFB' && i.severity === 'warning'));
});

test('R-PERF-CACHE-MISS: fires when no x-drupal-cache HIT header', async () => {
  const { PerformanceEvaluator } = await loadModule('evaluators/performance.js');
  const ev = new PerformanceEvaluator();
  const result = await ev.evaluate(baseCtx({ headers: {} }));
  assert.ok(result.issues.some(i => i.id === 'R-PERF-CACHE-MISS' && i.severity === 'critical'));
});

test('No cache miss when x-drupal-cache is HIT or x-varnish present', async () => {
  const { PerformanceEvaluator } = await loadModule('evaluators/performance.js');
  const ev = new PerformanceEvaluator();
  const resultHit = await ev.evaluate(baseCtx({ headers: { 'x-drupal-cache': 'HIT' } }));
  assert.ok(!resultHit.issues.some(i => i.id === 'R-PERF-CACHE-MISS'));
  
  const resultVarnish = await ev.evaluate(baseCtx({ headers: { 'x-varnish': '12345' } }));
  assert.ok(!resultVarnish.issues.some(i => i.id === 'R-PERF-CACHE-MISS'));
});

test('R-PERF-AGGREGATION: fires when no aggregated css or js', async () => {
  const { PerformanceEvaluator } = await loadModule('evaluators/performance.js');
  const ev = new PerformanceEvaluator();
  const result = await ev.evaluate(baseCtx({ html: '<html><body></body></html>' }));
  assert.ok(result.issues.some(i => i.id === 'R-PERF-AGGREGATION'));
});

test('R-PERF-IMAGES: fires when legacy jpg/png images present', async () => {
  const { PerformanceEvaluator } = await loadModule('evaluators/performance.js');
  const ev = new PerformanceEvaluator();
  const result = await ev.evaluate(baseCtx({
    html: '<html><body><img src="test.jpg"><img src="test.png"><img src="test.gif"></body></html>'
  }));
  assert.ok(result.issues.some(i => i.id === 'R-PERF-IMAGES'));
});

test('R-PERF-LCP-CRIT: fires when pageSpeed.lcpMs > 4000', async () => {
  const { PerformanceEvaluator } = await loadModule('evaluators/performance.js');
  const ev = new PerformanceEvaluator();
  const result = await ev.evaluate(baseCtx({
    pageSpeed: { lighthousePerformanceScore: 85, lcpMs: 5000 }
  }));
  assert.ok(result.issues.some(i => i.id === 'R-PERF-LCP-CRIT' && i.severity === 'critical'));
});

test('R-PERF-LCP-WARN: fires when pageSpeed.lcpMs between 2500 and 4000', async () => {
  const { PerformanceEvaluator } = await loadModule('evaluators/performance.js');
  const ev = new PerformanceEvaluator();
  const result = await ev.evaluate(baseCtx({
    pageSpeed: { lighthousePerformanceScore: 85, lcpMs: 3000 }
  }));
  assert.ok(result.issues.some(i => i.id === 'R-PERF-LCP-WARN' && i.severity === 'warning'));
});

test('No LCP issues when lcpMs < 2500', async () => {
  const { PerformanceEvaluator } = await loadModule('evaluators/performance.js');
  const ev = new PerformanceEvaluator();
  const result = await ev.evaluate(baseCtx({
    pageSpeed: { lighthousePerformanceScore: 85, lcpMs: 2000 }
  }));
  assert.ok(!result.issues.some(i => i.id.startsWith('R-PERF-LCP')));
});

test('R-PERF-CLS-CRIT: fires when pageSpeed.clsScore > 0.25', async () => {
  const { PerformanceEvaluator } = await loadModule('evaluators/performance.js');
  const ev = new PerformanceEvaluator();
  const result = await ev.evaluate(baseCtx({
    pageSpeed: { lighthousePerformanceScore: 85, clsScore: 0.3 }
  }));
  assert.ok(result.issues.some(i => i.id === 'R-PERF-CLS-CRIT' && i.severity === 'critical'));
});

test('R-PERF-CLS-WARN: fires when pageSpeed.clsScore 0.1 to 0.25', async () => {
  const { PerformanceEvaluator } = await loadModule('evaluators/performance.js');
  const ev = new PerformanceEvaluator();
  const result = await ev.evaluate(baseCtx({
    pageSpeed: { lighthousePerformanceScore: 85, clsScore: 0.15 }
  }));
  assert.ok(result.issues.some(i => i.id === 'R-PERF-CLS-WARN' && i.severity === 'warning'));
});

test('R-PERF-INP-CRIT: fires when pageSpeed.inpMs > 500', async () => {
  const { PerformanceEvaluator } = await loadModule('evaluators/performance.js');
  const ev = new PerformanceEvaluator();
  const result = await ev.evaluate(baseCtx({
    pageSpeed: { lighthousePerformanceScore: 85, inpMs: 600 }
  }));
  assert.ok(result.issues.some(i => i.id === 'R-PERF-INP-CRIT' && i.severity === 'critical'));
});

test('R-PERF-INP-WARN: fires when pageSpeed.inpMs 200 to 500', async () => {
  const { PerformanceEvaluator } = await loadModule('evaluators/performance.js');
  const ev = new PerformanceEvaluator();
  const result = await ev.evaluate(baseCtx({
    pageSpeed: { lighthousePerformanceScore: 85, inpMs: 300 }
  }));
  assert.ok(result.issues.some(i => i.id === 'R-PERF-INP-WARN' && i.severity === 'warning'));
});

test('R-PERF-LIGHTHOUSE: fires when score < 90', async () => {
  const { PerformanceEvaluator } = await loadModule('evaluators/performance.js');
  const ev = new PerformanceEvaluator();
  const result = await ev.evaluate(baseCtx({
    pageSpeed: { lighthousePerformanceScore: 45 }
  }));
  assert.ok(result.issues.some(i => i.id === 'R-PERF-LIGHTHOUSE' && i.severity === 'critical'));
});
