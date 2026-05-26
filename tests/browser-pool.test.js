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

test('BrowserPool caps maximum concurrent browser contexts and queues requests', async () => {
  const mod = await loadModule(path.join('core', 'scraping', 'browserPool.js'));
  const pool = mod.BrowserPool.getInstance();

  const contexts = [];
  for (let i = 0; i < 10; i++) {
    contexts.push(await pool.acquireContext());
  }

  let acquired11 = false;
  const p11 = pool.acquireContext().then((ctx) => {
    acquired11 = true;
    return ctx;
  });

  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(acquired11, false, 'The 11th context should be queued');

  await pool.releaseContext(contexts[0]);

  const ctx11 = await p11;
  assert.equal(acquired11, true, 'The 11th context should be acquired after release');

  await pool.releaseContext(ctx11);
  for (let i = 1; i < 10; i++) {
    await pool.releaseContext(contexts[i]);
  }
  await pool.close();
});
