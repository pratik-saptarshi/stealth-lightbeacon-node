const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readScripts() {
  const packageJsonPath = path.join(__dirname, '..', 'package.json');
  return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')).scripts;
}

function readNpmrc() {
  return fs.readFileSync(path.join(__dirname, '..', '.npmrc'), 'utf8');
}

test('non-interactive quality gates invoke tools directly without nested pnpm run', () => {
  const scripts = readScripts();

  assert.equal(scripts.build, 'tsc -p tsconfig.json');
  assert.equal(scripts.typecheck, 'tsc -p tsconfig.json --noEmit');
  assert.equal(scripts['coverage:check'], 'node tools/check-coverage.js');
  assert.equal(scripts['quality:coverage'], 'COVERAGE_MODE=ci node tools/check-coverage.js');
  assert.equal(
    scripts['quality:check'],
    "tsc -p tsconfig.json --noEmit && node --test $(ls tests/*.test.js | grep -Ev 'tests/(ontology|browser-pool|scraping|ssrf-dns-rebinding|mcp\\.integration)\\.test\\.js') && node --test tests/mcp.test.js && COVERAGE_MODE=ci node tools/check-coverage.js"
  );
});

test('pnpm scripts use a non-interactive POSIX shell', () => {
  const npmrc = readNpmrc();

  assert.match(npmrc, /^script-shell=\/bin\/sh$/m);
  assert.match(npmrc, /^manage-package-manager-versions=false$/m);
});
