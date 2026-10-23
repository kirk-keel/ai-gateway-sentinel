import { describe, it, expect } from 'vitest';
import { buildServer } from '../src/server.js';
import { redisCache } from '../src/cache/redis-cache.js';

describe('Admin Dashboard UI: Embedded Web Console', () => {
  it('GET /dashboard should serve the management console HTML with 200 OK', async () => {
    const server = await buildServer();

    const res = await server.inject({
      method: 'GET',
      url: '/dashboard',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('AI Gateway Sentinel');
    expect(res.body).toContain('Guardrails Playground');
    expect(res.body).toContain('Providers & Circuits');
    expect(res.body).toContain('API Keys & RBAC');

    await server.close();
    await redisCache.disconnect();
  });

  it('GET /admin should redirect to /dashboard', async () => {
    const server = await buildServer();

    const res = await server.inject({
      method: 'GET',
      url: '/admin',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/dashboard');

    await server.close();
    await redisCache.disconnect();
  });
});
