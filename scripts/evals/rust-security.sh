#!/usr/bin/env bash
# Eval gate: Rust dependency audit and CycloneDX SBOM for the context daemon.
#
# Writes gitignored evidence under .tmp/:
#   rust-audit.json      cargo-audit JSON report
#   rust-audit.stderr    cargo-audit log output
#   rust-sbom.cdx.json   CycloneDX 1.6 JSON SBOM
#
# Requires cargo-audit and cargo-sbom on PATH; CI installs both with
# taiki-e/install-action. Exits non-zero when the audit reports a vulnerability.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPONENT_DIR="${RUST_COMPONENT_DIR:-$ROOT}"
OUT_DIR="${RUST_SECURITY_OUT_DIR:-$ROOT/.tmp}"
LOCKFILE="$COMPONENT_DIR/Cargo.lock"
AUDIT_JSON="$OUT_DIR/rust-audit.json"
AUDIT_LOG="$OUT_DIR/rust-audit.stderr"
SBOM_JSON="$OUT_DIR/rust-sbom.cdx.json"

fail() {
  echo "FAIL: $*" >&2
  echo "GATE: FAILED" >&2
  exit 1
}

for tool in cargo-audit cargo-sbom; do
  command -v "$tool" >/dev/null 2>&1 || fail "$tool is not installed or not on PATH"
done

[ -f "$LOCKFILE" ] || fail "$LOCKFILE is missing"
mkdir -p "$OUT_DIR"

echo "==> cargo audit ($LOCKFILE)"
audit_status=0
cargo audit --file "$LOCKFILE" --json > "$AUDIT_JSON" 2> "$AUDIT_LOG" || audit_status=$?
cat "$AUDIT_LOG" >&2

if ! node - "$AUDIT_JSON" <<'NODE'
const fs = require("node:fs");
const report = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const vulnerabilities = report.vulnerabilities ?? {};
console.log(
  `audit: ${report.lockfile?.["dependency-count"] ?? "?"} dependencies, ` +
    `${vulnerabilities.count ?? 0} vulnerabilities`,
);
for (const entry of vulnerabilities.list ?? []) {
  const advisory = entry.advisory ?? {};
  const pkg = entry.package ?? {};
  console.log(
    `  VULNERABLE ${advisory.id ?? "?"} ${pkg.name ?? "?"}@${pkg.version ?? "?"}: ${advisory.title ?? ""}`,
  );
}
for (const kind of ["unmaintained", "unsound", "notice"]) {
  for (const entry of report.warnings?.[kind] ?? []) {
    const advisory = entry.advisory ?? {};
    const pkg = entry.package ?? {};
    console.log(
      `  ${kind.toUpperCase()} ${advisory.id ?? "?"} ${pkg.name ?? "?"}@${pkg.version ?? "?"}: ${advisory.title ?? ""}`,
    );
  }
}
NODE
then
  fail "cargo audit report is not valid JSON"
fi

echo "==> cargo sbom (CycloneDX 1.6 JSON)"
sbom_status=0
cargo sbom --project-directory "$COMPONENT_DIR" --output-format cyclone_dx_json_1_6 \
  > "$SBOM_JSON" || sbom_status=$?
if [ "$sbom_status" -ne 0 ]; then
  rm -f "$SBOM_JSON"
  fail "cargo sbom failed (exit $sbom_status)"
fi

if ! node - "$SBOM_JSON" <<'NODE'
const fs = require("node:fs");
const bom = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (bom.bomFormat !== "CycloneDX" || !Array.isArray(bom.components)) {
  throw new Error("document is not CycloneDX JSON");
}
console.log(`sbom: CycloneDX ${bom.specVersion}, ${bom.components.length} components`);
NODE
then
  fail "SBOM is not valid CycloneDX JSON"
fi

echo "wrote $AUDIT_JSON"
echo "wrote $SBOM_JSON"

if [ "$audit_status" -ne 0 ]; then
  fail "cargo audit reported findings (exit $audit_status)"
fi

echo "GATE: PASSED"
