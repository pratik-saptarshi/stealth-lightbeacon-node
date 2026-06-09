# stealth-lightbeacon-node-bmv Completion Execution Plan

## Objective

Complete `stealth-lightbeacon-node-bmv` by turning the remaining parity gaps into
small BDD/TDD implementation slices tracked in Beads. The execution order is:

1. Phase 0: make the official validation lane deterministic.
2. Phase 1: expose missing CLI parity modes.
3. Phase 2: add the service/API product surface.
4. Phase 3: prove docs, release, package, and security gates from executable checks.

The epic is complete only when every child issue is closed, `pnpm run
quality:check` passes non-interactively, release checks are reproducible from
docs, and Beads plus Git are synced.

## Capability Acceptance

Capability: finished Node parity with the core Stealth Lightbeacon product.

BDD:
- Given a clean checkout with dependencies installed, when an agent follows the
  documented CLI, service, validation, and release commands, then every command
  exists, exits deterministically, and produces the documented output shape.
- Given a user evaluates a target from CLI or service mode, when the run
  completes or fails, then artifacts, state, diagnostics, and errors are
  observable through the selected interface without hidden fallback steps.
- Given security-sensitive targets or browser execution, when DNS rebinding,
  private-address routing, service-worker routing, auth, TLS, or path traversal
  risks are exercised, then the product blocks unsafe behavior and records a
  stable error.

TDD:
- Every feature starts with failing behavior or contract tests.
- Implementation is accepted only after focused tests, `tsc`, affected contract
  tests, and `pnpm run quality:check` pass.
- Each feature closes with a conventional commit, Beads update, `bd export -o
  .beads/issues.jsonl`, and remote sync where authorized.

## Beads Execution Map

| Level | Beads ID | Purpose | Completion gate |
| --- | --- | --- | --- |
| Epic | `stealth-lightbeacon-node-bmv` | Overall parity program | All child phases closed |
| Phase 0 | `stealth-lightbeacon-node-0ph` | Restore official build/test/coverage lane | `pnpm run quality:check` green |
| Phase 1 | `stealth-lightbeacon-node-s2s` | CLI parity modes | CLI contract tests green |
| Phase 2 | `stealth-lightbeacon-node-a3w` | Service/API parity | Endpoint contract tests green |
| Phase 3 | `stealth-lightbeacon-node-dod` | Docs/release readiness | Docs, pack, audit, SBOM gates green |

## Phase 0: Validation Lane

### Feature: Non-Interactive Quality Gate

Owner issue: `stealth-lightbeacon-node-0ph.2`

Function-level scope:
- `package.json` scripts: keep `quality:check` shell-safe and non-nested where
  practical.
- `tests/package-scripts.test.js`: prove package scripts are non-interactive and
  do not rely on direct-command fallbacks.
- `.github/workflows/ci.yml`: align runtime matrix with `package.json` engine
  policy.

BDD:
- Given a non-interactive shell, when `pnpm run quality:check` runs, then
  typecheck, CI unit tests, MCP contract tests, and coverage complete with a
  deterministic exit code.
- Given the process fails, when output is inspected, then the failure identifies
  the gate that failed rather than hanging before child processes spawn.

TDD sequence:
1. Extend script tests with a bounded `pnpm run quality:check` smoke.
2. Reproduce failure or prove current green behavior in the same non-interactive
   shell used by agents.
3. Fix package-manager, shell, or script shape only if the smoke fails.
4. Align CI Node version policy with the declared package engine.
5. Validate `pnpm run quality:check` and record coverage metrics in Beads.

Acceptance:
- `pnpm run quality:check` passes non-interactively.
- Coverage thresholds remain at or above current policy.
- CI runtime policy matches package engine policy or the engine policy is
  deliberately lowered and documented.

## Phase 1: CLI Capability Parity

### Feature: Browser Isolation Hardening

Owner issue: `stealth-lightbeacon-node-s2s.5`

Function-level scope:
- `src/core/scraping/browserPool.ts`
- `src/core/scraping/secureProxy.ts`
- `src/core/scraping/zendriver.ts`
- `tests/browser-pool.test.js`
- `tests/ssrf-dns-rebinding.test.js`

BDD:
- Given rendered or stealth mode, when a page attempts service-worker-controlled
  fetches or DNS rebinding, then browser traffic stays pinned through the secure
  proxy and private/loopback destinations are blocked.

TDD:
1. Add behavior tests for private-address rejection through browser proxy paths.
2. Add context-release assertions for success, failure, and signal cleanup.
3. Keep the static `--disable-service-workers` regression, but do not treat it
   as sufficient.

