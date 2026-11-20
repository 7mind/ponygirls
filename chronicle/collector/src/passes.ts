import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { CollectorError, object, string, type Format, type Json, type ParsedMessage, type ParsedMetadata } from './domain.ts';
import { checkSize, closeSource, excludedPath, openSource, sameStat, verifyUnchanged, type OpenSource, type SourceFile, type SourceStat } from './discovery.ts';
import { pathAliases, type AdmissionEvidence } from './controls.ts';
import { readLines, RecordOverLimitError, type Line } from './lines.ts';
import { CodexDuplicates, messageOf, parseJson, recordOf, TranscriptState, type TranscriptIdentity } from './parsers.ts';
import { messageDigest, MessageChain, partDigest } from './chain.ts';
import type { PrivacyPolicy } from './privacy.ts';
import type { Exclusions } from './config.ts';
import { Message, Message_JsonCodec } from '../../generated/typescript/chronicle/api/Message.js';
import { BaboonCodecContext } from '../../generated/typescript/BaboonSharedRuntime.js';

/** Admission evidence of one file: distinct `cwd` values with their aliases (spec §6, review B2). */
export const EVIDENCE_LIMITS = { values: 1_024, bytes: 1_048_576, valueBytes: 4_096 } as const;
/** Recorded positions and counts are i32 on the wire. */
const MAX_RECORD_INDEX = 2_147_483_647;
export class EvidenceLimitError extends CollectorError {
  constructor(readonly values: number, readonly bytes: number) { super('admission-evidence-limit'); }
}
class EvidenceSet {
  private readonly values = new Set<string>(); private readonly paths = new Set<string>();
  private bytes = 0; private uncertain = false;
  record(path: string): void {
    if (Buffer.byteLength(path) > EVIDENCE_LIMITS.valueBytes) throw new EvidenceLimitError(this.values.size + 1, this.bytes + Buffer.byteLength(path));
    if (!isAbsolute(path)) { this.uncertain = true; return; }
    if (this.values.has(path)) return;
    let aliases: string[];
    try { aliases = pathAliases(path); } catch { aliases = []; this.uncertain = true; }
    const added = [...new Set([resolve(path), ...aliases])].filter(alias => !this.paths.has(alias));
    // The value itself is retained too (for deduplication), however short its aliases.
    const bytes = this.bytes + Buffer.byteLength(path) + added.reduce((sum, alias) => sum + Buffer.byteLength(alias), 0);
    if (this.values.size + 1 > EVIDENCE_LIMITS.values || bytes > EVIDENCE_LIMITS.bytes) throw new EvidenceLimitError(this.values.size + 1, bytes);
    this.values.add(path); for (const alias of added) this.paths.add(alias); this.bytes = bytes;
  }
  get evidence(): AdmissionEvidence { return { paths: [...this.paths], ...(this.uncertain ? { uncertain: true as const } : {}) }; }
}

const strictDecoders = [new TextDecoder('utf-8', { fatal: true }), new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })] as const;
/** A line as the whole-file decoder sees it: a byte-order mark is dropped only at the start of the file. */
function decodeLine(line: Line): string | null {
  try { return strictDecoders[line.index === 0 && line.offset === 0n ? 0 : 1].decode(line.bytes); } catch { return null; }
}
const startsWithBom = (bytes: Buffer): boolean => bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;

function withSource<T>(file: SourceFile, use: (source: OpenSource) => T): T {
  let source: OpenSource | null = null;
  try { source = openSource(file); return use(source); }
  catch (error) { throw error instanceof CollectorError ? error : new CollectorError('snapshot-read-failed'); }
  finally { if (source !== null) closeSource(source); }
}
/** Codex drops an `event_msg` message that duplicates a `response_item` message anywhere in the file: count those first. */
function codexDuplicates(source: OpenSource, policy: PrivacyPolicy, cap: number, maxMessages: number): CodexDuplicates {
  const duplicates = new CodexDuplicates(maxMessages);
  for (const line of readLines(source.descriptor, 0n, source.size, 0, cap)) {
    if (!line.terminated) break;
    const text = decodeLine(line); if (text === null) continue;
    let value: Json; try { value = JSON.parse(text) as Json; } catch { continue; }
    // Redaction cannot produce the type string, so other records need not be redacted here.
    if (!object(value) || value['type'] !== 'response_item') continue;
    try { duplicates.add(recordOf('codex', value, text, line.index, policy).record); } catch { continue; }
  }
  return duplicates;
}

