#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ "${1:-}" == "--help" ]]; then
  cat <<'EOF'
Usage:
  scripts/run-external-audits.sh [domain ...]

Examples:
  scripts/run-external-audits.sh prudential.com empower.com cigna.com fidelity.com
  CRAWL_DEPTH=2 MAX_URLS=1000 scripts/run-external-audits.sh prudential.com

Environment overrides:
  OUT_BASE=.tmp/reports/external
  CRAWL_DEPTH=2
  MAX_URLS=1000
  ENGINE=http
  SKIP_PDF=1
  CHECK_LINKS=1
  CHECK_API=0
  BUILD_FIRST=1
  DISABLE_ONTOLOGY=1
  REQUEST_TIMEOUT_SECONDS=20
EOF
  exit 0
fi

OUT_BASE="${OUT_BASE:-.tmp/reports/external}"
CRAWL_DEPTH="${CRAWL_DEPTH:-2}"
MAX_URLS="${MAX_URLS:-1000}"
ENGINE="${ENGINE:-http}"
SKIP_PDF="${SKIP_PDF:-1}"
CHECK_LINKS="${CHECK_LINKS:-1}"
CHECK_API="${CHECK_API:-0}"
BUILD_FIRST="${BUILD_FIRST:-1}"
DISABLE_ONTOLOGY="${DISABLE_ONTOLOGY:-1}"
REQUEST_TIMEOUT_SECONDS="${REQUEST_TIMEOUT_SECONDS:-20}"

if [[ "$#" -eq 0 ]]; then
  DOMAINS=(prudential.com empower.com cigna.com fidelity.com)
else
  DOMAINS=("$@")
fi

echo "== External audit run =="
echo "Root: $ROOT_DIR"
echo "Domains: ${DOMAINS[*]}"
echo "Out base: $OUT_BASE"
echo "Settings: depth=$CRAWL_DEPTH max_urls=$MAX_URLS engine=$ENGINE skip_pdf=$SKIP_PDF check_links=$CHECK_LINKS check_api=$CHECK_API"

if [[ "$BUILD_FIRST" == "1" ]]; then
  echo "== Build =="
  pnpm run build
fi

mkdir -p "$OUT_BASE"

echo "== Network preflight =="
for domain in "${DOMAINS[@]}"; do
  url="https://${domain}"
  echo "-- $url"
  if ! curl -I -L --max-time "$REQUEST_TIMEOUT_SECONDS" "$url" >/dev/null 2>&1; then
    echo "WARN: curl preflight failed for $url"
  else
    echo "OK: curl preflight succeeded for $url"
  fi
done

for domain in "${DOMAINS[@]}"; do
  url="https://${domain}"
  out_dir="${OUT_BASE}/${domain}"
  mkdir -p "$out_dir"

  echo "== Auditing $url =="
  cmd=(node dist/cli.js evaluate "$url" --out "$out_dir" --format both --crawl-depth "$CRAWL_DEPTH" --max-urls "$MAX_URLS" --engine "$ENGINE")
  if [[ "$SKIP_PDF" == "1" ]]; then
    cmd+=(--no-pdf)
  fi
  if [[ "$CHECK_LINKS" == "1" ]]; then
    cmd+=(--check-links)
  fi
  if [[ "$CHECK_API" == "1" ]]; then
    cmd+=(--check-api)
  fi

  if [[ "$DISABLE_ONTOLOGY" == "1" ]]; then
    STEALTH_LIGHTBEACON_ONTOLOGY=0 "${cmd[@]}"
  else
    "${cmd[@]}"
  fi
done

echo "== Coverage summary =="
node scripts/summarize-coverage.js "$OUT_BASE" "${DOMAINS[@]}"

