# Security Auditor Private Reflection — Round 2

I have re-read the source code and evaluated my initial findings.

## Self-Assessment and Confidence Ratings

### 1. DNS Rebinding Vulnerability in Playwright Zendriver Routing
- **Confidence**: High
- **Reasoning**: Playwright's `route.continue()` passes request execution to the browser's network layer. The browser performs a separate DNS lookup which is completely independent of the Node.js process lookup. Since Node does not pin standard browser connections to a specific socket IP, DNS Rebinding is a real and viable exploit vector.

### 2. SSRF Subprocess Redirect Bypass in Obscura Fast Engine
- **Confidence**: High
- **Reasoning**: The native binary `bin/obscura` executes in its own process space and uses its own HTTP client. Since Node only validates the initial URL and does not control the redirects inside the native process, redirect-based SSRF bypass is highly feasible.

### 3. API Key Exposure in URL GET Parameters
- **Confidence**: High
- **Reasoning**: Standard industry practice is to avoid putting secrets in query strings. While Google's PageSpeed API historically accepts it in the query string, passing it via headers is much more secure and prevents leakages in server logs.
