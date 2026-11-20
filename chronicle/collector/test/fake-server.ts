// An in-memory Chronicle server for the collector's part uploads (append-only ingest spec §4.2-§4.6), over HTTP so
// that the collector's real client runs. It keeps heads as running digests, never whole sessions.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { createHash, randomUUID, type Hash } from 'node:crypto';
import { MessageChain, messageDigest, partDigest } from '../src/chain.ts';
import { sourceKey } from '../src/ingest.ts';
import { UploadOpen, UploadOpen_JsonCodec } from '../../generated/typescript/chronicle/api/UploadOpen.js';
import { UploadPart_JsonCodec } from '../../generated/typescript/chronicle/api/UploadPart.js';
import { UploadState, UploadState_JsonCodec } from '../../generated/typescript/chronicle/api/UploadState.js';
import { UploadLimits, UploadLimits_JsonCodec } from '../../generated/typescript/chronicle/api/UploadLimits.js';
import { UploadPhase } from '../../generated/typescript/chronicle/api/UploadPhase.js';
import { IngestReceipt, IngestReceipt_JsonCodec } from '../../generated/typescript/chronicle/api/IngestReceipt.js';
import { IngestRequest_JsonCodec } from '../../generated/typescript/chronicle/api/IngestRequest.js';
import type { Message } from '../../generated/typescript/chronicle/api/Message.js';
import { BaboonCodecContext } from '../../generated/typescript/BaboonSharedRuntime.js';

const CODEC = BaboonCodecContext.Default;
/** SnapshotValidation.scalar (chronicle/server Core.scala): a high surrogate must be followed by a low surrogate, and a
 * low surrogate never stands alone; the server answers 400 `invalid` "unpaired Unicode surrogate" otherwise. */
export function scalar(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = index + 1 < value.length ? value.charCodeAt(index + 1) : 0;
      if (next < 0xdc00 || next > 0xdfff) return false;
      index++;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}
