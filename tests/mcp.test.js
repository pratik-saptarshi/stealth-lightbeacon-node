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

function createFakeTransport() {
  return {
    async send(message) {
      if (message.method === 'tools/list') {
        return {
          jsonrpc: '2.0',
          id: message.id ?? null,
          result: {
            tools: [
              { name: 'health' },
              { name: 'status' },
              { name: 'duckdb.query' },
              { name: 'lancedb.search' },
              { name: 'ontology.query' }
            ]
          }
        };
      }

      if (message.method === 'tools/call' && message.params?.name === 'health') {
        return {
          jsonrpc: '2.0',
          id: message.id ?? null,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ ok: true, tool: 'health' })
              }
            ]
          }
        };
      }

      if (message.method === 'tools/call' && message.params?.name === 'ontology.query') {
        return {
          jsonrpc: '2.0',
          id: message.id ?? null,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ ok: true, result: [] })
              }
            ]
          }
        };
      }

      return {
        jsonrpc: '2.0',
        id: message.id ?? null,
        error: { code: -32601, message: `Unhandled method ${message.method}` }
      };
    }
  };
}

test('lists the MCP tool surface with health, status, duckdb, lancedb, and ontology tools', async () => {
  const mod = await loadModule(path.join('mcp', 'server.js'));
  const server = mod.createMcpServer({ transport: createFakeTransport() });

  const response = await server.handleRequest(makeRequest('tools/list', {}));

  assert.equal(response.jsonrpc, '2.0');
  assert.equal(response.id, 1);
  assert.equal(response.result.tools.some((tool) => tool.name === 'health'), true);
  assert.equal(response.result.tools.some((tool) => tool.name === 'status'), true);
  assert.equal(response.result.tools.some((tool) => tool.name === 'duckdb.query'), true);
  assert.equal(response.result.tools.some((tool) => tool.name === 'lancedb.search'), true);
  assert.equal(response.result.tools.some((tool) => tool.name === 'ontology.query'), true);
});

test('routes health tool call', async () => {
  const mod = await loadModule(path.join('mcp', 'server.js'));
  const server = mod.createMcpServer({ transport: createFakeTransport() });

  const response = await server.handleRequest(
    makeRequest('tools/call', {
      arguments: {},
      name: 'health'
    })
  );

  assert.equal(response.result.content[0].type, 'text');
  const result = JSON.parse(response.result.content[0].text);
  assert.equal(result.ok, true);
  assert.equal(result.tool, 'health');
});

test('routes ontology queries through the JSON-RPC contract without requiring Rust binary', async () => {
  const mod = await loadModule(path.join('mcp', 'server.js'));
  const server = mod.createMcpServer({ transport: createFakeTransport() });

  const response = await server.handleRequest(
    makeRequest('tools/call', {
      arguments: {
        cypher: 'MATCH (n) RETURN n LIMIT 1'
      },
      name: 'ontology.query'
    })
  );

  assert.equal(response.result.content[0].type, 'text');
  const result = JSON.parse(response.result.content[0].text);
  assert.equal(result.ok, true);
  assert.equal(Array.isArray(result.result), true);
});
