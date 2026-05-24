# Contributing to Stealth Lightbeacon Node

Welcome! We maintain high architectural standards and robust test coverage to ensure feature parity and correctness.

## Development Policies

### 1. Test-Driven Development (TDD)
We enforce a strict TDD loop for all evaluator modifications and core changes:
1. **Red Phase**: Write a failing unit test in the `tests/` directory verifying the defect or new capability. Confirm it fails via `npm test`.
2. **Green Phase**: Implement the minimum correct logic inside `src/` to satisfy the test.
3. **Refactor**: Clean up implementation without breaking existing tests.

### 2. Coverage Gate
All changes must maintain at least **90% branch and line coverage**. To check coverage locally:
```bash
npm run coverage
```
Any PR dropping below 90% branch coverage will fail the build.

### 3. TypeScript Guidelines
- Enable `strict` checks in `tsconfig.json`.
- Compile changes with zero TypeScript errors:
```bash
npm run build
```
- Avoid implicit any types.
