import type { Collector, SourceLocation } from './collector.ts';
import { holdReason } from './admission.ts';
import { SERVER_PAYLOAD_TOO_LARGE } from './ingest.ts';
import type { Diagnostic } from './domain.ts';

export type CollectorStatus = ReturnType<Collector['status']>;
/** `files` and `unidentifiedFiles` are present when the sources were located (the dry run). */
export interface TombstoneReport {
  applied: boolean;
  policyChanged: { sourceKey: string; revision: number; acknowledged: boolean; files?: SourceLocation[] }[];
  unidentifiedFiles?: number;
  otherReasons: { sourceKey: string; reasons: string[] }[];
  unattributed: string[];
}
const BYTE_BASE = 1024;
const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'] as const;
const PATH_ID_DISPLAY_LENGTH = 12;

export function literal(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, character => `\\u${character.codePointAt(0)!.toString(16).padStart(4, '0')}`);
}
function count(value: number): string { return value.toLocaleString('en-US'); }
function bytes(value: number): string {
  let amount = value, unit = 0;
  while (amount >= BYTE_BASE && unit < BYTE_UNITS.length - 1) { amount /= BYTE_BASE; unit++; }
  return `${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${BYTE_UNITS[unit]}`;
}
function size(value: number): string { return `${bytes(value)} (${count(value)} bytes)`; }
function rootLabel(rootId: string, pathId: string): string { return `${literal(rootId)} [${literal(pathId.slice(0, PATH_ID_DISPLAY_LENGTH))}]`; }
const LIMIT_DESCRIPTIONS: Record<string, (measured: number, limit: number) => string> = {
  'snapshot-too-large': (measured, limit) => `file ${size(measured)} over maxFileBytes ${size(limit)}`,
  'message-limit': (measured, limit) => `${count(measured)} messages over maxMessages ${count(limit)}`,
  'payload-too-large': (measured, limit) => `encoded payload ${size(measured)} over maxPayloadBytes ${size(limit)}`,
};
function diagnosticLine(diagnostic: Diagnostic): string {
  const line = `  ${diagnostic.code === 'root-missing' ? 'root missing (root-missing)' : literal(diagnostic.code)}: ${rootLabel(diagnostic.rootId, diagnostic.pathId)}`;
  const limit = Object.hasOwn(LIMIT_DESCRIPTIONS, diagnostic.code) ? LIMIT_DESCRIPTIONS[diagnostic.code] : undefined;
  return limit === undefined || diagnostic.measured === undefined || diagnostic.limit === undefined ? line : `${line} · ${limit(diagnostic.measured, diagnostic.limit)}`;
}

export function formatTombstones(report: TombstoneReport): string {
  const plural = (value: number, noun: string): string => `${count(value)} ${noun}${value === 1 ? '' : 's'}`;
  const cleared = report.policyChanged.length;
  const lines = [report.applied
    ? cleared === 0 ? 'Cleared: none, no tombstone of a privacy or destination change is left' : `Cleared: ${plural(cleared, 'source')}, collected again at the next scan`
    : `Not collected since a privacy or destination change: ${cleared === 0 ? 'none' : plural(cleared, 'source')}`];
  for (const source of report.policyChanged) {
    lines.push(`  ${literal(source.sourceKey)} · ${source.acknowledged ? `last acknowledged revision ${count(source.revision)}` : 'never acknowledged'}`);
    if (source.files?.length === 0) lines.push('    no discovered file has this source');
    for (const file of source.files ?? []) lines.push(`    ${literal(file.path)} · ${size(file.bytes)}`);
  }
  if (cleared > 0 && report.unidentifiedFiles !== undefined && report.unidentifiedFiles > 0) lines.push(`${plural(report.unidentifiedFiles, 'discovered file')} could not be identified (over maxFileBytes, unreadable or incomplete); a source without a file may be among them.`);
  const others = report.otherReasons.length + report.unattributed.length;
  if (others > 0) lines.push(`Other tombstones, not cleared: ${count(others)}`);
  const byReasons = new Map<string, number>();
  for (const { reasons } of report.otherReasons) { const key = reasons.join(', '); byReasons.set(key, (byReasons.get(key) ?? 0) + 1); }
  for (const [reasons, number] of byReasons) lines.push(`  dropped for another reason (${literal(reasons)}): ${count(number)}`);
  if (report.unattributed.length > 0) lines.push(`  no recorded drop, reason unknown: ${count(report.unattributed.length)}`, ...report.unattributed.map(key => `    ${literal(key)}`));
  if (!report.applied && cleared > 0) lines.push('Dry run, nothing changed. --apply collects these sources again at the next scan.');
  return lines.join('\n') + '\n';
}

