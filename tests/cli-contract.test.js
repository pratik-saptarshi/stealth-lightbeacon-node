const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');

test('compiled cli module exports handlers without running the command', () => {
  const cli = require('../dist/cli.js');

  assert.equal(typeof cli.main, 'function');
  assert.equal(typeof cli.evaluateCommand, 'function');
  assert.equal(typeof cli.searchSemanticCommand, 'function');
  assert.equal(typeof cli.reconCommand, 'function');
  assert.equal(typeof cli.applyReconRecommendation, 'function');
  assert.equal(typeof cli.checkBrokenLinks, 'function');
});

test('searchSemanticCommand emits ranked hit json and closes the store', async () => {
  const cli = require('../dist/cli.js');
  const originalLog = console.log;
  const output = [];
  let closed = false;
  console.log = (message) => output.push(String(message));

  try {
    await cli.searchSemanticCommand('drupal redirect', {
      limit: '2',
      format: 'json',
      createStore: async (options) => {
        assert.match(options.rootDir, /\.data$/);
        return {
          search: async (query, limit) => {
            assert.equal(query, 'drupal redirect');
            assert.equal(limit, 2);
            return [
              {
                id: 'finding-1',
                kind: 'finding',
                label: 'R-SEO-REDIRECT',
                text: 'Redirect chain found',
                url: 'https://example.test/a',
                runId: 'run-1',
                score: 0.91
              }
            ];
          },
          close: async () => {
            closed = true;
          }
        };
      }
    });
  } finally {
    console.log = originalLog;
  }

  assert.equal(closed, true);
  assert.equal(output.length, 1);
  assert.deepEqual(JSON.parse(output[0]), {
    query: 'drupal redirect',
    limit: 2,
    hits: [
      {
        id: 'finding-1',
        kind: 'finding',
        label: 'R-SEO-REDIRECT',
        text: 'Redirect chain found',
        url: 'https://example.test/a',
        runId: 'run-1',
        score: 0.91
      }
    ]
  });
});

test('searchSemanticCommand emits stable empty json for no hits', async () => {
  const cli = require('../dist/cli.js');
  const originalLog = console.log;
  const output = [];
  console.log = (message) => output.push(String(message));

  try {
    await cli.searchSemanticCommand('no matching topic', {
      createStore: async () => ({
        search: async () => [],
        close: async () => {}
      })
    });
  } finally {
    console.log = originalLog;
  }

  assert.deepEqual(JSON.parse(output[0]), {
    query: 'no matching topic',
    limit: 10,
    hits: []
  });
});

test('searchSemanticCommand rejects empty queries before opening a store', async () => {
  const cli = require('../dist/cli.js');
  const originalError = console.error;
  const originalExitCode = process.exitCode;
  const errors = [];
  let opened = false;
  process.exitCode = undefined;
  console.error = (message) => errors.push(String(message));

  try {
    await cli.searchSemanticCommand('   ', {
      createStore: async () => {
        opened = true;
        return {
          search: async () => [],
          close: async () => {}
        };
      }
    });
  } finally {
    console.error = originalError;
  }

  assert.equal(opened, false);
  assert.equal(process.exitCode, 1);
  assert.match(errors.join('\n'), /query is required/i);
  process.exitCode = originalExitCode;
});

test('requiring compiled cli has no stdout stderr or exit side effects', () => {
  const result = spawnSync(
    process.execPath,
    ['-e', "require('./dist/cli.js')"],
    {
      cwd: repoRoot,
      encoding: 'utf8'
    }
  );

  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('compiled cli help exposes semantic search compatibility flag', () => {
  const result = spawnSync(
    process.execPath,
    ['dist/cli.js', '--help'],
    {
      cwd: repoRoot,
      encoding: 'utf8'
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /--search-semantic <query>/);
});

test('evaluateCommand fails fast when http2 is requested before audit side effects', async () => {
  const cli = require('../dist/cli.js');
  const originalError = console.error;
  const originalExitCode = process.exitCode;
  const errors = [];
  process.exitCode = undefined;
  console.error = (message) => errors.push(String(message));

  try {
    await cli.evaluateCommand('example.com', {
      http2: true,
      out: 'reports',
      format: 'json'
    });
  } finally {
    console.error = originalError;
  }

  assert.equal(process.exitCode, 1);
  assert.match(errors.join('\n'), /HTTP\/2 transport is not supported/i);
  process.exitCode = originalExitCode;
});

test('recon command emits recommendation json without full audit artifacts', async () => {
  const cli = require('../dist/cli.js');
  const originalLog = console.log;
  const output = [];
  console.log = (message) => output.push(String(message));

  try {
    await cli.reconCommand('http://example.test/', {
      allowPrivate: true,
      fetchFn: async () => ({
        status: 200,
        headers: {
          server: 'cloudflare',
          'cf-ray': 'test-ray'
        },
        text: async () => '<html><title>Just a moment...</title><body>cf-challenge</body></html>'
      })
    });

    assert.equal(output.length, 1);
    const payload = JSON.parse(output[0]);
    assert.deepEqual(payload.detectedProtections, ['Cloudflare']);
    assert.equal(payload.recommendedEngine, 'stealth');
    assert.equal(payload.recommendedThrottleMs, 1500);
  } finally {
    console.log = originalLog;
  }
});

test('recon-auto derives audit engine and throttle from recommendation', () => {
  const cli = require('../dist/cli.js');

  const options = cli.applyReconRecommendation(
    { engine: 'http', throttleMs: 0 },
    {
      detectedProtections: ['Cloudflare'],
      recommendedEngine: 'stealth',
      recommendedThrottleMs: 1500,
      reason: 'challenge detected'
    }
  );

  assert.equal(options.engine, 'stealth');
  assert.equal(options.throttleMs, 1500);
  assert.deepEqual(options.reconRecommendation.detectedProtections, ['Cloudflare']);
});
