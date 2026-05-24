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

test('BrowserPool returns the same browser instance on multiple calls', async () => {
  const mod = await loadModule(path.join('core', 'scraping', 'browserPool.js'));
  const pool = mod.BrowserPool.getInstance();

  const b1 = await pool.getBrowser();
  const b2 = await pool.getBrowser();

  assert.equal(b1, b2, 'Should share the exact same browser singleton process');
  await pool.close();
});
