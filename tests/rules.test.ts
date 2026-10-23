import { describe, it, expect, beforeEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { dynamicRulesManager } from '../src/rules/rules-manager.js';

describe('Dynamic Hot-Reloadable Rules Engine', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    dynamicRulesManager.clearRules();
    app = await buildServer();
  });

  it('creates and lists dynamic PII and Injection rules via REST API', async () => {
    // 1. Create a dynamic PII rule
    const resPii = await app.inject({
      method: 'POST',
      url: '/v1/rules',
      payload: {
        name: 'Internal Project Codename',
        type: 'PII',
        pattern: '\\bProject\\s+Chimera\\b',
        category: 'INTERNAL_CODENAME',
        replacementToken: '[REDACTED_CODENAME]',
      },
    });

    expect(resPii.statusCode).toBe(201);
    const bodyPii = JSON.parse(resPii.payload);
    expect(bodyPii.rule.id).toBeDefined();
    expect(bodyPii.rule.category).toBe('INTERNAL_CODENAME');

    // 2. Create a dynamic Injection rule
    const resInj = await app.inject({
      method: 'POST',
      url: '/v1/rules',
      payload: {
        name: 'Omega Protocol Jailbreak',
        type: 'INJECTION',
        pattern: 'OmegaProtocolBypass',
        weight: 0.85,
      },
    });

    expect(resInj.statusCode).toBe(201);
    const bodyInj = JSON.parse(resInj.payload);
    expect(bodyInj.rule.weight).toBe(0.85);

    // 3. List all rules
    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/rules',
    });
    expect(listRes.statusCode).toBe(200);
    const listBody = JSON.parse(listRes.payload);
    expect(listBody.data).toHaveLength(2);

    // 4. Filter by type=PII
    const piiFiltered = await app.inject({
      method: 'GET',
      url: '/v1/rules?type=PII',
    });
    const piiData = JSON.parse(piiFiltered.payload);
    expect(piiData.data).toHaveLength(1);
    expect(piiData.data[0].category).toBe('INTERNAL_CODENAME');
  });

  it('hot-reloads dynamic PII rules immediately into guardrails evaluation', async () => {
    const prompt = 'Review the seismic log for Project Chimera today.';

    // Before rule is added: prompt is clean
    const preCheck = await app.inject({
      method: 'POST',
      url: '/v1/guardrails/check',
      payload: { text: prompt },
    });
    const preBody = JSON.parse(preCheck.payload);
    expect(preBody.pii.hasPii).toBe(false);
    expect(preBody.sanitizedText).toBe(prompt);

    // Add dynamic rule at runtime
    await app.inject({
      method: 'POST',
      url: '/v1/rules',
      payload: {
        name: 'Project Chimera Redaction',
        type: 'PII',
        pattern: 'Project Chimera',
        category: 'CUSTOM_PROJECT',
        replacementToken: '[REDACTED_PROJECT]',
      },
    });

    // Post check: immediately redacts
    const postCheck = await app.inject({
      method: 'POST',
      url: '/v1/guardrails/check',
      payload: { text: prompt },
    });
    const postBody = JSON.parse(postCheck.payload);
    expect(postBody.pii.hasPii).toBe(true);
    expect(postBody.sanitizedText).toBe('Review the seismic log for [REDACTED_PROJECT] today.');
    expect(postBody.pii.violations[0].category).toBe('CUSTOM_PROJECT');
  });

  it('hot-reloads dynamic Injection rules and blocks adversarial requests', async () => {
    const maliciousPrompt = 'Activate OmegaProtocolBypass right now.';

    // Before rule is added: not flagged as injection
    const preCheck = await app.inject({
      method: 'POST',
      url: '/v1/guardrails/check',
      payload: { text: maliciousPrompt },
    });
    const preBody = JSON.parse(preCheck.payload);
    expect(preBody.injection.isInjection).toBe(false);

    // Register custom injection rule
    const addRuleRes = await app.inject({
      method: 'POST',
      url: '/v1/rules',
      payload: {
        name: 'Omega Bypass Signature',
        type: 'INJECTION',
        pattern: 'OmegaProtocolBypass',
        weight: 0.9,
      },
    });
    const ruleId = JSON.parse(addRuleRes.payload).rule.id;

    // Now it should be flagged as injection immediately
    const postCheck = await app.inject({
      method: 'POST',
      url: '/v1/guardrails/check',
      payload: { text: maliciousPrompt },
    });
    const postBody = JSON.parse(postCheck.payload);
    expect(postBody.injection.isInjection).toBe(true);
    expect(postBody.injection.matchedRules).toContain('Omega Bypass Signature');

    // Delete rule dynamically
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/v1/rules/${ruleId}`,
    });
    expect(delRes.statusCode).toBe(200);

    // After deletion: no longer flagged
    const afterDelCheck = await app.inject({
      method: 'POST',
      url: '/v1/guardrails/check',
      payload: { text: maliciousPrompt },
    });
    const afterDelBody = JSON.parse(afterDelCheck.payload);
    expect(afterDelBody.injection.isInjection).toBe(false);
  });

  it('rejects invalid regex patterns with 400 Bad Request', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/rules',
      payload: {
        name: 'Broken Regex Rule',
        type: 'PII',
        pattern: '[unclosed-bracket(',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.error.message).toContain('Invalid rule pattern');
  });
});
