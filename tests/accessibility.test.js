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

test('AccessibilityEvaluator flags unlabeled controls and missing alt text', async () => {
  const mod = await loadModule(path.join('evaluators', 'accessibility.js'));
  const evaluator = new mod.AccessibilityEvaluator();

  const result = await evaluator.evaluate({
    url: 'https://example.com',
    html: '<html><body><h1>Title</h1><img src="/hero.jpg"><form><input type="text" id="username"></form></body></html>',
    headers: {}
  });

  assert.equal(result.id, 'accessibility');
  assert.equal(result.issues.some((issue) => issue.id === 'R-A11Y-IMG-ALT'), true);
  // Original label check or the new R-A11Y-FORM-LABEL check
  assert.equal(result.issues.some((issue) => issue.id === 'R-A11Y-FORM-LABEL' || issue.id === 'R-A11Y-LABELS'), true);
});

test('AccessibilityEvaluator: flags skipped heading levels, empty interactive elements, and bad alt texts', async () => {
  const mod = await loadModule(path.join('evaluators', 'accessibility.js'));
  const evaluator = new mod.AccessibilityEvaluator();

  const result = await evaluator.evaluate({
    url: 'https://example.com',
    html: `
      <html>
        <body>
          <h1>Heading 1</h1>
          <h3>Heading 3 (skipped H2)</h3>
          
          <a href="/somewhere"></a>
          <button aria-label=""></button>
          
          <img src="test.png" alt="logo.png">
          <img src="photo.jpg" alt="photo">
        </body>
      </html>
    `,
    headers: {}
  });

  assert.ok(result.issues.some((issue) => issue.id === 'R-A11Y-HEAD-SKIP'), 'Expected R-A11Y-HEAD-SKIP');
  assert.ok(result.issues.some((issue) => issue.id === 'R-A11Y-IA-EMPTY'), 'Expected R-A11Y-IA-EMPTY');
  assert.ok(result.issues.some((issue) => issue.id === 'R-A11Y-ALT-BAD'), 'Expected R-A11Y-ALT-BAD');
});
