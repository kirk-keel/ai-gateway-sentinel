import { describe, it, expect, beforeEach } from 'vitest';
import { WebhookDispatcher } from '../src/alerts/webhook-dispatcher.js';
import { register } from '../src/metrics/prometheus.js';
import { buildServer } from '../src/server.js';
import { redisCache } from '../src/cache/redis-cache.js';

describe('SIEM & Security Webhooks: Alert Dispatcher', () => {
  let dispatcher: WebhookDispatcher;

  beforeEach(() => {
    dispatcher = new WebhookDispatcher({
      enabled: false, // Don't make real network calls in unit tests
      minimumSeverity: 'MEDIUM',
    });
  });

  it('should buffer emitted security alerts and generate event IDs', async () => {
    const alert = await dispatcher.emitAlert({
      severity: 'CRITICAL',
      eventType: 'PROMPT_INJECTION',
      title: 'DAN Jailbreak Attack Intercepted',
      tenant: 'external-client',
      details: { score: 0.95, rules: ['NEW_SYSTEM_ROLE_ASSIGNMENT'] },
    });

    expect(alert).not.toBeNull();
    expect(alert?.eventId).toMatch(/^alert_[a-f0-9]{16}$/);
    expect(alert?.timestamp).toBeDefined();

    const recent = dispatcher.getRecentAlerts();
    expect(recent.length).toBe(1);
    expect(recent[0].title).toBe('DAN Jailbreak Attack Intercepted');
  });

  it('should increment Prometheus security alerts counter', async () => {
    await dispatcher.emitAlert({
      severity: 'HIGH',
      eventType: 'BUDGET_DEPLETION',
      title: 'Monthly budget cap depleted',
      tenant: 'marketing-analytics',
      details: { currentSpendUSD: 50.2, capUSD: 50.0 },
    });

    const metricsOutput = await register.metrics();
    expect(metricsOutput).toContain('ai_gateway_security_alerts_total');
  });
});

describe('Integration: Alerts Endpoint', () => {
  it('GET /v1/alerts should return list of security incidents', async () => {
    const server = await buildServer();

    const res = await server.inject({
      method: 'GET',
      url: '/v1/alerts',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.object).toBe('list');
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('count');

    await server.close();
    await redisCache.disconnect();
  });
});
