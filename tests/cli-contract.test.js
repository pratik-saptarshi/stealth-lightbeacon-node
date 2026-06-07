const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');

test('compiled cli module exports handlers without running the command', () => {
  const cli = require('../dist/cli.js');

  assert.equal(typeof cli.main, 'function');
  assert.equal(typeof cli.evaluateCommand, 'function');
  assert.equal(typeof cli.checkBrokenLinks, 'function');
});

test('requiring compiled cli has no stdout stderr or exit side effects', () => {
  const result = spawnSync(
    process.execPath,
    ['-e', "require('./dist/cli.js')"],
    {
      cwd: repoRoot,
      encoding: 'utf8'
    }
  );

  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});
