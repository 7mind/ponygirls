/**
 * ponygirls-subagents — atomic admission scheduler.
 *
 * One fair root admission queue with atomically acquired runnable leases.
 * Single-threaded JS makes each method body atomic; async handlers must
 * never finalize the same run independently (the supervisor serializes
 * controller transitions separately). Compaction, reload, and a new root
 * turn never reset cumulative counters.
 */

import type { ErrorCode } from "./errors.ts";

export interface SchedulerLimits {
  maxRunnable: number;
  maxResidentWorkers: number;
  maxAgentsCreated: number;
  maxDepth: number;
}

export const DEFAULT_LIMITS: SchedulerLimits = {
  maxRunnable: 4,
  maxResidentWorkers: 8,
  maxAgentsCreated: 32,
  maxDepth: 1,
};

export interface LeaseTicket {
  leaseId: string;
  owner: string;
  runnable: boolean;
}

interface Waiter {
  owner: string;
  runnable: boolean;
  resolve: (ticket: LeaseTicket | null) => void;
}

export class AdmissionScheduler {
  private limits: SchedulerLimits;
  private runnableHeld = 0;
  private residentHeld = 0;
  private agentsCreated = 0;
  private leases = new Map<string, LeaseTicket>();
  private queue: Waiter[] = [];
  private nextLease = 1;

  constructor(limits: Partial<SchedulerLimits> = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  getLimits(): SchedulerLimits {
    return { ...this.limits };
  }

  /** Acquire a runnable lease, or return null when saturated or others queue first (never blocks). */
  tryAcquireRunnable(owner: string): LeaseTicket | null {
    if (this.queue.length > 0 || this.runnableHeld >= this.limits.maxRunnable) return null;
    const ticket: LeaseTicket = { leaseId: `lease-${this.nextLease++}`, owner, runnable: true };
    this.leases.set(ticket.leaseId, ticket);
    this.runnableHeld++;
    return ticket;
  }

  /** Whether a runnable lease could be granted now (no queued waiter ahead). */
  hasRunnableCapacity(): boolean {
    return this.queue.length === 0 && this.runnableHeld < this.limits.maxRunnable;
  }

  /** Fair queued acquisition: resolves when a lease is available or cancelled. */
  acquireRunnableQueued(owner: string): { ticket: Promise<LeaseTicket | null>; cancel: () => void } {
    const immediate = this.tryAcquireRunnable(owner);
    if (immediate) return { ticket: Promise.resolve(immediate), cancel: () => {} };
    let waiter: Waiter | undefined;
    const ticket = new Promise<LeaseTicket | null>((resolve) => {
      waiter = { owner, runnable: true, resolve };
      this.queue.push(waiter);
    });
    return {
      ticket,
      cancel: () => {
        if (!waiter) return;
        const i = this.queue.indexOf(waiter);
        if (i >= 0) this.queue.splice(i, 1);
        waiter.resolve(null);
      },
    };
  }

  release(ticket: LeaseTicket): void {
    const held = this.leases.get(ticket.leaseId);
    if (!held) return;
    this.leases.delete(ticket.leaseId);
    if (held.runnable) this.runnableHeld = Math.max(0, this.runnableHeld - 1);
    else this.residentHeld = Math.max(0, this.residentHeld - 1);
    this.pumpQueue();
  }

  /** Track a resident (loaded but not runnable) worker. */
  tryAcquireResident(owner: string): LeaseTicket | null {
    if (this.residentHeld >= this.limits.maxResidentWorkers) return null;
    const ticket: LeaseTicket = { leaseId: `lease-${this.nextLease++}`, owner, runnable: false };
    this.leases.set(ticket.leaseId, ticket);
    this.residentHeld++;
    return ticket;
  }

  /** Charge created identities against the cumulative spawn budget (all or none). */
  chargeAgentCreation(count: number): { ok: true } | { ok: false; code: ErrorCode; message: string } {
    if (this.agentsCreated + count > this.limits.maxAgentsCreated) {
      return { ok: false, code: "CAPACITY_EXCEEDED", message: `maxAgentsCreated (${this.limits.maxAgentsCreated}) exhausted` };
    }
    this.agentsCreated += count;
    return { ok: true };
  }

  /** Undo a charge whose identities were never created (rollback before creation). */
  refundAgentCreation(count: number): void {
    this.agentsCreated = Math.max(0, this.agentsCreated - count);
  }

  get agentsCreatedCount(): number {
    return this.agentsCreated;
  }

  get runnableCount(): number {
    return this.runnableHeld;
  }

  get residentCount(): number {
    return this.residentHeld;
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  setLimits(next: Partial<SchedulerLimits>): void {
    this.limits = { ...this.limits, ...next };
  }

  snapshot(): { runnable: number; resident: number; queued: number; created: number; limits: SchedulerLimits } {
    return {
      runnable: this.runnableHeld,
      resident: this.residentHeld,
      queued: this.queue.length,
      created: this.agentsCreated,
      limits: this.getLimits(),
    };
  }

  restoreSnapshot(s: { created: number }): void {
    this.agentsCreated = s.created;
  }

  private pumpQueue(): void {
    while (this.queue.length > 0 && this.runnableHeld < this.limits.maxRunnable) {
      const waiter = this.queue.shift();
      if (!waiter) break;
      const ticket: LeaseTicket = { leaseId: `lease-${this.nextLease++}`, owner: waiter.owner, runnable: true };
      this.leases.set(ticket.leaseId, ticket);
      this.runnableHeld++;
      waiter.resolve(ticket);
    }
  }
}

/**
 * Canonical task paths: "/root/<name>", "/root/<name>/<child>".
 * Closed paths are never reused within a root (tombstone set).
 */
export class PathRegistry {
  private taken = new Set<string>(["/root"]);
  private tombstones = new Set<string>();

  static childPath(parentPath: string, taskName: string): string {
    const slug = taskName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "agent";
    return `${parentPath}/${slug}`;
  }

  reserve(path: string): { ok: true } | { ok: false; code: ErrorCode; message: string } {
    if (this.taken.has(path) || this.tombstones.has(path)) {
      return { ok: false, code: "CONFLICT", message: `task path ${path} already used` };
    }
    this.taken.add(path);
    return { ok: true };
  }

  /** Closing retires the path permanently. */
  retire(path: string): void {
    this.taken.delete(path);
    this.tombstones.add(path);
  }

  /**
   * Pre-creation rollback: release a reservation without tombstoning.
   * Only for failures before an identity existed; created agents keep
   * their paths taken (terminal records included) and close() retires.
   */
  release(path: string): void {
    this.taken.delete(path);
  }

  isTaken(path: string): boolean {
    return this.taken.has(path) || this.tombstones.has(path);
  }
}
