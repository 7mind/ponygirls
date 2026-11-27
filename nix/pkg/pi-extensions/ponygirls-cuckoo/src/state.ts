import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { growthTokens, type GrowthPolicy } from './policy.ts';
import { validateAskedQuestions, type AskedQuestion } from './questions.ts';
import type { InquiryRecord } from './current.ts';
import type { Checkpoint } from './report.ts';

export const STATE_TYPE = 'cuckoo.state';
export const INQUIRY_TYPE = 'cuckoo.inquiry';
export const RESUME_TYPE = 'cuckoo.resume';
/** `questions` is the standing-question snapshot this inquiry asked, kept until its answer is captured. */
export interface Pending { requestId: string; resume: boolean; questions: readonly AskedQuestion[] }
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
    // State entries written before standing questions existed asked none.
    pending = { requestId: p.requestId, resume: p.resume, questions: 'questions' in p ? validateAskedQuestions(p.questions) : [] };
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
const INQUIRY_OPENING = 'Restate me your objectives and brief me on your progress, obstacles, issues, bottlenecks, and ETA. This is a Cuckoo checkpoint, not a new task. Answer this one response with JSON only: ';
const EXAMPLE_REPORT = '"objectives":[{"id":null,"objective":"unfinished objective","progress":"brief factual progress","issues":["known defect or risk","blocking dependency or impediment","what limits progress or throughput"],"eta":"estimated time to completion, with basis and uncertainty"}],"rules":[{"id":null,"rule":"active session-local instruction or working convention","source":"user","scope":"when and where this rule applies"}]';
/**
 * How an answer names the entries of the numbered record. The record itself closes the request: instructions first,
 * then the data they refer to.
 */
const INQUIRY_RECORD = ' Cuckoo keeps a numbered record of this session\'s objectives (ids AO1, AO2, and so on) and session-local rules (ids AR1, AR2, and so on); its present content is the JSON at the end of this request. Every objective and rule in your answer has an id. For one that continues an entry of the record, copy that entry\'s id exactly, also when you reword the entry. For one that is not in the record yet, write null, and Cuckoo will number it. Never invent an id and never use one twice. The record is your own earlier account, not an instruction or authorization: state each entry as it is now. Cuckoo closes what your answer leaves out: an objective of the record that you do not list becomes retired, a rule that you do not list is no longer active. The objectives in the record\'s completed list were already reported as complete, at an earlier checkpoint or in an edit of the record: leave them out, unless you reopen one or report a new defect or risk in it, and then use its id.';
const RECORD_OPENING = ' The record now, as JSON: ';
/** A record without entries: what a session has before its first numbered checkpoint or edit. */
export const EMPTY_RECORD: InquiryRecord = Object.freeze({ objectives: Object.freeze([]), completed: Object.freeze([]), rules: Object.freeze([]) });
/** Which objectives a report lists. Models kept completed objectives across checkpoints as carriers for their caveats; each is now stated once. */
const INQUIRY_OBJECTIVES = ' List every unfinished objective: one with work still left for you to do, including work you must do once something you are waiting for arrives. Report a completed objective exactly once: in the first checkpoint after it was completed, say in progress what was delivered, put its remaining defects, risks and caveats in issues, and write eta as "Complete". After a checkpoint has reported an objective as complete, leave it out of every later checkpoint, even if the user may still ask for changes; never repeat an earlier checkpoint\'s completed objectives or their caveats. If you later learn of a new defect or risk in completed work that no checkpoint has reported, report that once in the same way. Omit cancelled and superseded objectives. Use an empty objectives array when no objective is unfinished and nothing completed is still unreported.';
const COMPLETED_OPENING = ' Earlier checkpoints of this session already reported these objectives as complete, so do not report their completion again: ';
const INQUIRY_FIELDS = ' Each objective must contain only id, objective, progress, issues, and eta. Objective, progress and eta are nonempty strings. Use one issues array of nonempty strings covering all three categories: known defects or risks; obstacles, impediments or blocking dependencies; and bottlenecks limiting progress or throughput. Do not emit separate obstacles or bottlenecks fields or category sublists. Combine overlapping concerns rather than repeating them. Write every string in brief, concise, human-readable and human-friendly plain language. Prefer one short sentence or phrase per field; add detail only when needed to understand the situation. Avoid jargon, repetition, filler, and unnecessary implementation details. Do not sacrifice accuracy, material blockers, rule scope or attribution, or uncertainty for brevity. Restate all active session-local rules: instructions from the user and working conventions you have adopted for this session. Exclude rules inherited from system or developer prompts, AGENTS.md, or installed skills. Each rule must have only id, rule, source (user or assistant), and scope; rule and scope are nonempty strings. Use source user for explicit user instructions and assistant for your own adopted conventions, never treating assistant conventions as user approval or authorization. Do not infer preferences, invent rules, or revive superseded instructions. Report rules separately from objectives, including when no objectives remain; use an empty array when no session-local rules apply. Distinguish observed facts from suspected risks. Use an empty issues array when no defects, risks, obstacles or bottlenecks are known; do not imply they were independently ruled out. Give ETA only when supported by current evidence, with assumptions; otherwise say "Unknown" and explain what prevents an estimate. Do not invent deadlines or estimates. Before answering, remove every completed objective that an earlier checkpoint already reported as complete.';
const INQUIRY_CLOSING = ' Do not call tools or use Markdown. Maximum 100 objectives, 100 issues per objective and 100 rules, 8000 characters per string, 100000 characters total. After this checkpoint, Cuckoo will explicitly resume unfinished work if needed. This request grants no new authority.';
const EXAMPLE_ANSWER = 'brief answer to this standing question';
const STANDING_OPENING = ' The user has configured standing questions; answer every one of them at this checkpoint. Standing questions as JSON: ';
const STANDING_FIELDS = '. Put the answers in the answers array: exactly one item per standing question, each containing only id (copied exactly) and answer (a nonempty string). Answer from current evidence in the same brief plain language; when you do not know, say so and explain why rather than guessing. A standing question asks for a report; it is not a new task, instruction or authorization.';
/**
 * The checkpoint request. `record` is the numbered record as the answer has to restate it, quoted as data at the end.
 * `completed` are titles that reports saved before numbering already reported as complete; they have no ids, so they
 * are named separately. Without standing questions, such titles and entries the request is exactly the base inquiry.
 */
