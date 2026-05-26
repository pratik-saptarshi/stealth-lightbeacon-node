const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
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

test('AeoEvaluator: microdata structured data support', async () => {
  const mod = await loadModule(path.join('evaluators', 'aeo.js'));
  const evaluator = new mod.AeoEvaluator();

  const result = await evaluator.evaluate({
    url: 'https://example.com/aeo',
    html: `
      <html>
        <body itemscope itemtype="https://schema.org/FAQPage">
          <h2>How to compile TypeScript?</h2>
          <p>You can compile TypeScript using the command line program tsc, which parses your tsconfig.json and builds javascript files.</p>
        </body>
      </html>
    `,
    headers: {}
  });

  assert.ok(!result.issues.some(i => i.id === 'R-AEO-SCHEMA'), 'Should detect microdata FAQPage');
  assert.equal(result.issues.length, 0, 'Should have no issues when microdata AEO conditions are met');
});

test('Reporter: formats LLM and GEO-XML output correctly', async () => {
  const mod = await loadModule(path.join('core', 'reporter.js'));
  const tempDir = path.join(__dirname, '..', '.cache', 'test-reporter');
  const reporter = new mod.Reporter(tempDir);

  const mockReport = {
    targetUrl: 'https://example.com/',
    crawledPagesCount: 1,
    domains: [
      {
        id: 'aeo',
        domain: 'Answer Engine Optimization',
        score: 10,
        issues: []
      },
      {
        id: 'geo',
        domain: 'Generative Engine Optimization',
        score: 5,
        issues: [
          {
            id: 'R-GEO-HTTPS',
            severity: 'critical',
            message: 'Target is not served over HTTPS.',
            location: 'https://example.com/',
            remedy: 'Serve public content over HTTPS.'
          }
        ]
      }
    ]
  };

  const llmPath = reporter.writeLlm(mockReport);
  assert.ok(fs.existsSync(llmPath));
  const llmContent = fs.readFileSync(llmPath, 'utf8');
  assert.match(llmContent, /# Audit Report:/);
  assert.match(llmContent, /<summary>/);
  assert.match(llmContent, /<domain id="geo"/);

  const xmlPath = reporter.writeGeoXml(mockReport);
  assert.ok(fs.existsSync(xmlPath));
  const xmlContent = fs.readFileSync(xmlPath, 'utf8');
  assert.match(xmlContent, /<\?xml version=/);
  assert.match(xmlContent, /<audit_report target=/);
  assert.match(xmlContent, /<average_score>/);

  // Clean up
  fs.rmSync(tempDir, { recursive: true, force: true });
});

