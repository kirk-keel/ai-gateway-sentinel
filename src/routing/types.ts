export type ComplexityTier = 'simple' | 'moderate' | 'complex';

export interface RoutingDecision {
  originalModel: string;
  selectedModel: string;
  tier: ComplexityTier;
  reason: string;
  estimatedSavingsPct: number;
}

export interface ModelTierConfig {
  simpleModel: string;
  moderateModel: string;
  complexModel: string;
}
