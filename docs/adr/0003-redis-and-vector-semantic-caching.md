# ADR 0003: Exact-Match Redis Caching & High-Dimensional Semantic Vector Caching

## Status
Accepted

## Context
Upstream LLM inference incurs significant financial cost ($2.50 - $15.00 per million tokens) and latency (500ms - 3000ms). Duplicate or semantically identical prompt queries waste budget and degrade response times.

## Decision
Implemented a tiered dual-cache architecture:
1. **Tier 1 (Exact Match)**: SHA-256 keyed cache stored in Redis with TTL expiration. Returns identical responses in <2ms.
2. **Tier 2 (Semantic Vector Match)**: Feature vector generator computing 64-dimensional sparse representations using token frequency and character n-grams, stripped of stop words. Cosine similarity matching ($\ge 0.88$) retrieves previous responses for near-identical questions.

## Consequences
- Up to 80-90% reduction in inference cost on recurring enterprise queries.
- Zero external vector database required for lightweight semantic matching.
