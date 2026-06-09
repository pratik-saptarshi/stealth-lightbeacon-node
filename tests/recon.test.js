const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function loadModule(relativePath) {
  const modulePath = path.join(__dirname, '..', 'dist', relativePath);
  try {
    return await import(pathToFileURL(modulePath).href);
  } catch (err) {
    assert.fail(`Failed to load ${relativePath}: ${err.message}`);
  }
}

test('PreAuditRecon: detects Cloudflare protection correctly', async () => {
  const mod = await loadModule(path.join('core', 'recon.js'));
  const ssrfMod = await loadModule(path.join('core', 'ssrf.js'));

  const guard = new ssrfMod.SSRFGuard({ allowPrivate: true });
  const mockFetch = async () => ({
    ok: true,
    status: 200,
    headers: { server: 'cloudflare', 'cf-ray': '1234567' },
    text: async () => '<html><body>cf-challenge</body></html>',
    json: async () => ({})
  });

  const recon = new mod.PreAuditRecon(guard, mockFetch);
  const result = await recon.analyze('http://127.0.0.1/');

  assert.deepEqual(result.detectedProtections, ['Cloudflare']);
  assert.equal(result.recommendedEngine, 'stealth');
  assert.equal(result.recommendedThrottleMs, 1500);
});

test('PreAuditRecon: detects no protections and Next.js footprint', async () => {
  const mod = await loadModule(path.join('core', 'recon.js'));
  const ssrfMod = await loadModule(path.join('core', 'ssrf.js'));

  const guard = new ssrfMod.SSRFGuard({ allowPrivate: true });
  const mockFetch = async () => ({
    ok: true,
    status: 200,
    headers: { server: 'nginx' },
    text: async () => '<html><body><div id="__next">hello</div></body></html>',
    json: async () => ({})
  });

  const recon = new mod.PreAuditRecon(guard, mockFetch);
  const result = await recon.analyze('http://127.0.0.1/');

  assert.deepEqual(result.detectedProtections, []);
  assert.equal(result.recommendedEngine, 'rendered');
  assert.equal(result.recommendedThrottleMs, 0);
});

test('PreAuditRecon: detects Akamai, DataDome, CAPTCHA, and fast path branches', async () => {
  const mod = await loadModule(path.join('core', 'recon.js'));
  const ssrfMod = await loadModule(path.join('core', 'ssrf.js'));
  const guard = new ssrfMod.SSRFGuard({ allowPrivate: true });
  const recon = new mod.PreAuditRecon(guard, async () => ({
    status: 200,
    headers: {
      server: 'AkamaiGHost',
      'x-akamai-transformed': '9',
      'set-cookie': 'datadome=token'
    },
    text: async () => '<html><script src="https://js.datadome.co/tags.js"></script><script src="https://www.google.com/recaptcha/api.js"></script></html>'
  }));

  const protectedResult = await recon.analyze('http://127.0.0.1/');
  assert.deepEqual(protectedResult.detectedProtections, ['Akamai', 'DataDome', 'CAPTCHA']);
  assert.equal(protectedResult.recommendedEngine, 'stealth');

  const fastRecon = new mod.PreAuditRecon(guard, async () => ({
    status: 200,
    headers: { server: 'nginx' },
    text: async () => '<html><body><p>static content</p></body></html>'
  }));
  const fastResult = await fastRecon.analyze('http://127.0.0.1/');
  assert.deepEqual(fastResult.detectedProtections, []);
  assert.equal(fastResult.recommendedEngine, 'http');
});

test('PreAuditRecon: fails closed to stealth recommendation when fetch fails', async () => {
  const mod = await loadModule(path.join('core', 'recon.js'));
  const ssrfMod = await loadModule(path.join('core', 'ssrf.js'));
  const guard = new ssrfMod.SSRFGuard({ allowPrivate: true });
  const recon = new mod.PreAuditRecon(guard, async () => {
    throw new Error('network blocked');
  });

  const result = await recon.analyze('http://127.0.0.1/');
  assert.deepEqual(result.detectedProtections, ['Unknown (Blocked or Offline)']);
  assert.equal(result.recommendedEngine, 'stealth');
  assert.equal(result.recommendedThrottleMs, 2000);
});
