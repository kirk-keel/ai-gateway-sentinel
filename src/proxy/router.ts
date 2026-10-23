import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { config } from '../config/env.js';
import { sanitizeChatRequestBody, evaluateGuardrails } from '../guardrails/index.js';
import { forwardChatCompletion } from './upstream.js';
import { register } from '../metrics/prometheus.js';
import { redisCache } from '../cache/redis-cache.js';

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
        { id: 'gpt-4o', object: 'model', owned_by: 'openai' },
        { id: 'gpt-4o-mini', object: 'model', owned_by: 'openai' },
        { id: 'claude-3-5-sonnet', object: 'model', owned_by: 'anthropic' },
        { id: 'meta-llama/llama-3.1-70b-instruct', object: 'model', owned_by: 'meta' },
        { id: 'mistralai/mixtral-8x7b-instruct', object: 'model', owned_by: 'mistral' },
      ],
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

  // 5. OpenAI Chat Completions Proxy with Guardrails & FinOps
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
        tenant
      );
    }
  );
}
