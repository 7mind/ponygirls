import type { Collector } from './collector.ts';
import { holdReason } from './admission.ts';

export type CollectorStatus = ReturnType<Collector['status']>;
const BYTE_BASE = 1024;
const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'] as const;
const PATH_ID_DISPLAY_LENGTH = 12;

function literal(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, character => `\\u${character.codePointAt(0)!.toString(16).padStart(4, '0')}`);
}
function count(value: number): string { return value.toLocaleString('en-US'); }
function bytes(value: number): string {
  let amount = value, unit = 0;
  while (amount >= BYTE_BASE && unit < BYTE_UNITS.length - 1) { amount /= BYTE_BASE; unit++; }
  return `${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${BYTE_UNITS[unit]}`;
}
function rootLabel(rootId: string, pathId: string): string { return `${literal(rootId)} [${literal(pathId.slice(0, PATH_ID_DISPLAY_LENGTH))}]`; }

export function formatCollectorStatus(status: CollectorStatus): string {
  const lines = ['Chronicle collector: enabled (configuration)', `Namespace: ${literal(status.namespace)}`];
  const report = status.lastRun;
  if (report === null) lines.push('No saved scan recorded.');
  else {
    const c = report.counters;
    lines.push(`Last saved scan started: ${new Date(report.at).toISOString()}`,
      `  Discovered: ${count(c.discovered)} · Scanned: ${count(c.scanned)} · Unchanged: ${count(c.unchanged)}`,
      `  Read: ${bytes(c.scannedBytes)} (${count(c.scannedBytes)} bytes) · Waiting: ${count(c.waiting)} · Excluded: ${count(c.excluded)}`,
      `  Enqueued: ${count(c.enqueued)} · Uploaded: ${count(c.uploaded)} · Upload failures: ${count(c.uploadFailures)}`,
      `  Quarantined: ${count(c.quarantined)} · Pending: ${count(c.pending)} · Stopped: ${count(c.stopped)} · Conflicts: ${count(c.conflicts)}`);
    if (report.roots.length > 0) lines.push(`Roots in last saved scan (${count(report.roots.length)}):`);
    for (const root of report.roots) lines.push(`  ${literal(root.format)} / ${rootLabel(root.rootId, root.pathId)}: discovered ${count(root.discovered)}, scanned ${count(root.scanned)}, read ${bytes(root.bytes)}, waiting ${count(root.waiting)}, excluded ${count(root.excluded)}, quarantined ${count(root.quarantined)}`);
  }
  const holds = new Map(status.diagnostics.flatMap(value => { const reason = holdReason(value); return reason === null ? [] : [[value.pathId, reason] as const]; }));
  const held = status.queue.filter(entry => holds.has(entry.sourceKey)).length;
  lines.push(status.queue.length === 0 ? 'Queue: empty' : `Queue: ${count(status.queue.length)} entries`);
  if (held > 0) lines.push(`Profile admission: ${count(held)} queued requests held (not eligible; payloads retained)`);
  for (const entry of status.queue) {
    const due = entry.status === 'pending' ? ` · next attempt: ${entry.nextAt === 0 ? 'due' : new Date(entry.nextAt).toISOString()}` : '';
    lines.push(`  ${literal(entry.requestId)}: ${literal(entry.status)} · attempts: ${count(entry.attempts)}${due} · source: ${literal(entry.sourceKey)}`);
    if (holds.has(entry.sourceKey)) lines.push(`    Admission: held · ${holds.get(entry.sourceKey)!}`);
    if (entry.error !== null) lines.push(`    Error: ${literal(entry.error)}`);
  }
  lines.push(`Diagnostics: ${count(status.diagnostics.length)}`);
  for (const diagnostic of status.diagnostics) lines.push(`  ${diagnostic.code === 'root-missing' ? 'root missing (root-missing)' : literal(diagnostic.code)}: ${rootLabel(diagnostic.rootId, diagnostic.pathId)}`);
  lines.push(`Dropped: ${count(status.dropped.length)}`);
  for (const entry of status.dropped) lines.push(`  ${literal(entry.requestId)}: ${literal(entry.reason)} · source: ${literal(entry.sourceKey)}`);
  const reporting = status.reporting;
  lines.push(`Reporting: sequence ${literal(reporting.sequence)}, acknowledged ${reporting.acceptedSequence === null ? 'never' : literal(reporting.acceptedSequence)}`);
  if (reporting.acceptedAt !== null) lines.push(`  Last acknowledged: ${new Date(reporting.acceptedAt).toISOString()}`);
  if (reporting.error !== null) lines.push(`  Error: ${literal(reporting.error)}`);
  lines.push('Saved local collection status; uploads do not imply completed server indexing.');
  return lines.join('\n') + '\n';
}
