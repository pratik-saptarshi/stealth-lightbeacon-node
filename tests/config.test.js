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

test('loadRuntimeOptions applies defaults and validates crawl settings', async () => {
  const mod = await loadModule(path.join('core', 'config.js'));
  assert.equal(typeof mod.loadRuntimeOptions, 'function');

  const options = mod.loadRuntimeOptions({
    format: 'both',
    crawlDepth: 2,
    maxUrls: 25,
    engine: 'http'
  });

  assert.equal(options.crawlDepth, 2);
  assert.equal(options.maxUrls, 25);
  assert.equal(options.reportFormat, 'both');
  assert.equal(options.engine, 'http');
  assert.equal(options.allowPrivate, false);
  assert.equal(options.checkLinks, false);
});

test('loadRuntimeOptions rejects unsupported report formats', async () => {
  const mod = await loadModule(path.join('core', 'config.js'));
  assert.equal(typeof mod.loadRuntimeOptions, 'function');

  assert.throws(
    () => mod.loadRuntimeOptions({ format: 'xml' }),
    /format/i
  );
});
