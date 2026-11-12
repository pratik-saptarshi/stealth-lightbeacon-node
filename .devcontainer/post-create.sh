#!/bin/bash
set -euo pipefail

echo "=== DevContainer Post-Create Setup ==="
pnpm install --frozen-lockfile
pnpm run build
echo "=== Setup Complete! ==="
