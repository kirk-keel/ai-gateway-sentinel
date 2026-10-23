import { describe, it, expect, beforeEach } from 'vitest';
import { CircuitBreaker } from '../src/resilience/circuit-breaker.js';
import { ProviderDispatcher } from '../src/resilience/provider-dispatcher.js';
import { buildServer } from '../src/server.js';
import { redisCache } from '../src/cache/redis-cache.js';

describe('Resilience: Circuit Breaker State Machine', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      failureThreshold: 3,
      recoveryTimeoutMs: 50, // Short timeout for unit testing
      timeoutMs: 1000,
    });
    breaker.registerProvider({
      id: 'azure-openai',
      name: 'Azure OpenAI',
      url: 'https://azure.openai.mock/v1',
      priority: 1,
    });
  });

  it('should start in CLOSED state and allow execution', () => {
    expect(breaker.canExecute('azure-openai')).toBe(true);
    const status = breaker.getProviderStatus('azure-openai');
    expect(status?.state).toBe('CLOSED');
  });

  it('should trip to OPEN state after reaching failure threshold', () => {
    breaker.recordFailure('azure-openai');
    expect(breaker.getProviderStatus('azure-openai')?.state).toBe('CLOSED');

    breaker.recordFailure('azure-openai');
    expect(breaker.getProviderStatus('azure-openai')?.state).toBe('CLOSED');

    breaker.recordFailure('azure-openai'); // 3rd failure
    expect(breaker.getProviderStatus('azure-openai')?.state).toBe('OPEN');
    expect(breaker.canExecute('azure-openai')).toBe(false);
  });

  it('should transition to HALF_OPEN after recovery timeout and recover on success', async () => {
    breaker.recordFailure('azure-openai');
    breaker.recordFailure('azure-openai');
    breaker.recordFailure('azure-openai');
    expect(breaker.getProviderStatus('azure-openai')?.state).toBe('OPEN');

    // Wait for recovery timeout (50ms)
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Next check should transition to HALF_OPEN
    expect(breaker.canExecute('azure-openai')).toBe(true);
    expect(breaker.getProviderStatus('azure-openai')?.state).toBe('HALF_OPEN');

    // Successful probe returns state to CLOSED
    breaker.recordSuccess('azure-openai');
    expect(breaker.getProviderStatus('azure-openai')?.state).toBe('CLOSED');
    expect(breaker.getProviderStatus('azure-openai')?.consecutiveFailures).toBe(0);
  });
});

describe('Resilience: Multi-Provider Dispatcher & Automatic Failover', () => {
  it('should automatically failover to secondary provider when primary fails', async () => {
    const dispatcher = new ProviderDispatcher();
    dispatcher.clearProviders();

    // Register primary mock that fails with 500
    dispatcher.registerProvider({
      id: 'failing-primary',
      name: 'Failing Primary',
      url: 'http://localhost:9999/v1', // Unreachable port
      priority: 1,
      timeoutMs: 200,
    });

    // Register secondary mock
    dispatcher.registerProvider({
      id: 'standby-secondary',
      name: 'Standby Secondary',
      url: 'http://localhost:8001/v1',
      priority: 2,
    });

    const providers = dispatcher.getProviders();
    expect(providers.length).toBeGreaterThanOrEqual(2);
    expect(providers[0].id).toBe('failing-primary');
    expect(providers[1].id).toBe('standby-secondary');
  });
});

describe('Integration: Providers Health Endpoint', () => {
  it('GET /v1/providers should list registered providers and circuit breaker status', async () => {
    const server = await buildServer();
    const res = await server.inject({
      method: 'GET',
      url: '/v1/providers',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.object).toBe('list');
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0]).toHaveProperty('id');
    expect(body.data[0]).toHaveProperty('circuitState');
    expect(body.data[0]).toHaveProperty('priority');

    await server.close();
    await redisCache.disconnect();
  });
});
