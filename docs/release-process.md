# Release Process

This document outlines the pathway for staging, committing, and publishing well-documented releases to github.com from the Antigravity IDE.

## 1. Commit and Stage Workflow

Always follow Conventional Commits. Use the `/caveman-commit` skill in Antigravity to stage and commit your changes in a terse, standardized format:
- `feat(...)`: A new feature
- `fix(...)`: A bug fix
- `docs(...)`: Documentation changes
- `test(...)`: Adding or correcting tests
- `chore(...)`: Maintenance tasks (dependencies, config, releases)

Example commit:
`feat(cache): add redis-backed fallback mechanism`

## 2. Release Orchestration

We use `release-it` combined with the `@release-it/conventional-changelog` plugin to automate:
- Version bumping based on commit history semantics (e.g., `feat` causes minor bump, `fix` causes patch bump).
- Creating/appending release notes to `CHANGELOG.md`.
- Creating git tags and pushing branch and tag to GitHub.
- Creating a rich GitHub Release via the GitHub API.

### Execution Scripts

A pre-release script `tools/release.sh` is provided. It guarantees quality by running the full quality check suite (`pnpm run quality:check`) before executing `release-it`.

- **Dry-run Mode (Simulate release):**
  `pnpm run release:dry`
  *(Prints the version bump, changelog additions, and git commands without applying them)*

- **Production Release:**
  `pnpm run release`
  *(Bumps version, commits `package.json`, updates `CHANGELOG.md`, tags, pushes to origin, and publishes a GitHub Release)*

## 3. Configuration

The release configuration is stored in `.release-it.json`.
- Bumps version inside `package.json`.
- Enforces a clean git working directory.
- Pushes tags and branches to origin.
- Uses `conventionalcommits` preset for changelogs.
- Publishes GitHub Releases with parsed commits.
