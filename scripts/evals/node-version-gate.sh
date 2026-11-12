#!/usr/bin/env bash
# Eval gate: repository must be on the latest security-patched Node 26.x runtime.
set -euo pipefail
TARGET="26.13.1"
FLOOR=">=26.13.1 <27"
fail=0

err() { echo "FAIL: $*" >&2; fail=1; }
ok() { echo "ok: $*"; }

# S1 — runtime pins
[ -f .nvmrc ] && [ "$(tr -d '[:space:]' < .nvmrc)" = "$TARGET" ] && ok ".nvmrc=$TARGET" || err ".nvmrc must be $TARGET"
[ -f .node-version ] && [ "$(tr -d '[:space:]' < .node-version)" = "$TARGET" ] && ok ".node-version=$TARGET" || err ".node-version must be $TARGET"

# S2 — engines floor
python3 - "$FLOOR" <<'PY' || fail=1
import json, sys
floor = sys.argv[1]
eng = (json.load(open("package.json")).get("engines") or {}).get("node", "")
if floor in eng:
    print(f"ok: engines.node={eng}")
else:
    print(f"FAIL: engines.node must contain {floor!r}, got {eng!r}", file=sys.stderr)
    sys.exit(1)
PY

# S3/S4 — GitHub workflows
python3 - "$TARGET" <<'PY' || fail=1
import glob, re, sys
target = sys.argv[1]
major = int(target.split(".")[0])
bad = []
for path in glob.glob(".github/workflows/*.yml") + glob.glob(".github/workflows/*.yaml"):
    text = open(path).read()
    if "setup-node" not in text:
        continue
    versions = []
    for m in re.finditer(r"node-version:\s*(?:\[([^\]]+)\]|['\"]?([0-9]+(?:\.x)?(?:\.[0-9]+)*)['\"]?)", text):
        raw = m.group(1) or m.group(2)
        versions += [v.strip() for v in raw.split(",")]
    if not versions:
        bad.append(f"{path}: no node-version found")
        continue
    for v in versions:
        n = int(v.split(".")[0])
        if n < major:
            bad.append(f"{path}: node-version {v} < {target}")
if bad:
    print("FAIL: " + "; ".join(bad), file=sys.stderr)
    sys.exit(1)
print("ok: GitHub workflows pin Node >= " + target)
PY

# S5 — alternate pipelines + devcontainer
python3 - "$TARGET" <<'PY' || fail=1
import re, sys
target = sys.argv[1]
major = int(target.split(".")[0])
bad = []
for path in (".gitlab-ci.yml", "bitbucket-pipelines.yml"):
    try:
        text = open(path).read()
    except FileNotFoundError:
        continue
    m = re.search(r"image:\s*node:([0-9]+)", text)
    if not m:
        bad.append(f"{path}: no node image")
    elif int(m.group(1)) < major:
        bad.append(f"{path}: node:{m.group(1)} < {target}")
try:
    df = open(".devcontainer/Dockerfile").read()
    m = re.search(r"(?:node:|typescript-node:1-)([0-9]+)", df)
    if m and int(m.group(1)) < major:
        bad.append(f".devcontainer/Dockerfile: node {m.group(1)} < {target}")
except FileNotFoundError:
    pass
if bad:
    print("FAIL: " + "; ".join(bad), file=sys.stderr)
    sys.exit(1)
print("ok: pipelines and devcontainer on Node >= " + target)
PY

# S8 — docs must not advertise the old floor
if grep -RIn --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=target \
  -E ">=24\.0\.0|Node \`24\.x\`|node-version: '24'|node:24\b" \
  CLI-readme.md docs 2>/dev/null | grep -v "publishing-roadmap.md"; then
  err "stale Node 24 references in docs"
else
  ok "docs advertise the patched floor"
fi

if [ "$fail" -ne 0 ]; then
  echo "GATE: FAILED" >&2
  exit 1
fi
echo "GATE: PASSED ($TARGET)"
