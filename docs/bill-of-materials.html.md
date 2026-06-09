# Stealth Lightbeacon Node — Bill of Materials

<section>
  <p><strong>Repository:</strong> <code>stealth-lightbeacon-node</code></p>
  <p><strong>Origin:</strong> <code>https://github.com/pratik-saptarshi/stealth-lightbeacon-node</code></p>
  <p><strong>Package:</strong> <code>stealth-lightbeacon-node@3.0.11</code></p>
  <p><strong>Runtime:</strong> Node.js CLI, HTTP service, and MCP stdio server</p>
  <p><strong>Package manager:</strong> <code>pnpm@11.4.0</code></p>
  <p><strong>Node engine:</strong> <code>&gt;=24.0.0</code></p>
  <p><strong>Publish target:</strong> public npm package, global-installable CLI</p>
  <p><strong>Publishing gate updated:</strong> 2026-06-09</p>
  <p><strong>Gate owner:</strong> release operator for the current Beads publishing issue</p>
</section>

---

## 1) Publishable Artifacts

This document is the source-of-truth bill of materials for deciding whether the repository is safe to push to `origin/main` and later publish to npm. It inventories publishable package contents, non-publishable repository materials, security/privacy controls, and the evidence required by `docs/publishing-roadmap-checklist.md`.

### 1.1 Package Entrypoints

| Surface | Package field | Artifact |
| --- | --- | --- |
| Library main | `main` | `dist/index.js` |
| CLI binary | `bin.stealth-lightbeacon` | `dist/cli.js` |
| MCP binary | `bin.stealth-lightbeacon-mcp` | `dist/mcp/stdio.js` |
| HTTP service | `stealth-lightbeacon serve` | `dist/service/server.js` |

### 1.2 Package Boundary

The root package `files` allowlist is the authoritative publish boundary:

- `dist/**/*.js`
- `README.md`
- `readme.md`
- `LICENSE`
- `SECURITY.md`
- `.env.example`

The npm tarball must not include:

- `src/`
- `dist/.tsbuildinfo`
- `tests/`
- `docs/`
- `.github/`
- `.beads/`
- `desktop/`
- `.tmp/`, `.data/`, `.cache/`, `reports/`
- lockfile cache folders, local stores, graph outputs, or integration logs
- secrets, private hostnames, customer data, screenshots, or generated audit artifacts

Package boundary verification is automated by:

```sh
pnpm pack --dry-run > .tmp/release-evidence/pack-dry-run.txt
node tools/check-package-boundary.js .tmp/release-evidence/pack-dry-run.txt
```

Any package-boundary failure is a publish no-go until corrected.

### 1.3 Release Metadata

Required public package metadata:

- `author`: present
- `license`: `MIT`
- `repository`: GitHub origin URL
- `homepage`: repository README URL
- `bugs`: GitHub issues URL
- `publishConfig.access`: `public`

Metadata verification is covered by `tests/package-boundary.test.js` and the CI package-boundary check.

### 1.4 Non-Publishable Repository Materials

The repository intentionally contains development and validation material that must stay out of the npm tarball:

| Area | Examples | Publish handling |
| --- | --- | --- |
| Source | `src/**/*.ts`, Rust sources under `src/backend/` | Built to `dist/**/*.js`; source is not in the package allowlist |
| Tests | `tests/**/*.test.js`, integration tests | Used for CI only; excluded from tarball |
| Governance | `.beads/`, docs, review state, AGENTS instructions | Versioned in git; excluded from tarball |
| CI/CD | `.github/`, `.gitlab-ci.yml`, `bitbucket-pipelines.yml` | Versioned in git; excluded from tarball |
| Desktop subtree | `desktop/` | Out of root npm package scope |
| Build/cache artifacts | `dist/.tsbuildinfo`, `target/`, `.pnpm-store/`, `.tmp/`, `.cache/` | Must not be intentionally staged for release docs/packaging |
| Release evidence | `.tmp/release-evidence/*` | Captured for operators; excluded from tarball |

---

## 2) Runtime Components

### 2.1 CLI and Commands

- `stealth-lightbeacon evaluate <url>`: bounded audit execution.
- `stealth-lightbeacon recon <url>`: pre-audit reconnaissance.
- `stealth-lightbeacon search-semantic <query>`: persisted ontology search.
- `stealth-lightbeacon serve`: local HTTP service mode.
- Root compatibility mode supports `--search-semantic <query>`.
- Reserved or controlled flags include `--http2`, `--persist`, `--no-persist`, `--allow-private`, and `--api-key`.

### 2.2 HTTP Service Surface

- Service runtime modules:
  - `dist/service/server.js`
  - `dist/service/config.js`
  - `dist/service/jobs.js`
  - `dist/service/auditRunner.js`
  - `dist/service/artifacts.js`
  - `dist/service/reconRunner.js`
- Implemented endpoints:
  - `GET /health`
  - `GET /capabilities`
  - `POST /evaluations`
  - `GET /evaluations/{id}`
  - `GET /evaluations/{id}/result`
  - `GET /evaluations/{id}/artifacts`
  - `GET /evaluations/{id}/artifacts/{name}`
  - `POST /recon`
