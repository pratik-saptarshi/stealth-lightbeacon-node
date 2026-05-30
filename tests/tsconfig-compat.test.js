const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('tsconfig keeps CommonJS mode and sets ignoreDeprecations for legacy Node resolution', () => {
  const tsconfigPath = path.join(__dirname, '..', 'tsconfig.json');
  const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));
  const compilerOptions = tsconfig.compilerOptions ?? {};

  assert.equal(compilerOptions.module, 'CommonJS');
  assert.equal(compilerOptions.moduleResolution, 'Node');
  assert.equal(compilerOptions.ignoreDeprecations, '5.0');
});
