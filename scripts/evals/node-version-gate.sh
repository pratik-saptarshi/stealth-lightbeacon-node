#!/usr/bin/env bash
# Eval gate: every declared Node pin must equal the version in .nvmrc.
#
# The target is NOT hardcoded. TARGET comes from .nvmrc (trimmed); MAJOR is
# its first component and the supported range is ">=TARGET <MAJOR+1".
# Set GATE_REQUIRE_RUNTIME=1 to additionally require the running node binary
# to report exactly TARGET.
set -euo pipefail

if [ ! -f .nvmrc ]; then
  echo "FAIL: .nvmrc is missing; it is the source of truth for the Node target" >&2
  echo "GATE: FAILED" >&2
  exit 1
fi

TARGET="$(sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/\r$//' < .nvmrc)"
if ! printf '%s' "$TARGET" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "FAIL: .nvmrc must contain a full x.y.z version, got '$TARGET'" >&2
  echo "GATE: FAILED" >&2
  exit 1
fi
MAJOR="${TARGET%%.*}"
CEILING="$((MAJOR + 1))"
FLOOR=">=${TARGET} <${CEILING}"
export TARGET MAJOR CEILING FLOOR

if ! python3 - <<'PY'
import glob
import html
import json
import os
import re
import sys

target = os.environ["TARGET"]
major = os.environ["MAJOR"]
ceiling = os.environ["CEILING"]
floor = os.environ["FLOOR"]
target_tuple = tuple(int(x) for x in target.split("."))

failures = []


def fail(message):
    failures.append(message)


def ok(message):
    print("ok: " + message)


def norm_range(value):
    # Collapse operator whitespace so ">= 26.13.1   < 27" == ">=26.13.1 <27".
    collapsed = " ".join(value.split())
    return re.sub(r"(>=|<=|>|<|=)\s+", r"\1", collapsed)


def numeric(value):
    parts = tuple(int(x) for x in value.split("."))
    return parts + (0,) * (3 - len(parts))


def image_version_ok(path, version, context):
    base = version.split("-", 1)[0]
    if base != target:
        fail(f"{path}: {context} node:{version} != node:{target}")


# S1 - runtime pins ---------------------------------------------------------
for name in (".nvmrc", ".node-version"):
    try:
        with open(name, encoding="utf-8", errors="replace") as handle:
            value = handle.read().strip()
    except FileNotFoundError:
        fail(f"{name} is missing (must pin {target})")
        continue
    if value == target:
        ok(f"{name}={target}")
    else:
        fail(f"{name} must be exactly {target}, got {value!r}")

if os.path.exists(".tool-versions"):
    with open(".tool-versions", encoding="utf-8", errors="replace") as handle:
        lines = [line.strip() for line in handle]
    if any(re.fullmatch(rf"nodejs\s+{re.escape(target)}", line) for line in lines):
        ok(f".tool-versions pins nodejs {target}")
    else:
        fail(f".tool-versions must pin 'nodejs {target}'")

# S2 - engines.node is exactly the floor with its ceiling -------------------
try:
    with open("package.json", encoding="utf-8") as handle:
        package = json.load(handle)
except (OSError, json.JSONDecodeError) as exc:
    fail(f"package.json could not be read: {exc}")
    package = {}
engines = ((package.get("engines") or {}).get("node") or "")
if norm_range(engines) == norm_range(floor):
    ok(f"engines.node={engines}")
else:
    fail(
        "engines.node must be exactly "
        f"{floor!r} after collapsing operator whitespace (missing ceiling, "
        f"unions, and extra ranges are rejected), got {engines!r}"
    )

# S3/S4 - GitHub workflows and composite actions ----------------------------
workflow_paths = sorted(
    glob.glob(".github/workflows/**/*.yml", recursive=True)
    + glob.glob(".github/workflows/**/*.yaml", recursive=True)
)
action_paths = sorted(
    glob.glob(".github/actions/**/action.yml", recursive=True)
    + glob.glob(".github/actions/**/action.yaml", recursive=True)
)

