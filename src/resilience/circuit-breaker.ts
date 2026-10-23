import {
  CircuitBreakerConfig,
  CircuitBreakerState,
  ProviderStatus,
  ProviderTarget,
} from './types.js';
import { circuitStateGauge } from '../metrics/prometheus.js';

export class CircuitBreaker {
  private providers = new Map<string, ProviderStatus>();
  private config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = {
      failureThreshold: config.failureThreshold ?? 3,
      recoveryTimeoutMs: config.recoveryTimeoutMs ?? 15000,
      timeoutMs: config.timeoutMs ?? 10000,
    };
  }

  public registerProvider(target: ProviderTarget): void {
    if (!this.providers.has(target.id)) {
      this.providers.set(target.id, {
        target,
        state: 'CLOSED',
        consecutiveFailures: 0,
        lastFailureTime: 0,
        lastSuccessTime: Date.now(),
      });
      circuitStateGauge.set({ provider: target.id }, 0);
    }
  }

  public getProviderStatus(id: string): ProviderStatus | undefined {
    return this.providers.get(id);
  }

  public getAllStatuses(): ProviderStatus[] {
    return Array.from(this.providers.values()).sort(
      (a, b) => a.target.priority - b.target.priority
    );
  }

  public canExecute(providerId: string): boolean {
    const status = this.providers.get(providerId);
    if (!status) return false;

    const now = Date.now();

    if (status.state === 'CLOSED') {
      return true;
    }

    if (status.state === 'OPEN') {
      if (now - status.lastFailureTime >= this.config.recoveryTimeoutMs) {
        status.state = 'HALF_OPEN';
        circuitStateGauge.set({ provider: providerId }, 1);
        return true;
      }
      return false;
    }

    if (status.state === 'HALF_OPEN') {
      return true;
    }

    return false;
  }

  public recordSuccess(providerId: string): void {
    const status = this.providers.get(providerId);
    if (!status) return;

    status.state = 'CLOSED';
    status.consecutiveFailures = 0;
    status.lastSuccessTime = Date.now();
    circuitStateGauge.set({ provider: providerId }, 0);
  }

  public recordFailure(providerId: string): void {
    const status = this.providers.get(providerId);
    if (!status) return;

    status.consecutiveFailures += 1;
    status.lastFailureTime = Date.now();

    if (
      status.state === 'HALF_OPEN' ||
      status.consecutiveFailures >= this.config.failureThreshold
    ) {
      status.state = 'OPEN';
      circuitStateGauge.set({ provider: providerId }, 2);
    }
  }

  public reset(providerId?: string): void {
    if (providerId) {
      const status = this.providers.get(providerId);
      if (status) {
        status.state = 'CLOSED';
        status.consecutiveFailures = 0;
        circuitStateGauge.set({ provider: providerId }, 0);
      }
    } else {
      for (const [id, status] of this.providers.entries()) {
        status.state = 'CLOSED';
        status.consecutiveFailures = 0;
        circuitStateGauge.set({ provider: id }, 0);
      }
    }
  }
}
