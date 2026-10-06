/**
 * ponygirls-subagents — durable root store.
 *
 * One private directory per root session, outside all child tool views.
 * The supervisor is the sole journal writer; each worker is the sole writer
 * of its native session file.
 *
 * Durability contract:
 * - Append-only journal with checksummed length-framed records.
 * - A synchronized manifest carries the committed {seq, byteOffset} boundary.
 * - Records are acknowledged only after data-sync + atomic manifest
 *   replace + manifest-sync. Only bytes beyond the committed boundary may be
 *   treated as an uncommitted torn tail; corruption at or before it fails
 *   recovery (RECOVERY_CORRUPT).
 * - Exclusive root lock published atomically with an identity-verified
 *   owner (pid + boot id + start time); epochs fence protocol activity but
 *   never replace the lock.
 * - Command deduplication by requestId: repeated accepted spawns return one
 *   identity; conflicting reuse fails.
 * - Bounded checkpoint retention: latest committed + prior-during-replacement
 *   only; raw read/diff IPC payloads are never journaled (digests/previews).
 *
 * Dual-test contract: FileRunStore and InMemoryRunStore share RunStore.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { err } from "./errors.ts";
import { readBootId, readProcessIdentity } from "./process-identity.ts";

export const STORE_VERSION = 1;

export type JournalKind =
  | "root.init"
  | "agent.spawned"
  | "command.accepted"
  | "mailbox.accepted"
  | "mailbox.receipt"
  | "mailbox.answered"
  | "mailbox.question_expired"
  | "generation.started"
  | "generation.settled"
  | "task.terminal"
  | "task.queued"
  | "task.phase"
  | "tool.intent"
  | "tool.outcome"
  | "usage.reported"
  | "policy.changed"
  | "gate.registered"
  | "gate.round_admitted"
  | "gate.candidate"
  | "gate.evidence"
  | "gate.decision"
  | "gate.repair_command"
  | "gate.limits"
  | "gate.review_session"
  | "checkpoint.published"
  | "checkpoint.superseded"
  | "recovery.event"
  | "agent.closed"
  | "agent.interrupted";

export interface JournalRecord {
  seq: number;
  kind: JournalKind;
  at: string;
  body: Record<string, unknown>;
}

export interface Manifest {
  version: number;
  rootId: string;
  durableSeq: number;
  journalBytes: number;
}

export interface CheckpointRef {
  agentId: string;
  taskRunId: string;
  generation: number;
  /** Native leaf entry selected at capture (null when unmaterialized). */
  leafEntryId: string | null;
  /** Content hash of the checkpoint bytes. */
  sha256: string;
  bytes: number;
  createdAt: string;
  superseded: boolean;
}

