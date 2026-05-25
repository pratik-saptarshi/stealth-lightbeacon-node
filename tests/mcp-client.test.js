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

test('ProcessJsonRpcClient correlates requests and responses', async () => {
  const mod = await loadModule(path.join('mcp', 'client.js'));
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-client-'));
  const scriptPath = path.join(tmpDir, 'echo-server.js');
  fs.writeFileSync(
    scriptPath,
    [
      "const readline = require('node:readline');",
      "const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });",
      "rl.on('line', (line) => {",
      "  const req = JSON.parse(line);",
      "  if (req.method === 'shutdown') {",
      "    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id ?? null, result: { ok: true } }) + '\\n');",
      "    process.exit(0);",
      "  }",
      "  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id ?? null, result: { method: req.method } }) + '\\n');",
      "});"
    ].join('\n'),
    'utf8'
  );

  const client = new mod.ProcessJsonRpcClient({
    command: process.execPath,
    commandArgs: [scriptPath],
    idleShutdownMs: 10_000
  });
  try {
    const response = await client.send({ jsonrpc: '2.0', method: 'tools/list', id: 7 });
    assert.equal(response.id, 7);
    assert.deepEqual(response.result, { method: 'tools/list' });
    const notifyResponse = await client.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    assert.equal(notifyResponse, null);
    const shutdown = await client.send({ jsonrpc: '2.0', method: 'shutdown', id: 8 });
    assert.equal(shutdown.id, 8);
  } finally {
    client.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
