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

