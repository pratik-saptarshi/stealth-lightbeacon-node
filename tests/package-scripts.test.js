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

function readReleaseScript() {
  return fs.readFileSync(path.join(__dirname, '..', 'tools', 'release.sh'), 'utf8');
}

function readAlternateCiConfigs() {
  return {
    '.gitlab-ci.yml': fs.readFileSync(path.join(__dirname, '..', '.gitlab-ci.yml'), 'utf8'),
    'bitbucket-pipelines.yml': fs.readFileSync(path.join(__dirname, '..', 'bitbucket-pipelines.yml'), 'utf8')
  };
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

test('ci node version satisfies package engine policy', () => {
  const packageJson = readPackageJson();
  const workflow = readCiWorkflow();
  const minimumMajor = Number(packageJson.engines.node.match(/>=\s*(\d+)/)?.[1]);
  assert.ok(Number.isInteger(minimumMajor), `Unsupported node engine range: ${packageJson.engines.node}`);

  const versionMatch = workflow.match(/node-version:\s*['"]?(\d+(?:\.\d+)*)['"]?/);
  assert.ok(versionMatch, 'CI workflow must configure a node-version');
  const major = Number(versionMatch[1].split('.')[0]);
  assert.ok(Number.isInteger(major), `Unsupported CI node-version entry: ${versionMatch[1]}`);
  assert.ok(
    major >= minimumMajor,
    `CI node-version ${versionMatch[1]} does not satisfy package engine ${packageJson.engines.node}`
  );
});

test('ci build-and-test job exposes a versionless required check context', () => {
  const workflow = readCiWorkflow();
  const job = workflow.match(/^  build-and-test:\n([\s\S]*)/m)?.[1] ?? '';

  assert.ok(job, 'ci.yml must keep the build-and-test job');
  assert.match(
    job,
    /^    name: build-and-test$/m,
    'build-and-test must set a static job name so the required check context stays versionless'
  );
  assert.doesNotMatch(job, /matrix:/, 'a matrix appends its values to the check context');
  assert.match(job, /node-version:\s*26\.13\.1/, 'build-and-test must pin the patched Node version directly');
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

test('alternate ci configs satisfy node and pnpm policy or stay absent', () => {
  const packageJson = readPackageJson();
  const minimumMajor = Number(packageJson.engines.node.match(/>=\s*(\d+)/)?.[1]);
  const pnpmVersion = packageJson.packageManager.match(/^pnpm@(.+)$/)?.[1];
  assert.ok(Number.isInteger(minimumMajor), `Unsupported node engine range: ${packageJson.engines.node}`);
  assert.match(pnpmVersion ?? '', /^\d+\.\d+\.\d+$/);

  const configs = readAlternateCiConfigs();
  for (const [configName, config] of Object.entries(configs)) {
    const imageMatch = config.match(/image:\s*node:(\d+)/);
    assert.ok(imageMatch, `${configName} must declare an active Node image`);
    assert.ok(
      Number(imageMatch[1]) >= minimumMajor,
      `${configName} image node:${imageMatch[1]} does not satisfy ${packageJson.engines.node}`
    );
    const pnpmPin = pnpmVersion.replaceAll('.', '\\.');
    assert.match(
      config,
      new RegExp(`(?:corepack prepare pnpm@${pnpmPin} --activate|npm install -g pnpm@${pnpmPin})`)
    );
    assert.match(config, /pnpm install --frozen-lockfile/);
    assert.doesNotMatch(config, /\bnpm ci\b/);

    const installCount = config.match(/pnpm install --frozen-lockfile/g)?.length ?? 0;
    const gateCount = config.match(/bash scripts\/evals\/node-version-gate\.sh/g)?.length ?? 0;
    assert.equal(
      gateCount,
      installCount,
      `${configName} must run bash scripts/evals/node-version-gate.sh after every pnpm install step`
    );
    assert.ok(
      config.indexOf('bash scripts/evals/node-version-gate.sh') >
        config.indexOf('pnpm install --frozen-lockfile'),
      `${configName} must run the Node version gate after pnpm install`
    );
  }

  const bitbucket = configs['bitbucket-pipelines.yml'];
  assert.match(
    bitbucket,
    /node dist\/cli\.js evaluate "https:\/\/example\.com" --crawl-depth 1 --max-urls 5 --format both --out \.\/audit-results/
  );
  assert.match(bitbucket, /--crawl-depth 1/);
  assert.match(bitbucket, /--out \.\/audit-results/);
  assert.doesNotMatch(bitbucket, /pnpm exec stealth-lightbeacon/);
  assert.doesNotMatch(bitbucket, /stealth-lightbeacon audit /);
  assert.doesNotMatch(bitbucket, /--depth /);
  assert.doesNotMatch(bitbucket, /--output-dir/);
});

test('github workflows install pnpm before setup-node cache uses it', () => {
  const workflows = {
    'ci.yml': readCiWorkflow(),
    'stealth-lightbeacon-audit.yml': readAuditWorkflow()
  };

  for (const [workflowName, workflow] of Object.entries(workflows)) {
    const pnpmSetup = workflow.match(/pnpm\/action-setup@v\d+/);
    const setupNode = workflow.match(/actions\/setup-node@v\d+/);
    assert.ok(pnpmSetup, `${workflowName} must install pnpm before setup-node cache`);
    assert.ok(setupNode, `${workflowName} must configure setup-node`);
    assert.ok(
      pnpmSetup.index < setupNode.index,
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

test('ci validates the exact captured pack dry-run evidence', () => {
  const workflow = readCiWorkflow();

  assert.match(workflow, /mkdir -p \.tmp\/release-evidence/);
  assert.match(workflow, /pnpm pack --dry-run > \.tmp\/release-evidence\/pack-dry-run\.txt/);
  assert.match(workflow, /node tools\/check-package-boundary\.js \.tmp\/release-evidence\/pack-dry-run\.txt/);
});

test('ci captures automated release evidence and leaves human release gates manual', () => {
  const workflow = readCiWorkflow();
  const checklist = fs.readFileSync(path.join(__dirname, '..', 'docs', 'publishing-roadmap-checklist.md'), 'utf8');

  assert.match(workflow, /pnpm audit --prod > \.tmp\/release-evidence\/audit-prod\.txt/);
  assert.match(workflow, /\.tmp\/release-evidence\/secret-scan\.txt/);
  assert.match(workflow, /\.tmp\/release-evidence\/sbom\.cyclonedx\.json/);
  assert.match(workflow, /pnpm dlx @cyclonedx\/cdxgen/);
  assert.match(
    workflow,
    /pnpm dlx @cyclonedx\/cdxgen@\d+\.\d+\.\d+ -t npm/,
    'the SBOM tool must be pinned to an exact version'
  );
  assert.doesNotMatch(workflow, /pnpm list --prod --json > \.tmp\/release-evidence\/sbom\.cyclonedx\.json/);
  assert.doesNotMatch(workflow, /pnpm run release:security:check/);
  assert.doesNotMatch(workflow, /pnpm run release:dry/);
  assert.match(checklist, /`MANUAL` `pnpm run release:security:check` verifies completed release evidence locally before publish/);
  assert.match(checklist, /`MANUAL` `pnpm run release:dry` runs successfully before publish/);
});

test('production release wrapper enforces release security gate before release-it', () => {
  const releaseScript = readReleaseScript();
  const qualityIndex = releaseScript.indexOf('pnpm run quality:check');
  const nodeGateIndex = releaseScript.indexOf('pnpm run eval:node-version');
  const securityIndex = releaseScript.indexOf('pnpm run release:security:check');
  const releaseItIndex = releaseScript.indexOf('pnpm exec release-it');

  assert.notEqual(qualityIndex, -1);
  assert.notEqual(nodeGateIndex, -1);
  assert.notEqual(securityIndex, -1);
  assert.notEqual(releaseItIndex, -1);
  assert.ok(qualityIndex < nodeGateIndex);
  assert.ok(nodeGateIndex < securityIndex);
  assert.ok(securityIndex < releaseItIndex);
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
  const minimumMajor = Number(packageJson.engines.node.match(/>=\s*(\d+)/)?.[1]);
  const typesNode = packageJson.devDependencies?.['@types/node'] ?? '';

  assert.match(typesNode, /^\^?\d+\.\d+\.\d+/);
  assert.ok(Number.isInteger(minimumMajor), `Unsupported node engine range: ${packageJson.engines.node}`);
  assert.ok(
    Number(typesNode.match(/(\d+)/)?.[1]) >= minimumMajor,
    `@types/node ${typesNode} must cover the Node ${minimumMajor} runtime`
  );
});

test('readme install section documents the package engine node range', () => {
  const packageJson = readPackageJson();
  const readme = fs.readFileSync(path.join(__dirname, '..', 'readme.md'), 'utf8');
  const installSection = readme.match(/## Install\n([\s\S]*?)\n## /)?.[1] ?? '';

  assert.ok(installSection, 'readme.md must keep a dedicated Install section');
  assert.ok(
    installSection.includes(`Node.js ${packageJson.engines.node}`),
    `readme.md Install section must document Node.js ${packageJson.engines.node}`
  );
});
