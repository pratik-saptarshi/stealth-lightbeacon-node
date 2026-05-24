# Claim Verification Report — Round 2

**Role**: Claim Verifier (Verification of reviewer citations against ground truth)
**Target**: `stealth-lightbeacon-node`

## Citation Verification Table

| Claim | Cited Location | Status | Evidence |
| :--- | :--- | :--- | :--- |
| **Concurrency Race Condition** | `crawler.ts:107-126` | [VERIFIED] | Atomic update runs a LIMIT 1 subquery without row locks. |
| **TLS Hostname Mismatch** | `fetcher.ts:37-43` | [VERIFIED] | Pinned IP replaces URL host, violating HTTPS validation. |
| **Playwright Rebinding** | `zendriver.ts:41-48` | [VERIFIED] | Playwright route.continue() does a separate browser-level DNS lookup. |
| **Obscura Redirect Bypass** | `obscura.ts:35-42` | [VERIFIED] | Rust binary is invoked with initial URL and follows redirects internally. |
| **PageSpeed API Key in GET** | `pagespeed.ts:39-43` | [VERIFIED] | searchParams.set('key', apiKey) is executed. |
| **Synchronous Event-Loop Block** | `duckdb.ts:117-124` | [VERIFIED] | disconnectSync() and closeSync() are executed on the main thread. |
| **VARCHAR Timestamps in Cache** | `cache.ts:74-80` | [VERIFIED] | Scheme declares cached_at VARCHAR. |
| **Missing Browser Teardown** | `cli.ts:206-212` | [VERIFIED] | evaluateCommand's finally has no BrowserPool.close() call. |
| **Browser pool concurrency** | `browserPool.ts:36-50` | [VERIFIED] | Chromium is launched directly without connection pools or concurrency checks. |
| **Service worker routing escape** | `zendriver.ts:41-48` | [VERIFIED] | Plays only on frame network requests. |
| **Reserved HTTP/2 flag** | `cli.ts:35` | [VERIFIED] | commander .option('--http2') is never read elsewhere. |
