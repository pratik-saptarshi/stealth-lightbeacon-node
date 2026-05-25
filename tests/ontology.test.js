const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

require('ts-node/register/transpile-only');

const runOntologyTestsLocally = process.env.STEALTH_LIGHTBEACON_LOCAL_ONTOLOGY_TESTS === '1';
const ontologyTest = runOntologyTestsLocally ? test : test.skip;

const originalLoad = Module._load;
const lanceDatabases = new Map();

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === '@lancedb/lancedb') {
    return {
      connect: async (options) => createInMemoryLanceConnection(options.uri)
    };
  }

  return originalLoad.call(this, request, parent, isMain);
};

async function loadModule(relativePath) {
  const fullPath = path.join(__dirname, '..', 'src', relativePath);
  try {
    return require(fullPath);
  } catch (error) {
    assert.fail(`Failed to load ${relativePath}: ${error.message}`);
  }
}

function createInMemoryLanceConnection(uri) {
  const db = lanceDatabases.get(uri) ?? { tables: new Map() };
  lanceDatabases.set(uri, db);

  return {
    async createTable(nameOrOptions, dataOrNamespacePath) {
      const spec =
        typeof nameOrOptions === 'object' && nameOrOptions !== null
          ? nameOrOptions
          : { data: dataOrNamespacePath, name: nameOrOptions };
      const table = getOrCreateTable(db, spec.name);
      table.rows = spec.mode === 'overwrite' ? [...spec.data] : [...spec.data];
      return tableApi(table);
    },
    async openTable(name) {
      const table = db.tables.get(name);
      if (!table) {
        throw new Error(`Table not found: ${name}`);
      }
      return tableApi(table);
    },
    close() {}
  };
}

function getOrCreateTable(db, name) {
  const existing = db.tables.get(name);
  if (existing) {
    return existing;
  }

  const table = { rows: [] };
  db.tables.set(name, table);
  return table;
}

function tableApi(table) {
  return {
    add(rows) {
      table.rows.push(...rows);
    },
    vectorSearch(vector) {
      let limit = 10;
      return {
        limit(nextLimit) {
          limit = nextLimit;
          return this;
        },
        async toArray() {
          return [...table.rows]
            .map((row) => ({
              ...row,
              distance: euclideanDistance(vector, row.vector)
            }))
            .sort((left, right) => left.distance - right.distance)
            .slice(0, limit);
        }
      };
    }
  };
}

function euclideanDistance(left, right) {
  const size = Math.max(left.length, right.length);
  let sum = 0;
  for (let index = 0; index < size; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    sum += delta * delta;
  }
  return Math.sqrt(sum);
}

function samplePage(overrides = {}) {
  return {
    url: 'https://example.com/articles/semantic-memory',
    html:
      '<html><head><title>Semantic Memory</title></head><body><h1>Semantic Memory</h1><p>Alpha body text.</p></body></html>',
    headers: { 'content-type': 'text/html' },
    status: 200,
    responseTimeMs: 123,
    ...overrides
  };
}

function sampleResult(overrides = {}) {
  return {
    id: 'seo',
    domain: 'SEO',
    score: 8.5,
    issues: [
      {
        id: 'R-SEO-NEEDLE',
        severity: 'warning',
        message: 'spectralneedle regression detected',
        location: 'Head',
        remedy: 'Fix the spectralneedle issue.'
      }
    ],
    metadata: { category: 'seo' },
    ...overrides
  };
}

ontologyTest('ontology store round-trips run, page, and finding records through DuckDB', async () => {
  const mod = await loadModule(path.join('core', 'ontology.ts'));
  const dbMod = await loadModule(path.join('core', 'db', 'duckdb.ts'));
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stealth-lightbeacon-ontology-'));
  const store = await mod.createOntologyStore({ rootDir });
  const runId = 'run-round-trip';
  const startedAt = '2026-05-23T10:00:00.000Z';
  const finishedAt = '2026-05-23T10:00:01.500Z';
  const page = samplePage();
  const result = sampleResult();
  const report = {
    targetUrl: 'https://example.com/',
    crawledPagesCount: 1,
    domains: [result],
    brokenPages: { 'https://example.com/missing': 404 }
  };

  await store.beginRun({
    runId,
    startedAt,
    targetUrl: report.targetUrl,
    options: { crawlDepth: 1, maxUrls: 5 }
  });
  await store.recordPage({ page, runId });
  await store.recordFinding({ page, result, runId });
  await store.finishRun({ pages: [page], report, runId, finishedAt });
  await store.close();

  const duck = await dbMod.createDuckDbRuntime({
    databasePath: path.join(rootDir, 'ontology.duckdb'),
    timeoutMs: 2000
  });
  try {
    const runRows = await duck.query({
      sql: 'SELECT * FROM audit_runs WHERE run_id = ?',
      params: [runId]
    });
    assert.equal(runRows.rowCount, 1);
    assert.equal(runRows.rows[0].run_id, runId);
    assert.deepEqual(JSON.parse(runRows.rows[0].report_json), report);
    assert.deepEqual(JSON.parse(runRows.rows[0].options_json), { crawlDepth: 1, maxUrls: 5 });

    const pageRows = await duck.query({
      sql: 'SELECT * FROM audit_pages WHERE run_id = ?',
      params: [runId]
    });
    assert.equal(pageRows.rowCount, 1);
    assert.equal(pageRows.rows[0].page_url, page.url);
    assert.equal(pageRows.rows[0].status, 200);

    const findingRows = await duck.query({
      sql: 'SELECT * FROM audit_findings WHERE run_id = ?',
      params: [runId]
    });
    assert.equal(findingRows.rowCount, 1);
    assert.equal(findingRows.rows[0].issue_id, 'R-SEO-NEEDLE');
    assert.equal(findingRows.rows[0].severity, 'warning');
    assert.ok(JSON.parse(findingRows.rows[0].metadata_json));
  } finally {
    await duck.close();
  }
});

ontologyTest('ontology store semantic search returns the matching finding memory', async () => {
  const mod = await loadModule(path.join('core', 'ontology.ts'));
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stealth-lightbeacon-ontology-search-'));
  const store = await mod.createOntologyStore({ rootDir });
  const runId = 'run-semantic-search';
  const page = samplePage({
    url: 'https://example.com/articles/semantic-search'
  });
  const result = sampleResult();

  await store.beginRun({
    runId,
    startedAt: '2026-05-23T10:05:00.000Z',
    targetUrl: 'https://example.com/',
    options: { crawlDepth: 1, maxUrls: 5 }
  });
  await store.recordPage({ page, runId });
  await store.recordFinding({ page, result, runId });
  await store.finishRun({
    pages: [page],
    report: {
      targetUrl: 'https://example.com/',
      crawledPagesCount: 1,
      domains: [result],
      brokenPages: {}
    },
    runId,
    finishedAt: '2026-05-23T10:05:01.000Z'
  });

  const hits = await store.search('spectralneedle regression', 5);
  assert.ok(hits.length > 0);
  assert.equal(hits[0].kind, 'finding');
  assert.equal(hits[0].label, 'R-SEO-NEEDLE');
  assert.equal(hits[0].runId, runId);
  assert.match(hits[0].text, /spectralneedle/i);

  await store.close();
});
