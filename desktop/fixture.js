// Real-DB fixture: seeds a DuckDB `audit_findings` table with two runs, then
// drives the *real* `audit:compare` handler through the preload bridge. No
// SMOKE stub is involved; a pass means main.js -> dist/core/{ontology,db,
// diffEngine}.js actually read the seeded database and diffed the runs.
//
// `resolveOntologyPaths({})` resolves `.data/ontology.duckdb` from
// `process.cwd()`, so the fixture chdirs into a throwaway directory first. That
// keeps the repo's own `.data/` untouched.
const { mkdtempSync, mkdirSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const { app } = require('electron');

const TIMEOUT_MS = 90000;
const rootDir = mkdtempSync(join(tmpdir(), 'stealth-lightbeacon-desktop-fixture-'));
const dataDir = join(rootDir, '.data');
const dbPath = join(dataDir, 'ontology.duckdb');

process.chdir(rootDir);
mkdirSync(dataDir, { recursive: true });

let finished = false;

function cleanup() {
  process.chdir(__dirname);
  rmSync(rootDir, { force: true, recursive: true });
}

function finish(code, message) {
  if (finished) return;
  finished = true;
  cleanup();
  const stream = code === 0 ? process.stdout : process.stderr;
  stream.write(`${message}\n`);
  app.exit(code);
}

const timer = setTimeout(() => {
  finish(1, 'FIXTURE FAIL: timed out waiting for the real audit:compare handler');
}, TIMEOUT_MS);
timer.unref();

function distModule(relativePath) {
  return import(pathToFileURL(join(__dirname, '..', 'dist', relativePath)).href);
}

// Mirrors the `audit_findings` schema in src/core/ontology.ts.
async function seed() {
  const { createDuckDbRuntime } = await distModule(join('core', 'db', 'duckdb.js'));
  const duck = await createDuckDbRuntime({ databasePath: dbPath });
  try {
    await duck.exec({
      sql: `CREATE TABLE audit_findings (
        run_id VARCHAR NOT NULL,
        page_url VARCHAR NOT NULL,
        domain_id VARCHAR NOT NULL,
        issue_id VARCHAR NOT NULL,
        severity VARCHAR NOT NULL,
        message VARCHAR NOT NULL,
        location VARCHAR NOT NULL,
        remedy VARCHAR NOT NULL,
        metadata_json VARCHAR NOT NULL
      )`
    });

    const insert = {
      sql: `INSERT INTO audit_findings (run_id, page_url, domain_id, issue_id, severity, message, location, remedy, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    };
    const findings = [
      // run-A: one issue that run-B fixed, one that stays the same.
      ['run-A', 'https://example.test/', 'demo', 'contrast', 'low', 'Text contrast is below threshold', 'body', 'Raise the contrast ratio', '{}'],
      ['run-A', 'https://example.test/', 'demo', 'slow-lcp', 'high', 'LCP above 2.5s', 'main', 'Preload the hero image', '{}'],
      // run-B: the shared issue plus a new regression.
      ['run-B', 'https://example.test/', 'demo', 'contrast', 'low', 'Text contrast is below threshold', 'body', 'Raise the contrast ratio', '{}'],
      ['run-B', 'https://example.test/', 'demo', 'missing-alt', 'high', 'Images missing alt text', 'img', 'Add descriptive alt text', '{}']
    ];

    for (const finding of findings) {
      await duck.exec({ ...insert, params: finding });
    }
  } finally {
    await duck.close();
  }
}

function keyOf(finding) {
  return `${finding.domainId}:${finding.issueId}`;
}

function assertCompareResult(result) {
  const failures = [];

  if (!result || typeof result !== 'object') {
    return [`expected an object, got ${JSON.stringify(result)}`];
  }
  if (result.ok !== true) {
    failures.push(`expected ok === true, got ${JSON.stringify(result)}`);
  }
  const diff = result.diff;
  if (!diff || typeof diff !== 'object' || Array.isArray(diff)) {
    failures.push(`expected a diff object, got ${JSON.stringify(diff)}`);
    return failures;
  }

  for (const bucket of ['improvements', 'regressions', 'unchanged']) {
    if (!Array.isArray(diff[bucket])) {
      failures.push(`expected diff.${bucket} to be an array, got ${JSON.stringify(diff[bucket])}`);
    }
  }
  if (failures.length > 0) return failures;

  const expected = {
    improvements: ['demo:slow-lcp'],
    regressions: ['demo:missing-alt'],
    unchanged: ['demo:contrast']
  };

  for (const [bucket, keys] of Object.entries(expected)) {
    const actual = diff[bucket].map(keyOf).sort();
    if (JSON.stringify(actual) !== JSON.stringify(keys)) {
      failures.push(`expected diff.${bucket} = ${JSON.stringify(keys)}, got ${JSON.stringify(actual)}`);
    }
  }

  return failures;
}

app.whenReady().then(async () => {
  try {
    await seed();

    // Required only for `createWindow`; the handler is registered at require time.
    const { createWindow } = require('./main.js');
    const win = createWindow();

    const loaded = new Promise((resolve, reject) => {
      win.webContents.once('did-finish-load', resolve);
      win.webContents.once('did-fail-load', (_event, code, description) => {
        reject(new Error(`did-fail-load ${code} ${description}`));
      });
    });
    await loaded;

    const result = await win.webContents.executeJavaScript(`
      (async () => {
        try {
          if (!window.stealthDesktop) {
            return { fixtureError: 'window.stealthDesktop is undefined (preload bridge missing)' };
          }
          return await window.stealthDesktop.compareAudits('run-A', 'run-B');
        } catch (err) {
          return { fixtureError: err && err.message ? err.message : String(err) };
        }
      })()
    `);

    if (result && result.fixtureError) {
      finish(1, `FIXTURE FAIL: ${result.fixtureError}`);
      return;
    }

    const failures = assertCompareResult(result);
    if (failures.length > 0) {
      finish(1, `FIXTURE FAIL:\n  - ${failures.join('\n  - ')}`);
      return;
    }

    finish(
      0,
      `FIXTURE PASS: real audit:compare over ${dbPath} -> ${JSON.stringify(result.diff)}`
    );
  } catch (err) {
    finish(1, `FIXTURE FAIL: ${err && err.stack ? err.stack : String(err)}`);
  }
});
