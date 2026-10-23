import { FastifyReply, FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';
import { config } from '../config/env.js';
import { recordRequestUsage } from '../metrics/finops.js';
import { timeToFirstTokenHistogram } from '../metrics/prometheus.js';
import { estimateTokenCount, parseSSEEvent } from './sse-parser.js';
import { redisCache } from '../cache/redis-cache.js';
import { semanticCache } from '../cache/vector-cache.js';
import { tokenVault, StreamingRehydrator } from '../vault/token-vault.js';
import { VaultSession } from '../vault/types.js';
import { tenantBudgetManager } from '../quota/budget-manager.js';
import { providerDispatcher } from '../resilience/provider-dispatcher.js';
import { inspectModelOutput } from '../guardrails/output-guardrails.js';
import { recordGuardrailEvent } from '../metrics/finops.js';
import { trafficMirror } from '../mirroring/traffic-mirror.js';

export async function forwardChatCompletion(
  req: FastifyRequest<{ Body: Record<string, any> }>,
  reply: FastifyReply,
  sanitizedBody: Record<string, any>,
  tenant: string,
  session?: VaultSession
): Promise<void> {
  const model = sanitizedBody.model || config.DEFAULT_MODEL;
  const isStreaming = Boolean(sanitizedBody.stream);
  const cacheKey = redisCache.generateKey(model, sanitizedBody);
  const startTime = performance.now();

  // 1. Check Redis Cache for non-streaming requests
  if (!isStreaming) {
    const cached = await redisCache.get(cacheKey);
    if (cached) {
      reply.header('x-sentinel-cache', 'HIT');
      reply.header('content-type', 'application/json');
      let responseBody = cached.body;

      // Rehydrate cached response if session exists
      if (session && Object.keys(session.tokenToEntity).length > 0) {
        responseBody = JSON.parse(JSON.stringify(responseBody));
        if (Array.isArray(responseBody.choices)) {
          for (const choice of responseBody.choices) {
            if (choice.message?.content) {
              choice.message.content = tokenVault.rehydrate(
                choice.message.content,
                session
              );
            }
          }
        }
        reply.header('x-sentinel-vault-session', session.sessionId);
        reply.header(
          'x-sentinel-vault-entities',
          Object.keys(session.tokenToEntity).length.toString()
        );
      }

      return reply.code(cached.statusCode).send(responseBody);
    }

    // 1b. Check Semantic Vector Cache for conceptually similar prompts
    const promptText = Array.isArray(sanitizedBody.messages)
      ? sanitizedBody.messages.map((m: any) => m.content).join(' ')
      : (sanitizedBody.prompt || '');
    const semanticMatch = semanticCache.findSimilar(model, promptText);
    if (semanticMatch.hit && semanticMatch.entry) {
      reply.header('x-sentinel-cache', 'SEMANTIC_HIT');
      reply.header(
        'x-sentinel-semantic-similarity',
        semanticMatch.similarity.toString()
      );
      reply.header('content-type', 'application/json');

      let responseBody = semanticMatch.entry.response.body;
      if (session && Object.keys(session.tokenToEntity).length > 0) {
        responseBody = JSON.parse(JSON.stringify(responseBody));
        if (Array.isArray(responseBody.choices)) {
          for (const choice of responseBody.choices) {
            if (choice.message?.content) {
              choice.message.content = tokenVault.rehydrate(
                choice.message.content,
                session
              );
            }
          }
        }
      }

      return reply.code(semanticMatch.entry.response.statusCode).send(responseBody);
    }

    reply.header('x-sentinel-cache', 'MISS');
  } else {
    reply.header('x-sentinel-cache', 'BYPASS_STREAM');
  }

  // 2. Dispatch via Multi-Provider Dispatcher with Circuit Breaking & Fallback
  const clientAuth = req.headers['authorization'];
  let clientAuthHeader: string | undefined;
  if (config.UPSTREAM_API_KEY) {
    clientAuthHeader = `Bearer ${config.UPSTREAM_API_KEY}`;
  } else if (clientAuth && typeof clientAuth === 'string') {
    clientAuthHeader = clientAuth;
  }

  // If streaming and client didn't specify stream_options, add include_usage for exact token telemetry
  const forwardPayload = { ...sanitizedBody };
  if (isStreaming && !forwardPayload.stream_options) {
    forwardPayload.stream_options = { include_usage: true };
  }

  let dispatchResult;
  try {
    dispatchResult = await providerDispatcher.dispatchChatCompletion(
      forwardPayload,
      clientAuthHeader
    );
  } catch (err: any) {
    return reply.code(503).send({
      error: {
        message: err.message || 'All upstream LLM providers are unavailable',
        type: 'upstream_service_unavailable',
        code: 'service_unavailable',
      },
    });
  }

  const upstreamResponse = dispatchResult.response;
  if (dispatchResult.failoverOccurred) {
    reply.header('x-sentinel-failover', 'true');
  }
  reply.header('x-sentinel-active-provider', dispatchResult.activeProvider.id);

  const latencySeconds = (performance.now() - startTime) / 1000;

  // Handle upstream error response
  if (!upstreamResponse.ok) {
    const errorBody = await upstreamResponse.text();
    let parsedError;
    try {
      parsedError = JSON.parse(errorBody);
    } catch {
      parsedError = { error: { message: errorBody } };
    }

    return reply.code(upstreamResponse.status).send(parsedError);
  }

  // 3. Handle Streaming response (Server-Sent Events)
  if (isStreaming && upstreamResponse.body) {
    reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no');

    if (session && Object.keys(session.tokenToEntity).length > 0) {
      reply.raw.setHeader('x-sentinel-vault-session', session.sessionId);
      reply.raw.setHeader(
        'x-sentinel-vault-entities',
        Object.keys(session.tokenToEntity).length.toString()
      );
      await tokenVault.saveSession(session);
    }

    let firstTokenReceived = false;
    let accumulatedContent = '';
    let promptTokens = 0;
    let completionTokens = 0;

    const rehydrator =
      session && Object.keys(session.tokenToEntity).length > 0
        ? new StreamingRehydrator(session)
        : null;

    // Estimate prompt tokens if not reported
    const promptText = Array.isArray(sanitizedBody.messages)
      ? sanitizedBody.messages.map((m: any) => m.content).join(' ')
      : '';
    const estimatedPromptTokens = estimateTokenCount(promptText);

    const reader = upstreamResponse.body.getReader();
    const decoder = new TextDecoder();
    let lineBuffer = '';

    const stream = new Readable({
      async read() {
        try {
          const { done, value } = await reader.read();
          if (done) {
            // Flush any remaining buffered rehydration
            if (rehydrator) {
              const flushed = rehydrator.flush();
              if (flushed) {
                const flushChunk = {
                  id: 'chatcmpl-rehydrated-' + Date.now(),
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model,
                  choices: [{ index: 0, delta: { content: flushed }, finish_reason: null }],
                };
                this.push(Buffer.from(`data: ${JSON.stringify(flushChunk)}\n\n`));
              }
            }

            // Stream complete - finalize metrics
            const totalDurationSec = (performance.now() - startTime) / 1000;
            const finalPromptTokens = promptTokens || estimatedPromptTokens;
            const finalCompletionTokens =
              completionTokens || estimateTokenCount(accumulatedContent);

            const { costUSD } = recordRequestUsage({
              model,
              tenant,
              promptTokens: finalPromptTokens,
              completionTokens: finalCompletionTokens,
              latencySeconds: totalDurationSec,
              cached: false,
            });

            await tenantBudgetManager.recordSpend(tenant, costUSD);

            this.push(null);
            return;
          }

          const rawDecoded = decoder.decode(value, { stream: true });
          lineBuffer += rawDecoded;

          const lines = lineBuffer.split('\n');
          // Keep trailing incomplete line in buffer
          lineBuffer = lines.pop() || '';

          let streamOutput = '';
          for (const line of lines) {
            const parsed = parseSSEEvent(line);
            if (parsed) {
              if (!firstTokenReceived && (parsed.contentDelta || parsed.data)) {
                firstTokenReceived = true;
                const ttftSec = (performance.now() - startTime) / 1000;
                timeToFirstTokenHistogram.observe({ model, tenant }, ttftSec);
              }

              if (parsed.contentDelta) {
                let deltaText = parsed.contentDelta;
                if (rehydrator) {
                  deltaText = rehydrator.processChunk(deltaText);
                  if (parsed.data?.choices?.[0]?.delta) {
                    parsed.data.choices[0].delta.content = deltaText;
                  }
                }
                accumulatedContent += deltaText;
              }

              if (parsed.usage) {
                promptTokens = parsed.usage.prompt_tokens;
                completionTokens = parsed.usage.completion_tokens;
              }

              if (parsed.data && rehydrator) {
                streamOutput += `data: ${JSON.stringify(parsed.data)}\n\n`;
              } else {
                streamOutput += line + '\n';
              }
            } else if (line.trim().length > 0) {
              streamOutput += line + '\n';
            }
          }

          if (streamOutput.length > 0) {
            this.push(Buffer.from(streamOutput));
          }
        } catch (err: any) {
          this.destroy(err);
        }
      },
    });

    return reply.send(stream);
  }

  // 4. Handle Non-Streaming response
  const jsonResponse: any = await upstreamResponse.json();

  // Re-hydrate any pseudo-tokens back to original confidential entities
  if (session && Object.keys(session.tokenToEntity).length > 0) {
    if (Array.isArray(jsonResponse.choices)) {
      for (const choice of jsonResponse.choices) {
        if (choice.message?.content) {
          choice.message.content = tokenVault.rehydrate(
            choice.message.content,
            session
          );
        }
      }
    }
    await tokenVault.saveSession(session);
    reply.header('x-sentinel-vault-session', session.sessionId);
    reply.header(
      'x-sentinel-vault-entities',
      Object.keys(session.tokenToEntity).length.toString()
    );
  }

  // 5. Apply Bi-Directional Output Guardrails on upstream response
  if (Array.isArray(jsonResponse.choices)) {
    for (const choice of jsonResponse.choices) {
      if (choice.message?.content) {
        const outGuard = inspectModelOutput(choice.message.content);
        if (!outGuard.isSafe) {
          choice.message.content = outGuard.cleanText;
          reply.header('x-sentinel-output-guardrail-tripped', 'true');
          for (const viol of outGuard.violations) {
            recordGuardrailEvent(viol, 'redacted', tenant);
          }
        }
      }
    }
  }

  let promptTokens = jsonResponse.usage?.prompt_tokens ?? 0;
  let completionTokens = jsonResponse.usage?.completion_tokens ?? 0;

  // Fallback estimation if upstream omits usage block
  if (!promptTokens && !completionTokens) {
    const promptText = Array.isArray(sanitizedBody.messages)
      ? sanitizedBody.messages.map((m: any) => m.content).join(' ')
      : '';
    const completionText = jsonResponse.choices?.[0]?.message?.content || '';
    promptTokens = estimateTokenCount(promptText);
    completionTokens = estimateTokenCount(completionText);
  }

  const { costUSD } = recordRequestUsage({
    model,
    tenant,
    promptTokens,
    completionTokens,
    latencySeconds,
    cached: false,
  });

  await tenantBudgetManager.recordSpend(tenant, costUSD);

  // Attach FinOps metadata in response headers
  reply.header('x-sentinel-latency-ms', Math.round(latencySeconds * 1000).toString());
  reply.header('x-sentinel-cost-usd', costUSD.toString());
  reply.header('x-sentinel-tokens-prompt', promptTokens.toString());
  reply.header('x-sentinel-tokens-completion', completionTokens.toString());

  // Cache response asynchronously in Redis and Semantic Vector Cache
  const promptForCache = Array.isArray(sanitizedBody.messages)
    ? sanitizedBody.messages.map((m: any) => m.content).join(' ')
    : (sanitizedBody.prompt || '');

  const cachePayload = {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: jsonResponse,
    cachedAt: Date.now(),
    promptTokens,
    completionTokens,
  };

  await redisCache.set(cacheKey, cachePayload);
  semanticCache.set(model, promptForCache, cachePayload);

  // 6. Asynchronous Shadow Traffic Mirroring (A/B Model Drift Analysis)
  if (trafficMirror.shouldMirror()) {
    const primaryContent = jsonResponse.choices?.[0]?.message?.content || '';
    const traceId = (req as any).traceId || req.headers['x-sentinel-trace-id'];
    void trafficMirror.mirrorRequest(
      sanitizedBody,
      {
        content: primaryContent,
        model,
        latencyMs: Math.round(latencySeconds * 1000),
        costUSD,
        traceId: typeof traceId === 'string' ? traceId : undefined,
      },
      clientAuthHeader
    );
  }

  return reply.code(200).send(jsonResponse);
}
