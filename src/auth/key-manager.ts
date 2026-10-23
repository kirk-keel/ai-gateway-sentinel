import crypto from 'node:crypto';
import {
  ApiKeyMetadata,
  AuthValidationResult,
  CreateApiKeyRequest,
  CreatedApiKeyResponse,
} from './types.js';

export class ApiKeyManager {
  private keysByHash = new Map<string, ApiKeyMetadata>();
  private keysById = new Map<string, ApiKeyMetadata>();

  public hashKey(rawKey: string): string {
    return crypto.createHash('sha256').update(rawKey).digest('hex');
  }

  public createKey(params: CreateApiKeyRequest): CreatedApiKeyResponse {
    const randomBytes = crypto.randomBytes(24).toString('base64url');
    const rawKey = `sent_live_${randomBytes}`;
    const hashedKey = this.hashKey(rawKey);
    const prefix = rawKey.slice(0, 14); // e.g. 'sent_live_abc1'
    const id = `key_${crypto.randomBytes(6).toString('hex')}`;
    const now = Date.now();

    const expiresAt = params.expiresInDays
      ? now + params.expiresInDays * 86400 * 1000
      : null;

    const metadata: ApiKeyMetadata = {
      id,
      name: params.name,
      prefix,
      hashedKey,
      tenant: params.tenant,
      allowedModels: params.allowedModels || ['*'],
      maxTokensPerRequest: params.maxTokensPerRequest || 8192,
      rateLimitRpm: params.rateLimitRpm || 120,
      role: params.role || 'standard',
      createdAt: now,
      expiresAt,
      revoked: false,
    };

    this.keysByHash.set(hashedKey, metadata);
    this.keysById.set(id, metadata);

    const { hashedKey: _, ...safeMetadata } = metadata;

    return {
      apiKey: rawKey,
      metadata: safeMetadata,
    };
  }

  public validateKey(rawKey: string): AuthValidationResult {
    if (!rawKey || typeof rawKey !== 'string') {
      return { authenticated: false, rejectionReason: 'Missing API key' };
    }

    const trimmed = rawKey.trim().replace(/^Bearer\s+/i, '');
    if (!trimmed.startsWith('sent_live_')) {
      return {
        authenticated: false,
        rejectionReason: 'Invalid key format (must start with sent_live_)',
      };
    }

    const hashed = this.hashKey(trimmed);
    const metadata = this.keysByHash.get(hashed);

    if (!metadata) {
      return { authenticated: false, rejectionReason: 'API key not recognized' };
    }

    if (metadata.revoked) {
      return {
        authenticated: false,
        rejectionReason: 'API key has been revoked',
        metadata,
      };
    }

    if (metadata.expiresAt && Date.now() > metadata.expiresAt) {
      return {
        authenticated: false,
        rejectionReason: 'API key has expired',
        metadata,
      };
    }

    return { authenticated: true, metadata };
  }

  public isModelAllowed(metadata: ApiKeyMetadata, requestedModel: string): boolean {
    if (!metadata.allowedModels || metadata.allowedModels.includes('*')) {
      return true;
    }

    const lowerModel = requestedModel.toLowerCase();
    return metadata.allowedModels.some(
      (m) => m === '*' || m.toLowerCase() === lowerModel
    );
  }

  public revokeKey(keyId: string): boolean {
    const metadata = this.keysById.get(keyId);
    if (!metadata) return false;

    metadata.revoked = true;
    return true;
  }

  public listKeys(): Array<Omit<ApiKeyMetadata, 'hashedKey'>> {
    return Array.from(this.keysById.values()).map(
      ({ hashedKey: _, ...safe }) => safe
    );
  }

  public clear(): void {
    this.keysByHash.clear();
    this.keysById.clear();
  }
}

export const apiKeyManager = new ApiKeyManager();
