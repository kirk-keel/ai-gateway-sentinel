import {
  SentinelClientOptions,
  ChatCompletionRequest,
  SentinelChatCompletionResponse,
  SentinelTelemetryHeaders,
  GuardrailsCheckRequest,
  GuardrailsCheckResponse,
} from './types.js';

export class SentinelClient {
  private baseUrl: string;
  private apiKey?: string;
  private tenantId: string;
  private fetch: typeof fetch;

  public chat: {
    completions: {
      create: (params: ChatCompletionRequest) => Promise<SentinelChatCompletionResponse>;
    };
  };

  public guardrails: {
    check: (params: GuardrailsCheckRequest) => Promise<GuardrailsCheckResponse>;
  };

  public rules: {
    list: (filter?: { type?: string; enabled?: boolean }) => Promise<any[]>;
    create: (rule: Record<string, any>) => Promise<any>;
    delete: (id: string) => Promise<boolean>;
  };

  public compliance: {
    getReport: (format?: 'json' | 'csv') => Promise<any>;
  };

  constructor(options: SentinelClientOptions = {}) {
    this.baseUrl = (options.baseUrl || 'http://localhost:8000').replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.tenantId = options.tenantId || 'default';
    this.fetch = options.fetchFn || globalThis.fetch.bind(globalThis);

    this.chat = {
      completions: {
        create: this.createChatCompletion.bind(this),
      },
    };

    this.guardrails = {
      check: this.checkGuardrails.bind(this),
    };

    this.rules = {
      list: this.listRules.bind(this),
      create: this.createRule.bind(this),
      delete: this.deleteRule.bind(this),
    };

    this.compliance = {
      getReport: this.getComplianceReport.bind(this),
    };
  }

  private getHeaders(hasBody = false): Record<string, string> {
    const headers: Record<string, string> = {
      'x-tenant-id': this.tenantId,
    };
    if (hasBody) {
      headers['content-type'] = 'application/json';
    }
    if (this.apiKey) {
      headers['authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  private parseTelemetry(headers: Headers): SentinelTelemetryHeaders {
    const costStr = headers.get('x-sentinel-cost-usd');
    const latencyStr = headers.get('x-sentinel-latency-ms');
    const savingsStr = headers.get('x-sentinel-routing-savings-pct');

    return {
      costUSD: costStr ? parseFloat(costStr) : undefined,
      cached: headers.get('x-sentinel-cache') === 'HIT',
      latencyMs: latencyStr ? parseFloat(latencyStr) : undefined,
      traceId: headers.get('x-sentinel-trace-id') || undefined,
      scrubbed: headers.get('x-sentinel-guardrails-scrubbed') === 'true',
      routedModel: headers.get('x-sentinel-routed-model') || undefined,
      routingTier: headers.get('x-sentinel-routing-tier') || undefined,
      routingSavingsPct: savingsStr ? parseFloat(savingsStr) : undefined,
    };
  }

  private async createChatCompletion(
    params: ChatCompletionRequest
  ): Promise<SentinelChatCompletionResponse> {
    const url = `${this.baseUrl}/v1/chat/completions`;
    const res = await this.fetch(url, {
      method: 'POST',
      headers: this.getHeaders(true),
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const errBody = await res.text();
      let parsedErr: any;
      try {
        parsedErr = JSON.parse(errBody);
      } catch {
        parsedErr = { error: { message: errBody } };
      }
      throw new Error(
        `Sentinel Gateway Error [${res.status}]: ${parsedErr.error?.message || errBody}`
      );
    }

    const data = await res.json();
    const telemetry = this.parseTelemetry(res.headers);

    return {
      ...data,
      telemetry,
    };
  }

  private async checkGuardrails(
    params: GuardrailsCheckRequest
  ): Promise<GuardrailsCheckResponse> {
    const url = `${this.baseUrl}/v1/guardrails/check`;
    const res = await this.fetch(url, {
      method: 'POST',
      headers: this.getHeaders(true),
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      throw new Error(`Guardrails check failed with HTTP ${res.status}`);
    }

    return res.json();
  }

  private async listRules(filter?: { type?: string; enabled?: boolean }): Promise<any[]> {
    const params = new URLSearchParams();
    if (filter?.type) params.set('type', filter.type);
    if (filter?.enabled !== undefined) params.set('enabled', String(filter.enabled));

    const qs = params.toString() ? `?${params.toString()}` : '';
    const res = await this.fetch(`${this.baseUrl}/v1/rules${qs}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    const data = await res.json();
    return data.data;
  }

  private async createRule(rule: Record<string, any>): Promise<any> {
    const res = await this.fetch(`${this.baseUrl}/v1/rules`, {
      method: 'POST',
      headers: this.getHeaders(true),
      body: JSON.stringify(rule),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(`Failed to create rule: ${err.error?.message}`);
    }

    const data = await res.json();
    return data.rule;
  }

  private async deleteRule(id: string): Promise<boolean> {
    const res = await this.fetch(`${this.baseUrl}/v1/rules/${id}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });

    return res.ok;
  }

  private async getComplianceReport(format: 'json' | 'csv' = 'json'): Promise<any> {
    const res = await this.fetch(`${this.baseUrl}/v1/compliance/report?format=${format}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (format === 'csv') {
      return res.text();
    }
    return res.json();
  }
}
