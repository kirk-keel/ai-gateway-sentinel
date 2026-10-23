import { describe, it, expect } from 'vitest';
import { tokenVault, StreamingRehydrator } from '../src/vault/token-vault.js';
import { sanitizeChatRequestBody } from '../src/guardrails/index.js';

describe('Tokenization Vault: De-Identification & Re-Identification', () => {
  it('should anonymize sensitive entities into deterministic pseudo-tokens', () => {
    const session = tokenVault.createSession('test-session-1', 'drilling-ops');
    const prompt = 'Please analyze well API 42-301-32456 drilled into Wolfcamp A at 12,450 ft TVD.';

    const result = tokenVault.anonymize(prompt, session);

    expect(result.text).not.toContain('42-301-32456');
    expect(result.text).not.toContain('Wolfcamp');
    expect(result.text).not.toContain('12,450 ft TVD');

    expect(result.text).toContain('{{SENTINEL_WELL_01}}');
    expect(result.text).toContain('{{SENTINEL_FORMATION_01}}');
    expect(result.text).toContain('{{SENTINEL_DEPTH_01}}');

    expect(session.tokenToEntity['{{SENTINEL_WELL_01}}']).toContain('42-301-32456');
    expect(session.tokenToEntity['{{SENTINEL_FORMATION_01}}']).toBe('Wolfcamp A');
  });

  it('should reuse the same pseudo-token for repeated entities in the same session', () => {
    const session = tokenVault.createSession('test-session-2', 'geology');
    const text1 = 'Log data for well API 42-301-32456 is uploaded.';
    const text2 = 'Comparing well API 42-301-32456 with offset wells.';

    const res1 = tokenVault.anonymize(text1, session);
    const res2 = tokenVault.anonymize(text2, session);

    expect(res1.text).toContain('{{SENTINEL_WELL_01}}');
    expect(res2.text).toContain('{{SENTINEL_WELL_01}}');
    // Ensure counter didn't increment to 02 for the same entity
    expect(res2.text).not.toContain('{{SENTINEL_WELL_02}}');
  });

  it('should re-hydrate model responses back to real entities', () => {
    const session = tokenVault.createSession('test-session-3', 'subsurface');
    session.tokenToEntity['{{SENTINEL_WELL_01}}'] = '42-301-32456';
    session.tokenToEntity['{{SENTINEL_FORMATION_01}}'] = 'Wolfcamp A';

    const mockModelResponse =
      'Based on the petrophysical log of {{SENTINEL_WELL_01}}, production in {{SENTINEL_FORMATION_01}} is optimal.';

    const rehydrated = tokenVault.rehydrate(mockModelResponse, session);

    expect(rehydrated).toBe(
      'Based on the petrophysical log of 42-301-32456, production in Wolfcamp A is optimal.'
    );
  });

  it('should re-hydrate streaming tokens across split chunk boundaries', () => {
    const session = tokenVault.createSession('test-session-4', 'reservoir');
    session.tokenToEntity['{{SENTINEL_WELL_01}}'] = '42-301-32456';

    const rehydrator = new StreamingRehydrator(session);

    // Simulate chunk 1 with split token prefix
    const chunk1 = 'Reviewing well {{SENTINEL_W';
    const out1 = rehydrator.processChunk(chunk1);
    expect(out1).toBe('Reviewing well ');

    // Simulate chunk 2 with remaining token suffix
    const chunk2 = 'ELL_01}} status now.';
    const out2 = rehydrator.processChunk(chunk2);
    expect(out2).toBe('42-301-32456 status now.');

    const flushed = rehydrator.flush();
    expect(flushed).toBe('');
  });

  it('should seamlessly integrate vault into sanitizeChatRequestBody in anonymize mode', () => {
    const body = {
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: 'Calculate EUR for well API 42-123-45678 in Bakken.',
        },
      ],
    };

    const res = sanitizeChatRequestBody(body, {
      enabled: true,
      mode: 'anonymize',
      tenant: 'drilling',
    });

    expect(res.allowed).toBe(true);
    expect(res.hasRedactions).toBe(true);
    expect(res.session).toBeDefined();

    const scrubbedMsg = res.sanitizedBody.messages[0].content;
    expect(scrubbedMsg).toContain('{{SENTINEL_WELL_01}}');
    expect(scrubbedMsg).toContain('{{SENTINEL_FORMATION_01}}');
    expect(scrubbedMsg).not.toContain('42-123-45678');
    expect(scrubbedMsg).not.toContain('Bakken');
  });
});
