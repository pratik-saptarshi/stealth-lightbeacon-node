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

function makeApiPayload() {
  return {
    lighthouseResult: {
      categories: { performance: { score: 0.92 } },
      audits: {
        'largest-contentful-paint': { displayValue: '1.2 s' },
        'interaction-to-next-paint': { displayValue: '140 ms' },
        'cumulative-layout-shift': { displayValue: '0.01' }
      }
    },
    loadingExperience: {
      metrics: {
        LARGEST_CONTENTFUL_PAINT_MS: { percentile: 1200 },
        CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 1 },
        INTERACTION_TO_NEXT_PAINT: { percentile: 140 },
        EXPERIMENTAL_TIME_TO_FIRST_BYTE: { percentile: 220 }
      }
    }
  };
}

test('PageSpeedService returns cached summary without API fetch', async () => {
  const mod = await loadModule(path.join('core', 'pagespeed.js'));
  const cached = {
    lighthousePerformanceScore: 91,
    cwv: { lcp: '1.1 s', inp: '120 ms', cls: '0.02' },
    lcpMs: 1100,
    clsScore: 0.02,
    inpMs: 120,
    ttfbMs: 210
  };
  const cache = {
    getCalls: 0,
    async get() {
      this.getCalls += 1;
      return cached;
    },
    async set() {
      assert.fail('set should not be called for cache hit');
    },
    async close() {}
  };
  const service = new mod.PageSpeedService({ cache });
  const originalFetch = global.fetch;
  global.fetch = async () => {
    assert.fail('fetch should not be called for cache hit');
  };
  try {
    const result = await service.getSummary('https://example.com/', 'k');
    assert.deepEqual(result, cached);
    assert.equal(cache.getCalls, 1);
  } finally {
    global.fetch = originalFetch;
    await service.close();
  }
});

test('PageSpeedService fetches and caches on miss', async () => {
  const mod = await loadModule(path.join('core', 'pagespeed.js'));
  const writes = [];
  const cache = {
    async get() {
      return null;
    },
    async set(key, value) {
      writes.push({ key, value });
    },
    async close() {}
  };
  const service = new mod.PageSpeedService({ cache });
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return makeApiPayload();
    }
  });
  try {
    const result = await service.getSummary('https://example.com/', 'k');
    assert.equal(result.lighthousePerformanceScore, 92);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].key, 'https://example.com/');
  } finally {
    global.fetch = originalFetch;
    await service.close();
  }
});

test('PageSpeedService retries cache writes on contention-like errors', async () => {
  const mod = await loadModule(path.join('core', 'pagespeed.js'));
  let attempts = 0;
  const cache = {
    async get() {
      return null;
    },
    async set() {
      attempts += 1;
      if (attempts < 3) {
        throw new Error('database is locked');
      }
    },
    async close() {}
  };
  const service = new mod.PageSpeedService({ cache });
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return makeApiPayload();
    }
  });
  try {
    const result = await service.getSummary('https://example.com/', 'k');
    assert.equal(result.lighthousePerformanceScore, 92);
    assert.equal(attempts, 3);
  } finally {
    global.fetch = originalFetch;
    await service.close();
  }
});
