export interface TraceContext {
  traceId: string;
  parentSpanId: string | null;
  spanId: string;
  traceFlags: string;
  traceparent: string;
}

export interface SpanRecord {
  spanId: string;
  traceId: string;
  parentSpanId: string | null;
  name: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  attributes: Record<string, any>;
  status: 'OK' | 'ERROR';
}
