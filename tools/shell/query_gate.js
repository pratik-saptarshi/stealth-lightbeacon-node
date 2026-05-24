const { createMcpServer } = require('../../dist/mcp/server.js');

(async () => {
  const server = createMcpServer();
  const response = await server.handleRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'ontology.query',
      arguments: {
        cypher:
          "MATCH (c1:CodeSymbol)-[:CALLS]->(c2:CodeSymbol) WHERE c1.name = 'createMcpServer' RETURN c2.name, c2.filePath, c2.startLine"
      }
    }
  });
  console.log(JSON.stringify(response, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