export interface RunStore {
  readonly rootId: string;
  append(kind: JournalKind, body: Record<string, unknown>): JournalRecord;
  /** Records since (exclusive) a cursor, bounded. */
  readSince(cursor: number, limit: number): { records: JournalRecord[]; cursor: number };
  loadCommand(requestId: string): JournalRecord | null;
  recordCommand(requestId: string, record: JournalRecord): void;
  saveCheckpoint(ref: CheckpointRef, bytes: Uint8Array): void;
  loadCheckpoint(agentId: string): { ref: CheckpointRef; bytes: Uint8Array } | null;
  supersedeCheckpoint(agentId: string): void;
  /** Highest committed seq. */
  durableSeq(): number;
  close(): void;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function frame(record: JournalRecord): Buffer {
  const json = JSON.stringify(record);
  const body = Buffer.from(json, "utf8");
  const sum = createHash("sha256").update(body).digest("hex").slice(0, 16);
  return Buffer.from(`${body.length} ${sum} ${json}\n`, "utf8");
}

function parseFrame(line: string): { record: JournalRecord } | { torn: true } | { corrupt: string } {
  const first = line.indexOf(" ");
  const second = line.indexOf(" ", first + 1);
  if (first < 0 || second < 0) return { torn: true };
  const len = Number(line.slice(0, first));
  const sum = line.slice(first + 1, second);
  const json = line.slice(second + 1);
  if (!Number.isInteger(len) || len < 0 || len > 64 * 1024 * 1024) return { torn: true };
  if (Buffer.byteLength(json, "utf8") !== len) return { torn: true };
  const actual = createHash("sha256").update(Buffer.from(json, "utf8")).digest("hex").slice(0, 16);
  if (actual !== sum) return { corrupt: "checksum mismatch" };
  try {
    const record = JSON.parse(json) as JournalRecord;
    if (!Number.isInteger(record.seq) || typeof record.kind !== "string") return { corrupt: "bad record shape" };
    return { record };
  } catch {
    return { corrupt: "unparseable record" };
  }
}

export function fsyncDir(dir: string): void {
  const fd = openSync(dir, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function fsyncFile(path: string): void {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Write a file durably: temp file, fsync, atomic rename, directory fsync. */
function writeDurably(path: string, data: string | Uint8Array): void {
  const tmp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(tmp, data);
  fsyncFile(tmp);
  renameSync(tmp, path);
  fsyncDir(dirname(path));
}

interface LockOwner {
  pid: number;
  bootId: string;
  starttime: string | null;
  acquiredAt: string;
  /** Distinguishes lock incarnations, so a contender retires only the lock it saw. */
  nonce: string;
}

/**
 * Exclusive root ownership lock. The lock directory is published by an
 * atomic rename of a fully written staging directory, so a lock never exists
 * without its owner record. The owner is identified by pid + boot id +
 * process start time; a lock whose owner process no longer exists (crash,
 * reboot, pid reuse) is retired by an atomic rename that exactly one
 * contender wins, and only if it is still the incarnation that contender
 * observed. Epochs fence protocol activity; they never replace this lock.
 */
export class RootLock {
  private rootDir: string;
  private lockDir: string;
  private held = false;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.lockDir = join(rootDir, "root.lock");
  }

  acquire(): { ok: true } | { ok: false; error: ReturnType<typeof err> } {
    mkdirSync(this.rootDir, { recursive: true });
    for (let attempt = 0; attempt < 2; attempt++) {
      if (this.tryPublish()) {
        this.held = true;
        return { ok: true };
      }
      const owner = this.readOwner();
      if (owner === null || ownerAlive(owner)) {
        const who = owner ? `pid ${owner.pid} since ${owner.acquiredAt}` : "an owner still publishing its record";
        return { ok: false, error: err("CONFLICT", `root store locked by ${who}`) };
      }
      if (!this.retireIfOwner(owner)) break;
    }
    return { ok: false, error: err("CONFLICT", "root store lock contended; retry") };
  }

  release(): void {
    if (!this.held) return;
    this.held = false;
    // Rename first: a contender can never publish into a half-removed lock.
    const released = join(this.rootDir, `root.lock.released-${randomUUID()}`);
    try {
      renameSync(this.lockDir, released);
    } catch {
      return; // The root directory itself is gone: nothing left to release.
    }
    rmSync(released, { recursive: true, force: true });
  }

  /**
   * Retire the lock only if it is still the dead incarnation observed: the
   * rename is atomic, and a lock found to be a newer incarnation is put back.
   */
  private retireIfOwner(seen: LockOwner): boolean {
    const retired = join(this.rootDir, `root.lock.stale-${randomUUID()}`);
    try {
      renameSync(this.lockDir, retired);
    } catch {
      return true; // Another contender retired it; publishing decides.
    }
    let found: LockOwner | null = null;
    try {
      found = JSON.parse(readFileSync(join(retired, "owner.json"), "utf8")) as LockOwner;
    } catch {
      found = null;
    }
    if (found?.nonce === seen.nonce) {
      rmSync(retired, { recursive: true, force: true });
      return true;
    }
    try {
      renameSync(retired, this.lockDir);
    } catch {
      // A third contender published meanwhile; leave the moved lock for diagnosis.
    }
    return false;
  }

  private tryPublish(): boolean {
    const staging = join(this.rootDir, `root.lock.staging-${randomUUID()}`);
    mkdirSync(staging);
    const self = readProcessIdentity(process.pid);
    const owner: LockOwner = { pid: process.pid, bootId: readBootId(), starttime: self?.starttime ?? null, acquiredAt: new Date().toISOString(), nonce: randomUUID() };
    writeFileSync(join(staging, "owner.json"), JSON.stringify(owner));
    fsyncFile(join(staging, "owner.json"));
    fsyncDir(staging);
    try {
      renameSync(staging, this.lockDir);
    } catch {
      rmSync(staging, { recursive: true, force: true });
      return false;
    }
    fsyncDir(this.rootDir);
    return true;
  }

  private readOwner(): LockOwner | null {
    try {
      return JSON.parse(readFileSync(join(this.lockDir, "owner.json"), "utf8")) as LockOwner;
    } catch {
      return null;
    }
  }
}

function ownerAlive(owner: LockOwner): boolean {
  if (owner.bootId !== readBootId()) return false;
  const live = readProcessIdentity(owner.pid);
  if (!live) return false;
  return owner.starttime === null || owner.starttime === live.starttime;
}

const JOURNAL_FILE = "journal.log";
const MANIFEST_FILE = "MANIFEST.json";
const CHECKPOINT_PREFIX = "gen-";

export class FileRunStore implements RunStore {
  readonly rootId: string;
  private dir: string;
  private journalPath: string;
  private manifestPath: string;
  private checkpointDir: string;
  private seq = 0;
  /** Byte length of the committed journal prefix (the manifest boundary). */
  private committedBytes = 0;
  /** Committed records in seq order (seq n at index n - 1). */
  private records: JournalRecord[] = [];
  private commands = new Map<string, JournalRecord>();
  /** Set when a durability barrier failed; the store refuses further writes. */
  private failure: string | null = null;

  constructor(rootDir: string, rootId: string) {
    this.dir = rootDir;
    this.rootId = rootId;
    const created = !existsSync(rootDir);
    mkdirSync(rootDir, { recursive: true });
    if (created) fsyncDir(dirname(rootDir));
    this.journalPath = join(rootDir, JOURNAL_FILE);
    this.manifestPath = join(rootDir, MANIFEST_FILE);
    this.checkpointDir = join(rootDir, "checkpoints");
    if (!existsSync(this.checkpointDir)) {
      mkdirSync(this.checkpointDir, { recursive: true });
      fsyncDir(rootDir);
    }
    this.open();
  }

  append(kind: JournalKind, body: Record<string, unknown>): JournalRecord {
    if (this.failure !== null) throw err("STORE_FAILED", `journal unavailable after a failed durability barrier: ${this.failure}`);
    const record: JournalRecord = { seq: this.seq + 1, kind, at: new Date().toISOString(), body };
    const framed = frame(record);
    try {
      const fd = openSync(this.journalPath, "a");
      try {
        const written = writeSync(fd, framed);
        if (written !== framed.length) throw new Error(`short journal write (${written}/${framed.length} bytes)`);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      this.writeManifest(record.seq, this.committedBytes + framed.length);
    } catch (e) {
      // Bytes past the committed boundary are an uncommitted tail; the next
      // open truncates them. This process must not append behind them.
      this.failure = (e as Error).message;
      throw err("STORE_FAILED", `journal append failed: ${this.failure}`);
    }
    this.seq = record.seq;
    this.committedBytes += framed.length;
    this.index(record);
    return record;
  }

  readSince(cursor: number, limit: number): { records: JournalRecord[]; cursor: number } {
    const start = Math.max(0, Math.min(cursor, this.records.length));
    const out = this.records.slice(start, start + Math.max(0, limit));
    return { records: out, cursor: out.length > 0 ? out[out.length - 1]!.seq : cursor };
  }

  loadCommand(requestId: string): JournalRecord | null {
    return this.commands.get(requestId) ?? null;
  }

  recordCommand(requestId: string, record: JournalRecord): void {
    this.commands.set(requestId, record);
    this.append("command.accepted", { requestId, seq: record.seq, kind: record.kind });
  }

  /**
   * Publish a checkpoint: synchronize the new copy, commit the journal
   * record that references it, then retire predecessors (superseded record
   * first, file removal after). At most two copies exist during replacement.
   */
  saveCheckpoint(ref: CheckpointRef, bytes: Uint8Array): void {
    const agentDir = join(this.checkpointDir, ref.agentId);
    if (!existsSync(agentDir)) {
      mkdirSync(agentDir, { recursive: true });
      fsyncDir(this.checkpointDir);
    }
    const file = `${CHECKPOINT_PREFIX}${ref.generation}-${randomUUID()}.bin`;
    writeDurably(join(agentDir, file), bytes);
    this.append("checkpoint.published", {
      agentId: ref.agentId,
      taskRunId: ref.taskRunId,
      generation: ref.generation,
      leafEntryId: ref.leafEntryId,
      sha256: ref.sha256,
      bytes: ref.bytes,
      createdAt: ref.createdAt,
      file,
    });
    this.retirePredecessors(ref.agentId, file);
  }

  /** The live checkpoint is the latest committed publication; it must validate. */
  loadCheckpoint(agentId: string): { ref: CheckpointRef; bytes: Uint8Array } | null {
    const published = this.latestPublished(agentId);
    if (!published) return null;
    const b = published.body as { taskRunId: string; generation: number; leafEntryId: string | null; sha256: string; bytes: number; createdAt: string; file: string };
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(this.checkpointDir, agentId, b.file));
    } catch (e) {
      throw err("RECOVERY_CORRUPT", `live checkpoint ${agentId}/${b.file} unreadable: ${(e as Error).message}`);
    }
    if (bytes.length !== b.bytes || sha256Hex(bytes) !== b.sha256) {
      throw err("RECOVERY_CORRUPT", `live checkpoint ${agentId}/${b.file} failed validation`);
    }
    return {
      ref: { agentId, taskRunId: b.taskRunId, generation: b.generation, leafEntryId: b.leafEntryId, sha256: b.sha256, bytes: b.bytes, createdAt: b.createdAt, superseded: false },
      bytes,
    };
  }

  supersedeCheckpoint(agentId: string): void {
    const published = this.latestPublished(agentId);
    if (!published) return;
    this.retirePredecessors(agentId, (published.body as { file: string }).file);
  }

  durableSeq(): number {
    return this.seq;
  }

  close(): void {}

  private latestPublished(agentId: string): JournalRecord | null {
    for (let i = this.records.length - 1; i >= 0; i--) {
      const r = this.records[i]!;
      if (r.kind === "checkpoint.published" && (r.body as { agentId?: string })["agentId"] === agentId) return r;
    }
    return null;
  }

  private retirePredecessors(agentId: string, liveFile: string): void {
    const agentDir = join(this.checkpointDir, agentId);
    let stale: string[];
    try {
      stale = readdirSync(agentDir).filter((f) => f.startsWith(CHECKPOINT_PREFIX) && f !== liveFile);
    } catch {
      return;
    }
    if (stale.length === 0) return;
    this.append("checkpoint.superseded", { agentId, files: stale });
    for (const f of stale) rmSync(join(agentDir, f), { force: true });
    fsyncDir(agentDir);
  }

  private index(record: JournalRecord): void {
    this.records.push(record);
    const requestId = (record.body as { requestId?: unknown })["requestId"];
    if (typeof requestId === "string" && !this.commands.has(requestId)) this.commands.set(requestId, record);
  }

  private writeManifest(durableSeq: number, journalBytes: number): void {
    const manifest: Manifest = { version: STORE_VERSION, rootId: this.rootId, durableSeq, journalBytes };
    writeDurably(this.manifestPath, JSON.stringify(manifest));
  }

  /**
   * Validate the committed prefix strictly and discard only bytes beyond the
   * manifest boundary (an uncommitted tail), with an explicit recovery event.
   */
  private open(): void {
    if (!existsSync(this.manifestPath)) {
      if (existsSync(this.journalPath) && statSync(this.journalPath).size > 0) {
        throw err("RECOVERY_CORRUPT", "journal present without a manifest");
      }
      writeDurably(this.journalPath, "");
      this.writeManifest(0, 0);
      return;
    }
    let manifest: Manifest;
    try {
      manifest = JSON.parse(readFileSync(this.manifestPath, "utf8")) as Manifest;
    } catch (e) {
      throw err("RECOVERY_CORRUPT", `manifest unreadable: ${(e as Error).message}`);
    }
    if (manifest.version !== STORE_VERSION || manifest.rootId !== this.rootId) {
      throw err("RECOVERY_CORRUPT", "manifest version/root mismatch");
    }
    if (!Number.isInteger(manifest.durableSeq) || !Number.isInteger(manifest.journalBytes) || manifest.durableSeq < 0 || manifest.journalBytes < 0) {
      throw err("RECOVERY_CORRUPT", "manifest boundary malformed");
    }
    let raw: Buffer;
    try {
      raw = readFileSync(this.journalPath);
    } catch (e) {
      throw err("RECOVERY_CORRUPT", `journal unreadable: ${(e as Error).message}`);
    }
    if (raw.length < manifest.journalBytes) {
      throw err("RECOVERY_CORRUPT", `journal (${raw.length} bytes) shorter than its committed boundary (${manifest.journalBytes} bytes)`);
    }
    const committed = raw.subarray(0, manifest.journalBytes).toString("utf8");
    if (committed.length > 0 && !committed.endsWith("\n")) {
      throw err("RECOVERY_CORRUPT", "committed journal does not end on a frame boundary");
    }
    const lines = committed.length > 0 ? committed.slice(0, -1).split("\n") : [];
    for (const line of lines) {
      const parsed = parseFrame(line);
      if (!("record" in parsed)) {
        throw err("RECOVERY_CORRUPT", `committed journal corruption: ${"corrupt" in parsed ? parsed.corrupt : "malformed frame"}`);
      }
      if (parsed.record.seq !== this.records.length + 1) {
        throw err("RECOVERY_CORRUPT", `committed journal seq ${parsed.record.seq} out of order`);
      }
      this.index(parsed.record);
    }
    if (this.records.length !== manifest.durableSeq) {
      throw err("RECOVERY_CORRUPT", `committed journal holds ${this.records.length} records; manifest says ${manifest.durableSeq}`);
    }
    this.seq = manifest.durableSeq;
    this.committedBytes = manifest.journalBytes;
    const tail = raw.length - manifest.journalBytes;
    if (tail > 0) {
      truncateSync(this.journalPath, manifest.journalBytes);
      fsyncFile(this.journalPath);
      this.append("recovery.event", { phase: "uncommitted_tail_discarded", bytes: tail });
    }
  }
}

/** Hand-written in-memory dummy sharing the RunStore contract. */
export class InMemoryRunStore implements RunStore {
  readonly rootId: string;
  private records: JournalRecord[] = [];
  private commands = new Map<string, JournalRecord>();
  private checkpoints = new Map<string, { ref: CheckpointRef; bytes: Uint8Array }[]>();
  private seq = 0;

  constructor(rootId: string) {
    this.rootId = rootId;
  }

  append(kind: JournalKind, body: Record<string, unknown>): JournalRecord {
    const record: JournalRecord = { seq: ++this.seq, kind, at: new Date().toISOString(), body };
    this.records.push(record);
    return record;
  }

  readSince(cursor: number, limit: number): { records: JournalRecord[]; cursor: number } {
    const out = this.records.filter((r) => r.seq > cursor).slice(0, Math.max(0, limit));
    return { records: out, cursor: out.length > 0 ? out[out.length - 1]!.seq : cursor };
  }

  loadCommand(requestId: string): JournalRecord | null {
    return this.commands.get(requestId) ?? null;
  }

  recordCommand(requestId: string, record: JournalRecord): void {
    this.commands.set(requestId, record);
  }

  saveCheckpoint(ref: CheckpointRef, bytes: Uint8Array): void {
    const list = this.checkpoints.get(ref.agentId) ?? [];
    list.push({ ref: { ...ref }, bytes: bytes.slice() });
    while (list.length > 2) list.shift();
    this.checkpoints.set(ref.agentId, list);
    this.append("checkpoint.published", {
      agentId: ref.agentId,
      taskRunId: ref.taskRunId,
      generation: ref.generation,
      sha256: ref.sha256,
      bytes: ref.bytes,
    });
  }

  loadCheckpoint(agentId: string): { ref: CheckpointRef; bytes: Uint8Array } | null {
    const list = this.checkpoints.get(agentId) ?? [];
    for (let i = list.length - 1; i >= 0; i--) {
      const entry = list[i]!;
      if (entry.ref.superseded) continue;
      if (sha256Hex(entry.bytes) !== entry.ref.sha256) {
        throw err("RECOVERY_CORRUPT", `checkpoint ${agentId} failed validation`);
      }
      return { ref: { ...entry.ref }, bytes: entry.bytes.slice() };
    }
    return null;
  }

  supersedeCheckpoint(agentId: string): void {
    const list = this.checkpoints.get(agentId) ?? [];
    while (list.length > 1) list.shift();
  }

  durableSeq(): number {
    return this.seq;
  }

  close(): void {}
}

export function checkpointSha256(bytes: Uint8Array): string {
  return sha256Hex(bytes);
}
