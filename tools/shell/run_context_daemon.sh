#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
MEMORY_KB=1048576

if (ulimit -v "$MEMORY_KB") 2>/dev/null; then
  ulimit -v "$MEMORY_KB"
fi

PATH="$ROOT_DIR/tools/bin:$PATH"
export PATH
exec "$ROOT_DIR/target/debug/context-daemon" "${1:-"$ROOT_DIR"}"
