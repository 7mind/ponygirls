import type { SessionEntry } from '@earendil-works/pi-coding-agent';

export const REPORT_TYPE = 'cuckoo.report';
export const MAX_OBJECTIVES = 100;
export const MAX_FIELD_CHARS = 8000;
export const MAX_REPORT_CHARS = 100000;
export interface Objective { objective: string; progress: string }
export interface Report { objectives: Objective[] }
export interface Checkpoint { version: 1; requestId: string; raw: string; report: Report | null; error: string | null }
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected a JSON object');
  return value as Record<string, unknown>;
}
function field(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_FIELD_CHARS) throw new Error(`Expected ${name}: nonempty string, at most ${MAX_FIELD_CHARS} characters`);
  return value;
}
export function parseReport(raw: string): Report {
  if (raw.length > MAX_REPORT_CHARS) throw new Error(`Report exceeds ${MAX_REPORT_CHARS} characters`);
  const value = object(JSON.parse(raw));
  if (Object.keys(value).length !== 1 || !Array.isArray(value.objectives) || value.objectives.length > MAX_OBJECTIVES) throw new Error(`Expected only objectives: array, at most ${MAX_OBJECTIVES} items`);
  return { objectives: value.objectives.map(item => {
    const entry = object(item);
    if (Object.keys(entry).length !== 2) throw new Error('Each objective must contain only objective and progress');
    return { objective: field(entry.objective, 'objective'), progress: field(entry.progress, 'progress') };
  }) };
}
export function checkpoint(requestId: string, raw: string): Checkpoint {
  try { return { version: 1, requestId, raw, report: parseReport(raw), error: null }; }
  catch (error) { return { version: 1, requestId, raw, report: null, error: String(error) }; }
}
export function checkpoints(entries: readonly SessionEntry[]): Checkpoint[] {
  return entries.flatMap(entry => {
    if (entry.type !== 'custom' || entry.customType !== REPORT_TYPE) return [];
    const value = object(entry.data);
    if (value.version !== 1 || typeof value.requestId !== 'string' || typeof value.raw !== 'string') throw new Error('Invalid saved Cuckoo checkpoint');
    if (value.error !== null && typeof value.error !== 'string') throw new Error('Invalid saved Cuckoo checkpoint error');
    const parsed = checkpoint(value.requestId, value.raw);
    return [value.error === null ? parsed : { ...parsed, report: null, error: value.error }];
  });
}
export function reportText(reports: readonly Checkpoint[]): string {
  if (reports.length === 0) return 'No Cuckoo reports on this branch yet.';
  return [...reports].reverse().map((value, index) => {
    const header = `Checkpoint ${reports.length - index} (${value.requestId})`;
    if (value.report === null) return `${header}\nInvalid report: ${value.error}\nRaw output:\n${value.raw}`;
    if (value.report.objectives.length === 0) return `${header}\nNo current objectives.`;
    return `${header}\n` + value.report.objectives.map((item, i) => `${i + 1}. ${item.objective}\n   Progress: ${item.progress}`).join('\n\n');
  }).join('\n\n');
}
