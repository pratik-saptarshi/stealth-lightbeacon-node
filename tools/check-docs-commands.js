const fs = require('node:fs');
const path = require('node:path');

const COMMAND_BLOCK_LANGUAGES = new Set(['bash', 'sh', 'shell', 'console']);
const MANUAL_GATE_PATTERN = /docs-command-smoke:\s*manual-gate\b/i;
const ENV_ASSIGNMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*=/;
const NETWORK_PATTERN = /\bhttps?:\/\/|(?:^|\s)(?:prudential|empower|cigna|fidelity)\.com\b/;
const DESTRUCTIVE_PATTERN = /\b(?:npm\s+publish|pnpm\s+run\s+release|pnpm\s+run\s+release:dry|tools\/release\.sh|git\s+push|rm\s+-rf)\b/;

function parseMarkdownCommandBlocks(content, filePath = '<inline>') {
  const blocks = [];
  const lines = content.split(/\r?\n/);
  let active = null;

  lines.forEach((line, index) => {
    const fenceMatch = line.match(/^```\s*([A-Za-z0-9_-]*)\s*$/);
    if (fenceMatch) {
      if (active) {
        const commands = parseCommandBlock(active.lines, {
          filePath,
          startLine: active.startLine,
        });
        blocks.push({
          filePath,
          language: active.language,
          startLine: active.startLine,
          endLine: index + 1,
          commands,
        });
        active = null;
        return;
      }

      const language = fenceMatch[1].toLowerCase();
      if (COMMAND_BLOCK_LANGUAGES.has(language)) {
        active = { language, startLine: index + 1, lines: [] };
      }
      return;
    }

    if (active) {
      active.lines.push({ text: line, lineNumber: index + 1 });
    }
  });

  return blocks;
}

function parseCommandBlock(lines, context) {
  const commands = [];
  let pending = null;
  let manualGate = false;
  let manualGateLine = null;

  for (const line of lines) {
    const trimmed = stripPrompt(line.text.trim());
    if (!trimmed) {
      continue;
    }

    if (trimmed.startsWith('#')) {
      if (MANUAL_GATE_PATTERN.test(trimmed)) {
        manualGate = true;
        manualGateLine = line.lineNumber;
      }
      continue;
    }

    const continuation = trimmed.endsWith('\\');
    const segment = continuation ? trimmed.slice(0, -1).trimEnd() : trimmed;

    if (pending) {
      pending.command += ` ${segment.trim()}`;
    } else {
      pending = {
        filePath: context.filePath,
        lineNumber: line.lineNumber,
        command: segment.trim(),
        manualGate,
        manualGateLine,
      };
      manualGate = false;
      manualGateLine = null;
    }

    if (!continuation) {
      pending.command = normalizeCommand(pending.command);
      commands.push(pending);
      pending = null;
    }
  }

  if (pending) {
    pending.command = normalizeCommand(pending.command);
    commands.push(pending);
  }

  return commands;
}

function validateDocumentedCommands(options) {
  const rootDir = options.rootDir;
  const docs = options.docs;
  const enforceManualGates = Boolean(options.enforceManualGates);
  const packageJson = readPackageJson(rootDir);
  const scripts = packageJson.scripts || {};
  const bins = packageJson.bin || {};
  const checkedCommands = [];
  const unknownCommands = [];
  const manualGatedCommands = [];
  const manualGateRequired = [];

  for (const doc of docs) {
    const blocks = parseMarkdownCommandBlocks(doc.content, doc.filePath);
    for (const block of blocks) {
      for (const command of block.commands) {
        if (isEnvironmentOnly(command.command)) {
          checkedCommands.push({
            filePath: command.filePath,
            lineNumber: command.lineNumber,
            command: command.command,
          });
          continue;
        }

        const normalized = unwrapCommand(stripEnvironment(command.command));
        const known = isKnownLocalCommand(normalized, { rootDir, scripts, bins });
        const gated = command.manualGate;
        const requiresGate = requiresManualGate(normalized);
        const diagnostic = {
          filePath: command.filePath,
          lineNumber: command.lineNumber,
          command: command.command,
        };

        if (known) {
          checkedCommands.push(diagnostic);
        } else {
          unknownCommands.push({
            ...diagnostic,
            reason: `unsupported command: ${normalized}`,
          });
        }

        if (gated) {
          manualGatedCommands.push(diagnostic);
        } else if (enforceManualGates && requiresGate) {
          manualGateRequired.push(diagnostic);
        }
      }
    }
  }

  return {
    checkedCommands,
    unknownCommands,
    manualGatedCommands,
    manualGateRequired,
  };
}

function readPackageJson(rootDir) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
}

function stripPrompt(command) {
  return command.replace(/^\$\s+/, '');
}

function normalizeCommand(command) {
  return command.replace(/\s+/g, ' ').trim();
}

function stripEnvironment(command) {
  let current = command.trim();
  while (ENV_ASSIGNMENT_PATTERN.test(current)) {
    const spaceIndex = current.indexOf(' ');
    if (spaceIndex === -1) {
      return current;
    }
    current = current.slice(spaceIndex + 1).trim();
  }
  return current;
}

function isEnvironmentOnly(command) {
  return command
    .trim()
    .split(/\s+/)
    .every((part) => ENV_ASSIGNMENT_PATTERN.test(part));
}

function unwrapCommand(command) {
  const leanCtxMatch = command.match(/^\/usr\/local\/bin\/lean-ctx\s+-c\s+(['"])(.*)\1$/);
  if (leanCtxMatch) {
    return stripEnvironment(leanCtxMatch[2]);
  }
  return command;
}

function isKnownLocalCommand(command, context) {
  if (isKnownPnpmCommand(command, context.scripts)) {
    return true;
  }

  if (isKnownNodeCommand(command, context.rootDir, context.bins)) {
    return true;
  }

  if (isKnownRepoExecutable(command, context.rootDir)) {
    return true;
  }

  if (command.startsWith('rg ')) {
    return true;
  }

  return false;
}

function isKnownPnpmCommand(command, scripts) {
  if (command === 'pnpm install --frozen-lockfile') {
    return true;
  }

  if (command === 'pnpm test') {
    return Object.hasOwn(scripts, 'test');
  }

  if (command.startsWith('pnpm start -- ')) {
    return Object.hasOwn(scripts, 'start');
  }

  if (command === 'pnpm pack --dry-run' || command === 'pnpm audit' || command === 'pnpm audit --prod') {
    return true;
  }

  const runMatch = command.match(/^pnpm\s+run\s+([^\s]+)(?:\s|$)/);
  if (runMatch) {
    return Object.hasOwn(scripts, runMatch[1]);
  }

  return false;
}

function isKnownNodeCommand(command, rootDir, bins) {
  const match = command.match(/^node\s+([^\s]+)(?:\s|$)/);
  if (!match) {
    return false;
  }

  const scriptPath = match[1];
  if (fs.existsSync(path.join(rootDir, scriptPath))) {
    return true;
  }

  return Object.values(bins).some((binPath) => binPath === scriptPath);
}

function isKnownRepoExecutable(command, rootDir) {
  const executable = command.split(/\s+/, 1)[0];
  if (!/^(?:scripts|tools)\//.test(executable)) {
    return false;
  }
  return fs.existsSync(path.join(rootDir, executable));
}

function requiresManualGate(command) {
  return NETWORK_PATTERN.test(command) || DESTRUCTIVE_PATTERN.test(command);
}

module.exports = {
  parseMarkdownCommandBlocks,
  validateDocumentedCommands,
  requiresManualGate,
};
