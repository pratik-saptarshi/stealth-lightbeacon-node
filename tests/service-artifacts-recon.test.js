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
    body: await response.json(),
    text: async () => response.text()
  };
}

async function waitForJob(url, status) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await requestJson(url);
    if (response.body.job.status === status) {
      return response;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return requestJson(url);
}

test('completed evaluation exposes artifact manifest and scoped file retrieval', async () => {
  const { startService } = require('../dist/service/server.js');
  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'slb-artifacts-'));
  const service = await startService({
    host: '127.0.0.1',
    port: 0,
    artifactRoot,
    auditRunner: async (request) => {
      const jobDir = path.join(artifactRoot, request.id);
      fs.mkdirSync(jobDir, { recursive: true });
      fs.writeFileSync(path.join(jobDir, 'report.json'), JSON.stringify({ targetUrl: request.targetUrl }));
      return { reportPath: path.join(jobDir, 'report.json') };
    }
  });

  try {
    const created = await requestJson(`${service.url}/evaluations`, {
      method: 'POST',
      body: JSON.stringify({ targetUrl: 'https://example.test' })
    });
    await waitForJob(`${service.url}/evaluations/${created.body.id}`, 'succeeded');

    const manifest = await requestJson(`${service.url}/evaluations/${created.body.id}/artifacts`);
    assert.equal(manifest.status, 200);
    assert.deepEqual(manifest.body, {
      ok: true,
      id: created.body.id,
      artifacts: [
        {
          name: 'report.json',
          sizeBytes: 36,
          contentType: 'application/json'
        }
      ]
    });

    const artifact = await fetch(`${service.url}/evaluations/${created.body.id}/artifacts/report.json`);
    assert.equal(artifact.status, 200);
    assert.equal(artifact.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.deepEqual(await artifact.json(), { targetUrl: 'https://example.test' });
  } finally {
    await service.close();
    fs.rmSync(artifactRoot, { recursive: true, force: true });
  }
});

test('artifact endpoint rejects traversal and missing artifacts with stable errors', async () => {
  const { startService } = require('../dist/service/server.js');
  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'slb-artifacts-'));
  const service = await startService({
    host: '127.0.0.1',
    port: 0,
    artifactRoot,
    auditRunner: async (request) => {
      fs.mkdirSync(path.join(artifactRoot, request.id), { recursive: true });
      return { ok: true };
    }
  });

  try {
    const created = await requestJson(`${service.url}/evaluations`, {
      method: 'POST',
      body: JSON.stringify({ targetUrl: 'https://example.test' })
    });
    await waitForJob(`${service.url}/evaluations/${created.body.id}`, 'succeeded');

    const traversal = await requestJson(`${service.url}/evaluations/${created.body.id}/artifacts/..%2Fsecret.txt`);
    assert.equal(traversal.status, 400);
    assert.deepEqual(traversal.body, {
      ok: false,
      error: {
        code: 'invalid_artifact_path',
        message: 'Artifact path is invalid'
      }
    });

    const missing = await requestJson(`${service.url}/evaluations/${created.body.id}/artifacts/missing.json`);
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'artifact_not_found');
  } finally {
    await service.close();
    fs.rmSync(artifactRoot, { recursive: true, force: true });
  }
});

test('recon endpoint validates payload and does not create evaluation side effects', async () => {
  const { startService } = require('../dist/service/server.js');
  let auditCalls = 0;
  let reconCalls = 0;
  const service = await startService({
    host: '127.0.0.1',
    port: 0,
    auditRunner: async () => {
      auditCalls += 1;
      return { ok: true };
    },
    reconRunner: async (request) => {
      reconCalls += 1;
      assert.equal(request.targetUrl, 'https://example.test');
      return {
        detectedProtections: ['Cloudflare'],
        recommendedEngine: 'stealth',
        recommendedThrottleMs: 1500,
        reason: 'challenge detected'
      };
    }
  });

  try {
    const invalid = await requestJson(`${service.url}/recon`, {
      method: 'POST',
      body: JSON.stringify({ targetUrl: '' })
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, 'invalid_request');

    const recon = await requestJson(`${service.url}/recon`, {
      method: 'POST',
      body: JSON.stringify({ targetUrl: 'https://example.test' })
    });
    assert.equal(recon.status, 200);
    assert.equal(recon.body.ok, true);
    assert.equal(recon.body.recon.recommendedEngine, 'stealth');
    assert.equal(reconCalls, 1);
    assert.equal(auditCalls, 0);
  } finally {
    await service.close();
  }
});

test('recon endpoint rejects private probing unless service explicitly allows it', async () => {
  const { startService } = require('../dist/service/server.js');
  let reconCalls = 0;
  const service = await startService({
    host: '127.0.0.1',
    port: 0,
    reconRunner: async () => {
      reconCalls += 1;
      return {
        targetUrl: 'http://127.0.0.1',
        detectedProtections: [],
        recommendedEngine: 'http',
        recommendedThrottleMs: 0,
        reason: 'private target allowed'
      };
    }
  });

  try {
    const rejected = await requestJson(`${service.url}/recon`, {
      method: 'POST',
      body: JSON.stringify({ targetUrl: 'http://127.0.0.1', allowPrivate: true })
    });

    assert.equal(rejected.status, 403);
    assert.deepEqual(rejected.body, {
      ok: false,
      error: {
        code: 'private_recon_disabled',
        message: 'Private recon targets are disabled for this service'
      }
    });
    assert.equal(reconCalls, 0);
  } finally {
    await service.close();
  }
});

test('recon route errors return stable json envelopes without unhandled rejections', async () => {
  const { startService } = require('../dist/service/server.js');
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  const service = await startService({
    host: '127.0.0.1',
    port: 0,
    reconRunner: async () => {
      throw new Error('recon dependency failed');
    }
  });

  try {
    const response = await requestJson(`${service.url}/recon`, {
      method: 'POST',
      body: JSON.stringify({ targetUrl: 'https://example.test' })
    });

    assert.equal(response.status, 500);
    assert.deepEqual(response.body, {
      ok: false,
      error: {
        code: 'internal_error',
        message: 'recon dependency failed'
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
    await service.close();
  }
});
