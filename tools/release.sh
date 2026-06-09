#!/usr/bin/env bash

# release.sh - Orchestrate well-documented releases with automated quality checks.
set -euo pipefail

# 1. Run Quality Checks
echo "=== Running Quality Checks (Typecheck, Unit Tests, MCP contract, Coverage CI) ==="
pnpm run quality:check

# 2. Run Release Security Gate
echo "=== Running Release Security Gate (Evidence, SBOM, Secrets, Pack Boundary) ==="
pnpm run release:security:check

# 3. Perform Release via release-it
echo "=== Executing release-it ==="
# Unset GITHUB_TOKEN if it's invalid to let gh keyring token take precedence
if [ -n "${GITHUB_TOKEN:-}" ]; then
  # Verify if current token works, if not unset it for this process
  if ! gh auth status &>/dev/null; then
    echo "Warning: Invalid GITHUB_TOKEN environment variable detected. Temporarily unsetting to let local keyring auth take precedence."
    export GITHUB_TOKEN=""
  fi
fi

pnpm exec release-it "$@"
echo "=== Release Process Completed Successfully ==="
