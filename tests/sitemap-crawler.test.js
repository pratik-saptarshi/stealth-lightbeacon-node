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

test('Crawler seeds queue from sitemap.xml and successfully processes pages', async () => {
  const mod = await loadModule(path.join('core', 'crawler.js'));

  const mockPages = {
    'http://127.0.0.1/sitemap.xml': {
      url: 'http://127.0.0.1/sitemap.xml',
      html: `
        <?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url>
            <loc>http://127.0.0.1/about</loc>
          </url>
          <url>
            <loc>http://127.0.0.1/contact</loc>
          </url>
        </urlset>
      `,
      headers: {},
      status: 200,
      responseTimeMs: 5
    },
    'http://127.0.0.1/': {
      url: 'http://127.0.0.1/',
      html: '<html><body><a href="/services">Services</a></body></html>',
      headers: {},
      status: 200,
      responseTimeMs: 5
    },
    'http://127.0.0.1/about': {
      url: 'http://127.0.0.1/about',
      html: '<html><body>About page</body></html>',
      headers: {},
      status: 200,
      responseTimeMs: 5
    },
    'http://127.0.0.1/contact': {
      url: 'http://127.0.0.1/contact',
      html: '<html><body>Contact page</body></html>',
      headers: {},
      status: 200,
      responseTimeMs: 5
    },
    'http://127.0.0.1/services': {
      url: 'http://127.0.0.1/services',
      html: '<html><body>Services page</body></html>',
      headers: {},
      status: 200,
      responseTimeMs: 5
    }
  };

  const fetchPage = async (url) => {
    return mockPages[url] || {
      url,
      html: '<html><body>404</body></html>',
      headers: {},
      status: 404,
      responseTimeMs: 1
    };
  };

  const crawl = await mod.crawlSite({
    startUrl: 'http://127.0.0.1/',
    maxDepth: 2,
    maxUrls: 5,
    fetchPage
  });

  assert.ok(crawl.pages.length > 1, 'Should crawl multiple pages successfully');
  const urls = crawl.pages.map(p => p.url);
  assert.ok(urls.includes('http://127.0.0.1/about'), 'Queue should include sitemap loc: /about');
  assert.ok(urls.includes('http://127.0.0.1/contact'), 'Queue should include sitemap loc: /contact');
  assert.ok(urls.includes('http://127.0.0.1/services'), 'Queue should follow internal page links');
});
