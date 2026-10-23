import { describe, it, expect } from 'vitest';
import { modelRouter } from '../src/routing/model-router.js';

describe('Intelligent Model Router: Cost Tier Optimization', () => {
  it('should recognize virtual auto-routing model names', () => {
    expect(modelRouter.isAutoRoutingModel('sentinel-auto')).toBe(true);
    expect(modelRouter.isAutoRoutingModel('SENTINEL-COST-OPTIMIZED')).toBe(true);
    expect(modelRouter.isAutoRoutingModel('auto')).toBe(true);
    expect(modelRouter.isAutoRoutingModel('gpt-4o')).toBe(false);
  });

  it('should route simple extraction or classification tasks to gpt-4o-mini', () => {
    const prompt = [{ role: 'user', content: 'Classify this email sentiment as positive or negative: Great service!' }];
    const decision = modelRouter.routeModel('sentinel-auto', prompt);

    expect(decision.tier).toBe('simple');
    expect(decision.selectedModel).toBe('gpt-4o-mini');
    expect(decision.estimatedSavingsPct).toBeGreaterThanOrEqual(90);
  });

  it('should route complex reasoning and code generation tasks to frontier model (gpt-4o)', () => {
    const prompt = [
      {
        role: 'user',
        content:
          'Derive the mathematical proof step by step for finite element discretization in reservoir fluid simulation, and write a Python implementation.',
      },
    ];
    const decision = modelRouter.routeModel('sentinel-auto', prompt);

    expect(decision.tier).toBe('complex');
    expect(decision.selectedModel).toBe('gpt-4o');
    expect(decision.estimatedSavingsPct).toBe(0);
  });

  it('should preserve explicit client model requests without overriding', () => {
    const prompt = [{ role: 'user', content: 'Say hello.' }];
    const decision = modelRouter.routeModel('claude-3-5-sonnet', prompt);

    expect(decision.selectedModel).toBe('claude-3-5-sonnet');
    expect(decision.reason).toContain('Explicit model requested');
  });
});
