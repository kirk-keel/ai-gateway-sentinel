import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(8000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  UPSTREAM_LLM_URL: z.string().url().default('https://api.openai.com/v1'),
  UPSTREAM_API_KEY: z.string().default(''),
  DEFAULT_MODEL: z.string().default('gpt-4o'),
  TENANT_HEADER_NAME: z.string().default('x-tenant-id'),
  REDIS_ENABLED: z
    .string()
    .transform((val) => val === 'true' || val === '1')
    .default('true'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_CACHE_TTL_SECONDS: z.coerce.number().default(3600),
  GUARDRAILS_ENABLED: z
    .string()
    .transform((val) => val !== 'false' && val !== '0')
    .default('true'),
  GUARDRAILS_BLOCK_ON_PII: z
    .string()
    .transform((val) => val === 'true' || val === '1')
    .default('false'),
  GUARDRAILS_INJECTION_THRESHOLD: z.coerce.number().min(0).max(1).default(0.65),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
});

export type EnvConfig = z.infer<typeof envSchema>;

export const config: EnvConfig = envSchema.parse(process.env);
