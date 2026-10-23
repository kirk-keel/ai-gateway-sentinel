export interface IndirectInjectionResult {
  hasInjection: boolean;
  score: number;
  flaggedFragments: string[];
}

const INDIRECT_INJECTION_PATTERNS = [
  // Hidden instructions in third party text / markdown comments
  /(?:<!--[\s\S]*?(?:ignore|bypass|system\s+prompt|send\s+data)[\s\S]*?-->)/i,
  // Markdown links with malicious intent or data exfiltration URLs
  /\[(?:click\s+here|verify|download)\]\(https?:\/\/[^\s\)]+(?:\?|&)exfil=/i,
  // Prompt override embedded in retrieved context or quotes
  /\[(?:NOTE|SYSTEM|OVERRIDE|INSTRUCTION):\s*(?:disregard\s+all\s+prior|ignore\s+previous|new\s+system\s+directive)[^\]]*\]/i,
  // Fake assistant or system turn injection in body
  /\n(?:Assistant|System|Human):\s*(?:Disregard|Forget\s+everything|You\s+are\s+now)\b/i,
];

export function detectIndirectInjection(text: string): IndirectInjectionResult {
  if (!text || typeof text !== 'string') {
    return { hasInjection: false, score: 0, flaggedFragments: [] };
  }

  const flaggedFragments: string[] = [];
  let score = 0;

  for (const pattern of INDIRECT_INJECTION_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      flaggedFragments.push(match[0]);
      score += 0.5;
    }
  }

  const normalizedScore = Number(Math.min(1.0, score).toFixed(2));
  return {
    hasInjection: normalizedScore >= 0.5,
    score: normalizedScore,
    flaggedFragments,
  };
}
