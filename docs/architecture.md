# Architecture

## Overview

AI Gateway Sentinel is a high-performance, containerized enterprise security proxy and governance control plane situated between enterprise applications and upstream Large Language Models (LLMs).

```mermaid
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
