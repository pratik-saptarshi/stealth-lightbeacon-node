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

test('SSRFGuard caches and pins resolved IP addresses to prevent DNS rebinding', async () => {
  const mod = await loadModule(path.join('core', 'ssrf.js'));
  const guard = new mod.SSRFGuard();

  // Validate a public URL (e.g. google.com) to trigger DNS resolution and pinning
  await guard.validate('https://www.google.com/search');

  // Verify that the host is cached in the dnsCache map
  const cachedIp = guard.getPinnedAddress('www.google.com');
  assert.ok(cachedIp, 'Should cache resolved IP address for host');
  assert.match(cachedIp, /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$|^[a-f0-9:]+$/i, 'Should be a valid IPv4 or IPv6 address');
});
