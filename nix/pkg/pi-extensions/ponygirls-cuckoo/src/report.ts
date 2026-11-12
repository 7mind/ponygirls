import type { SessionEntry } from '@earendil-works/pi-coding-agent';

export const REPORT_TYPE = 'cuckoo.report';
export const MAX_OBJECTIVES = 100;
export const MAX_ISSUES = 100;
export const MAX_RULES = 100;
export const MAX_FIELD_CHARS = 8000;
export const MAX_REPORT_CHARS = 100000;
export interface Objective { objective: string; progress: string; issues: string[] | null; eta: string | null }
export interface SessionRule { rule: string; source: 'user' | 'assistant'; scope: string }
export interface Report { objectives: Objective[]; rules: SessionRule[] | null }
type ReportVersion = 1 | 2 | 3 | 4;
export interface Checkpoint { version: ReportVersion; requestId: string; raw: string; report: Report | null; error: string | null }
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected a JSON object');
  return value as Record<string, unknown>;
}
function field(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_FIELD_CHARS) throw new Error(`Expected ${name}: nonempty string, at most ${MAX_FIELD_CHARS} characters`);
  return value;
}
export function parseReport(raw: string): Report { return parseVersionedReport(raw, 4); }
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
function parseVersionedReport(raw: string, version: ReportVersion): Report {
  if (raw.length > MAX_REPORT_CHARS) throw new Error(`Report exceeds ${MAX_REPORT_CHARS} characters`);
  const value = object(JSON.parse(raw));
  const keys = version >= 3 ? ['objectives', 'rules'] : ['objectives'];
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
  return { rules, objectives: value.objectives.map(item => {
    const entry = object(item);
    const names = version === 1 ? ['objective', 'progress'] : version === 4 ? ['objective', 'progress', 'issues', 'eta'] : ['objective', 'progress', 'obstacles', 'issues', 'bottlenecks', 'eta'];
    if (Object.keys(entry).length !== names.length || names.some(name => !(name in entry))) throw new Error(`Each objective must contain only ${names.join(', ')}`);
    return { objective: field(entry.objective, 'objective'), progress: field(entry.progress, 'progress'),
      issues: parseIssues(entry, version),
      eta: version === 1 ? null : field(entry.eta, 'eta') };
  }) };
}
export function checkpoint(requestId: string, raw: string): Checkpoint {
  return versionedCheckpoint(requestId, raw, 4);
}
function versionedCheckpoint(requestId: string, raw: string, version: ReportVersion): Checkpoint {
  try { return { version, requestId, raw, report: parseVersionedReport(raw, version), error: null }; }
  catch (error) { return { version, requestId, raw, report: null, error: String(error) }; }
}
export function checkpoints(entries: readonly SessionEntry[]): Checkpoint[] {
  return entries.flatMap(entry => {
    if (entry.type !== 'custom' || entry.customType !== REPORT_TYPE) return [];
    const value = object(entry.data);
    if ((value.version !== 1 && value.version !== 2 && value.version !== 3 && value.version !== 4) || typeof value.requestId !== 'string' || typeof value.raw !== 'string') throw new Error('Invalid saved Cuckoo checkpoint');
    if (value.error !== null && typeof value.error !== 'string') throw new Error('Invalid saved Cuckoo checkpoint error');
    const parsed = versionedCheckpoint(value.requestId, value.raw, value.version);
    return [value.error === null ? parsed : { ...parsed, report: null, error: value.error }];
  });
}
export function issuesText(issues: readonly string[] | null): string | null {
  return issues === null ? null : issues.length === 0 ? 'None known' : issues.map(issue => `- ${issue}`).join('\n');
}
function checkpointText(value: Checkpoint, header: string): string {
  if (value.report === null) return `${header}\nInvalid report: ${value.error}\nRaw output:\n${value.raw}`;
  const rules = value.report.rules === null ? 'Session rules not recorded (legacy report)' :
    value.report.rules.length === 0 ? 'No session-local rules reported.' :
      value.report.rules.map(item => `  ${item.source}: ${item.rule} (scope: ${item.scope})`).join('\n');
  const prefix = `${header}\nSession-local rules\n${rules}\n\n`;
  if (value.report.objectives.length === 0) return `${prefix}No current objectives.`;
  return prefix + value.report.objectives.map((item, i) => `${i + 1}. ${item.objective}\n   Progress: ${item.progress}\n   Issues: ${(issuesText(item.issues) ?? 'Not recorded (legacy report)').replace(/\n/g, '\n           ')}\n   ETA: ${item.eta ?? 'Not recorded (legacy report)'}`).join('\n\n');
}
export function historyText(entries: readonly SessionEntry[], branch: readonly SessionEntry[]): string {
  const current = new Set(branch.map(entry => entry.id));
  const answers = entries.filter(entry => entry.type === 'custom' && entry.customType === REPORT_TYPE);
  if (answers.length === 0) return 'No Cuckoo answers in this session yet.';
  return 'Cuckoo answer history — this session, all branches, newest first\n\n' + [...answers].reverse().map(entry => {
    const value = checkpoints([entry])[0];
    const header = `${entry.timestamp} — ${value.requestId}\nEntry ${entry.id} (${current.has(entry.id) ? 'current branch' : 'other branch'})`;
    return checkpointText(value, header);
  }).join('\n\n');
}
export function reportText(reports: readonly Checkpoint[]): string {
  if (reports.length === 0) return 'No Cuckoo reports on this branch yet.';
  return [...reports].reverse().map((value, index) => {
    const header = `Checkpoint ${reports.length - index} (${value.requestId})`;
    return checkpointText(value, header);
  }).join('\n\n');
}
