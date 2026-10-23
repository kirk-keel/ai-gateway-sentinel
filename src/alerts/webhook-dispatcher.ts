import crypto from 'node:crypto';
import { securityAlertsCounter } from '../metrics/prometheus.js';
import { AlertSeverity, SecurityAlertEvent, WebhookConfig } from './types.js';

const SEVERITY_LEVELS: Record<AlertSeverity, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

export class WebhookDispatcher {
  private config: WebhookConfig;
  private recentAlerts: SecurityAlertEvent[] = [];

  constructor(config: Partial<WebhookConfig> = {}) {
    this.config = {
      url: config.url || process.env.ALERT_WEBHOOK_URL,
      enabled: config.enabled ?? Boolean(process.env.ALERT_WEBHOOK_URL),
      secret: config.secret || process.env.ALERT_WEBHOOK_SECRET,
      format: config.format || 'raw',
      minimumSeverity: config.minimumSeverity || 'HIGH',
    };
  }

  public setConfig(newConfig: Partial<WebhookConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  public getRecentAlerts(limit = 50): SecurityAlertEvent[] {
    return this.recentAlerts.slice(-limit).reverse();
  }

  public async emitAlert(
    event: Omit<SecurityAlertEvent, 'eventId' | 'timestamp'>
  ): Promise<SecurityAlertEvent | null> {
    const fullEvent: SecurityAlertEvent = {
      ...event,
      eventId: `alert_${crypto.randomBytes(8).toString('hex')}`,
      timestamp: new Date().toISOString(),
    };

    // Store in recent buffer
    this.recentAlerts.push(fullEvent);
    if (this.recentAlerts.length > 200) {
      this.recentAlerts.shift();
    }

    // Increment Prometheus counter
    securityAlertsCounter.inc({
      severity: fullEvent.severity,
      event_type: fullEvent.eventType,
    });

    // Check minimum severity threshold
    const eventLevel = SEVERITY_LEVELS[fullEvent.severity] || 1;
    const minLevel = SEVERITY_LEVELS[this.config.minimumSeverity] || 3;
    if (eventLevel < minLevel) {
      return fullEvent;
    }

    // If webhook is disabled or no URL configured, return recorded event
    if (!this.config.enabled || !this.config.url) {
      return fullEvent;
    }

    // Dispatch webhook asynchronously without blocking caller
    this.dispatchWebhook(fullEvent).catch((err) => {
      console.warn(`[WebhookDispatcher] Failed to deliver alert webhook: ${err.message}`);
    });

    return fullEvent;
  }

  private async dispatchWebhook(event: SecurityAlertEvent): Promise<void> {
    if (!this.config.url) return;

    let payload: any = event;

    // Slack Block Kit format
    if (this.config.format === 'slack') {
      const emoji =
        event.severity === 'CRITICAL' ? '🚨' : event.severity === 'HIGH' ? '⚠️' : 'ℹ️';
      payload = {
        text: `${emoji} *[AI Gateway Sentinel]* ${event.title}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${emoji} *${event.title}*\n*Severity:* \`${event.severity}\` | *Tenant:* \`${event.tenant}\`\n*Event Type:* \`${event.eventType}\``,
            },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `\`\`\`${JSON.stringify(event.details, null, 2)}\`\`\``,
            },
          },
        ],
      };
    }

    const payloadJson = JSON.stringify(payload);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'user-agent': 'AI-Gateway-Sentinel/1.0',
    };

    if (this.config.secret) {
      const signature = crypto
        .createHmac('sha256', this.config.secret)
        .update(payloadJson)
        .digest('hex');
      headers['x-sentinel-signature'] = signature;
    }

    await fetch(this.config.url, {
      method: 'POST',
      headers,
      body: payloadJson,
      signal: AbortSignal.timeout(5000),
    });
  }

  public clear(): void {
    this.recentAlerts = [];
  }
}

export const webhookDispatcher = new WebhookDispatcher();
