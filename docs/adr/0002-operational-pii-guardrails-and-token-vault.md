# ADR 0002: Operational PII Guardrails and Reversible Tokenization Vault

## Status
Accepted

## Context
Industrial and physical operations (energy, subsurface geology, wellsite telemetry) handle sensitive operational assets that traditional consumer PII detectors ignore: US Well API numbers, GPS coordinates, PLSS legal land descriptions, confidential formations, and reservoir petrophysics.

## Decision
1. Implemented specialized operational regex and heuristic scrubbers with customizable redaction tokens.
2. Built a **Reversible Tokenization Vault** (`TokenVaultManager`) supporting two modes:
   - **Static Redaction**: Substitutes sensitive terms with `[REDACTED_*]` tokens.
   - **Reversible Session Tokenization**: Replaces sensitive entities with pseudonymous session tokens (e.g. `{{SENTINEL_WELL_01}}`), storing the mapping in an encrypted vault and re-hydrating the original entities when upstream LLM responses stream back to the enterprise client.
3. Added `StreamingRehydrator` capable of stitching token fragments that cross chunk boundaries in Server-Sent Events streams.

## Consequences
- Upstream cloud models never receive actual coordinates or confidential formation names.
- Clients receive natural responses referencing their original entities without knowing de-identification occurred.