/** The redacted raw and message chain of a transcript prefix ending before record `recordCount`, at `fileOffset`. */
export interface TranscriptPrefix { recordCount: number; digest: string; rawBytes: bigint; messageCount: number; messageChain: string; fileOffset: bigint }
/** What an upload of the whole file declares, known only after pass 1 has read all of it. */
export interface StreamedTranscript extends TranscriptIdentity {
  metadata: ParsedMetadata; redacted: boolean; repairs: number;
  digest: string; rawBytes: bigint; recordCount: number; messageCount: number; messageChain: string;
  prefix: TranscriptPrefix | null;
}
/** Pass 1. The outcomes keep the precedence of a whole-file read: evidence and exclusions, the partial last line, then
 * `error` (invalid UTF-8, the first invalid record, identity, messages). `transcript` is set when nothing refuses it. */
export interface Preflight {
  size: bigint; stat: SourceStat; fileDigest: string; mtimeMs: number;
  evidence: AdmissionEvidence; excluded: boolean; partial: boolean; error: string | null;
  transcript: StreamedTranscript | null;
}
export interface PreflightInput {
  file: SourceFile; policy: PrivacyPolicy; exclusions: Exclusions; maxFileBytes: number; scanBudget: number;
  recordCap: number; maxMessages: number;
  /** Record a prefix snapshot at this record count (the head's base), if the file reaches it. */
  prefixRecords: number | null;
}
/** Pass 1 — preflight: reads the whole file with a capped line reader before anything is sent. */
export function preflight(input: PreflightInput): Preflight {
  const { file, policy } = input; const format = file.root.format;
  return withSource(file, source => {
    checkSize(source.size, input.maxFileBytes, input.scanBudget);
    const duplicates = format === 'codex' ? codexDuplicates(source, policy, input.recordCap, input.maxMessages) : null;
    const evidence = new EvidenceSet(); evidence.record(file.path);
    const state = new TranscriptState(format, file.path);
    const fileHash = createHash('sha256'); const rawHash = createHash('sha256'); const chain = new MessageChain();
    let rawBytes = 0n; let messageCount = 0; let redacted = false; let prefix: TranscriptPrefix | null = null;
    // An empty file has no final newline either.
    let excluded = false; let exclusionOpen = true; let partial = source.size === 0n;
    let invalidUtf8 = false; let lineError: string | null = null; let messageError: string | null = null;
    const snapshot = (recordCount: number, fileOffset: bigint): TranscriptPrefix => ({ recordCount, digest: rawHash.copy().digest('hex'), rawBytes, messageCount, messageChain: chain.hex, fileOffset });
    for (const line of readLines(source.descriptor, 0n, source.size, 0, input.recordCap)) {
      fileHash.update(line.bytes); if (line.terminated) fileHash.update('\n');
      const strict = decodeLine(line);
      const same = strict !== null && !(line.index === 0 && startsWithBom(line.bytes));
      const lenient = same ? strict : line.bytes.toString('utf8');
      let value: Json | undefined; try { value = JSON.parse(lenient) as Json; } catch { value = undefined; }
      // Admission evidence and exclusions read the lines as they are, before redaction.
      if (object(value)) for (const entry of [value, value['payload']]) if (object(entry) && typeof entry['cwd'] === 'string') evidence.record(entry['cwd']);
      if (exclusionOpen && !excluded && lenient.length > 0) {
        if (value === undefined) exclusionOpen = false;
        else if (object(value)) {
          const payload = object(value['payload']) ? value['payload'] : value;
          const workdir = string(payload['cwd']);
          if (workdir !== null && excludedPath(workdir, input.exclusions.projects)) excluded = true;
          const identityKeys = value['type'] === 'session' || value['type'] === 'session_meta' ? ['id', 'session_id'] : ['sessionId', 'agentId'];
          for (const key of identityKeys) { const id = string(payload[key]); if (id !== null && input.exclusions.sessions.includes(id)) excluded = true; }
        }
      }
      if (!line.terminated) { partial = true; continue; }
      if (strict === null) { invalidUtf8 = true; continue; }
      if (lineError !== null) continue;
      if (line.index > MAX_RECORD_INDEX) { lineError = 'record-index-limit'; continue; }
      try {
        if (input.prefixRecords !== null && line.index === input.prefixRecords && input.prefixRecords > 0) prefix = snapshot(line.index, line.offset);
        const parsed = recordOf(format, same ? (value === undefined ? parseJson(strict) : value) : parseJson(strict), strict, line.index, policy);
        const rawLineBytes = Buffer.byteLength(parsed.raw);
        // The server measures the redacted record; it must stay within the cap too.
        if (rawLineBytes > input.recordCap) throw new RecordOverLimitError(line.index, BigInt(rawLineBytes), input.recordCap);
        rawHash.update(parsed.raw); rawHash.update('\n'); rawBytes += BigInt(rawLineBytes) + 1n; redacted ||= parsed.redacted;
        state.add(parsed.record);
        if (messageError === null) {
          try {
            const message = messageOf(format, parsed.record, duplicates !== null && !duplicates.overflowed ? duplicates : null, policy);
            if (message !== null) { redacted ||= message.redacted; state.message(message.message, message.replaced); chain.extend(messageDigest(message.message)); messageCount++; }
          } catch (error) { messageError = error instanceof CollectorError ? error.code : 'parse-failed'; }
        }
      } catch (error) {
        if (error instanceof RecordOverLimitError) throw error;
        lineError = error instanceof CollectorError ? error.code : 'parse-failed';
      }
    }
    verifyUnchanged(file, source, source.size);
    const result = { size: source.size, stat: source.stat, fileDigest: fileHash.digest('hex'), mtimeMs: Number(source.before.mtimeNs / 1_000_000n), evidence: evidence.evidence, excluded, partial };
    let error = invalidUtf8 ? 'invalid-utf8' : lineError;
    let identity: TranscriptIdentity | null = null;
    if (error === null && !partial) {
      try { identity = state.identity(); } catch (failure) { error = failure instanceof CollectorError ? failure.code : 'parse-failed'; }
      error ??= messageError;
    }
    if (error !== null || partial || identity === null) return { ...result, error, transcript: null };
    if (input.prefixRecords !== null && input.prefixRecords > 0 && input.prefixRecords === state.recordCount) prefix = snapshot(state.recordCount, source.size);
    return { ...result, error, transcript: { ...identity, ...state.metadata(identity), redacted, digest: rawHash.digest('hex'), rawBytes, recordCount: state.recordCount, messageCount, messageChain: chain.hex, prefix } };
  });
}

