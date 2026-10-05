/**
 * Session-sidecar GoalStore: contract, validation, atomic file adapter,
 * and hand-written in-memory dummy sharing the same contract.
 * Runtime imports are node builtins only (no Pi imports).
 */
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  fsyncSync,
} from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { GOAL_STATUSES, validateGoalRecord, type DispatchId, type GoalId, type GoalRecord, type GoalStatus, type SessionId } from "./goal.ts";

export const SIDECAR_VERSION = 1;
export const SIDECAR_SUFFIX = ".codex-goals.json";

export interface DispatchRecord {
  dispatchId: DispatchId;
  sessionId: SessionId;
  goalId: GoalId;
  revision: number;
  phase: "admitted" | "running";
  admittedAt: string;
}

export interface SidecarEnvelope {
  version: number;
  sessionId: SessionId;
  revision: number;
  goal: GoalRecord | null;
  dispatch: DispatchRecord | null;
  cleared: boolean;
  clearedAt: string | null;
  chargedEntryIds: string[];
  baselineEntryCount: number | null;
  remainderMs: number;
}

export type StoreErrorCode =
  | "no_session_file"
  | "malformed"
  | "session_mismatch"
  | "revision_conflict"
  | "locked"
  | "storage_failure"
  | "indeterminate";

export interface StoreError {
  code: StoreErrorCode;
  message: string;
  observed?: SidecarEnvelope | null;
}

export type StoreResult<T> = { ok: true; value: T } | { ok: false; error: StoreError };

export function sidecarPathFor(sessionFile: string): string {
  return `${sessionFile}${SIDECAR_SUFFIX}`;
}

