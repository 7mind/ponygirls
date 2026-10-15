/**
 * ponygirls-subagents — governing-session external tool dispatcher.
 *
 * Dispatches approved concrete external tools (MCP etc) through the
 * governing session's tool runtime, after the originating spawn result has
 * finalized. Each call owns a fresh UUID + child-owned AbortSignal and an
 * independent supervisor journal record — never Pi orphan
 * `<spawnId>/n` nested IDs tied to a finalized `nestedCalls` summary.
 *
 * Validation/error normalization uses public `runToolCall` from
 * `@earendil-works/pi-agent-core` (argument preparation + schema validation,
 * isError normalization, duration, scoped updates). It does NOT provide
 * output boundary validation, events/messages, or automatic usage — those
 * are handled here with explicit bounds and independent accounting.
 *
 * Nested `ctx.executeTool('read'/'bash'/etc)` stays on the existing
 * child-workdir/isolation broker route, never raw parent builtin handles.
 * The scoped context's `tools` is the union of approved child-native broker
 * proxies plus approved external proxies, all broker-wrapped so direct
 * `.execute` cannot bypass child grants. Raw root subagent control closures
 * are never exposed (they authorize as governor).
 *
 * Every nested/direct invocation is re-authorized through a live supervisor
 * callback immediately before effects (current binding, worker identity,
 * active task/generation, current root/owner grants, live scope). Completed
 * scopes are revoked; cancellation combines child lifetime with explicit
 * nested signals; the scoped `signal` is child-owned, never governing.
 *
 * Cancellation never waits indefinitely: a cancelled call returns promptly
 * while staying tracked; its late settlement journals a single outcome
 * (`uncertain` with late evidence) or a guarded recovery event when the
 * outcome was already fenced. Validity guards prevent old callbacks writing
 * after root ownership transfers.
 *
 * Parent top-level `tool_call`/`tool_result` hooks are NOT replayed here;
 * this is independent subagent authorization (same model as the file/shell
 * broker). Documented as a limitation.
 */

import { randomUUID } from "node:crypto";
import { runToolCall } from "@earendil-works/pi-agent-core";
import { err } from "./errors.ts";
import {
  boundExternalResult,
  combineSignals,
  createScopedGoverningContext,
  isValidUsage,
  normalizeExternalError,
  snapshotGoverningHandles,
  wrapGoverningHandleForChild,
  type GoverningResultContent,
  type GoverningToolResult,
  type PinnedGoverningHandle,
} from "./governing-runtime.ts";
import type { AgentToolCall, AgentToolCallOutcome, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { JsonValue } from "@earendil-works/pi-ai";
import { authorizeExternalTool, isReservedToolName } from "./policy.ts";
import type { BrokerCaller } from "./broker.ts";
import type { RunStore } from "./store.ts";
import type { AgentId, OperationId } from "./types.ts";

export interface GoverningRegistry {
  /** False after reload/replacement/disposal (revoked binding). */
  isActive(): boolean;
  /** Current concrete callable handles (live, not cached authority). */
  listHandles(): PinnedGoverningHandle[];
  getHandle(name: string): PinnedGoverningHandle | undefined;
  /** Base context for prototype-preserving scoped contexts. */
  baseCtx(): object | null;
}

/** Live supervisor authorization/fencing immediately before effects. */
export type LiveAuthorize = (
  agentId: AgentId,
  tool: string,
  scope: { taskRunId: string | null; generation: number | null },
) => { ok: true } | { ok: false; code: string; message: string };

export interface DispatcherHooks {
  /** Live check (current binding/identity/grants/scope); defaults to allow. */
  authorizeLive?: LiveAuthorize;
  /** Root admission hold for genuinely NEW effects (billing debt/attach catch-up); defaults to healthy. */
  admissionHold?: () => { code: string; message: string } | null;
  /** False once the root is suspended/closed (old callbacks must not write). */
  isValid?: () => boolean;
  /**
   * Cross-route operation-ID reservation shared with the native broker
   * (supervisor wires one set into both): a native and an external
   * invocation claiming the SAME explicit ID deny as duplicates instead of
   * double-running. Defaults to a private set, preserving standalone
   * behavior.
   */
  sharedIds?: Set<OperationId>;
  /**
   * True while the root still owns the journal (not disposed/transferred).
   * Receipt ownership is separate from effect validity: own-usage receipts
   * (recovery events) are preserved whenever the journal is still owned,
   * even while suspended, so a suspended hook drop can never erase the only
   * numeric evidence. Effect admission (outcomes) stays gated on isValid.
   * Defaults to isValid when not provided.
   */
  ownsJournal?: () => boolean;
  /**
   * Per-invocation OWN usage (normal and late completions alike). The
   * supervisor accounts each exactly once under its originating identity
   * and journals `usage.reported`. Aggregates never travel here: totals are
   * derived by summing receipts, each once.
   */
  onUsage?: (info: {
    operationId: OperationId;
    agentId: AgentId;
    /** Own numeric usage for the ledger (domain aggregate of one receipt). */
    usage: unknown;
    originTaskRunId: string | null;
    originGeneration: number | null;
    late: boolean;
  }) => void;
}

/** Native (child-workdir) execution route for nested read/bash/etc. */
export type NativeExecutor = (
  caller: BrokerCaller,
  request: {
    operationId?: string;
    tool: string;
    args: Record<string, unknown>;
    parentOperationId?: string;
    /**
     * Invocation-specific cancellation for this native call only (never
     * agent-wide): aborting it must observably cancel this backend
     * invocation. Absent when the caller holds no per-invocation signal.
     */
    signal?: AbortSignal;
  },
) => Promise<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean; truncated: boolean }>;

/** Rejection for an invocation-specific native abort (observable error). */
function nativeAbortedError(tool: string): { content: [{ type: "text"; text: string }]; details: Record<string, never>; isError: true } {
  return { content: [{ type: "text", text: `NOT_RUNNING: native ${tool} invocation aborted` }], details: {}, isError: true as const };
}

export interface ExternalRequest {
  operationId?: string;
  tool: string;
  args: Record<string, unknown>;
  parentOperationId?: string;
  /**
   * Prepared-ticket path: args were already prepared + validated at
   * tool.prepare time, so the wrapper uses an identity preparation instead
   * of re-running the parent's prepareArguments. Validation still re-runs
   * harmlessly against the same schema at execution.
   */
  skipPrepare?: boolean;
}

export interface ExternalResult {
  operationId: OperationId;
  /** Immutable originating identity (accounting/attribution, not current run). */
  originTaskRunId: string | null;
  originGeneration: number | null;
  isError: boolean;
  content: GoverningResultContent[];
  details: unknown;
  structuredContent: unknown;
  /**
   * Wire receipt: the invocation's OWN reported usage preserved verbatim
   * when it is a valid public SDK `Usage`, otherwise absent (never a
   * collapsed aggregate and never an invalid shape).
   */
  usage: unknown;
  durationMs?: number;
}

