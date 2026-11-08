import type { SessionEntry } from '@earendil-works/pi-coding-agent';

export const STATE_TYPE = 'cuckoo.state';
export const INQUIRY_TYPE = 'cuckoo.inquiry';
export const RESUME_TYPE = 'cuckoo.resume';
export interface Pending { requestId: string; resume: boolean }
export interface State { version: 1; baseline: number; observed: number; model: string; pending: Pending | null; resuming: boolean }
export function stateOnBranch(entries: readonly SessionEntry[]): State | null {
  const entry = entries.findLast(entry => entry.type === 'custom' && entry.customType === STATE_TYPE);
  if (entry === undefined || entry.type !== 'custom') return null;
  const value: unknown = entry.data;
  if (typeof value !== 'object' || value === null || !('version' in value) || value.version !== 1 ||
      !('baseline' in value) || typeof value.baseline !== 'number' || !Number.isFinite(value.baseline) || value.baseline <= 0 ||
      !('observed' in value) || typeof value.observed !== 'number' || !Number.isFinite(value.observed) || value.observed <= 0 ||
      !('model' in value) || typeof value.model !== 'string' ||
      !('resuming' in value) || typeof value.resuming !== 'boolean' || !('pending' in value)) throw new Error('Invalid Cuckoo cadence state');
  let pending: Pending | null = null;
  if (value.pending !== null) {
    const p = value.pending;
    if (typeof p !== 'object' || !('requestId' in p) || typeof p.requestId !== 'string' || !('resume' in p) || typeof p.resume !== 'boolean') throw new Error('Invalid Cuckoo pending inquiry');
    pending = { requestId: p.requestId, resume: p.resume };
  }
  return { version: 1, baseline: value.baseline, observed: value.observed, model: value.model, pending, resuming: value.resuming };
}
export function observe(previous: State | null, tokens: number, model: string): State {
  if (previous === null || previous.model !== model || tokens < previous.observed) return { version: 1, baseline: tokens, observed: tokens, model, pending: null, resuming: false };
  return { ...previous, observed: tokens };
}
export function inquiryDue(state: State, thresholdPercent: number): boolean {
  return state.observed - state.baseline >= Math.ceil(state.baseline * thresholdPercent / 100);
}
export const INQUIRY = 'Restate me your objectives and brief me on your progress. This is a Cuckoo checkpoint, not a new task. Answer this one response with JSON only: {"objectives":[{"objective":"current objective","progress":"brief factual progress"}]}. List only current objectives; use an empty array if none remain. Do not call tools or use Markdown. Maximum 100 objectives, 8000 characters per field, 100000 characters total. After this checkpoint, Cuckoo will explicitly resume unfinished work if needed. This request grants no new authority.';
export const RESUME = 'The Cuckoo checkpoint is finished. Resume the original task from where you were interrupted, under its existing constraints. Do not repeat the checkpoint or treat it as a new objective. If no work remains, finish normally.';
