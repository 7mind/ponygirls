import { CollectorError, object, type Diagnostic } from './domain.ts';

export interface AdmissionPolicy { excludeDefaultProfile: boolean; excludedYoloProfiles: string[] }
export type CollectionOrigin = { kind: 'native' } | { kind: 'named-yolo'; name: string } | { kind: 'explicit' } | { kind: 'unknown' };
export type AdmissionReason = 'native' | 'excluded-yolo-profile' | 'explicit' | 'unknown';
const QUEUE_ROOT = 'admission-queue';
const HOLD_PREFIX = 'profile-admission-held-';
export const ROOT_DENIED = 'profile-admission-root-denied';
const REASONS: Record<AdmissionReason, string> = { native: 'native/default storage excluded', 'excluded-yolo-profile': 'named yolo profile excluded', explicit: 'explicit root origin not admissible under restrictions', unknown: 'unknown origin not admissible under restrictions' };
export const validYoloProfileName = (name: string): boolean => name.length > 0 && !/[^A-Za-z0-9._-]/.test(name) && name !== '.' && name !== '..';
export function decodeOrigin(value: unknown): CollectionOrigin {
  if (!object(value)) throw new CollectorError('invalid-pending-origin');
  if (value['kind'] === 'named-yolo' && typeof value['name'] === 'string' && validYoloProfileName(value['name']) && Object.keys(value).length === 2) return { kind: 'named-yolo', name: value['name'] };
  if ((value['kind'] === 'native' || value['kind'] === 'explicit' || value['kind'] === 'unknown') && Object.keys(value).length === 1) return { kind: value['kind'] as 'native' | 'explicit' | 'unknown' };
  throw new CollectorError('invalid-pending-origin');
}
export function admissionReason(origin: CollectionOrigin, policy: AdmissionPolicy): AdmissionReason | null {
  switch (origin.kind) {
    case 'named-yolo': return policy.excludedYoloProfiles.includes(origin.name) ? 'excluded-yolo-profile' : null;
    case 'native': return policy.excludeDefaultProfile ? 'native' : null;
    case 'explicit': case 'unknown': return policy.excludeDefaultProfile || policy.excludedYoloProfiles.length > 0 ? origin.kind : null;
  }
}
export function holdDiagnostic(sourceKey: string, reason: AdmissionReason): Diagnostic { return { rootId: QUEUE_ROOT, pathId: sourceKey, code: HOLD_PREFIX + reason }; }
export function isQueueHoldDiagnostic(diagnostic: Diagnostic): boolean { return diagnostic.rootId === QUEUE_ROOT && diagnostic.code.startsWith(HOLD_PREFIX); }
export function holdReason(diagnostic: Diagnostic): string | null {
  if (!isQueueHoldDiagnostic(diagnostic)) return null;
  const reason = diagnostic.code.slice(HOLD_PREFIX.length);
  return Object.hasOwn(REASONS, reason) ? REASONS[reason as AdmissionReason] : null;
}
