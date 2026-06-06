# Multi-Phase Implementation Strategy: Feature/Capability Parity

## Objective
Close the highest-value feature/capability gaps between `stealth-lightbeacon-node` and `stealth-lightbeacon` while keeping quality gates green (`pnpm run quality:check`).

## Roadmap Completion Review (2026-06-06)

### Current Completion Status
- **Phase 0: Partially complete.** Direct validation passes with `tsc`, `node --test`, MCP contract tests, and the CI coverage checker. The official `pnpm run quality:check` path remains blocked by a local wrapper hang tracked in Beads.
- **Round 2 review remediations: Mostly implemented.** Current source includes SSRF socket-pinning agents, BrowserPool teardown, BrowserPool context limits, Obscura `--no-redirect` plus proxy execution, cache `BIGINT` timestamps, cache mutation `exec()` calls, PageSpeed `X-Goog-Api-Key`, and crawler pop mutex coverage. Remaining review-derived gaps are listed below.
- **Phase 1: Not complete.** User-facing CLI parity modes are not yet implemented: `--watch`, `--search-semantic`, `--recon`, `--recon-auto`, and documented `--persist` semantics.
- **Phase 2: Not complete.** The Node service/API surface is not yet present as a production command with health, capabilities, evaluation jobs, artifacts, recon, auth, TLS, and restart recovery.
- **Phase 3: Not complete.** Release docs exist, but finished-product docs must reflect executable CLI/service behavior after Phases 1-2 are implemented.

### Remaining Finished-Product Capabilities
- **Reliable validation runner:** `pnpm run quality:check` must complete non-interactively, not just direct command equivalents.
- **Safe network boundary:** keep SSRF/TLS/browser/proxy remediations covered by regression tests, including browser DNS rebinding and service-worker isolation.
- **CLI parity:** watch mode, semantic search, recon modes, persistence semantics, and HTTP/2 behavior must be real, documented, and tested.
- **Service/API product surface:** local/remote service mode with job lifecycle, durable evaluation state, artifact retrieval, recon endpoint, auth token, TLS configuration, and OpenAPI-style contract tests.
- **Operational persistence:** evaluation runs, artifacts, ontology/search state, and failures must recover across process restarts.
- **Release readiness:** package boundary, docs, pack dry-run, audit/signature checks, generated-artifact hygiene, and public examples must match actual behavior.
- **International performance inputs:** PageSpeed/GEO/AEO date parsing must handle timezone-aware or localized metric inputs.

### Traceability To Beads
- `stealth-lightbeacon-node-0ph.1`: unblock official `pnpm run` quality wrapper.
- `stealth-lightbeacon-node-s2s`: CLI parity epic.
- `stealth-lightbeacon-node-a3w`: service/API surface epic.
- `stealth-lightbeacon-node-dod`: docs and release-readiness epic.

## Baseline Validation (2026-05-30)
- `pnpm run quality:check` fails at typecheck/build with `TS5107` (`moduleResolution=node10` deprecation handling).
- `pnpm test` fails for the same reason because `pretest` runs `pnpm run build`.
- Release docs currently assume the quality gate is runnable; this is temporarily false until TypeScript config is remediated.

## Phase 0: Build/Test Gate Recovery
### Scope
- Fix TypeScript compiler configuration compatibility so build/typecheck/test commands execute.
- Re-run: `pnpm run typecheck`, `pnpm run test:unit:ci`, `pnpm run test:mcp:contract`, `COVERAGE_MODE=ci pnpm run coverage:check`.

### Exit Criteria
- `pnpm run quality:check` succeeds on local workspace.
- No behavior regressions in existing CLI `evaluate` flow.

## Phase 1: CLI Capability Parity
### Scope
- Add missing user-facing modes now present in Python core:
  - `--watch`
  - `--search-semantic`
  - `--recon`, `--recon-auto`
  - `--persist` toggle semantics
- Preserve backward compatibility for existing Node evaluate options.

### Exit Criteria
- New flags documented and covered with contract/unit tests.
- Existing evaluate usage remains unchanged.

## Phase 2: Service/API Surface
### Scope
- Add Node service command equivalent to Python `serve` entrypoint.
- Implement minimum API set:
  - `GET /health`
  - `GET /capabilities`
  - `POST /evaluations`
  - `GET /evaluations/{id}`
  - `GET /evaluations/{id}/result`
  - `GET /evaluations/{id}/artifacts`
  - `POST /recon`
- Add auth token and TLS configuration support.

### Exit Criteria
- Service endpoints pass contract tests.
- Artifacts and evaluation state persist/recover across process restarts.

## Phase 3: Documentation + Release Readiness
### Scope
- Update `readme.md`, `CLI-readme.md`, `docs/release-process.md` with new commands, flags, and operational caveats.
- Add migration notes from Python parity matrix to Node behavior.
- Run full validation matrix and produce release checklist.

### Exit Criteria
- Docs reflect actual executable behavior.
- Quality/test matrix green and reproducible from docs.
