# Bill of Materials (BOM) — `stealth-lightbeacon-node`

This document details all active components, engines, features, and library dependencies comprising the `stealth-lightbeacon-node` site auditing platform.

## 1. Core Crawler & Orchestration Architecture

* **Async Bounded Crawler**: Worker-pool BFS crawler with strict concurrency throttling limits, queue wake-up triggers, robust network event loop preservation, and **Mutex-Protected Queue POP** to prevent concurrent worker crawl duplication.
* **Broken Page Mapper**: Dedicated failure tracker isolating non-200 HTTP responses without breaking or stalling the primary crawling cycle.
* **SSRF Guard & SSRFGuardAgent**: Pre- and post-redirect IP filter guarding all loopback, private (RFC 1918), and link-local address spaces. Leverages Node `createConnection` socket pinning to neutralize DNS-rebinding (TOCTOU) exploits without tampering with TLS Host or SNI checks.
* **Scraping Engine Factory**:
  - `http`: Lightweight HTTP client secured by `SSRFGuardAgent`.
  - `rendered`: Headless Playwright Chromium engine secured by loopback forwarding DNS-pinning proxies.
  - `fast`: Subprocess bridge connecting to a native Rust `obscura` executable, featuring strict redirect boundary limits enforced by child-process wrappers.
  - `stealth`: Premium Playwright driver featuring customized WebDriver flag suppression, WebGL fingerprint spoofing, and standard browser plugin emulation.
* **Evaluator Registry**: Dynamic plugin registry exposing contract-backed registries, type-safe lifecycle hooks, and execution-order pipelines.

## 2. Multi-Domain Audit Evaluators

* **Performance & CWV (Core Web Vitals)**:
  - Time to First Byte (TTFB) connection latency audits.
  - Google PageSpeed Insights (PSI) field loading experience integration (extracting LCP, CLS, INP percentiles) with custom retries.
  - Legacy/unoptimized image asset audits.
  - Drupal Cache verification headers (`x-drupal-cache` / `x-varnish`).
  - Resource aggregation analysis (verifying combined CSS/JS payloads).
* **Technical SEO**:
  - Page title and meta description presence and length audits.
  - Canonical link verification (detecting self-referencing issues and scheme mismatches).
  - Robots meta-tag indexing policy checks.
  - Semantic heading hierarchy validator.
  - OpenGraph social media schema parser.
  - Deep JSON-LD microdata schema compiler.
  - Global robots.txt pre-audit validation (`R-SEO-ROBOTS-BLOCK`, `R-SEO-ROBOTS-PATH-BLOCK`, `R-SEO-ROBOTS-SITEMAP`).
* **Accessibility (a11y)**:
  - Missing alt attributes on `<img>` elements.
  - Accessible names and labels on control/input elements.
  - Presence of single, well-structured `<h1>` main page titles.
  - Strict skipped heading level order validation.
  - Empty or non-descriptive interactive `<a>` and `<button>` actions.
  - Generic/placeholder file alt text audits (`R-A11Y-ALT-BAD`).
* **AEO & GEO (Answer/Generative Engine Optimization)**:
  - Schema microdata detection (FAQPage, HowTo).
  - Search query-oriented semantic heading structures.
  - Direct, concise, answer-optimized descriptive paragraphs.
  - Secure HTTPS scheme checks.
  - Trust signal validation (matching presence of standard pages: privacy policy, contact, about).
  - Outbound citations matching trusted authority datasets (educational, research, or governmental domains).
  - Author credentials and schema publication freshness verification.
  - Keyword density limits (flagging potential stuffing if frequency exceeds 3%).
* **UX (User Experience)**:
  - Mobile-responsive viewport configuration.
  - Typography inline size constraints (validating no font sizes under 12px).
  - Maximum nested navigation menu depth checks (no menus deeper than 3 levels).
  - Tap target size constraints (validating buttons/interactive targets are at least 48px high/wide).
* **Drupal Security & Headers**:
  - Critical security header presence checks (Content-Security-Policy, HSTS, X-Frame-Options, X-Content-Type-Options).
  - Exposed database, cookie, and engine generator fingerprints.
  - Exposed administrative endpoint pathways (JSON:API user directories).

## 3. Libraries & Dependencies

The platform leverages several industry-standard libraries to provide secure, robust, and lightning-fast execution:

| Dependency | Purpose | License |
| :--- | :--- | :--- |
| `@duckdb/node-api` | Embedded storage for high-speed relational analysis and cache querying | MIT |
| `@lancedb/lancedb` | Vector database storage for AI-driven semantic site indexing | Apache-2.0 |
| `cheerio` | In-memory HTML parser for fast structural DOM traversing | MIT |
| `commander` | CLI parsing, subcommand definitions, and runtime options | MIT |
| `handlebars` | Templating engine for rich premium HTML reporting | MIT |
| `ora` | Elegant CLI loading spinner and status feedback | MIT |
| `robots-parser` | Standard robots.txt syntax parser | MIT |
| `zod` | Safe runtime types and strict input schema boundaries | MIT |

## 4. Release & Validation Automation

* **Quality Gatekeeper Script (`tools/release.sh`)**: Enforces validation before committing or pushing releases. Runs full typecheck, unit tests, contract tests, and CI coverage verification.
* **Semantic Release Config (`.release-it.json`)**: Automates version bumping, `CHANGELOG.md` generation, git tag creation, origin branch pushing, and GitHub Release drafting.

