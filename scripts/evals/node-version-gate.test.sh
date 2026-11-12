#!/usr/bin/env bash
# Self-test for scripts/evals/node-version-gate.sh.
#
# Copies the repository's tracked files into a temp directory, asserts the
# unmodified copy passes the gate, then applies one mutation at a time and
# asserts the gate rejects it. The real repository is never modified.
#
# Mutation payloads are assembled with printf so this file itself does not
# contain a stale pin that the gate's own script scan would flag.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET="$(sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/\r$//' < "$REPO_ROOT/.nvmrc")"

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/node-version-gate-test.XXXXXX")"
WORK="$TMP_ROOT/work"
LOG="$TMP_ROOT/gate.log"
cleanup() { rm -rf "$TMP_ROOT"; }
trap cleanup EXIT

failures=0
ok() { echo "ok: $*"; }
bad() { echo "FAIL: $*" >&2; failures=$((failures + 1)); }

# Copy every tracked file's working-tree content into $WORK.
fresh() {
  rm -rf "$WORK"
  mkdir -p "$WORK"
  ( cd "$REPO_ROOT" && git ls-files -z | tar --null -T - -cf - 2>/dev/null ) \
    | ( cd "$WORK" && tar -xf - )
}

run_gate() {
  ( cd "$WORK" && GATE_REQUIRE_RUNTIME=0 bash scripts/evals/node-version-gate.sh )
}

expect_pass() {
  local name="$1"
  if run_gate >"$LOG" 2>&1; then
    ok "$name: gate passed"
  else
    bad "$name: gate failed but should pass"
    sed 's/^/    /' "$LOG" >&2
  fi
}

expect_fail() {
  local name="$1"
  if run_gate >"$LOG" 2>&1; then
    bad "$name: gate passed but should fail"
  else
    ok "$name: gate rejected"
  fi
}

first_workflow() {
  find "$WORK/.github/workflows" -type f \( -name '*.yml' -o -name '*.yaml' \) 2>/dev/null \
    | sort | head -n 1
}

first_doc() {
  find "$WORK" -maxdepth 1 -type f -name '*.md' ! -name '.*' 2>/dev/null \
    | sort | head -n 1
}

first_script() {
  find "$WORK/scripts" "$WORK/tools" -type f -name '*.sh' 2>/dev/null \
    | grep -v 'node-version-gate' | sort | head -n 1 || true
}

# --- base ------------------------------------------------------------------
fresh
if run_gate >"$LOG" 2>&1; then
  ok "base tree: gate passed"
else
  bad "base tree: gate failed on unmodified tree"
  sed 's/^/    /' "$LOG" >&2
  echo "SELFTEST: FAILED" >&2
  exit 1
fi

# --- 1. .nvmrc below target ------------------------------------------------
fresh
printf '26.0.0\n' >"$WORK/.nvmrc"
expect_fail ".nvmrc -> 26.0.0"

# --- 2. engines without a ceiling -----------------------------------------
fresh
python3 - "$WORK/package.json" "$TARGET" <<'PY'
import json
import sys

path, target = sys.argv[1], sys.argv[2]
with open(path, encoding="utf-8") as handle:
    package = json.load(handle)
package.setdefault("engines", {})["node"] = ">=" + target
with open(path, "w", encoding="utf-8") as handle:
    json.dump(package, handle, indent=2)
    handle.write("\n")
PY
expect_fail "engines -> >=$TARGET (no ceiling)"

# --- 3. workflow node-version below target ---------------------------------
fresh
python3 - "$WORK" <<'PY'
import glob
import re
import sys

work = sys.argv[1]
paths = sorted(
    glob.glob(work + "/.github/workflows/**/*.yml", recursive=True)
    + glob.glob(work + "/.github/workflows/**/*.yaml", recursive=True)
)
for path in paths:
    with open(path, encoding="utf-8") as handle:
        text = handle.read()
    match = re.search(r"(?m)^([ \t]*node-version[ \t]*:[ \t]*)(.*)$", text)
    if not match:
        continue
    replacement = match.group(1) + "22"
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text[: match.start()] + replacement + text[match.end() :])
    break
