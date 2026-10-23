import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { redisCache } from '../src/cache/redis-cache.js';
import { tenantBudgetManager } from '../src/quota/budget-manager.js';

describe('Compliance Audit Report Generator', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    tenantBudgetManager.clearSpend();
    app = await buildServer();
    tenantBudgetManager.setPolicy({
      tenant: 'audit-corp',
      dailyBudgetUSD: 50.0,
      monthlyBudgetUSD: 1000.0,
      softLimitPercent: 0.8,
      actionOnExceed: 'block',
    });
    await tenantBudgetManager.recordSpend('audit-corp', 12.34);
  });

  afterEach(async () => {
    await app.close();
    await redisCache.disconnect();
  });

  it('generates a full SOC2 / HIPAA / ISO27001 audit report in JSON format with SHA-256 seal', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/compliance/report',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);

    expect(body.reportId).toMatch(/^rep_[0-9a-f]{16}$/);
    expect(body.gatewayVersion).toBe('1.0.0');
    expect(body.complianceFrameworks).toContain('SOC2_TYPE_II');
    expect(body.complianceFrameworks).toContain('HIPAA_BAA');
    expect(body.securityPosture.zeroPiiLeakageGuarantee).toBe(true);
    expect(body.securityPosture.guardrailsEnabled).toBe(true);
    expect(body.securityPosture.piiCategoriesMonitored.length).toBeGreaterThan(0);

    // Resilience posture
    expect(body.resiliencePosture.providers.length).toBeGreaterThan(0);
    expect(body.resiliencePosture.routingStrategy).toBeDefined();

    // Financial posture
    const corpLedger = body.financialPosture.tenantLedgers.find((l: any) => l.tenant === 'audit-corp');
    expect(corpLedger).toBeDefined();
    expect(corpLedger.spentTodayUSD).toBe(12.34);

    // Cryptographic seal
    expect(body.cryptographicSeal).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('exports compliance report in CSV format', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/compliance/report?format=csv',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('.csv');

    const csvText = res.payload;
    expect(csvText).toContain('# AI GATEWAY SENTINEL COMPLIANCE & SECURITY AUDIT EXPORT');
    expect(csvText).toContain('Cryptographic Seal,sha256:');
    expect(csvText).toContain('# TENANT FINANCIAL & QUOTA AUDIT LEDGER');
    expect(csvText).toContain('"audit-corp",50,12.34,1000,12.34,"block"');
    expect(csvText).toContain('# UPSTREAM PROVIDERS & RESILIENCE AUDIT');
  });
});