node_version_re = re.compile(r"(?m)^[ \t]*node-version[ \t]*:[ \t]*(.*?)[ \t]*$")
container_image_re = re.compile(
    r"(?m)^[ \t]*(?:image|container)[ \t]*:[ \t]*['\"]?node:([0-9][0-9A-Za-z.\-]*)"
)
container_map_re = re.compile(
    r"container[ \t]*:[ \t]*\{[^}]*image[ \t]*:[ \t]*['\"]?node:([0-9][0-9A-Za-z.\-]*)"
)


def matrix_items(text, key):
    escaped = re.escape(key)
    inline = re.search(
        rf"(?m)^[ \t]*{escaped}[ \t]*:[ \t]*\[([^\]]*)\][ \t]*$", text
    )
    if inline:
        return [
            item.strip().strip("'\"")
            for item in inline.group(1).split(",")
            if item.strip()
        ]
    block = re.search(
        rf"(?m)^[ \t]*{escaped}[ \t]*:[ \t]*\n((?:[ \t]*-[ \t]*[^\n]+\n?)+)", text
    )
    if block:
        return [
            re.sub(r"^[ \t]*-[ \t]*", "", line).strip().strip("'\"")
            for line in block.group(1).splitlines()
            if line.strip()
        ]
    return None


def scan_workflow(path, text):
    for match in node_version_re.finditer(text):
        raw = re.sub(r"\s+#.*$", "", match.group(1)).strip().strip("'\"")
        if not raw:
            fail(f"{path}: node-version has no value")
        elif raw.startswith("["):
            items = [item.strip().strip("'\"") for item in raw.strip("[]").split(",") if item.strip()]
            for item in items:
                if item != target:
                    fail(f"{path}: node-version {item} != {target}")
        elif raw.startswith("${{"):
            expr = re.search(r"\$\{\{\s*matrix\.([A-Za-z0-9_-]+)\s*\}\}", raw)
            if not expr:
                fail(f"{path}: node-version expression {raw!r} is not a matrix reference")
                continue
            items = matrix_items(text, expr.group(1))
            if not items:
                fail(
                    f"{path}: node-version uses {raw} but no matrix literal for "
                    f"'{expr.group(1)}' was found in the same file"
                )
            else:
                for item in items:
                    if item != target:
                        fail(
                            f"{path}: matrix {expr.group(1)} value {item} != {target}"
                        )
        elif raw != target:
            fail(f"{path}: node-version {raw} != {target}")

    seen_images = set()
    for regex in (container_image_re, container_map_re):
        for match in regex.finditer(text):
            version = match.group(1)
            if (path, version) in seen_images:
                continue
            seen_images.add((path, version))
            image_version_ok(path, version, "container image")

    for match in re.finditer(r"FORCE_JAVASCRIPT_ACTIONS_TO_NODE(\d+)", text):
        if match.group(1) != major:
            fail(
                f"{path}: FORCE_JAVASCRIPT_ACTIONS_TO_NODE{match.group(1)} "
                f"!= FORCE_JAVASCRIPT_ACTIONS_TO_NODE{major}"
            )


for path in workflow_paths + action_paths:
    with open(path, encoding="utf-8", errors="replace") as handle:
        scan_workflow(path, handle.read())
if workflow_paths:
    ok(f"GitHub workflows pin Node {target}")
if action_paths:
    ok(f"GitHub composite actions pin Node {target}")

# S4 - run bodies and shell scripts must not install/use an older Node ------
script_paths = sorted(
    glob.glob("scripts/**/*.sh", recursive=True)
    + glob.glob("tools/**/*.sh", recursive=True)
)
script_re = re.compile(
    r"node@(\d+(?:\.\d+)*)"
    r"|nvm\s+install\s+(\d+(?:\.\d+)*)"
    r"|nvm\s+use\s+(\d+(?:\.\d+)*)"
)
scan_paths = workflow_paths + action_paths + script_paths
for path in scan_paths:
    with open(path, encoding="utf-8", errors="replace") as handle:
        for lineno, line in enumerate(handle, 1):
            for match in script_re.finditer(line):
                version = next(group for group in match.groups() if group)
                if numeric(version) < target_tuple:
                    fail(
                        f"{path}:{lineno}: Node {version} is below target {target} "
                        f"({match.group(0).strip()})"
                    )
if script_paths:
    ok(f"scripts and run bodies do not install or use Node below {target}")

