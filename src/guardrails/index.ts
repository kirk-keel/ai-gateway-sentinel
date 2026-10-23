import { detectPromptInjection } from './injection-detector.js';
import { scrubOperationalPII } from './pii-scrubber.js';
import { GuardrailEvaluationResult } from './types.js';
import { guardrailLatencyHistogram } from '../metrics/prometheus.js';
import { recordGuardrailEvent } from '../metrics/finops.js';
import { tokenVault } from '../vault/token-vault.js';
import { VaultSession } from '../vault/types.js';
import { config } from '../config/env.js';
import { webhookDispatcher } from '../alerts/webhook-dispatcher.js';

export type GuardrailMode = 'anonymize' | 'redact' | 'block';

export interface GuardrailOptions {
  enabled?: boolean;
  mode?: GuardrailMode;
  blockOnPii?: boolean;
  injectionThreshold?: number;
  tenant?: string;
  session?: VaultSession;
}

export interface ChatMessage {
  role: string;
  content: string | Array<{ type: string; text?: string }>;
  name?: string;
}

export function extractTextFromContent(
  content: string | Array<{ type: string; text?: string }>
): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n');
  }
  return '';
}

export function updateMessageContent(
  msg: ChatMessage,
  newText: string
): ChatMessage {
  if (typeof msg.content === 'string') {
    return { ...msg, content: newText };
  }
  if (Array.isArray(msg.content)) {
    return {
      ...msg,
      content: msg.content.map((part) =>
        part.type === 'text' ? { ...part, text: newText } : part
      ),
    };
  }
  return msg;
}

export function evaluateGuardrails(
  rawText: string,
  options: GuardrailOptions = {}
): GuardrailEvaluationResult {
  const {
    blockOnPii = false,
    mode = blockOnPii ? 'block' : config.GUARDRAILS_MODE,
    injectionThreshold = config.GUARDRAILS_INJECTION_THRESHOLD,
    tenant = 'default',
  } = options;

  const startTotal = performance.now();

  // 1. Prompt Injection Defense Check
  const startInj = performance.now();
  const injectionResult = detectPromptInjection(rawText, injectionThreshold);
  const endInj = performance.now();
  guardrailLatencyHistogram.observe(
    { check_type: 'prompt_injection' },
    (endInj - startInj) / 1000
  );

  if (injectionResult.isInjection) {
    recordGuardrailEvent('prompt_injection', 'blocked', tenant);
    webhookDispatcher.emitAlert({
      severity: injectionResult.score >= 0.85 ? 'CRITICAL' : 'HIGH',
      eventType: 'PROMPT_INJECTION',
      title: `Prompt Injection Blocked (${injectionResult.matchedRules.join(', ')})`,
      tenant,
      details: {
        score: injectionResult.score,
        matchedRules: injectionResult.matchedRules,
      },
    });

    const duration = performance.now() - startTotal;
    guardrailLatencyHistogram.observe(
      { check_type: 'pipeline' },
      duration / 1000
    );

    return {
      allowed: false,
      blockedReason: `Prompt injection attack detected (confidence score: ${injectionResult.score}, matched patterns: ${injectionResult.matchedRules.join(', ')})`,
      injectionResult,
      piiResult: { hasPii: false, cleanText: rawText, violations: [], counts: {} },
      transformedContent: rawText,
      evaluationDurationMs: duration,
    };
  }

  // 2. Sensitive Operational PII & Confidential Data Detection
  const startPii = performance.now();
  const piiResult = scrubOperationalPII(injectionResult.sanitizedText);
  const endPii = performance.now();
  guardrailLatencyHistogram.observe(
    { check_type: 'pii_scrubbing' },
    (endPii - startPii) / 1000
  );

  const duration = performance.now() - startTotal;
  guardrailLatencyHistogram.observe(
    { check_type: 'pipeline' },
    duration / 1000
  );

  if (piiResult.hasPii) {
    if (mode === 'block' || blockOnPii) {
      for (const [cat] of Object.entries(piiResult.counts)) {
        recordGuardrailEvent(cat, 'blocked', tenant);
      }
      return {
        allowed: false,
        blockedReason: `Sensitive operational PII detected in strict blocking mode (${Object.keys(piiResult.counts).join(', ')})`,
        injectionResult,
        piiResult,
        transformedContent: rawText,
        evaluationDurationMs: duration,
      };
    } else {
      for (const [cat] of Object.entries(piiResult.counts)) {
        recordGuardrailEvent(cat, 'redacted', tenant);
      }
    }
  }

  return {
    allowed: true,
    injectionResult,
    piiResult,
    transformedContent: piiResult.cleanText,
    evaluationDurationMs: duration,
  };
}

