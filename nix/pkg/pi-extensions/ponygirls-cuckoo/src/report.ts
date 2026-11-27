import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { commentsOn, savedComments, type NodeRef, type ShownComment } from './comments.ts';
import { ENTRY_KINDS, ID_PREFIX, entryId, parseEntryId, type EntryKind, type NextNumbers } from './ids.ts';
import { validateAskedQuestions, type AskedQuestion, type QuestionScope } from './questions.ts';

export const REPORT_TYPE = 'cuckoo.report';
const SAVED_CHECKPOINT_PREFIX = /^\s*CUCKOO-CHECKPOINT[ \t]*(?:\r?\n|$)/;
export const MAX_OBJECTIVES = 100;
export const MAX_ISSUES = 100;
export const MAX_RULES = 100;
export const MAX_FIELD_CHARS = 8000;
export const MAX_REPORT_CHARS = 100000;
/** `id` is the entry's ID in the numbered record; null in reports saved before numbering (versions 1 to 5). */
export interface Objective { id: string | null; objective: string; progress: string; issues: string[] | null; eta: string | null }
export interface SessionRule { id: string | null; rule: string; source: 'user' | 'assistant'; scope: string }
export interface Answer { id: string; question: string; scope: QuestionScope; answer: string }
/** `answers` follows the asked order; null when the inquiry asked no standing questions (versions 1 to 4). */
export interface Report { objectives: Objective[]; rules: SessionRule[] | null; answers: Answer[] | null }
/**
 * Identifies the response schema: 4 without standing questions, 5 with a nonempty question snapshot; 6 is either of
 * them with an id in every objective and rule, its question snapshot saying which.
 */
