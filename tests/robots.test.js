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

test('RobotsPolicy detects global disallow and sitemap references', async () => {
  const mod = await loadModule(path.join('core', 'robots.js'));
  assert.equal(typeof mod.RobotsPolicy, 'function');

  const policy = new mod.RobotsPolicy(
    'https://example.com/robots.txt',
    [
      'User-agent: *',
      'Disallow: /',
      'Sitemap: https://example.com/sitemap.xml'
    ].join('\n')
  );

  assert.equal(policy.isAllowed('StealthLightbeacon/2.0', 'https://example.com/'), false);
  assert.deepEqual(policy.getSitemaps(), ['https://example.com/sitemap.xml']);
});
