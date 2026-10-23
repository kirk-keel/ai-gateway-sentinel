export type DynamicRuleType = 'PII' | 'INJECTION';
export type DynamicRuleAction = 'BLOCK' | 'REDACT' | 'ALERT';

export interface DynamicRule {
  id: string;
  name: string;
  type: DynamicRuleType;
  pattern: string;
  isRegex: boolean;
  category?: string;
  replacementToken?: string;
  weight?: number;
  action: DynamicRuleAction;
  enabled: boolean;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDynamicRuleInput {
  id?: string;
  name: string;
  type: DynamicRuleType;
  pattern: string;
  isRegex?: boolean;
  category?: string;
  replacementToken?: string;
  weight?: number;
  action?: DynamicRuleAction;
  enabled?: boolean;
  description?: string;
}

export interface UpdateDynamicRuleInput {
  name?: string;
  pattern?: string;
  isRegex?: boolean;
  category?: string;
  replacementToken?: string;
  weight?: number;
  action?: DynamicRuleAction;
  enabled?: boolean;
  description?: string;
}
