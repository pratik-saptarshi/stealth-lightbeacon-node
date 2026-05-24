# Architecture Critic Private Reflection — Round 2

I have re-read the source code and evaluated my initial findings.

## Self-Assessment and Confidence Ratings

### 1. Synchronous Event-Loop Blocking during DuckDB Teardown
- **Confidence**: High
- **Reasoning**: Verified in `src/core/db/duckdb.ts`. The methods `disconnectSync()` and `closeSync()` are called. They are fully blocking calls that halt execution on Node's main thread.

### 2. Inefficient Schema Type and DB Write Serialization
- **Confidence**: High
- **Reasoning**: Storing numeric timestamps as strings in a high-performance analytics database is a major anti-pattern. Also, running mutations using `query()` instead of `exec()` is an incorrect API abstraction.

### 3. Lack of Concurrency and Context Limits in BrowserPool
- **Confidence**: High
- **Reasoning**: If a user runs a crawl with concurrency = 20, 20 parallel contexts are spawned in a single Chromium browser without any bounds, which could crash the browser process under memory-constrained systems.
