import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { commentsOn, savedComments, type NodeRef, type ShownComment } from './comments.ts';
import { validateAskedQuestions, type AskedQuestion, type QuestionScope } from './questions.ts';

export const REPORT_TYPE = 'cuckoo.report';
const SAVED_CHECKPOINT_PREFIX = /^\s*CUCKOO-CHECKPOINT[ \t]*(?:\r?\n|$)/;
export const MAX_OBJECTIVES = 100;
export const MAX_ISSUES = 100;
export const MAX_RULES = 100;
export const MAX_FIELD_CHARS = 8000;
export const MAX_REPORT_CHARS = 100000;
export interface Objective { objective: string; progress: string; issues: string[] | null; eta: string | null }
export interface SessionRule { rule: string; source: 'user' | 'assistant'; scope: string }
export interface Answer { id: string; question: string; scope: QuestionScope; answer: string }
/** `answers` follows the asked order; null when the inquiry asked no standing questions (versions 1 to 4). */
export interface Report { objectives: Objective[]; rules: SessionRule[] | null; answers: Answer[] | null }
/** Identifies the response schema: 4 without standing questions, 5 with a nonempty question snapshot. */
type ReportVersion = 1 | 2 | 3 | 4 | 5;
export interface Checkpoint { version: ReportVersion; requestId: string; raw: string; report: Report | null; error: string | null; questions: readonly AskedQuestion[] }
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
function parseVersionedReport(raw: string, version: ReportVersion, questions: readonly AskedQuestion[]): Report {
  if (raw.length > MAX_REPORT_CHARS) throw new Error(`Report exceeds ${MAX_REPORT_CHARS} characters`);
  const value = object(JSON.parse(raw));
  const keys = version === 5 ? ['objectives', 'rules', 'answers'] : version >= 3 ? ['objectives', 'rules'] : ['objectives'];
  if (Object.keys(value).length !== keys.length || keys.some(key => !(key in value))) throw new Error(`Expected only ${keys.join(', ')}`);
  if (!Array.isArray(value.objectives) || value.objectives.length > MAX_OBJECTIVES) throw new Error(`Expected objectives: array, at most ${MAX_OBJECTIVES} items`);
  let rules: SessionRule[] | null = null;
  if (version >= 3) {
    if (!Array.isArray(value.rules) || value.rules.length > MAX_RULES) throw new Error(`Expected rules: array, at most ${MAX_RULES} items`);
    rules = value.rules.map(item => {
      const entry = object(item);
      if (Object.keys(entry).length !== 3 || !('rule' in entry) || !('source' in entry) || !('scope' in entry)) throw new Error('Each rule must contain only rule, source, scope');
      if (entry.source !== 'user' && entry.source !== 'assistant') throw new Error('Expected rule source: user or assistant');
      return { rule: field(entry.rule, 'rule'), source: entry.source, scope: field(entry.scope, 'scope') };
    });
  }
  return { rules, answers: version === 5 ? parseAnswers(value.answers, questions) : null, objectives: value.objectives.map(item => {
    const entry = object(item);
    const names = version === 1 ? ['objective', 'progress'] : version >= 4 ? ['objective', 'progress', 'issues', 'eta'] : ['objective', 'progress', 'obstacles', 'issues', 'bottlenecks', 'eta'];
    if (Object.keys(entry).length !== names.length || names.some(name => !(name in entry))) throw new Error(`Each objective must contain only ${names.join(', ')}`);
    return { objective: field(entry.objective, 'objective'), progress: field(entry.progress, 'progress'),
      issues: parseIssues(entry, version),
      eta: version === 1 ? null : field(entry.eta, 'eta') };
  }) };
}
export function checkpoint(requestId: string, raw: string): Checkpoint {
  return versionedCheckpoint(requestId, raw, 4, []);
}
/** Checkpoint for an inquiry that asked `questions`; with none this is the base version. */
export function answeredCheckpoint(requestId: string, raw: string, questions: readonly AskedQuestion[]): Checkpoint {
  return versionedCheckpoint(requestId, raw, questions.length === 0 ? 4 : 5, questions);
}
function versionedCheckpoint(requestId: string, raw: string, version: ReportVersion, questions: readonly AskedQuestion[]): Checkpoint {
  try { return { version, requestId, raw, report: parseVersionedReport(raw, version, questions), error: null, questions }; }
  catch (error) { return { version, requestId, raw, report: null, error: String(error), questions }; }
}
export function checkpoints(entries: readonly SessionEntry[]): Checkpoint[] {
  return entries.flatMap(entry => {
    if (entry.type !== 'custom' || entry.customType !== REPORT_TYPE) return [];
    const value = object(entry.data);
    if ((value.version !== 1 && value.version !== 2 && value.version !== 3 && value.version !== 4 && value.version !== 5) || typeof value.requestId !== 'string' || typeof value.raw !== 'string') throw new Error('Invalid saved Cuckoo checkpoint');
    if (value.error !== null && typeof value.error !== 'string') throw new Error('Invalid saved Cuckoo checkpoint error');
    const questions = value.version === 5 ? validateAskedQuestions(value.questions) : [];
    if (value.version === 5 && questions.length === 0) throw new Error('Invalid saved Cuckoo checkpoint: version 5 requires standing questions');
    const parsed = { ...versionedCheckpoint(value.requestId, value.raw.replace(SAVED_CHECKPOINT_PREFIX, ''), value.version, questions), raw: value.raw };
    return [value.error === null ? parsed : { ...parsed, report: null, error: value.error }];
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
/** The eta the inquiry prescribes for an objective reported as completed; older reports wrote longer variants. */
const COMPLETE_ETA = /^\s*complete\b/i;
export const MAX_COMPLETED_TITLES = 50;
export const MAX_COMPLETED_TITLE_CHARS = 300;
/**
 * Objectives these reports already reported as complete, oldest first: the latest listing of a title decides, so one
 * that was reopened since is not included. Saved reports outlive compaction, which the model's own earlier answers do not.
 */
export function completedObjectives(reports: readonly Checkpoint[]): string[] {
  const complete = new Map<string, boolean>();
  for (const value of reports) {
    if (value.report === null) continue;
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
      value.report.rules.map((item, index) => `  ${item.source}: ${item.rule} (scope: ${item.scope})${commentLines(comments, value, { kind: 'rule', index }, '    ')}`).join('\n');
  const objectives = value.report.objectives.length === 0 ? 'No current objectives.' :
    value.report.objectives.map((item, i) => `${i + 1}. ${item.objective}\n   Progress: ${item.progress}\n   Issues: ${(issuesText(item.issues) ?? 'Not recorded (legacy report)').replace(/\n/g, '\n           ')}\n   ETA: ${item.eta ?? 'Not recorded (legacy report)'}${commentLines(comments, value, { kind: 'objective', index: i }, '   ')}`).join('\n\n');
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
