const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateReleaseSecurityGate } = require('../tools/check-release-security.js');

const rootDir = path.join(__dirname, '..');

const requiredChecklist = [
  '- [x] `AUTO` `pnpm run quality:check`.',
  '- [x] `AUTO` `pnpm audit --prod` passes locally and in CI.',
  '- [x] `MANUAL` Secret scan covers repository and packed tarball output before publish.',
  '- [x] `MANUAL` SBOM generated and attached if required by org policy; evidence path `.tmp/release-evidence/sbom.cyclonedx.json`.',
  '- [x] `AUTO` `pnpm pack --dry-run` runs in CI.',
  '- [x] `MANUAL` Artifact hygiene review covers generated reports, caches, local config, packed tarball contents, and release evidence redaction.',
  '- [x] `MANUAL` Release evidence redacts API keys, cookies, auth headers, private hostnames, customer data, and proprietary page contents.',
  '- [x] `EVIDENCE` Secret scan output captured at `.tmp/release-evidence/secret-scan.txt`.',
  '- [x] `EVIDENCE` Prod audit output captured at `.tmp/release-evidence/audit-prod.txt`.',
  '- [x] `EVIDENCE` Pack dry-run output captured at `.tmp/release-evidence/pack-dry-run.txt`.'
].join('\n');

const requiredBom = [
  '- `.tmp/release-evidence/sbom.cyclonedx.json`',
  '- `.tmp/release-evidence/secret-scan.txt`',
  '- `.tmp/release-evidence/audit-prod.txt`',
  '- `.tmp/release-evidence/pack-dry-run.txt`'
].join('\n');

const packageJsonWithReleaseScripts = {
  scripts: {
    'quality:check': 'ok',
    'audit:signatures': 'pnpm audit --prod',
    'pack:dry': 'pnpm pack --dry-run',
    'release:dry': './tools/release.sh --dry-run --ci'
  }
};

function createEvidenceFixture(t) {
  const tempDir = fs.mkdtempSync(path.join(__dirname, 'release-evidence-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const evidenceDir = path.join(tempDir, '.tmp', 'release-evidence');
  fs.mkdirSync(evidenceDir, { recursive: true });
  for (const file of ['sbom.cyclonedx.json', 'secret-scan.txt', 'audit-prod.txt', 'pack-dry-run.txt']) {
    fs.writeFileSync(path.join(evidenceDir, file), 'captured\n');
  }
  return tempDir;
}

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

test('release security gate fails when release scripts use placeholders or wrong commands', () => {
  const result = validateReleaseSecurityGate({
    checklist: '',
    bom: '',
    packageJson: {
      scripts: {
        'quality:check': 'ok',
        'audit:signatures': 'pnpm audit',
        'pack:dry': 'ok',
        'release:dry': './tools/release.sh'
      }
    }
  });

  assert.ok(result.errors.includes('invalid package script: audit:signatures'));
  assert.ok(result.errors.includes('invalid package script: pack:dry'));
  assert.ok(result.errors.includes('invalid package script: release:dry'));
});

test('release security gate fails when required checklist items are unchecked', (t) => {
  const evidenceRoot = createEvidenceFixture(t);
  const result = validateReleaseSecurityGate({
    checklist: requiredChecklist.replace('- [x] `AUTO` `pnpm audit --prod`', '- [ ] `AUTO` `pnpm audit --prod`'),
    bom: requiredBom,
    packageJson: packageJsonWithReleaseScripts,
    evidenceRoot
  });

  assert.ok(result.errors.includes('unchecked checklist gate: audit'));
});

test('release security gate fails when required evidence files are missing', (t) => {
  const evidenceRoot = createEvidenceFixture(t);
  fs.rmSync(path.join(evidenceRoot, '.tmp', 'release-evidence', 'sbom.cyclonedx.json'), { force: true });

  const result = validateReleaseSecurityGate({
    checklist: requiredChecklist,
    bom: requiredBom,
    packageJson: packageJsonWithReleaseScripts,
    evidenceRoot
  });

  assert.ok(result.errors.includes('missing evidence file: .tmp/release-evidence/sbom.cyclonedx.json'));
});

test('release security gate passes when checklist is complete and evidence files exist', (t) => {
  const evidenceRoot = createEvidenceFixture(t);
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

  assert.deepEqual(validateReleaseSecurityGate({
    checklist: requiredChecklist,
    bom: requiredBom,
    packageJson,
    evidenceRoot
  }).errors, []);
});
