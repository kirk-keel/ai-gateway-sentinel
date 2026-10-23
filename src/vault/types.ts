export interface VaultSession {
  sessionId: string;
  tenant: string;
  tokenToEntity: Record<string, string>;
  entityToToken: Record<string, string>;
  counters: Record<string, number>;
  createdAt: number;
  expiresAt: number;
}

export interface AnonymizationResult {
  text: string;
  session: VaultSession;
  entityCounts: Record<string, number>;
}
