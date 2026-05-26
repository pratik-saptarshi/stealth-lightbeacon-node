const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function loadModule(relativePath) {
  const modulePath = path.join(__dirname, '..', 'dist', relativePath);
  return await import(pathToFileURL(modulePath).href);
}

test('createDuckDbPageSpeedCache creates a functional PageSpeedCache interface', async () => {
  const mod = await loadModule(path.join('core', 'pagespeedCache.js'));
  const cachePath = path.join(__dirname, '..', '.tmp', 'test-pagespeed-cache.db');
  
  const cache = mod.createDuckDbPageSpeedCache({ cachePath });
  assert.ok(cache);
  assert.equal(typeof cache.get, 'function');
  assert.equal(typeof cache.set, 'function');
  assert.equal(typeof cache.close, 'function');
  
  // Test set/get behavior
  const mockValue = {
    lighthousePerformanceScore: 85,
    cwv: { lcp: '1.5 s', inp: '100 ms', cls: '0.01' },
    lcpMs: 1500,
    clsScore: 0.01,
    inpMs: 100,
    ttfbMs: 150
  };
  
  await cache.set('https://example.com/test-key', mockValue);
  const fetched = await cache.get('https://example.com/test-key', 5000);
  assert.ok(fetched);
  assert.equal(fetched.lighthousePerformanceScore, 85);
  
  await cache.close();
});
