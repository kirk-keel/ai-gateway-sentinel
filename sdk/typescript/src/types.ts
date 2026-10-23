export interface SentinelClientOptions {
  baseUrl?: string;
  apiKey?: string;
  tenantId?: string;
  fetchFn?: typeof fetch;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  [key: string]: any;
}

export interface SentinelTelemetryHeaders {
  costUSD?: number;
  cached: boolean;
  latencyMs?: number;
  traceId?: string;
  scrubbed: boolean;
  routedModel?: string;
  routingTier?: string;
  routingSavingsPct?: number;
}

export interface SentinelChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: ChatMessage;
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  telemetry: SentinelTelemetryHeaders;
}

export interface GuardrailsCheckRequest {
  text: string;
  blockOnPii?: boolean;
  threshold?: number;
}

export interface GuardrailsCheckResponse {
  allowed: boolean;
  blockedReason: string | null;
  injection: {
    isInjection: boolean;
    score: number;
    matchedRules: string[];
  };
  pii: {
    hasPii: boolean;
    counts: Record<string, number>;
    violations: Array<{
      category: string;
      matchedText: string;
      replacementToken: string;
    }>;
  };
  sanitizedText: string;
  evaluationDurationMs: number;
}
