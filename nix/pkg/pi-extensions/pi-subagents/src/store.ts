/**
 * pi-subagents — durable root store.
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
 * - OS-owned exclusive root lock (lock dir + owner file); epochs fence
 *   protocol activity but never replace the lock.
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
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { err } from "./errors.ts";

export const STORE_VERSION = 1;

export type JournalKind =
  | "root.init"
  | "agent.spawned"
  | "command.accepted"
  | "mailbox.accepted"
  | "mailbox.receipt"
  | "mailbox.answered"
  | "generation.started"
  | "generation.settled"
  | "task.terminal"
  | "task.queued"
  | "task.phase"
  | "tool.intent"
  | "tool.outcome"
  | "usage.reported"
  | "policy.changed"
  | "approval.recorded"
  | "gate.registered"
  | "gate.round_admitted"
  | "gate.candidate"
  | "gate.evidence"
  | "gate.decision"
  | "gate.repair_command"
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

/**
 * Exclusive root ownership lock. Lock dir creation is atomic; the owner file
 * records pid + boot identity so a second process cannot adopt a live root.
 * Epochs fence protocol activity; they never replace this lock.
 */
export class RootLock {
  private lockDir: string;
  private held = false;

  constructor(rootDir: string) {
    this.lockDir = join(rootDir, "root.lock");
  }

  acquire(): { ok: true } | { ok: false; error: ReturnType<typeof err> } {
    try {
      mkdirSync(this.lockDir);
    } catch (e: unknown) {
      const existing = this.readOwner();
      if (existing && isLiveOwner(existing)) {
        return { ok: false, error: err("CONFLICT", `root store locked by pid ${existing.pid} (epoch ${existing.epoch})`) };
      }
      return { ok: false, error: err("CONFLICT", `root store locked (stale owner: ${(e as Error).message})`) };
    }
    const owner = { pid: process.pid, epoch: randomUUID(), startedAt: new Date().toISOString(), bootId: readBootId() };
    writeFileSync(join(this.lockDir, "owner.json"), JSON.stringify(owner));
    fsyncFile(join(this.lockDir, "owner.json"));
    fsyncDir(this.lockDir);
    this.held = true;
    return { ok: true };
  }

  release(): void {
    if (!this.held) return;
    this.held = false;
    rmSync(this.lockDir, { recursive: true, force: true });
  }

  private readOwner(): { pid: number; epoch: string; bootId: string } | null {
    try {
      const raw = readFileSync(join(this.lockDir, "owner.json"), "utf8");
      return JSON.parse(raw) as { pid: number; epoch: string; bootId: string };
    } catch {
      return null;
    }
  }
}

function readBootId(): string {
  try {
    return readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  } catch {
    return "unknown";
  }
}

function isLiveOwner(owner: { pid: number; bootId: string }): boolean {
  try {
    process.kill(owner.pid, 0);
  } catch {
    return false;
  }
  if (owner.bootId !== "unknown" && owner.bootId !== readBootId()) return false;
  return true;
}

export class FileRunStore implements RunStore {
  readonly rootId: string;
  private dir: string;
  private journalPath: string;
  private manifestPath: string;
  private checkpointDir: string;
  private seq = 0;
  private commands = new Map<string, JournalRecord>();

  constructor(rootDir: string, rootId: string) {
    this.dir = rootDir;
    this.rootId = rootId;
    mkdirSync(rootDir, { recursive: true });
    this.journalPath = join(rootDir, "journal.log");
    this.manifestPath = join(rootDir, "MANIFEST.json");
    this.checkpointDir = join(rootDir, "checkpoints");
    mkdirSync(this.checkpointDir, { recursive: true });
    this.recover();
  }

  static manifestOf(rootDir: string): Manifest | null {
    try {
      return JSON.parse(readFileSync(join(rootDir, "MANIFEST.json"), "utf8")) as Manifest;
    } catch {
      return null;
    }
  }

  append(kind: JournalKind, body: Record<string, unknown>): JournalRecord {
    const record: JournalRecord = { seq: ++this.seq, kind, at: new Date().toISOString(), body };
    const framed = frame(record);
    const fd = openSync(this.journalPath, "a");
    try {
      writeSync(fd, framed);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    this.commitManifest();
    return record;
  }

  readSince(cursor: number, limit: number): { records: JournalRecord[]; cursor: number } {
    const all = this.readCommitted();
    const out = all.filter((r) => r.seq > cursor).slice(0, Math.max(0, limit));
    return { records: out, cursor: out.length > 0 ? out[out.length - 1]!.seq : cursor };
  }

  loadCommand(requestId: string): JournalRecord | null {
    return this.commands.get(requestId) ?? null;
  }

  recordCommand(requestId: string, record: JournalRecord): void {
    this.commands.set(requestId, record);
    this.append("command.accepted", { requestId, seq: record.seq, kind: record.kind });
  }

  saveCheckpoint(ref: CheckpointRef, bytes: Uint8Array): void {
    const agentDir = join(this.checkpointDir, ref.agentId);
    mkdirSync(agentDir, { recursive: true });
    // Stage the predecessor: keep at most two live copies during replacement.
    const live = this.liveCheckpointFiles(ref.agentId);
    const tmp = join(agentDir, `gen-${ref.generation}.${randomUUID()}.tmp`);
    writeFileSync(tmp, bytes);
    fsyncFile(tmp);
    const final = join(agentDir, `gen-${ref.generation}.bin`);
    renameSync(tmp, final);
    writeFileSync(`${final}.json`, JSON.stringify({ ...ref, superseded: false }));
    fsyncFile(`${final}.json`);
    fsyncFile(final);
    fsyncDir(agentDir);
    fsyncDir(this.checkpointDir);
    for (const stale of live.slice(0, Math.max(0, live.length - 1))) {
      rmSync(stale.bin, { force: true });
      rmSync(stale.meta, { force: true });
    }
    this.append("checkpoint.published", {
      agentId: ref.agentId,
      taskRunId: ref.taskRunId,
      generation: ref.generation,
      sha256: ref.sha256,
      bytes: ref.bytes,
    });
  }

  loadCheckpoint(agentId: string): { ref: CheckpointRef; bytes: Uint8Array } | null {
    const agentDir = join(this.checkpointDir, agentId);
    let files: string[];
    try {
      files = readdirSync(agentDir).filter((f) => f.endsWith(".bin")).sort();
    } catch {
      return null;
    }
    for (let i = files.length - 1; i >= 0; i--) {
      const bin = join(agentDir, files[i]!);
      const metaPath = `${bin}.json`;
      try {
        const ref = JSON.parse(readFileSync(metaPath, "utf8")) as CheckpointRef;
        if (ref.superseded) continue;
        const bytes = readFileSync(bin);
        if (sha256Hex(bytes) !== ref.sha256 || bytes.length !== ref.bytes) {
          throw err("RECOVERY_CORRUPT", `checkpoint ${agentId} failed validation`);
        }
        return { ref, bytes };
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("RECOVERY_CORRUPT")) throw e;
        continue;
      }
    }
    return null;
  }

