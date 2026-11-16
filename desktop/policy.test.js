const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readPlatformPolicy() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'platform.json'), 'utf8'));
}

function readDesktopWorkspace() {
  return fs.readFileSync(path.join(__dirname, 'pnpm-workspace.yaml'), 'utf8');
}

test('platform.json states the supported desktop floor in machine-readable form', () => {
  const policy = readPlatformPolicy();

  assert.deepEqual(policy, { macos: '13', windows: 'x64', linux: 'x64' });
});

test('desktop workspace keeps an explicit electron build allowlist', () => {
  const workspace = readDesktopWorkspace();

  assert.match(workspace, /^allowBuilds:$/m, 'pnpm-workspace.yaml must keep an allowBuilds block');
  assert.match(workspace, /^ {2}electron: true$/m, 'electron must have an explicit allowBuilds decision');
  assert.doesNotMatch(
    workspace,
    /set this to true or false/,
    'the placeholder must be replaced by an explicit build decision'
  );
});
