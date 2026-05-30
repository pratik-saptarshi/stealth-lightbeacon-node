# Stealth Lightbeacon Node — Bill of Materials (HTML Markdown)

<div>
  <p><strong>Document Scope:</strong> Repository-level BOM for runtime artifacts, source modules, dependencies, build and release tooling, security controls, and package-publish posture.</p>
  <p><strong>Repository:</strong> <code>stealth-lightbeacon-node</code></p>
  <p><strong>Primary Runtime:</strong> Node.js CLI + MCP stdio server</p>
  <p><strong>Package Manager:</strong> <code>pnpm</code> (enforced via <code>preinstall</code>)</p>
</div>

---

## 1) Product Components

### 1.1 Executables and Entry Points

- CLI binary: `stealth-lightbeacon` -> `dist/cli.js`
- MCP binary: `stealth-lightbeacon-mcp` -> `dist/mcp/stdio.js`
- Package main: `dist/index.js`

### 1.2 Core Runtime Modules

- Orchestration and crawl lifecycle:
  - `src/core/orchestrator.ts`
  - `src/core/crawler.ts`
  - `src/core/watcher.ts`
- Fetch and transport security:
  - `src/core/fetcher.ts`
  - `src/core/ssrf.ts`
  - `src/core/robots.ts`
- Report generation and formats:
  - `src/core/reporter.ts`
  - `src/core/budget.ts`
- Persistence, ontology, and diffing:
  - `src/core/ontology.ts`
  - `src/core/diffEngine.ts`
  - `src/core/cache.ts`
  - `src/core/pagespeed.ts`
  - `src/core/pagespeedCache.ts`

### 1.3 Evaluator Modules

- Accessibility: `src/evaluators/accessibility.ts`
- AEO: `src/evaluators/aeo.ts`
- Drupal Security: `src/evaluators/drupalSecurity.ts`
- GEO: `src/evaluators/geo.ts`
- Performance/CWV: `src/evaluators/performance.ts`
- SEO: `src/evaluators/seo.ts`
- UX: `src/evaluators/ux.ts`

### 1.4 MCP Surface

- Transport/client protocol:
  - `src/mcp/client.ts`
  - `src/mcp/protocol.ts`
- Server/tool composition:
  - `src/mcp/server.ts`
  - `src/mcp/stdio.ts`

### 1.5 Optional Desktop Surface (Sibling app-in-repo)

- Desktop package root: `desktop/`
- Current dependency: `electron` (runtime concerns are scoped to desktop app only)

---

## 2) Security Controls in Code

- SSRF and DNS rebinding controls:
  - Loopback/private address blocking and socket pinning in `src/core/ssrf.ts`
- Robots policy and crawl boundary controls:
  - `src/core/robots.ts`
- URL/host validation hardening:
  - Authority host parsing in `src/evaluators/geo.ts`
  - Schema host parsing in `src/evaluators/seo.ts`
- Safer HTML summarization path:
  - Cheerio-based extraction in `src/core/ontology.ts` (non-regex sanitization path)
- Workflow least privilege:
  - Explicit `permissions` in `.github/workflows/ci.yml`
  - Explicit `permissions` in `.github/workflows/stealth-lightbeacon-audit.yml`

---

## 3) Dependency BOM

### 3.1 Production Dependencies (Root Package)

- `@duckdb/node-api`
- `@lancedb/lancedb`
- `cheerio`
- `commander`
- `handlebars`
- `lighthouse`
- `ora`
- `playwright-core`
- `robots-parser`
- `zod`

### 3.2 Development Dependencies (Root Package)

- `typescript`
- `ts-node`
- `release-it`
- `@release-it/conventional-changelog`

### 3.3 Desktop Subpackage Dependency

- `electron` (in `desktop/package.json`)

### 3.4 Lockfiles

- Root lockfile: `pnpm-lock.yaml`
- Desktop lockfile: `desktop/pnpm-lock.yaml`

