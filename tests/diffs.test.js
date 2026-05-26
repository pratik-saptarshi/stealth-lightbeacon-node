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

test('DiffEngine compares historical audit runs from DuckDB', async () => {
  const dbMod = await loadModule(path.join('core', 'db', 'duckdb.js'));
  const diffMod = await loadModule(path.join('core', 'diffEngine.js'));

  // Create an in-memory DuckDB runtime for isolation
  const duck = await dbMod.createDuckDbRuntime({ databasePath: ':memory:' });
  try {
    // Bootstrap tables manually
    await duck.exec({
      sql: `CREATE TABLE audit_findings (
        run_id VARCHAR,
        page_url VARCHAR,
        domain_id VARCHAR,
        issue_id VARCHAR,
        severity VARCHAR,
        message VARCHAR,
        location VARCHAR,
        remedy VARCHAR,
        metadata_json VARCHAR
      )`
    });

    // Populate mock run A (older)
    await duck.exec({
      sql: `INSERT INTO audit_findings VALUES 
        ('run-A', 'https://example.com/', 'SEO', 'SEO-MISSING-DESC', 'warning', 'Missing meta description', 'head', 'Add description', '{}'),
        ('run-A', 'https://example.com/', 'UX', 'UX-FONT-SMALL', 'warning', 'Font too small', 'body', 'Increase font', '{}')`
    });

    // Populate mock run B (newer)
    await duck.exec({
      sql: `INSERT INTO audit_findings VALUES 
        ('run-B', 'https://example.com/', 'UX', 'UX-FONT-SMALL', 'warning', 'Font too small', 'body', 'Increase font', '{}'),
        ('run-B', 'https://example.com/', 'SECURITY', 'SEC-SSRF-LOOPBACK', 'critical', 'Loopback access allowed', 'crawler', 'Secure SSRF', '{}')`
    });

    const engine = new diffMod.DiffEngine(duck);
    const diff = await engine.compareRuns('run-A', 'run-B');

    // run-A had SEO-MISSING-DESC, absent in run-B -> Improvement
    assert.equal(diff.improvements.length, 1);
    assert.equal(diff.improvements[0].issueId, 'SEO-MISSING-DESC');

    // run-B had SEC-SSRF-LOOPBACK, absent in run-A -> Regression
    assert.equal(diff.regressions.length, 1);
    assert.equal(diff.regressions[0].issueId, 'SEC-SSRF-LOOPBACK');

    // UX-FONT-SMALL in both -> Unchanged
    assert.equal(diff.unchanged.length, 1);
    assert.equal(diff.unchanged[0].issueId, 'UX-FONT-SMALL');
  } finally {
    await duck.close();
  }
});
