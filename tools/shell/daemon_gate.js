const fs = require('node:fs');
const { spawn } = require('node:child_process');

const root = process.cwd();
const daemon = spawn('./tools/shell/run_context_daemon.sh', [root], {
  cwd: root,
  env: { ...process.env, PATH: `${root}/tools/bin:${process.env.PATH ?? ''}` },
  stdio: ['ignore', 'pipe', 'pipe']
});

let stdout = '';
let stderr = '';
daemon.stdout.on('data', (chunk) => {
  stdout += chunk.toString();
});
daemon.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
});

setTimeout(() => {
  fs.writeFileSync('src/malformed_gate.ts', 'export function broken( {');
}, 500);

setTimeout(() => {
  daemon.kill('SIGTERM');
}, 3500);

daemon.on('exit', (code, signal) => {
  const logPath = '.agent/logs/indexer_crash.log';
  const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
  console.log(JSON.stringify({ code, signal, stdout, stderr, log }, null, 2));
});
