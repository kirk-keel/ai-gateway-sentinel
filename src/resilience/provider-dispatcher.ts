import { config } from '../config/env.js';
import {
  failoverCounter,
  providerRequestsCounter,
} from '../metrics/prometheus.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { ProviderTarget } from './types.js';

export interface DispatchResult {
  response: Response;
  activeProvider: ProviderTarget;
  failoverOccurred: boolean;
  attemptedProviders: string[];
}

export class ProviderDispatcher {
  public circuitBreaker: CircuitBreaker;
  private providers: ProviderTarget[] = [];

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

  public getProviders(): ProviderTarget[] {
    return [...this.providers];
  }

  public async dispatchChatCompletion(
    payload: Record<string, any>,
    clientAuthHeader?: string
  ): Promise<DispatchResult> {
    const attemptedProviders: string[] = [];
    let lastError: Error | null = null;
    let lastResponse: Response | null = null;
    let failoverOccurred = false;

    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i];

      // Check if circuit breaker allows execution
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

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutHandle);

        // If provider returned 5xx server error or 429 rate limit, treat as failure and failover
        if (response.status >= 500 || response.status === 429) {
          this.circuitBreaker.recordFailure(provider.id);
          providerRequestsCounter.inc({
            provider: provider.id,
            status: response.status.toString(),
          });
          lastResponse = response;

          // Track failover to next provider if available
          const nextProvider = this.providers[i + 1];
          if (nextProvider) {
            failoverCounter.inc({
              from_provider: provider.id,
              to_provider: nextProvider.id,
            });
          }
          continue;
        }

        // Success!
        this.circuitBreaker.recordSuccess(provider.id);
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

        const nextProvider = this.providers[i + 1];
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
