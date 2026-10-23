import crypto from 'crypto';
import {
  DynamicRule,
  CreateDynamicRuleInput,
  UpdateDynamicRuleInput,
  DynamicRuleType,
} from './types.js';

export class DynamicRulesManager {
  private rules = new Map<string, DynamicRule>();
  private compiledCache = new Map<string, RegExp>();

  constructor() {
    this.seedDefaultRules();
  }

  private seedDefaultRules(): void {
    // Optional seed: can register initial custom rules if desired
  }

  public addRule(input: CreateDynamicRuleInput): DynamicRule {
    const id = input.id || `rule_${crypto.randomBytes(6).toString('hex')}`;
    const isRegex = input.isRegex ?? true;

    // Validate regex if regex flag is true
    if (isRegex) {
      new RegExp(input.pattern); // Throws SyntaxError if invalid
    }

    const now = new Date().toISOString();
    const rule: DynamicRule = {
      id,
      name: input.name,
      type: input.type,
      pattern: input.pattern,
      isRegex,
      category: input.category || (input.type === 'PII' ? 'CUSTOM_PII' : undefined),
      replacementToken: input.replacementToken || (input.type === 'PII' ? '[REDACTED_CUSTOM]' : undefined),
      weight: input.weight ?? (input.type === 'INJECTION' ? 0.7 : undefined),
      action: input.action || (input.type === 'PII' ? 'REDACT' : 'BLOCK'),
      enabled: input.enabled ?? true,
      description: input.description,
      createdAt: now,
      updatedAt: now,
    };

    this.rules.set(id, rule);
    this.clearCache(id);
    return rule;
  }

  public getRule(id: string): DynamicRule | undefined {
    return this.rules.get(id);
  }

  public listRules(filter?: { type?: DynamicRuleType; enabled?: boolean }): DynamicRule[] {
    let list = Array.from(this.rules.values());
    if (filter?.type) {
      list = list.filter((r) => r.type === filter.type);
    }
    if (filter?.enabled !== undefined) {
      list = list.filter((r) => r.enabled === filter.enabled);
    }
    return list;
  }

  public updateRule(id: string, input: UpdateDynamicRuleInput): DynamicRule | undefined {
    const existing = this.rules.get(id);
    if (!existing) return undefined;

    if (input.pattern !== undefined) {
      const isRegex = input.isRegex ?? existing.isRegex;
      if (isRegex) {
        new RegExp(input.pattern);
      }
    }

    const updated: DynamicRule = {
      ...existing,
      ...input,
      updatedAt: new Date().toISOString(),
    };

    this.rules.set(id, updated);
    this.clearCache(id);
    return updated;
  }

  public deleteRule(id: string): boolean {
    this.clearCache(id);
    return this.rules.delete(id);
  }

  public clearRules(): void {
    this.rules.clear();
    this.compiledCache.clear();
  }

  private clearCache(id: string): void {
    this.compiledCache.delete(id);
  }

  public getActivePiiRules(): Array<{
    category: string;
    replacementToken: string;
    regex: RegExp;
    description: string;
  }> {
    const active = this.listRules({ type: 'PII', enabled: true });
    const result: Array<{
      category: string;
      replacementToken: string;
      regex: RegExp;
      description: string;
    }> = [];

    for (const rule of active) {
      try {
        let regex = this.compiledCache.get(rule.id);
        if (!regex) {
          const pattern = rule.isRegex
            ? rule.pattern
            : rule.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          regex = new RegExp(pattern, 'gi');
          this.compiledCache.set(rule.id, regex);
        }
        result.push({
          category: rule.category || 'CUSTOM_PII',
          replacementToken: rule.replacementToken || '[REDACTED_CUSTOM]',
          regex: new RegExp(regex.source, regex.flags), // Fresh clone to avoid state race condition
          description: rule.description || rule.name,
        });
      } catch {
        // Ignore invalid regex
      }
    }

    return result;
  }

  public getActiveInjectionRules(): Array<{
    name: string;
    weight: number;
    regex: RegExp;
    description: string;
  }> {
    const active = this.listRules({ type: 'INJECTION', enabled: true });
    const result: Array<{
      name: string;
      weight: number;
      regex: RegExp;
      description: string;
    }> = [];

    for (const rule of active) {
      try {
        let regex = this.compiledCache.get(rule.id);
        if (!regex) {
          const pattern = rule.isRegex
            ? rule.pattern
            : rule.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          regex = new RegExp(pattern, 'i');
          this.compiledCache.set(rule.id, regex);
        }
        result.push({
          name: rule.name,
          weight: rule.weight ?? 0.7,
          regex: new RegExp(regex.source, regex.flags),
          description: rule.description || rule.name,
        });
      } catch {
        // Ignore invalid regex
      }
    }

    return result;
  }
}

export const dynamicRulesManager = new DynamicRulesManager();
