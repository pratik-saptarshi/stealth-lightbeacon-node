const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function requestJson(url, init) {
  const response = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {})
    }
  });
  return {
    status: response.status,
    body: await response.json()
  };
}

async function waitForJob(url, status, headers) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await requestJson(url, { headers });
    if (response.body.job.status === status) {
      return response;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return requestJson(url, { headers });
}

test('auth token mode protects non-health endpoints with stable 401 errors', async () => {
  const { startService } = require('../dist/service/server.js');
  const service = await startService({
    host: '127.0.0.1',
    port: 0,
    authToken: 'secret-token'
  });

  try {
    const health = await requestJson(`${service.url}/health`);
    assert.equal(health.status, 200);

    for (const headers of [{}, { authorization: 'Bearer wrong-token' }]) {
      const response = await requestJson(`${service.url}/capabilities`, { headers });
      assert.equal(response.status, 401);
      assert.deepEqual(response.body, {
        ok: false,
        error: {
          code: 'unauthorized',
          message: 'Bearer token is required'
        }
      });
    }

    const authorized = await requestJson(`${service.url}/capabilities`, {
      headers: { authorization: 'Bearer secret-token' }
    });
    assert.equal(authorized.status, 200);
    assert.equal(authorized.body.security.auth, true);
  } finally {
    await service.close();
  }
});

test('invalid tls config fails fast before binding', async () => {
  const { startService } = require('../dist/service/server.js');

  await assert.rejects(
    () => startService({
      host: '127.0.0.1',
      port: 0,
      tlsKeyPath: '/missing/key.pem',
      tlsCertPath: '/missing/cert.pem'
    }),
    /TLS config is invalid/
  );
});

test('public binds require auth and explicit unsafe cleartext opt-in', async () => {
  const { startService } = require('../dist/service/server.js');

  await assert.rejects(
    () => startService({
      host: '0.0.0.0',
      port: 0
    }),
    /auth token is required/i
  );

  await assert.rejects(
    () => startService({
      host: '0.0.0.0',
      port: 0,
      authToken: 'secret-token'
    }),
    /public cleartext service requires --unsafe-public-http/i
  );

  const service = await startService({
    host: '0.0.0.0',
    port: 0,
    authToken: 'secret-token',
    allowUnsafePublicHttp: true
  });

  try {
    assert.equal(service.address.host, '0.0.0.0');
  } finally {
    await service.close();
  }
});

test('terminal job state and artifacts reload after restart', async () => {
  const { startService } = require('../dist/service/server.js');
  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'slb-recovery-'));
  const headers = {};
  let service = await startService({
    host: '127.0.0.1',
    port: 0,
    artifactRoot,
    persistence: true,
    auditRunner: async (request) => {
      const jobDir = path.join(artifactRoot, request.id);
      fs.mkdirSync(jobDir, { recursive: true });
      fs.writeFileSync(path.join(jobDir, 'report.json'), '{}');
      return { reportPath: path.join(jobDir, 'report.json') };
    }
  });

  try {
    const created = await requestJson(`${service.url}/evaluations`, {
      method: 'POST',
      body: JSON.stringify({ targetUrl: 'https://example.test' })
    });
    await waitForJob(`${service.url}/evaluations/${created.body.id}`, 'succeeded', headers);
    await service.close();

    service = await startService({
      host: '127.0.0.1',
      port: 0,
      artifactRoot,
      persistence: true
    });

    const recovered = await requestJson(`${service.url}/evaluations/${created.body.id}`);
    assert.equal(recovered.status, 200);
    assert.equal(recovered.body.job.status, 'succeeded');

    const manifest = await requestJson(`${service.url}/evaluations/${created.body.id}/artifacts`);
    assert.equal(manifest.status, 200);
    assert.equal(manifest.body.artifacts[0].name, 'report.json');
  } finally {
    await service.close();
    fs.rmSync(artifactRoot, { recursive: true, force: true });
  }
});

test('corrupted recovered state degrades health and bounds endpoint errors', async () => {
  const { startService } = require('../dist/service/server.js');
  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'slb-recovery-'));
  fs.mkdirSync(artifactRoot, { recursive: true });
  fs.writeFileSync(path.join(artifactRoot, 'jobs.json'), '{corrupt');

  const service = await startService({
    host: '127.0.0.1',
    port: 0,
    artifactRoot,
    persistence: true
  });

  try {
    const health = await requestJson(`${service.url}/health`);
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, false);
    assert.equal(health.body.status, 'degraded');
    assert.deepEqual(health.body.recovery, { ok: false });

    const missing = await requestJson(`${service.url}/evaluations/eval-000001`);
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'evaluation_not_found');
  } finally {
    await service.close();
    fs.rmSync(artifactRoot, { recursive: true, force: true });
  }
});

test('recovery diagnostics require an authenticated explicit health route', async () => {
  const { startService } = require('../dist/service/server.js');
  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'slb-recovery-'));
  fs.mkdirSync(artifactRoot, { recursive: true });
  fs.writeFileSync(path.join(artifactRoot, 'jobs.json'), '{corrupt');

  const service = await startService({
    host: '127.0.0.1',
    port: 0,
    artifactRoot,
    persistence: true,
    authToken: 'secret-token'
  });

  try {
    const publicHealth = await requestJson(`${service.url}/health`);
    assert.equal(publicHealth.status, 200);
    assert.deepEqual(publicHealth.body.recovery, { ok: false });

    const unauthorized = await requestJson(`${service.url}/health/recovery`);
    assert.equal(unauthorized.status, 401);

    const diagnostics = await requestJson(`${service.url}/health/recovery`, {
      headers: { authorization: 'Bearer secret-token' }
    });
    assert.equal(diagnostics.status, 200);
    assert.equal(diagnostics.body.ok, false);
    assert.equal(diagnostics.body.recovery.error.code, 'state_recovery_failed');
    assert.match(diagnostics.body.recovery.error.message, /Unexpected token|JSON/);
  } finally {
    await service.close();
    fs.rmSync(artifactRoot, { recursive: true, force: true });
  }
});