export function sanitizeChatRequestBody(
  body: Record<string, any>,
  options: GuardrailOptions = {}
): {
  allowed: boolean;
  blockedReason?: string;
  violations: Array<{ rule: string; type: string }>;
  sanitizedBody: Record<string, any>;
  hasRedactions: boolean;
  session?: VaultSession;
} {
  if (options.enabled === false) {
    return {
      allowed: true,
      violations: [],
      sanitizedBody: body,
      hasRedactions: false,
    };
  }

  const {
    blockOnPii = false,
    mode = blockOnPii ? 'block' : config.GUARDRAILS_MODE,
    injectionThreshold = config.GUARDRAILS_INJECTION_THRESHOLD,
    tenant = 'default',
  } = options;

  const session =
    options.session ||
    (mode === 'anonymize' ? tokenVault.createSession(undefined, tenant) : undefined);

  const sanitizedBody = { ...body };
  let hasRedactions = false;
  const allViolations: Array<{ rule: string; type: string }> = [];

  // Check Chat Completions messages array
  if (Array.isArray(sanitizedBody.messages)) {
    const updatedMessages: ChatMessage[] = [];

    for (const msg of sanitizedBody.messages) {
      const extractedText = extractTextFromContent(msg.content);

      // Check prompt injection
      const injResult = detectPromptInjection(extractedText, injectionThreshold);
      if (injResult.isInjection) {
        recordGuardrailEvent('prompt_injection', 'blocked', tenant);
        return {
          allowed: false,
          blockedReason: `Prompt injection attack detected (confidence score: ${injResult.score}, matched patterns: ${injResult.matchedRules.join(', ')})`,
          violations: injResult.matchedRules.map((r) => ({
            rule: r,
            type: 'prompt_injection',
          })),
          sanitizedBody: body,
          hasRedactions: false,
          session,
        };
      }

      // Check PII & Apply Anonymize or Redact or Block
      if (mode === 'anonymize' && session) {
        const anonResult = tokenVault.anonymize(injResult.sanitizedText, session);
        const entityCount = Object.keys(anonResult.entityCounts).length;
        if (entityCount > 0) {
          hasRedactions = true;
          for (const [cat] of Object.entries(anonResult.entityCounts)) {
            allViolations.push({ rule: cat, type: 'vault_anonymized' });
            recordGuardrailEvent(cat, 'redacted', tenant);
          }
        }
        updatedMessages.push(updateMessageContent(msg, anonResult.text));
      } else {
        const evalResult = evaluateGuardrails(extractedText, {
          blockOnPii,
          mode,
          injectionThreshold,
          tenant,
        });

        if (!evalResult.allowed) {
          return {
            allowed: false,
            blockedReason: evalResult.blockedReason,
            violations: evalResult.injectionResult.matchedRules.map((r) => ({
              rule: r,
              type: 'prompt_injection',
            })),
            sanitizedBody: body,
            hasRedactions: false,
            session,
          };
        }

        if (evalResult.piiResult.hasPii) {
          hasRedactions = true;
          for (const [category] of Object.entries(evalResult.piiResult.counts)) {
            allViolations.push({ rule: category, type: 'pii_redacted' });
          }
        }

        updatedMessages.push(
          updateMessageContent(msg, evalResult.transformedContent)
        );
      }
    }

    sanitizedBody.messages = updatedMessages;
  }

  // Check legacy prompt string if present (e.g. /v1/completions)
  if (typeof sanitizedBody.prompt === 'string') {
    const injResult = detectPromptInjection(sanitizedBody.prompt, injectionThreshold);
    if (injResult.isInjection) {
      recordGuardrailEvent('prompt_injection', 'blocked', tenant);
      return {
        allowed: false,
        blockedReason: `Prompt injection attack detected`,
        violations: injResult.matchedRules.map((r) => ({
          rule: r,
          type: 'prompt_injection',
        })),
        sanitizedBody: body,
        hasRedactions: false,
        session,
      };
    }

    if (mode === 'anonymize' && session) {
      const anonResult = tokenVault.anonymize(injResult.sanitizedText, session);
      if (Object.keys(anonResult.entityCounts).length > 0) {
        hasRedactions = true;
      }
      sanitizedBody.prompt = anonResult.text;
    } else {
      const evalResult = evaluateGuardrails(sanitizedBody.prompt, {
        blockOnPii,
        mode,
        injectionThreshold,
        tenant,
      });
      if (!evalResult.allowed) {
        return {
          allowed: false,
          blockedReason: evalResult.blockedReason,
          violations: evalResult.injectionResult.matchedRules.map((r) => ({
            rule: r,
            type: 'prompt_injection',
          })),
          sanitizedBody: body,
          hasRedactions: false,
          session,
        };
      }
      if (evalResult.piiResult.hasPii) {
        hasRedactions = true;
      }
      sanitizedBody.prompt = evalResult.transformedContent;
    }
  }

  return {
    allowed: true,
    violations: allViolations,
    sanitizedBody,
    hasRedactions,
    session,
  };
}
