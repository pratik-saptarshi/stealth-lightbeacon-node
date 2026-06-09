#!/usr/bin/env node
'use strict';
const { execSync } = require('node:child_process');
const fs = require('node:fs');

const MIN_LINE = Number(process.env.COVERAGE_MIN_LINE ?? 85);
const MIN_BRANCH = Number(process.env.COVERAGE_MIN_BRANCH ?? 85);
const MIN_FUNCTION = Number(process.env.COVERAGE_MIN_FUNCTION ?? 85);
const COVERAGE_MODE = process.env.COVERAGE_MODE ?? 'full';

const CI_EXCLUDED_TESTS = new Set([
  'tests/ontology.test.js',
  'tests/browser-pool.test.js',
  'tests/scraping.test.js',
  'tests/ssrf-dns-rebinding.test.js',
  'tests/mcp.integration.test.js'
]);

const ALWAYS_EXCLUDED_SOURCE_FILES = [
  'zendriver.js',
  'lancedb.js',
  'secureProxy.js',
];

const CI_ONLY_EXCLUDED_SOURCE_FILES = [
  'ontology.js',
  'browserPool.js',
  'fetcher.js',
  'factory.js',
  'obscura.js',
];

const APPROVED_PER_FILE_COVERAGE_EXCEPTIONS = [
  'dist/cli.js',
  'dist/core/cache.js',
  'dist/core/db/duckdb.js',
  'dist/core/fetcher.js',
  'dist/core/ontology.js',
  'dist/core/orchestrator.js',
  'dist/core/pagespeed.js',
  'dist/core/reporter.js',
  'dist/core/robots.js',
  'dist/core/scraping/factory.js',
  'dist/core/scraping/obscura.js',
  'dist/core/selectorHealer.js',
  'dist/core/ssrf.js',
  'dist/core/watcher.js',
  'dist/evaluators/geo.js',
  'dist/mcp/client.js',
  'dist/mcp/server.js',
  'dist/service/artifacts.js',
  'dist/service/config.js',
  'tools/check-coverage.js',
  'tools/check-package-boundary.js',
  'tools/check-release-security.js',
];

function getCoverageExcludedFiles() {
  const base = [
    ...ALWAYS_EXCLUDED_SOURCE_FILES,
    ...APPROVED_PER_FILE_COVERAGE_EXCEPTIONS,
  ];
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
    return 'node --experimental-test-coverage --test tests/*.test.js tests/integration/*.test.js';
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

  return `node --experimental-test-coverage --test ${tests.map(quoteForShell).join(' ')} tests/integration/*.test.js`;
}

function parseCoverageRow(line) {
  const match = line.match(/(?:ℹ\s+)(\S+\.js)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/);
  if (!match) return null;
  return {
    file: match[1],
    lines: Number(match[2]),
    branches: Number(match[3]),
    functions: Number(match[4]),
  };
}

function parseCoverageRows(output) {
  const directories = [];
  const rows = [];

  for (const line of output.split('\n')) {
    const tableMatch = line.match(/^ℹ(\s+)(\S+)\s*\|/);
    if (!tableMatch) {
      continue;
    }

    const indent = tableMatch[1].length;
    const name = tableMatch[2];
    const row = parseCoverageRow(line);
    if (row) {
      const pathPrefix = directories
        .filter((directory) => directory.indent < indent)
        .map((directory) => directory.name);
      rows.push({ ...row, file: [...pathPrefix, row.file].join('/') });
      continue;
    }

    if (name.endsWith('.js') || name === 'file' || name === 'all') {
      continue;
    }

    while (directories.length > 0 && directories[directories.length - 1].indent >= indent) {
      directories.pop();
    }
    directories.push({ indent, name });
  }

  return rows;
}

function filterIncludedRows(output, excludedFiles) {
  return parseCoverageRows(output)
    .filter((row) => !excludedFiles.some((ex) => row.file.endsWith(ex)));
}

function parseAllFilesCoverage(output) {
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
  return { lineCoverage, branchCoverage, functionCoverage };
}

