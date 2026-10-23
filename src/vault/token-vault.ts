import crypto from 'node:crypto';
import { VaultSession, AnonymizationResult } from './types.js';
import { OPERATIONAL_PII_RULES } from '../guardrails/pii-scrubber.js';
import { config } from '../config/env.js';
import { redisCache } from '../cache/redis-cache.js';

const CATEGORY_PREFIX_MAP: Record<string, string> = {
  WELL_API_NUMBER: 'WELL',
  GEOGRAPHIC_COORDINATES: 'GEO',
  PLSS_LEGAL_LAND: 'PLSS',
  OFFSHORE_LEASE_BLOCK: 'BLOCK',
  CONFIDENTIAL_FORMATION: 'FORMATION',
  DRILL_DEPTH: 'DEPTH',
  RESERVOIR_METRICS: 'METRIC',
  EMAIL_ADDRESS: 'EMAIL',
  PHONE_NUMBER: 'PHONE',
  SSN: 'SSN',
  API_SECRET_KEY: 'KEY',
};

export class TokenVaultManager {
  private inMemoryStore = new Map<string, VaultSession>();

  public createSession(
    sessionId: string = crypto.randomUUID(),
    tenant: string = 'default',
    ttlSeconds: number = config.VAULT_TTL_SECONDS
  ): VaultSession {
    const now = Date.now();
    const session: VaultSession = {
      sessionId,
      tenant,
      tokenToEntity: {},
      entityToToken: {},
      counters: {},
      createdAt: now,
      expiresAt: now + ttlSeconds * 1000,
    };

    this.inMemoryStore.set(sessionId, session);
    return session;
  }

  public async saveSession(session: VaultSession): Promise<void> {
    this.inMemoryStore.set(session.sessionId, session);

    // Save to Redis if Redis is active
    if (redisCache.isHealthy()) {
      const redisKey = `sentinel:vault:v1:${session.sessionId}`;
      const ttl = Math.max(1, Math.floor((session.expiresAt - Date.now()) / 1000));
      await redisCache.set(
        redisKey,
        {
          statusCode: 200,
          headers: {},
          body: session,
          cachedAt: Date.now(),
        },
        ttl
      );
    }
  }

  public async getSession(sessionId: string): Promise<VaultSession | null> {
    const inMem = this.inMemoryStore.get(sessionId);
    if (inMem && inMem.expiresAt > Date.now()) {
      return inMem;
    }

    if (redisCache.isHealthy()) {
      const redisKey = `sentinel:vault:v1:${sessionId}`;
      const cached = await redisCache.get(redisKey);
      if (cached && cached.body) {
        const session = cached.body as VaultSession;
        this.inMemoryStore.set(sessionId, session);
        return session;
      }
    }

    return null;
  }

  public anonymize(text: string, session: VaultSession): AnonymizationResult {
    if (!text || typeof text !== 'string') {
      return { text, session, entityCounts: {} };
    }

    let anonymizedText = text;
    const entityCounts: Record<string, number> = {};

    for (const rule of OPERATIONAL_PII_RULES) {
      rule.regex.lastIndex = 0;
      const category = rule.category;
      const prefix = CATEGORY_PREFIX_MAP[category] || 'ENT';

      // Find all matches in the text
      const matches: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = rule.regex.exec(text)) !== null) {
        matches.push(match[0]);
      }

      for (const rawMatch of matches) {
        const trimmed = rawMatch.trim();
        if (!trimmed) continue;

        // Check if we've already minted a pseudo-token for this entity in this session
        let token = session.entityToToken[trimmed];
        if (!token) {
          session.counters[category] = (session.counters[category] || 0) + 1;
          const idx = String(session.counters[category]).padStart(2, '0');
          token = `{{SENTINEL_${prefix}_${idx}}}`;

          session.entityToToken[trimmed] = token;
          session.tokenToEntity[token] = trimmed;
        }

        entityCounts[category] = (entityCounts[category] || 0) + 1;

        // Replace raw match with pseudo-token
        anonymizedText = anonymizedText.split(trimmed).join(token);
      }
    }

    return {
      text: anonymizedText,
      session,
      entityCounts,
    };
  }

  public rehydrate(text: string, session: VaultSession): string {
    if (!text || typeof text !== 'string' || !session) {
      return text;
    }

    let rehydratedText = text;
    for (const [token, originalEntity] of Object.entries(session.tokenToEntity)) {
      if (rehydratedText.includes(token)) {
        rehydratedText = rehydratedText.split(token).join(originalEntity);
      }
    }

    return rehydratedText;
  }
}

export const tokenVault = new TokenVaultManager();

// Streaming helper that rehydrates pseudo-tokens across SSE chunks
export class StreamingRehydrator {
  private buffer = '';
  private session: VaultSession;

  constructor(session: VaultSession) {
    this.session = session;
  }

  public processChunk(chunkText: string): string {
    this.buffer += chunkText;

    // Check if buffer contains complete {{SENTINEL_...}} tokens
    let output = '';
    const tokenRegex = /\{\{SENTINEL_[A-Z]+_\d+\}\}/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(this.buffer)) !== null) {
      // Append text preceding the token
      output += this.buffer.slice(lastIndex, match.index);
      // Rehydrate the token
      const token = match[0];
      const replacement = this.session.tokenToEntity[token] || token;
      output += replacement;
      lastIndex = tokenRegex.lastIndex;
    }

    // Keep leftover from last match
    this.buffer = this.buffer.slice(lastIndex);

    // If the leftover doesn't start or contain a partial '{{', we can safely flush it
    const partialIndex = this.buffer.lastIndexOf('{{');
    if (partialIndex === -1) {
      output += this.buffer;
      this.buffer = '';
    } else {
      // Flush everything before the potential partial '{{'
      output += this.buffer.slice(0, partialIndex);
      this.buffer = this.buffer.slice(partialIndex);
    }

    return output;
  }

  public flush(): string {
    // End of stream - flush any remaining buffer
    const remaining = tokenVault.rehydrate(this.buffer, this.session);
    this.buffer = '';
    return remaining;
  }
}
