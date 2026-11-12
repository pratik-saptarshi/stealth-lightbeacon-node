# Context Brief — stealth-lightbeacon-node v2.0.0 (Round 2)

## Codebase State
- Branch: `main` | Single commit: `589ca14 initial public release`
- Worktree: no | Commits behind origin: unknown (no remote fetch)
- Test suite: **58/58 pass** (4.0s)
- Node engine: >=26.13.1 <27 | TypeScript 5.8.3

## Stack Signals Detected
- TypeScript (strong) → TS Reviewer persona warranted
- Playwright/browser automation → Reliability signal
- DuckDB (in-memory + file) → DB signal
- MCP server (stdio JSON-RPC) → API/protocol signal
- SSRF mitigation layer → Security signal (critical path)
- DNS pinning (SSRFGuard.dnsCache static Map) → Security
- Singleton BrowserPool → Performance

## Architecture Summary

**Entry points:**
- `src/cli.ts` → `evaluateCommand()` → `loadRuntimeOptions()` → `runAudit()`
- `src/mcp/stdio.ts` → `runStdioMcpServer()` → `createMcpServer()` → `invokeTool()`

**Critical path (CLI audit):**
```
evaluateCommand → loadRuntimeOptions(Zod) → createFetchPage (factory)
  → crawlSite (DuckDB queue) → evaluator.evaluate() loop → Reporter
```

**Core modules:**
- `ssrf.ts`: SSRFGuard + SSRFViolationError. Static `dnsCache: Map<string,string>`. IP-pins first resolved address.
- `fetcher.ts`: `fetchHttpPage` → manual redirect loop with guard.validate() each hop + pinnedIp header injection. Also has `renderPage()` (not via BrowserPool — launches its own browser process per call).
- `scraping/factory.ts`: Routes by engine string ('http','rendered','fast','stealth')
- `scraping/zendriver.ts`: Uses BrowserPool singleton + ctx.route() for per-request SSRF validation + post-nav validate(finalUrl)
- `scraping/obscura.ts`: Binary exec or HTTP fallback; pre-validates + IP-pins URL
- `scraping/browserPool.ts`: Singleton browser; no cleanup hook exposed to CLI lifecycle
- `crawler.ts`: DuckDB in-memory for queue. Sitemap seed. Atomic UPDATE...RETURNING pop.
- `orchestrator.ts`: runAudit() → crawlSite → evaluator loop → AuditPersistence hooks
- `cache.ts`: DuckDbJsonCache — uses .query() for DELETE+INSERT (not .exec()), cached_at stored as VARCHAR string
- `pagespeed.ts`: PageSpeedService — API key appended to GET URL querystring, 3-retry with 2x backoff
- `mcp/server.ts`: JSON-RPC 2.0, no auth, exposes duckdb.query/exec, lancedb ops, ontology tools
- `config.ts`: Zod schema; concurrency max 20, throttleMs max 60s

## Safety Mechanisms Found
- `SSRFGuard.validate()` on every URL before fetch
- `SSRFGuard.dnsCache` IP pinning (static, process-lifetime)
- `guard.validate()` on each redirect hop in fetchHttpPage
- `ctx.route('**/*')` + validate in ZendriverEngine
- `validateBudgets()` for score thresholds
- `withHardTimeout()` wrapping DuckDB ops
- Zod parse at all config entry points

## Prior Round Findings (R1) — All Fixed
- DNS rebinding → FIXED (dnsCache + IP pinning)
- SSRF redirect bypass → FIXED (per-hop validation in fetchHttpPage)
- Playwright per-request browser launch → FIXED (BrowserPool singleton)
- Crawler traversal → FIXED (DuckDB queue + sitemap seeding)

## Key File Inventory
- ssrf.ts: 2745 bytes
- fetcher.ts: 4077 bytes
- crawler.ts: 7142 bytes
- orchestrator.ts: 3398 bytes
- cache.ts: 3017 bytes
- pagespeed.ts: 5209 bytes
- mcp/server.ts: ~12k (full JSON-RPC impl)
- scraping/browserPool.ts: singleton browser
- scraping/zendriver.ts: BrowserPool consumer
- scraping/obscura.ts: binary exec or HTTP fallback
- scraping/factory.ts: engine router

## Context Gaps
- No production traffic data; concurrency/throttle behavior not exercised under load
- No integration test for MCP auth / protocol edge cases
- BrowserPool teardown in CLI lifecycle not verified in tests
