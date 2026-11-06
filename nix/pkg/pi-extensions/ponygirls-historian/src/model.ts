export const MAX_EVENT_CHARS = 48000;
export const MAX_BATCH_CHARS = 96000;
export const MAX_BATCH_EVENTS = 48;
export const MAX_PROPOSALS = 12;
export const MAX_OUTPUT_CHARS = 48000;
export const MAX_PENDING_EVENTS = 10000;

export interface Evidence {
  ref: string;
  digest: string;
  nativeSessionId: string;
  entryId: string;
  parentId: string | null;
  actor: string;
  at: string;
  text: string;
  gaps: string[];
}
export interface SourceCursor { sourceId: string; offset: number }
export interface CaptureState { enabled: boolean; epoch: number; cursors: SourceCursor[]; gaps: string[] }
export type Section = 'objective' | 'procedure' | 'observation' | 'outcome' | 'learning' | 'decision';
export type Basis = 'observed' | 'reported' | 'hypothesis' | 'decision';
export type EpisodeKind = 'experiment' | 'investigation' | 'deployment' | 'blocker' | 'discovery';
export type EpisodeStatus = 'ongoing' | 'succeeded' | 'failed' | 'inconclusive' | 'blocked' | 'interrupted';
export interface Claim { section: Section; basis: Basis; text: string; evidence: string[] }
export interface Proposal { episodeId: string | null; expectedRevision: number; title: string; kind: EpisodeKind; status: EpisodeStatus; claims: Claim[] }
export interface Revision extends Omit<Proposal, 'episodeId' | 'expectedRevision'> {
  episodeId: string; revision: number; owner: string; recordedAt: string;
}
export interface Batch { id: string; owner: string; epoch: number; evidence: Evidence[]; gaps: string[] }
export interface ReceiptMeta { provider: string; model: string; thinking: string; objective: string; usage: unknown; attemptId?: string }

export function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected an object');
  return value as Record<string, unknown>;
}
export function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const result = object(value);
  if (Object.keys(result).length !== keys.length || !keys.every(key => Object.hasOwn(result, key))) throw new Error('Unexpected object fields');
  return result;
}
export function text(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) throw new Error(`Invalid ${name}`);
  return value;
}
function choice<T extends string>(value: unknown, name: string, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new Error(`Invalid ${name}`);
  return value as T;
}
export function validateProposals(value: unknown, allowedEvidence: ReadonlySet<string>): Proposal[] {
  if (!Array.isArray(value) || value.length > MAX_PROPOSALS) throw new Error('Expected a bounded proposals array');
  const seen = new Set<string>();
  return value.map(raw => {
    const p = exactObject(raw, ['episodeId', 'expectedRevision', 'title', 'kind', 'status', 'claims']);
    const episodeId = p.episodeId === null ? null : text(p.episodeId, 'episode ID', 100);
    if (!Number.isSafeInteger(p.expectedRevision) || (p.expectedRevision as number) < 0 || (episodeId === null && p.expectedRevision !== 0)) throw new Error('Invalid expected revision');
    if (episodeId !== null && seen.has(episodeId)) throw new Error('Duplicate episode update');
    if (episodeId !== null) seen.add(episodeId);
    if (!Array.isArray(p.claims) || !p.claims.length || p.claims.length > 30) throw new Error('Expected bounded nonempty claims');
    const claims = p.claims.map(rawClaim => {
      const c = exactObject(rawClaim, ['section', 'basis', 'text', 'evidence']);
      if (!Array.isArray(c.evidence) || !c.evidence.length || c.evidence.length > MAX_BATCH_EVENTS || !c.evidence.every(e => typeof e === 'string' && allowedEvidence.has(e))) throw new Error('Unknown or missing evidence');
      return { section: choice(c.section, 'section', ['objective', 'procedure', 'observation', 'outcome', 'learning', 'decision']),
        basis: choice(c.basis, 'basis', ['observed', 'reported', 'hypothesis', 'decision']), text: text(c.text, 'claim', 8000), evidence: [...new Set(c.evidence)] as string[] };
    });
    return { episodeId, expectedRevision: p.expectedRevision as number, title: text(p.title, 'title', 300),
      kind: choice(p.kind, 'kind', ['experiment', 'investigation', 'deployment', 'blocker', 'discovery']),
      status: choice(p.status, 'status', ['ongoing', 'succeeded', 'failed', 'inconclusive', 'blocked', 'interrupted']), claims };
  });
}
