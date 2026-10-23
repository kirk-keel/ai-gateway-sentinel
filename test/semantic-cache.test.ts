import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateTextVector,
  cosineSimilarity,
  semanticCache,
} from '../src/cache/vector-cache.js';

describe('FinOps: Semantic Vector Caching Engine', () => {
  beforeEach(() => {
    semanticCache.clear();
  });

  it('should generate unit-normalized vectors with 1.0 self-similarity', () => {
    const text = 'Evaluate casing collapse resistance for deepwater well';
    const vec = generateTextVector(text);

    expect(vec.length).toBe(64);
    const selfSim = cosineSimilarity(vec, vec);
    expect(selfSim).toBeCloseTo(1.0, 3);
  });

  it('should compute high cosine similarity for conceptually near-identical prompts', () => {
    const prompt1 = 'What is the EUR calculation for well 42-301-32456?';
    const prompt2 = 'What is EUR calculation for well 42-301-32456?';

    const vec1 = generateTextVector(prompt1);
    const vec2 = generateTextVector(prompt2);

    const similarity = cosineSimilarity(vec1, vec2);
    expect(similarity).toBeGreaterThanOrEqual(0.9);
  });

  it('should compute low cosine similarity for unrelated prompts', () => {
    const prompt1 = 'Calculate mud weight density for high-pressure gas zone';
    const prompt2 = 'Summarize executive compensation committee meeting minutes';

    const vec1 = generateTextVector(prompt1);
    const vec2 = generateTextVector(prompt2);

    const similarity = cosineSimilarity(vec1, vec2);
    expect(similarity).toBeLessThan(0.4);
  });

  it('should serve semantic cache hits on near-duplicate queries', () => {
    const originalQuery = 'Analyze formation top depths in Bakken shale';
    const cachedResponse = {
      statusCode: 200,
      headers: {},
      body: {
        choices: [
          { message: { role: 'assistant', content: 'Bakken formation tops average 10,200 ft TVD.' } },
        ],
      },
      cachedAt: Date.now(),
    };

    semanticCache.set('gpt-4o', originalQuery, cachedResponse);

    // Query with minor stop-word variation
    const rephrasedQuery = 'Analyze the formation top depths in Bakken shale';
    const match = semanticCache.findSimilar('gpt-4o', rephrasedQuery);

    expect(match.hit).toBe(true);
    expect(match.similarity).toBeGreaterThanOrEqual(0.88);
    expect(match.entry?.response.body.choices[0].message.content).toContain('10,200 ft TVD');
  });

  it('should return cache miss for queries below similarity threshold', () => {
    const originalQuery = 'Permeability measurements for Wolfcamp core sample';
    const cachedResponse = {
      statusCode: 200,
      headers: {},
      body: { choices: [{ message: { role: 'assistant', content: '0.04 mD' } }] },
      cachedAt: Date.now(),
    };

    semanticCache.set('gpt-4o', originalQuery, cachedResponse);

    const differentQuery = 'Hydraulic horsepower required for fracturing pumps';
    const match = semanticCache.findSimilar('gpt-4o', differentQuery);

    expect(match.hit).toBe(false);
  });
});
