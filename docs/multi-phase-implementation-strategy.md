# Multi-Phase Implementation Strategy: Feature/Capability Parity

## Objective
Close the highest-value feature/capability gaps between `stealth-lightbeacon-node` and `stealth-lightbeacon` while keeping quality gates green (`pnpm run quality:check`).

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