const scalarMessages = (messages: readonly Message[]): boolean => messages.every(m => [m.id, m.role, m.text, m.parentId, m.timestamp].every(value => value === undefined || scalar(value)));
const scalarMetadata = (m: UploadOpen['metadata']): boolean => [m.title, m.producer, m.project, m.workdir, m.gitRemote, m.gitBranch, m.gitCommit, m.model, m.startedAt, m.endedAt, ...m.tags].every(value => value === undefined || scalar(value));
const scalarSource = (s: UploadOpen['source']): boolean => [s.collectorNamespace, s.discoveryRootId, s.producerSessionId, s.subagentId].every(value => value === undefined || scalar(value));
const MiB = 1_048_576n;
export const productionLimits = (): UploadLimits => new UploadLimits(8n * MiB, 4n * 32n * MiB + MiB, 32n * MiB, 8n * 1024n * MiB, 2_000_000);
interface Head { revision: number; sessionId: string; digest: string; rawBytes: bigint; messageCount: number; chain: string; hash: Hash; rawPath: string }
interface Attempt {
  uploadId: string; open: UploadOpen; key: string; phase: UploadPhase; parts: string[]; rawBytes: bigint; messages: number;
  hash: Hash; chain: MessageChain; receipt?: IngestReceipt; failure?: string;
  /** A commit received but not yet applied: it wins against a later abort. */
  delayedCommit?: boolean;
}
/** A received part, for assertions: its attempt, ordinal, encoded size, records and whether it came as a large part. */
export interface ReceivedPart { uploadId: string; ordinal: number; bytes: number; records: number; large: boolean; announced: boolean }
export class FakeChronicle {
  supportsUploads = true;
  limits = productionLimits();
  /** The next commit is applied, but its response never arrives. */
  loseCommitAck = false;
  /** Attempts are unknown to status requests, as after their deletion. */
  forgetAttempts = false;
  /** The next part request with this ordinal answers 503 without being applied. */
  failPart: number | null = null;
  /** The next part request with this ordinal finds its attempt expired. */
  expirePart: number | null = null;
  /** The next open answers 503. */
  failOpen = false;
  /** The next commit with this flag is held back (its response lost) and applied when an abort arrives. */
  delayCommit = false;
  /** The next abort answers 503. */
  failAbort = false;
  /** The next commit finds its attempt expired. */
  expireCommit = false;
  /** Runs when a part or commit finds its attempt expired, before the answer leaves. */
  onExpire: (() => void) | null = null;
  /** The next part request with this ordinal answers 413 without a Failure body, as a proxy would. */
  rawTooLarge: number | null = null;
  /** The record cap of parts, when it differs from the announced limits. */
  partRecordCap: bigint | null = null;
  readonly heads = new Map<string, Head>();
  readonly attempts = new Map<string, Attempt>();
  readonly receivedParts: ReceivedPart[] = [];
  readonly requests: string[] = [];
  readonly ingested: string[] = [];
  /** Accepted message texts and titles, in order. */
  readonly texts: string[] = [];
  readonly titles: string[] = [];
  private readonly intents = new Map<string, { declaration: string; receipt?: IngestReceipt; live?: string }>();
  private server: Server | null = null;
  url = '';
  async start(): Promise<void> {
    this.server = createServer((request, response) => { void this.handle(request, response); });
    this.server.listen(0, '127.0.0.1'); await once(this.server, 'listening');
    const address = this.server.address(); if (address === null || typeof address !== 'object') throw new Error('no address');
    this.url = `http://127.0.0.1:${address.port}`;
  }
  async close(): Promise<void> {
    const server = this.server; if (server === null) return;
    server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error)));
  }
  expireAll(): void { for (const attempt of this.attempts.values()) if (attempt.phase === UploadPhase.Open) attempt.phase = UploadPhase.Expired; }
  /** The requests of an endpoint kind, e.g. `POST /api/ingest/uploads`. */
  count(kind: string): number { return this.requests.filter(request => request === kind).length; }
  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString('utf8');
    const path = (request.url ?? '').split('/').map(segment => /^[0-9a-f-]{36}$/.test(segment) ? '{id}' : segment).join('/');
    this.requests.push(`${request.method} ${path}`);
    const json = (status: number, value: unknown): void => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
    const failure = (status: number, code: string): void => json(status, { code, message: `synthetic ${code}` });
    const segments = (request.url ?? '').split('/').slice(1);
    if (request.method === 'POST' && request.url === '/api/ingest') return this.ingest(body, json, failure);
    if (segments[0] !== 'api' || segments[1] !== 'ingest' || segments[2] !== 'uploads') { response.writeHead(404); response.end('Not found'); return; }
    // A server before the part-upload API: no route matches, http4s answers 404 with a text body.
    if (!this.supportsUploads) { response.writeHead(404, { 'Content-Type': 'text/plain' }); response.end('Not found'); return; }
    const [id, action] = [segments[3], segments[4]];
    if (id === undefined) {
      if (request.method === 'GET') return json(200, UploadLimits_JsonCodec.instance.encode(CODEC, this.limits));
      return this.open(UploadOpen_JsonCodec.instance.decode(CODEC, JSON.parse(body) as unknown), json, failure);
    }
    const attempt = this.attempts.get(id);
    if (attempt === undefined || (this.forgetAttempts && request.method === 'GET')) return failure(404, 'not-found');
    if (request.method === 'GET') return json(200, this.state(attempt));
    if (action === 'abort') {
      if (this.failAbort) { this.failAbort = false; return failure(503, 'unavailable'); }
      if (attempt.delayedCommit === true) { attempt.delayedCommit = false; this.apply(attempt); }
      if (attempt.phase === UploadPhase.Open) attempt.phase = UploadPhase.Aborted;
      return json(200, this.state(attempt));
    }
    if (action === 'parts') return this.part(attempt, body, request.headers['content-length'] !== undefined, response, json, failure);
    if (action === 'commit') return this.commit(attempt, response, json, failure);
    failure(404, 'not-found');
  }
  private state(attempt: Attempt): unknown {
    return UploadState_JsonCodec.instance.encode(CODEC, new UploadState(attempt.uploadId, attempt.open.requestId, attempt.phase, attempt.open.base !== undefined, attempt.parts.length, attempt.rawBytes,
      attempt.messages, attempt.parts.at(-1), attempt.phase === UploadPhase.Open ? 3600 : 0, this.limits, attempt.receipt, attempt.failure));
  }
  private ingest(body: string, json: (status: number, value: unknown) => void, failure: (status: number, code: string) => void): void {
    const request = IngestRequest_JsonCodec.instance.decode(CODEC, JSON.parse(body) as unknown);
    this.ingested.push(request.requestId);
    if (!scalarSource(request.source) || !scalarMetadata(request.metadata) || !scalarMessages(request.messages) || !request.files.every(file => scalar(file.content) && scalar(file.path))) return failure(400, 'invalid');
    const key = sourceKey(request.source); const head = this.heads.get(key);
    if ((head?.revision ?? 0) !== request.expectedRevision) return failure(409, 'conflict');
    const chain = new MessageChain(); for (const message of request.messages) chain.extend(messageDigest(chainable(message)));
    const content = request.files[0]!.content;
    const next: Head = { revision: request.expectedRevision + 1, sessionId: head?.sessionId ?? randomUUID(), digest: request.digest, rawBytes: BigInt(Buffer.byteLength(content)), messageCount: request.messages.length, chain: chain.hex, hash: createHash('sha256').update(content), rawPath: request.files[0]!.path };
    this.heads.set(key, next); this.texts.push(...request.messages.map(message => message.text)); this.titles.push(request.metadata.title);
    json(200, IngestReceipt_JsonCodec.instance.encode(CODEC, new IngestReceipt(request.requestId, next.sessionId, next.revision, randomUUID())));
  }
  private open(open: UploadOpen, json: (status: number, value: unknown) => void, failure: (status: number, code: string) => void): void {
    if (this.failOpen) { this.failOpen = false; return failure(503, 'unavailable'); }
    if (!scalarSource(open.source) || !scalarMetadata(open.metadata) || !scalar(open.rawPath)) return failure(400, 'invalid');
    const declaration = JSON.stringify(UploadOpen_JsonCodec.instance.encode(CODEC, open));
    const intent = this.intents.get(open.requestId);
    if (intent !== undefined && intent.declaration !== declaration) return failure(409, 'conflict');
    if (intent?.receipt !== undefined) {
      const committed = [...this.attempts.values()].find(attempt => attempt.open.requestId === open.requestId && attempt.phase === UploadPhase.Committed)!;
      return json(200, this.state(committed));
    }
    const live = intent?.live === undefined ? undefined : this.attempts.get(intent.live);
    if (live?.phase === UploadPhase.Open) return json(200, this.state(live));
    const key = sourceKey(open.source); const head = this.heads.get(key);
    if ([...this.attempts.values()].some(attempt => attempt.key === key && attempt.phase === UploadPhase.Open)) return failure(409, 'upload-busy');
    if ((head?.revision ?? 0) !== open.expectedRevision) return failure(409, 'conflict');
    if (open.rawBytes > this.limits.maxRawBytes || open.messageCount > this.limits.maxMessages) return failure(413, 'too-large');
    const base = open.base;
    if (base !== undefined && (head === undefined || head.rawPath !== open.rawPath || head.digest !== base.digest || head.rawBytes !== base.rawBytes || head.messageCount !== base.messageCount || head.chain !== base.messageChain)) return failure(409, 'base-mismatch');
    const attempt: Attempt = { uploadId: randomUUID(), open, key, phase: UploadPhase.Open, parts: [], rawBytes: 0n, messages: 0,
      hash: base === undefined ? createHash('sha256') : head!.hash.copy(), chain: new MessageChain(base === undefined ? undefined : head!.chain) };
    this.attempts.set(attempt.uploadId, attempt); this.intents.set(open.requestId, { declaration, live: attempt.uploadId });
    json(200, this.state(attempt));
  }
  private part(attempt: Attempt, body: string, announced: boolean, response: ServerResponse, json: (status: number, value: unknown) => void, failure: (status: number, code: string) => void): void {
    const part = UploadPart_JsonCodec.instance.decode(CODEC, JSON.parse(body) as unknown);
    if (this.expirePart === part.ordinal) { this.expirePart = null; attempt.phase = UploadPhase.Expired; this.onExpire?.(); }
    if (attempt.phase === UploadPhase.Expired) return failure(409, 'upload-expired');
    if (this.rawTooLarge === part.ordinal) { this.rawTooLarge = null; response.writeHead(413, { 'Content-Type': 'text/html' }); response.end('<html>Request Entity Too Large</html>'); return; }
    if (attempt.phase !== UploadPhase.Open) return failure(409, 'conflict');
    if (this.failPart === part.ordinal) { this.failPart = null; return failure(503, 'unavailable'); }
    if (part.ordinal < attempt.parts.length) return attempt.parts[part.ordinal] === part.sha256 ? json(200, this.state(attempt)) : failure(409, 'conflict');
    if (part.ordinal > attempt.parts.length) return failure(409, 'conflict');
    const digests = part.messages.map(message => messageDigest(chainable(message)));
    if (partDigest([part.raw], digests) !== part.sha256 || !part.raw.endsWith('\n') || !scalar(part.raw) || !scalarMessages(part.messages)) return failure(400, 'invalid');
    const records = part.raw.slice(0, -1).split('\n');
    // The agreed record-cap refusal (U6): 413 with the Failure code record-too-large; other limits answer too-large.
    if (records.some(record => BigInt(Buffer.byteLength(record)) > (this.partRecordCap ?? this.limits.maxRecordBytes))) return failure(413, 'record-too-large');
    const bytes = Buffer.byteLength(body); const large = BigInt(bytes) > this.limits.maxPartBytes;
    if (large && (records.length !== 1 || !announced || BigInt(bytes) > this.limits.maxLargePartBytes)) return failure(413, 'too-large');
    attempt.hash.update(part.raw); for (const digest of digests) attempt.chain.extend(digest);
    this.texts.push(...part.messages.map(message => message.text));
    attempt.parts.push(part.sha256); attempt.rawBytes += BigInt(Buffer.byteLength(part.raw)); attempt.messages += part.messages.length;
    this.receivedParts.push({ uploadId: attempt.uploadId, ordinal: part.ordinal, bytes, records: records.length, large, announced });
    json(200, this.state(attempt));
  }
  private commit(attempt: Attempt, response: ServerResponse, json: (status: number, value: unknown) => void, failure: (status: number, code: string) => void): void {
    if (attempt.phase === UploadPhase.Committed) return json(200, IngestReceipt_JsonCodec.instance.encode(CODEC, attempt.receipt!));
    if (this.expireCommit && attempt.phase === UploadPhase.Open) { this.expireCommit = false; attempt.phase = UploadPhase.Expired; this.onExpire?.(); }
    if (attempt.phase === UploadPhase.Expired) return failure(409, 'upload-expired');
    if (attempt.phase !== UploadPhase.Open) return failure(409, 'conflict');
    const open = attempt.open; const head = this.heads.get(attempt.key);
    const digest = attempt.hash.copy().digest('hex');
    if (digest !== open.digest || (open.base?.rawBytes ?? 0n) + attempt.rawBytes !== open.rawBytes || (open.base?.messageCount ?? 0) + attempt.messages !== open.messageCount || attempt.chain.hex !== open.messageChain) {
      attempt.phase = UploadPhase.Failed; attempt.failure = 'content-mismatch'; return failure(409, 'content-mismatch');
    }
    if ((head?.revision ?? 0) !== open.expectedRevision) return failure(409, 'conflict');
    if (this.delayCommit) { this.delayCommit = false; attempt.delayedCommit = true; response.destroy(); return; }
    this.apply(attempt);
    if (this.loseCommitAck) { this.loseCommitAck = false; response.destroy(); return; }
    json(200, IngestReceipt_JsonCodec.instance.encode(CODEC, attempt.receipt!));
  }
  /** The commit itself: the attempt's content becomes the head (its checks passed). */
  private apply(attempt: Attempt): void {
    const open = attempt.open; const head = this.heads.get(attempt.key);
    const next: Head = { revision: open.expectedRevision + 1, sessionId: head?.sessionId ?? randomUUID(), digest: attempt.hash.copy().digest('hex'), rawBytes: open.rawBytes, messageCount: open.messageCount, chain: open.messageChain, hash: attempt.hash, rawPath: open.rawPath };
    this.heads.set(attempt.key, next); this.titles.push(open.metadata.title);
    attempt.receipt = new IngestReceipt(open.requestId, next.sessionId, next.revision, randomUUID()); attempt.phase = UploadPhase.Committed;
    this.intents.get(open.requestId)!.receipt = attempt.receipt;
  }
}
const chainable = (message: Message) => ({ id: message.id, parentId: message.parentId ?? null, role: message.role, text: message.text, timestamp: message.timestamp ?? null, recordIndex: message.recordIndex });