interface ActiveExternal {
  operationId: OperationId;
  agentId: AgentId;
  tool: string;
  controller: AbortController;
  done: boolean;
  /** Cancel requested but effect not yet confirmed (outcome stays uncertain). */
  cancelRequested: boolean;
  /** Originating identity (immutable; late accounting uses this, never current). */
  originTaskRunId: string | null;
  originGeneration: number | null;
  parentOperationId: string | null;
  /** Combined child-owned + explicit signal exposed as the scope signal. */
  scopeSignal: AbortSignal;
  /** Resolvers notified on cancel (early return without waiting). */
  cancelNotifiers: Array<() => void>;
  /** True once a single outcome (or fence) was journaled for this op. */
  outcomeJournaled: boolean;
}

type UsageNumbers = { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number | null; unknown: boolean; seen: boolean };

const NATIVE_TOOLS: readonly string[] = ["read", "grep", "find", "ls", "write", "edit", "bash"];

function usageOf(raw: unknown): UsageNumbers {
  const acc: UsageNumbers = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: null, unknown: false, seen: false };
  if (typeof raw !== "object" || raw === null) return acc;
  const r = raw as Record<string, unknown>;
  const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
  if (finite(r["input"])) { acc.input += r["input"] as number; acc.seen = true; }
  if (finite(r["output"])) { acc.output += r["output"] as number; acc.seen = true; }
  if (finite(r["cacheRead"])) { acc.cacheRead += r["cacheRead"] as number; acc.seen = true; }
  if (finite(r["cacheWrite"])) { acc.cacheWrite += r["cacheWrite"] as number; acc.seen = true; }
  const c = r["cost"];
  if (finite(c)) { acc.cost = (acc.cost ?? 0) + (c as number); acc.seen = true; }
  else if (c !== null && typeof c === "object" && finite((c as { total?: unknown }).total)) {
    acc.cost = (acc.cost ?? 0) + ((c as { total: number }).total as number);
    acc.seen = true;
  }
  if (r["unknown"] === true) { acc.unknown = true; acc.seen = true; }
  return acc;
}

/**
 * Canonical ledger aggregate for ONE invocation's own raw reported usage
 * (numeric domain). Unrecognized shapes yield null (explicitly dropped, never
 * reattached raw). Totals are derived by summing per-op receipts, each once;
 * no outer aggregate is ever stored as an own report.
 */
export function ownLedgerUsage(rawOwn: unknown): unknown {
  // Absent usage: no receipt at all (no hook, no record).
  if (rawOwn === undefined || rawOwn === null) return null;
  const base = usageOf(rawOwn);
  // Provided-but-invalid/unrecognized billing is kept EXPLICITLY unknown
  // (never a silent valid zero): finite-valid partial receipts declare
  // unknown unless they are a full SDK result.
  if (!base.seen && !base.unknown) {
    return { input: 0, output: 0, unknown: true };
  }
  const out: Record<string, unknown> = { input: base.input, output: base.output };
  if (base.cacheRead) out["cacheRead"] = base.cacheRead;
  if (base.cacheWrite) out["cacheWrite"] = base.cacheWrite;
  if (base.cost !== null) out["cost"] = base.cost;
  if (base.unknown || !isValidUsage(rawOwn)) out["unknown"] = true;
  return out;
}

export class GoverningToolDispatcher {
  private store: RunStore;
  private getRegistry: () => GoverningRegistry | null;
  private executeNative: NativeExecutor;
  private authorizeLive: LiveAuthorize;
  private admissionHold: () => { code: string; message: string } | null;
  private isValid: () => boolean;
  private ownsJournal: () => boolean;
  private onUsage: NonNullable<DispatcherHooks["onUsage"]>;
  private jobs = new Map<OperationId, ActiveExternal>();
  /** Every owned invocation ID ever admitted (duplicate fencing across history). */
  private seenIds = new Set<OperationId>();
  /** Cross-route reservation shared with the native broker (see hooks). */
  private sharedIds: Set<OperationId>;

  constructor(
    store: RunStore,
    getRegistry: () => GoverningRegistry | null,
    executeNative: NativeExecutor,
    hooks?: DispatcherHooks,
  ) {
    this.store = store;
    this.getRegistry = getRegistry;
    this.executeNative = executeNative;
    this.authorizeLive = hooks?.authorizeLive ?? (() => ({ ok: true as const }));
    this.admissionHold = hooks?.admissionHold ?? (() => null);
    this.isValid = hooks?.isValid ?? (() => true);
    // Receipt ownership defaults to effect validity when the host does not
    // separate them; the supervisor passes a suspension-proof ownership
    // check so durable receipts survive recovery windows.
    const isValid = this.isValid;
    this.ownsJournal = hooks?.ownsJournal ?? isValid;
    this.sharedIds = hooks?.sharedIds ?? new Set<OperationId>();
    this.onUsage = hooks?.onUsage ?? (() => {});
  }

  activeJobs(agentId: AgentId): ActiveExternal[] {
    return [...this.jobs.values()].filter((j) => j.agentId === agentId && !j.done);
  }

  /** Quiescence gate (mirrors broker): no unfinished owned jobs (top or nested). */
  assertQuiescent(agentId: AgentId): void {
    const active = this.activeJobs(agentId);
    if (active.length > 0) {
      throw err("CONFLICT", `cannot park: ${active.length} owned external job(s) still active`, { ops: active.map((j) => j.operationId) });
    }
  }

  /**
   * Request cancellation: aborts signals and notifies waiters so callers
   * return promptly. Outcomes are journaled on settlement (single outcome
   * with late evidence) or by fencing — never waited on indefinitely here.
   */
  async cancelJobs(agentId: AgentId): Promise<string[]> {
    const active = this.activeJobs(agentId);
    for (const job of active) {
      job.cancelRequested = true;
      try {
        job.controller.abort();
      } catch {
        // best effort
      }
      for (const notify of job.cancelNotifiers.splice(0)) {
        try {
          notify();
        } catch {
          // ignore
        }
      }
    }
    return active.map((j) => j.operationId);
  }

  /**
   * Fence remaining jobs immediately (shutdown/close/settlement): abort and
   * journal a single `uncertain` outcome now. Control-quiescence (no owned
   * jobs) is distinct from effects-stopped (an abort-ignoring backend may
   * still act): fencing records durable uncertainty and retires the scope so
   * a next task may proceed after a prior terminal UNCERTAIN in host scope,
   * with late billing preserved under the original identity. Late
   * settlements become guarded recovery events, never second outcomes.
   */
  fenceAgentNow(agentId: AgentId, reason: string): string[] {
    const active = this.activeJobs(agentId);
    for (const job of active) {
      job.cancelRequested = true;
      try {
        job.controller.abort();
      } catch {
        // best effort
      }
      for (const notify of job.cancelNotifiers.splice(0)) {
        try {
          notify();
        } catch {
          // ignore
        }
      }
      if (!job.outcomeJournaled) {
        job.outcomeJournaled = true;
        job.done = true;
        if (this.isValid()) {
          try {
            this.store.append("tool.outcome", { operationId: job.operationId, status: "uncertain", external: true, error: reason });
          } catch {
            // store closed; fencing best effort
          }
        }
      }
      this.jobs.delete(job.operationId);
    }
    return active.map((j) => j.operationId);
  }

  async fenceAgent(agentId: AgentId, reason: string): Promise<string[]> {
    return this.fenceAgentNow(agentId, reason);
  }

