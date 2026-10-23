# ADR 0004: Multi-Provider Resilience, Circuit Breakers & Latency Routing

## Status
Accepted

## Context
Upstream LLMs frequently encounter 5xx outages, rate limits (HTTP 429), or transient network timeouts. Single-provider dependencies risk total service interruption for critical enterprise workflows.

## Decision
1. Implemented a 3-state Circuit Breaker (`CLOSED`, `OPEN`, `HALF_OPEN`) tracking failure thresholds and recovery probe intervals.
2. Built `ProviderDispatcher` supporting:
   - Automated multi-target fallback across primary, secondary, and fallback providers.
   - Weighted round-robin load distribution.
   - Exponential Moving Average (EMA) latency-aware target routing, directing queries to the fastest responding provider.

## Consequences
- Zero-downtime failover across different cloud vendors (OpenAI, Azure, Bedrock, and local models).
- Automatic circuit tripping prevents upstream thundering herd problems.
