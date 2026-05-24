# Architecture Critic Independent Review — Round 2

**Role**: Architecture Critic (Design patterns, component coupling, resource pooling, performance optimization)
**Target**: `stealth-lightbeacon-node`
**Initial Score**: 6/10

## Findings

### 1. Synchronous Event-Loop Blocking during DuckDB Teardown [EXISTING_DEFECT][PRECISE]
- **Location**: [duckdb.ts:117-124](file:///Users/neo/projects/stealth-lightbeacon-node/src/core/db/duckdb.ts#L117-L124)
- **Problem**: When closing the DuckDB database instance, the runtime executes `connection.disconnectSync()` and `instance.closeSync()`. Because these are synchronous bindings, they block Node's single-threaded event loop. While acceptable for a simple short-lived CLI command, in high-throughput applications, server tasks, or when multiple crawlers run concurrently, blocking the event loop on termination creates severe latency spikes and delays concurrent request handling.
- **Evidence**:
  ```typescript
  try {
    connection.disconnectSync();
  } finally {
    instance.closeSync();
  ```
- **Fix**: Transition to async teardown methods if supported by `@duckdb/node-api`, or offload database instance deletion to a background worker thread.

### 2. Inefficient Schema Type and DB Write Serialization [EXISTING_DEFECT][PRECISE]
- **Location**: [cache.ts:44-53](file:///Users/neo/projects/stealth-lightbeacon-node/src/core/cache.ts#L44-L53), [cache.ts:74-80](file:///Users/neo/projects/stealth-lightbeacon-node/src/core/cache.ts#L74-L80)
- **Problem**: The database cache schema declares `cached_at VARCHAR NOT NULL` and stores Unix epoch timestamps as string values, which are subsequently parsed back via `Number(row.cached_at)`. Storing numeric Unix epoch values as string sequences in a columnar, high-performance analytical database like DuckDB is an anti-pattern that increases storage overhead, bypasses database-level index optimizations, and wastes CPU cycles on text conversions. Furthermore, `DuckDbJsonCache` uses `runtime.query()` (designed for fetching data rows) instead of `runtime.exec()` (designed for command execution) to run mutations (`DELETE` / `INSERT` / `CREATE TABLE`).
- **Evidence**:
  ```typescript
  cached_at VARCHAR NOT NULL,
  ...
  await runtime.query(
    this.execQuery(`DELETE FROM ${this.tableName()} WHERE cache_key = ?`, [cacheKey])
  );
  ```
- **Fix**: Redefine the schema to use `BIGINT` for the `cached_at` column, and execute mutations using the proper `exec()` runtime pipeline rather than `query()`.

### 3. Lack of Concurrency and Context Limits in BrowserPool [EXISTING_DEFECT][PRECISE]
- **Location**: [browserPool.ts:36-50](file:///Users/neo/projects/stealth-lightbeacon-node/src/core/scraping/browserPool.ts#L36-L50)
- **Problem**: The `BrowserPool` singleton manages a single `Browser` instance. While this is highly superior to launching a browser per page, the implementation lacks any browser-level resource limitations, such as a max concurrent page limit. Under extremely heavy concurrent crawling loads (e.g. concurrency = 50), the system will spawn 50 concurrent `BrowserContext` and `Page` objects inside the single Chromium process. This can lead to heavy CPU saturation, memory bloating, and eventual browser rendering crashes without a mechanism to queue or limit concurrent browser contexts.
- **Evidence**:
  ```typescript
  this.browserPromise = playwrightModule.chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_BIN,
    ...
  ```
- **Fix**: Implement a max-concurrency semaphore or dynamic browser pool inside `BrowserPool` that spawns multiple browser instances or queues requests once the active context count exceeds a threshold (e.g., 10 contexts per browser process).
