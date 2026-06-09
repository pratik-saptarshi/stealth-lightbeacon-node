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

test('DrupalSecurityEvaluator flags exposed fingerprint, headers, cookies, and JSON:API exposure', async () => {
  const mod = await loadModule(path.join('evaluators', 'drupalSecurity.js'));
  assert.equal(typeof mod.DrupalSecurityEvaluator, 'function');

  const evaluator = new mod.DrupalSecurityEvaluator();
  const result = await evaluator.evaluate({
    url: 'https://example.com',
    html: [
      '<html><head>',
      '<meta name="generator" content="Drupal 10">',
      '<link rel="stylesheet" href="/sites/default/files/theme.css">',
      '</head><body>Example</body></html>'
    ].join(''),
    headers: {
      'set-cookie': ['sessionid=abc123; Path=/']
    },
    auxiliaryResponses: {
      jsonApiUser: {
        status: 200,
        body: JSON.stringify({
          data: [{ type: 'user--user', id: '1' }]
        })
      }
    }
  });

  assert.equal(result.id, 'drupal-security');
  assert.equal(result.issues.some((issue) => issue.id === 'R-SEC-CSP-MISS'), true);
  assert.equal(result.issues.some((issue) => issue.id === 'R-SEC-HSTS-MISS'), true);
  assert.equal(result.issues.some((issue) => issue.id === 'R-DRUP-FINGERPRINT'), true);
  assert.equal(result.issues.some((issue) => issue.id === 'R-DRUP-API-EXPOSED'), true);
  assert.equal(result.issues.some((issue) => issue.id === 'R-SEC-COOKIE-INSECURE'), true);
});

test('DrupalSecurityEvaluator passes hardened headers and complete cookie flags', async () => {
  const mod = await loadModule(path.join('evaluators', 'drupalSecurity.js'));
  const evaluator = new mod.DrupalSecurityEvaluator();

  const result = await evaluator.evaluate({
    url: 'https://example.com',
    html: '<html><head></head><body>No Drupal footprint</body></html>',
    headers: {
      'content-security-policy': "default-src 'self'",
      'strict-transport-security': 'max-age=31536000',
      'x-frame-options': 'DENY',
      'x-content-type-options': 'nosniff',
      'set-cookie': [
        'sessionid=abc123; Path=/; HttpOnly; Secure; SameSite=Lax'
      ]
    },
    auxiliaryResponses: {
      jsonApiUser: {
        status: 404,
        body: '{}'
      }
    }
  });

  assert.deepEqual(result.issues, []);
  assert.equal(result.metadata.hasJsonApiExposure, false);
});

test('DrupalSecurityEvaluator handles empty header arrays and string cookies', async () => {
  const mod = await loadModule(path.join('evaluators', 'drupalSecurity.js'));
  const evaluator = new mod.DrupalSecurityEvaluator();

  const result = await evaluator.evaluate({
    url: 'https://example.com',
    html: '<html><head></head><body>No Drupal footprint</body></html>',
    headers: {
      'content-security-policy': [],
      'strict-transport-security': [],
      'x-frame-options': [],
      'x-content-type-options': ['nosniff'],
      'set-cookie': 'sessionid=abc123; Path=/; HttpOnly'
    }
  });

  const ids = result.issues.map((issue) => issue.id);
  assert.ok(ids.includes('R-SEC-CSP-MISS'));
  assert.ok(ids.includes('R-SEC-HSTS-MISS'));
  assert.ok(ids.includes('R-SEC-XFRAME-MISS'));
  assert.ok(ids.includes('R-SEC-XCONTENT-MISS'));
  assert.ok(ids.includes('R-SEC-COOKIE-INSECURE'));
});
