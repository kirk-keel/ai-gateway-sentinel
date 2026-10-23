import { describe, it, expect, beforeEach } from 'vitest';
import { GpuConcurrencyManager } from '../src/resilience/gpu-concurrency-manager.js';

describe('Adaptive GPU Concurrency & Leaky-Bucket Queueing', () => {
  let manager: GpuConcurrencyManager;

  beforeEach(() => {
    manager = new GpuConcurrencyManager();
    manager.setLimits('vllm-cluster', {
      maxConcurrentRequests: 2,
      maxInFlightTokens: 4000,
      queueTimeoutMs: 100,
      maxQueueDepth: 10,
    });
  });

  it('allows execution immediately when capacity is below limit', async () => {
    const release1 = await manager.acquireSlot('vllm-cluster', 500, 'STANDARD');
    const release2 = await manager.acquireSlot('vllm-cluster', 500, 'STANDARD');

    const status = manager.getStatus('vllm-cluster');
    expect(status.activeRequests).toBe(2);
    expect(status.activeTokens).toBe(1000);
    expect(status.queuedRequests).toBe(0);

    release1();
    release2();

    const statusAfter = manager.getStatus('vllm-cluster');
    expect(statusAfter.activeRequests).toBe(0);
    expect(statusAfter.activeTokens).toBe(0);
  });

  it('queues requests when concurrency limit is reached and drains on release', async () => {
    const release1 = await manager.acquireSlot('vllm-cluster', 500);
    const release2 = await manager.acquireSlot('vllm-cluster', 500);

    let thirdAcquired = false;
    const thirdPromise = manager.acquireSlot('vllm-cluster', 500).then((release3) => {
      thirdAcquired = true;
      return release3;
    });

    // 3rd should be queued
    expect(thirdAcquired).toBe(false);
    expect(manager.getStatus('vllm-cluster').queuedRequests).toBe(1);

    // Release 1st slot, which should immediately trigger 3rd slot
    release1();
    const release3 = await thirdPromise;
    expect(thirdAcquired).toBe(true);

    release2();
    release3();
  });

  it('prioritizes CRITICAL SLA requests ahead of BATCH requests in queue', async () => {
    // Fill up the 2 slots
    const release1 = await manager.acquireSlot('vllm-cluster', 500);
    const release2 = await manager.acquireSlot('vllm-cluster', 500);

    const executionOrder: string[] = [];
    let releaseCriticalSlot: (() => void) | null = null;

    // Enqueue a BATCH request first
    const batchPromise = manager
      .acquireSlot('vllm-cluster', 500, 'BATCH')
      .then((rel) => {
        executionOrder.push('BATCH');
        rel();
      });

    // Enqueue a CRITICAL request second
    const criticalPromise = manager
      .acquireSlot('vllm-cluster', 500, 'CRITICAL')
      .then((rel) => {
        executionOrder.push('CRITICAL');
        releaseCriticalSlot = rel;
      });

    expect(manager.getStatus('vllm-cluster').queuedRequests).toBe(2);

    // Release only 1 active slot
    release1();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // CRITICAL should have acquired the single released slot first
    expect(executionOrder).toEqual(['CRITICAL']);
    expect(releaseCriticalSlot).not.toBeNull();

    // Now release critical slot so BATCH can run
    if (releaseCriticalSlot) {
      (releaseCriticalSlot as () => void)();
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(executionOrder).toEqual(['CRITICAL', 'BATCH']);

    release2();
  });

  it('rejects with timeout when request stays in queue longer than queueTimeoutMs', async () => {
    // Fill up slots
    const release1 = await manager.acquireSlot('vllm-cluster', 500);
    const release2 = await manager.acquireSlot('vllm-cluster', 500);

    // 3rd request waits on full queue with 100ms timeout
    await expect(manager.acquireSlot('vllm-cluster', 500)).rejects.toThrow(
      /queue wait timed out/i
    );

    release1();
    release2();
  });
});
