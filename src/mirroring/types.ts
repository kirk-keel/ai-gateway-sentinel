export interface ShadowMirrorConfig {
  enabled: boolean;
  sampleRatePct: number; // e.g. 20 for 20% of traffic
  targetModel: string; // e.g. 'claude-3-5-sonnet' or 'llama-3.3-70b'
  targetUrl?: string; // Optional different upstream endpoint
  apiKey?: string;
  divergenceThreshold?: number; // e.g. 0.85 cosine similarity threshold
}

export interface ShadowExecutionResult {
  mirrored: boolean;
  traceId?: string;
  primaryModel: string;
  shadowModel: string;
  primaryLatencyMs: number;
  shadowLatencyMs?: number;
  primaryCostUSD?: number;
  shadowCostUSD?: number;
  similarityScore?: number;
  divergenceDetected?: boolean;
  timestamp: string;
}

export interface ShadowMetricsSummary {
  totalMirrored: number;
  averageSimilarity: number;
  divergencesCount: number;
  avgLatencyDeltaMs: number;
  recentResults: ShadowExecutionResult[];
}
