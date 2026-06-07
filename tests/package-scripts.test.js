const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readScripts() {
  const packageJsonPath = path.join(__dirname, '..', 'package.json');
  return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')).scripts;
}

function readPackageJson() {
  const packageJsonPath = path.join(__dirname, '..', 'package.json');
  return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
}

function readNpmrc() {
  return fs.readFileSync(path.join(__dirname, '..', '.npmrc'), 'utf8');
}

function readCiWorkflow() {
  return fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'ci.yml'), 'utf8');
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

test('ci node matrix satisfies package engine policy', () => {
  const packageJson = readPackageJson();
  const workflow = readCiWorkflow();
  const minimumMajor = Number(packageJson.engines.node.match(/>=\s*(\d+)/)?.[1]);
  assert.ok(Number.isInteger(minimumMajor), `Unsupported node engine range: ${packageJson.engines.node}`);

  const matrixMatch = workflow.match(/node-version:\s*\[([^\]]+)\]/);
  assert.ok(matrixMatch, 'CI workflow must define a node-version matrix');
  const versions = matrixMatch[1].split(',').map((version) => version.trim());
  assert.ok(versions.length > 0, 'CI workflow must test at least one Node version');

  for (const version of versions) {
    const major = Number(version.match(/^(\d+)/)?.[1]);
    assert.ok(Number.isInteger(major), `Unsupported CI node-version entry: ${version}`);
    assert.ok(
      major >= minimumMajor,
      `CI node-version ${version} does not satisfy package engine ${packageJson.engines.node}`
    );
  }
});
