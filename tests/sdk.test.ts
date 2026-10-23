import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { SentinelClient } from '../sdk/typescript/src/client.js';
import { redisCache } from '../src/cache/redis-cache.js';

describe('TypeScript Client SDK Integration', () => {
  let server: FastifyInstance;
  let client: SentinelClient;
  let serverUrl: string;

  beforeAll(async () => {
    server = await buildServer();
    serverUrl = await server.listen({ port: 0, host: '127.0.0.1' });
    client = new SentinelClient({
      baseUrl: serverUrl,
      tenantId: 'sdk-test-tenant',
    });
  });

  afterAll(async () => {
    await server.close();
    await redisCache.disconnect();
  });

  it('performs guardrails checks via SDK', async () => {
    const result = await client.guardrails.check({
      text: 'Seismic report for Lat 29.7604 N, Lon 95.3698 W in Eagle Ford reservoir.',
    });

    expect(result.allowed).toBe(true);
    expect(result.pii.hasPii).toBe(true);
    expect(result.sanitizedText).toContain('[REDACTED_COORDINATES]');
    expect(result.sanitizedText).toContain('[REDACTED_FORMATION]');
  });

  it('manages dynamic rules via SDK', async () => {
    // 1. Create rule
    const rule = await client.rules.create({
      name: 'SDK Dynamic Keyword Rule',
      type: 'PII',
      pattern: 'Project Orion',
      category: 'PROJECT_ORION',
      replacementToken: '[ORION_MASKED]',
    });

    expect(rule.id).toBeDefined();
    expect(rule.name).toBe('SDK Dynamic Keyword Rule');

    // 2. List rules
    const rules = await client.rules.list({ type: 'PII' });
    expect(rules.some((r) => r.id === rule.id)).toBe(true);

    // 3. Verify guardrails check detects it
    const check = await client.guardrails.check({
      text: 'Confidential file on Project Orion today.',
    });
    expect(check.sanitizedText).toContain('[ORION_MASKED]');

    // 4. Delete rule
    const deleted = await client.rules.delete(rule.id);
    expect(deleted).toBe(true);
  });

  it('fetches compliance audit reports in JSON and CSV format via SDK', async () => {
    const jsonReport = await client.compliance.getReport('json');
    expect(jsonReport.reportId).toBeDefined();
    expect(jsonReport.cryptographicSeal).toMatch(/^sha256:/);

    const csvReport = await client.compliance.getReport('csv');
    expect(typeof csvReport).toBe('string');
    expect(csvReport).toContain('# AI GATEWAY SENTINEL COMPLIANCE & SECURITY AUDIT EXPORT');
  });
});
