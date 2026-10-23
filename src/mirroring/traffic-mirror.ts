import { config } from '../config/env.js';
import { calculateInferenceCostUSD } from '../config/pricing.js';
import { generateTextVector, cosineSimilarity } from '../cache/vector-cache.js';
import {
  ShadowMirrorConfig,
  ShadowExecutionResult,
  ShadowMetricsSummary,
} from './types.js';

export class TrafficMirror {
  private mirrorConfig: ShadowMirrorConfig;
  private resultsBuffer: ShadowExecutionResult[] = [];

  constructor(initialConfig?: Partial<ShadowMirrorConfig>) {
    this.mirrorConfig = {
      enabled: initialConfig?.enabled ?? false,
      sampleRatePct: initialConfig?.sampleRatePct ?? 100,
      targetModel: initialConfig?.targetModel ?? 'claude-3-5-sonnet',
      targetUrl: initialConfig?.targetUrl,
      apiKey: initialConfig?.apiKey,
      divergenceThreshold: initialConfig?.divergenceThreshold ?? 0.85,
    };
  }

  public getConfig(): ShadowMirrorConfig {
    return { ...this.mirrorConfig };
  }

  public setConfig(updates: Partial<ShadowMirrorConfig>): void {
    this.mirrorConfig = { ...this.mirrorConfig, ...updates };
  }

  public shouldMirror(): boolean {
    if (!this.mirrorConfig.enabled) return false;
    if (this.mirrorConfig.sampleRatePct >= 100) return true;
    if (this.mirrorConfig.sampleRatePct <= 0) return false;
    return Math.random() * 100 < this.mirrorConfig.sampleRatePct;
  }

  public async mirrorRequest(
    primaryPayload: Record<string, any>,
    primaryResult: {
      content: string;
      model: string;
      latencyMs: number;
      costUSD?: number;
      traceId?: string;
    },
    clientAuthHeader?: string
  ): Promise<ShadowExecutionResult | null> {
    if (!this.shouldMirror()) {
      return null;
    }

    const shadowModel = this.mirrorConfig.targetModel;
    const targetUrl = (this.mirrorConfig.targetUrl || config.UPSTREAM_LLM_URL).replace(
      /\/+$/,
      ''
    );
    const url = `${targetUrl}/chat/completions`;

    const shadowPayload = {
      ...primaryPayload,
      model: shadowModel,
    };

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-sentinel-shadow-mode': 'true',
    };

    if (this.mirrorConfig.apiKey) {
      headers['authorization'] = `Bearer ${this.mirrorConfig.apiKey}`;
    } else if (clientAuthHeader) {
      headers['authorization'] = clientAuthHeader;
    }

    const t0 = performance.now();
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(shadowPayload),
      });

      const shadowLatencyMs = Number((performance.now() - t0).toFixed(2));
      if (!response.ok) {
        return null;
      }

      const data: any = await response.json();
      const shadowContent = data.choices?.[0]?.message?.content || '';

      // Compute Semantic Similarity between Primary & Shadow text
      const vecA = generateTextVector(primaryResult.content);
      const vecB = generateTextVector(shadowContent);
      const similarityScore = cosineSimilarity(vecA, vecB);

      // Calculate Shadow Cost
      const usage = data.usage || { prompt_tokens: 0, completion_tokens: 0 };
      const shadowCostUSD = calculateInferenceCostUSD(
        shadowModel,
        usage.prompt_tokens,
        usage.completion_tokens
      );

      const divergenceDetected =
        similarityScore < (this.mirrorConfig.divergenceThreshold ?? 0.85);

      const result: ShadowExecutionResult = {
        mirrored: true,
        traceId: primaryResult.traceId,
        primaryModel: primaryResult.model,
        shadowModel,
        primaryLatencyMs: primaryResult.latencyMs,
        shadowLatencyMs,
        primaryCostUSD: primaryResult.costUSD,
        shadowCostUSD,
        similarityScore,
        divergenceDetected,
        timestamp: new Date().toISOString(),
      };

      this.resultsBuffer.push(result);
      if (this.resultsBuffer.length > 100) {
        this.resultsBuffer.shift();
      }

      return result;
    } catch {
      return null;
    }
  }

  public getMetricsSummary(): ShadowMetricsSummary {
    if (this.resultsBuffer.length === 0) {
      return {
        totalMirrored: 0,
        averageSimilarity: 1.0,
        divergencesCount: 0,
        avgLatencyDeltaMs: 0,
        recentResults: [],
      };
    }

    const totalMirrored = this.resultsBuffer.length;
    let sumSimilarity = 0;
    let divergencesCount = 0;
    let sumLatencyDelta = 0;

    for (const r of this.resultsBuffer) {
      sumSimilarity += r.similarityScore ?? 1.0;
      if (r.divergenceDetected) divergencesCount++;
      if (r.shadowLatencyMs !== undefined) {
        sumLatencyDelta += r.shadowLatencyMs - r.primaryLatencyMs;
      }
    }

    return {
      totalMirrored,
      averageSimilarity: Number((sumSimilarity / totalMirrored).toFixed(3)),
      divergencesCount,
      avgLatencyDeltaMs: Number((sumLatencyDelta / totalMirrored).toFixed(2)),
      recentResults: [...this.resultsBuffer].reverse().slice(0, 20),
    };
  }

  public clear(): void {
    this.resultsBuffer = [];
  }
}

export const trafficMirror = new TrafficMirror();