function computeAggregate(fileRows) {
  const fileCount = fileRows.length;
  return {
    fileCount,
    lineCoverage: fileRows.reduce((sum, row) => sum + row.lines, 0) / fileCount,
    branchCoverage: fileRows.reduce((sum, row) => sum + row.branches, 0) / fileCount,
    functionCoverage: fileRows.reduce((sum, row) => sum + row.functions, 0) / fileCount,
  };
}

function checkThresholds(
  lineCoverage,
  branchCoverage,
  functionCoverage,
  { minLine = MIN_LINE, minBranch = MIN_BRANCH, minFunction = MIN_FUNCTION } = {}
) {
  const failures = [];
  if (lineCoverage < minLine) {
    failures.push(`line ${lineCoverage.toFixed(2)}% < ${minLine}%`);
  }
  if (branchCoverage < minBranch) {
    failures.push(`branch ${branchCoverage.toFixed(2)}% < ${minBranch}%`);
  }
  if (functionCoverage < minFunction) {
    failures.push(`function ${functionCoverage.toFixed(2)}% < ${minFunction}%`);
  }

  if (failures.length > 0) {
    throw new Error(`Coverage thresholds failed: ${failures.join(', ')}`);
  }
}

function checkPerFileThresholds(fileRows, minLine, minBranch, minFunction) {
  const failures = [];
  for (const row of fileRows) {
    const rowFailures = [];
    if (row.lines < minLine) {
      rowFailures.push(`line ${row.lines.toFixed(2)}% < ${minLine}%`);
    }
    if (row.branches < minBranch) {
      rowFailures.push(`branch ${row.branches.toFixed(2)}% < ${minBranch}%`);
    }
    if (row.functions < minFunction) {
      rowFailures.push(`function ${row.functions.toFixed(2)}% < ${minFunction}%`);
    }
    if (rowFailures.length > 0) {
      failures.push(`${row.file} ${rowFailures.join(', ')}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Per-file coverage thresholds failed: ${failures.join('; ')}`);
  }
}

function evaluateCoverageReport(
  output,
  {
    excludedFiles = getCoverageExcludedFiles(),
    minLine = MIN_LINE,
    minBranch = MIN_BRANCH,
    minFunction = MIN_FUNCTION,
  } = {}
) {
  const fileRows = filterIncludedRows(output, excludedFiles);
  if (fileRows.length === 0) {
    const aggregate = parseAllFilesCoverage(output);
    checkThresholds(aggregate.lineCoverage, aggregate.branchCoverage, aggregate.functionCoverage, {
      minLine,
      minBranch,
      minFunction,
    });
    return { fileCount: 0, fileRows, ...aggregate };
  }

  checkPerFileThresholds(fileRows, minLine, minBranch, minFunction);
  const aggregate = computeAggregate(fileRows);
  checkThresholds(aggregate.lineCoverage, aggregate.branchCoverage, aggregate.functionCoverage, {
    minLine,
    minBranch,
    minFunction,
  });
  return { fileRows, ...aggregate };
}

function printCoverageResult(result, excludedFiles) {
  const { fileCount, lineCoverage, branchCoverage, functionCoverage } = result;
  console.log(`\nCoverage gate (${fileCount} files, excluding ${excludedFiles.join(', ')}):`);
  console.log(`  Line:     ${lineCoverage.toFixed(2)}%  (threshold: ${MIN_LINE}%)`);
  console.log(`  Branch:   ${branchCoverage.toFixed(2)}%  (threshold: ${MIN_BRANCH}%)`);
  console.log(`  Function: ${functionCoverage.toFixed(2)}%  (threshold: ${MIN_FUNCTION}%)\n`);
  console.log(
    `Coverage thresholds passed (line=${lineCoverage.toFixed(2)}%, branch=${branchCoverage.toFixed(2)}%, function=${functionCoverage.toFixed(2)}%)`
  );
}

function main() {
  const output = execSync(resolveCoverageCommand(), {
    encoding: 'utf8',
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env
  });

  process.stdout.write(output);
  const excludedFiles = getCoverageExcludedFiles();
  printCoverageResult(evaluateCoverageReport(output, { excludedFiles }), excludedFiles);
}

if (require.main === module) {
  main();
}

module.exports = {
  evaluateCoverageReport,
  parseCoverageRow,
  parseCoverageRows,
};
