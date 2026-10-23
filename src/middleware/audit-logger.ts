import { FastifyRequest, FastifyReply } from 'fastify';

export function logAuditEntry(req: FastifyRequest, reply: FastifyReply, durationMs: number): void {
  // Avoid noisy audit logging for health checks & metrics
  if (req.url === '/health' || req.url === '/ready' || req.url === '/metrics') {
    return;
  }

  const auditRecord = {
    timestamp: new Date().toISOString(),
    event: 'llm_gateway_transaction',
    requestId: req.id,
    method: req.method,
    url: req.url,
    statusCode: reply.statusCode,
    durationMs: Math.round(durationMs * 100) / 100,
    tenantId: (req as any).tenantId || req.headers['x-tenant-id'] || 'unknown',
    userAgent: req.headers['user-agent'] || 'unknown',
    clientIp: req.ip,
    cached: reply.getHeader('x-sentinel-cache') || 'MISS',
    scrubbed: reply.getHeader('x-sentinel-guardrails-scrubbed') === 'true',
    costUSD: reply.getHeader('x-sentinel-cost-usd') || null,
  };

  req.log.info(auditRecord, 'AI Gateway Sentinel Audit Event');
}