- Security/recovery controls:
  - bearer-token auth is opt-in for non-health endpoints
  - TLS key/cert config fails fast when invalid
  - terminal evaluation job state reloads from the configured artifact root
  - corrupted recovered state produces degraded health with bounded errors

### 2.3 MCP Surface

- MCP stdio binary: `dist/mcp/stdio.js`.
- Source modules:
  - `src/mcp/client.ts`
  - `src/mcp/protocol.ts`
  - `src/mcp/server.ts`
  - `src/mcp/stdio.ts`

### 2.4 Core Modules

- Orchestration and crawl lifecycle:
  - `src/core/orchestrator.ts`
  - `src/core/crawler.ts`
  - `src/core/watcher.ts`
- Fetching, rendering, and network safety:
  - `src/core/fetcher.ts`
  - `src/core/ssrf.ts`
  - `src/core/robots.ts`
  - `src/core/scraping/browserPool.ts`
- Reporting and budgets:
  - `src/core/reporter.ts`
  - `src/core/budget.ts`
- Persistence and retrieval:
  - `src/core/ontology.ts`
  - `src/core/diffEngine.ts`
  - `src/core/cache.ts`
  - `src/core/pagespeed.ts`
  - `src/core/pagespeedCache.ts`
- Recon:
  - `src/core/recon.ts`

### 2.5 Evaluators

- `src/evaluators/accessibility.ts`
- `src/evaluators/aeo.ts`
- `src/evaluators/drupalSecurity.ts`
- `src/evaluators/geo.ts`
- `src/evaluators/performance.ts`
- `src/evaluators/seo.ts`
- `src/evaluators/ux.ts`

### 2.6 Desktop Subtree

`desktop/` is a sibling development surface and is out of scope for the root npm tarball unless a future release explicitly changes the package boundary.

---

## 3) Dependency Inventory

### 3.1 Production Dependencies

| Dependency | Purpose | Publish risk note |
| --- | --- | --- |
| `@duckdb/node-api` | embedded audit/cache persistence | native package behavior must be smoke-tested after install |
| `@lancedb/lancedb` | vector/ontology storage | native package behavior must be smoke-tested after install |
| `cheerio` | HTML parsing and summarization | parse untrusted HTML defensively |
| `commander` | CLI parsing | user input boundary |
| `handlebars` | HTML report rendering | report data escaping must remain covered |
| `lighthouse` | performance auditing | may require runtime environment support |
| `ora` | CLI spinner/status UX | no security-sensitive role |
| `playwright-core` | optional rendered/stealth fetch support | browser runtime expectations must be documented |
| `robots-parser` | robots.txt handling | crawl policy control |
| `zod` | runtime config validation | config boundary validation |

### 3.2 Development Dependencies

- `typescript`
- `ts-node`
- `release-it`
- `@release-it/conventional-changelog`

### 3.3 Lockfiles and Install Policy

- Root lockfile: `pnpm-lock.yaml`
- Package manager pin: `packageManager: pnpm@11.4.0`
- `.npmrc` forces `/bin/sh` for package scripts and disables package-manager auto-version management.
- No `preinstall` hook blocks npm global install; pnpm remains required for repository development and CI.

---

## 4) Security and Privacy Controls

### 4.1 Network Safety

- SSRF protection blocks private, loopback, and link-local targets by default.
- DNS/socket pinning protects the fetch path against rebinding classes of bugs.
- `--allow-private` is an explicit override and must not be used for untrusted targets.
- Robots policy and crawl boundary controls live in `src/core/robots.ts`.

### 4.2 Secrets and Sensitive Data

- `.env.example` must remain placeholder-only.
- `--api-key` exists for compatibility but is not safe default guidance because command-line arguments can leak through shell history and process listings.
- Prefer environment or secret-manager injection for Google PageSpeed and other credentials.
- Reports, logs, screenshots, issues, and release evidence must redact:
  - API keys and tokens
  - cookies and auth headers
  - private hostnames and internal URLs
  - customer data and proprietary page contents

Required secret/privacy checks before pushing or tagging a release candidate:

```sh
git grep -n -I -E '(AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9_]{36,}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----)' -- . ':!pnpm-lock.yaml'
pnpm run release:security:check
```

The grep check is a local pattern screen, not a substitute for GitHub secret scanning. GitHub secret-scanning alerts must be reviewed manually before npm publication.

### 4.3 GitHub and CI Controls

- `.github/workflows/ci.yml` uses Node `24.x`, frozen pnpm install, build, and `pnpm run quality:check`.
- `.github/workflows/stealth-lightbeacon-audit.yml` is an audit workflow and must remain least-privilege.
- GitHub CodeQL/code scanning, Dependabot alerts, and secret scanning status must be reviewed before publish.

Current remote publishing gate:

- Push target: `origin/main`
- Required workflow: `.github/workflows/ci.yml`
- Required code scanning workflow: CodeQL for actions, JavaScript/TypeScript, and Rust
- Manual review: Dependabot, CodeQL alerts, secret-scanning alerts, and any bypassed branch-protection messages

