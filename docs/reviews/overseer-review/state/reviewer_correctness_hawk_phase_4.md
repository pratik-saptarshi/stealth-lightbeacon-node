# Correctness Hawk Private Reflection — Round 2

I have re-read the source code and evaluated my initial findings.

## Self-Assessment and Confidence Ratings

### 1. Concurrency Race Condition in Persistent Pop Loop
- **Confidence**: High
- **Reasoning**: The SQL statement runs an inner query `SELECT url FROM crawl_queue WHERE status = 'pending' LIMIT 1`. Without serialization or row locks, multiple processes running concurrently will resolve the same URL. DuckDB's in-process nature doesn't magically solve this multi-promise concurrency in Node.js since the queries are dispatched concurrently in the main event loop. This is a solid, confirmed bug.

### 2. TLS Hostname Mismatch in HTTPS IP Pinning
- **Confidence**: High
- **Reasoning**: Node.js `fetch` uses undici under the hood. When making HTTPS connections, the TLS SNI and certificate validation are based on the host specified in the URL. If the URL host is replaced with an IP address, `fetch` validates the certificate against that IP, which will fail for standard certificates. This is an extremely high-impact runtime correctness issue.

### 3. Missing Cleanup of Playwright Browser Pool in CLI Lifecycle
- **Confidence**: High
- **Reasoning**: Verified in `src/cli.ts`. `finally` only closes pagespeed service and ontology store. The `BrowserPool` keeps child processes alive, which prevents standard CLI exit.
