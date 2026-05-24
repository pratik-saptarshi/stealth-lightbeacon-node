const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
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

test('db schemas apply strict validation and defaults', async () => {
  const mod = await loadModule(path.join('core', 'db', 'index.js'));

  const duckDbOptions = mod.duckDbRuntimeInputSchema.parse({});
  assert.equal(duckDbOptions.timeoutMs, 2000);
  assert.equal(duckDbOptions.threads, 2);

  assert.throws(
    () =>
      mod.lanceDbSearchInputSchema.parse({
        table: 'memory',
        vector: [0.1, 0.2],
        limit: 0
      }),
    /Too small/
  );
});

test('withTimeout rejects long-running work with a timeout error', async () => {
  const mod = await loadModule(path.join('core', 'db', 'index.js'));

  await assert.rejects(
    () =>
      mod.withHardTimeout(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 'late';
      }, { label: 'slow-operation', timeoutMs: 15 }),
    (error) => error.name === 'DbTimeoutError'
  );
});

test('DuckDB cache stores and expires entries through the schema gate', async () => {
  const mod = await loadModule(path.join('core', 'db', 'index.js'));
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stealth-lightbeacon-db-'));
  const cachePath = path.join(tmpDir, 'pagespeed.duckdb');
  const cache = new mod.DuckDbJsonCache(cachePath, mod.pageSpeedSummarySchema);

  const summary = {
    lighthousePerformanceScore: 91,
    cwv: {
      lcp: '1.2 s',
      inp: '120 ms',
      cls: '0.01'
    }
  };

  await cache.set('https://example.com/', summary);
  assert.deepEqual(await cache.get('https://example.com/', 24 * 60 * 60 * 1000), summary);
  assert.equal(await cache.get('https://example.com/', -1), null);
  await cache.close();
});
