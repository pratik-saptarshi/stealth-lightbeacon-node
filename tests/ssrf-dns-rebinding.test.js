const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
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

test('SecureProxy revalidates pinned targets before proxying requests', async () => {
  const { SecureProxy } = await loadModule(path.join('core', 'scraping', 'secureProxy.js'));
  let upstreamHit = false;
  let upstream;
  let proxy;

  try {
    const upstreamPort = await new Promise((resolve, reject) => {
      upstream = http.createServer((req, res) => {
        upstreamHit = true;
        res.writeHead(200);
        res.end('private service reached');
      });
      upstream.on('error', reject);
      upstream.listen(0, '127.0.0.1', () => resolve(upstream.address().port));
    });

    const guard = {
      async validate(urlValue) {
        const hostname = new URL(urlValue).hostname;
        if (hostname === '127.0.0.1') {
          throw new Error('blocked private target');
        }
      },
      getPinnedAddress(hostname) {
        return hostname === 'rebinding.test' ? '127.0.0.1' : undefined;
      }
    };

    proxy = new SecureProxy(guard);
    const proxyPort = await proxy.start();

    const response = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: proxyPort,
        method: 'GET',
        path: `http://rebinding.test:${upstreamPort}/secret`
      }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => resolve({ statusCode: res.statusCode, body }));
      });
      req.on('error', reject);
      req.end();
    });

    assert.equal(response.statusCode, 403);
    assert.equal(response.body, 'Blocked by SSRFGuard');
    assert.equal(upstreamHit, false, 'Pinned loopback target must not be contacted');
  } finally {
    if (proxy) {
      await proxy.stop();
    }
    if (upstream) {
      await new Promise((resolve) => upstream.close(resolve));
    }
  }
});
