const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

async function loadModule(relativePath) {
  const modulePath = path.join(__dirname, '..', '..', 'dist', relativePath);
  try {
    return await import(pathToFileURL(modulePath).href);
  } catch (error) {
    assert.fail(`Failed to load ${relativePath}: ${error.message}`);
  }
}

function createMockReport() {
  return {
    targetUrl: 'https://example.com/',
    crawledPagesCount: 1,
    domains: [
      {
        id: 'seo',
        domain: 'Technical SEO',
        score: 7.5,
        issues: [
          {
            id: 'R-SEO-TITLE-MISS',
            severity: 'critical',
            message: 'Missing title tag',
            location: '<head>',
            remedy: 'Add title'
          }
        ],
        metadata: {}
      }
    ],
    brokenPages: {}
  };
}

test('Reporter integration: summarizes reports and writes JSON and HTML outputs', async () => {
  const mod = await loadModule(path.join('core', 'reporter.js'));
  const Reporter = mod.Reporter;
  const summarize = mod.summarize;
  const mockReport = createMockReport();

  // Test summarize
  const summary = summarize(mockReport);
  assert.equal(summary.totalIssues, 1);
  assert.equal(summary.critical, 1);
  assert.equal(summary.warning, 0);
  assert.equal(summary.averageScore, 7.5);

  // Test Reporter writing
  const testOutputDir = path.join(__dirname, '..', '..', 'scratch_reports_test');
  fs.mkdirSync(testOutputDir, { recursive: true });

  const reporter = new Reporter(testOutputDir);
  
  const jsonPath = reporter.writeJson(mockReport);
  assert.ok(fs.existsSync(jsonPath));
  const jsonContent = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  assert.equal(jsonContent.targetUrl, 'https://example.com/');

  const htmlPath = reporter.writeHtml(mockReport);
  assert.ok(fs.existsSync(htmlPath));
  const htmlContent = fs.readFileSync(htmlPath, 'utf8');
  assert.match(htmlContent, /Technical SEO/);
  assert.match(htmlContent, /Missing title tag/);

  // Clean up
  fs.rmSync(testOutputDir, { recursive: true, force: true });
});

test('Reporter integration: writes PDF output with injected browser renderer', async () => {
  const mod = await loadModule(path.join('core', 'reporter.js'));
  const Reporter = mod.Reporter;
  const mockReport = createMockReport();
  const testOutputDir = path.join(__dirname, '..', '..', 'scratch_reports_pdf_test');
  fs.rmSync(testOutputDir, { recursive: true, force: true });

  const renderedHtml = [];
  const reporter = new Reporter(testOutputDir, {
    async render(html, outputPath) {
      renderedHtml.push(html);
      fs.writeFileSync(outputPath, '%PDF-1.4 test');
    }
  });

  const pdfPath = await reporter.writePdf(mockReport);

  assert.equal(pdfPath, path.join(testOutputDir, 'report.pdf'));
  assert.ok(fs.existsSync(pdfPath));
  assert.ok(fs.existsSync(path.join(testOutputDir, 'report.html')));
  assert.match(fs.readFileSync(pdfPath, 'utf8'), /^%PDF-1\.4/);
  assert.match(renderedHtml[0], /Technical SEO/);
  assert.match(renderedHtml[0], /Missing title tag/);

  fs.rmSync(testOutputDir, { recursive: true, force: true });
});
