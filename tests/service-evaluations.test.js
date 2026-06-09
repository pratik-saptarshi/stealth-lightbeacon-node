const test = require('node:test');
const assert = require('node:assert/strict');

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

test('evaluation lifecycle accepts jobs and returns queued then succeeded state', async () => {
  const { startService } = require('../dist/service/server.js');
  let now = Date.parse('2026-06-08T00:00:00.000Z');
  const service = await startService({
    host: '127.0.0.1',
    port: 0,
    clock: () => now,
    auditRunner: async (request) => {
      assert.equal(request.targetUrl, 'https://example.test');
      assert.deepEqual(request.options, { maxUrls: 2 });
      now += 1000;
      return { reportPath: 'reports/eval-000001/report.json' };
    }
  });

  try {
    const created = await requestJson(`${service.url}/evaluations`, {
      method: 'POST',
      body: JSON.stringify({
        targetUrl: 'https://example.test',
        options: { maxUrls: 2 }
      })
    });
    assert.equal(created.status, 202);
    assert.equal(created.body.ok, true);
    assert.match(created.body.id, /^eval-/);
    assert.equal(created.body.status, 'queued');

    const jobUrl = `${service.url}/evaluations/${created.body.id}`;
    const completed = await waitForJob(jobUrl, 'succeeded');
    assert.equal(completed.status, 200);
    assert.deepEqual(completed.body.job, {
      id: created.body.id,
      targetUrl: 'https://example.test',
      options: { maxUrls: 2 },
      status: 'succeeded',
      createdAt: '2026-06-08T00:00:00.000Z',
      updatedAt: '2026-06-08T00:00:01.000Z'
    });

    const result = await requestJson(`${jobUrl}/result`);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, {
      ok: true,
      id: created.body.id,
      status: 'succeeded',
      result: { reportPath: 'reports/eval-000001/report.json' }
    });
  } finally {
    await service.close();
  }
});

test('default service reports evaluations as not implemented instead of accepting doomed jobs', async () => {
  const { startService } = require('../dist/service/server.js');
  const service = await startService({
    host: '127.0.0.1',
    port: 0,
    persistence: false,
    version: 'contract-test'
  });

  try {
    const capabilities = await requestJson(`${service.url}/capabilities`);
    assert.equal(capabilities.status, 200);
    assert.equal(capabilities.body.execution.evaluations, false);

    const created = await requestJson(`${service.url}/evaluations`, {
      method: 'POST',
      body: JSON.stringify({ targetUrl: 'https://example.test' })
    });

    assert.equal(created.status, 501);
    assert.deepEqual(created.body, {
      ok: false,
      error: {
        code: 'not_implemented',
        message: 'Evaluation execution is not available in this service'
      }
    });
  } finally {
    await service.close();
  }
});

test('evaluation lifecycle isolates concurrent jobs and failed state', async () => {
  const { startService } = require('../dist/service/server.js');
  const service = await startService({
    host: '127.0.0.1',
    port: 0,
    auditRunner: async (request) => {
      if (request.targetUrl.includes('fail')) {
        throw new Error('audit failed');
      }
      return { targetUrl: request.targetUrl };
    }
  });

  try {
    const first = await requestJson(`${service.url}/evaluations`, {
      method: 'POST',
      body: JSON.stringify({ targetUrl: 'https://one.test' })
    });
    const second = await requestJson(`${service.url}/evaluations`, {
      method: 'POST',
      body: JSON.stringify({ targetUrl: 'https://fail.test' })
    });

    assert.notEqual(first.body.id, second.body.id);
    const firstJob = await waitForJob(`${service.url}/evaluations/${first.body.id}`, 'succeeded');
    const secondJob = await waitForJob(`${service.url}/evaluations/${second.body.id}`, 'failed');

    assert.equal(firstJob.body.job.status, 'succeeded');
    assert.equal(secondJob.body.job.status, 'failed');
    assert.deepEqual(secondJob.body.job.error, {
      code: 'evaluation_failed',
      message: 'audit failed'
    });
  } finally {
    await service.close();
  }
});

test('evaluation lifecycle returns stable invalid unknown and unfinished envelopes', async () => {
  const { startService } = require('../dist/service/server.js');
  let releaseRunner;
  const service = await startService({
    host: '127.0.0.1',
    port: 0,
    auditRunner: () => new Promise((resolve) => {
      releaseRunner = () => resolve({ ok: true });
    })
  });

  try {
    const invalid = await requestJson(`${service.url}/evaluations`, {
      method: 'POST',
      body: JSON.stringify({ targetUrl: '' })
    });
    assert.equal(invalid.status, 400);
    assert.deepEqual(invalid.body, {
      ok: false,
      error: {
        code: 'invalid_request',
        message: 'targetUrl is required'
      }
    });

    const missing = await requestJson(`${service.url}/evaluations/eval-missing`);
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'evaluation_not_found');

    const created = await requestJson(`${service.url}/evaluations`, {
      method: 'POST',
      body: JSON.stringify({ targetUrl: 'https://pending.test' })
    });
    const pending = await requestJson(`${service.url}/evaluations/${created.body.id}/result`);
    assert.equal(pending.status, 409);
    assert.deepEqual(pending.body, {
      ok: false,
      error: {
        code: 'result_not_ready',
        message: 'Evaluation result is not ready'
      }
    });
    releaseRunner();
  } finally {
    await service.close();
  }
});

test('evaluation creation rejects oversized json bodies', async () => {
  const { startService } = require('../dist/service/server.js');
  const service = await startService({
    host: '127.0.0.1',
    port: 0,
    jsonBodyLimitBytes: 32,
    auditRunner: async () => ({ ok: true })
  });

  try {
    const response = await requestJson(`${service.url}/evaluations`, {
      method: 'POST',
      body: JSON.stringify({ targetUrl: 'https://example.test', padding: 'x'.repeat(128) })
    });

    assert.equal(response.status, 413);
    assert.deepEqual(response.body, {
      ok: false,
      error: {
        code: 'payload_too_large',
        message: 'JSON request body exceeds 32 bytes'
      }
    });
  } finally {
    await service.close();
  }
});

test('service close marks active persisted jobs as interrupted before restart', async () => {
  const { startService } = require('../dist/service/server.js');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'slb-drain-'));
  let service = await startService({
    host: '127.0.0.1',
    port: 0,
    artifactRoot,
    persistence: true,
    auditRunner: async () => new Promise(() => {})
  });

  try {
    const created = await requestJson(`${service.url}/evaluations`, {
      method: 'POST',
      body: JSON.stringify({ targetUrl: 'https://pending.test' })
    });
    await waitForJob(`${service.url}/evaluations/${created.body.id}`, 'running');
    await service.close();

    service = await startService({
      host: '127.0.0.1',
      port: 0,
      artifactRoot,
      persistence: true
    });

    const recovered = await requestJson(`${service.url}/evaluations/${created.body.id}`);
    assert.equal(recovered.status, 200);
    assert.equal(recovered.body.job.status, 'failed');
    assert.deepEqual(recovered.body.job.error, {
      code: 'evaluation_interrupted',
      message: 'Evaluation interrupted during service shutdown'
    });
  } finally {
    await service.close();
    fs.rmSync(artifactRoot, { recursive: true, force: true });
  }
});
