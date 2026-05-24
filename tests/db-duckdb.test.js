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

test('DuckDB runtime executes a simple query and returns JSON rows', async () => {
  const mod = await loadModule(path.join('core', 'db', 'duckdb.js'));
  const runtime = await mod.createDuckDbRuntime({
    databasePath: ':memory:',
    timeoutMs: 2000
  });

  try {
    const result = await runtime.query({
      sql: "select 1 as id, 'page' as label"
    });

    assert.deepEqual(result.columns, ['id', 'label']);
    assert.equal(result.rowCount, 1);
    assert.deepEqual(result.rows, [{ id: 1, label: 'page' }]);
  } finally {
    await runtime.close();
  }
});
