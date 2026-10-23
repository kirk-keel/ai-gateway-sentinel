export type AlertSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface SecurityAlertEvent {
  eventId: string;
  timestamp: string;
  severity: AlertSeverity;
  eventType: 'PROMPT_INJECTION' | 'PII_EXFILTRATION' | 'BUDGET_DEPLETION' | 'AUTH_BREACH';
  title: string;
  tenant: string;
  clientIp?: string;
  details: Record<string, any>;
}

export interface WebhookConfig {
  url?: string;
  enabled: boolean;
  secret?: string;
  format?: 'raw' | 'slack';
  minimumSeverity: AlertSeverity;
}
