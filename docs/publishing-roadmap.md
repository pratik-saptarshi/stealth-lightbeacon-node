# Publishing Roadmap — npm Global Registry Readiness

## Scope
This roadmap operationalizes the npm global publish-readiness checklist in `docs/bill-of-materials.html.md` into an execution plan with measurable gates, artifacts, and rollback controls.

- Target package: `stealth-lightbeacon-node`
- Publish target: npm public registry (global-installable CLI)
- Package manager baseline: `pnpm`
- Current release branch baseline: `main`

---

## 1) Traceability Map (Checklist -> Roadmap)

| Checklist Area | Roadmap Phase | Priority | Disposition |
|---|---|---|---|
| Identity and ownership | Phase 0 | P0 | Must-fix before first publish |
| Package boundary and artifacts | Phase 1 | P0 | Must-fix |
| Runtime compatibility | Phase 2 | P1 | Must-fix |
| Security and compliance | Phase 3 | P0 | Must-fix |
| Quality gates | Phase 4 | P0 | Must-fix |
| Release mechanics | Phase 5 | P1 | Bundle into release gate |
| Global install UX | Phase 6 | P1 | Must-fix for GA publish |

---

## 2) Final Recommendation State

`Applied with caveats`

Caveats to clear before first npm publish:
- Root package metadata is incomplete for public package governance (`repository`, `homepage`, `bugs`, structured `author`).
- Desktop subpackage security/dependency posture is now improved, but publish scope must be explicitly controlled so root npm package cannot unintentionally ship desktop-only concerns.
- Deterministic tarball allowlist CI validation is not yet enforced.

---

## 3) Phase Plan

## Phase 0 — Ownership and Package Identity (P0)

### Objective
Ensure package ownership, legal metadata, and discoverability metadata are complete and accurate.

### Tasks
1. Confirm npm package name availability and ownership model (`user` or `org`).
2. Add/verify `repository`, `homepage`, `bugs`, and canonical `author` in root `package.json`.
3. Validate license metadata consistency (`license` field + `LICENSE` file).
4. Add support contact path and security disclosure link consistency.

### Commands / Evidence
- `npm view stealth-lightbeacon-node name version` (availability/state check)
- `pnpm run pack:dry` (post-metadata update)
- `git diff package.json LICENSE SECURITY.md`

### Exit Criteria
- Metadata fields present and valid.
- No legal/ownership ambiguity remains.

### Artifacts
- Updated `package.json`
- Release note snippet documenting ownership decision.

---

## Phase 1 — Publish Surface Hardening (P0)

### Objective
Prove the npm tarball contains only intended runtime artifacts.

### Tasks
1. Re-verify `files` allowlist in root `package.json` against desired public surface.
2. Add CI check that fails if tarball contains disallowed paths (`docs/`, `tests/`, `.tmp/`, internal review artifacts, local config).
3. Ensure root package excludes desktop app runtime from npm artifact unless intentionally shipped.
4. Add explicit package boundary policy section to README.

### Commands / Evidence
- `pnpm pack --dry-run`
- tarball inspection script (e.g., `tools/verify-tarball-contents.sh` or node equivalent)

### Exit Criteria
- Tarball diff reviewed and approved.
- CI blocks publish when boundary drifts.

### Artifacts
- Tarball audit output attached to release evidence.
- CI workflow update for boundary checks.

---

## Phase 2 — Runtime Compatibility & Install Matrix (P1)

### Objective
Validate global install and runtime behavior across supported environments.

### Tasks
1. Define support matrix: Node versions, OS targets, shell compatibility.
2. Validate `npm i -g <package>` path in clean environments.
3. Validate executable entrypoints:
   - `stealth-lightbeacon --help`
   - `stealth-lightbeacon-mcp` startup handshake.
4. Document optional runtime dependency behavior and expected warnings/fallbacks.

### Commands / Evidence
- Global install smoke tests in disposable environments/containers.
- `stealth-lightbeacon evaluate https://example.com ...` bounded smoke run.

### Exit Criteria
- Global install succeeds on matrix targets.
- Help and basic audit commands execute without setup ambiguity.

### Artifacts
- Install matrix report.
- Troubleshooting runbook section.

---

## Phase 3 — Security and Compliance Gate (P0)

### Objective
Publish only when dependency and code scanning are clean for release scope.