/** One encoded `UploadPart` body: whole records only. A `large` part holds one record whose part exceeds the budget. */
export interface GeneratedPart { ordinal: number; body: string; sha256: string; rawBytes: bigint; messages: number; records: number; large: boolean; firstRecord: number }
/** The delta pass 2 produced: appended to the base, it must equal the declaration. */
export interface PartsSummary { rawBytes: bigint; messages: number; messageChain: string }
export interface PartsInput {
  file: SourceFile; policy: PrivacyPolicy; stat: SourceStat; recordCap: number; maxMessages: number;
  /** The first record to send and its file offset: the base of an append, or 0. */
  startRecord: number; startOffset: bigint; baseChain: string;
  partBudget: number; maxLargePartBytes: number;
}
const codec = BaboonCodecContext.Default;
const encodeMessage = (m: ParsedMessage): string => JSON.stringify(Message_JsonCodec.instance.encode(codec, new Message(m.id, m.parentId ?? undefined, m.role, m.text, m.timestamp ?? undefined, m.recordIndex)));
const escaped = (raw: string): string => JSON.stringify(raw).slice(1, -1);
const partOverhead = (ordinal: number): number => Buffer.byteLength(`{"ordinal":${ordinal},"sha256":"${'0'.repeat(64)}","raw":"","messages":[]}`);
/** Greedy packing of whole records into parts of at most `budget` encoded bytes. */
class PartPacker {
  private raw: string[] = []; private rawEncoded: string[] = []; private messages: string[] = []; private digests: Buffer[] = [];
  private bytes = 0; private rawBytes = 0n; private records = 0; private firstRecord = 0;
  ordinal = 0;
  constructor(private readonly budget: number, private readonly maxLarge: number) {}
  private size(ordinal: number, bytes: number, messages: number): number { return partOverhead(ordinal) + bytes + Math.max(0, messages - 1); }
  *add(index: number, raw: string, messages: ParsedMessage[], digests: Buffer[]): Generator<GeneratedPart> {
    const line = raw + '\n'; const rawEncoded = escaped(line); const encoded = messages.map(encodeMessage);
    const bytes = Buffer.byteLength(rawEncoded) + encoded.reduce((sum, message) => sum + Buffer.byteLength(message), 0);
    if (this.records > 0 && this.size(this.ordinal, this.bytes + bytes, this.messages.length + encoded.length) > this.budget) yield this.emit(false);
    if (this.records === 0) this.firstRecord = index;
    this.raw.push(line); this.rawEncoded.push(rawEncoded); this.messages.push(...encoded); this.digests.push(...digests);
    this.bytes += bytes; this.rawBytes += BigInt(Buffer.byteLength(line)); this.records++;
    if (this.records === 1 && this.size(this.ordinal, this.bytes, this.messages.length) > this.budget) yield this.emit(true);
  }
  finish(): GeneratedPart | null { return this.records === 0 ? null : this.emit(false); }
  private emit(large: boolean): GeneratedPart {
    const sha256 = partDigest(this.raw, this.digests);
    const body = `{"ordinal":${this.ordinal},"sha256":"${sha256}","raw":"${this.rawEncoded.join('')}","messages":[${this.messages.join(',')}]}`;
    const size = Buffer.byteLength(body);
    if (size !== this.size(this.ordinal, this.bytes, this.messages.length)) throw new CollectorError('part-size-invariant');
    if (size > (large ? this.maxLarge : this.budget)) throw new CollectorError('upload-part-too-large');
    const part: GeneratedPart = { ordinal: this.ordinal++, body, sha256, rawBytes: this.rawBytes, messages: this.digests.length, records: this.records, large, firstRecord: this.firstRecord };
    this.raw = []; this.rawEncoded = []; this.messages = []; this.digests = []; this.bytes = 0; this.rawBytes = 0n; this.records = 0;
    return part;
  }
}
/** Pass 2 — regenerates the parts from the file, from the base of an append or from the start. A Codex file is read
 * from its start, because the messages of the delta depend on the duplicates before it. */