type ReportVersion = 1 | 2 | 3 | 4 | 5 | 6;
const NUMBERED_VERSION = 6;
/** The IDs Cuckoo gave to the items of a reply that had a null id, in the order the reply lists them. */
export interface Assigned { readonly objectives: readonly string[]; readonly rules: readonly string[] }
/** The IDs a reply may refer to: every entry the record of its branch ever held. */
export interface KnownIds { readonly objectives: ReadonlySet<string>; readonly rules: ReadonlySet<string> }
/** `assigned` is null for an invalid checkpoint and for versions 1 to 5. */
export interface Checkpoint { version: ReportVersion; requestId: string; raw: string; report: Report | null; error: string | null; questions: readonly AskedQuestion[]; assigned: Assigned | null }
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected a JSON object');
  return value as Record<string, unknown>;
}
function field(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_FIELD_CHARS) throw new Error(`Expected ${name}: nonempty string, at most ${MAX_FIELD_CHARS} characters`);
  return value;
}
export function parseReport(raw: string): Report { return parseVersionedReport(raw, 4, []); }
/** Parse a response to an inquiry that asked `questions`; with none this is the base schema. */
export function parseAnsweredReport(raw: string, questions: readonly AskedQuestion[]): Report {
  return parseVersionedReport(raw, questions.length === 0 ? 4 : 5, questions);
}
function parseAnswers(value: unknown, questions: readonly AskedQuestion[]): Answer[] {
  if (!Array.isArray(value) || value.length !== questions.length) throw new Error(`Expected answers: array with exactly one answer for each of the ${questions.length} standing questions`);
  const given = new Map<string, string>();
  for (const item of value) {
    const entry = object(item);
    if (Object.keys(entry).length !== 2 || !('id' in entry) || !('answer' in entry)) throw new Error('Each answer must contain only id, answer');
    if (typeof entry.id !== 'string' || !questions.some(question => question.id === entry.id)) throw new Error('Expected answer id: the id of a standing question asked in this checkpoint');
    if (given.has(entry.id)) throw new Error(`Duplicate answer for standing question ${entry.id}`);
    given.set(entry.id, field(entry.answer, 'answer'));
  }
  return questions.map(question => {
    const answer = given.get(question.id);
    if (answer === undefined) throw new Error(`Missing answer for standing question ${question.id}`);
    return { id: question.id, question: question.question, scope: question.scope, answer };
  });
}
function parseIssues(entry: Record<string, unknown>, version: ReportVersion): string[] | null {
  if (version === 1) return null;
  if (version < 4) return [
    `Obstacles (legacy): ${field(entry.obstacles, 'obstacles')}`,
    `Issues (legacy): ${field(entry.issues, 'issues')}`,
    `Bottlenecks (legacy): ${field(entry.bottlenecks, 'bottlenecks')}`,
  ];
  if (!Array.isArray(entry.issues) || entry.issues.length > MAX_ISSUES) throw new Error(`Expected issues: array, at most ${MAX_ISSUES} items`);
  return entry.issues.map(value => field(value, 'issue'));
}
/** The id of a reply item: an ID of its kind, or null for an entry the record does not hold yet. */
function replyId(value: unknown, kind: EntryKind, seen: Set<string>): string | null {
  if (value === null) return null;
  const parsed = parseEntryId(value);
  if (parsed === null || parsed.kind !== kind) throw new Error(`Expected ${kind} id: an ${ID_PREFIX[kind]} id copied from the record, or null for a new ${kind}`);
  const id = value as string;
  if (seen.has(id)) throw new Error(`Duplicate ${kind} id ${id}`);
  seen.add(id);
  return id;
}
function parseVersionedReport(raw: string, version: ReportVersion, questions: readonly AskedQuestion[]): Report {
  if (raw.length > MAX_REPORT_CHARS) throw new Error(`Report exceeds ${MAX_REPORT_CHARS} characters`);
  const value = object(JSON.parse(raw));
  const numbered = version === NUMBERED_VERSION;
  const answered = version === 5 || (numbered && questions.length > 0);
  const keys = answered ? ['objectives', 'rules', 'answers'] : version >= 3 ? ['objectives', 'rules'] : ['objectives'];
  const seen: Record<EntryKind, Set<string>> = { objective: new Set(), rule: new Set() };
  if (Object.keys(value).length !== keys.length || keys.some(key => !(key in value))) throw new Error(`Expected only ${keys.join(', ')}`);
  if (!Array.isArray(value.objectives) || value.objectives.length > MAX_OBJECTIVES) throw new Error(`Expected objectives: array, at most ${MAX_OBJECTIVES} items`);
  let rules: SessionRule[] | null = null;
  if (version >= 3) {
    if (!Array.isArray(value.rules) || value.rules.length > MAX_RULES) throw new Error(`Expected rules: array, at most ${MAX_RULES} items`);
    const names = numbered ? ['id', 'rule', 'source', 'scope'] : ['rule', 'source', 'scope'];
    rules = value.rules.map(item => {
      const entry = object(item);
      if (Object.keys(entry).length !== names.length || names.some(name => !(name in entry))) throw new Error(`Each rule must contain only ${names.join(', ')}`);
      if (entry.source !== 'user' && entry.source !== 'assistant') throw new Error('Expected rule source: user or assistant');
      return { id: numbered ? replyId(entry.id, 'rule', seen.rule) : null, rule: field(entry.rule, 'rule'), source: entry.source, scope: field(entry.scope, 'scope') };
    });
  }
  return { rules, answers: answered ? parseAnswers(value.answers, questions) : null, objectives: value.objectives.map(item => {
    const entry = object(item);
    const names = version === 1 ? ['objective', 'progress'] : numbered ? ['id', 'objective', 'progress', 'issues', 'eta'] :
      version >= 4 ? ['objective', 'progress', 'issues', 'eta'] : ['objective', 'progress', 'obstacles', 'issues', 'bottlenecks', 'eta'];
    if (Object.keys(entry).length !== names.length || names.some(name => !(name in entry))) throw new Error(`Each objective must contain only ${names.join(', ')}`);
    return { id: numbered ? replyId(entry.id, 'objective', seen.objective) : null, objective: field(entry.objective, 'objective'), progress: field(entry.progress, 'progress'),
      issues: parseIssues(entry, version),
      eta: version === 1 ? null : field(entry.eta, 'eta') };
  }) };
}
/** A checkpoint in the form saved before numbering (version 4): its items carry no ids. */
export function checkpoint(requestId: string, raw: string): Checkpoint {
  return versionedCheckpoint(requestId, raw, 4, []);
}
/** The form saved before numbering for an inquiry that asked `questions`: version 5, or 4 with none. */
export function answeredCheckpoint(requestId: string, raw: string, questions: readonly AskedQuestion[]): Checkpoint {
  return versionedCheckpoint(requestId, raw, questions.length === 0 ? 4 : 5, questions);
}
function versionedCheckpoint(requestId: string, raw: string, version: ReportVersion, questions: readonly AskedQuestion[]): Checkpoint {
  try { return { version, requestId, raw, report: parseVersionedReport(raw, version, questions), error: null, questions, assigned: null }; }
  catch (error) { return { version, requestId, raw, report: null, error: String(error), questions, assigned: null }; }
}
/** Give the items that have a null id the IDs of `assigned`, in order; every one of them must be used and none may repeat an id of the reply. */
function numbered(report: Report, assigned: Assigned): Report {
  const pending: Record<EntryKind, string[]> = { objective: [...assigned.objectives], rule: [...assigned.rules] };
  const taken: Record<EntryKind, Set<string>> = { objective: new Set(), rule: new Set() };
  const number = <T extends { id: string | null }>(items: readonly T[], kind: EntryKind): T[] => {
    for (const item of items) if (item.id !== null) taken[kind].add(item.id);
    return items.map(item => {
      if (item.id !== null) return item;
      const id = pending[kind].shift();
      if (id === undefined || taken[kind].has(id)) throw new Error('Invalid saved Cuckoo checkpoint numbering');
      taken[kind].add(id);
      return { ...item, id };
    });
  };
  const result = { ...report, objectives: number(report.objectives, 'objective'), rules: report.rules === null ? null : number(report.rules, 'rule') };
  if (ENTRY_KINDS.some(kind => pending[kind].length > 0)) throw new Error('Invalid saved Cuckoo checkpoint numbering');
  return result;
}
/**
 * The checkpoint for a reply as it is captured: `known` are the IDs the reply may refer to, `next` the numbers its
 * new items get. A reply that names an ID outside `known` is invalid: an ID identifies an entry only when Cuckoo gave it.
 */
