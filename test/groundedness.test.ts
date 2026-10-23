import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { redisCache } from '../src/cache/redis-cache.js';
import { groundednessEvaluator } from '../src/guardrails/groundedness.js';

describe('RAG Groundedness & Hallucination Guardrail', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildServer();
  });

  afterEach(async () => {
    await app.close();
    await redisCache.disconnect();
  });

  const referenceContexts = [
    'The Eagle Ford Shale formation in South Texas has an average depth of 11,500 feet and exhibits low permeability ranging from 0.01 to 0.05 mD.',
    'Hydraulic fracturing operations utilize crosslinked borate gel with ceramic proppants to stimulate unconventional reservoir flow paths.',
  ];

  it('verifies a factual response that is fully grounded in retrieved context', () => {
    const groundedResponse =
      'The Eagle Ford Shale is an unconventional South Texas formation located around 11,500 feet depth. Operations use hydraulic fracturing with ceramic proppants and borate gel.';

    const result = groundednessEvaluator.evaluate({
      response: groundedResponse,
      contexts: referenceContexts,
      threshold: 0.7,
    });

    expect(result.isGrounded).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.7);
    expect(result.citationCoveragePct).toBeGreaterThanOrEqual(70);
    expect(result.ungroundedStatements).toHaveLength(0);
  });

  it('detects ungrounded hallucinations when response claims are not in reference context', () => {
    const hallucinatedResponse =
      'The Eagle Ford formation produces 80% natural gas and was first drilled in 1845. Alien spacecraft parts were recovered from the borehole bottom.';

    const result = groundednessEvaluator.evaluate({
      response: hallucinatedResponse,
      contexts: referenceContexts,
      threshold: 0.7,
      action: 'flag',
    });

    expect(result.isGrounded).toBe(false);
    expect(result.score).toBeLessThan(0.7);
    expect(result.ungroundedStatements.length).toBeGreaterThan(0);
  });

  it('appends warning disclaimer banner when action=disclaimer on ungrounded response', () => {
    const response = 'The Eagle Ford formation was discovered in 1845 by Captain Cook.';
    const result = groundednessEvaluator.evaluate({
      response,
      contexts: referenceContexts,
      threshold: 0.7,
      action: 'disclaimer',
    });

    expect(result.isGrounded).toBe(false);
    expect(result.processedResponse).toContain('Sentinel Groundedness Notice');
  });

  it('suppresses unverified statements when action=suppress', () => {
    const response = 'The Eagle Ford formation has 11,500 feet depth. Alien spacecraft parts were found in the borehole.';
    const result = groundednessEvaluator.evaluate({
      response,
      contexts: referenceContexts,
      threshold: 0.7,
      action: 'suppress',
    });

    expect(result.processedResponse).toContain('[UNVERIFIED_CLAIM_SUPPRESSED]');
  });

  it('evaluates groundedness via REST API POST /v1/guardrails/groundedness/evaluate', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/guardrails/groundedness/evaluate',
      payload: {
        response: 'Operations utilize hydraulic fracturing with crosslinked borate gel and proppants.',
        contexts: referenceContexts,
        threshold: 0.6,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.isGrounded).toBe(true);
    expect(body.score).toBeGreaterThanOrEqual(0.6);
  });
});
