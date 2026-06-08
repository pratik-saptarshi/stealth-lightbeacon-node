const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readScripts() {
  const packageJsonPath = path.join(__dirname, '..', 'package.json');
  return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')).scripts;
}

function readPackageJson() {
  const packageJsonPath = path.join(__dirname, '..', 'package.json');
  return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
}

function readNpmrc() {
  return fs.readFileSync(path.join(__dirname, '..', '.npmrc'), 'utf8');
}

function readCiWorkflow() {
  return fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'ci.yml'), 'utf8');
}

function readAuditWorkflow() {
  return fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'stealth-lightbeacon-audit.yml'), 'utf8');
}

test('non-interactive quality gates invoke tools directly without nested pnpm run', () => {
  const scripts = readScripts();

  assert.equal(scripts.build, 'tsc -p tsconfig.json');
  assert.equal(scripts.typecheck, 'tsc -p tsconfig.json --noEmit --incremental false');
  assert.equal(scripts['coverage:check'], 'node tools/check-coverage.js');
  assert.equal(scripts['quality:coverage'], 'COVERAGE_MODE=ci node tools/check-coverage.js');
  assert.equal(scripts['release:dry'], './tools/release.sh --dry-run --ci');
  assert.equal(
    scripts['quality:check'],
    "tsc -p tsconfig.json --noEmit --incremental false && node --test $(ls tests/*.test.js | grep -Ev 'tests/(ontology|browser-pool|scraping|ssrf-dns-rebinding|mcp\\.integration)\\.test\\.js') && node --test tests/mcp.test.js && COVERAGE_MODE=ci node tools/check-coverage.js"
  );
});

test('pnpm scripts use a non-interactive POSIX shell', () => {
  const npmrc = readNpmrc();

  assert.match(npmrc, /^script-shell=\/bin\/sh$/m);
  assert.match(npmrc, /^manage-package-manager-versions=false$/m);
});

test('ci node matrix satisfies package engine policy', () => {
  const packageJson = readPackageJson();
  const workflow = readCiWorkflow();
  const minimumMajor = Number(packageJson.engines.node.match(/>=\s*(\d+)/)?.[1]);
  assert.ok(Number.isInteger(minimumMajor), `Unsupported node engine range: ${packageJson.engines.node}`);

  const matrixMatch = workflow.match(/node-version:\s*\[([^\]]+)\]/);
  assert.ok(matrixMatch, 'CI workflow must define a node-version matrix');
  const versions = matrixMatch[1].split(',').map((version) => version.trim());
  assert.ok(versions.length > 0, 'CI workflow must test at least one Node version');

  for (const version of versions) {
    const major = Number(version.match(/^(\d+)/)?.[1]);
    assert.ok(Number.isInteger(major), `Unsupported CI node-version entry: ${version}`);
    assert.ok(
      major >= minimumMajor,
      `CI node-version ${version} does not satisfy package engine ${packageJson.engines.node}`
    );
  }
});

test('all github workflow node versions satisfy package engine policy', () => {
  const packageJson = readPackageJson();
  const minimumMajor = Number(packageJson.engines.node.match(/>=\s*(\d+)/)?.[1]);
  assert.ok(Number.isInteger(minimumMajor), `Unsupported node engine range: ${packageJson.engines.node}`);

  const workflows = {
    'ci.yml': readCiWorkflow(),
    'stealth-lightbeacon-audit.yml': readAuditWorkflow()
  };

  for (const [workflowName, workflow] of Object.entries(workflows)) {
    const matches = workflow.matchAll(/node-version:\s*(?:\[([^\]]+)\]|['"]?([0-9]+(?:\.x)?)['"]?)/g);
    const versions = Array.from(matches, (match) => match[1] ?? match[2])
      .flatMap((entry) => entry.split(',').map((version) => version.trim()));
    assert.ok(versions.length > 0, `${workflowName} must configure Node.js`);

    for (const version of versions) {
      const major = Number(version.match(/^(\d+)/)?.[1]);
      assert.ok(Number.isInteger(major), `Unsupported Node version in ${workflowName}: ${version}`);
      assert.ok(
        major >= minimumMajor,
        `${workflowName} node-version ${version} does not satisfy package engine ${packageJson.engines.node}`
      );
    }
  }
});

test('github workflows install pnpm before setup-node cache uses it', () => {
  const workflows = {
    'ci.yml': readCiWorkflow(),
    'stealth-lightbeacon-audit.yml': readAuditWorkflow()
  };

  for (const [workflowName, workflow] of Object.entries(workflows)) {
    const pnpmSetupIndex = workflow.indexOf('pnpm/action-setup@v4');
    const setupNodeIndex = workflow.indexOf('actions/setup-node@v4');
    assert.notEqual(pnpmSetupIndex, -1, `${workflowName} must install pnpm before setup-node cache`);
    assert.notEqual(setupNodeIndex, -1, `${workflowName} must configure setup-node`);
    assert.ok(
      pnpmSetupIndex < setupNodeIndex,
      `${workflowName} must run pnpm/action-setup before actions/setup-node cache`
    );
  }
});

test('github workflows pin pnpm to package manager version', () => {
  const packageJson = readPackageJson();
  const pnpmVersion = packageJson.packageManager.match(/^pnpm@(.+)$/)?.[1];
  assert.match(pnpmVersion ?? '', /^\d+\.\d+\.\d+$/);

  for (const workflow of [readCiWorkflow(), readAuditWorkflow()]) {
    assert.match(workflow, new RegExp(`version: '${pnpmVersion.replaceAll('.', '\\.')}'`));
  }
});

test('scheduled audit workflow invokes the built cli artifact directly', () => {
  const workflow = readAuditWorkflow();

  assert.match(workflow, /node dist\/cli\.js evaluate "\$AUDIT_TARGET_URL"/);
  assert.match(workflow, /--no-persist/);
  assert.doesNotMatch(workflow, /pnpm exec stealth-lightbeacon/);
});

test('package metadata satisfies public publish gate', () => {
  const packageJson = readPackageJson();

  assert.equal(packageJson.license, 'MIT');
  assert.match(packageJson.author, /\S/);
  assert.equal(packageJson.repository?.type, 'git');
  assert.match(packageJson.repository?.url ?? '', /^git\+https:\/\/github\.com\/.+\.git$/);
  assert.match(packageJson.homepage ?? '', /^https:\/\/github\.com\/.+#readme$/);
  assert.match(packageJson.bugs?.url ?? '', /^https:\/\/github\.com\/.+\/issues$/);
  assert.equal(packageJson.publishConfig?.access, 'public');
  assert.deepEqual(packageJson.files, [
    'dist/**/*.js',
    'README.md',
    'readme.md',
    'LICENSE',
    'SECURITY.md',
    '.env.example'
  ]);
  assert.ok(!packageJson.files.includes('dist'), 'Package must not include broad dist folder');
  assert.ok(!packageJson.files.some((entry) => entry.includes('tsbuildinfo')));
});

test('public npm package does not block npm global install with preinstall', () => {
  const scripts = readScripts();

  assert.equal(scripts.preinstall, undefined);
});

test('ts-node source tests have direct node type definitions', () => {
  const packageJson = readPackageJson();

  assert.match(packageJson.devDependencies?.['@types/node'] ?? '', /^\^?\d+\.\d+\.\d+/);
});
