import { estimateTokenCount } from '../proxy/sse-parser.js';
import { modelRoutingCounter } from '../metrics/prometheus.js';
import { ComplexityTier, ModelTierConfig, RoutingDecision } from './types.js';

export const DEFAULT_TIER_CONFIG: ModelTierConfig = {
  simpleModel: 'gpt-4o-mini',
  moderateModel: 'gpt-4o-mini',
  complexModel: 'gpt-4o',
};

const REASONING_PATTERNS = [
  /\b(?:step\s+by\s+step|chain\s+of\s+thought|detailed\s+derivation|prove|calculate\s+the\s+exact)\b/i,
  /\b(?:mathematical\s+proof|differential\s+equation|finite\s+element|thermodynamic|reservoir\s+simulation)\b/i,
  /\b(?:write\s+a\s+(?:python|typescript|c\+\+|rust|sql|go)\s+program|refactor\s+this\s+codebase)\b/i,
  /\b(?:architecture\s+design|distributed\s+consensus|concurrency\s+hazard)\b/i,
];

const SIMPLE_PATTERNS = [
  /\b(?:classify\b[\s\w]*\bas|sentiment(?:\s+analysis)?|translate\s+to|spellcheck|grammar\s+check)\b/i,
  /\b(?:extract\s+the\s+names|is\s+this\s+true\s+or\s+false|respond\s+with\s+(?:yes|no))\b/i,
  /\b(?:summarize\s+in\s+one\s+sentence|tldr|define\s+the\s+word)\b/i,
];

export class ModelRouter {
  private config: ModelTierConfig;

  constructor(config: Partial<ModelTierConfig> = {}) {
    this.config = { ...DEFAULT_TIER_CONFIG, ...config };
  }

  public isAutoRoutingModel(modelName: string): boolean {
    if (!modelName) return false;
    const lower = modelName.toLowerCase();
    return (
      lower === 'sentinel-auto' ||
      lower === 'sentinel-cost-optimized' ||
      lower === 'auto'
    );
  }

  public analyzeComplexity(messagesOrPrompt: any): { tier: ComplexityTier; reason: string } {
    let fullText = '';
    let messageCount = 1;

    if (Array.isArray(messagesOrPrompt)) {
      messageCount = messagesOrPrompt.length;
      fullText = messagesOrPrompt.map((m) => m.content || '').join('\n');
    } else if (typeof messagesOrPrompt === 'string') {
      fullText = messagesOrPrompt;
    }

    const estimatedTokens = estimateTokenCount(fullText);

    // Check for heavy complexity signals
    let reasoningSignals = 0;
    for (const pattern of REASONING_PATTERNS) {
      if (pattern.test(fullText)) {
        reasoningSignals += 1;
      }
    }

    // Check for simplicity signals
    let simpleSignals = 0;
    for (const pattern of SIMPLE_PATTERNS) {
      if (pattern.test(fullText)) {
        simpleSignals += 1;
      }
    }

    // Decision Logic
    if (reasoningSignals >= 1 || estimatedTokens > 1200 || messageCount > 6) {
      return {
        tier: 'complex',
        reason:
          reasoningSignals >= 1
            ? 'Deep reasoning/code synthesis pattern detected'
            : `High context length (${estimatedTokens} estimated tokens, ${messageCount} turns)`,
      };
    }

    if (simpleSignals >= 1 && estimatedTokens < 400 && messageCount <= 2) {
      return {
        tier: 'simple',
        reason: 'Short structured classification or extraction task',
      };
    }

    return {
      tier: 'moderate',
      reason: `Standard conversational context (${estimatedTokens} tokens)`,
    };
  }

  public routeModel(requestedModel: string, messagesOrPrompt: any): RoutingDecision {
    if (!this.isAutoRoutingModel(requestedModel)) {
      return {
        originalModel: requestedModel,
        selectedModel: requestedModel,
        tier: 'complex',
        reason: 'Explicit model requested by client',
        estimatedSavingsPct: 0,
      };
    }

    const { tier, reason } = this.analyzeComplexity(messagesOrPrompt);
    let selectedModel = this.config.complexModel;
    let estimatedSavingsPct = 0;

    if (tier === 'simple') {
      selectedModel = this.config.simpleModel;
      estimatedSavingsPct = 94; // gpt-4o-mini is ~94% cheaper than gpt-4o
    } else if (tier === 'moderate') {
      selectedModel = this.config.moderateModel;
      estimatedSavingsPct = 94;
    } else {
      selectedModel = this.config.complexModel;
      estimatedSavingsPct = 0;
    }

    modelRoutingCounter.inc({ tier, selected_model: selectedModel });

    return {
      originalModel: requestedModel,
      selectedModel,
      tier,
      reason,
      estimatedSavingsPct,
    };
  }
}

export const modelRouter = new ModelRouter();
