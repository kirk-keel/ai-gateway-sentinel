import crypto from 'node:crypto';

export type KmsProviderType = 'LOCAL_KMS' | 'AWS_KMS' | 'GCP_KMS' | 'HASHICORP_VAULT';

export interface EncryptedEnvelope {
  ciphertext: string; // Base64 AES-256-GCM ciphertext
  iv: string; // Base64 12-byte IV
  authTag: string; // Base64 16-byte authentication tag
  keyVersion: number;
  provider: KmsProviderType;
  encryptedAt: string;
}

export class EnvelopeCrypto {
  private masterKey: Buffer;
  private keyVersion: number;
  private provider: KmsProviderType;

  constructor(
    masterKeySecret?: string,
    keyVersion = 1,
    provider: KmsProviderType = 'LOCAL_KMS'
  ) {
    const rawSecret = masterKeySecret || process.env.SENTINEL_VAULT_KMS_KEY || 'sentinel-default-kms-master-secret-key-32b!';
    // Derive 256-bit AES key via SHA-256
    this.masterKey = crypto.createHash('sha256').update(rawSecret).digest();
    this.keyVersion = keyVersion;
    this.provider = provider;
  }

  public setMasterKey(secret: string, version: number): void {
    this.masterKey = crypto.createHash('sha256').update(secret).digest();
    this.keyVersion = version;
  }

  public encrypt(plaintext: string): EncryptedEnvelope {
    const iv = crypto.randomBytes(12); // Standard 96-bit IV for GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);

    let ciphertext = cipher.update(plaintext, 'utf8', 'base64');
    ciphertext += cipher.final('base64');
    const authTag = cipher.getAuthTag().toString('base64');

    return {
      ciphertext,
      iv: iv.toString('base64'),
      authTag,
      keyVersion: this.keyVersion,
      provider: this.provider,
      encryptedAt: new Date().toISOString(),
    };
  }

  public decrypt(envelope: EncryptedEnvelope): string {
    const iv = Buffer.from(envelope.iv, 'base64');
    const authTag = Buffer.from(envelope.authTag, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.masterKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(envelope.ciphertext, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}

export const defaultEnvelopeCrypto = new EnvelopeCrypto();