export function capturedCheckpoint(requestId: string, raw: string, questions: readonly AskedQuestion[], known: KnownIds, next: NextNumbers): Checkpoint {
  try {
    const parsed = parseVersionedReport(raw, NUMBERED_VERSION, questions);
    if (parsed.rules === null) throw new Error('Expected rules');
    for (const item of parsed.objectives) if (item.id !== null && !known.objectives.has(item.id)) throw new Error(`Unknown objective id ${item.id}: copy an id from the record, or use null for a new objective`);
    for (const item of parsed.rules) if (item.id !== null && !known.rules.has(item.id)) throw new Error(`Unknown rule id ${item.id}: copy an id from the record, or use null for a new rule`);
    const assigned: Assigned = {
      objectives: parsed.objectives.filter(item => item.id === null).map((_, index) => entryId('objective', next.objective + index)),
      rules: parsed.rules.filter(item => item.id === null).map((_, index) => entryId('rule', next.rule + index)),
    };
    return { version: NUMBERED_VERSION, requestId, raw, report: numbered(parsed, assigned), error: null, questions, assigned };
  } catch (error) { return { version: NUMBERED_VERSION, requestId, raw, report: null, error: String(error), questions, assigned: null }; }
}
/** A checkpoint that ended without a reply to capture. */
export function cancelledCheckpoint(requestId: string, questions: readonly AskedQuestion[], reason: string): Checkpoint {
  return { version: NUMBERED_VERSION, requestId, raw: '', report: null, error: reason, questions, assigned: null };
}
function savedAssigned(value: unknown): Assigned {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid saved Cuckoo checkpoint numbering');
  const data = value as Record<string, unknown>;
  if (Object.keys(data).length !== 2 || !Array.isArray(data.objectives) || !Array.isArray(data.rules)) throw new Error('Invalid saved Cuckoo checkpoint numbering');
  const ids = (items: readonly unknown[], kind: EntryKind): string[] => items.map(item => {
    const parsed = parseEntryId(item);
    if (parsed === null || parsed.kind !== kind) throw new Error('Invalid saved Cuckoo checkpoint numbering');
    return item as string;
  });
  return { objectives: ids(data.objectives, 'objective'), rules: ids(data.rules, 'rule') };
}
export function checkpoints(entries: readonly SessionEntry[]): Checkpoint[] {
  return entries.flatMap(entry => {
    if (entry.type !== 'custom' || entry.customType !== REPORT_TYPE) return [];
    const value = object(entry.data);
    if ((value.version !== 1 && value.version !== 2 && value.version !== 3 && value.version !== 4 && value.version !== 5 && value.version !== NUMBERED_VERSION) || typeof value.requestId !== 'string' || typeof value.raw !== 'string') throw new Error('Invalid saved Cuckoo checkpoint');
    if (value.error !== null && typeof value.error !== 'string') throw new Error('Invalid saved Cuckoo checkpoint error');
    const questions = value.version === 5 || value.version === NUMBERED_VERSION ? validateAskedQuestions(value.questions) : [];
    if (value.version === 5 && questions.length === 0) throw new Error('Invalid saved Cuckoo checkpoint: version 5 requires standing questions');
    const parsed = { ...versionedCheckpoint(value.requestId, value.raw.replace(SAVED_CHECKPOINT_PREFIX, ''), value.version, questions), raw: value.raw };
    if (value.error !== null) return [{ ...parsed, report: null, error: value.error }];
    if (value.version !== NUMBERED_VERSION || parsed.report === null) return [parsed];
    // The reply names the entries it continues; the numbers of its new ones were decided when it was captured.
    const assigned = savedAssigned(value.assigned);
    return [{ ...parsed, report: numbered(parsed.report, assigned), assigned }];
  });
}
/** Request IDs of the checkpoints saved in these entries, without decoding the reports. */
export function checkpointRequestIds(entries: readonly SessionEntry[]): Set<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== 'custom' || entry.customType !== REPORT_TYPE) continue;
    const value = object(entry.data);
    if (typeof value.requestId !== 'string') throw new Error('Invalid saved Cuckoo checkpoint');
    ids.add(value.requestId);
  }
  return ids;
}
/** The saved numbering of a report entry, read without decoding its reply; null for an entry that numbered nothing. */
export function savedNumbering(entry: SessionEntry): Assigned | null {
  if (entry.type !== 'custom' || entry.customType !== REPORT_TYPE) return null;
  const value = object(entry.data);
  return value.version === NUMBERED_VERSION && value.error === null ? savedAssigned(value.assigned) : null;
}
/** The eta the inquiry prescribes for an objective reported as completed; older reports wrote longer variants. */
export const COMPLETE_ETA = /^\s*complete\b/i;
export const MAX_COMPLETED_TITLES = 50;
export const MAX_COMPLETED_TITLE_CHARS = 300;
/**
 * Objectives that reports saved before numbering already reported as complete, oldest first: the latest listing of a
 * title decides, so one that was reopened since is not included. Saved reports outlive compaction, which the model's
 * own earlier answers do not. Numbered reports are left out: the record names their completed objectives by ID.
 */
