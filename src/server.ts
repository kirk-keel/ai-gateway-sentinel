import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { config } from './config/env.js';
import { proxyRoutes } from './proxy/router.js';
import { enterpriseAuthMiddleware } from './middleware/auth.js';
import { logAuditEntry } from './middleware/audit-logger.js';

export async function buildServer(): Promise<FastifyInstance> {
  const server = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      serializers: {
        req(req) {
          return {
            id: req.id,
            method: req.method,
            url: req.url,
            hostname: req.hostname,
            remoteAddress: req.ip,
          };
        },
      },
    },
    requestIdHeader: 'x-request-id',
  });

  // Security Headers
  await server.register(helmet, {
    contentSecurityPolicy: false,
  });

  // CORS for Enterprise Dashboards / Internal Clients
  await server.register(cors, {
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id', 'x-sentinel-key'],
  });

  // Request hooks for authentication & audit logging
  server.addHook('onRequest', enterpriseAuthMiddleware);

  server.addHook('onResponse', async (req, reply) => {
    const responseTime = reply.elapsedTime;
    logAuditEntry(req, reply, responseTime);
  });

  // Register Proxy & Sentinel Routes
  await server.register(proxyRoutes);

  // Global Error Handler
  server.setErrorHandler((error: any, _req, reply) => {
    server.log.error(error);
    const statusCode = error.statusCode || 500;
    return reply.code(statusCode).send({
      error: {
        message: error.message || 'Internal Server Error',
        type: 'api_error',
        code: error.code || 'internal_error',
      },
    });
  });

  return server;
}