  /** Rebuild duplicate fencing from journaled intents (restarts). */
  rehydrateSeen(operationIds: readonly string[]): void {
    for (const id of operationIds) this.seenIds.add(id);
  }

  /**
   * Report one invocation's OWN numeric usage for exactly-once accounting
   * under its originating identity. No-op when nothing recognizable was
   * reported (invalid shapes stay dropped, never valid zero).
   */
  /**
   * Durable canonical own receipt for the journal: numeric domain (or
   * explicit unknown), never the wire verbatim and never raw reattached.
   * Exists BEFORE any accounting commit that references it.
   */
  private canonicalReceipt(rawOwn: unknown): unknown {
    return ownLedgerUsage(rawOwn) ?? null;
  }

  private reportOwnUsage(job: Pick<ActiveExternal, "operationId" | "agentId" | "originTaskRunId" | "originGeneration">, rawOwn: unknown, late: boolean): void {
    const ledger = ownLedgerUsage(rawOwn);
    if (ledger === null) return;
    // A committing hook may fault (e.g. journal unavailable): route the
    // failure to a guarded durable receipt carrying the usage, never an
    // unhandled rejection. The receipt enables recovery catch-up repair.
    try {
      this.onUsage({ operationId: job.operationId, agentId: job.agentId, usage: ledger, originTaskRunId: job.originTaskRunId, originGeneration: job.originGeneration, late });
    } catch (e) {
      // Receipt ownership, not effect validity: the failed hook's ledger must
      // stay recoverable even while suspended (genuine disposal still guards).
      if (this.ownsJournal()) {
        try {
          this.store.append("recovery.event", {
            phase: "external-usage-commit-failed",
            operationId: job.operationId,
            agentId: job.agentId,
            taskRunId: job.originTaskRunId,
            generation: job.originGeneration,
            usage: ledger,
            error: String((e as Error)?.message ?? e).slice(0, 500),
          });
        } catch {
          // ignore after transfer
        }
      }
    }
  }

  /**
   * Top-level external dispatch (worker proxy -> supervisor). Throws for
   * policy/binding/generation denials (supervisor converts to isError
   * response, no effect); never throws for tool failures (returns isError).
   */
  async execute(caller: BrokerCaller, request: ExternalRequest): Promise<ExternalResult> {
    const registry = this.getRegistry();
    if (!registry || !registry.isActive()) {
      throw err("STALE_GENERATION", "governing session binding revoked (reload/replacement/disposal)");
    }
    const auth = authorizeExternalTool(caller.grants, request.tool);
    if (!auth.ok) throw auth.error;
    if (caller.grants.isolation === "sandbox") {
      throw err("POLICY_DENIED", `tool ${request.tool} unavailable in sandbox isolation`);
    }
    // Fail closed: an admitted generation requires both task and generation.
    if (caller.taskRunId === null || caller.taskRunId === undefined) {
      throw err("STALE_GENERATION", "caller has no admitted task run");
    }
    if (caller.generation === null || caller.generation === undefined) {
      throw err("STALE_GENERATION", "caller has no admitted generation");
    }
    // Root admission hold for genuinely NEW effects (billing debt/attach
    // catch-up): an already-admitted outer is NOT permission to start new
    // work after debt. Preparation/cancel/recovery/control/settlement never
    // pass here; already-admitted effects settle truthfully elsewhere.
    const hold = this.admissionHold();
    if (hold) throw err(hold.code as Parameters<typeof err>[0], hold.message);
    const live = this.authorizeLive(caller.agentId, request.tool, { taskRunId: caller.taskRunId, generation: caller.generation });
    if (!live.ok) throw err("POLICY_DENIED", live.message);
    const parent = registry.getHandle(request.tool);
    if (!parent) {
      throw err("POLICY_DENIED", `tool ${request.tool} unavailable in the governing session`);
    }
    const operationId = request.operationId ?? randomUUID();
    if (this.jobs.has(operationId) || this.seenIds.has(operationId) || this.sharedIds.has(operationId)) {
      throw err("DUPLICATE_REQUEST", `tool operation ${operationId} already recorded`);
    }
    const normalizedArgs = normalizeArgs(request.args);
    const controller = new AbortController();
    const job: ActiveExternal = {
      operationId,
      agentId: caller.agentId,
      tool: request.tool,
      controller,
      done: false,
      cancelRequested: false,
      originTaskRunId: caller.taskRunId,
      originGeneration: caller.generation,
      parentOperationId: request.parentOperationId ?? null,
      scopeSignal: controller.signal,
      cancelNotifiers: [],
      outcomeJournaled: false,
    };
    this.jobs.set(operationId, job);
    this.seenIds.add(operationId);
    this.sharedIds.add(operationId);
    this.store.append("tool.intent", {
      operationId,
      agentId: caller.agentId,
      taskRunId: caller.taskRunId,
      generation: caller.generation,
      tool: request.tool,
      external: true,
      parentOperationId: request.parentOperationId ?? null,
    });
    // Cancellation never blocks the caller indefinitely: race the tool
    // against cancel notification; late settlement journals once (uncertain
    // with evidence) via a validity-guarded callback.
    const toolPromise = this.runViaPublicCall(caller, registry, job, parent, normalizedArgs, request.skipPrepare === true);
    const cancelPromise = new Promise<{ cancelled: true }>((resolve) => {
      if (job.cancelRequested) resolve({ cancelled: true });
      else job.cancelNotifiers.push(() => resolve({ cancelled: true }));
    });
    const winner = await Promise.race([
      toolPromise.then((o) => ({ kind: "tool" as const, outcome: o })),
      cancelPromise.then(() => ({ kind: "cancel" as const })),
    ]);
    if (winner.kind === "cancel") {
      // Return promptly; the running tool keeps its tracking entry until it
      // settles, when a single uncertain outcome preserves late evidence.
      void toolPromise.then(
        (late) => {
          // Durable canonical own receipt from the raw own usage BEFORE the
          // hook: an invalid wire shape ({7,3,cost:1}) still bills {7,3,1,
          // unknown:true} durably; a faulting hook cannot lose it. Never
          // persist unbounded raw usage or reattach discarded wire usage.
          const rawOwn = (late as { rawOwnUsage?: unknown }).rawOwnUsage ?? late.result.usage;
          if (job.outcomeJournaled) {
            // Fenced while running: preserve late evidence as a guarded
            // recovery event under the original operation (never a second
            // outcome, never silent loss). Ownership-gated so a suspended
            // hook drop cannot erase the only numeric evidence.
            if (this.ownsJournal()) {
              try {
                const bounded = boundExternalResult(late.result);
                this.store.append("recovery.event", {
                  phase: "external-late-settlement",
                  operationId,
                  preview: previewText(bounded.content).slice(0, 2000),
                  usage: this.canonicalReceipt(rawOwn),
                });
              } catch {
                // ignore after transfer
              }
            }
            this.reportOwnUsage(job, rawOwn, true);
            this.jobs.delete(operationId);
            return;
          }
          job.outcomeJournaled = true;
          job.done = true;
          const bounded = boundExternalResult(late.result);
          if (this.isValid()) {
            try {
              this.store.append("tool.outcome", {
                operationId,
                status: "uncertain",
                external: true,
                error: "cancelled; late effect preserved as uncertain",
                preview: previewText(bounded.content).slice(0, 2000),
                usage: this.canonicalReceipt(rawOwn),
              });
            } catch {
              // store closed after transfer; evidence already returned below
            }
          }
          this.reportOwnUsage(job, rawOwn, true);
          this.jobs.delete(operationId);
        },
        (lateErr) => {
          if (job.outcomeJournaled) return;
          job.outcomeJournaled = true;
          job.done = true;
          if (this.isValid()) {
            try {
              this.store.append("tool.outcome", { operationId, status: "uncertain", external: true, error: (lateErr as Error).message });
            } catch {
              // ignore
            }
          }
          this.jobs.delete(operationId);
        },
      );
      return {
        operationId,
        originTaskRunId: job.originTaskRunId,
        originGeneration: job.originGeneration,
        isError: true,
        content: [{ type: "text", text: "NOT_RUNNING: external call cancelled" }],
        details: {},
        structuredContent: undefined,
        usage: null,
        durationMs: undefined,
      };
    }
    const outcome = winner.outcome;
    if (job.cancelRequested || job.controller.signal.aborted) {
      // Cancel raced completion: effect unconfirmed. Preserve late
      // content/usage evidence as uncertain, never silently discard.
      // Journal the canonical own receipt from raw BEFORE the hook.
      const rawOwn = (outcome as { rawOwnUsage?: unknown }).rawOwnUsage ?? outcome.result.usage;
      if (job.outcomeJournaled) {
        // A fence (or another interleaving) already journaled this
        // invocation's single outcome: preserve the late evidence as a
        // guarded recovery event under the original operation (never a
        // second outcome), then report the own receipt. The journal write
        // precedes the hook so a faulting hook cannot lose the receipt.
        // Ownership-gated: preserved even while suspended.
        const bounded = boundExternalResult(outcome.result);
        if (this.ownsJournal()) {
          try {
            this.store.append("recovery.event", {
              phase: "external-late-settlement",
              operationId,
              preview: previewText(bounded.content).slice(0, 2000),
              usage: this.canonicalReceipt(rawOwn),
            });
          } catch {
            // ignore after transfer
          }
        }
        this.reportOwnUsage(job, rawOwn, true);
        this.jobs.delete(operationId);
        return {
          operationId,
          originTaskRunId: job.originTaskRunId,
          originGeneration: job.originGeneration,
          isError: true,
          content: [...bounded.content.slice(0, 5), { type: "text", text: "[cancelled; late effect preserved as uncertain]" }],
          details: {},
          structuredContent: undefined,
          usage: bounded.usage ?? null,
          durationMs: outcome.durationMs,
        };
      }
      job.done = true;
      job.outcomeJournaled = true;
      const bounded = boundExternalResult(outcome.result);
      this.store.append("tool.outcome", {
        operationId,
        status: "uncertain",
        external: true,
        error: "cancelled; late effect preserved as uncertain",
        preview: previewText(bounded.content).slice(0, 2000),
        usage: this.canonicalReceipt(rawOwn),
      });
      this.reportOwnUsage(job, rawOwn, true);
      this.jobs.delete(operationId);
      return {
        operationId,
        originTaskRunId: job.originTaskRunId,
        originGeneration: job.originGeneration,
        isError: true,
        content: [...bounded.content.slice(0, 5), { type: "text", text: "[cancelled; late effect preserved as uncertain]" }],
        details: {},
        structuredContent: undefined,
        usage: bounded.usage ?? null,
        durationMs: outcome.durationMs,
      };
    }
    job.done = true;
    job.outcomeJournaled = true;
    const rawOwn = (outcome as { rawOwnUsage?: unknown }).rawOwnUsage ?? outcome.result.usage;
    const bounded = boundExternalResult(outcome.result);
    this.store.append("tool.outcome", {
      operationId,
      status: outcome.isError ? "error" : "ok",
      external: true,
      durationMs: outcome.durationMs,
      preview: previewText(bounded.content).slice(0, 2000),
      usage: this.canonicalReceipt(rawOwn),
    });
    this.reportOwnUsage(job, rawOwn, false);
    this.jobs.delete(operationId);
    return {
      operationId,
      originTaskRunId: job.originTaskRunId,
      originGeneration: job.originGeneration,
      isError: outcome.isError,
      content: bounded.content,
      details: bounded.details ?? {},
      structuredContent: bounded.structuredContent,
      usage: bounded.usage ?? null,
      durationMs: outcome.durationMs,
    };
  }

