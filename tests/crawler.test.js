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

test('crawlSite stays on-domain, obeys maxUrls, and returns discovered pages', async () => {
  const mod = await loadModule(path.join('core', 'crawler.js'));
  assert.equal(typeof mod.crawlSite, 'function');

  const pages = {
    'https://example.com/': '<html><body><a href="/about">About</a><a href="https://offsite.test/">Offsite</a></body></html>',
    'https://example.com/about': '<html><body><a href="/contact">Contact</a></body></html>',
    'https://example.com/contact': '<html><body>Contact</body></html>'
  };

  const result = await mod.crawlSite({
    startUrl: 'https://example.com/',
    maxDepth: 2,
    maxUrls: 2,
    fetchPage: async (url) => {
      const html = pages[url];
      if (!html) {
        throw new Error(`Missing fixture for ${url}`);
      }

      return {
        url,
        html,
        headers: {},
        status: 200,
        responseTimeMs: 100
      };
    }
  });

  assert.equal(result.pages.length, 2);
  assert.deepEqual(
    result.pages.map((page) => page.url),
    ['https://example.com/', 'https://example.com/about']
  );
});

test('Concurrent crawl: up to concurrency pages fetched simultaneously', async () => {
  const mod = await loadModule(path.join('core', 'crawler.js'));
  
  let activeFetches = 0;
  let maxActiveFetches = 0;

  const result = await mod.crawlSite({
    startUrl: 'https://example.com/',
    maxDepth: 2,
    maxUrls: 5,
    concurrency: 3,
    fetchPage: async (url) => {
      activeFetches++;
      if (activeFetches > maxActiveFetches) {
        maxActiveFetches = activeFetches;
      }
      // Introduce a small sleep to ensure overlap
      await new Promise(resolve => setTimeout(resolve, 50));
      activeFetches--;
      
      let html = '';
      if (url === 'https://example.com/') {
        html = '<html><body><a href="/1">1</a><a href="/2">2</a><a href="/3">3</a><a href="/4">4</a></body></html>';
      }
      return {
        url,
        html,
        headers: {},
        status: 200,
        responseTimeMs: 10
      };
    }
  });

  // Since we have concurrency: 3 and 4 internal links are discovered from homepage,
  // we should have hit peak concurrency of 3 during the crawl
  assert.equal(maxActiveFetches, 3);
});

test('Non-200 pages appear in brokenPages, not pages (F-18)', async () => {
  const mod = await loadModule(path.join('core', 'crawler.js'));

  const result = await mod.crawlSite({
    startUrl: 'https://example.com/',
    maxDepth: 1,
    maxUrls: 3,
    concurrency: 2,
    fetchPage: async (url) => {
      if (url === 'https://example.com/broken') {
        return {
          url,
          html: '',
          headers: {},
          status: 404,
          responseTimeMs: 10
        };
      }
      return {
        url,
        html: '<html><body><a href="/broken">Broken</a></body></html>',
        headers: {},
        status: 200,
        responseTimeMs: 10
      };
    }
  });

  assert.equal(result.pages.length, 1);
  assert.equal(result.pages[0].url, 'https://example.com/');
  assert.ok(result.brokenPages instanceof Map);
  assert.equal(result.brokenPages.get('https://example.com/broken'), 404);
});

test('crawlSite respects throttleMs delay between dispatches', async () => {
  const mod = await loadModule(path.join('core', 'crawler.js'));

  const startTime = Date.now();
  await mod.crawlSite({
    startUrl: 'https://example.com/',
    maxDepth: 2,
    maxUrls: 3,
    concurrency: 1,
    throttleMs: 100,
    fetchPage: async (url) => {
      let html = '';
      if (url === 'https://example.com/') {
        html = '<html><body><a href="/1">1</a><a href="/2">2</a></body></html>';
      }
      return {
        url,
        html,
        headers: {},
        status: 200,
        responseTimeMs: 10
      };
    }
  });
  
  const elapsed = Date.now() - startTime;
  // With concurrency 1, maxUrls 3, we fetch 3 pages sequentially.
  // There are 2 delays of 100ms. So elapsed should be >= 200ms.
  assert.ok(elapsed >= 200, `Expected elapsed time >= 200ms, got ${elapsed}ms`);
});

