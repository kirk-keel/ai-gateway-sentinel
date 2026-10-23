export interface OutputGuardrailResult {
  isSafe: boolean;
  cleanText: string;
  violations: string[];
}

const OUTPUT_LEAK_PATTERNS = [
  {
    name: 'SYSTEM_PROMPT_LEAK_CONFIRMATION',
    regex: /(?:here\s+is\s+my\s+system\s+prompt|my\s+instructions\s+are\s+as\s+follows|the\s+system\s+prompt\s+instructs\s+me\s+to|i\s+was\s+initialized\s+with\s+the\s+following\s+prompt)\s*:/i,
    replacement: '[REDACTED: System instructions disclosure suppressed]',
  },
  {
    name: 'UNSAFE_COMMAND_EXECUTION',
    regex: /(?:rm\s+-rf\s+\/|curl\s+[\w\.\/:-]+\s*\|\s*(?:bash|sh)|cat\s+\/etc\/(?:passwd|shadow)|DROP\s+DATABASE|DROP\s+TABLE\s+[\w_]+;)/gi,
    replacement: '[REDACTED: Destructive system/database command suppressed]',
  },
  {
    name: 'PRIVATE_KEY_LEAK',
    regex: /-----BEGIN\s+(?:[A-Z0-9_\-\s]+)?KEY-----[\s\S]*?-----END\s+(?:[A-Z0-9_\-\s]+)?KEY-----/gi,
    replacement: '[REDACTED_PRIVATE_KEY]',
  },
];

export function inspectModelOutput(text: string): OutputGuardrailResult {
  if (!text || typeof text !== 'string') {
    return { isSafe: true, cleanText: text, violations: [] };
  }

  let cleanText = text;
  const violations: string[] = [];

  for (const pattern of OUTPUT_LEAK_PATTERNS) {
    pattern.regex.lastIndex = 0;
    if (pattern.regex.test(cleanText)) {
      violations.push(pattern.name);
      pattern.regex.lastIndex = 0;
      cleanText = cleanText.replace(pattern.regex, pattern.replacement);
    }
  }

  return {
    isSafe: violations.length === 0,
    cleanText,
    violations,
  };
}
