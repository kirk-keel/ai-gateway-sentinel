# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in AI Gateway Sentinel, please do not open a public issue. Contact the repository maintainers or security team directly via email or private vulnerability reporting on GitHub.

## Threat Model & Security Posture

- **Zero-Trust Guardrails**: Prompts and completions are scrubbed of operational PII and checked for adversarial prompt injection signatures before forwarding.
- **Reversible Tokenization**: Replaces high-risk coordinates and confidential formations with pseudonymous tokens, re-hydrating responses on egress.
- **Envelope Encryption**: Session encryption at rest with AES-256-GCM and cloud KMS keys.
- **Private Network Boundaries**: Cache and telemetry stores operate on internal container bridges.
- **Dependency & Secret Scanning**: Gitleaks and automated CI scans prevent credential commits.
