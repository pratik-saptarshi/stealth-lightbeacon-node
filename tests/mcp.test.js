const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function loadModule(relativePath) {
  const fullPath = path.join(__dirname, '..', 'dist', relativePath);

  try {
    return await import(pathToFileURL(fullPath).href);
  } catch (error) {
    assert.fail(`Failed to load ${relativePath}: ${error.message}`);
  }
}

function makeRequest(method, params, id = 1) {
  return { jsonrpc: '2.0', id, method, params };
}

test('lists the MCP tool surface with health, status, duckdb, lancedb, and ontology tools', async () => {
  const mod = await loadModule(path.join('mcp', 'server.js'));
  const server = mod.createMcpServer();

  const response = await server.handleRequest(makeRequest('tools/list', {}));

  assert.equal(response.jsonrpc, '2.0');
  assert.equal(response.id, 1);
  assert.equal(response.result.tools.some((tool) => tool.name === 'health'), true);
  assert.equal(response.result.tools.some((tool) => tool.name === 'status'), true);
  assert.equal(response.result.tools.some((tool) => tool.name === 'duckdb.query'), true);
  assert.equal(response.result.tools.some((tool) => tool.name === 'lancedb.search'), true);
  assert.equal(response.result.tools.some((tool) => tool.name === 'ontology.lookup'), true);
});

test('routes tool calls by name and preserves validated arguments', async () => {
  const mod = await loadModule(path.join('mcp', 'server.js'));
  let called = null;
  const server = mod.createMcpServer({
    ontology: {
      lookup: async () => ({ ok: true, tool: 'ontology.lookup', result: null }),
      search: async (input) => {
        called = input;
        return {
          ok: true,
          tool: 'ontology.search',
          result: {
            items: [{ id: 'a', label: 'alpha' }],
            total: 1
          }
        };
      }
    }
  });

  const response = await server.handleRequest(
    makeRequest('tools/call', {
      arguments: { limit: 1, query: 'alpha' },
      name: 'ontology.search'
    })
  );

  assert.deepEqual(called, { limit: 1, query: 'alpha' });
  assert.equal(response.result.content[0].type, 'text');
  assert.deepEqual(JSON.parse(response.result.content[0].text), {
    ok: true,
    result: {
      items: [{ id: 'a', label: 'alpha' }],
      total: 1
    },
    tool: 'ontology.search'
  });
});

test('rejects unknown keys in tool arguments', async () => {
  const mod = await loadModule(path.join('mcp', 'server.js'));
  let called = 0;
  const server = mod.createMcpServer({
    ontology: {
      lookup: async () => ({ ok: true, tool: 'ontology.lookup', result: null }),
      search: async () => {
        called += 1;
        return {
          ok: true,
          tool: 'ontology.search',
          result: { items: [], total: 0 }
        };
      }
    }
  });

  const response = await server.handleRequest(
    makeRequest('tools/call', {
      arguments: { extra: true, query: 'alpha' },
      name: 'ontology.search'
    })
  );

  assert.equal(called, 0);
  assert.equal(response.error.code, -32602);
  assert.equal(response.id, 1);
});
