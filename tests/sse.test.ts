import { describe, it, expect } from 'vitest';
import { parseSSEEvent, estimateTokenCount } from '../src/proxy/sse-parser.js';

describe('SSE Parser & Streaming Telemetry', () => {
  it('should parse streaming chunk with content delta', () => {
    const rawLine = 'data: {"id":"chatcmpl-123","choices":[{"index":0,"delta":{"content":"Hello world"},"finish_reason":null}]}';
    const parsed = parseSSEEvent(rawLine);

    expect(parsed).not.toBeNull();
    expect(parsed?.contentDelta).toBe('Hello world');
    expect(parsed?.isDone).toBeFalsy();
  });

  it('should detect [DONE] terminal chunk', () => {
    const rawLine = 'data: [DONE]';
    const parsed = parseSSEEvent(rawLine);

    expect(parsed?.isDone).toBe(true);
  });

  it('should extract usage chunk from SSE stream if emitted', () => {
    const rawLine = 'data: {"id":"chatcmpl-123","choices":[],"usage":{"prompt_tokens":15,"completion_tokens":42,"total_tokens":57}}';
    const parsed = parseSSEEvent(rawLine);

    expect(parsed?.usage?.prompt_tokens).toBe(15);
    expect(parsed?.usage?.completion_tokens).toBe(42);
    expect(parsed?.usage?.total_tokens).toBe(57);
  });

  it('should accurately estimate token counts based on text length', () => {
    expect(estimateTokenCount('')).toBe(0);
    expect(estimateTokenCount('hello')).toBeGreaterThanOrEqual(1);
    expect(estimateTokenCount('This is a longer prompt for hydraulic fracture analysis')).toBeGreaterThanOrEqual(10);
  });
});