export function emptyEnvelope(sessionId: SessionId): SidecarEnvelope {
  return {
    version: SIDECAR_VERSION,
    sessionId,
    revision: 0,
    goal: null,
    dispatch: null,
    cleared: false,
    clearedAt: null,
    chargedEntryIds: [],
    baselineEntryCount: null,
    remainderMs: 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateEnvelope(raw: unknown, expectedSessionId: SessionId): StoreResult<SidecarEnvelope> {
  if (!isRecord(raw)) {
    return { ok: false, error: { code: "malformed", message: "Sidecar must be a JSON object." } };
  }
  if (raw.version !== SIDECAR_VERSION) {
    return { ok: false, error: { code: "malformed", message: `Unsupported sidecar version: ${String(raw.version)}.` } };
  }
  if (raw.sessionId !== expectedSessionId) {
    return {
      ok: false,
      error: { code: "session_mismatch", message: `Sidecar session ${String(raw.sessionId)} does not match ${expectedSessionId}.` },
    };
  }
  if (typeof raw.revision !== "number" || !Number.isSafeInteger(raw.revision) || raw.revision < 0) {
    return { ok: false, error: { code: "malformed", message: "revision must be a nonnegative safe integer." } };
  }
  let goal: GoalRecord | null = null;
  if (raw.goal !== null) {
    const parsed = validateGoalRecord(raw.goal);
    if (!parsed.ok) {
      return { ok: false, error: { code: "malformed", message: `Invalid goal: ${parsed.error.message}` } };
    }
    goal = parsed.value;
  }
  let dispatch: DispatchRecord | null = null;
  if (raw.dispatch !== null && raw.dispatch !== undefined) {
    if (!isRecord(raw.dispatch)) {
      return { ok: false, error: { code: "malformed", message: "dispatch must be an object or null." } };
    }
    const d = raw.dispatch;
    if (
      typeof d.dispatchId !== "string" || !d.dispatchId ||
      typeof d.sessionId !== "string" || !d.sessionId ||
      typeof d.goalId !== "string" || !d.goalId ||
      typeof d.revision !== "number" || !Number.isSafeInteger(d.revision) ||
      (d.phase !== "admitted" && d.phase !== "running") ||
      typeof d.admittedAt !== "string" || Number.isNaN(Date.parse(d.admittedAt))
    ) {
      return { ok: false, error: { code: "malformed", message: "Invalid dispatch record." } };
    }
    if (d.sessionId !== expectedSessionId) {
      return { ok: false, error: { code: "session_mismatch", message: "Dispatch session does not match envelope." } };
    }
    if (goal && d.goalId !== goal.id) {
      return { ok: false, error: { code: "malformed", message: "Dispatch goal does not match envelope goal." } };
    }
    dispatch = {
      dispatchId: d.dispatchId as DispatchId,
      sessionId: d.sessionId as SessionId,
      goalId: d.goalId as GoalId,
      revision: d.revision as number,
      phase: d.phase as "admitted" | "running",
      admittedAt: d.admittedAt as string,
    };
  }
  if (typeof raw.cleared !== "boolean") {
    return { ok: false, error: { code: "malformed", message: "cleared must be a boolean." } };
  }
  if (raw.clearedAt !== null && (typeof raw.clearedAt !== "string" || Number.isNaN(Date.parse(raw.clearedAt)))) {
    return { ok: false, error: { code: "malformed", message: "clearedAt must be null or a timestamp." } };
  }
  if (!Array.isArray(raw.chargedEntryIds) || !raw.chargedEntryIds.every((e) => typeof e === "string")) {
    return { ok: false, error: { code: "malformed", message: "chargedEntryIds must be string[]." } };
  }
  if (raw.baselineEntryCount !== null && (typeof raw.baselineEntryCount !== "number" || !Number.isSafeInteger(raw.baselineEntryCount) || raw.baselineEntryCount < 0)) {
    return { ok: false, error: { code: "malformed", message: "baselineEntryCount must be null or a nonnegative integer." } };
  }
  if (typeof raw.remainderMs !== "number" || !Number.isFinite(raw.remainderMs) || raw.remainderMs < 0) {
    return { ok: false, error: { code: "malformed", message: "remainderMs must be a nonnegative number." } };
  }
  // Cross-check goal fields once more (status enum).
  if (goal && !GOAL_STATUSES.includes(goal.status as GoalStatus)) {
    return { ok: false, error: { code: "malformed", message: "Unknown goal status." } };
  }
  return {
    ok: true,
    value: {
      version: SIDECAR_VERSION,
      sessionId: expectedSessionId,
      revision: raw.revision as number,
      goal,
      dispatch,
      cleared: raw.cleared as boolean,
      clearedAt: raw.clearedAt as string | null,
      chargedEntryIds: raw.chargedEntryIds as string[],
      baselineEntryCount: raw.baselineEntryCount as number | null,
      remainderMs: raw.remainderMs as number,
    },
  };
}

export interface GoalStore {
  readonly sessionId: SessionId;
  readonly sidecarPath: string | null;
  load(): StoreResult<SidecarEnvelope>;
  /**
   * Revision-checked commit. `expectedRevision` must match the loaded
   * revision; on mismatch the mutation is rejected without writing.
   */
  commit(
    expectedRevision: number,
    mutate: (current: SidecarEnvelope) => SidecarEnvelope,
  ): StoreResult<SidecarEnvelope>;
  acquireLock(): StoreResult<void>;
  releaseLock(): void;
  readonly lockHeld: boolean;
}

function lockPathFor(sidecarPath: string): string {
  return `${sidecarPath}.lock`;
}

interface LockFile {
  pid: number;
  host: string;
  acquiredAt: string;
}

function readLockFile(path: string): LockFile | null {
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<LockFile>;
    if (typeof parsed.pid !== "number" || typeof parsed.host !== "string") return null;
    return parsed as LockFile;
  } catch {
    return null;
  }
}

function pidAlive(pid: number): boolean | null {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "ESRCH") return false;
    return null; // EPERM etc: ambiguous
  }
}

