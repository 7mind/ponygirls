import { createHash, type Hash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { CollectorError, object, string, type Format, type Json, type ParsedMessage, type ParsedMetadata } from './domain.ts';
import { checkSize, closeSource, excludedPath, openSource, sameStat, verifyUnchanged, type OpenSource, type SourceFile, type SourceStat } from './discovery.ts';
import { pathAliases, type AdmissionEvidence } from './controls.ts';
import { hashRange, readLines, RecordOverLimitError, type Line } from './lines.ts';
import { CodexDuplicates, messageOf, parseJson, recordOf, TranscriptState, type CodexBalance, type TranscriptIdentity, type TranscriptSnapshot } from './parsers.ts';
import { messageDigest, MessageChain, partDigest } from './chain.ts';
import { Sha256 } from './sha256.ts';
import type { PrivacyPolicy } from './privacy.ts';
import type { Exclusions } from './config.ts';
import { Message, Message_JsonCodec } from '../../generated/typescript/chronicle/api/Message.js';
import { BaboonCodecContext } from '../../generated/typescript/BaboonSharedRuntime.js';

export type { CodexBalance } from './parsers.ts';
/** Admission evidence of one file: distinct `cwd` values with their aliases (spec §6, review B2). */
export const EVIDENCE_LIMITS = { values: 1_024, bytes: 1_048_576, valueBytes: 4_096 } as const;
/** Recorded positions and counts are i32 on the wire. */
export const MAX_RECORD_INDEX = 2_147_483_647;
export class EvidenceLimitError extends CollectorError {
  constructor(readonly values: number, readonly bytes: number) { super('admission-evidence-limit'); }
}
/** The admission evidence a checkpoint keeps: the distinct absolute `cwd` values in file order (their aliases are
 * resolved again when resumed, as a full pass would) and whether a relative one was seen. */
export interface EvidenceValues { values: string[]; relative: boolean }
class EvidenceSet {
  private readonly values = new Set<string>(); private readonly paths = new Set<string>();
  private bytes = 0; private relative = false; private unresolved = false;
  static resume(path: string, stored: EvidenceValues): EvidenceSet {
    const evidence = new EvidenceSet(); evidence.record(path);
    for (const value of stored.values) evidence.record(value);
    evidence.relative ||= stored.relative; return evidence;
  }
  record(path: string): void {
    if (Buffer.byteLength(path) > EVIDENCE_LIMITS.valueBytes) throw new EvidenceLimitError(this.values.size + 1, this.bytes + Buffer.byteLength(path));
    if (!isAbsolute(path)) { this.relative = true; return; }
    if (this.values.has(path)) return;
    let aliases: string[];
    try { aliases = pathAliases(path); } catch { aliases = []; this.unresolved = true; }
    const added = [...new Set([resolve(path), ...aliases])].filter(alias => !this.paths.has(alias));
    // The value itself is retained too (for deduplication), however short its aliases.
    const bytes = this.bytes + Buffer.byteLength(path) + added.reduce((sum, alias) => sum + Buffer.byteLength(alias), 0);
    if (this.values.size + 1 > EVIDENCE_LIMITS.values || bytes > EVIDENCE_LIMITS.bytes) throw new EvidenceLimitError(this.values.size + 1, bytes);
    this.values.add(path); for (const alias of added) this.paths.add(alias); this.bytes = bytes;
  }
  get evidence(): AdmissionEvidence { return { paths: [...this.paths], ...(this.relative || this.unresolved ? { uncertain: true as const } : {}) }; }
  get stored(): EvidenceValues { return { values: [...this.values], relative: this.relative }; }
}

const strictDecoders = [new TextDecoder('utf-8', { fatal: true }), new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })] as const;
/** A line as the whole-file decoder sees it: a byte-order mark is dropped only at the start of the file. */
function decodeLine(line: Line): string | null {
  try { return strictDecoders[line.index === 0 && line.offset === 0n ? 0 : 1].decode(line.bytes); } catch { return null; }
}
const startsWithBom = (bytes: Buffer): boolean => bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
const NEWLINE = Buffer.from('\n');

function withSource<T>(file: SourceFile, use: (source: OpenSource) => T): T {
  let source: OpenSource | null = null;
  try { source = openSource(file); return use(source); }
  catch (error) { throw error instanceof CollectorError ? error : new CollectorError('snapshot-read-failed'); }
  finally { if (source !== null) closeSource(source); }
}
/** Codex drops an `event_msg` message that duplicates a `response_item` message anywhere in the file: count those of
 * [start, size) first, on top of the balances `stored` holds for the records before `start`. */
