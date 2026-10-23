import { config } from '../config/env.js';
import {
  tenantBudgetSpentGauge,
  tenantBudgetLimitGauge,
  quotaBlocksCounter,
} from '../metrics/prometheus.js';
import { QuotaCheckResult, TenantQuotaPolicy } from './types.js';

export class TenantBudgetManager {
  private policies = new Map<string, TenantQuotaPolicy>();
  // In-memory spend tracker (dayKey -> spendUSD, monthKey -> spendUSD)
  private spendStore = new Map<string, number>();

  constructor() {
    // Default wildcard policy
    this.policies.set('default', {
      tenant: 'default',
      dailyBudgetUSD: config.DEFAULT_DAILY_BUDGET_USD,
      monthlyBudgetUSD: config.DEFAULT_MONTHLY_BUDGET_USD,
      softLimitPercent: 0.8,
      actionOnExceed: 'block',
    });
  }

  public setPolicy(policy: TenantQuotaPolicy): void {
    this.policies.set(policy.tenant, policy);
    tenantBudgetLimitGauge.set(
      { tenant: policy.tenant, period: 'day' },
      policy.dailyBudgetUSD
    );
    tenantBudgetLimitGauge.set(
      { tenant: policy.tenant, period: 'month' },
      policy.monthlyBudgetUSD
    );
  }

  public getPolicy(tenant: string): TenantQuotaPolicy {
    return (
      this.policies.get(tenant) || {
        tenant,
        dailyBudgetUSD: config.DEFAULT_DAILY_BUDGET_USD,
        monthlyBudgetUSD: config.DEFAULT_MONTHLY_BUDGET_USD,
        softLimitPercent: 0.8,
        actionOnExceed: 'block',
      }
    );
  }

  public getAllPolicies(): TenantQuotaPolicy[] {
    return Array.from(this.policies.values());
  }

  private getKeys(tenant: string): { dayKey: string; monthKey: string } {
    const now = new Date();
    const day = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const month = now.toISOString().slice(0, 7); // YYYY-MM
    return {
      dayKey: `quota:${tenant}:day:${day}`,
      monthKey: `quota:${tenant}:month:${month}`,
    };
  }

  public async getSpend(tenant: string): Promise<{ spentToday: number; spentThisMonth: number }> {
    const { dayKey, monthKey } = this.getKeys(tenant);
    const spentToday = Number((this.spendStore.get(dayKey) || 0).toFixed(6));
    const spentThisMonth = Number((this.spendStore.get(monthKey) || 0).toFixed(6));
    return { spentToday, spentThisMonth };
  }

  public async recordSpend(tenant: string, costUSD: number): Promise<void> {
    if (costUSD <= 0) return;

    const { dayKey, monthKey } = this.getKeys(tenant);
    const currentDay = this.spendStore.get(dayKey) || 0;
    const currentMonth = this.spendStore.get(monthKey) || 0;

    const newDaySpend = Number((currentDay + costUSD).toFixed(6));
    const newMonthSpend = Number((currentMonth + costUSD).toFixed(6));

    this.spendStore.set(dayKey, newDaySpend);
    this.spendStore.set(monthKey, newMonthSpend);

    tenantBudgetSpentGauge.set({ tenant, period: 'day' }, newDaySpend);
    tenantBudgetSpentGauge.set({ tenant, period: 'month' }, newMonthSpend);
  }

  public async checkBudget(tenant: string): Promise<QuotaCheckResult> {
    if (!config.BUDGET_ENFORCEMENT_ENABLED) {
      return {
        allowed: true,
        softLimitExceeded: false,
        period: 'day',
        currentSpendUSD: 0,
        budgetCapUSD: Infinity,
        percentConsumed: 0,
      };
    }

    const policy = this.getPolicy(tenant);
    const { spentToday, spentThisMonth } = await this.getSpend(tenant);

    tenantBudgetLimitGauge.set({ tenant, period: 'day' }, policy.dailyBudgetUSD);
    tenantBudgetLimitGauge.set({ tenant, period: 'month' }, policy.monthlyBudgetUSD);
    tenantBudgetSpentGauge.set({ tenant, period: 'day' }, spentToday);
    tenantBudgetSpentGauge.set({ tenant, period: 'month' }, spentThisMonth);

    // 1. Check daily budget
    const dayRatio = spentToday / policy.dailyBudgetUSD;
    if (spentToday >= policy.dailyBudgetUSD) {
      if (policy.actionOnExceed === 'block') {
        quotaBlocksCounter.inc({ tenant, period: 'day' });
        return {
          allowed: false,
          softLimitExceeded: true,
          period: 'day',
          currentSpendUSD: spentToday,
          budgetCapUSD: policy.dailyBudgetUSD,
          percentConsumed: Math.round(dayRatio * 100),
          message: `Daily budget quota exceeded for tenant '${tenant}': spent $${spentToday.toFixed(4)} of $${policy.dailyBudgetUSD.toFixed(2)} limit.`,
        };
      }
    }

    // 2. Check monthly budget
    const monthRatio = spentThisMonth / policy.monthlyBudgetUSD;
    if (spentThisMonth >= policy.monthlyBudgetUSD) {
      if (policy.actionOnExceed === 'block') {
        quotaBlocksCounter.inc({ tenant, period: 'month' });
        return {
          allowed: false,
          softLimitExceeded: true,
          period: 'month',
          currentSpendUSD: spentThisMonth,
          budgetCapUSD: policy.monthlyBudgetUSD,
          percentConsumed: Math.round(monthRatio * 100),
          message: `Monthly budget quota exceeded for tenant '${tenant}': spent $${spentThisMonth.toFixed(4)} of $${policy.monthlyBudgetUSD.toFixed(2)} limit.`,
        };
      }
    }

    // Check soft limits
    const softLimitExceeded =
      dayRatio >= policy.softLimitPercent || monthRatio >= policy.softLimitPercent;

    return {
      allowed: true,
      softLimitExceeded,
      period: dayRatio >= policy.softLimitPercent ? 'day' : 'month',
      currentSpendUSD: Math.max(spentToday, spentThisMonth),
      budgetCapUSD:
        dayRatio >= policy.softLimitPercent
          ? policy.dailyBudgetUSD
          : policy.monthlyBudgetUSD,
      percentConsumed: Math.round(Math.max(dayRatio, monthRatio) * 100),
      message: softLimitExceeded
        ? `Warning: Tenant '${tenant}' has reached ${Math.round(Math.max(dayRatio, monthRatio) * 100)}% of its budget cap.`
        : undefined,
    };
  }

  // Reset helper for testing
  public clearSpend(): void {
    this.spendStore.clear();
  }
}

export const tenantBudgetManager = new TenantBudgetManager();
