const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function loadModule(relativePath) {
  const modulePath = path.join(__dirname, '..', 'dist', relativePath);
  try {
    return await import(pathToFileURL(modulePath).href);
  } catch (err) {
    assert.fail(`Failed to load ${relativePath}: ${err.message}`);
  }
}

test('GeoEvaluator: basic geo checks and depth/HTTPS', async () => {
  const mod = await loadModule(path.join('evaluators', 'geo.js'));
  const evaluator = new mod.GeoEvaluator();

  const result = await evaluator.evaluate({
    url: 'http://example.com',
    html: '<html><body>Short body text.</body></html>',
    headers: {}
  });

  assert.equal(result.id, 'geo');
  assert.ok(result.issues.some(i => i.id === 'R-GEO-HTTPS'));
  assert.ok(result.issues.some(i => i.id === 'R-GEO-DEPTH'));
});

test('GeoEvaluator: flags missing outbound citations, low authority links, missing EEAT author metadata, and recency', async () => {
  const mod = await loadModule(path.join('evaluators', 'geo.js'));
  const evaluator = new mod.GeoEvaluator();

  // Test Case 1: No citations, missing schema author and recency
  const result = await evaluator.evaluate({
    url: 'https://example.com/blog',
    html: `
      <html>
        <body>
          <p>This is a long article about something interesting. It has more than three hundred words to make sure we do not trigger depth warning issues. Let's repeat some words to reach the threshold easily. Stealth lightbeacon node parity sprint is in progress, building amazing features and getting all tests green. The quick brown fox jumps over the lazy dog. Programming in TypeScript is fun and powerful. We love writing clean and modular code with unit tests.</p>
          <a href="https://example.com/privacy">Privacy Policy</a>
          <a href="https://example.com/contact">Contact Us</a>
          <a href="https://example.com/about">About Us</a>
        </body>
      </html>
    `,
    headers: {}
  });

  assert.ok(result.issues.some(i => i.id === 'R-GEO-CIT-NONE'), 'Expected R-GEO-CIT-NONE');
  assert.ok(result.issues.some(i => i.id === 'R-GEO-EEAT-AUTHOR'), 'Expected R-GEO-EEAT-AUTHOR');
  assert.ok(result.issues.some(i => i.id === 'R-GEO-EEAT-RECENCY'), 'Expected R-GEO-EEAT-RECENCY');

  // Test Case 2: Outbound links present but low authority
  const result2 = await evaluator.evaluate({
    url: 'https://example.com/blog',
    html: `
      <html>
        <body>
          <p>Long text again to avoid depth. This is a long article about something interesting. It has more than three hundred words to make sure we do not trigger depth warning issues. Let's repeat some words to reach the threshold easily. Stealth lightbeacon node parity sprint is in progress, building amazing features and getting all tests green. The quick brown fox jumps over the lazy dog. Programming in TypeScript is fun and powerful.</p>
          <a href="https://other.com/page">Outbound but low authority</a>
          <a href="https://example.com/privacy">Privacy Policy</a>
          <a href="https://example.com/contact">Contact Us</a>
          <a href="https://example.com/about">About Us</a>
        </body>
      </html>
    `,
    headers: {}
  });

  assert.ok(!result2.issues.some(i => i.id === 'R-GEO-CIT-NONE'), 'Should not flag R-GEO-CIT-NONE when outbound link exists');
  assert.ok(result2.issues.some(i => i.id === 'R-GEO-CIT-LOW'), 'Expected R-GEO-CIT-LOW');
});

test('GeoEvaluator: flags keyword stuffing when density > 3%', async () => {
  const mod = await loadModule(path.join('evaluators', 'geo.js'));
  const evaluator = new mod.GeoEvaluator();

  const result = await evaluator.evaluate({
    url: 'https://example.com/stuffing',
    html: `
      <html>
        <body>
          <p>Long text again to avoid depth. This is a long article about something interesting. It has more than three hundred words to make sure we do not trigger depth warning issues. Let's repeat some words to reach the threshold easily. Stealth lightbeacon node parity sprint is in progress, building amazing features and getting all tests green. The quick brown fox jumps over the lazy dog. Programming in TypeScript is fun and powerful.</p>
          <p>Lightbeacon Lightbeacon Lightbeacon Lightbeacon Lightbeacon Lightbeacon Lightbeacon Lightbeacon Lightbeacon Lightbeacon Lightbeacon Lightbeacon Lightbeacon Lightbeacon Lightbeacon Lightbeacon Lightbeacon Lightbeacon Lightbeacon Lightbeacon</p>
          <a href="https://example.com/privacy">Privacy Policy</a>
          <a href="https://example.com/contact">Contact Us</a>
          <a href="https://example.com/about">About Us</a>
        </body>
      </html>
    `,
    headers: {}
  });

  assert.ok(result.issues.some(i => i.id === 'R-GEO-STUFFING-WARN'), 'Expected R-GEO-STUFFING-WARN');
});
