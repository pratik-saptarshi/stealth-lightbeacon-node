# CLI Runbook: stealth-lightbeacon-node

This document provides a verbose, operations-focused guide for running the CLI safely and repeatably, including recently successful commands and environment configurations validated in this workspace.

## 1. Scope and Goals

Use this runbook to:
- build and validate the project before audits,
- run single-site and multi-site audits,
- summarize crawl coverage from generated reports,
- apply security and privacy guardrails for external-site testing.

Primary executable paths:
- CLI auditor: `dist/cli.js` (`stealth-lightbeacon` bin)
- MCP stdio server: `dist/mcp/stdio.js` (`stealth-lightbeacon-mcp` bin)

## 2. Prerequisites

- Node.js `>=24.0.0` (repo currently validated on Node `26.0.0`).
- npm available in PATH.
- Network egress allowed for target domains and any external APIs used by enabled checks.
- Write access to workspace output directories (recommended: `.tmp/reports/...`).

Install/build:

```bash
npm ci
npm run build
```

## 3. Environment Configuration

Baseline environment file reference: `.env.example`

```dotenv
NODE_ENV=development
GOOGLE_PAGESPEED_API_KEY=
PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
CHROME_BIN=/usr/bin/chromium
```

### 3.1 Recommended runtime toggles for external audits

- `STEALTH_LIGHTBEACON_ONTOLOGY=0`
  - Compatibility mode that avoids optional native ontology-binding failures in environments where those optional binaries are unavailable.
- `REQUEST_TIMEOUT_SECONDS=20`
  - Used by `scripts/run-external-audits.sh` preflight checks.

### 3.2 Script-level knobs (`scripts/run-external-audits.sh`)

- `OUT_BASE` (default `.tmp/reports/external`)
- `CRAWL_DEPTH` (default `2`)
- `MAX_URLS` (default `1000`)
- `ENGINE` (default `http`)
- `SKIP_PDF` (default `1`)
- `CHECK_LINKS` (default `1`)
- `CHECK_API` (default `0`)
- `BUILD_FIRST` (default `1`)
- `DISABLE_ONTOLOGY` (default `1`)

Safe bounded profile for external domains:

```bash
CRAWL_DEPTH=1 MAX_URLS=150 SKIP_PDF=1 CHECK_LINKS=1 CHECK_API=0
```

## 4. CLI Command Reference

### 4.1 Single-domain audit

```bash
node dist/cli.js evaluate https://example.com \
  --out .tmp/reports/example.com \
  --format both \
  --crawl-depth 1 \
  --max-urls 150 \
  --engine http \
  --no-pdf
```

With ontology disabled for compatibility:

```bash
STEALTH_LIGHTBEACON_ONTOLOGY=0 node dist/cli.js evaluate https://example.com \
  --out .tmp/reports/example.com \
  --format both --crawl-depth 1 --max-urls 150 --engine http --no-pdf
```

### 4.2 Multi-domain batch audit (helper script)

```bash
scripts/run-external-audits.sh prudential.com empower.com cigna.com fidelity.com
```

Bounded variant:

```bash
CRAWL_DEPTH=1 MAX_URLS=250 scripts/run-external-audits.sh \
  prudential.com empower.com cigna.com fidelity.com
```

### 4.3 Coverage summarization

```bash
node scripts/summarize-coverage.js .tmp/reports/external \
  prudential.com empower.com cigna.com fidelity.com
```

Outputs:
- JSON summary array
- CSV line set with:
  - `domain`
  - `crawledPages`
  - `brokenPages`
  - `discoveredUrls`
  - `discoveredCoveragePct`
  - optional sitemap fields when available

## 5. Validation Pipeline Before External Runs

Run in order:

```bash
npm run build
npm run test
npm run coverage:check
npm run audit:signatures
```

Interpretation guidance:
- `build` and `audit:signatures` should pass.
- `test` and `coverage:check` can fail in sandboxed/macOS-restricted environments due to browser launch permissions or DNS/network restrictions; treat these as environment-constrained failures when failure signatures match known patterns.

## 6. CI/CD Integration

For automated runs, utilize the pre-built pipeline configurations:
- **GitHub Actions**: `.github/workflows/`
- **GitLab CI**: `.gitlab-ci.yml`
- **Bitbucket Pipelines**: `bitbucket-pipelines.yml`

These recipes are configured to execute `stealth-lightbeacon-node` against a staging or production URL, failing the pipeline if configured budgets are exceeded.

## 7. Recently Successful Commands (Validated in this Workspace)

Date context: `2026-05-24` (local workspace session)

### 6.1 Validation commands

Successful:

