# Feature-Gap Implementation Plan

## Scope
Compare `stealth-lightbeacon-node` against `stealth-lightbeacon` and close the user-facing feature gaps that are still meaningful after the Rust MCP / ontology migration.

## Baseline

Already at parity or intentionally superseded in `stealth-lightbeacon-node`:

- HTTP, rendered, fast-path, and stealth scraping engines.
- SSRF guard and pinned-request handling.
- JSON, HTML, and PDF report outputs.
- PageSpeed enrichment inside the audit pipeline.
- MCP-backed ontology and database tooling.
- Release-safe output paths and artifact hygiene controls.

Do not spend implementation time re-creating features that are already present unless the node version needs a stronger contract or test boundary.

## Gaps To Close

| Gap ID | Python-repo feature | Node-repo status | Plan action |
|---|---|---|---|
| G1 | Async plugin framework with independently composed evaluators | Evaluators exist, but there is no explicit plugin registry / lifecycle contract | Introduce a first-class evaluator plugin registry with metadata, registration, and deterministic load order |
| G2 | PageSpeed cache with explicit contention-safe SQLite/WAL semantics | Node has a DuckDB-backed cache, but the cache contract is not documented as a concurrency boundary | Formalize the PageSpeed cache adapter, add write-contention handling, and document cache guarantees and failure modes |
| G3 | `StealthMcpLayer` client wrapper for autonomous agent orchestration | Node exposes MCP server tooling, but not a dedicated client wrapper for agent-side tool sessions | Add a reusable MCP client layer for browser/tool sessions and wire it into the scraping/fetching factory |
| G4 | Strict coverage posture and lint gate (`>=90%` branch coverage in Python repo) | Node has tests and coverage scripts, but no explicit parity target in the repo contract | Set explicit coverage thresholds and add the missing lint / quality gates in CI and local docs |

## Implementation Plan

### Phase 1: Make evaluator composition explicit

- Define a lightweight plugin contract for evaluators.
- Add registration metadata for each evaluator: id, domain, description, and prerequisites.
- Replace ad hoc evaluator array assembly with a registry-backed loader.
- Keep current evaluator behavior unchanged while the registry is introduced.

Acceptance criteria:
- Evaluators can be registered and enumerated without touching the orchestrator.
- Audit runs still produce the same report output for existing domains.

### Phase 2: Harden PageSpeed caching

- Move PageSpeed cache behavior behind a dedicated adapter boundary.
- Document the cache key, TTL, and eviction assumptions.
- Add contention-aware write handling and tests for cache reuse / stale entry rejection.
- Preserve the existing DuckDB-backed implementation unless a stronger persistence choice is required later.

Acceptance criteria:
- Cache hits are deterministic across repeated runs.
- Cache writes do not regress audit throughput under concurrent audit loads.
- Tests cover cache hit, stale entry, and write-failure paths.

### Phase 3: Add a reusable MCP client layer

- Add a client wrapper that encapsulates MCP session lifecycle, request correlation, and shutdown.
- Use that wrapper for browser/tool orchestration instead of embedding process plumbing in feature code.
- Keep the current server-side MCP surface intact.

Acceptance criteria:
- Tool-session setup and teardown are reusable from more than one call site.
- Browser/fetch flows can opt into MCP-backed execution without duplicating session code.

### Phase 4: Raise the quality bar to a documented target

- Declare the coverage threshold in the repo docs and CI gates.
- Add any missing lint / format checks to the standard test command set.
- Make the minimum supported verification sequence explicit for local development and release work.

Acceptance criteria:
- Coverage target is visible in the repo docs and enforced in automation.
- Quality checks run from documented commands without tribal knowledge.

### Phase 5: Verify feature parity and regressions

- Add regression tests for the registry, cache adapter, MCP client wrapper, and coverage gate behavior.
- Re-run the full test suite after each phase.
- Confirm that existing release-safe defaults remain unchanged.

Acceptance criteria:
- New tests pass.
- Existing tests continue to pass.
- No release artifact or secret-hygiene regressions are introduced.

## Traceability Summary

| Gap ID | Disposition | Plan section | Why |
|---|---|---|---|
| G1 | Must-fix | Phase 1 | The node repo already has evaluator functionality, but the Python repo’s plugin model exposes a clearer extension boundary that is missing here |
| G2 | Must-fix | Phase 2 | PageSpeed is a core enrichment path; the cache contract needs to be explicit and testable |
| G3 | Must-fix | Phase 3 | Autonomous MCP orchestration is a distinct capability in the Python repo and still needs a reusable client boundary here |
| G4 | Bundle | Phase 4 | The node repo already has quality scripts; this is a contract-strengthening gap, not a product blocker |

## Notes

- The node repo is ahead in Rust-native MCP and ontology ownership; that work is already the preferred path and is not a gap.
- This plan intentionally avoids changing the public release boundary work in `docs/phase-wise-backlog.md`.
- If future comparison work shows additional Python-only behaviors that are not covered here, add them as new gap IDs rather than expanding unrelated phases.