  /**
   * Wrap a parent handle with live re-authorization executed AFTER
   * prepareArguments/schema validation and immediately before the effect.
   * A revoking preparation (or a concurrently narrowed registry) therefore
   * blocks the actual handle invocation instead of running once stale.
   */
  private wrapLive(
    parent: PinnedGoverningHandle,
    scoped: unknown,
    caller: BrokerCaller,
    scopeJob: ActiveExternal,
    skipPrepare = false,
  ): PinnedGoverningHandle {
    // Snapshot at wrap time (before runToolCall preparation runs): the
    // underlying implementation references are bound explicitly. A handle
    // replacement — even with identical description and schema — or an
    // in-place schema mutation during preparation is denied instead of
    // executing the new impl under the old schema (or vice versa). Function
    // source text is never compared; reference equality on the stable
    // underlying refs is the stable binding identity.
    const boundExecute = parent.execute;
    const boundPrepare = parent.prepareArguments;
    let paramsJson: string | null = null;
    try {
      paramsJson = JSON.stringify(parent.parameters ?? null);
    } catch {
      paramsJson = null;
    }
    const execute = async (toolCallId: string, params: unknown, signal: AbortSignal | undefined, onUpdate: ((p: AgentToolResult) => void) | undefined): Promise<GoverningToolResult> => {
      if (scopeJob.cancelRequested) {
        return { content: [{ type: "text", text: "NOT_RUNNING: invocation scope retired" }], details: {}, isError: true };
      }
      const live = this.authorizeLive(caller.agentId, parent.name, { taskRunId: caller.taskRunId, generation: caller.generation });
      if (!live.ok) {
        return { content: [{ type: "text", text: `${live.code}: ${live.message}` }], details: {}, isError: true };
      }
      const registry = this.getRegistry();
      const current = registry?.isActive() === true ? registry.getHandle(parent.name) : undefined;
      if (!current) {
        return { content: [{ type: "text", text: `POLICY_DENIED: tool ${parent.name} unavailable in the governing session` }], details: {}, isError: true };
      }
      // Always compare the underlying implementation references, regardless of
      // object identity: a same-object in-place execute/prepare swap during
      // preparation must deny (new impl under old args), while a fresh stable
      // SDK wrapper clone around the same definition (same refs + schema)
      // still delegates normally. Anything else is a revocation.
      if (current.execute !== boundExecute || current.prepareArguments !== boundPrepare) {
        return { content: [{ type: "text", text: `POLICY_DENIED: tool ${parent.name} implementation changed during preparation` }], details: {}, isError: true };
      }
      try {
        if (JSON.stringify(current.parameters ?? null) !== paramsJson) {
          return { content: [{ type: "text", text: `POLICY_DENIED: tool ${parent.name} schema changed during preparation` }], details: {}, isError: true };
        }
      } catch {
        return { content: [{ type: "text", text: `POLICY_DENIED: tool ${parent.name} schema not serializable` }], details: {}, isError: true };
      }
      if (!this.jobs.has(scopeJob.operationId) || scopeJob.done || scopeJob.cancelRequested) {
        return { content: [{ type: "text", text: "STALE_GENERATION: invocation scope revoked" }], details: {}, isError: true };
      }
      // Bridge partial-update callbacks across the narrow runtime boundary
      // (single documented cast; content shape is preserved verbatim).
      const forwardUpdate = onUpdate === undefined
        ? undefined
        : (partial: GoverningToolResult): void => {
          onUpdate(partial as unknown as AgentToolResult);
        };
      return current.execute(toolCallId, params, signal, forwardUpdate, scoped);
    };
    return {
      name: parent.name,
      description: parent.description,
      parameters: parent.parameters,
      // Prepared-ticket path substitutes a no-op preparation: the args were
      // already prepared + validated once at tool.prepare time. Re-running
      // the parent's preparation here would double-apply mappings.
      ...(skipPrepare ? { prepareArguments: (args: unknown): unknown => args } : (parent.prepareArguments !== undefined ? { prepareArguments: parent.prepareArguments } : {})),
      ...(parent.outputSchema !== undefined ? { outputSchema: parent.outputSchema } : {}),
      ...(parent.executionMode !== undefined ? { executionMode: parent.executionMode } : {}),
      execute: execute as unknown as PinnedGoverningHandle["execute"],
    };
  }