function codexDuplicates(source: OpenSource, policy: PrivacyPolicy, cap: number, maxMessages: number, start: bigint, firstIndex: number, stored?: CodexLookup): CodexDuplicates {
  const duplicates = new CodexDuplicates(maxMessages, stored);
  for (const line of readLines(source.descriptor, start, source.size, firstIndex, cap)) {
    if (!line.terminated) break;
    const text = decodeLine(line); if (text === null) continue;
    let value: Json; try { value = JSON.parse(text) as Json; } catch { continue; }
    // Redaction cannot produce the type string, so other records need not be redacted here.
    if (!object(value) || value['type'] !== 'response_item') continue;
    try { duplicates.add(recordOf('codex', value, text, line.index, policy).record); } catch { continue; }
  }
  return duplicates;
}

/** Bump when pass 1's result for given lines changes (parsing, redaction rules, normalization, metadata): a checkpoint of
 * another version is not resumed. */
export const CHECKPOINT_VERSION = 1;
/** The diagnostic of an incremental pass whose prefix no longer hashes to the checkpoint's: the file was edited. */
export const SOURCE_PREFIX_CHANGED = 'source-prefix-changed';
/** Why pass 1 read the whole file (append-limits spec §2.2 item 3): no usable checkpoint, the checkpoint does not
 * describe the head or the current policy and limits, another file, a file that did not grow, an edited prefix, or a
 * Codex addition that changes the prefix's messages. */
export type FullPassReason = 'no-checkpoint' | 'checkpoint-version' | 'checkpoint-invalid' | 'head-moved' | 'upload-queued' | 'policy-changed' | 'limits-changed'
  | 'file-replaced' | 'not-grown' | typeof SOURCE_PREFIX_CHANGED | 'codex-dedup-changed';
/** Pass 1's state at the end of the file it read (append-limits spec §2.2 item 2): everything an incremental pass
 * resumes from. Sizes and offsets are decimal; `rawState` is the redacted raw's SHA-256 state (`Sha256`). */
export interface PassState {
  dev: string; ino: string; fileOffset: string; filePrefixSha256: string;
  recordCount: number; rawBytes: string; rawState: string; messageCount: number; messageChain: string; redacted: boolean;
  transcript: TranscriptSnapshot; excluded: boolean; exclusionOpen: boolean; evidence: EvidenceValues;
}
/** Codex duplicate balances `[key, credits, kept]` stored beside a checkpoint: all of the file's (`reset`), or the
 * changes of an incremental pass (a row of zeros is removed). */
export interface CodexRows { reset: boolean; rows: [string, number, number][] }
/** What a pass that may be uploaded leaves: the checkpoint state, the Codex rows and — for an incremental Codex pass —
 * the prefix credits pass 2 resumes from. */
export interface PassEnd { state: PassState; codex: CodexRows | null; codexSeed: Record<string, number> | null }
export type CodexLookup = (key: string) => CodexBalance | undefined;
/** Resume from a checkpoint state with its stored Codex balances, or read the whole file for `reason`. */
export type PassStart = { checkpoint: PassState; codex: CodexLookup } | { reason: FullPassReason };
/** `--status` per source: parsed bytes went through the line parser, hashed bytes only through the prefix check. */
export interface PassReport { kind: 'incremental' | 'full'; reason: FullPassReason | null; parsedBytes: bigint; hashedBytes: bigint }

/** The redacted raw and message chain of a transcript prefix ending before record `recordCount`, at `fileOffset`. */
export interface TranscriptPrefix { recordCount: number; digest: string; rawBytes: bigint; messageCount: number; messageChain: string; fileOffset: bigint }
/** What an upload of the whole file declares, known only after pass 1 has read all of it. */
export interface StreamedTranscript extends TranscriptIdentity {
  metadata: ParsedMetadata; redacted: boolean; repairs: number;
  digest: string; rawBytes: bigint; recordCount: number; messageCount: number; messageChain: string;
  prefix: TranscriptPrefix | null;
}
/** Pass 1. The outcomes keep the precedence of a whole-file read: evidence and exclusions, the partial last line, then
 * `error` (invalid UTF-8, the first invalid record, identity, messages). `transcript` and `end` are set when nothing
 * refuses it. */