# S5 - alternate pipelines and devcontainers --------------------------------
for path in (".gitlab-ci.yml", "bitbucket-pipelines.yml"):
    if not os.path.exists(path):
        continue
    with open(path, encoding="utf-8", errors="replace") as handle:
        text = handle.read()
    images = [
        match.group(1)
        for match in re.finditer(
            r"(?m)^[ \t]*image[ \t]*:[ \t]*['\"]?node:([0-9][0-9A-Za-z.\-]*)", text
        )
    ]
    if not images:
        fail(f"{path}: no 'image: node:<version>' found")
    for version in images:
        image_version_ok(path, version, "image")
    if re.search(r"\bcorepack\b", text):
        fail(f"{path}: corepack is not shipped with Node >={25}; remove it")

if os.path.exists(".devcontainer/Dockerfile"):
    with open(".devcontainer/Dockerfile", encoding="utf-8", errors="replace") as handle:
        text = handle.read()
    images = [
        match.group(1)
        for match in re.finditer(
            r"(?im)^[ \t]*FROM[ \t]+(?:--platform=\S+[ \t]+)?\S*node:([0-9][0-9A-Za-z.\-]*)",
            text,
        )
    ]
    if not images:
        fail(".devcontainer/Dockerfile: no 'FROM ...node:<version>' found")
    for version in images:
        image_version_ok(".devcontainer/Dockerfile", version, "FROM")
if os.path.exists(".gitlab-ci.yml") or os.path.exists("bitbucket-pipelines.yml") or os.path.exists(
    ".devcontainer/Dockerfile"
):
    ok(f"pipelines and devcontainers pin Node {target}")

# S8 - docs must not advertise a Node version below target ------------------
doc_paths = sorted(glob.glob("*.md")) + sorted(glob.glob("docs/**/*.md", recursive=True))
old_major = r"(1[0-9]|2[0-5])"
stale_patterns = [
    re.compile(rf"(?<![\d.])>=\s*`?{old_major}\b"),
    re.compile(rf"Node(?:\.js)?\s*`?\s*{old_major}\b"),
    re.compile(rf"node:{old_major}\b"),
    re.compile(rf"\b{old_major}\.x\b"),
    re.compile(r"\b26\.[xX*]\b"),
]
target_minor = target_tuple[1]
target_patch = target_tuple[2]
doc_failures_before = len(failures)
for path in doc_paths:
    with open(path, encoding="utf-8", errors="replace") as handle:
        for lineno, line in enumerate(handle, 1):
            decoded = html.unescape(line)
            decoded = (
                decoded.replace("\u2265", ">=")
                .replace("\u2264", "<=")
                .replace("\uff1e", ">")
                .replace("\uff1c", "<")
            )
            matched = False
            for pattern in stale_patterns:
                if pattern.search(decoded):
                    fail(f"{path}:{lineno}: stale Node version: {decoded.strip()}")
                    matched = True
                    break
            if matched:
                continue
            for match in re.finditer(r"\b26\.(\d+)(?:\.(\d+))?\b", decoded):
                minor = int(match.group(1))
                patch = int(match.group(2) or 0)
                if (minor, patch) < (target_minor, target_patch):
                    fail(
                        f"{path}:{lineno}: Node {match.group(0)} is below target "
                        f"{target}: {decoded.strip()}"
                    )
                    break
if len(failures) == doc_failures_before:
    ok(f"docs do not advertise a Node version below {target}")

if failures:
    for message in failures:
        print("FAIL: " + message, file=sys.stderr)
    sys.exit(1)
PY
then
  echo "GATE: FAILED" >&2
  exit 1
fi

# RUNTIME - optional assertion that the interpreter is the pinned version --
if [ "${GATE_REQUIRE_RUNTIME:-0}" = "1" ]; then
  ACTUAL="$(node -v 2>/dev/null | sed 's/^v//' || true)"
  if [ "$ACTUAL" != "$TARGET" ]; then
    echo "FAIL: running node is ${ACTUAL:-unknown}, expected $TARGET" >&2
    echo "GATE: FAILED" >&2
    exit 1
  fi
  echo "ok: runtime node $ACTUAL"
else
  echo "note: runtime not asserted (set GATE_REQUIRE_RUNTIME=1 to require node $TARGET)"
fi

echo "GATE: PASSED ($TARGET)"
