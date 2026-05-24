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

test('LanceDB runtime module loads without eager native initialization', async () => {
  const mod = await loadModule(path.join('core', 'db', 'lancedb.js'));

  assert.equal(typeof mod.createLanceDbRuntime, 'function');
});
