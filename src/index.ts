import { buildServer } from './server.js';
import { config } from './config/env.js';
import { redisCache } from './cache/redis-cache.js';

async function main() {
  const server = await buildServer();

  const shutdown = async (signal: string) => {
    server.log.info({ signal }, 'Shutting down AI Gateway Sentinel...');
    try {
      await server.close();
      await redisCache.disconnect();
      server.log.info('Graceful shutdown completed.');
      process.exit(0);
    } catch (err) {
      server.log.error(err, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  try {
    const address = await server.listen({
      port: config.PORT,
      host: config.HOST,
    });
    server.log.info(`🛡️ AI Gateway Sentinel running at ${address}`);
    server.log.info(`📊 Prometheus Metrics available at ${address}/metrics`);
    server.log.info(`🔄 Proxying to upstream: ${config.UPSTREAM_LLM_URL}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

main();
