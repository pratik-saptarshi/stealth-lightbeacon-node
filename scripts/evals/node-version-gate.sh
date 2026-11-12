#!/usr/bin/env bash
# Eval gate: repository must run the latest security-patched Node 26.x runtime.
set -euo pipefail
TARGET="26.13.1"
FLOOR=">=${TARGET} <27"
fail=0
err() { echo "FAIL: $*" >&2; fail=1; }
ok()  { echo "ok: $*"; }

# S1 — runtime pins
for f in .nvmrc .node-version; do
  if [ -f "$f" ] && [ "$(tr -d '[:space:]' < "$f")" = "$TARGET" ]; then
    ok "$f=$TARGET"
  else
    err "$f must be $TARGET"
  fi
done
if [ -f .tool-versions ]; then
  if grep -Eq "^nodejs[[:space:]]+${TARGET}$" .tool-versions; then
    ok ".tool-versions=$TARGET"
  else
    err ".tool-versions must pin nodejs $TARGET"
  fi
fi

# S2 — engines floor
python3 - "$TARGET" <<'PY' || fail=1
import json, re, sys
target = sys.argv[1]
eng = (json.load(open("package.json")).get("engines") or {}).get("node", "")
if re.search(rf">=\s*{re.escape(target)}(?:\s|<|$)", eng):
    print(f"ok: engines.node={eng}")
else:
    print(f"FAIL: engines.node must require >={target}, got {eng!r}", file=sys.stderr)
    sys.exit(1)
PY

# S3/S4 — every GitHub workflow resolves the exact patched Node
python3 - "$TARGET" <<'PY' || fail=1
import glob, re, sys
target = sys.argv[1]
bad = []
for path in sorted(glob.glob(".github/workflows/*.yml") + glob.glob(".github/workflows/*.yaml")):
    text = open(path).read()
    for m in re.finditer(r"node-version:\s*(?:\[([^\]]+)\]|['\"]?([^'\"\s,]+)['\"]?)", text):
        raw = m.group(1) or m.group(2)
        for v in [x.strip() for x in raw.split(",") if x.strip()]:
            if v.startswith("${{"):
                continue
            if v != target:
                bad.append(f"{path}: node-version {v} != {target}")
    for m in re.finditer(r"image:\s*['\"]?node:([0-9][0-9.]*)", text):
        if m.group(1) != target:
            bad.append(f"{path}: image node:{m.group(1)} != {target}")
    for m in re.finditer(r"FORCE_JAVASCRIPT_ACTIONS_TO_NODE(\d+)", text):
        if m.group(1) != target.split(".")[0]:
            bad.append(f"{path}: forces JS actions to Node {m.group(1)}")
if bad:
    print("FAIL: " + "; ".join(bad), file=sys.stderr)
    sys.exit(1)
print(f"ok: GitHub workflows pin Node {target}")
PY

# S5 — alternate pipelines and devcontainer
python3 - "$TARGET" <<'PY' || fail=1
import os, re, sys
target = sys.argv[1]
bad = []
for path in (".gitlab-ci.yml", "bitbucket-pipelines.yml"):
    if not os.path.exists(path):
        continue
    text = open(path).read()
    m = re.search(r"image:\s*['\"]?node:([0-9][0-9.]*)", text)
    if not m:
        bad.append(f"{path}: no node image")
    elif m.group(1) != target:
        bad.append(f"{path}: node:{m.group(1)} != {target}")
    if re.search(r"\bcorepack\b", text):
        bad.append(f"{path}: corepack is not shipped with Node >=25")
if os.path.exists(".devcontainer/Dockerfile"):
    text = open(".devcontainer/Dockerfile").read()
    m = re.search(r"FROM\s+\S*node:([0-9][0-9.]*)", text)
    if not m:
        bad.append(".devcontainer/Dockerfile: no node base image")
    elif m.group(1) != target:
        bad.append(f".devcontainer/Dockerfile: node:{m.group(1)} != {target}")
if bad:
    print("FAIL: " + "; ".join(bad), file=sys.stderr)
    sys.exit(1)
print(f"ok: pipelines and devcontainer pin Node {target}")
PY

# S4 — scripts must not install an older Node
if [ -d scripts ]; then
  hits=$(grep -RInE --include='*.sh' 'node@(1[0-9]|2[0-5])(\.[0-9]+)*' scripts tools 2>/dev/null || true)
  if [ -n "$hits" ]; then
    echo "$hits" >&2
    err "scripts install Node older than $TARGET"
  else
    ok "scripts do not pin older Node"
  fi
fi

# S8 — docs that state the runtime
docs_md=$(ls docs/*.md *.md 2>/dev/null || true)
if [ -n "$docs_md" ]; then
  stale=$(grep -InE '(>=24\.0\.0|Node `?24([^0-9]|$)|node:24([^0-9]|$)|24\.x)' $docs_md 2>/dev/null \
    | grep -v 'docs/bmv-completion-execution-plan.md' \
    | grep -v 'docs/publishing-roadmap.md' || true)
  if [ -n "$stale" ]; then
    echo "$stale" >&2
    err "stale Node 24 references in docs"
  else
    ok "docs advertise the patched floor"
  fi
fi

if [ "$fail" -ne 0 ]; then
  echo "GATE: FAILED" >&2
  exit 1
fi
echo "GATE: PASSED ($TARGET)"
