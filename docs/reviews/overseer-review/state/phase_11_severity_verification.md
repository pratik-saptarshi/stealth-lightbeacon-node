# Severity Verification Table — Round 2

**Role**: Severity Verifier (Reviewing ground truth severity)
**Target**: `stealth-lightbeacon-node`

## Severity Assessments

| Finding | Panel Severity | Verified? | Actual Severity | Reason |
| :--- | :--- | :--- | :--- | :--- |
| **TLS Hostname Mismatch** | P0 | Yes | P0 | Completely breaks HTTPS requests when IP pinning is active, causing massive runtime failures on real-world sites. |
| **Playwright Rebinding Bypass** | P0 | Yes | P0 | Bypasses SSRF validation via DNS rebinding inside Chromium processes. |
| **Obscura Redirect SSRF Bypass** | P0 | Yes | P0 | Bypasses the Node-level SSRFGuard, exposing internal endpoints. |
| **Concurrency POP Race Condition** | P1 | Yes | P1 | Causes duplicate page fetches across threads but does not compromise network security. |
| **PageSpeed API Key in GET** | P2 | Yes | P2 | Exposes credentials in proxy logs. |
| **Synchronous event-loop block** | P2 | Yes | P2 | Halts Node event loop during teardown. |
| **VARCHAR Timestamps in Cache** | P3 | Yes | P3 | Minor schema structure optimization. |
| **Missing Browser Teardown in CLI** | P1 | Yes | P1 | Causes active CLI process to hang indefinitely on execution success. |
