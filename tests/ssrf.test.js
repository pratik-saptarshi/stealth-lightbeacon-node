const test = require('node:test');
const assert = require('node:assert/strict');
const dnsPromises = require('node:dns/promises');
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

test('SSRFGuard blocks non-global literal IP ranges by default', async () => {
  const mod = await loadModule(path.join('core', 'ssrf.js'));
  const guard = new mod.SSRFGuard();

  const blockedUrls = [
    'http://0.0.0.0/admin',
    'http://0.12.34.56/admin',
    'http://100.64.0.1/admin',
    'http://100.127.255.254/admin',
    'http://198.18.0.1/admin',
    'http://198.19.255.254/admin',
    'http://224.0.0.1/admin',
    'http://240.0.0.1/admin',
    'http://255.255.255.255/admin',
    'http://[::]/admin',
    'http://[::ffff:127.0.0.1]/admin',
    'http://[64:ff9b:1::1]/admin',
    'http://[100::1]/admin',
    'http://[2001:2::1]/admin',
    'http://[2001:db8::1]/admin',
    'http://[ff02::1]/admin'
  ];

  for (const url of blockedUrls) {
    await assert.rejects(() => guard.validate(url), mod.SSRFViolationError, url);
  }
});

test('SSRFGuard blocks non-global DNS results by default', async () => {
  const mod = await loadModule(path.join('core', 'ssrf.js'));
  const originalLookup = dnsPromises.lookup;

  dnsPromises.lookup = async (host) => {
    const answers = {
      'carrier.example': ['100.64.0.1'],
      'benchmark.example': ['198.18.0.1'],
      'documentation.example': ['2001:db8::1'],
      'mixed.example': ['93.184.216.34', '224.0.0.1']
    }[host];

    if (!answers) {
      throw new Error(`Unexpected host: ${host}`);
    }

    return answers.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  };

  try {
    const guard = new mod.SSRFGuard();
    await assert.rejects(() => guard.validate('http://carrier.example/admin'), mod.SSRFViolationError);
    await assert.rejects(() => guard.validate('http://benchmark.example/admin'), mod.SSRFViolationError);
    await assert.rejects(() => guard.validate('http://documentation.example/admin'), mod.SSRFViolationError);
    await assert.rejects(() => guard.validate('http://mixed.example/admin'), mod.SSRFViolationError);

    const permissiveGuard = new mod.SSRFGuard({ allowPrivate: true });
    await assert.doesNotReject(() => permissiveGuard.validate('http://carrier.example/internal'));
  } finally {
    dnsPromises.lookup = originalLookup;
  }
});

test('SSRFGuard allows private addresses when explicitly configured', async () => {
  const mod = await loadModule(path.join('core', 'ssrf.js'));
  const guard = new mod.SSRFGuard({ allowPrivate: true });

  await assert.doesNotReject(() => guard.validate('http://127.0.0.1/internal'));
  await assert.doesNotReject(() => guard.validate('http://10.0.0.1/internal'));
  await assert.doesNotReject(() => guard.validate('http://[::1]/internal'));
  await assert.doesNotReject(() => guard.validate('http://0.0.0.0/internal'));
  await assert.doesNotReject(() => guard.validate('http://100.64.0.1/internal'));
  await assert.doesNotReject(() => guard.validate('http://198.18.0.1/internal'));
  await assert.doesNotReject(() => guard.validate('http://224.0.0.1/internal'));
  await assert.doesNotReject(() => guard.validate('http://255.255.255.255/internal'));
  await assert.doesNotReject(() => guard.validate('http://[2001:db8::1]/internal'));
  await assert.doesNotReject(() => guard.validate('http://[ff02::1]/internal'));
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
