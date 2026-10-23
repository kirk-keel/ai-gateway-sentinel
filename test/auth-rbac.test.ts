import { describe, it, expect, beforeEach } from 'vitest';
import { apiKeyManager } from '../src/auth/key-manager.js';
import { buildServer } from '../src/server.js';
import { redisCache } from '../src/cache/redis-cache.js';

describe('Auth & RBAC: Scoped Cryptographic API Key Management', () => {
  beforeEach(() => {
    apiKeyManager.clear();
  });

  it('should generate cryptographic keys with sent_live_ prefix and SHA-256 hash', () => {
    const created = apiKeyManager.createKey({
      name: 'Subsurface Prod App',
      tenant: 'geophysics-division',
      allowedModels: ['gpt-4o-mini', 'claude-3-haiku'],
    });

    expect(created.apiKey).toMatch(/^sent_live_[A-Za-z0-9_-]{32,}$/);
    expect(created.metadata.name).toBe('Subsurface Prod App');
    expect(created.metadata.tenant).toBe('geophysics-division');
    expect(created.metadata.allowedModels).toContain('gpt-4o-mini');
    expect(created.metadata).not.toHaveProperty('hashedKey');
  });

  it('should validate authentic keys and reject invalid/unknown tokens', () => {
    const created = apiKeyManager.createKey({
      name: 'Drilling Ops Agent',
      tenant: 'drilling',
    });

    const validRes = apiKeyManager.validateKey(created.apiKey);
    expect(validRes.authenticated).toBe(true);
    expect(validRes.metadata?.tenant).toBe('drilling');

    const fakeRes = apiKeyManager.validateKey('sent_live_invalidtoken1234567890abcdef');
    expect(fakeRes.authenticated).toBe(false);
    expect(fakeRes.rejectionReason).toBe('API key not recognized');
  });

  it('should reject revoked API keys immediately', () => {
    const created = apiKeyManager.createKey({
      name: 'Temporary Token',
      tenant: 'analytics',
    });

    apiKeyManager.revokeKey(created.metadata.id);

    const check = apiKeyManager.validateKey(created.apiKey);
    expect(check.authenticated).toBe(false);
    expect(check.rejectionReason).toContain('revoked');
  });

  it('should enforce model scoping permissions correctly', () => {
    const created = apiKeyManager.createKey({
      name: 'Junior Scoped Key',
      tenant: 'intern-team',
      allowedModels: ['gpt-4o-mini'],
    });

    const metadata = apiKeyManager.validateKey(created.apiKey).metadata!;
    expect(apiKeyManager.isModelAllowed(metadata, 'gpt-4o-mini')).toBe(true);
    expect(apiKeyManager.isModelAllowed(metadata, 'gpt-4o')).toBe(false);
  });
});

describe('Integration: Key Management Endpoints & Model Enforcement', () => {
  beforeEach(() => {
    apiKeyManager.clear();
  });

  it('POST /v1/keys, GET /v1/keys, and DELETE /v1/keys/:id', async () => {
    const server = await buildServer();

    // 1. Create key
    const createRes = await server.inject({
      method: 'POST',
      url: '/v1/keys',
      payload: {
        name: 'Integration Test Key',
        tenant: 'qa-tenant',
        allowedModels: ['gpt-4o-mini'],
      },
    });

    expect(createRes.statusCode).toBe(201);
    const createBody = JSON.parse(createRes.body);
    expect(createBody.apiKey).toMatch(/^sent_live_/);
    const keyId = createBody.metadata.id;

    // 2. List keys
    const listRes = await server.inject({
      method: 'GET',
      url: '/v1/keys',
    });
    expect(listRes.statusCode).toBe(200);
    const listBody = JSON.parse(listRes.body);
    expect(listBody.data.some((k: any) => k.id === keyId)).toBe(true);

    // 3. Revoke key
    const deleteRes = await server.inject({
      method: 'DELETE',
      url: `/v1/keys/${keyId}`,
    });
    expect(deleteRes.statusCode).toBe(200);

    // 4. Verify revocation
    const checkValidation = apiKeyManager.validateKey(createBody.apiKey);
    expect(checkValidation.authenticated).toBe(false);

    await server.close();
    await redisCache.disconnect();
  });

  it('should reject requests with 403 when model exceeds key scope', async () => {
    const server = await buildServer();

    const created = apiKeyManager.createKey({
      name: 'Mini-Only App',
      tenant: 'budget-team',
      allowedModels: ['gpt-4o-mini'],
    });

    // Attempting to invoke expensive gpt-4o with mini-only key
    const res = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        authorization: `Bearer ${created.apiKey}`,
      },
      payload: {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Say hello' }],
      },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('model_not_allowed');
    expect(body.error.message).toContain('not permitted');

    await server.close();
    await redisCache.disconnect();
  });
});
