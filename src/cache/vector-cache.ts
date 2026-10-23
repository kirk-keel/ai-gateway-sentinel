import { CachedResponse } from './redis-cache.js';

export interface SemanticCacheEntry {
  key: string;
  model: string;
  prompt: string;
  vector: number[];
  response: CachedResponse;
  createdAt: number;
  expiresAt: number;
}

export interface SemanticMatchResult {
  hit: boolean;
  similarity: number;
  entry?: SemanticCacheEntry;
}

// Standard stop words that shouldn't distort conceptual semantic similarity
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'with', 'by'
]);

// Generate a deterministic high-dimensional feature vector for text using char N-grams and token frequencies
export function generateTextVector(text: string, dimensions = 64): number[] {
  const normalized = text.toLowerCase().trim().replace(/[^\w\s]/g, ' ');
  const rawTokens = normalized.split(/\s+/).filter(Boolean);
  const tokens = rawTokens.filter((t) => !STOP_WORDS.has(t));

  const effectiveTokens = tokens.length > 0 ? tokens : rawTokens;
  const vector = new Array(dimensions).fill(0);
  if (effectiveTokens.length === 0) return vector;

  // 1. Unigram hash bucket distribution
  for (const token of effectiveTokens) {
    let hash = 0;
    for (let i = 0; i < token.length; i++) {
      hash = (hash << 5) - hash + token.charCodeAt(i);
      hash |= 0;
    }
    const bucket = Math.abs(hash) % dimensions;
    vector[bucket] += 1.0;
  }

  // 2. Bigram transitions
  for (let i = 0; i < effectiveTokens.length - 1; i++) {
    const bigram = `${effectiveTokens[i]}_${effectiveTokens[i + 1]}`;
    let hash = 0;
    for (let j = 0; j < bigram.length; j++) {
      hash = (hash << 5) - hash + bigram.charCodeAt(j);
      hash |= 0;
    }
    const bucket = Math.abs(hash) % dimensions;
    vector[bucket] += 1.5;
  }

  // Normalize to unit length (L2 norm)
  let norm = 0;
  for (let i = 0; i < dimensions; i++) {
    norm += vector[i] * vector[i];
  }
  norm = Math.sqrt(norm);

  if (norm > 0) {
    for (let i = 0; i < dimensions; i++) {
      vector[i] = Number((vector[i] / norm).toFixed(6));
    }
  }

  return vector;
}

export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length || vecA.length === 0) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) return 0;
  const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  return Number(Math.max(0, Math.min(1, similarity)).toFixed(4));
}

export class SemanticCacheManager {
  private entries: SemanticCacheEntry[] = [];
  private similarityThreshold: number;
  private defaultTTLSeconds: number;

  constructor(similarityThreshold = 0.88, defaultTTLSeconds = 3600) {
    this.similarityThreshold = similarityThreshold;
    this.defaultTTLSeconds = defaultTTLSeconds;
  }

  public set(
    model: string,
    prompt: string,
    response: CachedResponse,
    ttlSeconds = this.defaultTTLSeconds
  ): void {
    const vector = generateTextVector(prompt);
    const now = Date.now();
    const entry: SemanticCacheEntry = {
      key: `semantic:${model}:${now}`,
      model,
      prompt,
      vector,
      response,
      createdAt: now,
      expiresAt: now + ttlSeconds * 1000,
    };

    // Clean expired
    this.pruneExpired();
    this.entries.push(entry);

    // Keep capacity capped at 500 in memory
    if (this.entries.length > 500) {
      this.entries.shift();
    }
  }

  public findSimilar(
    model: string,
    prompt: string,
    threshold = this.similarityThreshold
  ): SemanticMatchResult {
    this.pruneExpired();

    const queryVector = generateTextVector(prompt);
    let bestSimilarity = 0;
    let bestMatch: SemanticCacheEntry | undefined;

    for (const entry of this.entries) {
      if (entry.model !== model) continue;

      const sim = cosineSimilarity(queryVector, entry.vector);
      if (sim > bestSimilarity) {
        bestSimilarity = sim;
        bestMatch = entry;
      }
    }

    if (bestSimilarity >= threshold && bestMatch) {
      return {
        hit: true,
        similarity: bestSimilarity,
        entry: bestMatch,
      };
    }

    return {
      hit: false,
      similarity: bestSimilarity,
    };
  }

  private pruneExpired(): void {
    const now = Date.now();
    this.entries = this.entries.filter((e) => e.expiresAt > now);
  }

  public clear(): void {
    this.entries = [];
  }
}

export const semanticCache = new SemanticCacheManager();
