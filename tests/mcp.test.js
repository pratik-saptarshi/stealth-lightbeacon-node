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
  assert.equal(response.result.tools.some((tool) => tool.name === 'ontology.query'), true);
});

test('routes health tool call', async () => {
  const mod = await loadModule(path.join('mcp', 'server.js'));
  const server = mod.createMcpServer();

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

test('routes ontology Cypher queries to LadybugDB', async () => {
  const mod = await loadModule(path.join('mcp', 'server.js'));
  const server = mod.createMcpServer();

  // Test MATCH (c1:CodeSymbol)-[:CALLS]->(c2:CodeSymbol) WHERE c1.name = 'createMcpServer' RETURN c2
  const response = await server.handleRequest(
    makeRequest('tools/call', {
      arguments: {
        cypher: "MATCH (c1:CodeSymbol)-[:CALLS]->(c2:CodeSymbol) WHERE c1.name = 'createMcpServer' RETURN c2"
      },
      name: 'ontology.query'
    })
  );

  assert.equal(response.result.content[0].type, 'text');
  const result = JSON.parse(response.result.content[0].text);
  assert.equal(result.ok, true);
  assert.equal(result.result.length, 1);
  assert.equal(result.result[0].name, 'invokeTool');
});
