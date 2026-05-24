#!/bin/bash
set -euo pipefail

echo "=== DevContainer Post-Create Setup ==="
npm ci
npm run build
echo "=== Setup Complete! ==="