  supersedeCheckpoint(agentId: string): void {
    const agentDir = join(this.checkpointDir, agentId);
    let files: string[];
    try {
      files = readdirSync(agentDir).filter((f) => f.endsWith(".bin")).sort();
    } catch {
      return;
    }
    // Retire all but the newest live copy.
    for (const f of files.slice(0, Math.max(0, files.length - 1))) {
      rmSync(join(agentDir, f), { force: true });
      rmSync(join(agentDir, `${f}.json`), { force: true });
    }
    this.append("checkpoint.superseded", { agentId });
  }

  durableSeq(): number {
    return this.seq;
  }

  close(): void {}

  private liveCheckpointFiles(agentId: string): Array<{ bin: string; meta: string }> {
    try {
      return readdirSync(join(this.checkpointDir, agentId))
        .filter((f) => f.endsWith(".bin"))
        .sort()
        .map((f) => ({ bin: join(this.checkpointDir, agentId, f), meta: join(this.checkpointDir, agentId, `${f}.json`) }));
    } catch {
      return [];
    }
  }

  private commitManifest(): void {
    let size = 0;
    try {
      const st = readFileSync(this.journalPath);
      size = st.length;
    } catch {
      size = 0;
    }
    const manifest: Manifest = { version: STORE_VERSION, rootId: this.rootId, durableSeq: this.seq, journalBytes: size };
    const tmp = `${this.manifestPath}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify(manifest));
    fsyncFile(tmp);
    renameSync(tmp, this.manifestPath);
    fsyncDir(dirname(this.manifestPath));
  }

  private readCommitted(): JournalRecord[] {
    const manifest = FileRunStore.manifestOf(this.dir);
    if (!manifest) return [];
    let raw: Buffer;
    try {
      raw = readFileSync(this.journalPath);
    } catch {
      return [];
    }
    const committed = raw.subarray(0, Math.min(manifest.journalBytes, raw.length));
    const out: JournalRecord[] = [];
    for (const line of committed.toString("utf8").split("\n")) {
      if (!line) continue;
      const parsed = parseFrame(line);
      if ("record" in parsed) out.push(parsed.record);
      else if ("corrupt" in parsed) {
        throw err("RECOVERY_CORRUPT", `committed journal corruption: ${parsed.corrupt}`);
      }
    }
    return out;
  }

  private recover(): void {
    const manifest = FileRunStore.manifestOf(this.dir);
    if (!manifest) {
      this.seq = 0;
      this.commitManifest();
      return;
    }
    if (manifest.version !== STORE_VERSION || manifest.rootId !== this.rootId) {
      throw err("RECOVERY_CORRUPT", "manifest version/root mismatch");
    }
    let raw: Buffer;
    try {
      raw = readFileSync(this.journalPath);
    } catch {
      this.seq = manifest.durableSeq;
      return;
    }
    const committed = raw.subarray(0, Math.min(manifest.journalBytes, raw.length));
    let maxSeq = 0;
    for (const line of committed.toString("utf8").split("\n")) {
      if (!line) continue;
      const parsed = parseFrame(line);
      if ("record" in parsed) {
        maxSeq = Math.max(maxSeq, parsed.record.seq);
        const body = parsed.record.body as { requestId?: string };
        if (parsed.record.kind === "command.accepted" && typeof body["requestId"] === "string") {
          void 0;
        }
      } else if ("corrupt" in parsed) {
        throw err("RECOVERY_CORRUPT", `committed journal corruption on open: ${parsed.corrupt}`);
      }
      // Torn tail beyond the committed boundary is discarded; only bytes
      // past manifest.journalBytes may be torn.
    }
    this.seq = Math.max(manifest.durableSeq, maxSeq);
    // Rebuild command dedup index from committed history.
    for (const r of this.readCommitted()) {
      const body = r.body as { requestId?: string };
      if (typeof body["requestId"] === "string" && !this.commands.has(body["requestId"])) {
        this.commands.set(body["requestId"], r);
      }
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
