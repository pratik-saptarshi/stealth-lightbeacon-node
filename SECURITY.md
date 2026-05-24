# Security Policy

## Supported Versions

Security fixes are published against the current default branch and the latest released version.

## Reporting a Vulnerability

Do not file public issues for security vulnerabilities.

Use a private GitHub Security Advisory if this repository is published on GitHub. If that is not available, contact the maintainers through the repository’s existing private communication channel and include:

- Affected version or commit
- Clear reproduction steps
- Expected and actual behavior
- Any relevant logs, screenshots, or request/response samples after redacting secrets, cookies, tokens, private hostnames, customer data, and API keys

We will acknowledge verified reports promptly and coordinate remediation before public disclosure.

## Secret Handling

Do not include live secrets in reports, issues, screenshots, reproduction scripts, or generated audit artifacts. If a Google PageSpeed Insights key or other credential is exposed through a command line, shell history, process listing, log, report, or commit, rotate it before sharing artifacts.

Prefer environment or secret-manager injection for credentials. Command-line flags such as `--api-key` exist for compatibility, but they are not safe default guidance for public documentation or shared workflows.
