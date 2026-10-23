# ADR 0005: Multi-Modal Vision DLP & RAG Groundedness Guardrails

## Status
Accepted

## Context
1. Multi-modal inputs frequently contain camera metadata and embedded GPS coordinates in EXIF segments of field photos and schematics.
2. RAG pipelines can produce hallucinations that contradict retrieved enterprise documentation.

## Decision
1. Implemented **Multi-Modal Vision DLP** (`VisionDlpSanitizer`):
   - Inspects JPEG and PNG base64 payloads.
   - Strips `0xFFE1` APP1 EXIF markers, GPS sub-IFDs, camera serial numbers, and PNG metadata chunks while keeping raw pixel streams intact.
2. Implemented **RAG Groundedness Evaluator** (`GroundednessEvaluator`):
   - Computes factual statement token overlap against retrieved context chunks.
   - Configurable enforcement: telemetry flagging, appending verified notices, or suppressing unverified claims.

## Consequences
- Guaranteed zero leakage of physical wellsite coordinates via uploaded photographs.
- Verifiable factual alignment for enterprise document Q&A pipelines.
