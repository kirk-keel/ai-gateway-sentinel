import { InjectionCheckResult } from './types.js';
import { dynamicRulesManager } from '../rules/rules-manager.js';
import { detectIndirectInjection } from './indirect-injection.js';

interface InjectionPattern {
  name: string;
  weight: number;
  regex: RegExp;
  description: string;
}

// Strip invisible characters, zero-width spaces, soft hyphens, and byte-order-marks
export function stripInvisibleCharacters(text: string): string {
  return text.replace(/[\u200B-\u200D\uFEFF\u00AD\u2060\u200E\u200F\u180E]/g, '');
}

// Decode base64 chunks if present to inspect for hidden payloads
export function extractAndDecodeBase64(text: string): string {
  const base64Regex = /\b[A-Za-z0-9+/]{24,}={0,2}\b/g;
  let decodedPayloads = '';
  let match: RegExpExecArray | null;

  while ((match = base64Regex.exec(text)) !== null) {
    try {
      const decoded = Buffer.from(match[0], 'base64').toString('utf-8');
      // Only append if it looks like printable ASCII
      if (/^[\x20-\x7E\s]+$/.test(decoded)) {
        decodedPayloads += ' ' + decoded;
      }
    } catch {
      // Ignore invalid base64
    }
  }

  return decodedPayloads;
}

export const INJECTION_PATTERNS: InjectionPattern[] = [
  // High confidence directive overrides
  {
    name: 'INSTRUCTION_OVERRIDE_DIRECT',
    weight: 0.7,
    regex: /\b(?:ignore|disregard|forget|override|bypass|neglect)\s+(?:all\s+)?(?:previous|prior|above|system|initial)\s+(?:instructions|directives|prompts|rules|commands|guidelines)\b/i,
    description: 'Direct command to ignore or disregard prior system instructions',
  },
  {
    name: 'NEW_SYSTEM_ROLE_ASSIGNMENT',
    weight: 0.7,
    regex: /\b(?:(?:from\s+now\s+on\s+)?(?:you\s+are\s+(?:now\s+)?|act\s+as\s+(?:a\s+)?|behave\s+as\s+)(?:DAN|do\s+anything\s+now|unrestricted|jailbroken|evil|unfiltered|jailbreak)|(?:stands\s+for\s+)?do\s+anything\s+now)\b/i,
    description: 'Jailbreak persona assignment (DAN, unrestricted mode)',
  },
  {
    name: 'NO_RULES_EXPLOIT',
    weight: 0.5,
    regex: /\b(?:you\s+have\s+no\s+(?:rules|filters|limits|restrictions)|free\s+of\s+all\s+rules|unlimited\s+freedom)\b/i,
    description: 'Claiming the AI has no rules or restrictions',
  },
  {
    name: 'DEVELOPER_MODE_EXPLOIT',
    weight: 0.55,
    regex: /\b(?:developer\s+mode\s+enabled|enter\s+debug\s+mode|administrative\s+override\s+code|enable\s+sudo\s+mode|godmode\s+(?:on|activated|enabled))\b/i,
    description: 'Developer / Sudo mode privilege escalation attempt',
  },

  // Delimiter / Chat markup injection
  {
    name: 'DELIMITER_INJECTION_TOKENS',
    weight: 0.75,
    regex: /(?:<\|im_start\|>|<\|im_end\|>|\[\/?INST\]|<<SYS>>|<\/system>|<system>|---BEGIN (?:SYSTEM|PROMPT)---)/i,
    description: 'LLM chat template delimiter injection',
  },

  // System prompt exfiltration
  {
    name: 'SYSTEM_PROMPT_EXFILTRATION',
    weight: 0.7,
    regex: /\b(?:output|print|reveal|repeat|dump|show|display)\s+(?:(?:your|the|any)\s+)?(?:exact\s+)?(?:system\s+prompt|initial\s+(?:system\s+)?(?:pre-prompt|prompt)|system\s+instructions|base\s+instructions|developer\s+prompt)\b/i,
    description: 'Attempt to exfiltrate or leak upstream system instructions',
  },

  // Fictional / Hypothetical safety bypass
  {
    name: 'HYPOTHETICAL_SAFETY_BYPASS',
    weight: 0.7,
    regex: /\b(?:in\s+a\s+fictional\s+world\s+without\s+rules|hypothetically\s+if\s+you\s+had\s+no\s+safety|pretend\s+you\s+have\s+no\s+ethical|simulate\s+an\s+AI\s+without\s+content\s+filters)\b/i,
    description: 'Hypothetical framing designed to bypass ethical boundaries',
  },

  // Markdown / Token smuggling
  {
    name: 'TOKEN_SMUGGLING_RAW_JSON',
    weight: 0.7,
    regex: /"(?:role|system|assistant)"\s*:\s*"(?:system|admin)"\s*,\s*"content"\s*:/i,
    description: 'Attempted raw JSON message frame smuggling',
  },
];

export function detectPromptInjection(
  text: string,
  threshold = 0.65
): InjectionCheckResult {
  if (!text || typeof text !== 'string') {
    return {
      isInjection: false,
      score: 0,
      matchedRules: [],
      sanitizedText: text,
    };
  }

  // 1. Strip invisible/zero-width characters
  const sanitizedText = stripInvisibleCharacters(text);

  // 2. Extract any hidden base64 payloads to inspect jointly
  const base64Decoded = extractAndDecodeBase64(sanitizedText);
  const textToScan = sanitizedText + (base64Decoded ? ` [DECODED_BASE64: ${base64Decoded}]` : '');

  const matchedRules: string[] = [];
  let cumulativeWeight = 0;

  const dynamicPatterns = dynamicRulesManager.getActiveInjectionRules();
  const allPatterns = [...INJECTION_PATTERNS, ...dynamicPatterns];

  for (const pattern of allPatterns) {
    if (pattern.regex.test(textToScan)) {
      matchedRules.push(pattern.name);
      cumulativeWeight += pattern.weight;
    }
  }

  // Check indirect injection patterns (HTML comments, hidden system directives)
  const indirectResult = detectIndirectInjection(textToScan);
  if (indirectResult.hasInjection) {
    matchedRules.push('INDIRECT_PROMPT_INJECTION');
    cumulativeWeight += 0.75;
  }

  // Normalize score between 0 and 1.0 (cap at 1.0)
  const score = Number(Math.min(1.0, cumulativeWeight).toFixed(3));
  const isInjection = score >= threshold;

  return {
    isInjection,
    score,
    matchedRules,
    sanitizedText,
  };
}
