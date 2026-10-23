import { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config/env.js';
import { apiKeyManager } from '../auth/key-manager.js';

export async function enterpriseAuthMiddleware(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Exclude public infrastructure endpoints from auth
  const publicPaths = ['/health', '/ready', '/metrics', '/dashboard'];
  if (publicPaths.some((p) => req.url.startsWith(p))) {
    return;
  }

  // Check for Sentinel Bearer or Header API Key
  const authHeader = req.headers['authorization'];
  const sentinelKeyHeader = req.headers['x-sentinel-key'];
  const rawKey =
    typeof sentinelKeyHeader === 'string'
      ? sentinelKeyHeader
      : typeof authHeader === 'string' && authHeader.startsWith('Bearer sent_live_')
        ? authHeader.replace(/^Bearer\s+/i, '')
        : undefined;

  if (rawKey) {
    const authResult = apiKeyManager.validateKey(rawKey);
    if (!authResult.authenticated || !authResult.metadata) {
      return reply.code(401).send({
        error: {
          message: authResult.rejectionReason || 'Unauthorized: Invalid API key',
          type: 'authentication_error',
          code: 'invalid_api_key',
        },
      });
    }

    (req as any).tenantId = authResult.metadata.tenant;
    (req as any).keyMetadata = authResult.metadata;
    return;
  }

  // Default fallback for internal VPC networks without per-key auth
  const tenantId = req.headers[config.TENANT_HEADER_NAME] || 'default-tenant';
  (req as any).tenantId = tenantId;
}
