const assert = require('node:assert/strict');
const test = require('node:test');

const { evaluateCoverageReport } = require('../tools/check-coverage.js');

test('coverage gate fails included files below per-file thresholds even when aggregate passes', () => {
  const report = [
    'ℹ file                         | line % | branch % | funcs % | uncovered lines',
    'ℹ   weak.js                   |  80.00 |    80.00 |   80.00 | 1-2',
    'ℹ   strong.js                 | 100.00 |   100.00 |  100.00 |',
  ].join('\n');

  assert.throws(
    () =>
      evaluateCoverageReport(report, {
        excludedFiles: [],
        minLine: 85,
        minBranch: 85,
        minFunction: 85,
      }),
    /weak\.js line 80\.00% < 85%, branch 80\.00% < 85%, function 80\.00% < 85%/
  );
});

test('coverage gate ignores files in the explicit exception registry', () => {
  const report = [
    'ℹ file                         | line % | branch % | funcs % | uncovered lines',
    'ℹ   weak.js                   |  10.00 |    10.00 |   10.00 | 1-2',
    'ℹ   strong.js                 |  90.00 |    90.00 |   90.00 |',
  ].join('\n');

  const result = evaluateCoverageReport(report, {
    excludedFiles: ['weak.js'],
    minLine: 85,
    minBranch: 85,
    minFunction: 85,
  });

  assert.equal(result.fileCount, 1);
  assert.equal(result.lineCoverage, 90);
  assert.equal(result.branchCoverage, 90);
  assert.equal(result.functionCoverage, 90);
});

test('coverage gate falls back to all-files aggregate when no file rows are present', () => {
  const report = 'ℹ all files                    |  88.00 |    87.00 |   86.00 |';

  const result = evaluateCoverageReport(report, {
    excludedFiles: [],
    minLine: 85,
    minBranch: 85,
    minFunction: 85,
  });

  assert.equal(result.fileCount, 0);
  assert.equal(result.lineCoverage, 88);
  assert.equal(result.branchCoverage, 87);
  assert.equal(result.functionCoverage, 86);
});

test('coverage exception registry is scoped to report-relative file paths', () => {
  const report = [
    'ℹ file                         | line % | branch % | funcs % | uncovered lines',
    'ℹ dist                         |        |          |         |',
    'ℹ  mcp                         |        |          |         |',
    'ℹ   server.js                  |  60.00 |    60.00 |   60.00 | 1-2',
    'ℹ  service                     |        |          |         |',
    'ℹ   server.js                  | 100.00 |   100.00 |  100.00 |',
  ].join('\n');

  const result = evaluateCoverageReport(report, {
    excludedFiles: ['dist/mcp/server.js'],
    minLine: 85,
    minBranch: 85,
    minFunction: 85,
  });

  assert.equal(result.fileCount, 1);
  assert.equal(result.fileRows[0].file, 'dist/service/server.js');
});