function fsyncDir(dir: string): void {
  // Best-effort directory flush; throws on failure so callers can mark indeterminate.
  const fd = openSync(dir, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function atomicWriteJson(path: string, value: unknown): { indeterminate: boolean } {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.tmp-${process.pid}-${randomUUID()}.json`);
  try {
    writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
    const fd = openSync(tmp, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      chmodSync(tmp, 0o600);
    } catch {
      // chmod failure must not mask the write itself.
    }
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // Only our own temp file; ignore cleanup failure.
    }
    throw err;
  }
  // Directory flush after rename: failure here is indeterminate durability.
  try {
    fsyncDir(dir);
    return { indeterminate: false };
  } catch {
    return { indeterminate: true };
  }
}

/** Production file adapter with atomic commits and a narrow writer lock. */
export class FileGoalStore implements GoalStore {
  readonly sessionId: SessionId;
  readonly sidecarPath: string;
  held = false;

  constructor(sessionId: SessionId, sessionFile: string | undefined) {
    if (!sessionFile) {
      throw new Error("A saved Pi session is required: in-memory/ephemeral sessions cannot host a goal.");
    }
    this.sessionId = sessionId;
    this.sidecarPath = sidecarPathFor(sessionFile);
  }

  get lockHeld(): boolean {
    return this.held;
  }

  load(): StoreResult<SidecarEnvelope> {
    let raw: string;
    try {
      raw = readFileSync(this.sidecarPath, "utf-8");
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === "ENOENT") return { ok: true, value: emptyEnvelope(this.sessionId) };
      return { ok: false, error: { code: "storage_failure", message: `Cannot read sidecar: ${(err as Error).message}` } };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: { code: "malformed", message: "Sidecar contains malformed JSON." } };
    }
    return validateEnvelope(parsed, this.sessionId);
  }

  commit(
    expectedRevision: number,
    mutate: (current: SidecarEnvelope) => SidecarEnvelope,
  ): StoreResult<SidecarEnvelope> {
    const loaded = this.load();
    if (!loaded.ok) return loaded;
    if (loaded.value.revision !== expectedRevision) {
      return {
        ok: false,
        error: {
          code: "revision_conflict",
          message: `Stale revision: expected ${expectedRevision}, found ${loaded.value.revision}.`,
          observed: loaded.value,
        },
      };
    }
    const next = mutate({ ...loaded.value });
    if (next.sessionId !== this.sessionId) {
      return { ok: false, error: { code: "session_mismatch", message: "Mutation changed session identity." } };
    }
    next.revision = expectedRevision + 1;
    next.version = SIDECAR_VERSION;
    const validated = validateEnvelope(JSON.parse(JSON.stringify(next)) as unknown, this.sessionId);
    if (!validated.ok) return { ok: false, error: validated.error };
    try {
      const { indeterminate } = atomicWriteJson(this.sidecarPath, validated.value);
      if (indeterminate) {
        const observed = this.load();
        return {
          ok: false,
          error: {
            code: "indeterminate",
            message: "Directory flush failed after rename; durability is indeterminate. Admission disabled pending recovery.",
            observed: observed.ok ? observed.value : null,
          },
        };
      }
    } catch (err) {
      return { ok: false, error: { code: "storage_failure", message: `Cannot write sidecar: ${(err as Error).message}` } };
    }
    return { ok: true, value: validated.value };
  }

  acquireLock(): StoreResult<void> {
    const path = lockPathFor(this.sidecarPath);
    const existing = readLockFile(path);
    if (existing) {
      if (existing.pid === process.pid && existing.host === hostname()) {
        this.held = true;
        return { ok: true, value: undefined };
      }
      const alive = pidAlive(existing.pid);
      const sameHost = existing.host === hostname();
      if (alive === false && sameHost) {
        // Positively established absent owner on this host: recover stale lock.
        try {
          unlinkSync(path);
        } catch {
          return { ok: false, error: { code: "storage_failure", message: "Cannot recover stale lock." } };
        }
      } else {
        return {
          ok: false,
          error: {
            code: "locked",
            message: `Another writer holds the goal lock (pid ${existing.pid} on ${existing.host}). No last-writer-wins overwrite.`,
          },
        };
      }
    }
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(
        path,
        JSON.stringify({ pid: process.pid, host: hostname(), acquiredAt: new Date().toISOString() } satisfies LockFile, null, 2),
        { flag: "wx", mode: 0o600 },
      );
      this.held = true;
      return { ok: true, value: undefined };
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === "EEXIST") {
        return { ok: false, error: { code: "locked", message: "Another writer holds the goal lock." } };
      }
      return { ok: false, error: { code: "storage_failure", message: `Cannot acquire lock: ${(err as Error).message}` } };
    }
  }

  releaseLock(): void {
    if (!this.held) return;
    this.held = false;
    const path = lockPathFor(this.sidecarPath);
    const existing = readLockFile(path);
    // Never remove another process's lock or unrelated files.
    if (existing && existing.pid === process.pid && existing.host === hostname()) {
      try {
        unlinkSync(path);
      } catch {
        // Idempotent shutdown: ignore.
      }
    }
  }
}

/**
 * Hand-written in-memory dummy sharing the GoalStore contract.
 * `backing` may be shared between two instances to emulate a second writer.
 */
export class InMemoryGoalStore implements GoalStore {
  readonly sessionId: SessionId;
  readonly sidecarPath: string | null = null;
  backing: Map<string, string>;
  held = false;
  lockOwner: string | null = null;
  readonly instanceId: string;
  /** When true, the next commit reports indeterminate durability (crash-window test). */
  failDirFlushOnce = false;
  /** When true, the next commit throws a storage failure. */
  failWriteOnce = false;

  constructor(sessionId: SessionId, backing?: Map<string, string>) {
    this.sessionId = sessionId;
    this.backing = backing ?? new Map();
    this.instanceId = randomUUID();
  }

  get lockHeld(): boolean {
    return this.held;
  }

  key(): string {
    return `sidecar:${this.sessionId}`;
  }

  load(): StoreResult<SidecarEnvelope> {
    const raw = this.backing.get(this.key());
    if (raw === undefined) return { ok: true, value: emptyEnvelope(this.sessionId) };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: { code: "malformed", message: "Sidecar contains malformed JSON." } };
    }
    return validateEnvelope(parsed, this.sessionId);
  }

  commit(
    expectedRevision: number,
    mutate: (current: SidecarEnvelope) => SidecarEnvelope,
  ): StoreResult<SidecarEnvelope> {
    if (this.failWriteOnce) {
      this.failWriteOnce = false;
      return { ok: false, error: { code: "storage_failure", message: "Injected write failure." } };
    }
    const loaded = this.load();
    if (!loaded.ok) return loaded;
    if (loaded.value.revision !== expectedRevision) {
      return {
        ok: false,
        error: {
          code: "revision_conflict",
          message: `Stale revision: expected ${expectedRevision}, found ${loaded.value.revision}.`,
          observed: loaded.value,
        },
      };
    }
    const next = mutate({ ...loaded.value });
    next.revision = expectedRevision + 1;
    next.version = SIDECAR_VERSION;
    const validated = validateEnvelope(JSON.parse(JSON.stringify(next)) as unknown, this.sessionId);
    if (!validated.ok) return validated;
    if (this.failDirFlushOnce) {
      this.failDirFlushOnce = false;
      // Written but durability indeterminate: still install, then report.
      this.backing.set(this.key(), JSON.stringify(validated.value));
      return {
        ok: false,
        error: {
          code: "indeterminate",
          message: "Injected indeterminate durability.",
          observed: validated.value,
        },
      };
    }
    this.backing.set(this.key(), JSON.stringify(validated.value));
    return { ok: true, value: validated.value };
  }

  acquireLock(): StoreResult<void> {
    const key = `lock:${this.sessionId}`;
    const existing = this.backing.get(key);
    if (existing && existing !== this.instanceId) {
      return { ok: false, error: { code: "locked", message: "Another writer holds the goal lock." } };
    }
    this.backing.set(key, this.instanceId);
    this.lockOwner = this.instanceId;
    this.held = true;
    void existsSync; // keep fs import referenced for parity builds
    return { ok: true, value: undefined };
  }

  releaseLock(): void {
    if (!this.held) return;
    this.held = false;
    const key = `lock:${this.sessionId}`;
    if (this.backing.get(key) === this.instanceId) {
      this.backing.delete(key);
    }
    this.lockOwner = null;
  }

  /** Test helper: corrupt the backing JSON. */
  corrupt(raw: string): void {
    this.backing.set(this.key(), raw);
  }
}

export function makeGoalId(): GoalId {
  return randomUUID() as GoalId;
}

export function makeDispatchId(): DispatchId {
  return randomUUID() as DispatchId;
}
