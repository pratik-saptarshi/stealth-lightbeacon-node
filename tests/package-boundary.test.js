const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const {
  parsePackDryRunFiles,
  validatePackageBoundary
} = require('../tools/check-package-boundary.js');

function readPackageJson() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
}

test('package-boundary validator reads expected files and bin from external policy data', () => {
  const packageJson = readPackageJson();
  const policyPath = path.join(__dirname, '..', 'tools', 'package-boundary-policy.json');
  const source = fs.readFileSync(path.join(__dirname, '..', 'tools', 'check-package-boundary.js'), 'utf8');
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));

  assert.equal(policy.version, 1);
  assert.deepEqual(packageJson.files, policy.files);
  assert.deepEqual(packageJson.bin, policy.bin);
  assert.doesNotMatch(source, /const\s+EXPECTED_FILES\s*=\s*\[/);
  assert.doesNotMatch(source, /const\s+EXPECTED_BIN\s*=\s*\{/);
});

test('package.json declares a runtime-only tarball boundary and bin policy', () => {
  const packageJson = readPackageJson();
  const result = validatePackageBoundary({
    packageJson,
    files: [
      'package.json',
      'README.md',
      'LICENSE',
      'SECURITY.md',
      '.env.example',
      'dist/index.js',
      'dist/cli.js',
      'dist/mcp/stdio.js',
      'dist/service/server.js',
      'dist/service/jobs.js',
      'dist/service/artifacts.js',
      'dist/service/reconRunner.js'
    ]
  });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(packageJson.files, [
    'dist/**/*.js',
    'README.md',
    'readme.md',
    'LICENSE',
    'SECURITY.md',
    '.env.example'
  ]);
  assert.deepEqual(packageJson.bin, {
    'stealth-lightbeacon': 'dist/cli.js',
    'stealth-lightbeacon-mcp': 'dist/mcp/stdio.js'
  });
});

test('pack dry-run parsing rejects tests, temp files, local config, and cache artifacts', () => {
  const packageJson = readPackageJson();
  const dryRunOutput = `
npm notice === Tarball Contents ===
npm notice 1.1kB package/package.json
npm notice 3.2kB package/dist/index.js
npm notice 1.9kB package/dist/cli.js
npm notice 1.1kB package/dist/mcp/stdio.js
npm notice 1.1kB package/dist/service/server.js
npm notice 1.0kB package/dist/service/jobs.js
npm notice 1.0kB package/dist/service/artifacts.js
npm notice 1.0kB package/dist/service/reconRunner.js
npm notice 1.0kB package/README.md
npm notice 1.0kB package/LICENSE
npm notice 1.0kB package/SECURITY.md
npm notice 1.0kB package/.env.example
npm notice 1.0kB package/dist/.tsbuildinfo
npm notice 1.0kB package/tests/config.test.js
npm notice 1.0kB package/tmp/local.json
npm notice 1.0kB package/.npmrc
npm notice 1.0kB package/.cache/playwright/state.json
`;

  const files = parsePackDryRunFiles(dryRunOutput);
  const result = validatePackageBoundary({ packageJson, files });

  assert.deepEqual(files, [
    'package.json',
    'dist/index.js',
    'dist/cli.js',
    'dist/mcp/stdio.js',
    'dist/service/server.js',
    'dist/service/jobs.js',
    'dist/service/artifacts.js',
    'dist/service/reconRunner.js',
    'README.md',
    'LICENSE',
    'SECURITY.md',
    '.env.example',
    'dist/.tsbuildinfo',
    'tests/config.test.js',
    'tmp/local.json',
    '.npmrc',
    '.cache/playwright/state.json'
  ]);
  assert.deepEqual(result.errors, [
    'disallowed tarball path: dist/.tsbuildinfo',
    'disallowed tarball path: tests/config.test.js',
    'disallowed tarball path: tmp/local.json',
    'disallowed tarball path: .npmrc',
    'disallowed tarball path: .cache/playwright/state.json'
  ]);
});

test('pack dry-run parsing handles pnpm path-only tarball contents', () => {
  const packageJson = readPackageJson();
  const dryRunOutput = `
Tarball Contents
package.json
dist/index.js
dist/cli.js
dist/mcp/stdio.js
dist/service/server.js
README.md
LICENSE
SECURITY.md
.env.example
tests/package-boundary.test.js
Tarball Details
`;

  const files = parsePackDryRunFiles(dryRunOutput);
  const result = validatePackageBoundary({ packageJson, files });

  assert.deepEqual(files, [
    'package.json',
    'dist/index.js',
    'dist/cli.js',
    'dist/mcp/stdio.js',
    'dist/service/server.js',
    'README.md',
    'LICENSE',
    'SECURITY.md',
    '.env.example',
    'tests/package-boundary.test.js'
  ]);
  assert.deepEqual(result.errors, [
    'disallowed tarball path: tests/package-boundary.test.js'
  ]);
});

test('package-boundary CLI fails closed when pack dry-run parses no files', () => {
  const result = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'tools', 'check-package-boundary.js')
  ], {
    input: 'Tarball Contents\nTarball Details\n',
    encoding: 'utf8'
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no tarball files parsed/i);
});

test('bill of materials records current package and service evidence', () => {
  const bom = fs.readFileSync(path.join(__dirname, '..', 'docs', 'bill-of-materials.html.md'), 'utf8');

  for (const expected of [
    'dist/service/server.js',
    'dist/service/jobs.js',
    'dist/service/artifacts.js',
    'dist/service/reconRunner.js',
    'GET /health',
    'POST /evaluations',
    'GET /evaluations/{id}/artifacts/{name}',
    'POST /recon',
    'Latest checked dry-run output'
  ]) {
    assert.match(bom, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(bom, /No `preinstall` hook blocks npm global install/);
  assert.doesNotMatch(bom, /preinstall` rejects non-pnpm/i);
});
