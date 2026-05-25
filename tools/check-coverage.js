#!/usr/bin/env node
const { execSync } = require('node:child_process');

const MIN_LINE = Number(process.env.COVERAGE_MIN_LINE ?? 80);
const MIN_BRANCH = Number(process.env.COVERAGE_MIN_BRANCH ?? 65);
const MIN_FUNCTION = Number(process.env.COVERAGE_MIN_FUNCTION ?? 75);

const output = execSync('node --experimental-test-coverage --test tests/*.test.js', {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe']
});

process.stdout.write(output);

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
const failures = [];

if (lineCoverage < MIN_LINE) {
  failures.push(`line ${lineCoverage}% < ${MIN_LINE}%`);
}
if (branchCoverage < MIN_BRANCH) {
  failures.push(`branch ${branchCoverage}% < ${MIN_BRANCH}%`);
}
if (functionCoverage < MIN_FUNCTION) {
  failures.push(`function ${functionCoverage}% < ${MIN_FUNCTION}%`);
}

if (failures.length > 0) {
  throw new Error(`Coverage thresholds failed: ${failures.join(', ')}`);
}

console.log(
  `Coverage thresholds passed (line=${lineCoverage}%, branch=${branchCoverage}%, function=${functionCoverage}%)`
);
