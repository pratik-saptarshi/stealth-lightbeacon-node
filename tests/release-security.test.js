const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateReleaseSecurityGate } = require('../tools/check-release-security.js');

const rootDir = path.join(__dirname, '..');

test('release security gate fails with actionable missing evidence', () => {
  const result = validateReleaseSecurityGate({
    checklist: '- pnpm run quality:check',
    bom: '',
    packageJson: { scripts: { 'quality:check': 'ok' } }
  });

  assert.ok(result.errors.includes('missing checklist gate: audit'));
  assert.ok(result.errors.includes('missing checklist gate: sbom'));
  assert.ok(result.errors.includes('missing BOM evidence path: sbom-evidence'));
  assert.ok(result.errors.includes('missing package script: audit:signatures'));
});

test('current release docs map security gates to commands evidence and manual decisions', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const checklist = fs.readFileSync(path.join(rootDir, 'docs', 'publishing-roadmap-checklist.md'), 'utf8');
  const bom = fs.readFileSync(path.join(rootDir, 'docs', 'bill-of-materials.html.md'), 'utf8');

  assert.deepEqual(validateReleaseSecurityGate({ checklist, bom, packageJson }).errors, []);
});
