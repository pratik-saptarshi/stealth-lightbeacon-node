const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.join(__dirname, '..');

test('the TypeScript compiler accepts tsconfig.json', () => {
  const result = spawnSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json', '--noEmit', '--incremental', 'false'], {
    cwd: repoRoot,
    encoding: 'utf8'
  });

  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `tsc exited ${result.status}\n${result.stdout}\n${result.stderr}`);
});

test('runtime dependency imports do not use dynamic eval wrappers', () => {
  const files = [
    path.join(__dirname, '..', 'src', 'core', 'fetcher.ts'),
    path.join(__dirname, '..', 'src', 'core', 'reporter.ts')
  ];

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /\bnew\s+Function\b|\beval\s*\(/, path.relative(path.join(__dirname, '..'), file));
  }
});
