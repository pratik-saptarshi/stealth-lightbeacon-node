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

test('SelectorHealer: does not heal when direct selector matches', async () => {
  const mod = await loadModule(path.join('core', 'selectorHealer.js'));
  
  const html = `<html><body><div id="target">Content here</div></body></html>`;
  const result = mod.SelectorHealer.heal(html, '#target');

  assert.equal(result.healed, false);
  assert.equal(result.recoveredText, 'Content here');
  assert.equal(result.confidence, 1.0);
});

test('SelectorHealer: heals when structural changes happen using Levenshtein text similarity', async () => {
  const mod = await loadModule(path.join('core', 'selectorHealer.js'));
  
  // HTML layout changed: the container is now div.main-wrapper instead of div.target-class
  const html = `
    <html>
      <body>
        <div class="main-wrapper">TypeScript compiled content here</div>
      </body>
    </html>
  `;
  const result = mod.SelectorHealer.heal(html, 'div.target-class', {
    expectedText: 'TypeScript compilation content here',
    expectedTagName: 'div',
    threshold: 0.7
  });

  assert.equal(result.healed, true);
  assert.equal(result.recoveredText, 'TypeScript compiled content here');
  assert.ok(result.confidence > 0.8);
  assert.equal(result.suggestedSelector, 'div.main-wrapper');
});

test('SelectorHealer: returns id selectors and stable misses', async () => {
  const mod = await loadModule(path.join('core', 'selectorHealer.js'));
  const html = `
    <html>
      <body>
        <section id="primary" class="content featured">Recoverable headline</section>
        <article class="other">Unrelated text</article>
      </body>
    </html>
  `;

  const healed = mod.SelectorHealer.heal(html, 'section.missing', {
    expectedText: 'Recoverable headline',
    expectedTagName: 'section',
    expectedClasses: ['content', 'featured'],
    threshold: 0.8
  });
  assert.equal(healed.healed, true);
  assert.equal(healed.suggestedSelector, '#primary');
  assert.equal(healed.recoveredText, 'Recoverable headline');

  const missed = mod.SelectorHealer.heal(html, 'aside.missing', {
    expectedText: 'Not present',
    expectedTagName: 'aside',
    threshold: 0.9
  });
  assert.deepEqual(missed, {
    healed: false,
    recoveredText: '',
    suggestedSelector: 'aside.missing',
    confidence: 0
  });
  assert.equal(mod.similarityScore('', ''), 1);
});
