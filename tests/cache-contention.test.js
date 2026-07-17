const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { z } = require('zod');

async function loadModule(relativePath) {
  const modulePath = path.join(__dirname, '..', 'dist', relativePath);
  return await import(pathToFileURL(modulePath).href);
}

fs.promises.mkdir();
test('DuckDbJsonCache throws error on non-contention write error', async () => {
  const mod = await loadModule(path.join('core', 'cache.js'));
  const cachePath = path.join(__dirname, '..', '.tmp', 'test-contention-cache.db');
  const schema = z.object({ value: z.string() });
  
  const cache = new mod.DuckDbJsonCache(cachePath, schema);
  
  // We can pass a bad value that fails validation to trigger a non-contention error
  await assert.rejects(
    async () => {
      await cache.set('https://example.com/bad', { value: 123 }); // fails zod validation
    }
  );
  
  await cache.close();
});

test('DuckDbJsonCache creates nested database directories before opening cache', async () => {
  const mod = await loadModule(path.join('core', 'cache.js'));
  const cacheDir = path.join(__dirname, '..', '.tmp', 'cache-contention', 'nested');
  const cachePath = path.join(cacheDir, 'test-contention-cache.db');
  const schema = z.object({ value: z.string() });

  await fs.rm(cacheDir, { recursive: true, force: true });

  const cache = new mod.DuckDbJsonCache(cachePath, schema);
  try {
    await cache.set('https://example.com/nested', { value: 'created' });
    const stored = await cache.get('https://example.com/nested', 60_000);
    assert.deepEqual(stored, { value: 'created' });
  } finally {
    await cache.close();
  }
});

test('DuckDbJsonCache retry fails after 5 contention attempts and throws error', async () => {
  const mod = await loadModule(path.join('core', 'cache.js'));
  const cachePath = path.join(__dirname, '..', '.tmp', 'test-contention-attempts.db');
  const schema = z.object({ value: z.string() });
  
  const cache = new mod.DuckDbJsonCache(cachePath, schema);
  
  // Mock the runtime connection to force contention errors
  let execCount = 0;
  cache.runtime = async () => {
    return {
      exec: async (query) => {
        execCount += 1;
        if (query.sql === 'BEGIN TRANSACTION') {
          throw new Error('database is locked due to lock conflict');
        }
      },
      query: async () => ({ rows: [] }),
      close: async () => {}
    };
  };
  
  await assert.rejects(
    async () => {
      await cache.set('https://example.com/retry', { value: 'test' });
    },
    /locked/
  );
  
  assert.equal(execCount, 10); // 5 attempts of BEGIN TRANSACTION + 5 rollbacks
  await cache.close();
});
