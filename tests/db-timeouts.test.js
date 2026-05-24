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

test('withHardTimeout resolves before the default deadline', async () => {
  const mod = await loadModule(path.join('core', 'db', 'timeouts.js'));
  const result = await mod.withHardTimeout(async signal => {
    assert.equal(signal.aborted, false);
    return 'ok';
  });

  assert.equal(result, 'ok');
  assert.equal(mod.DEFAULT_DB_TIMEOUT_MS, 2000);
});

test('withHardTimeout aborts slow work with a timeout error', async () => {
  const mod = await loadModule(path.join('core', 'db', 'timeouts.js'));
  const startedAt = Date.now();
  let aborted = false;

  await assert.rejects(
    () =>
      mod.withHardTimeout(
        signal =>
          new Promise((resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => {
                aborted = true;
                reject(signal.reason);
              },
              { once: true }
            );

            setTimeout(() => resolve('late'), 100);
          }),
        {
          label: 'slow db op',
          timeoutMs: 20
        }
      ),
    err => err.name === 'DbTimeoutError' && err.timeoutMs === 20
  );

  assert.equal(aborted, true);
  assert.ok(Date.now() - startedAt < 500);
});
