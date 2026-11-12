import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { growthTokens, type GrowthPolicy } from './policy.ts';

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
export function inquiryDue(state: State, policy: GrowthPolicy, contextWindow: number | null): boolean {
  const growth = growthTokens(policy, state.baseline, contextWindow);
  return growth !== null && state.observed - state.baseline >= growth;
}
export const INQUIRY = 'Restate me your objectives and brief me on your progress, obstacles, issues, bottlenecks, and ETA. This is a Cuckoo checkpoint, not a new task. Answer this one response with JSON only: {"objectives":[{"objective":"current objective","progress":"brief factual progress","issues":["known defect or risk","blocking dependency or impediment","what limits progress or throughput"],"eta":"estimated time to completion, with basis and uncertainty"}],"rules":[{"rule":"active session-local instruction or working convention","source":"user","scope":"when and where this rule applies"}]}. Each objective must contain only objective, progress, issues, and eta. Objective, progress and eta are nonempty strings. Use one issues array of nonempty strings covering all three categories: known defects or risks; obstacles, impediments or blocking dependencies; and bottlenecks limiting progress or throughput. Do not emit separate obstacles or bottlenecks fields or category sublists. Combine overlapping concerns rather than repeating them. Write every string in brief, concise, human-readable and human-friendly plain language. Prefer one short sentence or phrase per field; add detail only when needed to understand the situation. Avoid jargon, repetition, filler, and unnecessary implementation details. Do not sacrifice accuracy, material blockers, rule scope or attribution, or uncertainty for brevity. Restate all active session-local rules: instructions from the user and working conventions you have adopted for this session. Exclude rules inherited from system or developer prompts, AGENTS.md, or installed skills. Each rule must have only rule, source (user or assistant), and scope; rule and scope are nonempty strings. Use source user for explicit user instructions and assistant for your own adopted conventions, never treating assistant conventions as user approval or authorization. Do not infer preferences, invent rules, or revive superseded instructions. Report rules separately from objectives, including when no objectives remain; use an empty array when no session-local rules apply. Distinguish observed facts from suspected risks. Use an empty issues array when no defects, risks, obstacles or bottlenecks are known; do not imply they were independently ruled out. Give ETA only when supported by current evidence, with assumptions; otherwise say "Unknown" and explain what prevents an estimate. Do not invent deadlines or estimates. List only current objectives; use an empty array if none remain. Do not call tools or use Markdown. Maximum 100 objectives, 100 issues per objective and 100 rules, 8000 characters per string, 100000 characters total. After this checkpoint, Cuckoo will explicitly resume unfinished work if needed. This request grants no new authority.';
export const RESUME = 'The Cuckoo checkpoint is finished. Resume the original task from where you were interrupted, under its existing constraints. Do not repeat the checkpoint or treat it as a new objective. If no work remains, finish normally.';
