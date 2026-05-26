#!/usr/bin/env node
'use strict';
const { execSync } = require('node:child_process');
const fs = require('node:fs');

const MIN_LINE = Number(process.env.COVERAGE_MIN_LINE ?? 80);
const MIN_BRANCH = Number(process.env.COVERAGE_MIN_BRANCH ?? 65);
const MIN_FUNCTION = Number(process.env.COVERAGE_MIN_FUNCTION ?? 75);
const COVERAGE_MODE = process.env.COVERAGE_MODE ?? 'full';

/**
 * Test files excluded from CI coverage runs (browser/integration-only).
 */
const CI_EXCLUDED_TESTS = new Set([
  'tests/ontology.test.js',
  'tests/browser-pool.test.js',
  'tests/scraping.test.js',
  'tests/ssrf-dns-rebinding.test.js',
  'tests/mcp.integration.test.js'
]);

/**
 * Source files always excluded from coverage thresholds.
 * These require live network, native binaries (LanceDB), or a full browser
 * runtime (Playwright/Zendriver) and cannot be exercised in any test tier.
 */
const ALWAYS_EXCLUDED_SOURCE_FILES = [
  'zendriver.js',   // Playwright browser engine — requires full browser runtime
  'lancedb.js',     // LanceDB native binary — requires Rust/native module
  'secureProxy.js', // HTTP CONNECT proxy — requires live network sockets
];

/**
 * Additional source files excluded from the gate in CI mode.
 * These are exercised by test files that are excluded in CI
 * (scraping.test.js, browser-pool.test.js, ontology.test.js).
 * In full/local mode those tests run and these files are measured normally.
 */
const CI_ONLY_EXCLUDED_SOURCE_FILES = [
  'ontology.js',    // covered by tests/ontology.test.js  (excluded in CI)
  'browserPool.js', // covered by tests/browser-pool.test.js (excluded in CI)
  'fetcher.js',     // covered by tests/scraping.test.js  (excluded in CI)
  'factory.js',     // covered by tests/scraping.test.js  (excluded in CI)
  'obscura.js',     // covered by tests/scraping.test.js  (excluded in CI)
];

function getCoverageExcludedFiles() {
  const base = [...ALWAYS_EXCLUDED_SOURCE_FILES];
  if (COVERAGE_MODE === 'ci') {
    base.push(...CI_ONLY_EXCLUDED_SOURCE_FILES);
  }
  return base;
}

function quoteForShell(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function resolveCoverageCommand() {
  if (COVERAGE_MODE !== 'ci') {
    return 'node --experimental-test-coverage --test tests/*.test.js';
  }

  const tests = fs
    .readdirSync('tests')
    .filter((name) => name.endsWith('.test.js'))
    .map((name) => `tests/${name}`)
    .filter((file) => !CI_EXCLUDED_TESTS.has(file))
    .sort();

  if (tests.length === 0) {
    throw new Error('No CI coverage tests selected.');
  }

  return `node --experimental-test-coverage --test ${tests.map(quoteForShell).join(' ')}`;
}

// ---------------------------------------------------------------------------
// Run tests + capture coverage output
// ---------------------------------------------------------------------------
const COVERAGE_COMMAND = resolveCoverageCommand();

const output = execSync(COVERAGE_COMMAND, {
  encoding: 'utf8',
  shell: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: process.env
});

process.stdout.write(output);

// ---------------------------------------------------------------------------
// Parse per-file coverage rows from the report table.
// The node test reporter emits rows like:
//   ℹ   foo.js   | 85.00 | 74.42 | 72.22 | uncovered...
// We accumulate lines/branches/functions from all non-excluded files and
// recompute the aggregate ourselves, so integration-only files don't skew
// the threshold gate.
// ---------------------------------------------------------------------------

/**
 * Parse a single coverage row.
 * Returns { file, lines, branches, functions } or null if unparseable.
 */
function parseCoverageRow(line) {
  // Match ℹ prefix (may be multi-byte), then whitespace, filename, then |-separated numbers
  const match = line.match(/(?:ℹ\s+)(\S+\.js)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/);
  if (!match) return null;
  return {
    file: match[1],
    lines: Number(match[2]),
    branches: Number(match[3]),
    functions: Number(match[4]),
  };
}

const COVERAGE_EXCLUDED_FILES = getCoverageExcludedFiles();

const fileRows = output
  .split('\n')
  .map(parseCoverageRow)
  .filter(Boolean)
  .filter((row) => !COVERAGE_EXCLUDED_FILES.some((ex) => row.file.endsWith(ex)));

if (fileRows.length === 0) {
  // Fallback: parse the built-in "all files" aggregate row
  const allFilesLine = output
    .split('\n')
    .find((line) => line.toLowerCase().includes('all files') && line.includes('|'));

  if (!allFilesLine) {
    throw new Error('Coverage summary did not contain an "all files" row.');
  }

  const values = allFilesLine
    .split('|')
    .map((part) => part.trim())
    .filter((part) => /^[0-9]+(\.[0-9]+)?$/.test(part))
    .map(Number);

  if (values.length < 3) {
    throw new Error(`Unable to parse coverage metrics from: ${allFilesLine}`);
  }

  const [lineCoverage, branchCoverage, functionCoverage] = values;
  checkThresholds(lineCoverage, branchCoverage, functionCoverage);
} else {
  // Recompute weighted average from included per-file rows.
  // Each file is treated equally (simple average), consistent with how
  // node --experimental-test-coverage computes the overall aggregate.
  const n = fileRows.length;
  const lineCoverage = fileRows.reduce((s, r) => s + r.lines, 0) / n;
  const branchCoverage = fileRows.reduce((s, r) => s + r.branches, 0) / n;
  const functionCoverage = fileRows.reduce((s, r) => s + r.functions, 0) / n;

  console.log(`\nCoverage gate (${n} files, excluding ${COVERAGE_EXCLUDED_FILES.join(', ')}):`);
  console.log(`  Line:     ${lineCoverage.toFixed(2)}%  (threshold: ${MIN_LINE}%)`);
  console.log(`  Branch:   ${branchCoverage.toFixed(2)}%  (threshold: ${MIN_BRANCH}%)`);
  console.log(`  Function: ${functionCoverage.toFixed(2)}%  (threshold: ${MIN_FUNCTION}%)\n`);

  checkThresholds(lineCoverage, branchCoverage, functionCoverage);
}

function checkThresholds(lineCoverage, branchCoverage, functionCoverage) {
  const failures = [];
  if (lineCoverage < MIN_LINE) {
    failures.push(`line ${lineCoverage.toFixed(2)}% < ${MIN_LINE}%`);
  }
  if (branchCoverage < MIN_BRANCH) {
    failures.push(`branch ${branchCoverage.toFixed(2)}% < ${MIN_BRANCH}%`);
  }
  if (functionCoverage < MIN_FUNCTION) {
    failures.push(`function ${functionCoverage.toFixed(2)}% < ${MIN_FUNCTION}%`);
  }

  if (failures.length > 0) {
    throw new Error(`Coverage thresholds failed: ${failures.join(', ')}`);
  }

  console.log(
    `Coverage thresholds passed (line=${lineCoverage.toFixed(2)}%, branch=${branchCoverage.toFixed(2)}%, function=${functionCoverage.toFixed(2)}%)`
  );
}