  private async runViaPublicCall(
    caller: BrokerCaller,
    registry: GoverningRegistry,
    job: ActiveExternal,
    parent: PinnedGoverningHandle,
    args: Record<string, JsonValue>,
    skipPrepare = false,
  ): Promise<{ result: GoverningToolResult; isError: boolean; durationMs?: number; rawOwnUsage?: unknown }> {
    const base = registry.baseCtx();
    if (!base) throw err("STALE_GENERATION", "governing session binding revoked");
    // Scoped context: union of child-native broker proxies + approved
    // external proxies, all dispatcher-routed (no raw parent bypass).
    // Built fresh per top-level call so nested calls share caller grants,
    // child-owned signal, and parent chain.
    let scoped: object | null = null;
    const nestedExecute = (
      name: string,
      nestedArgs: unknown,
      options?: { signal?: AbortSignal; onUpdate?: (p: AgentToolResult) => void },
    ): Promise<AgentToolCallOutcome> => {
      return this.nestedDispatch(caller, registry, job, name, nestedArgs, options);
    };
    const toolsGetter = (): readonly unknown[] => this.scopedTools(caller, registry, job);
    scoped = createScopedGoverningContext(base, {
      tools: toolsGetter,
      executeTool: nestedExecute,
      signal: () => job.controller.signal,
    });
    const wrapped = this.wrapLive(parent, scoped, caller, job, skipPrepare);
    const toolCall: AgentToolCall = { type: "toolCall", id: job.operationId, name: wrapped.name, arguments: args };
    const assistantMessage = { role: "assistant", content: [], timestamp: 0 };
    try {
      const outcome = await runToolCall(toolCall, {
        tools: [wrapped],
        assistantMessage,
        context: { messages: [], tools: [wrapped] },
        signal: job.controller.signal,
        onUpdate: undefined,
      } as unknown as Parameters<typeof runToolCall>[1]);
      const rawOwn = ((outcome.result ?? {}) as GoverningToolResult).usage;
      const result = (outcome.result ?? { content: [], details: {} }) as unknown as GoverningToolResult;
      const bounded = Array.isArray(result.content) ? result : { content: [], details: {}, isError: true };
      return { result: bounded as GoverningToolResult, isError: outcome.isError === true, durationMs: outcome.durationMs, rawOwnUsage: rawOwn };
    } catch (e) {
      return { result: normalizeExternalError("INVALID", (e as Error).message), isError: true };
    }
  }

  /**
   * Scoped union tools: every entry routes through the dispatcher (same
   * entry as ctx.executeTool), never raw parent handles. Direct `.execute`
   * therefore enforces live reauthorization, schema validation,
   * cancellation, journal/IDs, and usage — identical to executeTool.
   */
  private scopedTools(
    caller: BrokerCaller,
    registry: GoverningRegistry,
    job: ActiveExternal,
    _nestedExecute?: (name: string, args: unknown, options?: { signal?: AbortSignal; onUpdate?: (p: AgentToolResult) => void }) => Promise<AgentToolCallOutcome>,
  ): readonly unknown[] {
    const out: unknown[] = [];
    for (const name of NATIVE_TOOLS) {
      if (!caller.grants.tools.includes(name)) continue;
      out.push(this.routedNativeProxy(caller, registry, job, name));
    }
    const allowed = caller.grants.externalTools ?? [];
    for (const name of allowed) {
      if (isReservedToolName(name)) continue;
      const parent = registry.getHandle(name);
      if (!parent) continue;
      out.push(this.routedExternalProxy(caller, registry, job, parent));
    }
    return out;
  }

