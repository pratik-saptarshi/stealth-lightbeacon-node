const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

async function readJson(url) {
  const response = await fetch(url);
  return {
    status: response.status,
    body: await response.json()
  };
}

test('service starts on an ephemeral port and returns health contract', async () => {
  const { startService } = require('../dist/service/server.js');
  const service = await startService({
    host: '127.0.0.1',
    port: 0,
    persistence: true,
    version: 'contract-test',
    clock: () => 1250
  });

  try {
    assert.equal(service.address.host, '127.0.0.1');
    assert.ok(service.address.port > 0);

    const health = await readJson(`${service.url}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(health.body, {
      ok: true,
      status: 'ok',
      version: 'contract-test',
      uptimeMs: 0,
      persistence: { enabled: true }
    });
  } finally {
    await service.close();
  }
});

test('service exposes stable capabilities contract and json error envelope', async () => {
  const { startService } = require('../dist/service/server.js');
  const service = await startService({
    host: '127.0.0.1',
    port: 0,
    persistence: false,
    version: 'contract-test'
  });

  try {
    const capabilities = await readJson(`${service.url}/capabilities`);
    assert.equal(capabilities.status, 200);
    assert.equal(capabilities.body.ok, true);
    assert.deepEqual(capabilities.body.engines, ['http', 'rendered', 'fast', 'stealth']);
    assert.deepEqual(capabilities.body.formats, ['json', 'html', 'both', 'llm', 'geo-xml']);
    assert.ok(capabilities.body.evaluators.includes('seo'));
    assert.deepEqual(capabilities.body.endpoints, [
      '/health',
      '/capabilities',
      '/evaluations',
      '/evaluations/{id}',
      '/evaluations/{id}/result'
    ]);
    assert.deepEqual(capabilities.body.security, {
      ssrfGuard: true,
      auth: false,
      tls: false
    });

    const missing = await readJson(`${service.url}/missing`);
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.body, {
      ok: false,
      error: {
        code: 'not_found',
        message: 'Route not found'
      }
    });
  } finally {
    await service.close();
  }
});

test('compiled cli exports serve handler and exposes serve help', () => {
  const cli = require('../dist/cli.js');
  assert.equal(typeof cli.serveCommand, 'function');

  const result = spawnSync(
    process.execPath,
    ['dist/cli.js', 'serve', '--help'],
    { encoding: 'utf8' }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /--host <host>/);
  assert.match(result.stdout, /--port <port>/);
  assert.match(result.stdout, /--no-persist/);
});
