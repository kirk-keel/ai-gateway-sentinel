import { VaultSession } from './types.js';
import { EnvelopeCrypto, defaultEnvelopeCrypto, EncryptedEnvelope } from './kms-crypto.js';

export interface VaultStorageAdapter {
  saveSession(session: VaultSession): Promise<void>;
  getSession(sessionId: string): Promise<VaultSession | null>;
  deleteSession(sessionId: string): Promise<boolean>;
  clear(): Promise<void>;
}

export class InMemoryVaultStorageAdapter implements VaultStorageAdapter {
  private sessions = new Map<string, VaultSession>();

  public async saveSession(session: VaultSession): Promise<void> {
    this.sessions.set(session.sessionId, JSON.parse(JSON.stringify(session)));
  }

  public async getSession(sessionId: string): Promise<VaultSession | null> {
    const s = this.sessions.get(sessionId);
    if (!s) return null;
    if (Date.now() > s.expiresAt) {
      this.sessions.delete(sessionId);
      return null;
    }
    return JSON.parse(JSON.stringify(s));
  }

  public async deleteSession(sessionId: string): Promise<boolean> {
    return this.sessions.delete(sessionId);
  }

  public async clear(): Promise<void> {
    this.sessions.clear();
  }
}

export class EncryptedVaultStorageAdapter implements VaultStorageAdapter {
  private encryptedStore = new Map<string, EncryptedEnvelope>();
  private crypto: EnvelopeCrypto;

  constructor(cryptoInstance: EnvelopeCrypto = defaultEnvelopeCrypto) {
    this.crypto = cryptoInstance;
  }

  public async saveSession(session: VaultSession): Promise<void> {
    const serialized = JSON.stringify(session);
    const envelope = this.crypto.encrypt(serialized);
    this.encryptedStore.set(session.sessionId, envelope);
  }

  public async getSession(sessionId: string): Promise<VaultSession | null> {
    const envelope = this.encryptedStore.get(sessionId);
    if (!envelope) return null;

    try {
      const decrypted = this.crypto.decrypt(envelope);
      const session: VaultSession = JSON.parse(decrypted);

      if (Date.now() > session.expiresAt) {
        this.encryptedStore.delete(sessionId);
        return null;
      }

      return session;
    } catch {
      return null;
    }
  }

  public async deleteSession(sessionId: string): Promise<boolean> {
    return this.encryptedStore.delete(sessionId);
  }

  public async clear(): Promise<void> {
    this.encryptedStore.clear();
  }

  public getRawEnvelope(sessionId: string): EncryptedEnvelope | undefined {
    return this.encryptedStore.get(sessionId);
  }
}