---

## 4) Build, Test, and Release Tooling

### 4.1 Build/Quality Scripts (Root)

- Build: `pnpm run build`
- Typecheck: `pnpm run typecheck`
- Unit/contract/coverage gate: `pnpm run quality:check`
- MCP contract lane: `pnpm run test:mcp:contract`

### 4.2 Coverage Gate

- Coverage validator: `tools/check-coverage.js`
- Quality chain includes coverage threshold enforcement

### 4.3 Release Automation

- Release command wrapper: `tools/release.sh`
- Automated versioning/changelog: `.release-it.json`

---

## 5) Packaging Boundary (Current)

### 5.1 Published File Allowlist

From root `package.json`:
- `dist`
- `README.md`
- `readme.md`
- `LICENSE`
- `SECURITY.md`
- `.env.example`

### 5.2 Packaging Notes

- Package is currently configured for Node >= 24.
- Package manager is pinned: `pnpm@11.4.0`.
- `preinstall` blocks non-pnpm installs.

---

## 6) Suggested Checklist: NPM Global Registry Publish Readiness

Use this as a release gate before `npm publish -g` style consumer workflows (or equivalent global install target).

### 6.1 Identity and Ownership

- [ ] npm org/user ownership confirmed for target package name.
- [ ] Package name availability and trademark check complete.
- [ ] `author`, `repository`, `homepage`, and `bugs` fields set in `package.json`.
- [ ] License string and LICENSE file validated.

### 6.2 Package Boundary and Artifacts

- [ ] `files` allowlist reviewed against intended shipped runtime only.
- [ ] No internal docs/tests/temp artifacts in tarball.
- [ ] `pnpm pack --dry-run` reviewed and archived in release notes.
- [ ] Bin paths (`dist/cli.js`, `dist/mcp/stdio.js`) executable and functional post-pack.

### 6.3 Runtime Compatibility

- [ ] Node engine policy (`>=24`) intentionally accepted for target users.
- [ ] Cross-platform CLI smoke tests run (macOS/Linux at minimum).
- [ ] Optional native dependency behavior documented (DuckDB/LanceDB install characteristics).

### 6.4 Security and Compliance

- [ ] `pnpm audit --prod` clean at release time.
- [ ] GitHub Dependabot alerts for shipped package scope reviewed/triaged.
- [ ] GitHub CodeQL alerts reviewed: no open release-blocking findings.
- [ ] Secret scan run against repo and tarball output.
- [ ] SBOM artifact generated and attached (CycloneDX/SPDX if required by policy).

### 6.5 Quality Gates

- [ ] `pnpm run quality:check` green on clean checkout.
- [ ] MCP contract tests green (`pnpm run test:mcp:contract`).
- [ ] Coverage thresholds pass and trend is stable.
- [ ] Manual smoke audit run performed against a known safe URL.

### 6.6 Release Mechanics

- [ ] Conventional commit history and changelog reviewed.
- [ ] `pnpm run release:dry` output reviewed.
- [ ] Version bump strategy verified (patch/minor/major correctness).
- [ ] Tag, GitHub release notes, and rollback plan prepared.

### 6.7 Global Install UX (npm Registry Consumer)

- [ ] `npm i -g <package>` test done in clean environment.
- [ ] `stealth-lightbeacon --help` and `stealth-lightbeacon-mcp` startup smoke-tested.
- [ ] Clear post-install guidance documented for optional capabilities (e.g., Playwright-related behavior).
- [ ] Error messages for missing optional runtime dependencies are actionable.

---

## 7) Recommended Next Steps Before Public npm Publish

1. Add missing package metadata fields (`repository`, `homepage`, `bugs`, `author` details).
2. Run and save `pnpm pack --dry-run` output as release evidence.
3. Decide whether `desktop/` artifacts should remain out-of-scope for the published root package.
4. Add an automated tarball-content CI check to block accidental publish-surface drift.

