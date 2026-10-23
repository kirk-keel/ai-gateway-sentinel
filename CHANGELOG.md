# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-10-23

### Added
- **Proxy & Guardrails**:
  - Reversible Tokenization Vault with streaming SSE chunk re-hydration.
  - Operational PII scrubber (US Well API numbers, GPS coordinates, PLSS legal land descriptions, confidential formations, borehole depths, petrophysics).
  - Adversarial prompt injection defense (DAN, delimiter smuggling, base64 payload decoding, zero-width stripping, indirect injection).
  - Bi-directional output guardrails & secret key masking.
  - Multi-modal vision DLP guardrails (EXIF GPS & metadata sanitization).
  - RAG groundedness & hallucination evaluator.
- **FinOps & Observability**:
  - Real-time Prometheus metrics exporter at `/metrics` (token counts, TTFT, inference costs).
  - Daily and monthly tenant budget quotas with 80% soft warnings and 429 hard stops.
  - Redis exact-match cache and unit-normalized L2 cosine similarity semantic vector cache.
  - OpenTelemetry distributed tracing (`traceparent` propagation) and `/v1/traces`.
- **Multi-Provider Resilience & Governance**:
  - 3-state circuit breakers (CLOSED, OPEN, HALF_OPEN) with automated failover.
  - Weighted round-robin and EMA latency-aware provider routing.
  - Adaptive GPU concurrency & leaky-bucket queueing with SLA prioritization.
  - Shadow traffic mirroring & A/B model drift evaluator.
  - Dynamic hot-reloadable rules engine (`/v1/rules`).
  - Cryptographically sealed compliance audit report generator (`/v1/compliance/report`).
  - AES-256-GCM envelope encryption with cloud KMS storage integration.
- **SDKs & Automation**:
  - First-class drop-in TypeScript SDK (`@ai-gateway/sentinel-sdk`) and zero-dependency Python SDK (`sentinel_ai`).
  - Automated red-teaming benchmark suite with 100% interception rate (`npm run benchmark:security`).
  - Multi-stage `Dockerfile`, `docker-compose.yml`, Prometheus scrape configurations, and provisioned Grafana dashboard.
  - Comprehensive test suite with 113 automated unit and integration tests across 22 suites.
