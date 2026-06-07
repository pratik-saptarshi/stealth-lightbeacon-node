const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
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

test('BrowserPool disables service workers for rendered audit isolation', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'core', 'scraping', 'browserPool.ts'),
    'utf8'
  );

  assert.match(
    source,
    /--disable-service-workers/,
    'Chromium launch args must disable service workers so page-controlled background fetches cannot bypass route/proxy isolation'
  );
});

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

test('BrowserPool blocks service workers on every acquired browser context', async () => {
  const mod = await loadModule(path.join('core', 'scraping', 'browserPool.js'));
  const pool = mod.BrowserPool.getInstance();
  const capturedOptions = [];

  pool.getBrowser = async () => ({
    newContext: async (options) => {
      capturedOptions.push(options);
      return { close: async () => {} };
    }
  });

  const context = await pool.acquireContext({ userAgent: 'test-agent' });

  assert.equal(capturedOptions.length, 1);
  assert.equal(capturedOptions[0].serviceWorkers, 'block');
  assert.equal(capturedOptions[0].userAgent, 'test-agent');

  await pool.releaseContext(context);
  await pool.close();
});

test('BrowserPool releases queued context slots when context close fails', async () => {
  const mod = await loadModule(path.join('core', 'scraping', 'browserPool.js'));
  const pool = mod.BrowserPool.getInstance();
  let contextId = 0;

  pool.getBrowser = async () => ({
    newContext: async () => {
      contextId += 1;
      return {
        id: contextId,
        close: async () => {
          if (contextId === 1) {
            throw new Error('close failed');
          }
        }
      };
    }
  });

  const first = await pool.acquireContext();
  const closeError = await pool.releaseContext(first).then(
    () => null,
    (error) => error
  );
  assert.match(closeError.message, /close failed/);
  assert.equal(pool.activeContexts, 0, 'Failed close must still release the active slot');

  const second = await pool.acquireContext();
  assert.equal(second.id, 2, 'Failed close must not leak a context slot');

  await pool.releaseContext(second);
  await pool.close();
});
