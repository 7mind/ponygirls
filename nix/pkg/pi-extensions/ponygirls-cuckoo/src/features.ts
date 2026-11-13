export type FeatureId = 'evidence' | 'corrections' | 'verifiers' | 'reader' | 'transfer' | 'vectors' | 'critic';
export type FeatureSwitches = Readonly<Record<FeatureId, boolean>>;

export interface FeatureDescription {
  readonly id: FeatureId;
  readonly label: string;
  readonly description: string;
  readonly requires: readonly FeatureId[];
}

export const FEATURES: readonly FeatureDescription[] = Object.freeze(([
  { id: 'evidence', label: 'Evidence & work products', description: 'Capture exact visible transcript selections and model-authored claims; stored claims are not verified facts.', requires: [] },
  { id: 'corrections', label: 'Corrections & invalidation', description: 'Create explicit corrections. Existing corrections always affect projection, even when this switch is off.', requires: ['evidence'] },
  { id: 'verifiers', label: 'Scoped verification', description: 'Run trusted, bounded checkers on exact snapshots. A syntax pass is not task correctness.', requires: ['evidence'] },
  { id: 'reader', label: 'Scoped memory reader', description: 'List and inspect stored memory with bounded, lossless text paging and explicit historical scope.', requires: [] },
  { id: 'transfer', label: 'Session transfer', description: 'Export selected records and read explicitly approved external history; no inherited authority or automatic imports.', requires: [] },
  { id: 'vectors', label: 'Vector retrieval', description: 'Retrieve approved snapshots using a configured encoder. Separate disclosure approval is required; similarity is not truth.', requires: ['reader'] },
  { id: 'critic', label: 'Advisory critic', description: 'Run a bounded, tool-free review of approved records. Separate disclosure approval is required; advice grants no authority.', requires: ['evidence'] },
] satisfies readonly FeatureDescription[]).map(item => Object.freeze({ ...item, requires: Object.freeze(item.requires) })));

export const DEFAULT_FEATURES: FeatureSwitches = Object.freeze({
  evidence: false, corrections: false, verifiers: false, reader: false,
  transfer: false, vectors: false, critic: false,
});

export function featureId(value: string): FeatureId {
  const found = FEATURES.find(feature => feature.id === value);
  if (found === undefined) throw new Error(`Unknown Cuckoo feature: ${value}`);
  return found.id;
}

export interface FeatureActivation {
  readonly activeBySettings: boolean;
  readonly reasons: readonly string[];
}

export function featureActivation(enabled: boolean, features: FeatureSwitches, id: FeatureId): FeatureActivation {
  const definition = FEATURES.find(feature => feature.id === id);
  if (definition === undefined) throw new Error('Unknown Cuckoo feature');
  const reasons: string[] = [];
  if (!enabled) reasons.push('Cuckoo is off');
  if (!features[id]) reasons.push('feature is off');
  for (const dependency of definition.requires) {
    if (!features[dependency]) reasons.push(`${dependency} is off`);
  }
  return { activeBySettings: reasons.length === 0, reasons };
}