export function* generateParts(input: PartsInput): Generator<GeneratedPart, PartsSummary> {
  const { file, policy } = input; const format: Format = file.root.format;
  let source: OpenSource | null = null;
  try {
    source = openSource(file);
    if (!sameStat(source.stat, input.stat)) throw new CollectorError('source-changed');
    const duplicates = format === 'codex' ? codexDuplicates(source, policy, input.recordCap, input.maxMessages) : null;
    const packer = new PartPacker(input.partBudget, input.maxLargePartBytes);
    const chain = new MessageChain(input.baseChain); let rawBytes = 0n; let messages = 0;
    const [offset, first] = format === 'codex' ? [0n, 0] : [input.startOffset, input.startRecord];
    for (const line of readLines(source.descriptor, offset, source.size, first, input.recordCap)) {
      const text = decodeLine(line);
      if (!line.terminated || text === null) throw new CollectorError('source-changed');
      const parsed = recordOf(format, parseJson(text), text, line.index, policy);
      const message = messageOf(format, parsed.record, duplicates, policy);
      if (line.index < input.startRecord) continue;
      const digests = message === null ? [] : [messageDigest(message.message)];
      for (const digest of digests) chain.extend(digest);
      rawBytes += BigInt(Buffer.byteLength(parsed.raw)) + 1n; messages += digests.length;
      yield* packer.add(line.index, parsed.raw, message === null ? [] : [message.message], digests);
    }
    const last = packer.finish(); if (last !== null) yield last;
    verifyUnchanged(file, source, source.size);
    return { rawBytes, messages, messageChain: chain.hex };
  } catch (error) { throw error instanceof CollectorError ? error : new CollectorError('snapshot-read-failed'); }
  finally { if (source !== null) closeSource(source); }
}
