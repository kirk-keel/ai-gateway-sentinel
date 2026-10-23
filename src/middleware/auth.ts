import { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config/env.js';

export async function enterpriseAuthMiddleware(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Exclude health, readiness, and metrics endpoints from auth
  const publicPaths = ['/health', '/ready', '/metrics'];
  if (publicPaths.includes(req.url)) {
    return;
  }

  // Tenant identification header
  const tenantId = req.headers[config.TENANT_HEADER_NAME] || 'default-tenant';
  (req as any).tenantId = tenantId;
}
