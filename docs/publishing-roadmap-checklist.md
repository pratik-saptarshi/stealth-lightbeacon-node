# Publishing Roadmap Checklist (Release-Day Operator Sheet)

Use this checklist with `docs/publishing-roadmap.md` as the execution control sheet for npm global publish.

## A) Pre-Flight

- [ ] On `main` and synced with `origin/main`
- [ ] Clean working tree (no unintended staged/unstaged files)
- [ ] Node and pnpm versions match repo policy
- [ ] Release window and rollback owner confirmed

## B) G0 Metadata Gate

- [ ] `package.json` has `name`, `version`, `license`, `author`, `repository`, `homepage`, `bugs`
- [ ] License file and security contact references are correct
- [ ] npm package ownership/access validated

## C) G1 Surface Gate (Tarball Boundary)

- [ ] `pnpm pack --dry-run` executed
- [ ] Tarball file list reviewed against allowlist
- [ ] No internal artifacts included (`tests/`, `docs/`, `.tmp/`, local config)
- [ ] Bin entries verified (`dist/cli.js`, `dist/mcp/stdio.js`)
- [ ] Tarball-boundary CI check green

## D) G2 Security Gate

- [ ] `pnpm audit --prod` clean
- [ ] If applicable: `pnpm --dir desktop audit --prod` clean
- [ ] Open GitHub Dependabot alerts reviewed (none release-blocking)
- [ ] Open GitHub Code Scanning alerts reviewed (none release-blocking)
- [ ] Secret scan run on repo + packed tarball output
- [ ] SBOM generated and attached (if policy requires)

## E) G3 Quality Gate

- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm run quality:check`
- [ ] `pnpm run test:mcp:contract`
- [ ] Coverage thresholds pass

## F) G4 Release Execution Gate

- [ ] `pnpm run release:dry` reviewed and approved
- [ ] Version bump type confirmed (patch/minor/major)
- [ ] Changelog reviewed for correctness
- [ ] Rollback plan validated (deprecate/patch/tag strategy)

## G) Publish

- [ ] Publish command executed via approved release flow
- [ ] Git tag and release notes published
- [ ] Registry package page verified

## H) Post-Publish Validation

- [ ] Global install smoke test in clean env: `npm i -g <package>`
- [ ] CLI help smoke test: `stealth-lightbeacon --help`
- [ ] MCP startup smoke test: `stealth-lightbeacon-mcp`
- [ ] Bounded real-world audit smoke test executed
- [ ] Incident channel notified with release summary and artifacts

## I) Rollback Triggers (Immediate No-Go or Post-Publish Rollback)

- [ ] Critical runtime regression
- [ ] Security finding discovered after publish
- [ ] Broken global install path
- [ ] Incorrect package contents shipped

If any trigger is checked, execute rollback runbook before continuing promotion.

