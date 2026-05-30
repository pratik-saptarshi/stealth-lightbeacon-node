const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('tsconfig sets ignoreDeprecations to keep moduleResolution Node compatible with TS 6+', () => {
  const tsconfigPath = path.join(__dirname, '..', 'tsconfig.json');
  const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));
  const compilerOptions = tsconfig.compilerOptions ?? {};

  assert.equal(compilerOptions.moduleResolution, 'Node');
  assert.equal(
    compilerOptions.ignoreDeprecations,
    '6.0',
    'Expected compilerOptions.ignoreDeprecations="6.0" to prevent TS5107 build failures'
  );
});
