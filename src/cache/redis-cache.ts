import crypto from 'node:crypto';
import { Redis } from 'ioredis';
import { config } from '../config/env.js';

export interface CachedResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: any;
  cachedAt: number;
  promptTokens?: number;
  completionTokens?: number;
}

export class RedisCacheManager {
  private client: Redis | null = null;
  private isConnected = false;
  private isEnabled: boolean;

  constructor() {
    this.isEnabled = config.REDIS_ENABLED;
    if (this.isEnabled) {
      this.initClient();
    }
  }

  private initClient(): void {
    try {
      this.client = new Redis(config.REDIS_URL, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        retryStrategy(times: number) {
          // Retry with exponential backoff capped at 3s
          return Math.min(times * 200, 3000);
        },
      });

      this.client.on('connect', () => {
        this.isConnected = true;
      });

      this.client.on('ready', () => {
        this.isConnected = true;
      });

      this.client.on('error', (err: Error) => {
        this.isConnected = false;
        // Keep logging muted in test mode to avoid clutter
        if (config.NODE_ENV !== 'test') {
          console.warn(`[RedisCache] Warning: Redis connection issue: ${err.message}`);
        }
      });

      this.client.on('close', () => {
        this.isConnected = false;
      });

      // Connect asynchronously
      this.client.connect().catch((err: Error) => {
        if (config.NODE_ENV !== 'test') {
          console.warn(`[RedisCache] Initial connect failed, will retry: ${err.message}`);
        }
      });
    } catch (err: any) {
      this.isConnected = false;
      console.warn(`[RedisCache] Could not instantiate Redis client: ${err.message}`);
    }
  }

  public isHealthy(): boolean {
    return this.isEnabled && this.isConnected;
  }

  public generateKey(model: string, body: Record<string, any>): string {
    // Generate deterministic hash of request content
    const cacheablePayload = {
      model,
      messages: body.messages || [],
      prompt: body.prompt || null,
      temperature: body.temperature ?? 1.0,
      top_p: body.top_p ?? 1.0,
      max_tokens: body.max_tokens ?? null,
    };

    const hash = crypto
      .createHash('sha256')
      .update(JSON.stringify(cacheablePayload))
      .digest('hex');

    return `sentinel:cache:v1:${model}:${hash}`;
  }

  public async get(key: string): Promise<CachedResponse | null> {
    if (!this.isHealthy() || !this.client) {
      return null;
    }

    try {
      const data = await this.client.get(key);
      if (!data) return null;
      return JSON.parse(data) as CachedResponse;
    } catch {
      return null;
    }
  }

  public async set(
    key: string,
    response: CachedResponse,
    ttlSeconds: number = config.REDIS_CACHE_TTL_SECONDS
  ): Promise<void> {
    if (!this.isHealthy() || !this.client) {
      return;
    }

    try {
      await this.client.set(key, JSON.stringify(response), 'EX', ttlSeconds);
    } catch (err: any) {
      console.warn(`[RedisCache] Failed to set cache key: ${err.message}`);
    }
  }

  public async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        this.client.disconnect();
      }
      this.isConnected = false;
    }
  }
}

export const redisCache = new RedisCacheManager();