  /** Dispatcher-routed native proxy (live checks; broker-owned journal). */
  private routedNativeProxy(
    caller: BrokerCaller,
    registry: GoverningRegistry,
    job: ActiveExternal,
    name: string,
  ): unknown {
    return {
      name,
      description: `child ${name}`,
      parameters: { type: "object" },
      execute: async (toolCallId: string, params: unknown, signal: AbortSignal | undefined, onUpdate: ((p: AgentToolResult) => void) | undefined) => {
        void onUpdate;
        // Live scope + binding + generation checks (retained/cancelled
        // handles die here, before any native effect).
        if (!this.jobs.has(job.operationId) || job.done || job.cancelRequested) {
          return { content: [{ type: "text", text: "STALE_GENERATION: invocation scope revoked" }], details: {}, isError: true };
        }
        // Root admission hold: NEW nested native effects deny while billing
        // debt/attach catch-up holds, even inside an already-admitted outer.
        const hold = this.admissionHold();
        if (hold) {
          return { content: [{ type: "text", text: `${hold.code}: ${hold.message}` }], details: {}, isError: true };
        }
        const live = this.authorizeLive(caller.agentId, name, { taskRunId: caller.taskRunId, generation: caller.generation });
        if (!live.ok) {
          return { content: [{ type: "text", text: `${live.code}: ${live.message}` }], details: {}, isError: true };
        }
        if (!registry.isActive() || job.controller.signal.aborted || signal?.aborted) {
          return { content: [{ type: "text", text: "STALE_GENERATION: governing binding revoked or call cancelled" }], details: {}, isError: true };
        }
        if (caller.taskRunId === null || caller.taskRunId === undefined || caller.generation === null || caller.generation === undefined) {
          return { content: [{ type: "text", text: "STALE_GENERATION: caller has no admitted task run" }], details: {}, isError: true };
        }
        if (!caller.grants.tools.includes(name)) {
          return { content: [{ type: "text", text: `POLICY_DENIED: tool ${name} not granted to caller` }], details: {}, isError: true };
        }
        const nestedId = typeof toolCallId === "string" && toolCallId.length > 0 ? toolCallId : randomUUID();
        if (this.jobs.has(nestedId) || this.seenIds.has(nestedId) || this.sharedIds.has(nestedId)) {
          return { content: [{ type: "text", text: `DUPLICATE_REQUEST: tool operation ${nestedId} already recorded` }], details: {}, isError: true };
        }
        // Reserve dispatcher-locally before any effect: an external claim
        // on this same ID must deny instead of double-running. Deliberately
        // NOT shared: the broker call below admits under this same ID, and a
        // shared write here would read back as our own duplicate. The broker
        // records the shared reservation itself on admit, which fences the
        // reverse order (direct broker claim first).
        this.seenIds.add(nestedId);
        try {
          // Invocation-specific cancellation: the combined lifetime signal
          // travels to the backend (op-specific abort, never agent-wide)
          // and the caller is released promptly even if the backend ignores
          // it. The broker owns the native journal (cancelled outcome).
          const combined = combineSignals(job.controller.signal, signal);
          const backend = this.executeNative(caller, { operationId: nestedId, tool: name, args: normalizeArgs(params as Record<string, unknown>), parentOperationId: job.operationId, signal: combined });
          const res = await Promise.race([
            backend,
            new Promise<never>((_, reject) => {
              if (combined.aborted) reject(err("NOT_RUNNING", `native ${name} invocation aborted`));
              else combined.addEventListener("abort", () => reject(err("NOT_RUNNING", `native ${name} invocation aborted`)), { once: true });
            }),
          ]);
          const text = res.timedOut
            ? `tool timed out${res.stdout ? `\n${res.stdout.slice(0, 4000)}` : ""}`
            : `${res.stdout}${res.stderr ? `\n[stderr]\n${res.stderr.slice(0, 2000)}` : ""}${res.truncated ? "\n[output truncated]" : ""}`;
          const exit = res.exitCode !== 0 ? `\n[exit ${res.exitCode}]` : "";
          return { content: [{ type: "text", text: `${text}${exit}`.slice(0, 48_000) }], details: {}, isError: res.exitCode !== 0 || res.timedOut };
        } catch (e) {
          const code = (e as { code?: string }).code ?? "INVALID";
          return { content: [{ type: "text", text: `${code}: ${(e as Error).message}` }], details: {}, isError: true };
        }
      },
    };
  }

  /** Dispatcher-routed external proxy (same entry as executeTool, not raw parent). */
  private routedExternalProxy(
    caller: BrokerCaller,
    registry: GoverningRegistry,
    job: ActiveExternal,
    parent: PinnedGoverningHandle,
  ): unknown {
    return {
      name: parent.name,
      description: parent.description,
      parameters: parent.parameters,
      ...(parent.prepareArguments !== undefined ? { prepareArguments: parent.prepareArguments } : {}),
      ...(parent.outputSchema !== undefined ? { outputSchema: parent.outputSchema } : {}),
      ...(parent.executionMode !== undefined ? { executionMode: parent.executionMode } : {}),
      execute: async (toolCallId: string, params: unknown, signal: AbortSignal | undefined, onUpdate: ((p: AgentToolResult) => void) | undefined) => {
        const nestedId = typeof toolCallId === "string" && toolCallId.length > 0 ? toolCallId : randomUUID();
        const outcome = await this.nestedDispatch(caller, registry, job, parent.name, params, { signal, onUpdate, operationId: nestedId });
        // Propagate normalized/bounded error status (validation/thrown
        // failures must not appear successful through direct handles).
        return { ...(outcome.result as unknown as Record<string, unknown>), isError: outcome.isError } as unknown as AgentToolResult;
      },
    };
  }

