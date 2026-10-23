# Architecture

## Overview

AI Gateway Sentinel is a high-performance, containerized enterprise security proxy and governance control plane situated between enterprise applications and upstream Large Language Models (LLMs).

## System Topology (ASCII)

```text
+---------------------------------------------------------------------------------------------------+
|                                  ENTERPRISE APPLICATIONS & CLIENTS                                |
|          Subsurface Copilots   |   Drilling Assistants   |   Autonomous Agents   |  SDKs          |
+---------------------------------------------------------------------------------------------------+
                                                  |
                          HTTPS / OpenAI Protocol | (x-tenant-id / Bearer API Key)
                                                  v
+---------------------------------------------------------------------------------------------------+
|                                 AI GATEWAY SENTINEL (Port :8000)                                  |
|                                                                                                   |
|  [ Ingress RBAC & Auth ] ──────────► [ Zero-Trust Security Pipeline ]                             |
|  - Tenant ID Isolation              - Adversarial Injection Scanner (Confidence Heuristics)       |
|  - Scoped API Keys (sent_live_...)  - Operational PII & DLP Scrubber (Wells, Depth, Formations)   |
|  - Dynamic Rate Limiter             - Multi-Modal Vision DLP (GPS & Camera Metadata Scrubber)     |
|                                     - Reversible Token Vault (AES-256-GCM Envelope Encryption)   |
|                                                  |                                                |
|                                                  v                                                |
|  [ Caching & Model Routing ] <───────────────────┘                                                |
|  - Redis Exact Prompt Cache (SHA-256 Keyed)                                                       |
|  - Vector Semantic Cache (Cosine Similarity Cosine Match)                                         |
|  - Virtual Router 'sentinel-auto' (Dynamic Cost/Latency Classifier)                                |
|                                                  |                                                |
|                                                  v                                                |
|  [ Resilience & Output Governance ] ◄────────────┘                                                |
|  - Multi-Provider Circuit Breakers (Exponential Backoff + Health EMA)                             |
|  - Adaptive GPU Concurrency & Leaky-Bucket Queueing (SLA Priority)                                |
|  - Output Guardrails (Secret Leak Prevention, RAG Groundedness Evaluator)                         |
|  - Async Shadow Traffic Mirroring (A/B Model Drift Analysis)                                      |
+---------------------------------------------------------------------------------------------------+
        |                                      |                                    |
        | Prometheus Scrape (:8000/metrics)    | Redis Protocol (:6379)             | Upstream Forward
        v                                      v                                    v
+--------------------+               +--------------------+               +-----------------------+
| OBSERVABILITY STACK|               |   DATA STORAGE     |               | UPSTREAM LLM PROVIDERS|
| - Prometheus :9090 |               | - Redis 7 (Alpine) |               | - OpenAI / Anthropic  |
| - Grafana    :3000 |               | - KMS Token Vault  |               | - vLLM / Ollama (GPU) |
| - OpenTelemetry W3C|               | - Dynamic Rules    |               | - Mock Upstream :8001 |
+--------------------+               +--------------------+               +-----------------------+
```

## System Flow (Mermaid)
flowchart TD
    subgraph Clients["Enterprise Applications"]
        App1["Subsurface AI Assistant"]
        App2["Drilling Operations Copilot"]
        App3["Geophysics Reporting Service"]
    end

    subgraph Boundary["Sentinel Security Gateway (:8000)"]
        direction TB
        Auth["Enterprise RBAC & Multi-Tenancy (x-tenant-id)"]
        
        subgraph Guardrails["Zero-Trust Guardrail Engine"]
            Inj["Prompt Injection Defense & Delimiter Scanner"]
            PII["Operational PII & Confidential Stratigraphy Scrubber"]
            Vision["Multi-Modal Vision DLP (EXIF GPS Sanitizer)"]
            Vault["Reversible Tokenization Vault"]
        end

        Cache["Redis & Semantic Vector Cache"]
        Router["Model Router ('sentinel-auto') & Dispatcher"]
        Resilience["Circuit Breakers, Latency EMA & GPU Queue"]
        OutputGuard["Output Guardrails & RAG Groundedness"]
        Shadow["Asynchronous Shadow Traffic Mirroring"]
        FinOps["FinOps Observability (Prometheus /metrics)"]
    end

    subgraph Upstream["Upstream Model Execution"]
        CloudLLM["Cloud LLMs (OpenAI, Anthropic)"]
        LocalLLM["Local GPU Clusters (vLLM, Ollama, Triton)"]
    end

    Clients -->|Chat Completions| Auth
    Auth --> Inj
    Inj --> PII
    PII --> Vision
    Vision --> Vault
    Vault --> Cache
    Cache -->|Cache Miss| Router
    Router --> Resilience
    Resilience --> CloudLLM
    Resilience --> LocalLLM
    CloudLLM --> OutputGuard
    LocalLLM --> OutputGuard
    OutputGuard --> Clients
    Router -.->|Async Mirror| Shadow
    Boundary -.->|/metrics| FinOps
```

## Network Boundaries & Data Flow

- **Ingress**: All inbound enterprise traffic arrives at Sentinel on port `8000` via mutual TLS / private network.
- **Egress**: Sanitized prompts are forwarded to upstream LLM endpoints over secure outbound HTTPS.
- **Cache**: Redis runs on an isolated internal Docker bridge network (`sentinel-network`), inaccessible from the public internet.
- **Observability**: Prometheus scrapes `/metrics` on port `8000`, displayed via an internal Grafana instance (`:3000`).
