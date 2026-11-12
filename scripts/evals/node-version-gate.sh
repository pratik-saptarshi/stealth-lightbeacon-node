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

# S2 — engines floor (full declared range, including the <27 ceiling)
python3 - "$TARGET" "$FLOOR" <<'PY' || fail=1
import json, re, sys
target = sys.argv[1]
floor = sys.argv[2]
eng = (json.load(open("package.json")).get("engines") or {}).get("node", "")
def norm(s):
    # Collapse whitespace and operator spacing so ">= 26.13.1  < 27" == floor.
    return re.sub(r"(>=|<=|>|<)\s+", r"\1", " ".join(s.split()))
if norm(eng) == norm(floor):
    print(f"ok: engines.node={eng}")
else:
    print(f"FAIL: engines.node must be exactly {floor!r} (missing ceiling or extra ranges are rejected), got {eng!r}", file=sys.stderr)
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

# S4 — scripts must not install an older Node (any version below the target,
# including unpatched 26.x releases below the target)
python3 - "$TARGET" <<'PY' || fail=1
import glob, re, sys
target = tuple(int(x) for x in sys.argv[1].split("."))
bad = []
paths = sorted(glob.glob("scripts/**/*.sh", recursive=True) + glob.glob("tools/**/*.sh", recursive=True))
for path in paths:
    for i, line in enumerate(open(path, errors="replace"), 1):
        for m in re.finditer(r"node@(\d+(?:\.\d+)*)", line):
            v = tuple(int(x) for x in m.group(1).split("."))
            v = v + (0,) * (len(target) - len(v))
            if v < target:
                bad.append(f"{path}:{i}: node@{m.group(1)} < {'.'.join(map(str, target))}")
if bad:
    print("FAIL: " + "; ".join(bad), file=sys.stderr)
    sys.exit(1)
print(f"ok: scripts do not pin older Node")
PY

# S8 — docs that state the runtime. HTML entities are decoded before scanning
# so an escaped stale floor (e.g. "&gt;=24.0.0" in an .html.md doc) cannot
# evade the check the way the literal form is caught.
python3 - <<'PY' || fail=1
import glob, html, re, sys
excluded = {"docs/bmv-completion-execution-plan.md", "docs/publishing-roadmap.md"}
pat = re.compile(r"(>=24\.0\.0|Node `?24([^0-9]|$)|node:24([^0-9]|$)|24\.x)")
stale = []
for path in sorted(glob.glob("docs/*.md") + glob.glob("*.md")):
    if path in excluded:
        continue
    for i, line in enumerate(open(path, errors="replace"), 1):
        decoded = html.unescape(line)
        if pat.search(decoded):
            stale.append(f"{path}:{i}: {decoded.rstrip()}")
if stale:
    print("\n".join(stale), file=sys.stderr)
    print("FAIL: stale Node 24 references in docs", file=sys.stderr)
    sys.exit(1)
print("ok: docs advertise the patched floor")
PY

if [ "$fail" -ne 0 ]; then
  echo "GATE: FAILED" >&2
  exit 1
fi
echo "GATE: PASSED ($TARGET)"
