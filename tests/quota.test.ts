import { describe, it, expect, beforeEach } from 'vitest';
import { tenantBudgetManager } from '../src/quota/budget-manager.js';
import { register } from '../src/metrics/prometheus.js';
import { buildServer } from '../src/server.js';
import { redisCache } from '../src/cache/redis-cache.js';

describe('FinOps: Tenant Budget Quotas & Enforcement', () => {
  beforeEach(() => {
    tenantBudgetManager.clearSpend();
  });

  it('should initialize and return default policy for unconfigured tenants', () => {
    const policy = tenantBudgetManager.getPolicy('new-exploration-team');
    expect(policy.tenant).toBe('new-exploration-team');
    expect(policy.dailyBudgetUSD).toBeGreaterThan(0);
    expect(policy.monthlyBudgetUSD).toBeGreaterThan(0);
    expect(policy.softLimitPercent).toBe(0.8);
    expect(policy.actionOnExceed).toBe('block');
  });

  it('should allow setting custom tenant budget policies', () => {
    tenantBudgetManager.setPolicy({
      tenant: 'geophysics-pilot',
      dailyBudgetUSD: 5.0,
      monthlyBudgetUSD: 100.0,
      softLimitPercent: 0.75,
      actionOnExceed: 'block',
    });

    const retrieved = tenantBudgetManager.getPolicy('geophysics-pilot');
    expect(retrieved.dailyBudgetUSD).toBe(5.0);
    expect(retrieved.softLimitPercent).toBe(0.75);
  });

  it('should track cumulative daily and monthly spend', async () => {
    const tenant = 'analytics-dept';
    await tenantBudgetManager.recordSpend(tenant, 1.25);
    await tenantBudgetManager.recordSpend(tenant, 0.75);

    const spend = await tenantBudgetManager.getSpend(tenant);
    expect(spend.spentToday).toBe(2.0);
    expect(spend.spentThisMonth).toBe(2.0);
  });

  it('should flag soft limit warning when spend reaches threshold percentage', async () => {
    const tenant = 'ops-monitoring';
    tenantBudgetManager.setPolicy({
      tenant,
      dailyBudgetUSD: 10.0,
      monthlyBudgetUSD: 200.0,
      softLimitPercent: 0.8,
      actionOnExceed: 'block',
    });

    // Spend $8.20 (82% of $10 limit)
    await tenantBudgetManager.recordSpend(tenant, 8.2);

    const check = await tenantBudgetManager.checkBudget(tenant);
    expect(check.allowed).toBe(true);
    expect(check.softLimitExceeded).toBe(true);
    expect(check.percentConsumed).toBe(82);
    expect(check.message).toContain('reached 82% of its budget cap');
  });

  it('should block requests with quota exceeded when hard limit is breached', async () => {
    const tenant = 'overspending-app';
    tenantBudgetManager.setPolicy({
      tenant,
      dailyBudgetUSD: 2.0,
      monthlyBudgetUSD: 50.0,
      softLimitPercent: 0.8,
      actionOnExceed: 'block',
    });

    // Spend $2.50 (exceeds $2.00 limit)
    await tenantBudgetManager.recordSpend(tenant, 2.5);

    const check = await tenantBudgetManager.checkBudget(tenant);
    expect(check.allowed).toBe(false);
    expect(check.message).toContain('Daily budget quota exceeded');

    const metricsOutput = await register.metrics();
    expect(metricsOutput).toContain('ai_gateway_quota_blocks_total');
  });
});

describe('Integration: Quota API & Endpoints', () => {
  beforeEach(() => {
    tenantBudgetManager.clearSpend();
  });

  it('GET /v1/quotas should return current spend and status', async () => {
    const server = await buildServer();
    const res = await server.inject({
      method: 'GET',
      url: '/v1/quotas',
      headers: { 'x-tenant-id': 'reservoir-team' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.tenant).toBe('reservoir-team');
    expect(body.status.allowed).toBe(true);
    expect(body).toHaveProperty('spend');
    expect(body).toHaveProperty('policy');

    await server.close();
    await redisCache.disconnect();
  });

  it('POST /v1/chat/completions should return 429 when tenant budget is depleted', async () => {
    const server = await buildServer();
    const tenant = 'depleted-budget-client';

    tenantBudgetManager.setPolicy({
      tenant,
      dailyBudgetUSD: 1.0,
      monthlyBudgetUSD: 20.0,
      softLimitPercent: 0.8,
      actionOnExceed: 'block',
    });

    // Deplete budget
    await tenantBudgetManager.recordSpend(tenant, 1.5);

    const res = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': tenant,
      },
      payload: {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Execute simulation run' }],
      },
    });

    expect(res.statusCode).toBe(429);
    const body = JSON.parse(res.body);
    expect(body.error.type).toBe('insufficient_quota');
    expect(body.error.code).toBe('budget_limit_exceeded');

    await server.close();
    await redisCache.disconnect();
  });
});
