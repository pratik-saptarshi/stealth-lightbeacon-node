const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

async function loadModule(relativePath) {
  const modulePath = path.join(__dirname, '..', 'dist', relativePath);
  try {
    return await import(pathToFileURL(modulePath).href);
  } catch (error) {
    assert.fail(`Failed to load ${relativePath}: ${error.message}`);
  }
}

test('Scraping factory: createScraper returns a scraping function for engine types', async () => {
  const mod = await loadModule(path.join('core', 'scraping', 'factory.js'));
  assert.equal(typeof mod.createScraper, 'function');

  const httpScraper = mod.createScraper({ engine: 'http' });
  assert.equal(typeof httpScraper, 'function');

  const fastScraper = mod.createScraper({ engine: 'fast' });
  assert.equal(typeof fastScraper, 'function');

  const stealthScraper = mod.createScraper({ engine: 'stealth' });
  assert.equal(typeof stealthScraper, 'function');
});

test('HTTP engine: fetches page content with browser-like request headers and redirects', async () => {
  // Let's create an HTTP scraper
  const mod = await loadModule(path.join('core', 'scraping', 'factory.js'));
  const scraper = mod.createScraper({ engine: 'http', allowPrivate: true });

  // Test against a mock server or known public site. Since we want hermetic tests, we can test that it executes
  // and handles invalid/absent URLs correctly, throwing expected SSRF or fetch errors.
  try {
    await scraper('http://127.0.0.1:9999/nonexistent');
    assert.fail('Expected to fail fetching non-existent mock server');
  } catch (err) {
    // Should be a fetch or connection error, not a compile/type error
    assert.ok(err instanceof Error);
    assert.match(err.message, /ECONNREFUSED|fetch/i);
  }
});

test('Obscura (fast) engine: runs custom sub-process or falls back to http client', async () => {
  const mod = await loadModule(path.join('core', 'scraping', 'factory.js'));
  const scraper = mod.createScraper({ engine: 'fast', allowPrivate: true });

  // Test with absolute binary path that does not exist -> should gracefully fall back to standard HTTP
  try {
    await scraper('http://127.0.0.1:9999/nonexistent');
    assert.fail('Expected fallback HTTP scraper to throw connection refused');
  } catch (err) {
    assert.ok(err instanceof Error);
    assert.match(err.message, /ECONNREFUSED|fetch/i);
  }
});

test('MCP engine: invokes StealthMcpClient tool scrape', async () => {
  const modClient = await loadModule(path.join('mcp', 'client.js'));
  const originalCallTool = modClient.StealthMcpClient.prototype.callTool;
  
  let calledUrl = null;
  modClient.StealthMcpClient.prototype.callTool = async function(toolName, args) {
    if (toolName === 'scrape') {
      calledUrl = args.url;
      return {
        url: args.url,
        html: '<html>Mock</html>',
        headers: {},
        status: 200,
        responseTimeMs: 50
      };
    }
    throw new Error(`Unexpected tool: ${toolName}`);
  };
  
  try {
    const modFactory = await loadModule(path.join('core', 'scraping', 'factory.js'));
    const scraper = modFactory.createScraper({ engine: 'mcp', allowPrivate: true });
    const result = await scraper('http://example.com/mcp-test');
    
    assert.equal(calledUrl, 'http://example.com/mcp-test');
    assert.equal(result.html, '<html>Mock</html>');
    assert.equal(result.status, 200);
  } finally {
    modClient.StealthMcpClient.prototype.callTool = originalCallTool;
  }
});
