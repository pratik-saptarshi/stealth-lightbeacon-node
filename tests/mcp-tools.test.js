const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

async function loadModule(relativePath) {
  const modulePath = path.join(__dirname, '..', 'dist', relativePath);
  try {
    return await import(pathToFileURL(modulePath).href);
  } catch (error) {
    assert.fail(`Failed to load ${relativePath}: ${error.message}`);
  }
}

function makeRequest(method, params, id = 1) {
  return { jsonrpc: '2.0', id, method, params };
}

function createFakeTransport() {
  return {
    async send(message) {
      if (message.method === 'tools/list') {
        return {
          jsonrpc: '2.0',
          id: message.id ?? null,
          result: {
            tools: [
              { name: 'ontology.query', description: 'Run Cypher' }
            ]
          }
        };
      }
      return {
        jsonrpc: '2.0',
        id: message.id ?? null,
        result: { ok: true }
      };
    }
  };
}

test('MCP server combines TS tools with Rust tools', async () => {
  const mod = await loadModule(path.join('mcp', 'server.js'));
  const server = mod.createMcpServer({ transport: createFakeTransport() });

  const response = await server.handleRequest(makeRequest('tools/list', {}));

  assert.equal(response.jsonrpc, '2.0');
  assert.equal(Array.isArray(response.result.tools), true);
  
  const toolNames = response.result.tools.map(t => t.name);
  assert.ok(toolNames.includes('ontology.query'));
  assert.ok(toolNames.includes('audit.diff'));
  assert.ok(toolNames.includes('audit.run'));
  assert.ok(toolNames.includes('agent.metadata'));
});

test('MCP server handles agent.metadata call', async () => {
  const mod = await loadModule(path.join('mcp', 'server.js'));
  const server = mod.createMcpServer({ transport: createFakeTransport() });

  const response = await server.handleRequest(makeRequest('tools/call', { name: 'agent.metadata' }));
  const result = JSON.parse(response.result.content[0].text);

  assert.ok(Array.isArray(result.frameworks));
  assert.ok(result.frameworks.includes('CrewAI'));
  assert.ok(Array.isArray(result.agentCards));
  assert.equal(result.agentCards[0].role, 'Security Auditor');
});

test('MCP server handles audit.diff call with initialized DB', async () => {
  const mod = await loadModule(path.join('mcp', 'server.js'));
  const dbMod = await loadModule(path.join('core', 'db', 'duckdb.js'));

  // Create isolated temp directory and duckdb file
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-tools-test-'));
  const dbPath = path.join(tmpDir, 'test.duckdb');

  // Manually bootstrap the duckdb database schema
  const duck = await dbMod.createDuckDbRuntime({ databasePath: dbPath });
  try {
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
  } finally {
    await duck.close();
  }

  try {
    const server = mod.createMcpServer({
      transport: createFakeTransport(),
      duckDbPath: dbPath
    });

    const response = await server.handleRequest(
      makeRequest('tools/call', {
        name: 'audit.diff',
        arguments: {
          runIdA: 'run-A',
          runIdB: 'run-B'
        }
      })
    );

    assert.equal(response.error, undefined, `Expected no error, but got: ${JSON.stringify(response.error)}`);
    assert.ok(response.result, 'Expected result object to be defined');
    const result = JSON.parse(response.result.content[0].text);
    assert.equal(result.ok, true);
    assert.deepEqual(result.result, {
      improvements: [],
      regressions: [],
      unchanged: []
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
