import { describe, it, expect, beforeEach } from 'vitest';
import { DistributedTracer } from '../src/tracing/tracer.js';
import { buildServer } from '../src/server.js';
import { redisCache } from '../src/cache/redis-cache.js';

describe('OpenTelemetry: Distributed Tracing & W3C TraceContext', () => {
  let tracer: DistributedTracer;

  beforeEach(() => {
    tracer = new DistributedTracer();
  });

  it('should generate valid 32-hex traceId and 16-hex spanId', () => {
    const ctx = tracer.parseOrCreateContext();

    expect(ctx.traceId).toMatch(/^[a-f0-9]{32}$/);
    expect(ctx.spanId).toMatch(/^[a-f0-9]{16}$/);
    expect(ctx.traceparent).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);
  });

  it('should propagate existing W3C traceparent headers', () => {
    const parentHeader = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const ctx = tracer.parseOrCreateContext(parentHeader);

    expect(ctx.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(ctx.parentSpanId).toBe('00f067aa0ba902b7');
    expect(ctx.spanId).not.toBe('00f067aa0ba902b7'); // Child span gets a fresh spanId
  });

  it('should record internal span timings and attributes', () => {
    const ctx = tracer.parseOrCreateContext();
    const span = tracer.startSpan('guardrail_evaluation', ctx, { check: 'pii' });

    const record = span.end('OK', { redactedCount: 2 });
    expect(record.name).toBe('guardrail_evaluation');
    expect(record.durationMs).toBeGreaterThanOrEqual(0);
    expect(record.attributes.redactedCount).toBe(2);

    const spans = tracer.getRecentSpans();
    expect(spans.length).toBe(1);
  });
});

describe('Integration: Tracing Headers & Spans Endpoint', () => {
  it('should attach W3C traceparent and x-sentinel-trace-id to all HTTP responses', async () => {
    const server = await buildServer();

    const res = await server.inject({
      method: 'GET',
      url: '/health',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers).toHaveProperty('traceparent');
    expect(res.headers['traceparent']).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);
    expect(res.headers).toHaveProperty('x-sentinel-trace-id');

    await server.close();
    await redisCache.disconnect();
  });

  it('should propagate incoming traceparent across the gateway', async () => {
    const server = await buildServer();
    const traceId = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    const traceparent = `00-${traceId}-1122334455667788-01`;

    const res = await server.inject({
      method: 'GET',
      url: '/ready',
      headers: { traceparent },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-sentinel-trace-id']).toBe(traceId);
    expect(res.headers['traceparent']).toContain(traceId);

    await server.close();
    await redisCache.disconnect();
  });

  it('GET /v1/traces should return recent trace spans', async () => {
    const server = await buildServer();

    const res = await server.inject({
      method: 'GET',
      url: '/v1/traces',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.object).toBe('list');
    expect(body).toHaveProperty('data');

    await server.close();
    await redisCache.disconnect();
  });
});
