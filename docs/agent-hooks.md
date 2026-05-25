# Agent Sync Hooks

The repo already uses `.git/hooks/post-commit` for incremental context sync.

Add this companion `post-checkout` hook to keep `.agent/context` aligned on branch switches:

```sh
#!/usr/bin/env sh
set -eu

ROOT_DIR="$(git rev-parse --show-toplevel)"
if [ -x "$ROOT_DIR/tools/shell/run_context_daemon.sh" ]; then
  "$ROOT_DIR/tools/shell/run_context_daemon.sh" "$ROOT_DIR" >/dev/null 2>&1 &
fi
```

Install:

```sh
chmod +x .git/hooks/post-checkout
```
