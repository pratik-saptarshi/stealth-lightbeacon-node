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

test('SSRFGuardHttpAgent and SSRFGuardHttpsAgent socket pinning', async () => {
  const mod = await loadModule(path.join('core', 'ssrf.js'));
  const guard = new mod.SSRFGuard({ allowPrivate: true });

  const agents = mod.getSSRFGuardAgents(guard);
  assert.ok(agents.httpAgent);
  assert.ok(agents.httpsAgent);

  // Throws if not pre-validated
  assert.throws(() => {
    agents.httpAgent.createConnection({ host: 'example.com' });
  }, /Unvalidated host/);

  // Mock net.createConnection and tls.connect to prevent outbound network calls
  const net = require('node:net');
  const tls = require('node:tls');
  const originalCreateConnection = net.createConnection;
  const originalTlsConnect = tls.connect;

  let netCalled = false;
  let tlsCalled = false;

  net.createConnection = (options, cb) => {
    netCalled = true;
    if (cb) cb();
    return { destroy: () => {} };
  };

  tls.connect = (options, cb) => {
    tlsCalled = true;
    if (cb) cb();
    return { destroy: () => {} };
  };

  try {
    // Manually populate dnsCache to bypass async DNS lookup
    mod.SSRFGuard.dnsCache.set('example.com', '93.184.216.34');

    const socket = agents.httpAgent.createConnection({ host: 'example.com', port: 80 });
    assert.ok(socket);
    assert.ok(netCalled);
    socket.destroy();

    const secureSocket = agents.httpsAgent.createConnection({ host: 'example.com', port: 443 });
    assert.ok(secureSocket);
    assert.ok(tlsCalled);
    secureSocket.destroy();
  } finally {
    net.createConnection = originalCreateConnection;
    tls.connect = originalTlsConnect;
  }
});
