# Security Auditor Independent Review — Round 2

**Role**: Security Auditor (Vulnerability identification, zero-trust network boundaries, SSRF, injection vectors)
**Target**: `stealth-lightbeacon-node`
**Initial Score**: 3/10

## Findings

### 1. DNS Rebinding Vulnerability in Playwright Zendriver Routing [EXISTING_DEFECT][PRECISE]
- **Location**: [zendriver.ts:41-48](file:///Users/neo/projects/stealth-lightbeacon-node/src/core/scraping/zendriver.ts#L41-L48)
- **Problem**: In the `stealth` engine, the `ZendriverEngine` registers a dynamic request interception handler (`ctx.route('**/*', ...)`) that validates the requested URL against the `SSRFGuard`. However, because Playwright executes a separate DNS resolution for routed browser requests that Node.js has no control over, and because `route.continue()` does not support socket/IP pinning, this layer remains fully vulnerable to classic DNS Rebinding attacks. An attacker controlling the DNS server can return a benign IP during Node's validation and then return a loopback IP (`127.0.0.1` or `169.254.169.254`) during the browser's actual connection phase.
- **Evidence**:
  ```typescript
  await ctx.route('**/*', async (route) => {
    try {
      await this.ssrfGuard.validate(route.request().url());
      await route.continue();
    } catch {
      await route.abort('blockedbyclient');
    }
  });
  ```
- **Fix**: Force all Playwright outbound requests through an upstream pinning proxy, or resolve hostnames to their pinned IPs at the Node layer and replace the URL hostname before routing inside Playwright, while dynamically overriding headers.

### 2. SSRF Subprocess Redirect Bypass in Obscura Fast Engine [EXISTING_DEFECT][PRECISE]
- **Location**: [obscura.ts:35-42](file:///Users/neo/projects/stealth-lightbeacon-node/src/core/scraping/obscura.ts#L35-L42)
- **Problem**: In the `fast` engine, the `ObscuraEngine` resolves the target URL host and resolves it to a pinned IP address. However, it then passes this pinned URL as an argument to the native binary `bin/obscura`. If the target server returns a redirect response (3xx) pointing to internal assets (e.g. `http://localhost/` or `http://169.254.169.254/latest/meta-data`), the native HTTP client inside `bin/obscura` will follow the redirect internally without returning to Node for validation. This allows a complete bypass of the SSRF Guard.
- **Evidence**:
  ```typescript
  const targetUrl = pinnedIp ? url.replace(host, pinnedIp) : url;

  const { stdout, stderr } = await execFileAsync(this.binaryPath, ['--dump', 'html', targetUrl], {
    timeout: 15000
  });
  ```
- **Fix**: Instruct the `obscura` binary to disable automatic redirects, or implement a redirect limit (max 0) inside the Rust client, handling redirects exclusively within Node.js where SSRFGuard is active.

### 3. API Key Exposure in URL GET Parameters [EXISTING_DEFECT][PRECISE]
- **Location**: [pagespeed.ts:39-43](file:///Users/neo/projects/stealth-lightbeacon-node/src/core/pagespeed.ts#L39-L43)
- **Problem**: The `PageSpeedService` appends the Google PageSpeed Insights API Key directly to the request URL's query parameters. Exposing sensitive API keys in URL query strings is an insecure pattern because GET query parameters are frequently recorded in plain text in proxy logs, web server logs, CDN gateways, and browser histories.
- **Evidence**:
  ```typescript
  const apiUrl = new URL(PAGE_SPEED_API_URL);
  apiUrl.searchParams.set('url', url);
  apiUrl.searchParams.set('key', apiKey);
  ```
- **Fix**: Pass the API Key in the HTTP headers using the standard Google header `X-Goog-Api-Key` instead of appending it to the query parameters.
