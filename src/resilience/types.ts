export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';
export type ProviderRoutingStrategy = 'priority' | 'weighted' | 'latency';

export interface ProviderTarget {
  id: string;
  name: string;
  url: string;
  apiKey?: string;
  priority: number; // 1 = Primary, 2 = Secondary, 3 = Fallback
  weight?: number; // Relative weight (e.g. 70, 30) for weighted routing
  timeoutMs?: number;
}

export interface CircuitBreakerConfig {
  failureThreshold: number; // Consecutive failures before tripping to OPEN (e.g. 3)
  recoveryTimeoutMs: number; // Duration to remain in OPEN before trying HALF_OPEN (e.g. 15,000ms)
  timeoutMs: number; // Network timeout per request (e.g. 10,000ms)
}

export interface ProviderStatus {
  target: ProviderTarget;
  state: CircuitBreakerState;
  consecutiveFailures: number;
  lastFailureTime: number;
  lastSuccessTime: number;
  emaLatencyMs?: number;
}
