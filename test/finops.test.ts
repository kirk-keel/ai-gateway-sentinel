import { describe, it, expect } from 'vitest';
import { getModelPricing, calculateInferenceCostUSD } from '../src/config/pricing.js';
import {
  recordRequestUsage,
  recordCacheHitEvent,
  recordCacheMissEvent,
  recordGuardrailEvent,
} from '../src/metrics/finops.js';
import { register } from '../src/metrics/prometheus.js';

describe('FinOps: Model Pricing & Cost Computation', () => {
  it('should return exact pricing for standard models', () => {
    const gpt4oPricing = getModelPricing('gpt-4o');
    expect(gpt4oPricing.inputPerMillion).toBe(2.5);
    expect(gpt4oPricing.outputPerMillion).toBe(10.0);

    const miniPricing = getModelPricing('gpt-4o-mini');
    expect(miniPricing.inputPerMillion).toBe(0.15);
    expect(miniPricing.outputPerMillion).toBe(0.6);

    const sonnetPricing = getModelPricing('claude-3-5-sonnet');
    expect(sonnetPricing.inputPerMillion).toBe(3.0);
    expect(sonnetPricing.outputPerMillion).toBe(15.0);
  });

  it('should resolve versioned model names with prefix matching', () => {
    const pricing = getModelPricing('gpt-4o-2024-08-06');
    expect(pricing.inputPerMillion).toBe(2.5);
    expect(pricing.outputPerMillion).toBe(10.0);
  });

  it('should fallback to default pricing for unrecognized models', () => {
    const fallback = getModelPricing('unrecognized-custom-llm-v1');
    expect(fallback.inputPerMillion).toBe(2.0);
    expect(fallback.outputPerMillion).toBe(8.0);
  });

  it('should accurately compute inference cost in USD', () => {
    // 1000 prompt tokens + 500 completion tokens on gpt-4o
    // (1000 / 1_000_000) * 2.50 = 0.0025
    // (500 / 1_000_000) * 10.00 = 0.0050
    // Total = 0.0075 USD
    const cost = calculateInferenceCostUSD('gpt-4o', 1000, 500);
    expect(cost).toBe(0.0075);
  });
});

describe('FinOps & Observability: Prometheus Metrics Telemetry', () => {
  it('should record request usage and increment Prometheus counters', async () => {
    const { costUSD } = recordRequestUsage({
      model: 'gpt-4o',
      tenant: 'geophysics-team',
      promptTokens: 2000,
      completionTokens: 800,
      latencySeconds: 0.45,
    });

    expect(costUSD).toBeGreaterThan(0);

    const metricsOutput = await register.metrics();
    expect(metricsOutput).toContain('ai_gateway_requests_total');
    expect(metricsOutput).toContain('ai_gateway_tokens_total');
    expect(metricsOutput).toContain('ai_gateway_inference_cost_usd_total');
    expect(metricsOutput).toContain('geophysics-team');
    expect(metricsOutput).toContain('ai_gateway_model_latency_seconds');
  });

  it('should record cache hit savings and cache misses', async () => {
    const { savedCostUSD } = recordCacheHitEvent(
      'gpt-4o',
      'reservoir-dept',
      1500,
      300
    );
    expect(savedCostUSD).toBeGreaterThan(0);

    recordCacheMissEvent('gpt-4o', 'drilling-ops');

    const metricsOutput = await register.metrics();
    expect(metricsOutput).toContain('ai_gateway_cache_hits_total');
    expect(metricsOutput).toContain('ai_gateway_cache_tokens_saved_total');
    expect(metricsOutput).toContain('ai_gateway_cache_cost_saved_usd_total');
    expect(metricsOutput).toContain('ai_gateway_cache_misses_total');
  });

  it('should record guardrail violations counter', async () => {
    recordGuardrailEvent('WELL_API_NUMBER', 'redacted', 'subsurface-division');
    recordGuardrailEvent('prompt_injection', 'blocked', 'external-tenant');

    const metricsOutput = await register.metrics();
    expect(metricsOutput).toContain('ai_gateway_guardrail_violations_total');
    expect(metricsOutput).toContain('subsurface-division');
    expect(metricsOutput).toContain('external-tenant');
  });
});