Acceptance:
- Browser isolation is verified behaviorally, not only by launch args.
- Existing proxy and teardown tests pass without loopback leakage.

### Feature: Persist and HTTP/2 CLI Semantics

Owner issue: `stealth-lightbeacon-node-s2s.4`

Function-level scope:
- `src/core/config.ts`
- `src/cli.ts`
- `src/core/ontology.ts`
- `tests/config.test.js`
- `tests/cli-contract.test.js`

BDD:
- Given `--no-persist`, when an audit runs, then no ontology or audit state is
  created.
- Given `--persist`, when an audit runs, then state is durably written under the
  configured data directory.
- Given `--http2`, when HTTP/2 is unsupported, then the CLI fails fast with a
  documented error instead of silently ignoring the flag.

TDD:
1. Add config tests for default persist, explicit persist, no-persist, and http2.
2. Add CLI contract tests for exit codes and stderr/stdout shape.
3. Wire explicit runtime options into `evaluateCommand`.

Acceptance:
- Persistence is user-visible and deterministic.
- `--http2` is either implemented or rejected before network execution.

### Feature: Recon and Recon-Auto CLI Modes

Owner issue: `stealth-lightbeacon-node-s2s.3`

Function-level scope:
- `src/cli.ts`
- `src/core/recon.ts`
- `src/core/orchestrator.ts`
- `tests/recon.test.js`
- `tests/cli-contract.test.js`

BDD:
- Given `recon <url>`, when the command runs, then it emits
  `ReconRecommendation` JSON without writing full audit artifacts.
- Given `evaluate --recon-auto <url>`, when recon recommends an engine or
  throttle, then the audit applies the decision and records it in report metadata.

TDD:
1. Add recon command output tests with mocked fetch responses.
2. Add recon-auto tests proving recommendation application.
3. Add negative tests for invalid targets and SSRF rejection.

Acceptance:
- Recon is standalone.
- Recon-auto decisions are visible and reproducible.

### Feature: Semantic Search CLI

Owner issue: `stealth-lightbeacon-node-s2s.2`

Dependency: `stealth-lightbeacon-node-s2s.4`

Function-level scope:
- `src/cli.ts`
- `src/core/ontology.ts`
- `tests/ontology.test.js`
- `tests/cli-contract.test.js`

BDD:
- Given persisted audit state, when `search-semantic <query>` runs, then ranked
  matches are printed with stable ids, scores, snippets, and source URLs.
- Given no persisted state or no matches, then the CLI returns a stable no-hit
  response without creating new audit state.

TDD:
1. Add mock-backed ontology search tests for hits, no hits, and invalid query.
2. Add CLI subprocess smoke for output contract.
3. Ensure search uses explicit persistence config from `s2s.4`.

Acceptance:
- Search is read-only.
- Empty and error states are deterministic.

### Feature: Watch Mode CLI

Owner issue: `stealth-lightbeacon-node-s2s.1`

Dependency: `stealth-lightbeacon-node-s2s.5`

Function-level scope:
- `src/core/watcher.ts`
- `src/cli.ts`
- `tests/watcher.test.js`
- `tests/cli-contract.test.js`

BDD:
- Given watch mode is started for a target, when a watched source/config file
  changes, then the CLI reruns the audit after debounce and emits the updated
  result.
- Given SIGINT or SIGTERM, then watcher, browser pool, ontology, and cache
  resources close before exit.

TDD:
1. Refactor watcher into an injectable class with start, trigger, and close.
2. Add debounce and shutdown unit tests.
3. Add one subprocess smoke to prove command wiring.

Acceptance:
- Watch mode does not leave open handles.
- Existing evaluate mode remains backward compatible.

## Phase 2: Service/API Surface

### Feature: Service Skeleton and Capabilities

Owner issue: `stealth-lightbeacon-node-a3w.1`

Function-level scope:
- `src/service/server.ts`
- `src/service/config.ts`
- `src/cli.ts`
- `package.json`
- `tests/service-health.test.js`

BDD:
- Given `serve --host 127.0.0.1 --port 0`, when the service starts, then it
  binds non-interactively and returns health and capabilities contracts.

API acceptance:
- `GET /health` returns `{ ok, status, version, uptimeMs, persistence }`.
- `GET /capabilities` returns engines, formats, evaluators, endpoints, and
  security flags.
- All errors use a stable JSON envelope.

TDD:
1. Add failing health/capabilities tests with ephemeral port startup.
2. Implement server lifecycle with injectable clock/version/config.
3. Add package script/bin coverage after command exists.

