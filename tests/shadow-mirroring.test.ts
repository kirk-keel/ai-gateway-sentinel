import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { redisCache } from '../src/cache/redis-cache.js';
import { trafficMirror } from '../src/mirroring/traffic-mirror.js';

describe('Shadow Traffic Mirroring & A/B Model Drift Analysis', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    trafficMirror.clear();
    app = await buildServer();
  });

  afterEach(async () => {
    await app.close();
    await redisCache.disconnect();
  });

  it('updates and retrieves shadow mirroring configuration', async () => {
    const postRes = await app.inject({
      method: 'POST',
      url: '/v1/shadow/config',
      payload: {
        enabled: true,
        sampleRatePct: 50,
        targetModel: 'claude-3-5-sonnet',
        divergenceThreshold: 0.8,
      },
    });

    expect(postRes.statusCode).toBe(200);
    const body = JSON.parse(postRes.payload);
    expect(body.config.enabled).toBe(true);
    expect(body.config.sampleRatePct).toBe(50);
    expect(body.config.targetModel).toBe('claude-3-5-sonnet');

    const getRes = await app.inject({
      method: 'GET',
      url: '/v1/shadow/config',
    });
    expect(getRes.statusCode).toBe(200);
    const getBody = JSON.parse(getRes.payload);
    expect(getBody.targetModel).toBe('claude-3-5-sonnet');
  });

  it('executes shadow mirroring and calculates similarity and divergence', async () => {
    trafficMirror.setConfig({
      enabled: true,
      sampleRatePct: 100,
      targetModel: 'gpt-4o-mini',
      divergenceThreshold: 0.85,
    });

    // Mock fetch to simulate shadow upstream response
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-shadow-123',
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Seismic velocity analysis delineates formation boundaries effectively.',
              },
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 15 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });

    try {
      const result = await trafficMirror.mirrorRequest(
        { model: 'gpt-4o', messages: [{ role: 'user', content: 'Explain seismic analysis' }] },
        {
          content: 'Seismic velocity analysis is used to map formation boundaries in reservoirs.',
          model: 'gpt-4o',
          latencyMs: 150,
          costUSD: 0.0005,
          traceId: 'trace-test-123',
        }
      );

      expect(result).not.toBeNull();
      expect(result?.mirrored).toBe(true);
      expect(result?.primaryModel).toBe('gpt-4o');
      expect(result?.shadowModel).toBe('gpt-4o-mini');
      expect(result?.similarityScore).toBeGreaterThan(0.5);
      expect(result?.shadowCostUSD).toBeDefined();

      const summary = trafficMirror.getMetricsSummary();
      expect(summary.totalMirrored).toBe(1);
      expect(summary.averageSimilarity).toBeGreaterThan(0.5);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
