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

test('AeoEvaluator: flags missing AEO schemas, question headings, and concise paragraphs', async () => {
  const mod = await loadModule(path.join('evaluators', 'aeo.js'));
  const evaluator = new mod.AeoEvaluator();

  const result = await evaluator.evaluate({
    url: 'https://example.com/aeo',
    html: `
      <html>
        <body>
          <h1>Standard Page</h1>
          <p>This is a paragraph but it is extremely short.</p>
        </body>
      </html>
    `,
    headers: {}
  });

  assert.equal(result.id, 'aeo');
  assert.ok(result.issues.some(i => i.id === 'R-AEO-SCHEMA'), 'Expected R-AEO-SCHEMA');
  assert.ok(result.issues.some(i => i.id === 'R-AEO-QUESTIONS'), 'Expected R-AEO-QUESTIONS');
  assert.ok(result.issues.some(i => i.id === 'R-AEO-CONCISE'), 'Expected R-AEO-CONCISE');
});

test('AeoEvaluator: passes when correct AEO metadata, direct questions, and concise answers are present', async () => {
  const mod = await loadModule(path.join('evaluators', 'aeo.js'));
  const evaluator = new mod.AeoEvaluator();

  const result = await evaluator.evaluate({
    url: 'https://example.com/aeo',
    html: `
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "FAQPage",
              "mainEntity": []
            }
          </script>
        </head>
        <body>
          <h2>How to port a codebase to TypeScript?</h2>
          <p>To port a codebase to TypeScript, you must first create a tsconfig.json configuration, rename files from js to ts, and fix compilation errors.</p>
        </body>
      </html>
    `,
    headers: {}
  });

  assert.equal(result.issues.length, 0, 'Should have no issues when all AEO conditions are met');
});
