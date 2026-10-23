export type SlaTier = 'CRITICAL' | 'STANDARD' | 'BATCH';

export interface GpuTargetLimits {
  targetId: string;
  maxConcurrentRequests: number;
  maxInFlightTokens: number;
  queueTimeoutMs: number;
  maxQueueDepth: number;
}

export interface GpuQueueItem {
  id: string;
  targetId: string;
  estimatedTokens: number;
  priorityWeight: number; // 3 for CRITICAL, 2 for STANDARD, 1 for BATCH
  enqueuedAt: number;
  resolve: (releaseFn: () => void) => void;
  reject: (err: Error) => void;
  timeoutTimer: NodeJS.Timeout;
}

export interface GpuTargetStatus {
  targetId: string;
  activeRequests: number;
  activeTokens: number;
  queuedRequests: number;
  maxConcurrentRequests: number;
  maxInFlightTokens: number;
  totalServed: number;
  totalRejected: number;
}

const DEFAULT_LIMITS: GpuTargetLimits = {
  targetId: 'default',
  maxConcurrentRequests: 10,
  maxInFlightTokens: 32000,
  queueTimeoutMs: 5000,
  maxQueueDepth: 50,
};

export class GpuConcurrencyManager {
  private limits = new Map<string, GpuTargetLimits>();
  private activeRequests = new Map<string, number>();
  private activeTokens = new Map<string, number>();
  private queues = new Map<string, GpuQueueItem[]>();
  private servedCounts = new Map<string, number>();
  private rejectedCounts = new Map<string, number>();

  public setLimits(targetId: string, newLimits: Partial<GpuTargetLimits>): void {
    const existing = this.getLimits(targetId);
    this.limits.set(targetId, {
      ...existing,
      ...newLimits,
      targetId,
    });
  }

  public getLimits(targetId: string): GpuTargetLimits {
    return this.limits.get(targetId) || { ...DEFAULT_LIMITS, targetId };
  }

  public getStatus(targetId: string): GpuTargetStatus {
    const lim = this.getLimits(targetId);
    return {
      targetId,
      activeRequests: this.activeRequests.get(targetId) || 0,
      activeTokens: this.activeTokens.get(targetId) || 0,
      queuedRequests: (this.queues.get(targetId) || []).length,
      maxConcurrentRequests: lim.maxConcurrentRequests,
      maxInFlightTokens: lim.maxInFlightTokens,
      totalServed: this.servedCounts.get(targetId) || 0,
      totalRejected: this.rejectedCounts.get(targetId) || 0,
    };
  }

  private canExecuteImmediately(targetId: string, tokens: number): boolean {
    const lim = this.getLimits(targetId);
    const activeReq = this.activeRequests.get(targetId) || 0;
    const activeTok = this.activeTokens.get(targetId) || 0;

    return activeReq < lim.maxConcurrentRequests && activeTok + tokens <= lim.maxInFlightTokens;
  }

  public async acquireSlot(
    targetId: string,
    estimatedTokens: number,
    tier: SlaTier = 'STANDARD'
  ): Promise<() => void> {
    const lim = this.getLimits(targetId);

    // If capacity is available and no requests are ahead in the queue, run immediately
    const queue = this.queues.get(targetId) || [];
    if (queue.length === 0 && this.canExecuteImmediately(targetId, estimatedTokens)) {
      this.incrementActive(targetId, estimatedTokens);
      return () => this.releaseSlot(targetId, estimatedTokens);
    }

    // Check queue overflow
    if (queue.length >= lim.maxQueueDepth) {
      this.rejectedCounts.set(targetId, (this.rejectedCounts.get(targetId) || 0) + 1);
      throw new Error(
        `GPU Target '${targetId}' queue depth exceeded maximum limit (${lim.maxQueueDepth})`
      );
    }

    const priorityWeights: Record<SlaTier, number> = {
      CRITICAL: 3,
      STANDARD: 2,
      BATCH: 1,
    };

    return new Promise<() => void>((resolve, reject) => {
      const itemId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const timeoutTimer = setTimeout(() => {
        // Remove item from queue on timeout
        const currentQueue = this.queues.get(targetId) || [];
        const filtered = currentQueue.filter((item) => item.id !== itemId);
        this.queues.set(targetId, filtered);
        this.rejectedCounts.set(targetId, (this.rejectedCounts.get(targetId) || 0) + 1);
        reject(
          new Error(
            `GPU target '${targetId}' queue wait timed out after ${lim.queueTimeoutMs}ms`
          )
        );
      }, lim.queueTimeoutMs);

      const queueItem: GpuQueueItem = {
        id: itemId,
        targetId,
        estimatedTokens,
        priorityWeight: priorityWeights[tier],
        enqueuedAt: Date.now(),
        resolve,
        reject,
        timeoutTimer,
      };

      if (!this.queues.has(targetId)) {
        this.queues.set(targetId, []);
      }
      const targetQueue = this.queues.get(targetId)!;
      targetQueue.push(queueItem);

      // Sort queue: Higher priority weights first; if equal, earlier enqueuedAt first
      targetQueue.sort((a, b) => {
        if (b.priorityWeight !== a.priorityWeight) {
          return b.priorityWeight - a.priorityWeight;
        }
        return a.enqueuedAt - b.enqueuedAt;
      });
    });
  }

  private releaseSlot(targetId: string, tokens: number): void {
    const curReq = this.activeRequests.get(targetId) || 1;
    const curTok = this.activeTokens.get(targetId) || tokens;

    this.activeRequests.set(targetId, Math.max(0, curReq - 1));
    this.activeTokens.set(targetId, Math.max(0, curTok - tokens));
    this.servedCounts.set(targetId, (this.servedCounts.get(targetId) || 0) + 1);

    this.drainQueue(targetId);
  }

  private incrementActive(targetId: string, tokens: number): void {
    this.activeRequests.set(targetId, (this.activeRequests.get(targetId) || 0) + 1);
    this.activeTokens.set(targetId, (this.activeTokens.get(targetId) || 0) + tokens);
  }

  private drainQueue(targetId: string): void {
    const queue = this.queues.get(targetId);
    if (!queue || queue.length === 0) return;

    // Check if the next item can execute
    const nextItem = queue[0];
    if (this.canExecuteImmediately(targetId, nextItem.estimatedTokens)) {
      queue.shift(); // Remove from queue
      clearTimeout(nextItem.timeoutTimer);
      this.incrementActive(targetId, nextItem.estimatedTokens);
      nextItem.resolve(() => this.releaseSlot(targetId, nextItem.estimatedTokens));
    }
  }

  public clear(): void {
    for (const [, queue] of this.queues.entries()) {
      for (const item of queue) {
        clearTimeout(item.timeoutTimer);
      }
    }
    this.queues.clear();
    this.activeRequests.clear();
    this.activeTokens.clear();
    this.servedCounts.clear();
    this.rejectedCounts.clear();
  }
}

export const gpuConcurrencyManager = new GpuConcurrencyManager();
