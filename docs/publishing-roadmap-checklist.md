# Publishing Readiness Checklist

Use this as the go/no-go gate for pushing a release candidate, tagging, publishing to npm, and monitoring GitHub Actions.

## Gate Status Legend

- `AUTO`: enforced by local tests or GitHub Actions.
- `MANUAL`: must be reviewed by the release owner before publish.
- `EVIDENCE`: capture command output, URLs, or artifact names in release notes.

Any unchecked P0 item is a no-go.

---

## A) Branch and Remote Gate

- [ ] `MANUAL` On `main` or an approved `feature/*` release branch.
- [ ] `AUTO` `git status --short --branch` reviewed; only intentional generated artifacts may be dirty.
- [ ] `MANUAL` Beads issue for the release/publish slice is claimed and updated.
- [ ] `MANUAL` Conventional commits exist for each logical change.
- [ ] `MANUAL` Release branch pushed to `origin`.
- [ ] `MANUAL` Final checkpoint merged to `main`.
- [ ] `MANUAL` `main` pushed to `origin`.

## B) Package Metadata Gate

- [ ] `AUTO` `package.json` has non-empty `author`.
- [ ] `AUTO` `repository.type` is `git`.
- [ ] `AUTO` `repository.url` points to the GitHub origin.
- [ ] `AUTO` `homepage` points to the repository README.
- [ ] `AUTO` `bugs.url` points to GitHub issues.
- [ ] `AUTO` `license` is `MIT` and `LICENSE` is present.
- [ ] `AUTO` `publishConfig.access` is `public`.
- [ ] `AUTO` Package scripts do not include an npm-blocking `preinstall` hook.

## C) Tarball Boundary Gate

- [ ] `AUTO` `files` allowlist is limited to `dist/**/*.js`, README files, `LICENSE`, `SECURITY.md`, and `.env.example`.
- [ ] `AUTO` `pnpm pack --dry-run` runs in CI.
- [ ] `MANUAL` Dry-run file list reviewed for accidental `dist/.tsbuildinfo`, `src/`, `tests/`, `docs/`, `.github/`, `.beads/`, caches, stores, or generated reports.
- [ ] `AUTO` `dist/cli.js` help smoke runs in CI.
- [ ] `AUTO` `dist/mcp/stdio.js` exists in CI.
- [ ] `EVIDENCE` Dry-run output archived or linked from release notes.

## D) Security, Privacy, and Secrets Gate

- [ ] `AUTO` `pnpm audit --prod` passes locally and in CI.
- [ ] `MANUAL` GitHub Dependabot alerts reviewed; no open release-blocking alerts.
- [ ] `MANUAL` GitHub CodeQL/code-scanning alerts reviewed; no open release-blocking findings.
- [ ] `MANUAL` GitHub secret-scanning alerts reviewed; no open unresolved secret exposure.
- [ ] `MANUAL` Secret scan covers repository and packed tarball output before publish.
- [ ] `MANUAL` `.env.example` contains placeholders only.
- [ ] `MANUAL` Release evidence redacts API keys, cookies, auth headers, private hostnames, customer data, and proprietary page contents.
- [ ] `MANUAL` SBOM generated and attached if required by org policy.

## E) README and Support Documentation Gate

- [ ] `AUTO` README documents current npm-publishable posture.
- [ ] `MANUAL` README includes install/build commands, CLI usage, secret handling, generated artifact rules, and CI test modes.
- [ ] `MANUAL` README documents Node `>=24.0.0`, native dependency caveats, and optional rendered/browser behavior.
- [ ] `MANUAL` `SECURITY.md` explains private vulnerability reporting and secret-handling expectations.
- [ ] `MANUAL` BOM in `docs/bill-of-materials.html.md` matches current package metadata and publish boundary.

## F) Quality Gate

- [ ] `AUTO` `pnpm install --frozen-lockfile`.
- [ ] `AUTO` `pnpm run build`.
- [ ] `AUTO` `pnpm run quality:check`.
- [ ] `AUTO` `pnpm run test:mcp:contract`.
- [ ] `AUTO` Coverage thresholds pass.
- [ ] `EVIDENCE` Local gate output and CI run URL captured.

## G) Release Dry-Run Gate

- [ ] `AUTO` `pnpm run release:dry` runs successfully before publish.
- [ ] `MANUAL` Version bump type is correct.
- [ ] `MANUAL` Changelog entries map to conventional commits.
- [ ] `MANUAL` Rollback plan is ready: patch-forward, deprecate, or tag rollback.

## H) GitHub Actions Monitoring Gate

- [ ] `MANUAL` Push to release branch or `main` triggers CI.
- [ ] `MANUAL` GitHub Actions CI run reaches success.
- [ ] `MANUAL` Scheduled/manual audit workflow uses Node 24 and current `evaluate` CLI syntax.
- [ ] `MANUAL` Any CodeQL pending state is monitored until resolved or accepted by a documented risk owner.

## I) Publish Gate

- [ ] `MANUAL` npm auth, package ownership, and 2FA/provenance requirements confirmed.
- [ ] `MANUAL` Publish command executed only after A-H are green.
- [ ] `MANUAL` npm package page verified after publish.
- [ ] `MANUAL` Git tag and GitHub release notes verified.

## J) Post-Publish Smoke Gate

- [ ] `MANUAL` Clean-environment global install smoke: `npm i -g stealth-lightbeacon-node`.
- [ ] `MANUAL` CLI smoke: `stealth-lightbeacon --help`.
- [ ] `MANUAL` MCP smoke: `stealth-lightbeacon-mcp`.
- [ ] `MANUAL` Bounded audit smoke against a safe target.
- [ ] `MANUAL` Incident/ops channel receives release summary, CI URL, package URL, and rollback notes.

## Immediate No-Go Triggers

- [ ] Any release-blocking security alert.
- [ ] Any confirmed secret exposure without rotation.
- [ ] Failed `pnpm run quality:check`.
- [ ] Failed `pnpm audit --prod`.
- [ ] Tarball includes unintended source, tests, docs, local config, cache, or generated report artifacts.
- [ ] npm global install path is blocked.
- [ ] GitHub Actions CI fails on the release commit.
