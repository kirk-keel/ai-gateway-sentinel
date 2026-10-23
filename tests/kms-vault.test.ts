import { describe, it, expect, beforeEach } from 'vitest';
import { EnvelopeCrypto } from '../src/vault/kms-crypto.js';
import { EncryptedVaultStorageAdapter } from '../src/vault/storage-adapter.js';
import { tokenVault } from '../src/vault/token-vault.js';
import { VaultSession } from '../src/vault/types.js';

describe('Envelope Encryption & KMS Storage Adapter', () => {
  let crypto: EnvelopeCrypto;
  let adapter: EncryptedVaultStorageAdapter;

  beforeEach(() => {
    crypto = new EnvelopeCrypto('enterprise-kms-root-secret-test-key-256', 1, 'AWS_KMS');
    adapter = new EncryptedVaultStorageAdapter(crypto);
  });

  it('encrypts plaintext with AES-256-GCM and decrypts accurately', () => {
    const sensitiveData = JSON.stringify({
      wellApi: '42-501-99887-00-00',
      coordinates: 'Lat: 31.8943 N, Lon: -102.3421 W',
      formation: 'Wolfcamp A',
    });

    const envelope = crypto.encrypt(sensitiveData);
    expect(envelope.ciphertext).toBeDefined();
    expect(envelope.iv).toBeDefined();
    expect(envelope.authTag).toBeDefined();
    expect(envelope.provider).toBe('AWS_KMS');
    expect(envelope.keyVersion).toBe(1);

    // Ciphertext must NOT contain plaintext sensitive coordinates
    expect(envelope.ciphertext).not.toContain('31.8943');

    const decrypted = crypto.decrypt(envelope);
    expect(decrypted).toBe(sensitiveData);
  });

  it('rejects tampered ciphertexts with cryptographic integrity verification failure', () => {
    const sensitiveData = 'Confidential stratigraphy top at 12,500 ft';
    const envelope = crypto.encrypt(sensitiveData);

    // Tamper with ciphertext
    const tampered = {
      ...envelope,
      ciphertext: Buffer.from('corrupted-bytes-payload').toString('base64'),
    };

    expect(() => crypto.decrypt(tampered)).toThrow();
  });

  it('stores and retrieves VaultSessions via EncryptedVaultStorageAdapter with zero plaintext leakage', async () => {
    const session: VaultSession = {
      sessionId: 'sess_kms_001',
      tenant: 'geology-team',
      tokenToEntity: {
        '{{SENTINEL_WELL_01}}': '42-501-12345-00-00',
        '{{SENTINEL_GEO_01}}': 'Lat: 29.7604 N, Lon: -95.3698 W',
      },
      entityToToken: {
        '42-501-12345-00-00': '{{SENTINEL_WELL_01}}',
        'Lat: 29.7604 N, Lon: -95.3698 W': '{{SENTINEL_GEO_01}}',
      },
      counters: { WELL: 1, GEO: 1 },
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600 * 1000,
    };

    await adapter.saveSession(session);

    // Verify raw envelope in storage is encrypted
    const rawEnvelope = adapter.getRawEnvelope('sess_kms_001');
    expect(rawEnvelope).toBeDefined();
    expect(rawEnvelope?.ciphertext).not.toContain('29.7604');
    expect(rawEnvelope?.ciphertext).not.toContain('42-501-12345');

    // Retrieve and verify decryption
    const retrieved = await adapter.getSession('sess_kms_001');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.tokenToEntity['{{SENTINEL_GEO_01}}']).toBe('Lat: 29.7604 N, Lon: -95.3698 W');
  });

  it('integrates seamlessly with TokenVaultManager', async () => {
    tokenVault.setStorageAdapter(adapter);

    const session = tokenVault.createSession('sess_integ_002', 'subsurface');
    const prompt = 'Drill site at Lat: 31.8943 N, Lon: -102.3421 W in Bone Spring.';
    const anon = tokenVault.anonymize(prompt, session);

    expect(anon.text).toContain('{{SENTINEL_GEO_01}}');
    expect(anon.text).toContain('{{SENTINEL_FORMATION_01}}');

    await tokenVault.saveSession(session);

    // Verify adapter stored encrypted session
    const rawEnvelope = adapter.getRawEnvelope('sess_integ_002');
    expect(rawEnvelope).toBeDefined();
    expect(rawEnvelope?.ciphertext).not.toContain('Bone Spring');
  });
});
