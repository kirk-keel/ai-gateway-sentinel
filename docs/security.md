# Security

## Principles

- **Zero-Trust Input/Output Verification** — Every prompt and model response is actively inspected, scrubbed, and attested before traversing boundaries.
- **Data Minimization & Sovereign Protection** — Operational PII (Well API numbers, GPS coordinates, stratigraphy, petrophysics) is scrubbed or pseudonymized using reversible tokens.
- **Multi-Modal DLP** — EXIF GPS tags, camera metadata, and device serial numbers are automatically stripped from image uploads.
- **Cryptographic Envelope Vault** — Session de-identification mappings are encrypted at rest using AES-256-GCM authenticated encryption with cloud KMS keys.
- **Private Network Isolation** — Services communicate across an internal container network; no cache or database is exposed publicly.

## Secrets Management

- `.env` is never committed. All variables are documented in `.env.example`.
- Upstream LLM provider keys and webhook secrets are mounted securely via environment variables or Kubernetes secrets.
- Scoped API keys issued by Sentinel are cryptographically hashed using SHA-256 with salts before persistence.

## Network Topology

| Service | Internal Port | Binding | Reachable Via |
| :--- | :--- | :--- | :--- |
| `sentinel-gateway` | 8000 | `0.0.0.0:8000` | Enterprise Apps / Ingress |
| `sentinel-redis` | 6379 | `127.0.0.1:6379` | Sentinel Gateway only |
| `sentinel-prometheus` | 9090 | `127.0.0.1:9090` | Internal network / Grafana |
| `sentinel-grafana` | 3000 | `127.0.0.1:3000` | Security Ops / Engineers |
| `sentinel-mock-upstream` | 8001 | `127.0.0.1:8001` | Sentinel Gateway only |

## Reporting Vulnerabilities

See [SECURITY.md](../SECURITY.md) for vulnerability disclosure procedures.
