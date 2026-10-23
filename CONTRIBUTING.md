# Contributing to AI Gateway Sentinel

Thank you for contributing to AI Gateway Sentinel!

## Development Workflow

1. Fork or branch from `main`.
2. Run `make setup` or `npm install`.
3. Verify test suite passes: `make test` or `npm test`.
4. Run the security benchmark: `make benchmark` or `npm run benchmark:security`.
5. Ensure TypeScript compilation passes: `make build` or `npm run build`.
6. Open a Pull Request with a clear summary of your changes.

## Testing Guidelines

- All new features must include unit or integration tests under `test/`.
- Ensure all 113+ tests pass with zero regressions.
