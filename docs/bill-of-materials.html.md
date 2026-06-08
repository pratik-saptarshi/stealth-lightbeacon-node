# Stealth Lightbeacon Node — Bill of Materials

<section>
  <p><strong>Repository:</strong> <code>stealth-lightbeacon-node</code></p>
  <p><strong>Origin:</strong> <code>https://github.com/pratik-saptarshi/stealth-lightbeacon-node</code></p>
  <p><strong>Package:</strong> <code>stealth-lightbeacon-node@3.0.11</code></p>
  <p><strong>Runtime:</strong> Node.js CLI and MCP stdio server</p>
  <p><strong>Package manager:</strong> <code>pnpm@11.4.0</code></p>
  <p><strong>Node engine:</strong> <code>&gt;=24.0.0</code></p>
  <p><strong>Publish target:</strong> public npm package, global-installable CLI</p>
</section>

---

## 1) Publishable Artifacts

### 1.1 Package Entrypoints

| Surface | Package field | Artifact |
| --- | --- | --- |
| Library main | `main` | `dist/index.js` |
| CLI binary | `bin.stealth-lightbeacon` | `dist/cli.js` |
| MCP binary | `bin.stealth-lightbeacon-mcp` | `dist/mcp/stdio.js` |

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

### 1.3 Release Metadata

Required public package metadata:

- `author`: present
- `license`: `MIT`
- `repository`: GitHub origin URL
- `homepage`: repository README URL
- `bugs`: GitHub issues URL
- `publishConfig.access`: `public`

---

## 2) Runtime Components

### 2.1 CLI and Commands

- `stealth-lightbeacon evaluate <url>`: bounded audit execution.
- `stealth-lightbeacon recon <url>`: pre-audit reconnaissance.
- `stealth-lightbeacon search-semantic <query>`: persisted ontology search.
- Root compatibility mode supports `--search-semantic <query>`.
- Reserved or controlled flags include `--http2`, `--persist`, `--no-persist`, `--allow-private`, and `--api-key`.

### 2.2 MCP Surface

- MCP stdio binary: `dist/mcp/stdio.js`.
- Source modules:
  - `src/mcp/client.ts`
  - `src/mcp/protocol.ts`
  - `src/mcp/server.ts`
  - `src/mcp/stdio.ts`

### 2.3 Core Modules

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

### 2.4 Evaluators

- `src/evaluators/accessibility.ts`
- `src/evaluators/aeo.ts`
- `src/evaluators/drupalSecurity.ts`
- `src/evaluators/geo.ts`
- `src/evaluators/performance.ts`
- `src/evaluators/seo.ts`
- `src/evaluators/ux.ts`

### 2.5 Desktop Subtree

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
- `preinstall` rejects non-pnpm installs for repository development.

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

### 4.3 GitHub and CI Controls

- `.github/workflows/ci.yml` uses Node `24.x`, frozen pnpm install, build, and `pnpm run quality:check`.
- `.github/workflows/stealth-lightbeacon-audit.yml` is an audit workflow and must remain least-privilege.
- GitHub CodeQL/code scanning, Dependabot alerts, and secret scanning status must be reviewed before publish.

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

### 5.2 Coverage Gate

`pnpm run quality:check` includes coverage validation through `tools/check-coverage.js`.
Current thresholds:

- line coverage >= `80%`
- branch coverage >= `65%`
- function coverage >= `75%`

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
