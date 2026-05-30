# Contributing to Stealth Lightbeacon Node

Welcome! We maintain high architectural standards and robust test coverage to ensure feature parity and correctness.

## Development Policies

### 1. Test-Driven Development (TDD)
We enforce a strict TDD loop for all evaluator modifications and core changes:
1. **Red Phase**: Write a failing unit test in the `tests/` directory verifying the defect or new capability. Confirm it fails via `pnpm test`.
2. **Green Phase**: Implement the minimum correct logic inside `src/` to satisfy the test.
3. **Refactor**: Clean up implementation without breaking existing tests.

### 2. Coverage Gate
All changes must satisfy our continuous integration coverage thresholds. Locally and in CI, the minimum aggregate coverage requirements are:
- **Line Coverage**: `>= 80%`
- **Branch Coverage**: `>= 65%`
- **Function Coverage**: `>= 75%`

To run coverage checks locally:
```bash
pnpm run coverage
```
Any pull request falling below these thresholds will fail the `quality:coverage` build gate.

### 3. TypeScript Guidelines
- Enable `strict` checks in `tsconfig.json`.
- Compile changes with zero TypeScript errors:
```bash
pnpm run build
```
- Avoid implicit any types.