### Feature: Evaluation Job Lifecycle

Owner issue: `stealth-lightbeacon-node-a3w.2`

Function-level scope:
- `src/service/jobs.ts`
- `src/service/auditRunner.ts`
- `src/service/server.ts`
- `tests/service-evaluations.test.js`

BDD:
- Given `POST /evaluations`, when a valid target/options payload is accepted,
  then the service returns `202` with a durable id and queued status.
- Given polling, then job state transitions through queued/running to succeeded
  or failed with stable timestamps and errors.

API acceptance:
- `POST /evaluations`
- `GET /evaluations/{id}`
- `GET /evaluations/{id}/result`
- Invalid input returns `400`; unknown ids return `404`; unfinished result
  requests return `409`.

TDD:
1. Build tests around an injectable audit runner.
2. Add concurrent job isolation tests.
3. Add durable state tests before wiring real audit execution.

### Feature: Artifacts and Recon Endpoints

Owner issue: `stealth-lightbeacon-node-a3w.3`

Function-level scope:
- `src/service/artifacts.ts`
- `src/service/server.ts`
- `src/core/recon.ts`
- `tests/service-artifacts-recon.test.js`

BDD:
- Given a completed evaluation, when artifacts are requested, then the service
  returns a manifest and retrieves only files under the configured output root.
- Given `POST /recon`, then recon returns without creating evaluation side
  effects.

API acceptance:
- `GET /evaluations/{id}/artifacts`
- `GET /evaluations/{id}/artifacts/{name}`
- `POST /recon`
- Path traversal is rejected.

TDD:
1. Add manifest and file retrieval tests.
2. Add traversal and missing artifact tests.
3. Add recon validation and isolation tests.

### Feature: Auth, TLS, and Restart Recovery

Owner issue: `stealth-lightbeacon-node-a3w.4`

Function-level scope:
- `src/service/config.ts`
- `src/service/server.ts`
- `src/service/jobs.ts`
- `tests/service-security-recovery.test.js`

BDD:
- Given auth token mode, when requests omit or send the wrong bearer token, then
  protected endpoints return `401`.
- Given TLS key/cert config, when the service starts, then it exposes HTTPS or
  fails fast on invalid config.
- Given a restart, then terminal job state and artifacts reload; corrupted state
  produces degraded health and bounded recovery errors.

TDD:
1. Add auth tests before middleware.
2. Add TLS config tests with temporary cert fixtures or mocked `https`.
3. Add restart and corrupted-state tests.

Acceptance:
- Auth/TLS are opt-in and deterministic.
- Restart recovery is observable and bounded.

## Phase 3: Docs and Release Readiness

### Feature: Docs Command Smoke Tests

Owner issue: new child under `stealth-lightbeacon-node-dod`

Function-level scope:
- `tests/docs-command-smoke.test.js`
- `readme.md`
- `CLI-readme.md`
- `docs/release-process.md`

BDD:
- Given documented commands, when smoke tests parse and execute supported
  examples in test mode, then commands exist and output claims match behavior.

TDD:
1. Add smoke harness for documented CLI/service examples.
2. Mark destructive or networked commands as explicit manual gates.
3. Update docs only after executable behavior lands.

Acceptance:
- Docs describe only implemented behavior.
- Every supported example has a smoke test or a justified manual gate.

### Feature: Tarball Boundary and BOM Evidence

Owner issue: new child under `stealth-lightbeacon-node-dod`

Function-level scope:
- `tools/check-package-boundary.js`
- `tests/package-boundary.test.js`
- `docs/bill-of-materials.html.md`
- `package.json`

BDD:
- Given `pnpm pack --dry-run`, when package contents are inspected, then only
  approved runtime files, bins, docs, and security files are included.

TDD:
1. Add package-boundary test against `package.json.files` and dry-run output.
2. Block tests, local configs, temp dirs, and build cache artifacts.
3. Update BOM with generated evidence.

Acceptance:
- Tarball contents are deterministic and documented.
- BOM matches actual package boundary.

### Feature: Release Security and Compliance Gate

Owner issue: new child under `stealth-lightbeacon-node-dod`

Function-level scope:
- `tools/release.sh`
- new release validation helper as needed
- `docs/release-process.md`
- `docs/publishing-roadmap-checklist.md`

BDD:
- Given release validation, when audit, secret scan, SBOM, pack dry-run, and
  artifact hygiene checks run, then release-blocking issues fail the gate with
  actionable output.

TDD:
1. Add tests for the release validation helper without network dependency.
2. Add command documentation only for checks that are executable locally.
3. Keep networked audit steps as explicit operator gates when sandboxed.

