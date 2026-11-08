export type GrowthPolicy = { kind: 'relative'; value: number } | { kind: 'window'; value: number } | { kind: 'tokens'; value: number };
export const DEFAULT_POLICY: Readonly<GrowthPolicy> = { kind: 'window', value: 15 };

export function validatePolicy(value: unknown): GrowthPolicy {
  if (typeof value !== 'object' || value === null || !('kind' in value) || !('value' in value) ||
      typeof value.value !== 'number' || !Number.isFinite(value.value) || value.value <= 0) throw new Error('Cuckoo policy requires relative|window|tokens and a positive finite value');
  if (value.kind === 'tokens') {
    if (!Number.isSafeInteger(value.value)) throw new Error('Cuckoo token growth must be a positive safe integer');
    return { kind: value.kind, value: value.value };
  }
  if ((value.kind !== 'relative' && value.kind !== 'window') || value.value > 100) throw new Error('Cuckoo percentage policy must be relative|window with 0 < percent <= 100');
  return { kind: value.kind, value: value.value };
}
export function growthTokens(policy: GrowthPolicy, baseline: number, contextWindow: number | null): number | null {
  if (policy.kind === 'tokens') return policy.value;
  if (policy.kind === 'relative') return Math.ceil(baseline * policy.value / 100);
  if (contextWindow === null || !Number.isFinite(contextWindow) || contextWindow <= 0) return null;
  return Math.ceil(contextWindow * policy.value / 100);
}
export function policyText(policy: GrowthPolicy): string {
  if (policy.kind === 'tokens') return `${policy.value} additional tokens`;
  return policy.kind === 'relative' ? `${policy.value}% relative token growth` : `${policy.value}% of context-window capacity in additional tokens`;
}
