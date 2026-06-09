#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const EXPECTED_FILES = [
  'dist/**/*.js',
  'README.md',
  'readme.md',
  'LICENSE',
  'SECURITY.md',
  '.env.example'
];

const EXPECTED_BIN = {
  'stealth-lightbeacon': 'dist/cli.js',
  'stealth-lightbeacon-mcp': 'dist/mcp/stdio.js'
};

const ALWAYS_INCLUDED = new Set(['package.json']);

function normalizePackPath(filePath) {
  return filePath
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^package\//, '');
}

function parsePackDryRunFiles(output) {
  const files = [];
  let inTarballContents = false;

  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    const content = trimmed.replace(/^npm notice\s+/i, '');

    if (!content) {
      continue;
    }

    if (/^=*\s*Tarball Contents\s*=*$/i.test(content)) {
      inTarballContents = true;
      continue;
    }

    if (/^=*\s*Tarball Details\s*=*$/i.test(content)) {
      inTarballContents = false;
      continue;
    }

    const sizeLine = content.match(/^(?:[\d.]+\s*[KMGT]?B\s+)(.+)$/i);
    if (sizeLine) {
      files.push(normalizePackPath(sizeLine[1]));
      continue;
    }

    if (inTarballContents) {
      files.push(normalizePackPath(content));
    }
  }

  return files.filter(Boolean);
}

function arraysEqual(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function objectsEqual(actual, expected) {
  const actualKeys = actual && typeof actual === 'object' ? Object.keys(actual) : [];
  const expectedKeys = Object.keys(expected);
  return actualKeys.length === expectedKeys.length
    && expectedKeys.every((key) => actual[key] === expected[key]);
}

function isAllowedByFilesPolicy(filePath, packageFiles) {
  if (ALWAYS_INCLUDED.has(filePath)) {
    return true;
  }

  return packageFiles.some((entry) => {
    if (entry.endsWith('/**/*.js')) {
      const prefix = entry.slice(0, -'/**/*.js'.length);
      return filePath.startsWith(`${prefix}/`) && filePath.endsWith('.js');
    }

    return filePath === entry || filePath.startsWith(`${entry}/`);
  });
}

function isDisallowedArtifact(filePath) {
  return [
    /^tests?\//,
    /^tmp\//,
    /^temp\//,
    /^\.cache\//,
    /^dist\/.*\.tsbuildinfo$/,
    /^\.npmrc$/,
    /^\.env(?:\.|$)/,
    /^node_modules\//,
    /^coverage\//,
    /^playwright-report\//,
    /^\.beads\//,
    /^\.codex\//,
    /^\.agents\//
  ].some((pattern) => pattern.test(filePath)) && filePath !== '.env.example';
}

function validatePackageBoundary({ packageJson, files }) {
  const errors = [];
  const packageFiles = Array.isArray(packageJson.files) ? packageJson.files : [];

  if (!Array.isArray(files) || files.length === 0) {
    errors.push('no tarball files parsed from pack dry-run output');
  }

  if (!arraysEqual(packageJson.files, EXPECTED_FILES)) {
    errors.push(`package.json files must equal ${JSON.stringify(EXPECTED_FILES)}`);
  }

  if (!objectsEqual(packageJson.bin, EXPECTED_BIN)) {
    errors.push(`package.json bin must equal ${JSON.stringify(EXPECTED_BIN)}`);
  }

  for (const [binName, binPath] of Object.entries(packageJson.bin || {})) {
    if (!binPath.startsWith('dist/') || !binPath.endsWith('.js')) {
      errors.push(`bin ${binName} must point to a dist/*.js entry`);
    }
  }

  for (const rawFile of files) {
    const filePath = normalizePackPath(rawFile);
    if (isDisallowedArtifact(filePath) || !isAllowedByFilesPolicy(filePath, packageFiles)) {
      errors.push(`disallowed tarball path: ${filePath}`);
    }
  }

  return { errors };
}

function readPackageJson(rootDir) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
}

function main() {
  const rootDir = path.join(__dirname, '..');
  const inputPath = process.argv[2];
  const dryRunOutput = inputPath
    ? fs.readFileSync(inputPath, 'utf8')
    : fs.readFileSync(0, 'utf8');
  const files = parsePackDryRunFiles(dryRunOutput);
  const result = validatePackageBoundary({ packageJson: readPackageJson(rootDir), files });

  if (result.errors.length > 0) {
    for (const error of result.errors) {
      console.error(error);
    }
    process.exitCode = 1;
  }
}

module.exports = {
  parsePackDryRunFiles,
  validatePackageBoundary
};

if (require.main === module) {
  main();
}
