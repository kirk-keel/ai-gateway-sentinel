# Development

## Setup

```bash
make setup
```

## Common Tasks

```bash
make up         # start the stack (Sentinel, Redis, Prometheus, Grafana, Mock LLM)
make down       # stop the stack
make logs       # tail container logs
make test       # run TypeScript unit and integration tests (Vitest)
make test-python# run Python SDK unit tests (unittest)
make test-all   # run full polyglot test suite (Vitest + Python unittest)
make benchmark  # run automated red-teaming security benchmark
make build      # compile TypeScript (tsc)
make dev        # run development server with hot reload
make clean      # tear down containers and clear build artifacts
```

## Running Tests

Sentinel uses [Vitest](https://vitest.dev/) for high-speed test execution and Python `unittest` for the client SDK:

```bash
# Run 113 TypeScript unit & integration tests across 22 suites
npm test

# Run Python SDK unit tests
npm run test:python

# Run complete test suite
npm run test:all
```

To run the automated red-teaming security evaluation suite:

```bash
npm run benchmark:security
```

## Code Quality & Standards

1. All TypeScript must strictly pass `tsc` with zero errors.
2. Code style follows standard Node.js/TypeScript guidelines.
3. Every new security rule, guardrail pattern, or resilience feature requires corresponding unit tests in `tests/`.
