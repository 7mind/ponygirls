import type { SessionEntry } from '@earendil-works/pi-coding-agent';

export const REPORT_TYPE = 'cuckoo.report';
export const MAX_OBJECTIVES = 100;
export const MAX_FIELD_CHARS = 8000;
export const MAX_REPORT_CHARS = 100000;
export interface Objective { objective: string; progress: string; obstacles: string | null; issues: string | null; bottlenecks: string | null; eta: string | null }
export interface Report { objectives: Objective[] }
export interface Checkpoint { version: 1 | 2; requestId: string; raw: string; report: Report | null; error: string | null }
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected a JSON object');
  return value as Record<string, unknown>;
}
function field(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_FIELD_CHARS) throw new Error(`Expected ${name}: nonempty string, at most ${MAX_FIELD_CHARS} characters`);
  return value;
}
export function parseReport(raw: string): Report { return parseVersionedReport(raw, 2); }
function parseVersionedReport(raw: string, version: 1 | 2): Report {
  if (raw.length > MAX_REPORT_CHARS) throw new Error(`Report exceeds ${MAX_REPORT_CHARS} characters`);
  const value = object(JSON.parse(raw));
  if (Object.keys(value).length !== 1 || !Array.isArray(value.objectives) || value.objectives.length > MAX_OBJECTIVES) throw new Error(`Expected only objectives: array, at most ${MAX_OBJECTIVES} items`);
  return { objectives: value.objectives.map(item => {
    const entry = object(item);
    const names = version === 1 ? ['objective', 'progress'] : ['objective', 'progress', 'obstacles', 'issues', 'bottlenecks', 'eta'];
    if (Object.keys(entry).length !== names.length || names.some(name => !(name in entry))) throw new Error(`Each objective must contain only ${names.join(', ')}`);
    return { objective: field(entry.objective, 'objective'), progress: field(entry.progress, 'progress'),
      obstacles: version === 1 ? null : field(entry.obstacles, 'obstacles'),
      issues: version === 1 ? null : field(entry.issues, 'issues'),
      bottlenecks: version === 1 ? null : field(entry.bottlenecks, 'bottlenecks'),
      eta: version === 1 ? null : field(entry.eta, 'eta') };
  }) };
}
export function checkpoint(requestId: string, raw: string): Checkpoint {
  return versionedCheckpoint(requestId, raw, 2);
}
function versionedCheckpoint(requestId: string, raw: string, version: 1 | 2): Checkpoint {
  try { return { version, requestId, raw, report: parseVersionedReport(raw, version), error: null }; }
  catch (error) { return { version, requestId, raw, report: null, error: String(error) }; }
}
export function checkpoints(entries: readonly SessionEntry[]): Checkpoint[] {
  return entries.flatMap(entry => {
    if (entry.type !== 'custom' || entry.customType !== REPORT_TYPE) return [];
    const value = object(entry.data);
    if ((value.version !== 1 && value.version !== 2) || typeof value.requestId !== 'string' || typeof value.raw !== 'string') throw new Error('Invalid saved Cuckoo checkpoint');
    if (value.error !== null && typeof value.error !== 'string') throw new Error('Invalid saved Cuckoo checkpoint error');
    const parsed = versionedCheckpoint(value.requestId, value.raw, value.version);
    return [value.error === null ? parsed : { ...parsed, report: null, error: value.error }];
  });
}
function checkpointText(value: Checkpoint, header: string): string {
  if (value.report === null) return `${header}\nInvalid report: ${value.error}\nRaw output:\n${value.raw}`;
  if (value.report.objectives.length === 0) return `${header}\nNo current objectives.`;
  return `${header}\n` + value.report.objectives.map((item, i) => `${i + 1}. ${item.objective}\n   Progress: ${item.progress}\n   Obstacles: ${item.obstacles ?? 'Not recorded (legacy report)'}\n   Issues: ${item.issues ?? 'Not recorded (legacy report)'}\n   Bottlenecks: ${item.bottlenecks ?? 'Not recorded (legacy report)'}\n   ETA: ${item.eta ?? 'Not recorded (legacy report)'}`).join('\n\n');
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