export function completedObjectives(reports: readonly Checkpoint[]): string[] {
  const complete = new Map<string, boolean>();
  for (const value of reports) {
    if (value.report === null || value.version === NUMBERED_VERSION) continue;
    for (const item of value.report.objectives) {
      // Re-inserting moves the title to the end, so the bound keeps the most recently reported ones.
      complete.delete(item.objective);
      complete.set(item.objective, item.eta !== null && COMPLETE_ETA.test(item.eta));
    }
  }
  return [...complete].filter(([, done]) => done).map(([title]) => title.slice(0, MAX_COMPLETED_TITLE_CHARS)).slice(-MAX_COMPLETED_TITLES);
}
export function issuesText(issues: readonly string[] | null): string | null {
  return issues === null ? null : issues.length === 0 ? 'None known' : issues.map(issue => `- ${issue}`).join('\n');
}
function commentLines(comments: readonly ShownComment[], value: Checkpoint, target: NodeRef, indent: string): string {
  return commentsOn(comments, value.requestId, target).map(item =>
    `\n${indent}Comment (${item.createdAt === null ? 'new' : item.createdAt}): ${item.text.replace(/\n/g, `\n${indent}  `)}`).join('');
}
function checkpointText(value: Checkpoint, header: string, comments: readonly ShownComment[]): string {
  if (value.report === null) {
    const asked = value.questions.length === 0 ? '' : `\nStanding questions asked:\n${value.questions.map(item => `  ${item.id} (${item.scope}): ${item.question}`).join('\n')}`;
    return `${header}\nInvalid report: ${value.error}${asked}\nRaw output:\n${value.raw}`;
  }
  const rules = value.report.rules === null ? 'Session rules not recorded (legacy report)' :
    value.report.rules.length === 0 ? 'No session-local rules reported.' :
      value.report.rules.map((item, index) => `  ${item.id === null ? '' : `${item.id} `}${item.source}: ${item.rule} (scope: ${item.scope})${commentLines(comments, value, { kind: 'rule', index }, '    ')}`).join('\n');
  const objectives = value.report.objectives.length === 0 ? 'No current objectives.' :
    value.report.objectives.map((item, i) => `${item.id === null ? i + 1 : item.id}. ${item.objective}\n   Progress: ${item.progress}\n   Issues: ${(issuesText(item.issues) ?? 'Not recorded (legacy report)').replace(/\n/g, '\n           ')}\n   ETA: ${item.eta ?? 'Not recorded (legacy report)'}${commentLines(comments, value, { kind: 'objective', index: i }, '   ')}`).join('\n\n');
  const answers = value.report.answers === null ? '' : `\n\nStanding questions\n${value.report.answers.map((item, index) =>
    `Q${index + 1}. ${item.question} (${item.scope}, ${item.id})\n   Answer: ${item.answer.replace(/\n/g, '\n           ')}${commentLines(comments, value, { kind: 'answer', index }, '   ')}`).join('\n\n')}`;
  return `${header}\nSession-local rules\n${rules}\n\n${objectives}${answers}`;
}
export function historyText(entries: readonly SessionEntry[], branch: readonly SessionEntry[]): string {
  const current = new Set(branch.map(entry => entry.id));
  const answers = entries.filter(entry => entry.type === 'custom' && entry.customType === REPORT_TYPE);
  if (answers.length === 0) return 'No Cuckoo answers in this session yet.';
  const comments = savedComments(entries);
  return 'Cuckoo answer history — this session, all branches, newest first\n\n' + [...answers].reverse().map(entry => {
    const value = checkpoints([entry])[0];
    const header = `${entry.timestamp} — ${value.requestId}\nEntry ${entry.id} (${current.has(entry.id) ? 'current branch' : 'other branch'})`;
    return checkpointText(value, header, comments);
  }).join('\n\n');
}
export function reportText(reports: readonly Checkpoint[], comments: readonly ShownComment[]): string {
  if (reports.length === 0) return 'No Cuckoo reports on this branch yet.';
  return [...reports].reverse().map((value, index) => {
    const header = `Checkpoint ${reports.length - index} (${value.requestId})`;
    return checkpointText(value, header, comments);
  }).join('\n\n');
}
