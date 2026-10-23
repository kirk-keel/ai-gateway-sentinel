export interface GroundednessEvaluationInput {
  response: string;
  contexts: string[];
  threshold?: number;
  action?: 'flag' | 'disclaimer' | 'suppress';
}

export interface GroundednessEvaluationResult {
  isGrounded: boolean;
  score: number;
  threshold: number;
  citationCoveragePct: number;
  totalStatements: number;
  groundedStatements: string[];
  ungroundedStatements: string[];
  processedResponse: string;
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'in', 'on', 'at', 'to', 'for', 'of',
  'and', 'or', 'with', 'by', 'that', 'this', 'it', 'from', 'as', 'be', 'been', 'have',
  'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'can', 'could', 'may'
]);

export class GroundednessEvaluator {
  private tokenizeWords(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  }

  public evaluate(input: GroundednessEvaluationInput): GroundednessEvaluationResult {
    const {
      response,
      contexts = [],
      threshold = 0.7,
      action = 'flag',
    } = input;

    if (!response || typeof response !== 'string' || contexts.length === 0) {
      return {
        isGrounded: true,
        score: 1.0,
        threshold,
        citationCoveragePct: 100,
        totalStatements: 0,
        groundedStatements: [],
        ungroundedStatements: [],
        processedResponse: response || '',
      };
    }

    // Combine all reference context tokens into a fast-lookup Set
    const combinedContextText = contexts.join(' ');
    const contextTokens = new Set(this.tokenizeWords(combinedContextText));

    // Split response into distinct sentences / factual claims
    const sentences = response
      .split(/(?<=[.!?])\s+|\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 10);

    if (sentences.length === 0) {
      return {
        isGrounded: true,
        score: 1.0,
        threshold,
        citationCoveragePct: 100,
        totalStatements: 0,
        groundedStatements: [],
        ungroundedStatements: [],
        processedResponse: response,
      };
    }

    const groundedStatements: string[] = [];
    const ungroundedStatements: string[] = [];

    for (const sentence of sentences) {
      const sentenceTokens = this.tokenizeWords(sentence);
      if (sentenceTokens.length === 0) {
        groundedStatements.push(sentence);
        continue;
      }

      let matchCount = 0;
      for (const token of sentenceTokens) {
        if (contextTokens.has(token)) {
          matchCount++;
        }
      }

      const matchRatio = matchCount / sentenceTokens.length;

      // A statement is considered grounded if >= 50% of its content keywords align with context
      if (matchRatio >= 0.5) {
        groundedStatements.push(sentence);
      } else {
        ungroundedStatements.push(sentence);
      }
    }

    const score = Number((groundedStatements.length / sentences.length).toFixed(2));
    const isGrounded = score >= threshold;
    const citationCoveragePct = Math.round(score * 100);

    let processedResponse = response;

    if (!isGrounded) {
      if (action === 'disclaimer') {
        processedResponse = `${response}\n\n> ⚠️ *Sentinel Groundedness Notice: Certain statements in this response could not be verified against referenced enterprise documentation.*`;
      } else if (action === 'suppress') {
        // Redact ungrounded claims
        let clean = response;
        for (const ungrounded of ungroundedStatements) {
          clean = clean.replace(ungrounded, '[UNVERIFIED_CLAIM_SUPPRESSED]');
        }
        processedResponse = clean;
      }
    }

    return {
      isGrounded,
      score,
      threshold,
      citationCoveragePct,
      totalStatements: sentences.length,
      groundedStatements,
      ungroundedStatements,
      processedResponse,
    };
  }
}

export const groundednessEvaluator = new GroundednessEvaluator();