export function formatCollectorStatus(status: CollectorStatus): string {
  const lines = ['Chronicle collector: enabled (configuration)', `Namespace: ${literal(status.namespace)}`];
  lines.push(`Collection control: ${status.controls.paused ? 'paused' : 'resumed'} (durable; not daemon liveness)`, `Dynamic exclusions: ${count(status.controls.exclusions.length)}`);
  for (const path of status.controls.exclusions) lines.push(`  ${literal(path)}`);
  if (status.heldRequests.length > 0) lines.push(`Durable admission: ${count(status.heldRequests.length)} queued requests held (exact payloads retained)`);
  const report = status.lastRun;
  if (report === null) lines.push('No saved scan recorded.');
  else {
    const c = report.counters;
    lines.push(`Last saved scan started: ${new Date(report.at).toISOString()}`,
      `  Discovered: ${count(c.discovered)} · Scanned: ${count(c.scanned)} · Unchanged: ${count(c.unchanged)}`,
      `  Read: ${bytes(c.scannedBytes)} (${count(c.scannedBytes)} bytes) · Waiting: ${count(c.waiting)} · Excluded: ${count(c.excluded)}${c.deferred === undefined ? '' : ` · Deferred by scan budget: ${count(c.deferred)}`}`,
      `  Enqueued: ${count(c.enqueued)} · Uploaded: ${count(c.uploaded)} · Upload failures: ${count(c.uploadFailures)}`,
      `  Quarantined: ${count(c.quarantined)} · Pending: ${count(c.pending)} · Stopped: ${count(c.stopped)} · Conflicts: ${count(c.conflicts)}`);
    if (report.roots.length > 0) lines.push(`Roots in last saved scan (${count(report.roots.length)}):`);
    for (const root of report.roots) lines.push(`  ${literal(root.format)} / ${rootLabel(root.rootId, root.pathId)}: discovered ${count(root.discovered)}, scanned ${count(root.scanned)}, read ${bytes(root.bytes)}, waiting ${count(root.waiting)}, excluded ${count(root.excluded)}, quarantined ${count(root.quarantined)}${root.deferred === undefined ? '' : `, deferred ${count(root.deferred)}`}`);
  }
  const holds = new Map(status.diagnostics.flatMap(value => { const reason = holdReason(value); return reason === null ? [] : [[value.pathId, reason] as const]; }));
  const held = status.queue.filter(entry => holds.has(entry.sourceKey)).length;
  lines.push(status.queue.length === 0 ? 'Queue: empty' : `Queue: ${count(status.queue.length)} entries`);
  if (held > 0) lines.push(`Profile admission: ${count(held)} queued requests held (not eligible; payloads retained)`);
  for (const entry of status.queue) {
    const due = entry.status === 'pending' ? ` · next attempt: ${entry.nextAt === 0 ? 'due' : new Date(entry.nextAt).toISOString()}` : '';
    lines.push(`  ${literal(entry.requestId)}: ${literal(entry.status)} · attempts: ${count(entry.attempts)}${due} · source: ${literal(entry.sourceKey)}`);
    if (holds.has(entry.sourceKey)) lines.push(`    Admission: held · ${holds.get(entry.sourceKey)!}`);
    if (entry.error === SERVER_PAYLOAD_TOO_LARGE) lines.push(`    Error: refused by the server as too large (${SERVER_PAYLOAD_TOO_LARGE}) · payload ${size(entry.payloadBytes)}`);
    else if (entry.error !== null) lines.push(`    Error: ${literal(entry.error)}`);
  }
  lines.push(`Diagnostics: ${count(status.diagnostics.length)}`);
  for (const diagnostic of status.diagnostics) lines.push(diagnosticLine(diagnostic));
  lines.push(`Dropped: ${count(status.dropped.length)}`);
  for (const entry of status.dropped) lines.push(`  ${literal(entry.requestId)}: ${literal(entry.reason)} · source: ${literal(entry.sourceKey)}`);
  const reporting = status.reporting;
  lines.push(`Reporting: sequence ${literal(reporting.sequence)}, acknowledged ${reporting.acceptedSequence === null ? 'never' : literal(reporting.acceptedSequence)}`);
  if (reporting.acceptedAt !== null) lines.push(`  Last acknowledged: ${new Date(reporting.acceptedAt).toISOString()}`);
  if (reporting.error !== null) lines.push(`  Error: ${literal(reporting.error)}`);
  lines.push('Saved local collection status; uploads do not imply completed server indexing.');
  return lines.join('\n') + '\n';
}
