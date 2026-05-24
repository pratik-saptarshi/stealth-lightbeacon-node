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

test('DB schemas reject unknown fields and preserve strict envelopes', async () => {
  const mod = await loadModule(path.join('core', 'db', 'schemas.js'));

  const parsed = mod.duckDbQueryInputSchema.parse({
    params: { limit: 10 },
    sql: 'select $limit as limit'
  });

  assert.equal(parsed.sql, 'select $limit as limit');
  assert.throws(
    () =>
      mod.duckDbQueryInputSchema.parse({
        extra: true,
        sql: 'select 1'
      }),
    /unrecognized_keys/i
  );
});

test('runtime schema defaults to the hard timeout', async () => {
  const mod = await loadModule(path.join('core', 'db', 'runtime.js'));

  const parsed = mod.resolveDbRuntimeInput({});
  assert.equal(parsed.timeoutMs, 2000);

  const ctx = mod.createDbRuntimeContext({});
  assert.equal(ctx.timeoutMs, 2000);
  assert.equal(ctx.signal.aborted, false);
});

test('pageSpeedSummarySchema accepts lcpMs, clsScore, inpMs, ttfbMs (F-02)', async () => {
  const mod = await loadModule(path.join('core', 'db', 'schemas.js'));
  const result = mod.pageSpeedSummarySchema.parse({
    lighthousePerformanceScore: 85,
    lcpMs: 3200,
    clsScore: 0.12,
    inpMs: 250,
    ttfbMs: 900
  });
  assert.equal(result.lcpMs, 3200);
  assert.equal(result.clsScore, 0.12);
  assert.equal(result.inpMs, 250);
  assert.equal(result.ttfbMs, 900);
});

test('pageSpeedSummarySchema accepts missing optional CWV fields', async () => {
  const mod = await loadModule(path.join('core', 'db', 'schemas.js'));
  const result = mod.pageSpeedSummarySchema.parse({ lighthousePerformanceScore: 90 });
  assert.equal(result.lcpMs, undefined);
});