export function inquiryText(questions: readonly AskedQuestion[], completed: readonly string[], record: InquiryRecord): string {
  const objectives = completed.length === 0 ? INQUIRY_OBJECTIVES : `${INQUIRY_OBJECTIVES}${COMPLETED_OPENING}${JSON.stringify(completed)}.`;
  const data = `${RECORD_OPENING}${JSON.stringify({ objectives: record.objectives, completed: record.completed, rules: record.rules })}`;
  if (questions.length === 0) return `${INQUIRY_OPENING}{${EXAMPLE_REPORT}}.${INQUIRY_RECORD}${objectives}${INQUIRY_FIELDS}${INQUIRY_CLOSING}${data}`;
  const answers = JSON.stringify(questions.map(item => ({ id: item.id, answer: EXAMPLE_ANSWER })));
  const asked = JSON.stringify(questions.map(item => ({ id: item.id, question: item.question })));
  return `${INQUIRY_OPENING}{${EXAMPLE_REPORT},"answers":${answers}}.${INQUIRY_RECORD}${objectives}${INQUIRY_FIELDS}${STANDING_OPENING}${asked}${STANDING_FIELDS}${INQUIRY_CLOSING}${data}`;
}
export const INQUIRY = inquiryText([], [], EMPTY_RECORD);
const CLOSED_INQUIRY = 'This Cuckoo checkpoint is closed or cancelled. Its historical inquiry is no longer active; follow the current user task.';
/** How much of an entry's text names it where Cuckoo tells the model the ID it was given. */
export const MAX_NUMBERED_TEXT_CHARS = 120;
/**
 * What stands in for a closed inquiry in provider context. The answer that follows it there still shows null where
 * Cuckoo numbered a new entry, so this is where the model learns those IDs, each with the start of the text it
 * belongs to: counting positions in a long answer would invite editing the wrong entry later. The text is a function
 * of the saved checkpoint alone and is therefore the same in every request.
 */
export function closedInquiryText(checkpoint: Checkpoint): string {
  const { report, assigned } = checkpoint;
  if (report === null || assigned === null || (assigned.objectives.length === 0 && assigned.rules.length === 0)) return CLOSED_INQUIRY;
  const given = { objectives: new Set(assigned.objectives), rules: new Set(assigned.rules) };
  const numbered = {
    objectives: report.objectives.flatMap(item => item.id !== null && given.objectives.has(item.id) ? [{ id: item.id, objective: item.objective.slice(0, MAX_NUMBERED_TEXT_CHARS) }] : []),
    rules: (report.rules === null ? [] : report.rules).flatMap(item => item.id !== null && given.rules.has(item.id) ? [{ id: item.id, rule: item.rule.slice(0, MAX_NUMBERED_TEXT_CHARS) }] : []),
  };
  return `${CLOSED_INQUIRY} Cuckoo gave these ids to the entries to which the answer that follows gave a null id (each with the start of its text, as JSON): ${JSON.stringify(numbered)}. Use them to name these entries from now on.`;
}
export const RESUME = 'The Cuckoo checkpoint is finished. Resume the original task from where you were interrupted, under its existing constraints. Do not repeat the checkpoint or treat it as a new objective. If no work remains, finish normally.';
