import { uploadsPausedText, type Collector, type SourceLocation } from './collector.ts';
import { EVIDENCE_LIMITS } from './passes.ts';
import type { IdentifierRefusal, RecordOverLimit } from './spool.ts';
import { IDENTIFIER_UNICODE } from './unicode.ts';
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
  'admission-evidence-limit': (measured, limit) => `${size(measured)} of admission evidence over ${size(limit)}, or a path over ${count(EVIDENCE_LIMITS.valueBytes)} bytes`,
};
function identifierRefusalText(refusal: IdentifierRefusal): string {
  return `${literal(refusal.format)} session ${literal(refusal.pathId.slice(0, PATH_ID_DISPLAY_LENGTH))}: an identifier holds an unpaired UTF-16 surrogate (${IDENTIFIER_UNICODE}). This session is not uploaded; it is read again when the file changes.`;
}
/** The text of a source in `record-over-limit`, until its stat or a limit changes. */
export function recordOverLimitText(row: RecordOverLimit): string {
  return `${literal(row.format)} session ${literal(row.pathId.slice(0, PATH_ID_DISPLAY_LENGTH))}: record ${count(row.recordIndex)} is ${count(Number(row.size))} bytes, above the record limit of ${count(row.limit)} bytes (${row.limitSource} maxRecordBytes). This session is not uploaded. Raise maxRecordBytes on the collector and on the server (both, at most 134,217,728) and it is uploaded at the next scan.`;
}
function diagnosticLine(diagnostic: Diagnostic): string {
  const line = `  ${diagnostic.code === 'root-missing' ? 'root missing (root-missing)' : literal(diagnostic.code)}: ${rootLabel(diagnostic.rootId, diagnostic.pathId)}`;
  const limit = Object.hasOwn(LIMIT_DESCRIPTIONS, diagnostic.code) ? LIMIT_DESCRIPTIONS[diagnostic.code] : undefined;
  const values = diagnostic.values === undefined ? '' : ` · ${count(diagnostic.values)} distinct paths (limit ${count(EVIDENCE_LIMITS.values)})`;
  return limit === undefined || diagnostic.measured === undefined || diagnostic.limit === undefined ? line : `${line} · ${limit(diagnostic.measured, diagnostic.limit)}${values}`;
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
  const paused = status.uploadProtocol === 'parts' && status.server.probe?.outcome === 'unsupported';
  const lines = [...(paused ? [uploadsPausedText(literal(status.server.endpoint))] : []), 'Chronicle collector: enabled (configuration)', `Namespace: ${literal(status.namespace)}`,
    `Upload protocol: ${status.uploadProtocol}${status.uploadProtocol === 'parts' && status.server.probe !== null ? ` · server ${status.server.probe.outcome === 'failed' ? `not reached (${literal(status.server.probe.code ?? 'unknown')})` : status.server.probe.outcome === 'supported' ? 'has the part-upload API' : 'has no part-upload API'}` : ''}`];
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
      `  Quarantined: ${count(c.quarantined)} · Pending: ${count(c.pending)} · Stopped: ${count(c.stopped)} · Conflicts: ${count(c.conflicts)}${c.replacements === undefined ? '' : ` · Replacements: ${count(c.replacements)}`}`);
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
  if (status.uploads.length > 0) lines.push(`Part uploads: ${count(status.uploads.length)}`);
  for (const upload of status.uploads) {
    const due = upload.status === 'pending' ? ` · next attempt: ${upload.nextAt === 0 ? 'due' : new Date(upload.nextAt).toISOString()}` : '';
    lines.push(`  ${literal(upload.requestId)}: ${literal(upload.status)} · ${upload.append ? 'append' : 'replacement'} · ${size(Number(upload.newRawBytes))} new of ${size(Number(upload.rawBytes))} · parts acknowledged: ${count(upload.partsAcked)} · attempts: ${count(upload.attempts)}${due} · source: ${literal(upload.sourceKey)}`);
    if (upload.refused !== undefined) lines.push(`    Error: refused by the server as too large (upload-too-large) · ${upload.refused.unit === 'bytes' ? `${size(Number(upload.refused.measured))} over the server's maxRawBytes ${size(Number(upload.refused.limit))}` : `${count(Number(upload.refused.measured))} messages over the server's maxMessages ${count(Number(upload.refused.limit))}`}`);
    else if (upload.error !== null) lines.push(`    Error: ${literal(upload.error)}`);
  }
  if (status.unicodeRepairs.length > 0) lines.push(`Unicode repaired (unpaired UTF-16 surrogates replaced with U+FFFD in message text or metadata; raw unchanged): ${count(status.unicodeRepairs.length)} sources`);
  for (const repair of status.unicodeRepairs) lines.push(`  ${literal(repair.sourceKey)} · revision ${count(repair.revision)} · ${count(repair.replaced)} code units`);
  if (status.identifierRefusals.length > 0) lines.push(`Identifiers refused: ${count(status.identifierRefusals.length)}`);
  for (const refusal of status.identifierRefusals) lines.push(`  ${identifierRefusalText(refusal)}`);
  if (status.recordsOverLimit.length > 0) lines.push(`Records over the record limit: ${count(status.recordsOverLimit.length)}`);
  for (const row of status.recordsOverLimit) lines.push(`  ${recordOverLimitText(row)}`);
  // Refused records and identifiers are shown above while they last, not only in the scan that found them.
  const diagnostics = status.diagnostics.filter(diagnostic => diagnostic.code !== 'record-over-limit' && diagnostic.code !== IDENTIFIER_UNICODE);
  lines.push(`Diagnostics: ${count(diagnostics.length)}`);
  for (const diagnostic of diagnostics) lines.push(diagnosticLine(diagnostic));
  lines.push(`Dropped: ${count(status.dropped.length)}`);
  for (const entry of status.dropped) lines.push(`  ${literal(entry.requestId)}: ${literal(entry.reason)} · source: ${literal(entry.sourceKey)}`);
  const reporting = status.reporting;
  lines.push(`Reporting: sequence ${literal(reporting.sequence)}, acknowledged ${reporting.acceptedSequence === null ? 'never' : literal(reporting.acceptedSequence)}`);
  if (reporting.acceptedAt !== null) lines.push(`  Last acknowledged: ${new Date(reporting.acceptedAt).toISOString()}`);
  if (reporting.error !== null) lines.push(`  Error: ${literal(reporting.error)}`);
  lines.push('Saved local collection status; uploads do not imply completed server indexing.');
  return lines.join('\n') + '\n';
}