```bash
/usr/local/bin/lean-ctx -c 'npm run build'
/usr/local/bin/lean-ctx -c 'npm run audit:signatures'
```

Observed result:
- TypeScript build completed.
- npm signature audit completed (`292` packages with verified registry signatures; `63` with verified attestations).

### 6.2 Successful external domain CLI runs

```bash
/usr/local/bin/lean-ctx -c 'STEALTH_LIGHTBEACON_ONTOLOGY=0 node dist/cli.js evaluate https://empower.com --out .tmp/reports/external/empower.com --format both --crawl-depth 1 --max-urls 150 --engine http --no-pdf'

/usr/local/bin/lean-ctx -c 'STEALTH_LIGHTBEACON_ONTOLOGY=0 node dist/cli.js evaluate https://cigna.com --out .tmp/reports/external/cigna.com --format both --crawl-depth 1 --max-urls 150 --engine http --no-pdf'

/usr/local/bin/lean-ctx -c 'STEALTH_LIGHTBEACON_ONTOLOGY=0 node dist/cli.js evaluate https://fidelity.com --out .tmp/reports/external/fidelity.com --format both --crawl-depth 1 --max-urls 150 --engine http --no-pdf'

/usr/local/bin/lean-ctx -c 'STEALTH_LIGHTBEACON_ONTOLOGY=0 node dist/cli.js evaluate https://prudential.com --out .tmp/reports/external/prudential.com --format both --crawl-depth 1 --max-urls 150 --engine http --no-pdf'
```

Generated outputs per domain:
- `report.json`
- `report.html`
- `report.pdf`

### 6.3 Successful coverage summary command

```bash
/usr/local/bin/lean-ctx -c 'node scripts/summarize-coverage.js .tmp/reports/external prudential.com empower.com cigna.com fidelity.com'
```

Representative summary from that run:
- `prudential.com`: crawled `0`, broken `1`, discovered coverage `0.00%`
- `empower.com`: crawled `152`, broken `0`, discovered coverage `100.00%`
- `cigna.com`: crawled `52`, broken `2`, discovered coverage `96.30%`
- `fidelity.com`: crawled `3`, broken `0`, discovered coverage `100.00%`

## 7. Troubleshooting Notes

### 7.1 Optional native binding error

Symptom:
- `Cannot find native binding... optional dependencies ...`

Action:
- rerun with `STEALTH_LIGHTBEACON_ONTOLOGY=0` for external audits, or
- repair optional dependency install in a clean environment.

### 7.2 DuckDB lock contention

Symptom:
- `Could not set lock on file ... pagespeed.duckdb ... Conflicting lock is held ...`

Action:
- ensure previous audit process has exited,
- terminate stale holder process if needed,
- rerun the domain audit.

### 7.3 Network reachability drift

Symptom:
- `ENOTFOUND`, `ECONNREFUSED`, or preflight `curl` failures.

Action:
- run with bounded depth/URL values,
- retry affected domains separately,
- treat coverage as "discovered scope" rather than universal proof of all public pages.

## 8. Security and Privacy Best Practices (Validated)

### 8.1 Practices to follow

- Never commit real secrets in code, docs, reports, or logs.
- Keep API credentials out of CLI arguments when possible (shell history/process exposure risk).
- Prefer environment injection for secrets (`GOOGLE_PAGESPEED_API_KEY`).
- Write all artifacts to ignored output paths (for example `.tmp/reports/...`).
- Avoid including cookies/session data/personal data in exported reports.
- Use bounded crawl settings for external testing to reduce unintended collection scope.

### 8.2 Validation performed for this update

- Reviewed `SECURITY.md` and `readme.md` secret-handling guidance.
- Verified `.env.example` remains placeholder-only (no live credentials).
- Ran repository secret-pattern scan over tracked source/docs paths excluding build/vendor/temp directories:

```bash
rg -n --hidden --glob '!.git' --glob '!node_modules' --glob '!dist' --glob '!.tmp' \
  '(AKIA[0-9A-Z]{16}|-----BEGIN (RSA|EC|OPENSSH|PRIVATE) KEY-----|ghp_[A-Za-z0-9]{36,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|sk-[A-Za-z0-9]{20,})'
```

Result:
- No matches found.

## 9. Operational Caveat on “All Public Pages” Coverage

The generated coverage metrics validate crawl coverage of discovered URLs within configured limits. They do not prove exhaustive coverage of every public page on large external domains unless you combine:
- complete sitemap discovery across sitemap indexes,
- sufficiently deep crawl limits,
- and repeated runs accounting for dynamic navigation/state.

Treat `discoveredCoveragePct` as a bounded audit signal, not universal completeness proof.