else:
    sys.exit("no node-version found in workflows")
PY
expect_fail "workflow node-version -> 22"

# --- 4. container image below target ---------------------------------------
fresh
WORKFLOW="$(first_workflow)"
if [ -z "$WORKFLOW" ]; then
  bad "no workflow found to add container: node:20"
else
  printf '\ncontainer: node:20\n' >>"$WORKFLOW"
  expect_fail "workflow container -> node:20"
fi

# --- 5. script installs an unpatched 26.x ----------------------------------
fresh
SCRIPT="$(first_script)"
if [ -z "$SCRIPT" ]; then
  SCRIPT="$WORK/scripts/_gate_selftest_mutation.sh"
fi
printf 'node@%s\n' "26.13.0" >>"$SCRIPT"
expect_fail "script pins an unpatched 26.x"

# --- 6. script uses an old major ------------------------------------------
fresh
SCRIPT="$(first_script)"
if [ -z "$SCRIPT" ]; then
  SCRIPT="$WORK/scripts/_gate_selftest_mutation.sh"
fi
printf 'nvm install %s\n' "20" >>"$SCRIPT"
expect_fail "script installs an old major"

# --- 7a. doc states a stale literal floor ----------------------------------
fresh
DOC="$(first_doc)"
if [ -z "$DOC" ]; then
  bad "no root markdown doc found"
else
  printf '\nMinimum supported Node: >=%s\n' "24.0.0" >>"$DOC"
  expect_fail "doc literal >=24.0.0"
fi

# --- 7b. doc states the same floor as an HTML entity ------------------------
fresh
DOC="$(first_doc)"
if [ -z "$DOC" ]; then
  bad "no root markdown doc found"
else
  printf '\nMinimum supported Node: &gt;=%s\n' "24.0.0" >>"$DOC"
  expect_fail "doc entity &gt;=24.0.0"
fi

# --- 8. devcontainer / pipeline image below target (where present) ---------
fresh
MUTATED_IMAGE=0
if [ -f "$WORK/.devcontainer/Dockerfile" ]; then
  MUTATED_IMAGE=1
  python3 - "$WORK/.devcontainer/Dockerfile" "$TARGET" <<'PY'
import sys

path, target = sys.argv[1], sys.argv[2]
with open(path, encoding="utf-8") as handle:
    text = handle.read()
if "node:" + target not in text:
    sys.exit("devcontainer does not pin node:" + target)
with open(path, "w", encoding="utf-8") as handle:
    handle.write(text.replace("node:" + target, "node:20", 1))
PY
  expect_fail "devcontainer FROM -> node:20"
fi
for PIPELINE in .gitlab-ci.yml bitbucket-pipelines.yml; do
  if [ "$MUTATED_IMAGE" -eq 1 ] || [ ! -f "$WORK/$PIPELINE" ]; then
    continue
  fi
  MUTATED_IMAGE=1
  python3 - "$WORK/$PIPELINE" "$TARGET" <<'PY'
import sys

path, target = sys.argv[1], sys.argv[2]
with open(path, encoding="utf-8") as handle:
    text = handle.read()
if "node:" + target not in text:
    sys.exit("pipeline does not pin node:" + target)
with open(path, "w", encoding="utf-8") as handle:
    handle.write(text.replace("node:" + target, "node:20", 1))
PY
  expect_fail "$PIPELINE image -> node:20"
done
if [ "$MUTATED_IMAGE" -eq 0 ]; then
  echo "skip: no devcontainer or pipeline image in this repo"
fi

if [ "$failures" -ne 0 ]; then
  echo "SELFTEST: FAILED ($failures)" >&2
  exit 1
fi
echo "SELFTEST: PASSED"
