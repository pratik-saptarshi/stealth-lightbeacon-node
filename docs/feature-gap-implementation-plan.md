# Stealth Lightbeacon Node: Comprehensive Product Roadmap & Implementation Plan

This implementation plan details the product roadmap designed to close features and high-severity architectural gaps in `stealth-lightbeacon-node`. It incorporates all findings from the Round 2 **Overseer Adversarial Review Panel** (including Supreme Judge verdicts) to bring the codebase to full production readiness.

---

## 🏛️ BEADS Framework Reference
- **`B` (Blocker)**: The underlying technical barrier or gap in the codebase.
- **`E` (Evidence)**: Empirical code paths, references, or runtime behaviors confirming the gap.
- **`S` (Success)**: Concrete success criteria, validation assertions, and test gates.

---

## 🗂️ Category 1: Core Engine Architecture & Plugin Contracts

### 🚀 Epic 1.1: Evaluator Plugin Registry (Gap G1)
*Goal: Move from ad hoc arrays to an extensible, structured plugin lifecycle model.*

#### 🧩 Feature 1.1.1: Dynamic Evaluator Registry & Lifecycle Boundary
- **User Story 1.1.1.1**: As a developer, I want to register and dynamically load custom diagnostic evaluators without altering core orchestrator code.
  - **Tasks**:
    - [ ] Create `Evaluator` TS interface in [src/core/types.ts](file:///Users/neo/projects/stealth-lightbeacon-node/src/core/types.ts) with dynamic fields (`id`, `description`, `run()`, `prerequisites`).
    - [ ] Implement `EvaluatorRegistry` class in [src/core/evaluatorRegistry.ts](file:///Users/neo/projects/stealth-lightbeacon-node/src/core/evaluatorRegistry.ts) with `register()`, `get()`, and `list()` functions.
    - [ ] Refactor [src/core/orchestrator.ts](file:///Users/neo/projects/stealth-lightbeacon-node/src/core/orchestrator.ts) to resolve active evaluators dynamically from the registry instead of importing [src/core/defaultEvaluators.ts](file:///Users/neo/projects/stealth-lightbeacon-node/src/core/defaultEvaluators.ts).
  - **BEADS Tracking**:
    - **`B`**: Ad hoc imports in `defaultEvaluators.ts` block dynamic loading of third-party security or performance plugins.
    - **`E`**: [src/core/defaultEvaluators.ts](file:///Users/neo/projects/stealth-lightbeacon-node/src/core/defaultEvaluators.ts) hardcodes static lists of standard evaluators.
    - **`S`**: Registry dynamic lookup behaves identically; standard unit tests pass and new custom evaluators load without modifying core files.

---

### 🚀 Epic 1.2: Agent-side MCP Client Wrapper (Gap G3)
*Goal: Provide robust, client-side session management for autonomous agent browser tool integrations.*

#### 🧩 Feature 1.2.1: Reusable Autonomous MCP Client Layer
- **User Story 1.2.1.1**: As an autonomous agent consumer, I want browser/tool interactions wrapped in a deterministic, client-side MCP lifecycle boundary to prevent resource leaks.
  - **Tasks**:
    - [ ] Implement `StealthMcpClient` class in [src/mcp/client.ts](file:///Users/neo/projects/stealth-lightbeacon-node/src/mcp/client.ts) to manage process start, IO stream draining, and robust cleanup.
    - [ ] Add bounded handshake timeout (`SLB_MCP_HANDSHAKE_TIMEOUT`) and process shutdown controls to `StealthMcpClient`.
    - [ ] Refactor the scraping fetcher in [src/core/scraping/](file:///Users/neo/projects/stealth-lightbeacon-node/src/core/scraping/) to delegate to `StealthMcpClient` for agent tool sessions.
  - **BEADS Tracking**:
    - **`B`**: Lacks unified client wrapping; subprocess execution and stream parsing code are duplicated.
    - **`E`**: No client counterpart exists for [src/mcp/server.ts](file:///Users/neo/projects/stealth-lightbeacon-node/src/mcp/server.ts).
    - **`S`**: Tool-session teardown is fully automated; no orphaned browser processes remain under concurrent loads.

---

## 🗂️ Category 2: Security & SSRF Governance

### 🚀 Epic 2.1: SSRF Guard & TLS Verification (Gap G5 / R2-F01)
*Goal: Redesign SSRF DNS pinning to support secure HTTPS targets without certificate validation failure.*

#### 🧩 Feature 2.1.1: Custom Agent-Level Socket Pinning
- **User Story 2.1.1.1**: As a security-sensitive auditor, I want outbound HTTPS fetch requests pinned at the socket level to validated IPs while retaining correct host headers and SNI configurations to prevent TLS mismatches.
  - **Tasks**:
    - [ ] Implement a custom `SSRFGuardAgent` inheriting from Node's `http.Agent` and `https.Agent` in [src/core/ssrf.ts](file:///Users/neo/projects/stealth-lightbeacon-node/src/core/ssrf.ts).
    - [ ] Override `createConnection` to resolve the DNS hostname, validate the resolved IP against the SSRF blocklist, and open a direct connection to that IP while keeping the standard host header and TLS server name verification intact.
    - [ ] Refactor [src/core/fetcher.ts](file:///Users/neo/projects/stealth-lightbeacon-node/src/core/fetcher.ts#L37-L43) to use the new custom socket-pinning Agent instead of rewriting URL host strings.
  - **BEADS Tracking**:
    - **`B`**: Rewriting hostnames to IP addresses before request dispatch destroys TLS server name identification (SNI), causing all HTTPS audits to fail certificate validation.
    - **`E`**: [src/core/fetcher.ts:37-43](file:///Users/neo/projects/stealth-lightbeacon-node/src/core/fetcher.ts#L37-L43) replaces hostnames in target URLs with resolved IP addresses.
    - **`S`**: Audits targeting secure HTTPS targets succeed without certificate mismatch warnings, while DNS-rebinding or loopback targets are safely blocked at socket creation time.

---

### 🚀 Epic 2.2: Playwright DNS Rebinding Resistance (Gap G6 / R2-F02)
*Goal: Eliminate browser-level DNS rebinding bypasses.*

#### 🧩 Feature 2.2.1: Browser-Level DNS Resolution Pinning
- **User Story 2.2.1.1**: As an auditor running rendered JavaScript audits, I want Playwright's underlying Chromium instances bound to pinned DNS resolutions to prevent rebinding attacks.
  - **Tasks**:
    - [ ] Configure Playwright Chromium instances in [src/core/scraping/zendriver.ts](file:///Users/neo/projects/stealth-lightbeacon-node/src/core/scraping/zendriver.ts) to route traffic through a secure local forward proxy or customize routing interceptors.
    - [ ] Implement single-resolution host pinning at the proxy layer or within Playwright's `network` routing configuration.
  - **BEADS Tracking**:
    - **`B`**: Playwright/Chromium resolves target hosts independently, allowing DNS-rebinding attacks to bypass Node-level `ctx.route()` checks.
    - **`E`**: [src/core/scraping/zendriver.ts:41-48](file:///Users/neo/projects/stealth-lightbeacon-node/src/core/scraping/zendriver.ts#L41-L48) only checks host strings inside route handlers without enforcing connection-level pinning.
    - **`S`**: Rebinding attacks (where host resolves to safe IP on first check and private IP on fetch) are reliably blocked by the pinned browser proxy.

---

### 🚀 Epic 2.3: Subprocess Redirect Validation (Gap G7 / R2-F03)
*Goal: Enforce SSRF validations on HTTP redirects followed by external subprocess engines.*

#### 🧩 Feature 2.3.1: Obscura Subprocess Redirect Governance
- **User Story 2.3.1.1**: As an auditor running fast-path compiled audits, I want all redirect targets validated before execution so that external binaries cannot bypass the SSRF guard by following internal redirects.
  - **Tasks**:
    - [ ] Pass the `--no-redirect` flag to the `bin/obscura` compiled Rust process spawned in [src/core/scraping/fetcher.ts](file:///Users/neo/projects/stealth-lightbeacon-node/src/core/scraping/fetcher.ts).
    - [ ] Execute all redirect tracking and validation inside the Node engine, passing only verified final destination URLs to the subprocess.
  - **BEADS Tracking**:
    - **`B`**: The compiled `bin/obscura` subprocess follows HTTP redirects natively, allowing malicious targets to redirect execution to banned loopback/private ranges.
    - **`E`**: [src/core/scraping/fetcher.ts](file:///Users/neo/projects/stealth-lightbeacon-node/src/core/scraping/fetcher.ts) passes target URLs straight to the subprocess without disabling internal redirect handling.
    - **`S`**: A redirect pointing to `http://127.0.0.1:8080` is detected at the Node layer and blocked before reaching the subprocess.

---

## 🗂️ Category 3: Concurrency & Storage Reliability

### 🚀 Epic 3.1: Crawler Queue POP Concurrency (Gap G8 / R2-F04)
*Goal: Prevent concurrent workers from crawling identical pages due to DuckDB queue POP race conditions.*

#### 🧩 Feature 3.1.1: Atomic Database URL Retrieval
- **User Story 3.1.1.1**: As a crawler node running multiple worker threads, I want URL pops from the crawl queue database to be atomic to eliminate duplicate crawls and resource waste.
  - **Tasks**:
    - [ ] Implement an in-memory orchestration lock or transaction write-retry loop using DuckDB in [src/core/crawler.ts](file:///Users/neo/projects/stealth-lightbeacon-node/src/core/crawler.ts).
    - [ ] Rewrite the retrieve query to ensure exclusive row assignment to workers.
  - **BEADS Tracking**:
    - **`B`**: DuckDB lacks row-level locking or `SKIP LOCKED`, causing parallel workers to pull the same URL in concurrent query phases.
    - **`E`**: [src/core/crawler.ts:107-126](file:///Users/neo/projects/stealth-lightbeacon-node/src/core/crawler.ts#L107-L126) pops rows in separate read/update sequences.
    - **`S`**: Crawling 100 mock URLs using 10 concurrent workers produces exactly 1 fetch per URL with zero duplicate operations.

---

### 🚀 Epic 3.2: Cache Write-Contention Handling (Gap G2)
*Goal: Prevent PageSpeed cache write failures under high load.*

#### 🧩 Feature 3.2.1: Contention-Safe PageSpeed Caching
- **User Story 3.2.1.1**: As an analytical crawler, I want PageSpeed cache writes protected by transactions and retry-backoffs to prevent DuckDB lock contention from crashing the process.
  - **Tasks**:
    - [ ] Implement robust transactional block handling and retry-on-contention loops inside [src/core/pagespeedCache.ts](file:///Users/neo/projects/stealth-lightbeacon-node/src/core/pagespeedCache.ts).
    - [ ] Add stale-entry rejection and cache hit logging.
  - **BEADS Tracking**:
    - **`B`**: High-concurrency audits attempting to write metrics simultaneously to the DuckDB cache can encounter write-lock failures.
    - **`E`**: [src/core/cache.ts](file:///Users/neo/projects/stealth-lightbeacon-node/src/core/cache.ts) has no exponential backoff or lock-contention handler.
    - **`S`**: 50 concurrent audits write successfully to the database cache under stress testing with zero transaction aborts.

---

## 🗂️ Category 4: Process Lifecycle & Quality Engineering

### 🚀 Epic 4.1: CLI Process Hanging (Gap G9 / R2-F05)
*Goal: Ensure clean teardown of Playwright browser processes on audit completion or failure.*

#### 🧩 Feature 4.1.1: Browser Pool Teardown Hook
- **User Story 4.1.1.1**: As a CLI user, I want the audit tool to close all Playwright child processes on exit so that my system is not bogged down by orphaned Chromium processes.
  - **Tasks**:
    - [ ] Wire `BrowserPool.getInstance().close()` into the `finally` blocks of the main CLI evaluate workflow in [src/cli.ts](file:///Users/neo/projects/stealth-lightbeacon-node/src/cli.ts).
    - [ ] Refactor [src/core/scraping/selectorHealer.ts](file:///Users/neo/projects/stealth-lightbeacon-node/src/core/scraping/selectorHealer.ts) and render modules to cleanly release browser contexts.
  - **BEADS Tracking**:
    - **`B`**: Exiting evaluate runs leave Chromium processes running, holding system memory and keeping Node's event loop alive.
    - **`E`**: [src/cli.ts:206-212](file:///Users/neo/projects/stealth-lightbeacon-node/src/cli.ts#L206-L212) has no reference to closing `BrowserPool` on completion.
    - **`S`**: Executing an audit terminates all Playwright/Chromium processes cleanly; command line execution exits immediately with code 0 on success.

---

### 🚀 Epic 4.2: Strict Parity Quality Gate (Gap G4)
*Goal: Enforce strict test and quality boundaries to match the legacy Python release contract.*

#### 🧩 Feature 4.2.1: Automated CI Coverage Gating
- **User Story 4.2.1.1**: As a contributor, I want the build pipeline to reject commits that fail coverage limits or trigger lint errors.
  - **Tasks**:
    - [ ] Configure [tools/check-coverage.js](file:///Users/neo/projects/stealth-lightbeacon-node/tools/check-coverage.js) to enforce `line >= 80%`, `branch >= 65%`, and `function >= 75%`.
    - [ ] Configure `pnpm run coverage:check` as a pre-commit block.
    - [ ] Link these checks to Github, GitLab, and Bitbucket runner configs.
  - **BEADS Tracking**:
    - **`B`**: Lack of automated CI coverage boundaries allows code quality to drop over time.
    - **`E`**: Coverage scripts exist in `package.json` but are not integrated as blocking gates in CI pipelines.
    - **`S`**: Commits dropping test coverage are automatically blocked by the pipeline runner.

---

## 🗺️ Test-Driven Development (TDD) Multiphase Implementation Roadmap

This roadmap structures the closing of gaps and security vulnerabilities into distinct phases. At each milestone, corresponding test cases must be written/updated and executed to guarantee that overall test coverage remains **above 80%** (specifically targeting `line >= 80%`, `branch >= 65%`, and `function >= 75%`).

### Phase 1: Security & SSRF Governance Hardening (P0 Blocker Milestone)
*Goal: Resolve all critical network boundary and validation vulnerabilities.*

#### 🎯 Milestones & BEADS Tracking
- **`B`**: SSRFGuard IP rewriting causes HTTPS TLS handshake mismatch; Playwright Zendriver route interception is bypassable via DNS rebinding; Obscura fast engine executes external binary following internal redirects.
- **`E`**: 
  - `src/core/fetcher.ts:37-43` alters URL hosts to IPs.
  - `src/core/scraping/zendriver.ts:41-48` intercepts requests via page routing without Chromium socket pinning.
  - `src/core/scraping/obscura.ts:35-42` executes binary on input URLs with unchecked subprocess redirect handling.
- **`S`**: 
  - Outbound HTTPS fetches succeed without AltName or certificate warnings.
  - Playwright zendriver audits block target domains that dynamically change resolution to internal addresses.
  - Obscura subprocess redirect requests to private/loopback addresses are validated and blocked at the Node layer.

#### 🧪 Test Cases & Coverage Gate
- **TDD Test Updates**:
  - Update `tests/ssrf.test.js` to mock target HTTPS endpoints and verify they load successfully under `SSRFGuardAgent`.
  - Add specific tests in `tests/ssrf-dns-rebinding.test.js` simulating DNS rebinding attacks against `ZendriverEngine` and verifying they are blocked.
  - Add test in `tests/ssrf.test.js` ensuring redirect attempts from `ObscuraEngine` to local subnets trigger `SSRFViolationError`.
- **Gating Metric**: Run `pnpm run test:unit:ci` and verify all security and fetcher test cases pass. Global code coverage of `src/core/ssrf.ts` and `src/core/fetcher.ts` must exceed **80%**.

---

### Phase 2: Process Lifecycle & Queue Concurrency (P1 Priority Milestone)
*Goal: Prevent resource leakage and crawler queue popping race conditions.*

#### 🎯 Milestones & BEADS Tracking
- **`B`**: DuckDB queue retrieval pops duplicate URLs under multi-worker concurrency; `BrowserPool` singleton doesn't release spawned Chromium instances, hanging CLI processes.
- **`E`**:
  - `src/core/crawler.ts:125-172` implements read-then-update queues.
  - `src/cli.ts:206-212` missing `BrowserPool.close()` hook in teardown block.
- **`S`**:
  - Multi-worker concurrent crawling crawls 100 pages with exactly 1 fetch per URL.
  - Executed CLI audits exit immediately with code 0.

#### 🧪 Test Cases & Coverage Gate
- **TDD Test Updates**:
  - Add highly concurrent test in `tests/crawler.test.js` spawning 10 parallel workers on a 50-item pending crawl queue, asserting that each item is fetched exactly once.
  - Add test in `tests/browser-pool.test.js` asserting that calling `BrowserPool.getInstance().close()` successfully terminates child Chromium processes.
- **Gating Metric**: Run `pnpm run test:unit:ci`. Coverage of `src/core/crawler.ts` and `src/core/scraping/browserPool.ts` must exceed **80%**.

---

### Phase 3: Dynamic Registries & Resilient Caching (P2 Milestone)
*Goal: Provide structured lifecycles for plugins and prevent Analytical Cache lock contentions.*

#### 🎯 Milestones & BEADS Tracking
- **`B`**: Orchestrator hardcodes static lists of standard evaluators; no unified client wrapper exists for agent MCP stdio sessions; analytical PageSpeed cache writes fail under simultaneous transaction lock contention.
- **`E`**:
  - `src/core/orchestrator.ts` imports static lists.
  - `src/core/cache.ts` lacks retry-on-contention wrappers.
- **`S`**:
  - Developers can register/list custom evaluators dynamically.
  - Stdio MCP client wrapper cleanly initiates and tears down sessions.
  - PageSpeed writes handle high write-concurrency stress without transaction aborts.

#### 🧪 Test Cases & Coverage Gate
- **TDD Test Updates**:
  - Write test in `tests/evaluator-registry.test.js` registering a mock evaluator and ensuring it executes dynamically within the orchestrator lifecycle.
  - Add test in `tests/mcp-client.test.js` asserting correct process lifecycles and handshake timeouts.
  - Write concurrent write test in `tests/cache-contention.test.js` simulating 20 simultaneous analytical cache inserts and asserting zero database transaction errors.
- **Gating Metric**: Run `pnpm run test:unit:ci`. Coverage of `src/core/evaluatorRegistry.ts` and `src/core/pagespeedCache.ts` must exceed **80%**.

---

### Phase 4: CI Parity & Quality Gates
*Goal: Prevent any future quality and test regressions.*

#### 🎯 Milestones & BEADS Tracking
- **`B`**: Quality check scripts are unblocked in CI pipelines.
- **`E`**: Coverage scripts in `package.json` are not wired up to block local or remote runners.
- **`S`**: CI pipeline automatically rejects any commits dropping global workspace test coverage below 80%.

#### 🧪 Test Cases & Coverage Gate
- **TDD Test Updates**:
  - Verify that `tools/check-coverage.js` executes and correctly evaluates Jest/V8 coverage files.
- **Gating Metric**: Execute `pnpm run quality:check`. Global codebase coverage must exceed **80%**.

---

## 📊 Traceability Summary & Findings Integration

| Gap / Finding ID | Severity | Summary | Category | Action Taken |
| :--- | :--- | :--- | :--- | :--- |
| **G1** | HIGH | Lacks explicit evaluator plugin registry | Category 1 | Added Epic 1.1: Registry-backed evaluator dynamic loader |
| **G2** | MEDIUM | PageSpeed cache lacks write-contention handling | Category 3 | Added Epic 3.2: Contention-safe caching with retry-backoff |
| **G3** | HIGH | Lacks dedicated client wrapper for agent MCP sessions | Category 1 | Added Epic 1.2: Reusable `StealthMcpClient` wrapper |
| **G4** | MEDIUM | Quality checks are undocumented and unblocked in CI | Category 4 | Added Epic 4.2: Strict automated coverage gates |
| **R2-F01** | CRITICAL | SSRF IP rewriting causes HTTPS TLS mismatch | Category 2 | Added Epic 2.1: Custom `SSRFGuardAgent` socket pinning |
| **R2-F02** | CRITICAL | Playwright Chromium engine vulnerable to DNS rebinding | Category 2 | Added Epic 2.2: Browser-level DNS resolution pinning proxy |
| **R2-F03** | CRITICAL | Rust subprocess bypasses SSRF validation on redirects | Category 2 | Added Epic 2.3: Subprocess redirect governance |
| **R2-F04** | HIGH | Crawler Pop suffers DuckDB concurrency race condition | Category 3 | Added Epic 3.1: Atomic worker queue selection |
| **R2-F05** | HIGH | Browser pool is not torn down, hanging CLI runs | Category 4 | Added Epic 4.1: Finally teardown hooks for `BrowserPool` |
| **R2-F06** | MEDIUM | PageSpeed API keys passed in URL parameters | Category 2 | Folded into Epic 2.1: Shift API key transfer to headers |
| **R2-F07** | MEDIUM | Synchronous database disconnects block event loop | Category 3 | Folded into Epic 3.1: Transition to async DuckDB wrappers |
| **R2-F08** | MEDIUM | VARCHAR storage for numeric Unix epoch timestamps | Category 3 | Folded into Epic 3.1: Optimize cache database schema fields |
| **R2-F09** | MEDIUM | Unbounded browser contexts risk crashes under load | Category 4 | Folded into Epic 4.1: Cap maximum browser instances |
| **R2-F10** | MEDIUM | Rust binary portability issues across platforms | Category 2 | Folded into Epic 2.3: Provide pure JS fallback engine |
| **R2-F11** | MEDIUM | Web Service Workers bypass frame route interceptors | Category 2 | Folded into Epic 2.2: Enforce proxy-level DNS blocks |
| **R2-F12** | MEDIUM | Dynamic imports bypass TypeScript compilers | Category 1 | Folded into Epic 1.1: Resolve via ts-loader standard imports |

- **Final Recommendation:** `Human review required` (Critical security fixes G5-G7 require architectural decision sign-off).
- **Dissent Ledger:** None.

---

## 📋 Prioritized Action Items

| Priority | Owner | Action | Source finding |
| :--- | :--- | :--- | :--- |
| **P0** | Implementer | Build `SSRFGuardAgent` and refactor fetcher socket-pinning | R2-F01 |
| **P0** | Implementer | Add DNS proxy / router pinning to Playwright browser pool | R2-F02 |
| **P0** | Implementer | Enforce redirect validations at the Node level for Obscura subprocesses | R2-F03 |
| **P1** | Implementer | Refactor DuckDB pop queue to execute atomically | R2-F04 |
| **P1** | Implementer | Add `BrowserPool.close()` hooks in `finally` CLI evaluate loops | R2-F05 |
| **P2** | Implementer | Implement formal `EvaluatorRegistry` plugin registry | G1 |
| **P2** | Implementer | Add exponential retry-backoffs to analytical PageSpeed caches | G2 |
| **P2** | Implementer | Integrate `StealthMcpClient` wrapper for agent tool sessions | G3 |
| **P2** | Implementer | Configure CI coverage check gates | G4 |
