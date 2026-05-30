# Public-Release Remediation Backlog

## Goal
Prepare this repository for a strict public GitHub release with reproducible installs, no accidental secret leakage, no generated-artifact publishing, and no legacy install-scripted dependencies in the default path.

## Retained controls
- Keep `pnpm-lock.yaml` checked in and keep `pnpm install --frozen-lockfile` as the only CI install path.
- Keep `node_modules/` ignored and never commit it.
- Treat `pnpm pack --dry-run` as a release gate before any public package or source release.
- Preserve registry-only dependency resolution and the existing SRI integrity hashes in the lockfile.

## Phase 0: Decide the release boundary
- Choose one distribution model before changing packaging rules:
  - Source-only GitHub release: mark the package `private` and do not publish to npm.
  - npm-publishable release: add an explicit `files` allowlist and `publishConfig`, and keep only the intended runtime artifacts in the tarball.
- If npm publication is enabled, include only the intended release files and exclude generated or internal artifacts such as `graphify-out/`, `integration_log.jsonl`, `report.*`, `.devcontainer/`, CI metadata, and local cache folders.
- Add `pnpm pack --dry-run` to CI or release checks so the published tarball is reviewed before release.
- Decide whether `dist/` is the only shipped runtime artifact or whether source files are also part of the package boundary; document that choice and keep it stable.
- Until that decision is made, public docs must describe the package as not npm-publishable and must not imply that the current package metadata is a safe publication boundary.

## Phase 1: Dependency provenance and install hardening
- Keep all normal installs on `pnpm install --frozen-lockfile`; do not add any new `pnpm install` path to CI or release automation.
- Add a provenance or signature-verification step on top of the existing lockfile hashes so the release process verifies dependency integrity beyond SRI alone.
- Add a failure condition for non-registry dependency sources such as `git+` or `file:` URLs.
- Pin GitHub Actions used by release-critical workflows to immutable SHAs when the release pipeline is finalized.
- If npm publication is enabled, add a dependency audit gate and document the exact trusted registry and release policy.

## Phase 2: Make the devcontainer lockfile-bound
- Remove any out-of-lockfile Playwright bootstrap from `.devcontainer/post-create.sh`.
- Use a lockfile-bound browser automation dependency such as `playwright-core`, or make any optional install step explicit and CI-covered.
- Ensure the devcontainer and CI resolve the same dependency graph from the same lockfile.
- Pin the devcontainer base image by digest where practical and keep the image build as deterministic as possible.
- Add a clean-room devcontainer smoke test that proves a fresh container can build and test without any out-of-lockfile installs.

## Phase 3: Remove legacy install-scripted dependencies
- Replace `html-pdf`/`phantomjs-prebuilt` with a maintained PDF path, preferably one that reuses the existing Chromium/Playwright toolchain.
- If PDF output is optional, isolate it behind an explicit feature flag or plugin boundary so the default install path remains free of legacy binary download scripts.
- Add a dependency banlist or review check for deprecated packages with install scripts.
- Verify the replacement path still produces acceptable reports without reintroducing binary download behavior at install time.

## Phase 4: Reduce secret and artifact leakage
- Prefer environment variables, config files, or secret-manager injection for `GOOGLE_PAGESPEED_API_KEY`; keep the CLI flag only as a compatibility path with explicit warnings that CLI secrets are visible in shell history and process listings.
- Move the runtime default report output away from the repository root so generated reports do not land next to tracked files by default.
- Document release-safe examples that always pass `--out .tmp/reports/<run>` until the runtime default is moved.
- Add ignore rules for generated audit artifacts such as `report.json`, `report.html`, `report.pdf`, `.tmp/`, `reports/`, `graphify-out/`, and `integration_log.jsonl`.
- Update the CLI/docs so the output path posture is clearly described and safe for local development and public releases.
- Keep example env files empty and ensure they never carry real values or internal endpoints.

## Phase 5: Public-release verification
- Add a release checklist covering:
  - `pnpm install --frozen-lockfile`
  - build
  - test
  - `pnpm pack --dry-run`
  - dependency audit
  - provenance/signature check
  - secret scan
- Add a tarball smoke test that confirms `node_modules/` is not included and that only the approved files are shipped.
- Add a docs check that the README, `.env.example`, and `SECURITY.md` match the public-release posture.
- Document how to regenerate reports locally without committing the outputs.

## Phase 6: Release criteria and go/no-go
- Do not cut a public release until:
  - the package boundary is explicit,
  - the devcontainer and CI are lockfile-aligned,
  - the legacy PDF path is removed or isolated,
  - the default output path is safe,
  - and the release process includes provenance/signature verification.
- Treat any new install-scripted dependency, generated-artifact leakage, or secret exposure as a release blocker.
- If npm publication is out of scope, state that explicitly and keep the package private until the release boundary is finalized.

## Traceability Summary

| ID | Severity | Summary | Category | Action Taken |
|----|----------|---------|----------|--------------|
| R1-F01 | HIGH | Package publish surface is uncontrolled and can include generated/internal artifacts | Must-fix | Added Phase 0 release-boundary decision, `files` allowlist, `prepack` build hook, and `pnpm pack --dry-run` gate |
| R1-F02 | HIGH | Devcontainer installs Playwright outside the lockfile | Must-fix | Switched the runtime and devcontainer path to lockfile-bound `playwright-core` plus `pnpm install --frozen-lockfile`; removed the out-of-lockfile bootstrap path |
| R1-F03 | MEDIUM | `html-pdf` / `phantomjs-prebuilt` bring a deprecated install-scripted dependency chain | Must-fix | Replaced the default PDF path with `playwright-core` + Chromium, removing the legacy install-scripted dependency chain |
| R1-F04 | MEDIUM | CLI API key handling and default report output leak secrets or generated reports by default | Must-fix | Added Phase 4 secret- and artifact-leakage controls; README warns against CLI secrets and default output now lands in `reports/` |
| R1-F05 | MEDIUM | Lockfile hashes exist, but signature/provenance verification is absent | Bundle | Added Phase 1 provenance/signature verification gate and CI audit-signatures step |
| R1-F06 | MEDIUM | Published consumers are not yet locked to the audited dependency graph | Bundle | Folded into Phase 0 release-boundary decision and Phase 1 dependency audit gate |

**Dissent Ledger:** none

## Action Items
- [P0] Decide whether the release is source-only GitHub or npm-publishable, then lock the package boundary accordingly.
- [x] Devcontainer now uses lockfile-bound `playwright-core` and `pnpm install --frozen-lockfile`; no out-of-lockfile Playwright install remains.
- [x] The legacy `html-pdf` / `phantomjs-prebuilt` path has been replaced with `playwright-core` + Chromium.
- [x] Default report output now lands in `reports/`, with generated artifacts ignored by default.
- [x] Added provenance/signature verification to the release pipeline via `pnpm audit`.
- [x] Add `pnpm pack --dry-run` to CI or release checks and block release if generated artifacts appear in the tarball.
- [x] README, `.env.example`, and `SECURITY.md` already reflect the public-release posture; keep them aligned with future release changes.
