# Release Notes: v3.0.11

Version `3.0.11` is a major hardening, security, and architectural release. It brings zero-trust Server-Side Request Forgery (SSRF) socket pinning, Playwright DNS proxy shielding, transaction contention retries, concurrency worker protections, decoupled dynamic evaluator extensions, and robust automated validation pipelines.

---

## 🛠️ Summary of Key Features

### 1. Zero-Trust Security & SSRF Hardening
- **SSRFGuardAgent Socket Pinning**: Custom agent intercepts Node's HTTP/HTTPS `createConnection` network requests to pin sockets to resolved and pre-validated IPs. This prevents Time-of-Check Time-of-Use (TOCTOU) DNS-rebinding escapes without tampering with TLS Host or SNI checks.
- **Playwright DNS Pinning Proxy**: Headless browser Chromium scraping processes are secured via a secure loopback forwarding DNS proxy layer, neutralizing all browser-level DNS-rebinding vectors.
- **Redirect Limits child-boundary**: Native Rust `obscura` child subprocess execution enforces strict limit flags to delegate redirect checks safely to Node's child process boundary.

### 2. Core Concurrency & Database Safety
- **Mutex-Protected Queue POP**: Concurrent crawler worker routines are protected by in-memory mutexes, preventing multiple workers from running duplicate evaluations on the same URL simultaneously.
- **Transactional Cache Exponential Backoff**: PageSpeed DuckDB cache operations leverage transaction abort rollbacks and automatic exponential backoffs (up to 5 retries), neutralizing database lock contention during concurrent write surges.
- **CLI Process Teardown Hooks**: Added `BrowserPool.getInstance().close()` hooks to evaluations, preventing headless Chromium memory and process leaks on exit.

### 3. Dynamic Evaluator Extensibility
- **EvaluatorRegistry Engine**: Transitioned the evaluation loop from hard-coded static arrays to dynamic evaluator registry contracts. This supports custom plugin registration, type-safe lifecycle hooks, and ordered pipeline processing.

### 4. Continuous Integration & Release Automation
- **Release Orchestration Script (`tools/release.sh`)**: Executable pre-release orchestrator that runs full typecheck, unit tests, contract checks, and coverage CI tests before committing/releasing.
- **Automatic Semantic Versioning (`.release-it.json`)**: Configured `release-it` and `@release-it/conventional-changelog` to automate version bumping, changelog compilation, git tags, origin pushing, and GitHub Release drafting.

---

## 🧪 Verification & Validation Metrics

All tests and gates are 100% green.

- **Total Test Cases**: `107`
- **Passes**: `104` | **Skips**: `3` (ontology local-only) | **Failures**: `0`
- **Test Duration**: `~7.6s`
- **Quality Verification Gate**: **PASSED** ✓

### 📊 Code Coverage Status (CI Mode)

Coverage thresholds are fully passed:

| Coverage Type | Required | Actual | Status |
| :--- | :--- | :--- | :--- |
| **Line Coverage** | `>= 80.0%` | **`88.50%`** | **PASSED** ✓ |
| **Branch Coverage** | `>= 65.0%` | **`78.21%`** | **PASSED** ✓ |
| **Function Coverage** | `>= 75.0%` | **`81.06%`** | **PASSED** ✓ |
