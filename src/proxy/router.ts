import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { config } from '../config/env.js';
import { sanitizeChatRequestBody, evaluateGuardrails } from '../guardrails/index.js';
import { forwardChatCompletion } from './upstream.js';
import { register } from '../metrics/prometheus.js';
import { redisCache } from '../cache/redis-cache.js';
import { tenantBudgetManager } from '../quota/budget-manager.js';
import { TenantQuotaPolicy } from '../quota/types.js';
import { providerDispatcher } from '../resilience/provider-dispatcher.js';
import { modelRouter } from '../routing/model-router.js';
import { apiKeyManager } from '../auth/key-manager.js';
import { CreateApiKeyRequest } from '../auth/types.js';
import { webhookDispatcher } from '../alerts/webhook-dispatcher.js';
import { tracer } from '../tracing/tracer.js';
import { getDashboardHtml } from '../dashboard/html.js';

export async function proxyRoutes(
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {
  // 1. Health & Readiness Probes
  fastify.get('/health', async (_req, reply) => {
    return reply.code(200).send({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      version: '1.0.0',
    });
  });

  fastify.get('/ready', async (_req, reply) => {
    const redisHealthy = redisCache.isHealthy();
    return reply.code(200).send({
      status: 'ready',
      dependencies: {
        redis: config.REDIS_ENABLED ? (redisHealthy ? 'up' : 'degraded') : 'disabled',
        upstream: config.UPSTREAM_LLM_URL,
      },
    });
  });

  // Embedded Admin Dashboard UI
  fastify.get('/dashboard', async (_req, reply) => {
    reply.type('text/html; charset=utf-8');
    return reply.code(200).send(getDashboardHtml());
  });

  fastify.get('/admin', async (_req, reply) => {
    return reply.redirect('/dashboard');
  });

  // 2. Prometheus /metrics Endpoint
  fastify.get('/metrics', async (_req, reply) => {
    const metrics = await register.metrics();
    reply.header('Content-Type', register.contentType);
    return reply.code(200).send(metrics);
  });

  // 3. Models List
  fastify.get('/v1/models', async (_req, reply) => {
    return reply.code(200).send({
      object: 'list',
      data: [
        { id: 'sentinel-auto', object: 'model', owned_by: 'sentinel-router' },
        { id: 'sentinel-cost-optimized', object: 'model', owned_by: 'sentinel-router' },
        { id: 'gpt-4o', object: 'model', owned_by: 'openai' },
        { id: 'gpt-4o-mini', object: 'model', owned_by: 'openai' },
        { id: 'claude-3-5-sonnet', object: 'model', owned_by: 'anthropic' },
        { id: 'meta-llama/llama-3.1-70b-instruct', object: 'model', owned_by: 'meta' },
        { id: 'mistralai/mixtral-8x7b-instruct', object: 'model', owned_by: 'mistral' },
      ],
    });
  });

  // Providers & Resiliency Health Endpoint
  fastify.get('/v1/providers', async (_req, reply) => {
    const statuses = providerDispatcher.circuitBreaker.getAllStatuses();
    return reply.code(200).send({
      object: 'list',
      data: statuses.map((s) => ({
        id: s.target.id,
        name: s.target.name,
        url: s.target.url,
        priority: s.target.priority,
        circuitState: s.state,
        consecutiveFailures: s.consecutiveFailures,
        lastFailureTime: s.lastFailureTime ? new Date(s.lastFailureTime).toISOString() : null,
        lastSuccessTime: s.lastSuccessTime ? new Date(s.lastSuccessTime).toISOString() : null,
      })),
    });
  });

  // API Key Management Endpoints (RBAC)
  fastify.post<{ Body: CreateApiKeyRequest }>('/v1/keys', async (req, reply) => {
    const body = req.body;
    if (!body || !body.name || !body.tenant) {
      return reply.code(400).send({
        error: { message: 'Body must include "name" and "tenant" fields' },
      });
    }

    const created = apiKeyManager.createKey(body);
    return reply.code(201).send({
      message: 'API key created successfully. Store this secret safely; it will not be displayed again.',
      apiKey: created.apiKey,
      metadata: created.metadata,
    });
  });

  fastify.get('/v1/keys', async (_req, reply) => {
    const keys = apiKeyManager.listKeys();
    return reply.code(200).send({
      object: 'list',
      data: keys,
    });
  });

  fastify.delete<{ Params: { id: string } }>('/v1/keys/:id', async (req, reply) => {
    const success = apiKeyManager.revokeKey(req.params.id);
    if (!success) {
      return reply.code(404).send({
        error: { message: `Key with ID '${req.params.id}' not found` },
      });
    }
    return reply.code(200).send({
      message: `API key '${req.params.id}' revoked successfully`,
    });
  });

  // 4. Pre-Flight Guardrails Inspection Endpoint
  fastify.post<{ Body: { text: string; blockOnPii?: boolean; threshold?: number } }>(
    '/v1/guardrails/check',
    async (req, reply) => {
      const { text, blockOnPii, threshold } = req.body || {};
      if (!text || typeof text !== 'string') {
        return reply.code(400).send({
          error: { message: 'Body must contain a valid string "text" property' },
        });
      }

      const tenant =
        (req.headers[config.TENANT_HEADER_NAME] as string) || 'default';

      const result = evaluateGuardrails(text, {
        blockOnPii: blockOnPii ?? config.GUARDRAILS_BLOCK_ON_PII,
        injectionThreshold: threshold ?? config.GUARDRAILS_INJECTION_THRESHOLD,
        tenant,
      });

      return reply.code(200).send({
        allowed: result.allowed,
        blockedReason: result.blockedReason || null,
        injection: {
          isInjection: result.injectionResult.isInjection,
          score: result.injectionResult.score,
          matchedRules: result.injectionResult.matchedRules,
        },
        pii: {
          hasPii: result.piiResult.hasPii,
          counts: result.piiResult.counts,
          violations: result.piiResult.violations.map((v) => ({
            category: v.category,
            matchedText: v.matchedText,
            replacementToken: v.replacementToken,
          })),
        },
        sanitizedText: result.transformedContent,
        evaluationDurationMs: Math.round(result.evaluationDurationMs * 100) / 100,
      });
    }
  );

  // Security Alerts & SIEM Incidents Log Endpoint
  fastify.get('/v1/alerts', async (_req, reply) => {
    const alerts = webhookDispatcher.getRecentAlerts();
    return reply.code(200).send({
      object: 'list',
      data: alerts,
      count: alerts.length,
    });
  });

  // Distributed Tracing Spans Endpoint
  fastify.get('/v1/traces', async (_req, reply) => {
    const spans = tracer.getRecentSpans();
    return reply.code(200).send({
      object: 'list',
      data: spans,
      count: spans.length,
    });
  });

  // 5. Quota & Budget Management Endpoints
  fastify.get('/v1/quotas', async (req, reply) => {
    const tenant =
      (req.headers[config.TENANT_HEADER_NAME] as string) || 'default';
    const policy = tenantBudgetManager.getPolicy(tenant);
    const spend = await tenantBudgetManager.getSpend(tenant);
    const check = await tenantBudgetManager.checkBudget(tenant);

    return reply.code(200).send({
      tenant,
      policy,
      spend,
      status: {
        allowed: check.allowed,
        softLimitExceeded: check.softLimitExceeded,
        percentConsumed: check.percentConsumed,
        message: check.message || 'Within quota parameters',
      },
    });
  });

  fastify.post<{ Body: TenantQuotaPolicy }>('/v1/quotas', async (req, reply) => {
    const policy = req.body;
    if (!policy || !policy.tenant || typeof policy.dailyBudgetUSD !== 'number') {
      return reply.code(400).send({
        error: { message: 'Body must include tenant and dailyBudgetUSD number' },
      });
    }

    tenantBudgetManager.setPolicy({
      tenant: policy.tenant,
      dailyBudgetUSD: policy.dailyBudgetUSD,
      monthlyBudgetUSD: policy.monthlyBudgetUSD ?? policy.dailyBudgetUSD * 20,
      softLimitPercent: policy.softLimitPercent ?? 0.8,
      actionOnExceed: policy.actionOnExceed ?? 'block',
    });

    return reply.code(200).send({
      message: `Quota policy updated for tenant '${policy.tenant}'`,
      policy: tenantBudgetManager.getPolicy(policy.tenant),
    });
  });

  // 6. OpenAI Chat Completions Proxy with Guardrails & FinOps
  fastify.post<{ Body: Record<string, any> }>(
    '/v1/chat/completions',
    async (req, reply) => {
      const tenant =
        (req.headers[config.TENANT_HEADER_NAME] as string) || 'default';

      if (!req.body || typeof req.body !== 'object') {
        return reply.code(400).send({
          error: {
            message: 'Invalid JSON request body for chat completion',
            type: 'invalid_request_error',
            code: 'bad_request',
          },
        });
      }

      // Check Tenant Budget Quota Limits
      const quotaResult = await tenantBudgetManager.checkBudget(tenant);
      if (!quotaResult.allowed) {
        webhookDispatcher.emitAlert({
          severity: 'HIGH',
          eventType: 'BUDGET_DEPLETION',
          title: `Tenant Budget Limit Depleted: ${tenant}`,
          tenant,
          details: {
            currentSpendUSD: quotaResult.currentSpendUSD,
            budgetCapUSD: quotaResult.budgetCapUSD,
            period: quotaResult.period,
          },
        });

        return reply.code(429).send({
          error: {
            message: quotaResult.message,
            type: 'insufficient_quota',
            code: 'budget_limit_exceeded',
            details: {
              currentSpendUSD: quotaResult.currentSpendUSD,
              budgetCapUSD: quotaResult.budgetCapUSD,
              period: quotaResult.period,
            },
          },
        });
      }

      if (quotaResult.softLimitExceeded && quotaResult.message) {
        reply.header('x-sentinel-budget-warning', quotaResult.message);
      }

      // Intelligent Model Routing & Cost Optimization
      const requestedModel = req.body.model || config.DEFAULT_MODEL;
      const routingDecision = modelRouter.routeModel(
        requestedModel,
        req.body.messages || req.body.prompt
      );
      req.body.model = routingDecision.selectedModel;

      // Validate model permissions against API Key metadata if authenticated via key
      const keyMetadata = (req as any).keyMetadata;
      if (keyMetadata && !apiKeyManager.isModelAllowed(keyMetadata, req.body.model)) {
        return reply.code(403).send({
          error: {
            message: `Model '${req.body.model}' is not permitted under this API key's allowed scopes (${keyMetadata.allowedModels.join(', ')})`,
            type: 'permission_denied',
            code: 'model_not_allowed',
          },
        });
      }

      if (modelRouter.isAutoRoutingModel(requestedModel)) {
        reply.header('x-sentinel-routed-model', routingDecision.selectedModel);
        reply.header('x-sentinel-routing-tier', routingDecision.tier);
        reply.header(
          'x-sentinel-routing-savings-pct',
          routingDecision.estimatedSavingsPct.toString()
        );
      }

      // Execute Guardrails: Prompt Injection Check + Sensitive Operational PII Scrubbing
      const guardrailResult = sanitizeChatRequestBody(req.body, {
        enabled: config.GUARDRAILS_ENABLED,
        blockOnPii: config.GUARDRAILS_BLOCK_ON_PII,
        injectionThreshold: config.GUARDRAILS_INJECTION_THRESHOLD,
        tenant,
      });

      // If blocked by security guardrails
      if (!guardrailResult.allowed) {
        return reply.code(403).send({
          error: {
            message: guardrailResult.blockedReason,
            type: 'guardrail_violation',
            code: 'security_policy_violation',
            violations: guardrailResult.violations,
          },
        });
      }

      // Header denoting if prompt redaction took place
      if (guardrailResult.hasRedactions) {
        reply.header('x-sentinel-guardrails-scrubbed', 'true');
      }

      // Forward sanitized prompt to upstream LLM
      return forwardChatCompletion(
        req,
        reply,
        guardrailResult.sanitizedBody,
        tenant,
        guardrailResult.session
      );
    }
  );
}
