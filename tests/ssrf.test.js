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

test('SSRFGuard blocks loopback and private addresses by default', async () => {
  const mod = await loadModule(path.join('core', 'ssrf.js'));
  assert.equal(typeof mod.SSRFGuard, 'function');

  const guard = new mod.SSRFGuard();

  // IPv4 Loopback
  await assert.rejects(() => guard.validate('http://127.0.0.1/admin'));
  await assert.rejects(() => guard.validate('http://127.0.0.2/admin'));

  // IPv6 Loopback
  await assert.rejects(() => guard.validate('http://[::1]/admin'));

  // Private Subnets
  await assert.rejects(() => guard.validate('http://10.10.10.10/dashboard')); // Class A
  await assert.rejects(() => guard.validate('http://172.16.5.5/dashboard'));   // Class B
  await assert.rejects(() => guard.validate('http://192.168.1.5/dashboard'));  // Class C

  // Link-local
  await assert.rejects(() => guard.validate('http://169.254.169.254/metadata/v1'));
  await assert.rejects(() => guard.validate('http://[fe80::1]/admin'));

  // IPv6 Unique Local Address (ULA)
  await assert.rejects(() => guard.validate('http://[fc00::1]/admin'));
});

test('SSRFGuard allows private addresses when explicitly configured', async () => {
  const mod = await loadModule(path.join('core', 'ssrf.js'));
  const guard = new mod.SSRFGuard({ allowPrivate: true });

  await assert.doesNotReject(() => guard.validate('http://127.0.0.1/internal'));
  await assert.doesNotReject(() => guard.validate('http://10.0.0.1/internal'));
  await assert.doesNotReject(() => guard.validate('http://[::1]/internal'));
});
