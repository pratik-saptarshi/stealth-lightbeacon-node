#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_CHECKLIST_PATTERNS = [
  { id: 'quality', pattern: /pnpm run quality:check/ },
  { id: 'audit', pattern: /pnpm audit --prod/ },
  { id: 'secret-scan', pattern: /secret scan/i },
  { id: 'sbom', pattern: /SBOM/i },
  { id: 'pack', pattern: /pnpm pack --dry-run/ },
  { id: 'artifact-hygiene', pattern: /artifact hygiene|generated report artifacts|Tarball includes unintended/i },
  { id: 'manual-decision', pattern: /MANUAL/ },
  { id: 'evidence-path', pattern: /\.tmp\/release-evidence\// }
];

const REQUIRED_BOM_PATTERNS = [
  { id: 'sbom-evidence', pattern: /\.tmp\/release-evidence\/sbom\.cyclonedx\.json/ },
  { id: 'secret-scan-evidence', pattern: /\.tmp\/release-evidence\/secret-scan\.txt/ },
  { id: 'pack-evidence', pattern: /\.tmp\/release-evidence\/pack-dry-run\.txt/ },
  { id: 'audit-evidence', pattern: /\.tmp\/release-evidence\/audit-prod\.txt/ }
];

const REQUIRED_EVIDENCE_FILES = [
  '.tmp/release-evidence/sbom.cyclonedx.json',
  '.tmp/release-evidence/secret-scan.txt',
  '.tmp/release-evidence/audit-prod.txt',
  '.tmp/release-evidence/pack-dry-run.txt'
];

const SBOM_EVIDENCE_FILE = '.tmp/release-evidence/sbom.cyclonedx.json';

const REQUIRED_PACKAGE_SCRIPTS = {
  'quality:check': null,
  'audit:signatures': 'pnpm audit --prod',
  'pack:dry': 'pnpm pack --dry-run',
  'release:dry': './tools/release.sh --dry-run --ci'
};

function hasCheckedChecklistItem(checklist, pattern) {
  return checklist
    .split(/\r?\n/)
    .some((line) => /^-\s+\[[xX]\]/.test(line) && pattern.test(line));
}

function hasValidSbomShape(sbom) {
  if (sbom === null || typeof sbom !== 'object' || Array.isArray(sbom)) {
    return false;
  }

  const isCycloneDx =
    sbom.bomFormat === 'CycloneDX' &&
    typeof sbom.specVersion === 'string' &&
    Array.isArray(sbom.components);

  const isSpdx =
    typeof sbom.spdxVersion === 'string' &&
    typeof sbom.SPDXID === 'string' &&
    Array.isArray(sbom.packages);

  return isCycloneDx || isSpdx;
}

function validateReleaseSecurityGate(input) {
  const checklist = input.checklist ?? '';
  const bom = input.bom ?? '';
  const packageJson = input.packageJson ?? {};
  const evidenceRoot = input.evidenceRoot ?? path.join(__dirname, '..');
  const errors = [];

  for (const requirement of REQUIRED_CHECKLIST_PATTERNS) {
    if (hasCheckedChecklistItem(checklist, requirement.pattern)) {
      continue;
    }
    if (requirement.pattern.test(checklist)) {
      errors.push(`unchecked checklist gate: ${requirement.id}`);
    } else {
      errors.push(`missing checklist gate: ${requirement.id}`);
    }
  }

  for (const requirement of REQUIRED_BOM_PATTERNS) {
    if (!requirement.pattern.test(bom)) {
      errors.push(`missing BOM evidence path: ${requirement.id}`);
    }
  }

  for (const file of REQUIRED_EVIDENCE_FILES) {
    const filePath = path.join(evidenceRoot, file);
    if (!fs.existsSync(filePath)) {
      errors.push(`missing evidence file: ${file}`);
      continue;
    }
    if (fs.statSync(filePath).size === 0) {
      errors.push(`empty evidence file: ${file}`);
    }
  }

  const sbomPath = path.join(evidenceRoot, SBOM_EVIDENCE_FILE);
  if (fs.existsSync(sbomPath) && fs.statSync(sbomPath).size > 0) {
    try {
      const sbom = JSON.parse(fs.readFileSync(sbomPath, 'utf8'));
      if (!hasValidSbomShape(sbom)) {
        errors.push(`invalid SBOM evidence: ${SBOM_EVIDENCE_FILE}`);
      }
    } catch {
      errors.push(`invalid SBOM evidence: ${SBOM_EVIDENCE_FILE}`);
    }
  }

  const scripts = packageJson.scripts ?? {};
  for (const [script, expectedCommand] of Object.entries(REQUIRED_PACKAGE_SCRIPTS)) {
    if (!Object.hasOwn(scripts, script)) {
      errors.push(`missing package script: ${script}`);
      continue;
    }
    if (expectedCommand !== null && scripts[script] !== expectedCommand) {
      errors.push(`invalid package script: ${script}`);
    }
  }

  return { errors };
}

function main() {
  const rootDir = path.join(__dirname, '..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const checklist = fs.readFileSync(path.join(rootDir, 'docs', 'publishing-roadmap-checklist.md'), 'utf8');
  const bom = fs.readFileSync(path.join(rootDir, 'docs', 'bill-of-materials.html.md'), 'utf8');
  const result = validateReleaseSecurityGate({ checklist, bom, packageJson });

  if (result.errors.length > 0) {
    for (const error of result.errors) {
      console.error(error);
    }
    process.exitCode = 1;
    return;
  }

  console.log('Release security compliance gate passed.');
}

if (require.main === module) {
  main();
}

module.exports = {
  validateReleaseSecurityGate
};
