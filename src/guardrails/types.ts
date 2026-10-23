export interface PiiViolation {
  category: string;
  matchedText: string;
  replacementToken: string;
  index?: number;
}

export interface PiiScrubResult {
  hasPii: boolean;
  cleanText: string;
  violations: PiiViolation[];
  counts: Record<string, number>;
}

export interface InjectionCheckResult {
  isInjection: boolean;
  score: number;
  matchedRules: string[];
  sanitizedText: string;
}

export interface GuardrailEvaluationResult {
  allowed: boolean;
  blockedReason?: string;
  injectionResult: InjectionCheckResult;
  piiResult: PiiScrubResult;
  transformedContent: string;
  evaluationDurationMs: number;
}
