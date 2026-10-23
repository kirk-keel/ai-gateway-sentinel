export interface ParsedSSEChunk {
  raw: string;
  data?: any;
  contentDelta?: string;
  isDone?: boolean;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export function parseSSEEvent(rawLine: string): ParsedSSEChunk | null {
  const line = rawLine.trim();
  if (!line || !line.startsWith('data:')) {
    return null;
  }

  const payload = line.replace(/^data:\s*/, '').trim();
  if (payload === '[DONE]') {
    return { raw: rawLine, isDone: true };
  }

  try {
    const parsed = JSON.parse(payload);
    const contentDelta =
      parsed.choices?.[0]?.delta?.content ||
      parsed.choices?.[0]?.text ||
      '';
    const usage = parsed.usage;

    return {
      raw: rawLine,
      data: parsed,
      contentDelta,
      usage,
    };
  } catch {
    return { raw: rawLine };
  }
}

export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  // A standard rule of thumb for English & code is 1 token ~ 4 characters or 0.75 words
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return Math.max(1, Math.ceil(trimmed.length / 4));
}
