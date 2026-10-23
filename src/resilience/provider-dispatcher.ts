import { config } from '../config/env.js';
import {
  failoverCounter,
  providerRequestsCounter,
} from '../metrics/prometheus.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { ProviderRoutingStrategy, ProviderTarget } from './types.js';

export interface DispatchResult {
  response: Response;
  activeProvider: ProviderTarget;
  failoverOccurred: boolean;
  attemptedProviders: string[];
}

export class ProviderDispatcher {
  public circuitBreaker: CircuitBreaker;
  private providers: ProviderTarget[] = [];
  private routingStrategy: ProviderRoutingStrategy = 'priority';

  constructor() {
    this.circuitBreaker = new CircuitBreaker();

    // Default primary provider from environment
    this.registerProvider({
      id: 'primary-upstream',
      name: 'Primary Upstream LLM',
      url: config.UPSTREAM_LLM_URL,
      apiKey: config.UPSTREAM_API_KEY,
      priority: 1,
      timeoutMs: 15000,
    });
  }

  public registerProvider(provider: ProviderTarget): void {
    // Replace if exists, otherwise append
    const idx = this.providers.findIndex((p) => p.id === provider.id);
    if (idx >= 0) {
      this.providers[idx] = provider;
    } else {
      this.providers.push(provider);
    }

    this.providers.sort((a, b) => a.priority - b.priority);
    this.circuitBreaker.registerProvider(provider);
  }

  public clearProviders(): void {
    this.providers = [];
  }

  public setRoutingStrategy(strategy: ProviderRoutingStrategy): void {
    this.routingStrategy = strategy;
  }

  public getRoutingStrategy(): ProviderRoutingStrategy {
    return this.routingStrategy;
  }

  public getProviders(): ProviderTarget[] {
    return [...this.providers];
  }

  public getCandidateProviders(): ProviderTarget[] {
    const available = this.providers.filter((p) => this.circuitBreaker.canExecute(p.id));
    if (available.length <= 1) return available;

    if (this.routingStrategy === 'latency') {
      return [...available].sort((a, b) => {
        const latA = this.circuitBreaker.getProviderStatus(a.id)?.emaLatencyMs ?? 999999;
        const latB = this.circuitBreaker.getProviderStatus(b.id)?.emaLatencyMs ?? 999999;
        if (latA !== latB) return latA - latB;
        return a.priority - b.priority;
      });
    }

    if (this.routingStrategy === 'weighted') {
      const totalWeight = available.reduce((sum, p) => sum + (p.weight ?? 1), 0);
      let rand = Math.random() * totalWeight;
      let selectedIndex = 0;
      for (let i = 0; i < available.length; i++) {
        rand -= available[i].weight ?? 1;
        if (rand <= 0) {
          selectedIndex = i;
          break;
        }
      }
      const selected = available[selectedIndex];
      const others = available.filter((_, idx) => idx !== selectedIndex);
      return [selected, ...others];
    }

    // Default 'priority'
    return [...available].sort((a, b) => a.priority - b.priority);
  }

  public async dispatchChatCompletion(
    payload: Record<string, any>,
    clientAuthHeader?: string
  ): Promise<DispatchResult> {
    const attemptedProviders: string[] = [];
    let lastError: Error | null = null;
    let lastResponse: Response | null = null;
    let failoverOccurred = false;

    const candidateProviders = this.getCandidateProviders();

    for (let i = 0; i < candidateProviders.length; i++) {
      const provider = candidateProviders[i];

      // Re-verify circuit breaker state
      if (!this.circuitBreaker.canExecute(provider.id)) {
        continue;
      }

      attemptedProviders.push(provider.id);
      if (attemptedProviders.length > 1) {
        failoverOccurred = true;
      }

      const url = `${provider.url.replace(/\/+$/, '')}/chat/completions`;
      const headers: Record<string, string> = {
        'content-type': 'application/json',
      };

      if (provider.apiKey) {
        headers['authorization'] = `Bearer ${provider.apiKey}`;
      } else if (clientAuthHeader) {
        headers['authorization'] = clientAuthHeader;
      }

      const timeoutMs = provider.timeoutMs || 15000;
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
      const callStartTime = Date.now();

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutHandle);
        const durationMs = Date.now() - callStartTime;

        // If provider returned 5xx server error or 429 rate limit, treat as failure and failover
        if (response.status >= 500 || response.status === 429) {
          this.circuitBreaker.recordFailure(provider.id);
          providerRequestsCounter.inc({
            provider: provider.id,
            status: response.status.toString(),
          });
          lastResponse = response;

          // Track failover to next provider if available
          const nextProvider = candidateProviders[i + 1];
          if (nextProvider) {
            failoverCounter.inc({
              from_provider: provider.id,
              to_provider: nextProvider.id,
            });
          }
          continue;
        }

        // Success!
        this.circuitBreaker.recordSuccess(provider.id, durationMs);
        providerRequestsCounter.inc({
          provider: provider.id,
          status: response.status.toString(),
        });

        return {
          response,
          activeProvider: provider,
          failoverOccurred,
          attemptedProviders,
        };
      } catch (err: any) {
        clearTimeout(timeoutHandle);
        this.circuitBreaker.recordFailure(provider.id);
        providerRequestsCounter.inc({
          provider: provider.id,
          status: err.name === 'AbortError' ? 'timeout' : 'error',
        });
        lastError = err;

        const nextProvider = candidateProviders[i + 1];
        if (nextProvider) {
          failoverCounter.inc({
            from_provider: provider.id,
            to_provider: nextProvider.id,
          });
        }
      }
    }

    if (lastResponse) {
      return {
        response: lastResponse,
        activeProvider: this.providers[this.providers.length - 1],
        failoverOccurred: attemptedProviders.length > 1,
        attemptedProviders,
      };
    }

    throw (
      lastError ||
      new Error(
        `All upstream LLM providers failed or circuits are open (attempted: ${attemptedProviders.join(', ')})`
      )
    );
  }
}

export const providerDispatcher = new ProviderDispatcher();
