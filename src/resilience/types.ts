export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface ProviderTarget {
  id: string;
  name: string;
  url: string;
  apiKey?: string;
  priority: number; // 1 = Primary, 2 = Secondary, 3 = Fallback
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
}