export interface Preflight {
  size: bigint; stat: SourceStat; fileDigest: string;
  evidence: AdmissionEvidence; excluded: boolean; partial: boolean; error: string | null;
  transcript: StreamedTranscript | null; pass: PassReport; end: PassEnd | null;
}
export interface PreflightInput {
  file: SourceFile; policy: PrivacyPolicy; exclusions: Exclusions; maxFileBytes: number; scanBudget: number;
  recordCap: number; maxMessages: number;
  /** Record a prefix snapshot at this record count (the head's base), if the file reaches it (full pass). */
  prefixRecords: number | null;
  start: PassStart;
}
/** Where the per-line code of pass 1 starts: the start of the file, or a checkpoint. */
interface Seed {
  offset: bigint; index: number; evidence: EvidenceSet; state: TranscriptState; rawHash: Sha256; rawBytes: bigint;
  messageCount: number; chain: MessageChain; redacted: boolean; excluded: boolean; exclusionOpen: boolean;
  fileHash: Hash; duplicates: CodexDuplicates | null; prefix: TranscriptPrefix | null;
}
/** Pass 1 — preflight: reads the file with a capped line reader before anything is sent; from a checkpoint only the
 * addition after it, once the file's prefix hashes to the checkpoint's digest. */
export function preflight(input: PreflightInput): Preflight {
  return withSource(input.file, source => {
    checkSize(source.size, input.maxFileBytes, input.scanBudget);
    let reason: FullPassReason; let hashedBytes = 0n;
    if ('checkpoint' in input.start) {
      const resumed = resume(input, source, input.start.checkpoint, input.start.codex);
      if ('seed' in resumed) return pass(input, source, resumed.seed, { kind: 'incremental', reason: null, parsedBytes: source.size - resumed.seed.offset, hashedBytes: resumed.seed.offset });
      ({ reason, hashedBytes } = resumed);
    } else reason = input.start.reason;
    return pass(input, source, fresh(input, source), { kind: 'full', reason, parsedBytes: source.size, hashedBytes });
  });
}
function fresh(input: PreflightInput, source: OpenSource): Seed {
  const { file, policy } = input;
  const duplicates = file.root.format === 'codex' ? codexDuplicates(source, policy, input.recordCap, input.maxMessages, 0n, 0) : null;
  const evidence = new EvidenceSet(); evidence.record(file.path);
  return { offset: 0n, index: 0, evidence, state: new TranscriptState(file.root.format, file.path), rawHash: new Sha256(), rawBytes: 0n, messageCount: 0, chain: new MessageChain(),
    redacted: false, excluded: false, exclusionOpen: true, fileHash: createHash('sha256'), duplicates, prefix: null };
}
/** The seed of an incremental pass, or why the whole file must be read and how much of it was hashed to find out. */
function resume(input: PreflightInput, source: OpenSource, checkpoint: PassState, codex: CodexLookup): { seed: Seed } | { reason: FullPassReason; hashedBytes: bigint } {
  const { file, policy } = input; const offset = BigInt(checkpoint.fileOffset);
  if (checkpoint.dev !== source.stat.dev || checkpoint.ino !== source.stat.ino) return { reason: 'file-replaced', hashedBytes: 0n };
  if (source.size <= offset) return { reason: 'not-grown', hashedBytes: 0n };
  const fileHash = createHash('sha256'); hashRange(source.descriptor, 0n, offset, fileHash);
  if (fileHash.copy().digest('hex') !== checkpoint.filePrefixSha256) return { reason: SOURCE_PREFIX_CHANGED, hashedBytes: offset };
  let duplicates: CodexDuplicates | null = null;
  if (file.root.format === 'codex') {
    duplicates = codexDuplicates(source, policy, input.recordCap, input.maxMessages, offset, checkpoint.recordCount, codex);
    // Above maxMessages response items in the addition alone the file is refused anyway; the full pass measures it.
    if (duplicates.prefixChanged || duplicates.overflowed) return { reason: 'codex-dedup-changed', hashedBytes: offset };
  }
  const rawHash = Sha256.resume(checkpoint.rawState); const rawBytes = BigInt(checkpoint.rawBytes);
  const prefix: TranscriptPrefix = { recordCount: checkpoint.recordCount, digest: rawHash.digest(), rawBytes, messageCount: checkpoint.messageCount, messageChain: checkpoint.messageChain, fileOffset: offset };
  return { seed: { offset, index: checkpoint.recordCount, evidence: EvidenceSet.resume(file.path, checkpoint.evidence), state: new TranscriptState(file.root.format, file.path, checkpoint.transcript),
    rawHash, rawBytes, messageCount: checkpoint.messageCount, chain: new MessageChain(checkpoint.messageChain), redacted: checkpoint.redacted, excluded: checkpoint.excluded,
    exclusionOpen: checkpoint.exclusionOpen, fileHash, duplicates, prefix } };
}
/** The per-line code of pass 1 over [seed.offset, size). */
function pass(input: PreflightInput, source: OpenSource, seed: Seed, report: PassReport): Preflight {
  const { file, policy } = input; const format = file.root.format;
  const { evidence, state, rawHash, chain, fileHash, duplicates } = seed;
  let { rawBytes, messageCount, redacted, excluded, exclusionOpen, prefix } = seed;
  // An empty file has no final newline either.
  let partial = source.size === 0n;
  let invalidUtf8 = false; let lineError: string | null = null; let messageError: string | null = null;
  const snapshot = (recordCount: number, fileOffset: bigint): TranscriptPrefix => ({ recordCount, digest: rawHash.digest(), rawBytes, messageCount, messageChain: chain.hex, fileOffset });
  const snapshotAt = report.kind === 'full' && input.prefixRecords !== null && input.prefixRecords > 0 ? input.prefixRecords : null;
  for (const line of readLines(source.descriptor, seed.offset, source.size, seed.index, input.recordCap)) {
    fileHash.update(line.bytes); if (line.terminated) fileHash.update(NEWLINE);
    const strict = decodeLine(line);
    const bom = line.index === 0 && startsWithBom(line.bytes);
    const same = strict !== null && !bom;
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
      if (line.index === snapshotAt) prefix = snapshot(line.index, line.offset);
      const parsed = recordOf(format, same ? (value === undefined ? parseJson(strict) : value) : parseJson(strict), strict, line.index, policy);
      // An unredacted record is the line itself (without the byte-order mark of the file).
      const raw = parsed.redacted ? Buffer.from(parsed.raw) : bom ? line.bytes.subarray(3) : line.bytes;
      // The server measures the redacted record; it must stay within the cap too.
      if (raw.length > input.recordCap) throw new RecordOverLimitError(line.index, BigInt(raw.length), input.recordCap);
      rawHash.update(raw); rawHash.update(NEWLINE); rawBytes += BigInt(raw.length) + 1n; redacted ||= parsed.redacted;
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
  const fileDigest = fileHash.digest('hex');
  const result = { size: source.size, stat: source.stat, fileDigest, evidence: evidence.evidence, excluded, partial, pass: report };
  let error = invalidUtf8 ? 'invalid-utf8' : lineError;
  let identity: TranscriptIdentity | null = null;
  if (error === null && !partial) {
    try { identity = state.identity(); } catch (failure) { error = failure instanceof CollectorError ? failure.code : 'parse-failed'; }
    error ??= messageError;
  }
  if (error !== null || partial || identity === null) return { ...result, error, transcript: null, end: null };
  if (snapshotAt !== null && snapshotAt === state.recordCount) prefix = snapshot(state.recordCount, source.size);
  const digest = rawHash.digest();
  const end: PassEnd | null = duplicates?.overflowed === true ? null : {
    state: { dev: source.stat.dev, ino: source.stat.ino, fileOffset: String(source.size), filePrefixSha256: fileDigest, recordCount: state.recordCount, rawBytes: String(rawBytes),
      rawState: rawHash.state(), messageCount, messageChain: chain.hex, redacted, transcript: state.snapshot, excluded, exclusionOpen, evidence: evidence.stored },
    codex: duplicates === null ? null : report.kind === 'full' ? { reset: true, rows: duplicates.rows().filter(([, credits, kept]) => credits > 0 || kept > 0) } : { reset: false, rows: duplicates.rows() },
    codexSeed: duplicates === null || report.kind === 'full' ? null : Object.fromEntries(duplicates.seed) };
  return { ...result, error, end, transcript: { ...identity, ...state.metadata(), redacted, digest, rawBytes, recordCount: state.recordCount, messageCount, messageChain: chain.hex, prefix } };
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
  /** Codex: the prefix's duplicate credits of an append planned from a checkpoint (pass 2 starts at the base, as for
   * the other formats); null reads a Codex file from its start. */
  codexSeed: Record<string, number> | null;
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
 * from its start unless its append carries the prefix's duplicate credits, because the messages of the delta depend on
 * the duplicates before it. */
export function* generateParts(input: PartsInput): Generator<GeneratedPart, PartsSummary> {
  const { file, policy } = input; const format: Format = file.root.format;
  let source: OpenSource | null = null;
  try {
    source = openSource(file);
    if (!sameStat(source.stat, input.stat)) throw new CollectorError('source-changed');
    const seed = input.codexSeed;
    const [offset, first] = format !== 'codex' || seed !== null ? [input.startOffset, input.startRecord] : [0n, 0];
    const duplicates = format === 'codex' ? codexDuplicates(source, policy, input.recordCap, input.maxMessages, offset, first,
      seed === null ? undefined : key => Object.hasOwn(seed, key) ? { credits: seed[key]!, kept: 0 } : undefined) : null;
    const packer = new PartPacker(input.partBudget, input.maxLargePartBytes);
    const chain = new MessageChain(input.baseChain); let rawBytes = 0n; let messages = 0;
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
