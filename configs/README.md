# AI Gateway Sentinel Configuration Guide

This directory houses static and initial configuration manifests for AI Gateway Sentinel.

## Configuration Manifests

- **`gateway.json`**: Primary service configuration defining gateway network bindings, guardrail thresholds, Redis cache behavior, FinOps budget enforcement defaults, and upstream provider resilience settings.
- **`pricing.json`**: Token inference pricing table mapping LLM models to prompt (input) and completion (output) rates per 1,000,000 tokens (USD).
- **`rules.json`**: Initial declarative rule sets for PII masking, secret token redaction, and prompt injection detection patterns.

## Dynamic Runtime Overrides

All static configuration parameters can be overridden at runtime via:
1. **Environment Variables**: Defined in `.env` (refer to [`.env.example`](../.env.example)).
2. **Dynamic Admin REST APIs**:
   - `POST /v1/rules`: Add and update runtime regex guardrail rules.
   - `POST /v1/quotas`: Update tenant budget quotas dynamically.
   - `POST /v1/shadow/config`: Configure dynamic shadow mirroring targets.