Acceptance:
- Release checklist maps each gate to a command, artifact, or manual decision.
- Security/compliance evidence is reproducible.

### Feature: CI Runtime Policy Alignment

Owner issue: new child under `stealth-lightbeacon-node-0ph` or
`stealth-lightbeacon-node-dod`

Function-level scope:
- `.github/workflows/ci.yml`
- `package.json`
- `tests/package-scripts.test.js`

BDD:
- Given CI runs, when Node is selected, then the matrix satisfies the package
  engine policy.

TDD:
1. Add a workflow/package consistency test.
2. Either move CI to Node 24+ or lower `engines.node` with an explicit support
   decision.

Acceptance:
- CI does not test unsupported Node versions as the primary release lane.

## Traceability Summary

| ID | Severity | Summary | Category | Action Taken |
| --- | --- | --- | --- | --- |
| BMV-F01 | HIGH | Phase 0 quality lane still owns release blocking validation | Must-fix | Added concrete TDD gate and CI policy dependency |
| BMV-F02 | HIGH | CLI parity issues need function-level execution slices | Bundle | Added CLI feature/function map and dependency order |
| BMV-F03 | HIGH | Service/API phase needs endpoint contract and file map | Bundle | Added endpoint contract and test plan |
| BMV-F04 | MEDIUM | Docs/release phase lacks automated package/security evidence | Must-fix | Added release child issue plan |

Total findings: 4 | Must-fix: 2 | Bundle: 2 | Defer: 0 | Info: 0

Final Recommendation: Applied with caveats.

Dissent Ledger: none.

## Post-Overseer Remediation Roadmap

Review source: `$overseer` panel on `main` after parity closeout, integrated by
`$plan-review-integrator`.

Parent epic: `stealth-lightbeacon-node-43w` — Overseer remediation: service
security and release governance hardening.

### Capability Map

| Capability | Epic / Feature | Beads | Functions / surfaces |
| --- | --- | --- | --- |
| Service hardening | Public service and artifact safety | `43w.1` | `serveCommand`, `startService`, `readJsonBody`, `ArtifactStore.open`, `defaultReconRunner` |
| Evaluation service runtime | Runtime service contracts | `43w.2` | `defaultAuditRunner`, `EvaluationJobStore.run`, `StartedService.close`, route handlers |
| Release governance | Publish gate enforcement | `43w.3` | `parsePackDryRunFiles`, `validatePackageBoundary`, `validateReleaseSecurityGate`, `tools/release.sh`, CI |

### Finding Integration Summary

| Finding | Severity | Category | Beads | Acceptance gate |
| --- | --- | --- | --- | --- |
| Public `serve --host 0.0.0.0` can expose unauthenticated cleartext service and request-controlled private recon | P1 | Must-fix | `43w.1.1` | Non-loopback binds require auth/TLS or explicit unsafe opt-in; private recon is service-config gated |
| JSON bodies are unbounded | P2 | Bundle | `43w.1.2` | Oversized `/evaluations` and `/recon` requests return bounded `413` responses |
| Direct artifact download bypasses terminal job status | P2 | Must-fix | `43w.1.3` | Direct artifact download returns `409` unless job status is `succeeded` |
| Artifact reads follow symlinks outside artifact root | P2 | Must-fix | `43w.1.4` | Symlink escapes are rejected with `lstat`/`realpath` tests |
| Public health leaks recovery details | P3 | Defer | `43w.1.5` | Public health redacts raw recovery errors; authenticated diagnostics stay available |
| `/evaluations` is advertised but default `serve` runner is not implemented | P1 | Must-fix | `43w.2.1` | Default service wires real runner or returns explicit `501` and accurate capabilities |
| Route-level async exceptions can escape JSON contract | P1 | Must-fix | `43w.2.2` | Shared route error boundary returns stable envelopes and no unhandled rejections |
| Service close does not drain/cancel active jobs | P2 | Bundle | `43w.2.3` | Active job drain/cancel/recovery semantics are tested |
| `pnpm pack --dry-run` parser can ignore actual pnpm output | P1 | Must-fix | `43w.3.1` | Parser handles pnpm path-only output and fails closed on empty parse |
| CI package-boundary step does not run verifier | P1 | Must-fix | `43w.3.2` | CI validates actual pack output with `tools/check-package-boundary.js` |
| Release security gate validates text, not completed evidence | P1 | Must-fix | `43w.3.3` | Gate verifies checked items and non-empty evidence files |
| AUTO release gates are not enforced in CI | P1 | Must-fix | `43w.3.4` | CI runs gates or docs relabel them manual/local-only with rationale |
| Release script validation checks names, not semantics | P3 | Bundle | `43w.3.5` | Script command semantics are validated by tests |
| Package-boundary policy is hard-coded | P3 | Defer | `43w.3.6` | Policy becomes data-driven or manifest-derived |

