import crypto from 'node:crypto';
import { SpanRecord, TraceContext } from './types.js';

export class DistributedTracer {
  private spans: SpanRecord[] = [];

  public generateTraceId(): string {
    return crypto.randomBytes(16).toString('hex'); // 32 hex chars
  }

  public generateSpanId(): string {
    return crypto.randomBytes(8).toString('hex'); // 16 hex chars
  }

  public parseOrCreateContext(header?: string): TraceContext {
    if (header && typeof header === 'string') {
      const match = header.trim().match(/^00-([a-f0-9]{32})-([a-f0-9]{16})-([a-f0-9]{2})$/i);
      if (match) {
        const traceId = match[1].toLowerCase();
        const parentSpanId = match[2].toLowerCase();
        const spanId = this.generateSpanId();
        const traceFlags = match[3];
        const traceparent = `00-${traceId}-${spanId}-${traceFlags}`;

        return { traceId, parentSpanId, spanId, traceFlags, traceparent };
      }
    }

    // Generate new W3C context
    const traceId = this.generateTraceId();
    const spanId = this.generateSpanId();
    const traceFlags = '01'; // sampled
    const traceparent = `00-${traceId}-${spanId}-${traceFlags}`;

    return {
      traceId,
      parentSpanId: null,
      spanId,
      traceFlags,
      traceparent,
    };
  }

  public startSpan(
    name: string,
    context: TraceContext,
    attributes: Record<string, any> = {}
  ): { spanId: string; end: (status?: 'OK' | 'ERROR', extraAttrs?: Record<string, any>) => SpanRecord } {
    const spanId = this.generateSpanId();
    const startTime = performance.now();

    const record: SpanRecord = {
      spanId,
      traceId: context.traceId,
      parentSpanId: context.spanId,
      name,
      startTime: Date.now(),
      attributes: { ...attributes },
      status: 'OK',
    };

    return {
      spanId,
      end: (status = 'OK', extraAttrs = {}) => {
        const durationMs = performance.now() - startTime;
        record.endTime = Date.now();
        record.durationMs = Math.round(durationMs * 100) / 100;
        record.status = status;
        record.attributes = { ...record.attributes, ...extraAttrs };

        this.spans.push(record);
        if (this.spans.length > 500) {
          this.spans.shift();
        }

        return record;
      },
    };
  }

  public getRecentSpans(limit = 100): SpanRecord[] {
    return this.spans.slice(-limit).reverse();
  }

  public clear(): void {
    this.spans = [];
  }
}

export const tracer = new DistributedTracer();
