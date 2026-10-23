export interface TenantQuotaPolicy {
  tenant: string;
  dailyBudgetUSD: number;
  monthlyBudgetUSD: number;
  softLimitPercent: number; // e.g. 0.80 = 80%
  actionOnExceed: 'block' | 'warn';
}

export interface QuotaCheckResult {
  allowed: boolean;
  softLimitExceeded: boolean;
  period: 'day' | 'month';
  currentSpendUSD: number;
  budgetCapUSD: number;
  percentConsumed: number;
  message?: string;
}