Final recommendation: Human review not required for triage. Proceed with P1
items first, then P2 hardening, then P3 maintainability work.

## Execution Rules

- Start each slice with `bd update <id> --claim`.
- Prefer one feature branch commit per Beads child.
- Use direct tests while red/green cycling; run `pnpm run quality:check` before
  closing a phase.
- After any Beads changes, run `bd export -o .beads/issues.jsonl`.
- Do not close parent phases until every child is closed and the phase gate is
  recorded in the parent close reason.

## Second Post-Overseer Follow-Up Roadmap

Review src: `$overseer` panel on `main` at `7f10e8c` after the first
remediation merge, integrated by `$plan-review-integrator`.

Parent epic: `stealth-lightbeacon-node-2go` — Post-overseer follow-up: network
safety and publish governance hardening.

| Capability | Epic / Feature | Beads | Functions / surfaces |
| Service hardening | Network, artifact, and lifecycle contracts | `2go.1` | `SSRFGuard.validate`, `isPrivateIpv4`, `isPrivateAddress`, `startService`, `ArtifactStore.open`, `AuditRunner`, `EvaluationJobStore.close`, `engineSchema`, `reportFormatSchema` |
| Release governance | Evidence and release path governance | `2go.2` | `validateReleaseSecurityGate`, `.github/workflows/ci.yml`, `tools/release.sh`, `.gitlab-ci.yml`, `bitbucket-pipelines.yml` |
| Metadata/docs consistency | Package metadata and publish docs | `2go.3` | `main`, `package.json`, `docs/bill-of-materials.html.md` |

### Second Finding Integration Summary

| Finding | Severity | Category | Beads | Acceptance gate |
| Malformed artifact URL encoding can escape artifact-path validation and return `500` | P2 | Must-fix | `2go.1.1` | Malformed percent-encoded artifact names return `400 invalid_artifact_path` without decoder details |
| SSRF guard permits some non-global IP ranges | P2 | Must-fix | `2go.1.2` | Literal IP and DNS-result validation block all non-global IPv4/IPv6 ranges unless `allowPrivate` is enabled |
| Service close marks active jobs failed but does not cancel or drain runners | P2 | Bundle | `2go.1.3` | `AuditRunner` receives cancellation; store aborts/drains active work with bounded semantics |
| `/capabilities` duplicates engine/format literals from runtime schemas | P3 | Bundle | `2go.1.4` | Capabilities derive engines/formats from a shared runtime contract or exported schemas |
| CI writes dependency-list JSON to a CycloneDX-named SBOM evidence file | P2 | Must-fix | `2go.2.1` | CI generates valid CycloneDX/SPDX evidence or relabels docs/artifacts as dependency inventory; checker validates schema |
| Production release wrapper does not enforce release security evidence gate | P3 | Bundle | `2go.2.2` | `tools/release.sh` runs `release:security:check` or verifies a checked evidence bundle before `release-it` |
| Non-GitHub CI configs are stale against Node 24 and pnpm policy | P3 | Defer | `2go.2.3` | Alternate CI configs are aligned with GitHub Actions or removed/documented inactive |
| CLI `--version` reports stale hard-coded package version | P3 | Must-fix | `2go.3.1` | CLI version output matches `package.json` with a drift regression test |
| BOM still describes an npm-blocking `preinstall` hook | P3 | Must-fix | `2go.3.2` | BOM accurately states pnpm is pinned for repo work and no `preinstall` blocks npm global install |

Disposition notes:
- The panel claim that per-commit CI must run `release:security:check` is not
  accepted as stated. The checklist intentionally labels it `MANUAL` because it
  requires completed release evidence and human release decisions. The accepted
  remediation is narrower: enforce that gate in the production release wrapper.
- Prior remediations for public bind auth/TLS, private recon gating, bounded
  JSON payloads, artifact symlink escapes, direct artifact status gates,
  route-level async envelopes, package-boundary policy externalization, and
  evidence-file existence checks remain accepted and closed under `43w`.

Final recommendation: Applied with caveats. Proceed with P2 follow-ups first:
`2go.1.1`, `2go.1.2`, `2go.1.3`, and `2go.2.1`. Then complete P3
metadata/docs/CI maintainability tasks.
