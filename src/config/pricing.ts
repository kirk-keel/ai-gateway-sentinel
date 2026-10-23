export interface ModelPrice {
  inputPerMillion: number;
  outputPerMillion: number;
}

export const MODEL_PRICING_TABLE: Record<string, ModelPrice> = {
  // OpenAI
  'gpt-4o': { inputPerMillion: 2.5, outputPerMillion: 10.0 },
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  'gpt-4-turbo': { inputPerMillion: 10.0, outputPerMillion: 30.0 },
  'gpt-4': { inputPerMillion: 30.0, outputPerMillion: 60.0 },
  'gpt-3.5-turbo': { inputPerMillion: 0.5, outputPerMillion: 1.5 },
  'o1-preview': { inputPerMillion: 15.0, outputPerMillion: 60.0 },
  'o1-mini': { inputPerMillion: 3.0, outputPerMillion: 12.0 },

  // Anthropic
  'claude-3-5-sonnet': { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  'claude-3-opus': { inputPerMillion: 15.0, outputPerMillion: 75.0 },
  'claude-3-haiku': { inputPerMillion: 0.25, outputPerMillion: 1.25 },

  // Open-Source / Local / Self-Hosted (e.g. vLLM, Ollama, Llama-3)
  'meta-llama/llama-3.1-70b-instruct': { inputPerMillion: 0.88, outputPerMillion: 0.88 },
  'meta-llama/llama-3.1-8b-instruct': { inputPerMillion: 0.18, outputPerMillion: 0.18 },
  'mistralai/mixtral-8x7b-instruct': { inputPerMillion: 0.6, outputPerMillion: 0.6 },

  // Fallback default
  default: { inputPerMillion: 2.0, outputPerMillion: 8.0 },
};

export function getModelPricing(modelName: string): ModelPrice {
  if (MODEL_PRICING_TABLE[modelName]) {
    return MODEL_PRICING_TABLE[modelName];
  }
  // Try partial prefix match (e.g. gpt-4o-2024-08-06 matches gpt-4o)
  const normalized = modelName.toLowerCase();
  for (const [key, price] of Object.entries(MODEL_PRICING_TABLE)) {
    if (key !== 'default' && normalized.includes(key)) {
      return price;
    }
  }
  return MODEL_PRICING_TABLE.default;
}

export function calculateInferenceCostUSD(
  modelName: string,
  promptTokens: number,
  completionTokens: number
): number {
  const pricing = getModelPricing(modelName);
  const promptCost = (promptTokens / 1_000_000) * pricing.inputPerMillion;
  const completionCost = (completionTokens / 1_000_000) * pricing.outputPerMillion;
  return Number((promptCost + completionCost).toFixed(6));
}