---

## 5) Quality and Release Tooling

### 5.1 Required Local Gates

- `pnpm install --frozen-lockfile`
- `pnpm run build`
- `pnpm run quality:check`
- `pnpm run test:mcp:contract`
- `pnpm audit --prod`
- `pnpm pack --dry-run`
- `pnpm run release:dry`

For a repository push gate, `pnpm run quality:check`, `pnpm audit --prod`, `pnpm pack --dry-run`, package-boundary verification, Beads lint/export, and GitHub Actions monitoring are mandatory. `pnpm run release:dry` remains mandatory before npm publication because it exercises release mechanics and changelog generation.

### 5.1.1 `pnpm pack --dry-run` evidence

Latest checked dry-run output for `stealth-lightbeacon-node@3.0.11` included only:

- `.env.example`
- `dist/**/*.js`, including service runtime files under `dist/service/`
- `LICENSE`
- `package.json`
- `readme.md`
- `SECURITY.md`

The dry-run output did not include `src/`, `tests/`, `docs/`, `.github/`, `.beads/`, `desktop/`, `.npmrc`, `.pnpm-store/`, `dist/.tsbuildinfo`, local reports, or cache directories.

### 5.1.2 Release security and SBOM evidence paths

Release evidence should be captured under `.tmp/release-evidence/` and kept out of the npm tarball:

- `.tmp/release-evidence/sbom.cyclonedx.json`
- `.tmp/release-evidence/secret-scan.txt`
- `.tmp/release-evidence/audit-prod.txt`
- `.tmp/release-evidence/pack-dry-run.txt`
- `.tmp/release-evidence/quality-check.txt`
- `.tmp/release-evidence/codeql-status.txt`

The release owner must review SBOM requirements, secret-scan results, prod audit output, CodeQL/code-scanning status, Dependabot alerts, and tarball artifact hygiene before tagging or publishing.

### 5.2 Coverage Gate

`pnpm run quality:check` includes per-file coverage validation through `tools/check-coverage.js`.
Included files must meet these thresholds unless listed in the approved exception registry:

- line coverage >= `85%`
- branch coverage >= `85%`
- function coverage >= `85%`

The per-file exception registry is intentionally explicit in `tools/check-coverage.js`. Adding a new under-threshold included file without adding it to the registry fails the gate.

### 5.3 Release Automation

- Release wrapper: `tools/release.sh`
- release-it config: `.release-it.json`
- Conventional changelog plugin: `@release-it/conventional-changelog`
- Release working tree must be clean before production release commands.

---

## 6) Publishing Gate Summary

Publishing is allowed only when all gates in `docs/publishing-roadmap-checklist.md` are green:

1. Metadata and ownership gate
2. Tarball boundary gate
3. Security, privacy, and secrets gate
4. README and support documentation gate
5. Quality and pack dry-run gate
6. Remote push and GitHub Actions monitoring gate
7. Post-publish smoke gate

Any failed gate is a no-go. Do not tag or publish until the gate is resolved or explicitly accepted with a documented risk owner.

---

## 7) Current Publishing Gate Checklist

Treat this checklist as the compact go/no-go summary for pushing `main` to `origin` from this repository.

| Gate | Evidence | Status rule |
| --- | --- | --- |
| Branch and tracker | `git status --short --branch`, `bd ready`, claimed/closed Beads issue | Must show only intentional generated dirt and no untracked release artifacts |
| Package metadata | `package.json`, `tests/package-boundary.test.js` | Metadata must match npm public package expectations |
| Tarball boundary | `pnpm pack --dry-run`, `node tools/check-package-boundary.js ...` | Tarball must contain only allowlisted package files |
| Security audit | `pnpm audit --prod` | No production dependency advisory can remain unresolved |
| Secret scan | local grep screen plus GitHub secret-scanning review | No unresolved secret exposure |
| Privacy review | README/SECURITY/BOM release evidence redaction guidance | No private URLs, credentials, cookies, customer data, or proprietary page contents in docs/evidence |
| Quality | `pnpm run quality:check`, `node tools/check-coverage.js`, `bd lint` | All must pass |
| Release dry run | `pnpm run release:dry` | Required before npm publication; failures block npm publish |
| Remote publish | `git push origin main --follow-tags` | Push must succeed and leave local `main` synced |
| CI monitor | `gh run list --branch main`, `gh run view ...` | CI and CodeQL must complete successfully |

If any automated gate cannot run because of network or credential access, record it as a no-go unless a release owner explicitly accepts the risk in release notes.

### 7.1 Current Evidence Notes

- Local SBOM evidence was generated with `pnpm dlx @cyclonedx/cdxgen -t npm -o .tmp/release-evidence/sbom.cyclonedx.json`.
- The SBOM generator reported a local secure-mode warning because `NODE_PATH` was set in the operator environment; the generated SBOM file is still valid CycloneDX evidence.
- CI regenerates release evidence independently on `origin/main`; the pushed run must be monitored to success before treating the remote publishing gate as closed.
