export interface ApiKeyMetadata {
  id: string;
  name: string;
  prefix: string;
  hashedKey: string;
  tenant: string;
  allowedModels: string[];
  maxTokensPerRequest: number;
  rateLimitRpm: number;
  role: 'admin' | 'standard' | 'read_only';
  createdAt: number;
  expiresAt: number | null;
  revoked: boolean;
}

export interface CreateApiKeyRequest {
  name: string;
  tenant: string;
  allowedModels?: string[];
  maxTokensPerRequest?: number;
  rateLimitRpm?: number;
  role?: 'admin' | 'standard' | 'read_only';
  expiresInDays?: number;
}

export interface CreatedApiKeyResponse {
  apiKey: string;
  metadata: Omit<ApiKeyMetadata, 'hashedKey'>;
}

export interface AuthValidationResult {
  authenticated: boolean;
  metadata?: ApiKeyMetadata;
  rejectionReason?: string;
}
