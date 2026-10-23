import { FastifyReply, FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';
import { config } from '../config/env.js';
import { recordRequestUsage } from '../metrics/finops.js';
import { timeToFirstTokenHistogram } from '../metrics/prometheus.js';
import { estimateTokenCount, parseSSEEvent } from './sse-parser.js';
import { redisCache } from '../cache/redis-cache.js';

export async function forwardChatCompletion(
  req: FastifyRequest<{ Body: Record<string, any> }>,
  reply: FastifyReply,
  sanitizedBody: Record<string, any>,
  tenant: string
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
      return reply.code(cached.statusCode).send(cached.body);
    }
    reply.header('x-sentinel-cache', 'MISS');
  } else {
    reply.header('x-sentinel-cache', 'BYPASS_STREAM');
  }

  // 2. Prepare headers for upstream LLM
  const upstreamUrl = `${config.UPSTREAM_LLM_URL.replace(/\/+$/, '')}/chat/completions`;
  const upstreamHeaders: Record<string, string> = {
    'content-type': 'application/json',
  };

  const clientAuth = req.headers['authorization'];
  if (config.UPSTREAM_API_KEY) {
    upstreamHeaders['authorization'] = `Bearer ${config.UPSTREAM_API_KEY}`;
  } else if (clientAuth && typeof clientAuth === 'string') {
    upstreamHeaders['authorization'] = clientAuth;
  }

  // If streaming and client didn't specify stream_options, add include_usage for exact token telemetry
  const forwardPayload = { ...sanitizedBody };
  if (isStreaming && !forwardPayload.stream_options) {
    forwardPayload.stream_options = { include_usage: true };
  }

  const upstreamResponse = await fetch(upstreamUrl, {
    method: 'POST',
    headers: upstreamHeaders,
    body: JSON.stringify(forwardPayload),
  });

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

    let firstTokenReceived = false;
    let accumulatedContent = '';
    let promptTokens = 0;
    let completionTokens = 0;
    let explicitUsageFound = false;

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
            // Stream complete - finalize metrics
            const totalDurationSec = (performance.now() - startTime) / 1000;
            const finalPromptTokens = promptTokens || estimatedPromptTokens;
            const finalCompletionTokens =
              completionTokens || estimateTokenCount(accumulatedContent);

            recordRequestUsage({
              model,
              tenant,
              promptTokens: finalPromptTokens,
              completionTokens: finalCompletionTokens,
              latencySeconds: totalDurationSec,
              cached: false,
            });

            this.push(null);
            return;
          }

          const chunkText = decoder.decode(value, { stream: true });
          lineBuffer += chunkText;

          const lines = lineBuffer.split('\n');
          // Keep trailing incomplete line in buffer
          lineBuffer = lines.pop() || '';

          for (const line of lines) {
            const parsed = parseSSEEvent(line);
            if (parsed) {
              if (!firstTokenReceived && (parsed.contentDelta || parsed.data)) {
                firstTokenReceived = true;
                const ttftSec = (performance.now() - startTime) / 1000;
                timeToFirstTokenHistogram.observe({ model, tenant }, ttftSec);
              }

              if (parsed.contentDelta) {
                accumulatedContent += parsed.contentDelta;
              }

              if (parsed.usage) {
                explicitUsageFound = true;
                promptTokens = parsed.usage.prompt_tokens;
                completionTokens = parsed.usage.completion_tokens;
              }
            }
          }

          this.push(Buffer.from(chunkText));
        } catch (err: any) {
          this.destroy(err);
        }
      },
    });

    return reply.send(stream);
  }

  // 4. Handle Non-Streaming response
  const jsonResponse: any = await upstreamResponse.json();

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

  // Attach FinOps metadata in response headers
  reply.header('x-sentinel-latency-ms', Math.round(latencySeconds * 1000).toString());
  reply.header('x-sentinel-cost-usd', costUSD.toString());
  reply.header('x-sentinel-tokens-prompt', promptTokens.toString());
  reply.header('x-sentinel-tokens-completion', completionTokens.toString());

  // Cache response asynchronously in Redis
  await redisCache.set(cacheKey, {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: jsonResponse,
    cachedAt: Date.now(),
    promptTokens,
    completionTokens,
  });

  return reply.code(200).send(jsonResponse);
}
