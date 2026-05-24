# Stealth Lightbeacon Node

TypeScript crawl orchestration and multi-domain site auditing for technical SEO, performance, accessibility, AEO/GEO, UX, and Drupal-specific security checks.

## Current Release Posture

This repository is not ready for public npm publication until the package boundary is explicit. Before publishing, choose one model and document it in `package.json`:

- Source-only GitHub release: mark the package `private` and do not publish to npm.
- npm-publishable release: add a strict `files` allowlist and `publishConfig`, then verify the tarball with `npm pack --dry-run`.

Generated audit outputs, local caches, graph reports, and integration logs are development artifacts. They must stay out of commits and release tarballs.

## Features

- Bounded crawl orchestration with throttling and optional broken-link discovery.
- SSRF guard that blocks private, loopback, and link-local targets unless explicitly allowed.
- Fetch engines for HTTP, rendered pages, native `obscura` integration, and stealth browser rendering.
- Embedded DuckDB and LanceDB storage for audit data, PageSpeed caches, and semantic retrieval records.
- Budget enforcement for performance and technical thresholds.
- Evaluators for performance, technical SEO, accessibility, AEO/GEO, UX, and Drupal security.

## Install

```sh
npm ci
npm run build
```

Use `npm ci` for clean-room installs and CI. Do not replace it with `npm install` in release automation.

## CLI Usage

Write reports to an ignored output directory instead of the repository root:

```sh
npm start -- evaluate https://example.com --out .tmp/reports/example --format both --crawl-depth 1 --max-urls 5 --engine http --no-pdf
```

The CLI writes `report.json`, `report.html`, and, when PDF output is enabled, `report.pdf` inside the selected output directory.

### Options

| Option | Description |
| --- | --- |
| `-o, --out <dir>` | Output directory. Use an ignored path such as `.tmp/reports/<run>`. |
| `-f, --format <format>` | Report format: `json`, `html`, or `both`. |
| `-d, --crawl-depth <depth>` | Crawl depth. |
| `-n, --max-urls <count>` | Maximum crawled URLs. |
| `--render` | Render JavaScript via Playwright. |
| `--engine <engine>` | Fetch engine: `http`, `rendered`, `fast`, or `stealth`. |
| `--http2` | Reserved flag for HTTP/2 transport support. |
| `--budget <path>` | Budget configuration JSON path. |
| `--check-links` | Check discovered outbound links. |
| `--check-api` | Probe the Drupal JSON:API user endpoint. |
| `--allow-private` | Allow private or loopback targets. Do not use for untrusted URLs. |
| `--api-key <key>` | Compatibility path for Google PageSpeed Insights. Prefer environment or config-based secret injection; command-line secrets can appear in shell history and process listings. |
| `--no-pdf` | Skip PDF output. Recommended for release verification until the legacy PDF path is replaced or isolated. |

## Secret Handling

- Do not put real API keys, tokens, cookies, private URLs, or customer data in examples, reports, logs, screenshots, or issues.
- Prefer `GOOGLE_PAGESPEED_API_KEY` through your local environment or secret manager. Keep `.env.example` placeholder-only.
- Avoid `--api-key` for normal use because command-line arguments can be exposed through shell history and process listings.
- If a secret is ever committed or pasted into a report, rotate it before sharing the repository or artifact.

## Generated Artifacts

Do not commit generated outputs:

- `report.json`
- `report.html`
- `report.pdf`
- `.tmp/`
- `.cache/`
- `.data/`
- `reports/`
- `graphify-out/`
- `integration_log.jsonl`

Use `npm pack --dry-run` before any public source or npm release and inspect the file list for accidental artifacts.

## Developer Workflow

```sh
npm run build
npm test
npm run coverage
```

Release candidates should additionally run:

```sh
npm pack --dry-run
npm audit signatures
```

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
