const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  parsePackDryRunFiles,
  validatePackageBoundary
} = require('../tools/check-package-boundary.js');

function readPackageJson() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
}

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
      'dist/mcp/stdio.js'
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
npm notice 1.0kB package/README.md
npm notice 1.0kB package/LICENSE
npm notice 1.0kB package/SECURITY.md
npm notice 1.0kB package/.env.example
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
    'README.md',
    'LICENSE',
    'SECURITY.md',
    '.env.example',
    'tests/config.test.js',
    'tmp/local.json',
    '.npmrc',
    '.cache/playwright/state.json'
  ]);
  assert.deepEqual(result.errors, [
    'disallowed tarball path: tests/config.test.js',
    'disallowed tarball path: tmp/local.json',
    'disallowed tarball path: .npmrc',
    'disallowed tarball path: .cache/playwright/state.json'
  ]);
});
