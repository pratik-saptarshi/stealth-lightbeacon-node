const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  parseMarkdownCommandBlocks,
  validateDocumentedCommands,
} = require('../tools/check-docs-commands');

const rootDir = path.join(__dirname, '..');

function readDoc(relativePath) {
  return {
    filePath: relativePath,
    content: fs.readFileSync(path.join(rootDir, relativePath), 'utf8'),
  };
}

test('parses documented shell command blocks from release docs', () => {
  const docs = [
    readDoc('readme.md'),
    readDoc('CLI-readme.md'),
    readDoc('docs/release-process.md'),
  ];

  const commands = docs.flatMap((doc) =>
    parseMarkdownCommandBlocks(doc.content, doc.filePath).flatMap((block) => block.commands)
  );

  assert.ok(commands.some((command) => command.command === 'pnpm run build'));
  assert.ok(
    commands.some((command) =>
      command.command.startsWith('node dist/cli.js evaluate https://example.com')
    )
  );
  assert.ok(
    commands.some((command) =>
      command.command.startsWith('node scripts/summarize-coverage.js .tmp/reports/external')
    )
  );
  assert.ok(commands.some((command) => command.command === 'node dist/cli.js serve --help'));
});

test('service docs describe executable cli and api behavior', () => {
  const combined = `${readDoc('readme.md').content}\n${readDoc('CLI-readme.md').content}`;

  for (const expected of [
    'node dist/cli.js serve --help',
    'GET /health',
    'GET /capabilities',
    'POST /evaluations',
    'GET /evaluations/{id}/result',
    'GET /evaluations/{id}/artifacts/{name}',
    'POST /recon'
  ]) {
    assert.match(combined, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.match(combined, /Bearer <token>/);
  assert.match(combined, /rejects path traversal/i);
});

test('documented local commands resolve to known package scripts or files', () => {
  const result = validateDocumentedCommands({
    rootDir,
    docs: [
      readDoc('readme.md'),
      readDoc('CLI-readme.md'),
      readDoc('docs/release-process.md'),
    ],
    enforceManualGates: false,
  });

  assert.deepEqual(result.unknownCommands, []);
  assert.ok(result.checkedCommands.length >= 10);
});

test('network and destructive examples require explicit manual gates when enforced', () => {
  const doc = {
    filePath: 'synthetic.md',
    content: [
      '```sh',
      'node dist/cli.js evaluate https://example.com --out .tmp/reports/example --no-pdf',
      '```',
      '',
      '```sh',
      '# docs-command-smoke: manual-gate network external audit',
      'node dist/cli.js evaluate https://example.com --out .tmp/reports/example --no-pdf',
      '```',
      '',
      '```sh',
      '# docs-command-smoke: manual-gate destructive release publish',
      'pnpm run release',
      '```',
    ].join('\n'),
  };

  const result = validateDocumentedCommands({
    rootDir,
    docs: [doc],
    enforceManualGates: true,
  });

  assert.deepEqual(result.unknownCommands, []);
  assert.equal(result.manualGatedCommands.length, 2);
  assert.deepEqual(
    result.manualGateRequired.map((diagnostic) => diagnostic.command),
    ['node dist/cli.js evaluate https://example.com --out .tmp/reports/example --no-pdf']
  );
});
