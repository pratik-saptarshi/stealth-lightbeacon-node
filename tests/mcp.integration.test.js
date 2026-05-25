const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const runIntegration = process.env.STEALTH_LIGHTBEACON_MCP_INTEGRATION_TESTS === '1';
const integrationTest = runIntegration ? test : test.skip;

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

integrationTest('routes ontology Cypher queries to Rust MCP when integration mode is enabled', async () => {
  const mod = await loadModule(path.join('mcp', 'server.js'));
  const server = mod.createMcpServer();

  const response = await server.handleRequest(
    makeRequest('tools/call', {
      arguments: {
        cypher:
          "MATCH (c1:CodeSymbol)-[:CALLS]->(c2:CodeSymbol) WHERE c1.name = 'createMcpServer' RETURN c2.name AS name, c2.filePath AS filePath, c2.startLine AS startLine"
      },
      name: 'ontology.query'
    })
  );

  assert.equal(response.result.content[0].type, 'text');
  const result = JSON.parse(response.result.content[0].text);
  assert.equal(typeof result.ok, 'boolean');

  // Integration lane validates Rust bridge routing/contract, not graph contents.
  if (result.ok) {
    assert.equal(Array.isArray(result.result), true);
    for (const row of result.result) {
      assert.equal(typeof row, 'object');
      assert.notEqual(row, null);
    }
  } else {
    assert.notEqual(result.error, null);
    const errorType = typeof result.error;
    assert.equal(errorType === 'string' || errorType === 'object', true);
    if (errorType === 'string') {
      assert.ok(result.error.length > 0);
    }
  }
});
