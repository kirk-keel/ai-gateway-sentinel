# ADR 0001: Use Fastify for High-Throughput Streaming AI Proxy

## Status
Accepted

## Context
Enterprise AI gateways require high concurrency, low latency overhead (<5ms), native Server-Sent Events (SSE) streaming support, and rigorous schema validation for incoming requests and telemetry headers.

## Decision
We adopted **Fastify v5** as the core HTTP runtime rather than Express or NestJS. Fastify provides:
- Highly optimized event-loop performance with low memory overhead.
- Native streaming response pipes supporting chunk-by-chunk SSE re-hydration without buffering entire completions.
- Built-in request ID generation and structured JSON logging.
- Seamless hook ecosystem (`preValidation`, `onSend`, `onResponse`) for tracing and audit logging.

## Consequences
- Requires ESM-first TypeScript configuration.
- Header injection for streaming responses must be handled via `onSend` or raw headers before transmission starts.