  private async nestedDispatch(
    caller: BrokerCaller,
    registry: GoverningRegistry,
    job: ActiveExternal,
    name: string,
    args: unknown,
    options?: { signal?: AbortSignal; onUpdate?: (p: AgentToolResult) => void; operationId?: string },
  ): Promise<AgentToolCallOutcome> {
    const nestedId = options?.operationId ?? randomUUID();
    if (this.jobs.has(nestedId) || this.seenIds.has(nestedId) || this.sharedIds.has(nestedId)) {
      return {
        toolCall: { type: "toolCall", id: nestedId, name, arguments: {} },
        result: normalizeExternalError("DUPLICATE_REQUEST", `tool operation ${nestedId} already recorded`) as unknown as AgentToolResult,
        isError: true,
      };
    }
    // Completed OR cancelled scopes are revoked: a retained context dies
    // here, before any effect, even while the raw promise still runs.
    if (!this.jobs.has(job.operationId) || job.done || job.cancelRequested) {
      return {
        toolCall: { type: "toolCall", id: nestedId, name, arguments: {} },
        result: normalizeExternalError("STALE_GENERATION", "invocation scope revoked") as unknown as AgentToolResult,
        isError: true,
      };
    }
    const signal = combineSignals(job.controller.signal, options?.signal);
    if (!registry.isActive() || signal.aborted) {
      return {
        toolCall: { type: "toolCall", id: nestedId, name, arguments: {} },
        result: normalizeExternalError("STALE_GENERATION", "governing binding revoked or call cancelled") as unknown as AgentToolResult,
        isError: true,
      };
    }
    if (caller.taskRunId === null || caller.taskRunId === undefined || caller.generation === null || caller.generation === undefined) {
      return {
        toolCall: { type: "toolCall", id: nestedId, name, arguments: {} },
        result: normalizeExternalError("STALE_GENERATION", "caller has no admitted task run") as unknown as AgentToolResult,
        isError: true,
      };
    }
    // Root admission hold for genuinely NEW nested effects (billing debt/
    // attach catch-up): the admitted outer scope is NOT permission to start
    // new nested work after debt. Already-admitted outer settlement and
    // control/recovery paths never pass here.
    const hold = this.admissionHold();
    if (hold) {
      return {
        toolCall: { type: "toolCall", id: nestedId, name, arguments: {} },
        result: normalizeExternalError(hold.code, hold.message) as unknown as AgentToolResult,
        isError: true,
      };
    }
    const live = this.authorizeLive(caller.agentId, name, { taskRunId: caller.taskRunId, generation: caller.generation });
    if (!live.ok) {
      return {
        toolCall: { type: "toolCall", id: nestedId, name, arguments: {} },
        result: normalizeExternalError(live.code, live.message) as unknown as AgentToolResult,
        isError: true,
      };
    }
    // Native route: broker-owned intent/outcome (single journal, IDs passed in).
    if ((NATIVE_TOOLS as readonly string[]).includes(name)) {
      if (!caller.grants.tools.includes(name)) {
        return {
          toolCall: { type: "toolCall", id: nestedId, name, arguments: normalizeArgs(args as Record<string, unknown>) },
          result: normalizeExternalError("POLICY_DENIED", `tool ${name} not granted to caller`) as unknown as AgentToolResult,
          isError: true,
        };
      }
      const liveNative = this.authorizeLive(caller.agentId, name, { taskRunId: caller.taskRunId, generation: caller.generation });
      if (!liveNative.ok) {
        return {
          toolCall: { type: "toolCall", id: nestedId, name, arguments: {} },
          result: normalizeExternalError(liveNative.code, liveNative.message) as unknown as AgentToolResult,
          isError: true,
        };
      }
      // Reserve dispatcher-locally: the broker owns this invocation's
      // journal and records the shared reservation itself on admit (a shared
      // write here would read back as our own duplicate when the broker
      // checks below). Dispatcher-level later claims still deny via seenIds.
      this.seenIds.add(nestedId);
      try {
        // Invocation-specific cancellation, same contract as the direct
        // native proxy: the combined signal reaches this backend only, and
        // the caller is released promptly on abort. The broker owns the
        // native journal (cancelled outcome); nothing is duplicated here.
        const backend = this.executeNative(caller, { operationId: nestedId, tool: name, args: normalizeArgs(args as Record<string, unknown>), parentOperationId: job.operationId, signal });
        const res = await Promise.race([
          backend,
          new Promise<never>((_, reject) => {
            if (signal.aborted) reject(err("NOT_RUNNING", `native ${name} invocation aborted`));
            else signal.addEventListener("abort", () => reject(err("NOT_RUNNING", `native ${name} invocation aborted`)), { once: true });
          }),
        ]);
        const text = res.timedOut
          ? `tool timed out${res.stdout ? `\n${res.stdout.slice(0, 4000)}` : ""}`
          : `${res.stdout}${res.stderr ? `\n[stderr]\n${res.stderr.slice(0, 2000)}` : ""}${res.truncated ? "\n[output truncated]" : ""}`;
        const exit = res.exitCode !== 0 ? `\n[exit ${res.exitCode}]` : "";
        const result: GoverningToolResult = { content: [{ type: "text", text: `${text}${exit}`.slice(0, 48_000) }], details: {}, isError: res.exitCode !== 0 || res.timedOut };
        options?.onUpdate?.(result as unknown as AgentToolResult);
        // Broker already journaled intent/outcome under nestedId; dispatcher
        // must not duplicate post-effect records. Track usage for the parent.
        return {
          toolCall: { type: "toolCall", id: nestedId, name, arguments: normalizeArgs(args as Record<string, unknown>) },
          result: result as unknown as AgentToolResult,
          isError: result.isError === true,
        };
      } catch (e) {
        const res = normalizeExternalError((e as { code?: string }).code ?? "INVALID", (e as Error).message);
        return {
          toolCall: { type: "toolCall", id: nestedId, name, arguments: normalizeArgs(args as Record<string, unknown>) },
          result: res as unknown as AgentToolResult,
          isError: true,
        };
      }
    }
    // External route: captured grants re-checked above via live callback plus
    // current registry (no silent widening); register the nested invocation
    // so it is tracked, cancellable, and duplicate-fenced like top-level.
    const auth = authorizeExternalTool(caller.grants, name);
    if (!auth.ok) {
      return {
        toolCall: { type: "toolCall", id: nestedId, name, arguments: {} },
        result: normalizeExternalError(auth.error.code, auth.error.message) as unknown as AgentToolResult,
        isError: true,
      };
    }
    const parent = registry.getHandle(name);
    if (!parent) {
      return {
        toolCall: { type: "toolCall", id: nestedId, name, arguments: {} },
        result: normalizeExternalError("POLICY_DENIED", `tool ${name} unavailable in the governing session`) as unknown as AgentToolResult,
        isError: true,
      };
    }
    const nested: ActiveExternal = {
      operationId: nestedId,
      agentId: caller.agentId,
      tool: name,
      controller: new AbortController(),
      done: false,
      cancelRequested: false,
      originTaskRunId: job.originTaskRunId,
      originGeneration: job.originGeneration,
      parentOperationId: job.operationId,
      scopeSignal: job.controller.signal,
      cancelNotifiers: [],
      outcomeJournaled: false,
    };
    // Nested lifetime is bound to the parent: parent cancel aborts nested.
    const forwardCancel = (): void => {
      nested.cancelRequested = true;
      try {
        nested.controller.abort();
      } catch {
        // ignore
      }
      for (const notify of nested.cancelNotifiers.splice(0)) {
        try {
          notify();
        } catch {
          // ignore
        }
      }
    };
    job.controller.signal.addEventListener("abort", forwardCancel, { once: true });
    this.jobs.set(nestedId, nested);
    this.seenIds.add(nestedId);
    this.sharedIds.add(nestedId);
    this.store.append("tool.intent", { operationId: nestedId, agentId: caller.agentId, taskRunId: caller.taskRunId, generation: caller.generation, tool: name, external: true, parentOperationId: job.operationId });
    // Per-invocation scoped context bound to the NESTED lifecycle (never the
    // outer scope): the inner tool's nested calls chain from here, and a
    // retained inner context retires with this invocation, independently of
    // the still-running outer scope.
    const nestedBase = registry.baseCtx();
    if (!nestedBase) {
      this.jobs.delete(nestedId);
      job.controller.signal.removeEventListener("abort", forwardCancel);
      return {
        toolCall: { type: "toolCall", id: nestedId, name, arguments: {} },
        result: normalizeExternalError("STALE_GENERATION", "governing session binding revoked") as unknown as AgentToolResult,
        isError: true,
      };
    }
    let nestedScoped: object | null = null;
    const nestedExecuteInner = (
      innerName: string,
      innerArgs: unknown,
      innerOptions?: { signal?: AbortSignal; onUpdate?: (p: AgentToolResult) => void },
    ): Promise<AgentToolCallOutcome> => {
      return this.nestedDispatch(caller, registry, nested as ActiveExternal, innerName, innerArgs, innerOptions);
    };
    nestedScoped = createScopedGoverningContext(nestedBase, {
      tools: (): readonly unknown[] => this.scopedTools(caller, registry, nested as ActiveExternal, nestedExecuteInner),
      executeTool: nestedExecuteInner,
      signal: () => nested.scopeSignal,
    });
    // The combined signal drives invocation cancellation (not outer-only):
    // an explicit nested abort releases this invocation even when the outer
    // lifetime continues and the tool ignores abort forever.
    const combined = combineSignals(nested.controller.signal, options?.signal);
    // The scope signal IS the combined signal (exposed ctx.signal reflects
    // explicit aborts, not just the outer lifetime).
    nested.scopeSignal = combined;
    const onCombinedAbort = (): void => {
      if (nested.cancelRequested) return;
      // Retire the scope immediately: abort the controller (so the exposed
      // ctx.signal aborts too) and release waiters. The raw promise may keep
      // running; its late settlement is billed but never effects again.
      nested.cancelRequested = true;
      try {
        nested.controller.abort();
      } catch {
        // ignore
      }
      for (const notify of nested.cancelNotifiers.splice(0)) {
        try {
          notify();
        } catch {
          // ignore
        }
      }
    };
    if (combined.aborted) onCombinedAbort();
    else combined.addEventListener("abort", onCombinedAbort, { once: true });
    // The raw OWN receipt travels alongside the bound wire result: billing
    // reports the original own usage even when the wire truncates it away.
    type NestedToolPromiseOutcome = AgentToolCallOutcome & { rawOwnUsage?: unknown };
    const toolPromise: Promise<NestedToolPromiseOutcome> = (async (): Promise<NestedToolPromiseOutcome> => {
      try {
        const wrapped = this.wrapLive(parent, nestedScoped as object, caller, nested);
        const toolCall: AgentToolCall = { type: "toolCall", id: nestedId, name, arguments: normalizeArgs(args) };
        const assistantMessage = { role: "assistant", content: [], timestamp: 0 };
        const outcome = await runToolCall(toolCall, {
          tools: [wrapped],
          assistantMessage,
          context: { messages: [], tools: [wrapped] },
          signal: combined,
          onUpdate: options?.onUpdate,
        } as unknown as Parameters<typeof runToolCall>[1]);
        const rawOwn = ((outcome.result ?? {}) as GoverningToolResult).usage;
        const result = boundExternalResult(((outcome.result ?? { content: [] }) as unknown as GoverningToolResult));
        return {
          toolCall: { type: "toolCall", id: nestedId, name, arguments: normalizeArgs(args as Record<string, unknown>) },
          result: result as unknown as AgentToolResult,
          isError: outcome.isError === true,
          ...(outcome.durationMs !== undefined ? { durationMs: outcome.durationMs } : {}),
          rawOwnUsage: rawOwn,
        };
      } catch (e) {
        const res = normalizeExternalError("INVALID", (e as Error).message);
        return {
          toolCall: { type: "toolCall", id: nestedId, name, arguments: {} },
          result: res as unknown as AgentToolResult,
          isError: true,
          rawOwnUsage: undefined,
        };
      }
    })();
    const cancelPromise = new Promise<{ cancelled: true }>((resolve) => {
      if (nested.cancelRequested) resolve({ cancelled: true });
      else nested.cancelNotifiers.push(() => resolve({ cancelled: true }));
    });
    const winner = await Promise.race([
      toolPromise.then((o) => ({ kind: "tool" as const, outcome: o })),
      cancelPromise.then(() => ({ kind: "cancel" as const })),
    ]);
    const finishNested = (status: string, result: GoverningToolResult | null, extra?: Record<string, unknown>): void => {
      if (nested.outcomeJournaled) return;
      nested.outcomeJournaled = true;
      nested.done = true;
      if (this.isValid()) {
        try {
          this.store.append("tool.outcome", { operationId: nestedId, status, external: true, ...(result ? { preview: previewText(result.content).slice(0, 2000), usage: result.usage ?? null } : {}), ...(extra ?? {}) });
        } catch {
          // ignore after transfer
        }
      }
      this.jobs.delete(nestedId);
      job.controller.signal.removeEventListener("abort", forwardCancel);
    };
    if (winner.kind === "cancel") {
      // Async late settlement: this invocation's OWN receipt is journaled
      // (wire) and reported (ledger) exactly once under its inherited origin
      // identity — never folded into a parent aggregate.
      const lateHook = (rawOwn: unknown): void => {
        this.reportOwnUsage(nested, rawOwn, true);
      };
      void toolPromise.then(
        (late) => {
          const lateResult = (late.result ?? { content: [] }) as unknown as GoverningToolResult;
          const rawOwn = (late as { rawOwnUsage?: unknown }).rawOwnUsage ?? lateResult.usage;
          // Journal the canonical own receipt from raw BEFORE the hook, in
          // ALL late branches: {7,3,cost:1} -> {7,3,1,unknown:true} durably.
          const bounded = boundExternalResult(lateResult);
          if (nested.outcomeJournaled) {
            // Ownership-gated (see top-level fenced branch).
            if (this.ownsJournal()) {
              try {
                this.store.append("recovery.event", { phase: "external-late-settlement", operationId: nestedId, preview: previewText(bounded.content).slice(0, 2000), usage: this.canonicalReceipt(rawOwn) });
              } catch {
                // ignore after transfer
              }
            }
            lateHook(rawOwn);
            this.jobs.delete(nestedId);
            return;
          }
          finishNested("uncertain", bounded, { error: "cancelled; late effect preserved as uncertain", usage: this.canonicalReceipt(rawOwn) });
          lateHook(rawOwn);
        },
        (lateErr) => {
          finishNested("uncertain", null, { error: (lateErr as Error).message });
        },
      );
      return {
        toolCall: { type: "toolCall", id: nestedId, name, arguments: {} },
        result: normalizeExternalError("NOT_RUNNING", "nested external call cancelled") as unknown as AgentToolResult,
        isError: true,
      };
    }
    const outcome = winner.outcome;
    const outResult = (outcome.result ?? { content: [] }) as unknown as GoverningToolResult;
    if (nested.cancelRequested || nested.controller.signal.aborted || job.cancelRequested) {
      const rawOwn = (outcome as { rawOwnUsage?: unknown }).rawOwnUsage;
      if (nested.outcomeJournaled) {
        // Already fenced: keep the single outcome; journal the durable
        // canonical own receipt as a guarded recovery event BEFORE the hook
        // so a faulting hook cannot lose it. Ownership-gated: preserved even
        // while suspended.
        if (this.ownsJournal()) {
          try {
            this.store.append("recovery.event", { phase: "external-late-settlement", operationId: nestedId, preview: previewText(boundExternalResult(outResult).content).slice(0, 2000), usage: this.canonicalReceipt(rawOwn) });
          } catch {
            // ignore after transfer
          }
        }
        this.reportOwnUsage(nested, rawOwn, true);
        this.jobs.delete(nestedId);
        job.controller.signal.removeEventListener("abort", forwardCancel);
        return { ...outcome, result: normalizeExternalError("NOT_RUNNING", "nested external call cancelled") as unknown as AgentToolResult, isError: true };
      }
      finishNested("uncertain", boundExternalResult(outResult), { error: "cancelled; late effect preserved as uncertain", usage: this.canonicalReceipt(rawOwn) });
      this.reportOwnUsage(nested, rawOwn, true);
      return { ...outcome, result: normalizeExternalError("NOT_RUNNING", "nested external call cancelled") as unknown as AgentToolResult, isError: true };
    }
    const bounded = boundExternalResult(outResult);
    finishNested(outcome.isError ? "error" : "ok", bounded, { usage: this.canonicalReceipt((outcome as { rawOwnUsage?: unknown }).rawOwnUsage) });
    this.reportOwnUsage(nested, (outcome as { rawOwnUsage?: unknown }).rawOwnUsage, false);
    return {
      toolCall: { type: "toolCall", id: nestedId, name, arguments: normalizeArgs(args as Record<string, unknown>) },
      result: bounded as unknown as AgentToolResult,
      isError: outcome.isError === true,
      ...(outcome.durationMs !== undefined ? { durationMs: outcome.durationMs } : {}),
    };
  }
}

export function normalizeArgs(args: unknown): Record<string, JsonValue> {
  const normalized = JSON.parse(JSON.stringify(args ?? {})) as JsonValue;
  if (typeof normalized !== "object" || normalized === null || Array.isArray(normalized)) {
    throw err("INVALID", "tool args must be an object");
  }
  return normalized as Record<string, JsonValue>;
}

function previewText(content: GoverningResultContent[]): string {
  return content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n");
}

export function governingHandleSnapshotForTests(baseCtx: unknown): PinnedGoverningHandle[] {
  return snapshotGoverningHandles(baseCtx);
}