### Tasks
1. Run root and desktop production audits.
2. Verify GitHub alerts are zero for:
   - Dependabot (open)
   - Code scanning (open)
3. Run secret-pattern scanning on repository and generated tarball.
4. Generate SBOM (CycloneDX or SPDX) and store as release artifact.

### Commands / Evidence
- `pnpm audit --prod`
- `pnpm --dir desktop audit --prod`
- GitHub API checks for open alerts
- Secret scan command set + archived output

### Exit Criteria
- No open release-blocking security alerts.
- SBOM attached and reproducible.

### Artifacts
- Security gate report (timestamped)
- SBOM file in release assets

---

## Phase 4 — Quality & Determinism Gate (P0)

### Objective
Guarantee technical quality is reproducible from clean checkout.

### Tasks
1. Enforce `pnpm install --frozen-lockfile` on CI release lane.
2. Require `pnpm run quality:check` pass before release.
3. Require MCP contract lane pass.
4. Keep coverage threshold checks mandatory in release path.

### Commands / Evidence
- `pnpm install --frozen-lockfile`
- `pnpm run quality:check`
- `pnpm run test:mcp:contract`

### Exit Criteria
- All gates green on release commit.
- Re-run reproducibility confirmed.

### Artifacts
- CI run URLs pinned in release notes.

---

## Phase 5 — Release Execution & Rollback Safety (P1)

### Objective
Standardize publish flow and ensure rollback is fast and safe.

### Tasks
1. Use `pnpm run release:dry` as mandatory pre-publish checkpoint.
2. Verify semantic version bump correctness.
3. Verify changelog contents and commit mapping.
4. Prepare rollback playbook:
   - npm deprecate/unpublish policy constraints
   - rapid patch release path
   - git tag rollback strategy

### Commands / Evidence
- `pnpm run release:dry`
- `pnpm run release` (production)

### Exit Criteria
- Dry-run approved.
- Rollback procedure documented and tested (tabletop or simulated).

### Artifacts
- Release execution log.
- Rollback section in `docs/release-process.md`.

---

## Phase 6 — Global UX and Operator Documentation (P1)

### Objective
Deliver a predictable experience for global npm users.

### Tasks
1. Add a dedicated “Global Install” section in README with examples.
2. Add first-run diagnostics and common failures section.
3. Ensure error messages for missing optional capabilities are actionable.
4. Add quickstart command examples for CLI and MCP modes.

### Exit Criteria
- New user can install globally and run first audit in <10 minutes.
- Support burden reduced via self-serve docs.

### Artifacts
- README UX update with tested command snippets.

---

## 4) Governance Gates (Go/No-Go)

## G0: Metadata Gate
- Must pass before any publish dry-run.

## G1: Surface Gate
- Tarball allowlist validated and CI-enforced.

## G2: Security Gate
- No open release-blocking alerts and audits green.

## G3: Quality Gate
- `pnpm run quality:check` green on release commit.

## G4: Execution Gate
- Dry-run approved, rollback playbook ready.

No-Go condition: failure in any G0–G4.

---

## 5) Suggested Execution Order and Timeline

1. Day 1: Phase 0 + Phase 1 (metadata + surface hardening)
2. Day 2: Phase 3 (security/compliance) + Phase 4 (quality determinism)
3. Day 3: Phase 2 + Phase 6 (global UX validation), then Phase 5 dry-run and publish

---

## 6) Ownership Model

| Workstream | Owner | Backup |
|---|---|---|
| Metadata/legal | Maintainer | Release manager |
| Tarball boundary | Build/release owner | Maintainer |
| Security/compliance | Security reviewer | Maintainer |
| Quality gate | QA/CI owner | Maintainer |
| Publish execution | Release manager | Maintainer |
| Docs/global UX | Docs owner | Maintainer |

---

## 7) Open Decisions

1. Should `desktop/` remain fully out-of-scope for root npm publish surface?
2. What minimum Node version policy is acceptable for public users (`>=24` vs wider support)?
3. Is npm provenance/signature attestation required for your org policy?

---

## 8) Immediate Next Actions

1. Update root `package.json` metadata fields for public package publication.
2. Add tarball-boundary CI guard and fail-fast policy.
3. Perform one full release dry-run with evidence capture.
4. Approve go/no-go gates and schedule first public publish window.

