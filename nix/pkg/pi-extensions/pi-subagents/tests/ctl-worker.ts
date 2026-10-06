/**
 * Manually driven worker for controller races: it settles, asks, decides,
 * and calls control tools only when a test says so. Responses mirror the
 * real worker's shapes (`ok` flags, find_entry/checkpoint payloads).
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GovernorContext, WorkerFactory, WorkerPort } from "../src/supervisor.ts";
import { Supervisor } from "../src/supervisor.ts";
import type { WorkerEvent } from "../src/protocol.ts";
import type { ToolRequest } from "../src/worker-launch.ts";
import { InMemoryRunStore, type RunStore } from "../src/store.ts";
import { DummyToolExecutor } from "../src/sandbox.ts";
import { DummyWorkspaceManager, type WorkspaceManager } from "../src/workspace.ts";
import { defaultSupervisorPolicy, type SupervisorPolicy } from "../src/policy.ts";
import { testGovernor } from "./fake-worker.ts";

type ToolHandler = (p: ToolRequest) => Promise<{ content: string; isError: boolean }>;

export class CtlWorker implements WorkerPort {
  readonly instanceId = randomUUID();
  readonly pid = null;
  private emit: ((e: WorkerEvent) => void) | null = null;
  private tool: ToolHandler | null = null;
  private exit: ((info: { code: number | null; signal: string | null }) => void) | null = null;
  taskRunId = "x";
  generation = 1;
  killed = false;
  delivered: Array<{ mode: string; text: string; messageId: string }> = [];
  initText: string | null = null;
  initTools: string[] = [];
  /** The latest initialize payload (workdir, instructions, ...). */
  init: Record<string, unknown> | null = null;
  settleOnInterrupt = true;
  readonly agentId: string;

  constructor(agentId: string) {
    this.agentId = agentId;
  }

  async launch(): Promise<void> {}

  async request(op: string, payload: unknown, opts?: { taskRunId?: string; generation?: number }): Promise<unknown> {
    if (this.killed) throw new Error("killed");
    const p = (payload ?? {}) as Record<string, unknown>;
    if (op === "initialize") {
      this.init = p;
      this.taskRunId = String(p["taskRunId"]);
      this.generation = Number(p["executionGeneration"]);
      this.initText = (p["taskText"] as string | null) ?? null;
      this.initTools = (p["tools"] as string[]) ?? [];
      if (this.initText !== null) queueMicrotask(() => this.fire("started", {}));
      return { ok: true, sessionId: "s", sessionFile: null };
    }
    if (op === "deliver") {
      this.delivered.push({ mode: String(p["mode"]), text: String(p["text"]), messageId: String(p["messageId"] ?? "") });
      if (p["mode"] === "task" || p["mode"] === "repair") {
        this.taskRunId = opts?.taskRunId ?? this.taskRunId;
        this.generation = opts?.generation ?? this.generation;
        queueMicrotask(() => this.fire("started", {}));
        return { ok: true, generation: this.generation };
      }
      return { ok: true, inserted: true };
    }
    if (op === "interrupt") {
      if (this.settleOnInterrupt) queueMicrotask(() => this.settle("interrupted"));
      return { ok: true };
    }
    if (op === "checkpoint") return { ok: true, materialized: false, leafEntryId: null };
    if (op === "find_entry") return { ok: true, found: false, entryId: null };
    throw new Error(`op ${op}`);
  }

  kill(): void {
    this.killed = true;
  }

  setEventHandler(h: (e: WorkerEvent) => void): void {
    this.emit = h;
  }

  setToolRequestHandler(h: ToolHandler): void {
    this.tool = h;
  }

  setExitHandler(h: (info: { code: number | null; signal: string | null }) => void): void {
    this.exit = h;
  }

  fire(kind: WorkerEvent["kind"], detail: Record<string, unknown>): void {
    this.emit?.({ kind, taskRunId: this.taskRunId, executionGeneration: this.generation, detail });
  }

  settle(status = "succeeded", text = "done"): void {
    this.fire("settled", { status, lastAssistantText: text, usage: { input: 1, output: 1, cost: 0, unknown: false } });
  }

  crash(): void {
    this.killed = true;
    this.exit?.({ code: null, signal: "SIGKILL" });
  }

  call(tool: string, args: Record<string, unknown>): Promise<{ content: string; isError: boolean }> {
    return this.tool!({ tool, args, toolCallId: randomUUID(), usage: { input: 3, output: 2, cost: 0.01, unknown: false } });
  }

  /** A child question through the send_message control tool (as a real child asks). */
  question(text = "q?"): Promise<{ content: string; isError: boolean }> {
    return this.call("send_message", { target: "parent", message: text, mode: "note", request_reply: true });
  }

  decide(d: Record<string, unknown>): Promise<{ content: string; isError: boolean }> {
    return this.call("submit_gate_decision", d);
  }
}

export function mkSup(opts: {
  limits?: Record<string, number>;
  policy?: (p: SupervisorPolicy) => void;
  factory?: WorkerFactory;
  store?: RunStore;
  dir?: string;
  workspace?: WorkspaceManager;
  governor?: () => GovernorContext;
}): { sup: Supervisor; dir: string; workers: CtlWorker[]; byAgent: (agentId: string) => CtlWorker[]; executors: { sandbox: DummyToolExecutor; host: DummyToolExecutor } } {
  const dir = opts.dir ?? mkdtempSync(join(tmpdir(), "subagents-ctl-"));
  const policy = defaultSupervisorPolicy();
  policy.allowedModels = [{ provider: "p", id: "m" }];
  opts.policy?.(policy);
  const workers: CtlWorker[] = [];
  const executors = { sandbox: new DummyToolExecutor(), host: new DummyToolExecutor() };
  const sup = new Supervisor({
    rootId: "root-1",
    governor: opts.governor ?? testGovernor,
    rootDir: dir,
    store: opts.store ?? new InMemoryRunStore("root-1"),
    policy,
    schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 32, maxDepth: 1, ...(opts.limits ?? {}) },
    executors,
    workspace: opts.workspace ?? new DummyWorkspaceManager(),
    workerFactory: opts.factory ?? ((o) => {
      const w = new CtlWorker(o.agentId);
      workers.push(w);
      return w;
    }),
  });
  return { sup, dir, workers, byAgent: (agentId) => workers.filter((w) => w.agentId === agentId), executors };
}

export const tick = (ms = 20): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function gateSpec(maxRounds?: number | null): { model: { provider: string; id: string }; thinkingLevel: string; prompt: string; maxRounds?: number | null } {
  return { model: { provider: "p", id: "m" }, thinkingLevel: "high", prompt: "rubric", ...(maxRounds === undefined ? {} : { maxRounds }) };
}

export const revise = (c: string): Record<string, unknown> => ({
  schemaVersion: 1,
  candidateId: c,
  decision: "revise",
  blockers: [{ id: "F1", target: "x", problem: "p", requiredChange: "r", evidenceRefs: [`${c}:answer`] }],
  advisories: [],
});
export const approve = (c: string): Record<string, unknown> => ({ schemaVersion: 1, candidateId: c, decision: "approve", advisories: [] });
export const blocked = (c: string): Record<string, unknown> => ({ schemaVersion: 1, candidateId: c, decision: "blocked", reason: "r", missingPrerequisites: ["m"] });

export function terminals(sup: Supervisor, taskRunId: string): string[] {
  return sup.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records
    .filter((r) => r.kind === "task.terminal" && r.body["taskRunId"] === taskRunId)
    .map((r) => String(r.body["outcome"]));
}
