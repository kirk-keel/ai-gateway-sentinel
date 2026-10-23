import client from 'prom-client';

// Create a dedicated Registry for ai-gateway-sentinel
export const register = new client.Registry();

// Enable default Node.js runtime metrics (CPU, heap, event loop lag, etc.)
client.collectDefaultMetrics({
  register,
  prefix: 'ai_gateway_',
});

// 1. Request Counter
export const requestCounter = new client.Counter({
  name: 'ai_gateway_requests_total',
  help: 'Total count of requests processed by the AI gateway',
  labelNames: ['model', 'tenant', 'status', 'cached'] as const,
  registers: [register],
});

// 2. Token Accounting Counter
export const tokenCounter = new client.Counter({
  name: 'ai_gateway_tokens_total',
  help: 'Total number of tokens processed (prompt, completion, total)',
  labelNames: ['model', 'tenant', 'type'] as const, // type: 'prompt' | 'completion' | 'total'
  registers: [register],
});

// 3. FinOps Cost Counter (USD)
export const costCounter = new client.Counter({
  name: 'ai_gateway_inference_cost_usd_total',
  help: 'Cumulative estimated inference cost in USD',
  labelNames: ['model', 'tenant'] as const,
  registers: [register],
});

// 4. Model Latency Histogram
export const modelLatencyHistogram = new client.Histogram({
  name: 'ai_gateway_model_latency_seconds',
  help: 'End-to-end model inference latency in seconds',
  labelNames: ['model', 'tenant'] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0, 20.0, 30.0],
  registers: [register],
});

// 5. Time To First Token (TTFT) for Streaming
export const timeToFirstTokenHistogram = new client.Histogram({
  name: 'ai_gateway_time_to_first_token_seconds',
  help: 'Latency to stream first token chunk to client (TTFT)',
  labelNames: ['model', 'tenant'] as const,
  buckets: [0.02, 0.05, 0.1, 0.25, 0.5, 1.0, 2.0, 5.0],
  registers: [register],
});

// 6. Guardrails Evaluation Latency
export const guardrailLatencyHistogram = new client.Histogram({
  name: 'ai_gateway_guardrail_latency_seconds',
  help: 'Duration of guardrail security checks in seconds',
  labelNames: ['check_type'] as const, // 'prompt_injection' | 'pii_scrubbing' | 'pipeline'
  buckets: [0.001, 0.002, 0.005, 0.01, 0.025, 0.05, 0.1],
  registers: [register],
});

// 7. Guardrail Violations & Interceptions Counter
export const guardrailViolationsCounter = new client.Counter({
  name: 'ai_gateway_guardrail_violations_total',
  help: 'Total security guardrail violations intercepted',
  labelNames: ['violation_type', 'action', 'tenant'] as const,
  registers: [register],
});

// 8. Cache Performance & FinOps Savings Counters
export const cacheHitsCounter = new client.Counter({
  name: 'ai_gateway_cache_hits_total',
  help: 'Total cache hits on prompt cache',
  labelNames: ['model', 'tenant'] as const,
  registers: [register],
});

export const cacheMissesCounter = new client.Counter({
  name: 'ai_gateway_cache_misses_total',
  help: 'Total cache misses on prompt cache',
  labelNames: ['model', 'tenant'] as const,
  registers: [register],
});

export const cacheTokensSavedCounter = new client.Counter({
  name: 'ai_gateway_cache_tokens_saved_total',
  help: 'Total tokens saved via cache hits',
  labelNames: ['model', 'tenant'] as const,
  registers: [register],
});

export const cacheCostSavedCounter = new client.Counter({
  name: 'ai_gateway_cache_cost_saved_usd_total',
  help: 'Estimated inference cost in USD saved via cache hits',
  labelNames: ['model', 'tenant'] as const,
  registers: [register],
});

// 9. Tenant FinOps Budget Quotas & Enforcement Gauges
export const tenantBudgetSpentGauge = new client.Gauge({
  name: 'ai_gateway_tenant_budget_spent_usd',
  help: 'Current spent amount in USD for tenant within active budget window',
  labelNames: ['tenant', 'period'] as const, // 'day' | 'month'
  registers: [register],
});

export const tenantBudgetLimitGauge = new client.Gauge({
  name: 'ai_gateway_tenant_budget_limit_usd',
  help: 'Configured budget limit in USD for tenant',
  labelNames: ['tenant', 'period'] as const,
  registers: [register],
});

export const quotaBlocksCounter = new client.Counter({
  name: 'ai_gateway_quota_blocks_total',
  help: 'Total requests blocked due to tenant budget quota limits',
  labelNames: ['tenant', 'period'] as const,
  registers: [register],
});

// 10. Multi-Provider Resiliency & Circuit Breaker Telemetry
export const circuitStateGauge = new client.Gauge({
  name: 'ai_gateway_provider_circuit_state',
  help: 'Current circuit breaker state (0 = CLOSED, 1 = HALF_OPEN, 2 = OPEN)',
  labelNames: ['provider'] as const,
  registers: [register],
});

export const failoverCounter = new client.Counter({
  name: 'ai_gateway_provider_failovers_total',
  help: 'Total upstream failover events triggered between providers',
  labelNames: ['from_provider', 'to_provider'] as const,
  registers: [register],
});

export const providerRequestsCounter = new client.Counter({
  name: 'ai_gateway_provider_requests_total',
  help: 'Total requests dispatched to specific upstream provider targets',
  labelNames: ['provider', 'status'] as const,
  registers: [register],
});
