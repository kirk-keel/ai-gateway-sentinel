import {
  requestCounter,
  tokenCounter,
  costCounter,
  modelLatencyHistogram,
  cacheHitsCounter,
  cacheMissesCounter,
  cacheTokensSavedCounter,
  cacheCostSavedCounter,
  guardrailViolationsCounter,
} from './prometheus.js';
import { calculateInferenceCostUSD } from '../config/pricing.js';

export interface UsageRecordParams {
  model: string;
  tenant: string;
  promptTokens: number;
  completionTokens: number;
  latencySeconds: number;
  cached?: boolean;
}

export function recordRequestUsage(params: UsageRecordParams): { costUSD: number } {
  const {
    model,
    tenant,
    promptTokens,
    completionTokens,
    latencySeconds,
    cached = false,
  } = params;
  const totalTokens = promptTokens + completionTokens;
  const costUSD = calculateInferenceCostUSD(model, promptTokens, completionTokens);

  // Increment counters
  requestCounter.inc({ model, tenant, status: '200', cached: String(cached) });
  tokenCounter.inc({ model, tenant, type: 'prompt' }, promptTokens);
  tokenCounter.inc({ model, tenant, type: 'completion' }, completionTokens);
  tokenCounter.inc({ model, tenant, type: 'total' }, totalTokens);
  costCounter.inc({ model, tenant }, costUSD);

  // Observe latency
  modelLatencyHistogram.observe({ model, tenant }, latencySeconds);

  return { costUSD };
}

export function recordCacheHitEvent(
  model: string,
  tenant: string,
  savedPromptTokens: number,
  savedCompletionTokens: number
): { savedCostUSD: number } {
  const totalSavedTokens = savedPromptTokens + savedCompletionTokens;
  const savedCostUSD = calculateInferenceCostUSD(
    model,
    savedPromptTokens,
    savedCompletionTokens
  );

  cacheHitsCounter.inc({ model, tenant });
  cacheTokensSavedCounter.inc({ model, tenant }, totalSavedTokens);
  cacheCostSavedCounter.inc({ model, tenant }, savedCostUSD);

  return { savedCostUSD };
}

export function recordCacheMissEvent(model: string, tenant: string): void {
  cacheMissesCounter.inc({ model, tenant });
}

export function recordGuardrailEvent(
  violationType: string,
  action: 'blocked' | 'redacted',
  tenant: string
): void {
  guardrailViolationsCounter.inc({
    violation_type: violationType,
    action,
    tenant,
  });
}
