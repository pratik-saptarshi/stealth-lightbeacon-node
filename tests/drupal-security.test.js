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
