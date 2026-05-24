# Correctness Hawk Independent Review — Round 2

**Role**: Correctness Hawk (Systematic enumeration of code paths, edge cases, and concurrency defects)
**Target**: `stealth-lightbeacon-node`
**Initial Score**: 5/10

## Findings

### 1. Concurrency Race Condition in Persistent Pop Loop [EXISTING_DEFECT][PRECISE]
- **Location**: [crawler.ts:107-126](file:///Users/neo/projects/stealth-lightbeacon-node/src/core/crawler.ts#L107-L126)
- **Problem**: The crawler attempts to perform an atomic pop operation using an `UPDATE ... RETURNING` query. However, because DuckDB is an embedded database that lacks row-level locking (`FOR UPDATE SKIP LOCKED`), concurrent worker threads running `runWorker()` simultaneously will evaluate the subquery `SELECT url FROM crawl_queue WHERE status = 'pending' LIMIT 1` to the same URL. Both threads will then successfully execute the `UPDATE` statement on the same row, resulting in both workers popping and crawling the exact same URL concurrently.
- **Evidence**:
  ```typescript
  const result = await duck.query({
    sql: `
      UPDATE crawl_queue 
      SET status = 'fetching' 
      WHERE url = (
        SELECT url 
        FROM crawl_queue 
        WHERE status = 'pending' 
        LIMIT 1
      ) 
      RETURNING url, depth
    `
  });
  ```
- **Fix**: Wrap the pop logic in a JavaScript-level mutex, or use a serialized transaction, or maintain a local in-memory lock Set of currently popped URLs to prevent concurrent pops of the same URL.

### 2. TLS Hostname Mismatch in HTTPS IP Pinning [EXISTING_DEFECT][PRECISE]
- **Location**: [fetcher.ts:37-43](file:///Users/neo/projects/stealth-lightbeacon-node/src/core/fetcher.ts#L37-L43)
- **Problem**: When a pinned IP address is available, the fetcher replaces the hostname in the URL string with the IP address (e.g. `https://example.com/path` becomes `https://1.2.3.4/path`) and injects the `Host` header. While this successfully pins the IP at the HTTP level, standard HTTPS connections in Node.js validate the server's TLS certificate against the hostname in the URL, not the `Host` header. Forcing standard `fetch` to connect to `https://1.2.3.4` will cause TLS handshake validation to fail instantly with `ERR_TLS_CERT_ALTNAME_INVALID` for any site using a standard SSL certificate.
- **Evidence**:
  ```typescript
  const targetUrl = pinnedIp ? currentUrl.replace(host, pinnedIp) : currentUrl;
  ...
  response = await fetch(targetUrl, {
    method: 'GET',
    headers: requestHeaders,
    redirect: 'manual'
  });
  ```
- **Fix**: Use a custom `http.Agent` / `https.Agent` that overrides `lookup` behavior to return the pinned IP instead of altering the URL hostname, keeping the original URL host intact.

### 3. Missing Cleanup of Playwright Browser Pool in CLI Lifecycle [EXISTING_DEFECT][PRECISE]
- **Location**: [cli.ts:206-212](file:///Users/neo/projects/stealth-lightbeacon-node/src/cli.ts#L206-L212)
- **Problem**: The `evaluateCommand` function registers teardown hooks for `pageSpeedService` and `ontologyStore` inside its `finally` block, but fails to call `BrowserPool.getInstance().close()`. If the CLI runs with the `stealth` or `rendered` engine, the Playwright Chromium browser processes spawned by `BrowserPool` are never closed, causing the CLI process to hang indefinitely on completion due to open child process pipes keeping the Node.js event loop active.
- **Evidence**:
  ```typescript
  } finally {
    await pageSpeedService?.close();
    await ontologyStore?.close();
  }
  ```
- **Fix**: Add `await BrowserPool.getInstance().close();` to the teardown sequence inside the `finally` block of `src/cli.ts`.
