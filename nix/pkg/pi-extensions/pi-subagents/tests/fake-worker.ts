/**
 * Shared fake worker for supervisor contract tests. Implements WorkerPort
 * with scripted behaviors; proves scheduling/control logic without models.
 * At least one real-SDK test (sdk-worker.test.ts) proves the fake agrees
 * with the actual pi adapter on the event contract.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolExecutors } from "../src/broker.ts";
import type { ToolExecutor } from "../src/sandbox.ts";
import type { GovernorContext, WorkerPort } from "../src/supervisor.ts";
import type { InstructionSet } from "../src/types.ts";
import type { WorkerEvent } from "../src/protocol.ts";
import type { ToolRequest } from "../src/worker-launch.ts";

/** The governing model top-level test children inherit. */
export const TEST_MODEL = { provider: "test", id: "model", thinkingLevel: "off" };
/** The governing session's working directory (host-isolated test children start here). */
export const TEST_GOVERNOR_CWD = mkdtempSync(join(tmpdir(), "subagents-governor-"));
/** What the governing test session "loaded": one context file and two skills. */
export const TEST_INSTRUCTIONS: InstructionSet = {
  contextFiles: [{ path: "/proj/AGENTS.md", content: "Answer tersely." }],
  skills: [
    { name: "deploy", description: "Deploy things", filePath: "/skills/deploy/SKILL.md", baseDir: "/skills/deploy", disableModelInvocation: false },
    { name: "review", description: "Review things", filePath: "/skills/review/SKILL.md", baseDir: "/skills/review", disableModelInvocation: false },
  ],
};
export const testGovernor = (): GovernorContext => ({ model: TEST_MODEL, cwd: TEST_GOVERNOR_CWD, instructions: TEST_INSTRUCTIONS });

/** One executor for both execution modes (tests assert on the recorded specs). */
export function bothExecutors(executor: ToolExecutor): ToolExecutors {
  return { sandbox: executor, host: executor };
}

export type FakeScript =
  | "settle-text" // started, preview, settled/succeeded
  | "hang" // started, never settles
  | "fail" // started, settled/failed
  | "question-then-settle" // question to parent, then settle on reply note
  | "tool-then-settle" // one tool.execute call, then settle
  | "gate" // reviewer: extract candidate id from prompt, submit decision, settle
  | "gate-manual"; // reviewer: waits for submitManual() (deterministic races)

export class FakeWorker implements WorkerPort {
  readonly instanceId = randomUUID();
  delivered: Array<{ mode: string; text: string; messageId: string }> = [];
  toolCalls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  killed = false;
  launchCount = 0;
  private emit: ((event: WorkerEvent) => void) | null = null;
  /** Message IDs present in the fake's restored branch (no reinsert). */
  branchEntries = new Set<string>();
  /** When true, checkpoint requests fail (receipts never verify). */
  failCheckpoint = false;
  /** When true, task/repair delivers answer with an application rejection. */
  rejectDeliverTask = false;
  private onExit: ((info: { code: number | null; signal: string | null }) => void) | null = null;
  private answerTool: ((payload: ToolRequest) => Promise<{ content: string; isError: boolean }>) | null = null;
  private taskRunId: string | null = null;
  private generation: number | null = null;
  private settledFor = new Set<string>();

  private script: FakeScript;
  private settleText: string;
  constructor(script: FakeScript = "settle-text", settleText = "fake result") {
    this.script = script;
    this.settleText = settleText;
  }

  /** Simulated OS pid for recovery ownership tests (null = no process). */
  fakePid: number | null = null;

  get pid(): number | null {
    return this.fakePid;
  }

  /** Reviewer decision builder for the "gate" script. Receives the candidate id parsed from the review prompt. */
  decisionFor: (candidateId: string) => Record<string, unknown> = (candidateId) => ({
    schemaVersion: 1,
    candidateId,
    decision: "approve",
    advisories: [],
  });

  private manualText: string | null = null;

  /** Drive a gate-manual reviewer: submit its decision, then settle. */
  async submitManual(): Promise<void> {
    const text = this.manualText;
    if (!text) throw new Error("no review prompt received yet");
    const match = text.match(/Candidate (candidate-\d+)/);
    const candidateId = match?.[1] ?? "candidate-1";
    await this.answerTool?.({ tool: "submit_gate_decision", args: this.decisionFor(candidateId), toolCallId: "tc-gate", usage: null });
    this.emitSettled(this.taskRunId ?? "task-fake", this.generation ?? 1, "succeeded", "review submitted");
  }

  setEventHandler(h: (event: WorkerEvent) => void): void {
    this.emit = h;
  }

  setToolRequestHandler(h: (payload: ToolRequest) => Promise<{ content: string; isError: boolean }>): void {
    this.answerTool = h;
  }

  setExitHandler(h: (info: { code: number | null; signal: string | null }) => void): void {
    this.onExit = h;
  }

  /** Simulate an abrupt worker process exit (no settled event). */
  crash(): void {
    this.killed = true;
    this.onExit?.({ code: null, signal: "SIGKILL" });
  }

  async launch(): Promise<void> {
    this.launchCount++;
  }

  async request(operation: string, payload: unknown, opts?: { taskRunId?: string; generation?: number }): Promise<unknown> {
    if (this.killed) throw new Error("worker killed");
    const p = (payload ?? {}) as Record<string, unknown>;
    if (operation === "initialize") {
      this.taskRunId = (p["taskRunId"] as string) ?? opts?.taskRunId ?? "task-fake";
      this.generation = (p["executionGeneration"] as number) ?? 1;
      this.schedule(this.taskRunId, this.generation, String(p["taskText"] ?? ""));
      return { ok: true, sessionId: `sess-${this.instanceId.slice(0, 8)}` };
    }
    if (operation === "deliver") {
      const mode = String(p["mode"] ?? "");
      this.delivered.push({ mode, text: String(p["text"] ?? ""), messageId: String(p["messageId"] ?? "") });
      const taskRunId = opts?.taskRunId ?? this.taskRunId ?? "task-fake";
      const generation = opts?.generation ?? this.generation ?? 1;
      if (mode === "note" && this.script === "question-then-settle") {
        // A reply note satisfies the parked question: settle now.
        queueMicrotask(() => this.emitSettled(taskRunId, generation, "succeeded", "answered result"));
        return { ok: true, inserted: true };
      }
      if ((mode === "task" || mode === "repair") && this.rejectDeliverTask) {
        return { ok: false, code: "CONFLICT", message: "worker busy" };
      }
      if (mode === "task" || mode === "repair") {
        this.taskRunId = taskRunId;
        this.generation = generation;
        this.schedule(taskRunId, generation, String(p["text"] ?? ""));
        return { ok: true, generation };
      }
      return { ok: true, inserted: true };
    }
    if (operation === "interrupt") {
      const taskRunId = opts?.taskRunId ?? this.taskRunId ?? "task-fake";
      const generation = opts?.generation ?? this.generation ?? 1;
      queueMicrotask(() => this.emitSettled(taskRunId, generation, "interrupted", ""));
      return { ok: true };
    }
    if (operation === "checkpoint") {
      if (this.failCheckpoint) throw new Error("checkpoint failed");
      // No session file: real-worker tests cover checkpoint bytes.
      return { ok: true, materialized: false, leafEntryId: `leaf-${this.instanceId.slice(0, 8)}` };
    }
    if (operation === "find_entry") {
      const messageId = String((p["messageId"] as string) ?? "");
      // Models the restored active branch: entries recorded here count as
      // present (even if compacted out of model context) and are not
      // reinserted. Same message ID preserved either way.
      if (this.branchEntries.has(messageId)) {
        return { ok: true, found: true, entryId: `entry-${messageId.slice(0, 8)}` };
      }
      return { ok: true, found: false, entryId: null };
    }
    throw new Error(`unknown op ${operation}`);
  }

  kill(): void {
    this.killed = true;
  }

  private schedule(taskRunId: string, generation: number, _text: string): void {
    const key = `${taskRunId}:${generation}`;
    if (this.settledFor.has(key)) return;
    this.settledFor.add(key);
    queueMicrotask(() => {
      if (this.killed) return;
      this.fire({ kind: "started", taskRunId, executionGeneration: generation, detail: {} });
      if (this.script === "hang") return;
      if (this.script === "fail") {
        queueMicrotask(() => this.emitSettled(taskRunId, generation, "failed", "boom"));
        return;
      }
      if (this.script === "question-then-settle") {
        // A real child asks through its send_message control tool.
        queueMicrotask(() => {
          void this.answerTool?.({ tool: "send_message", args: { target: "parent", message: "need parent input", mode: "note", request_reply: true }, toolCallId: "tc-q", usage: null });
        });
        return;
      }
      if (this.script === "gate") {
        queueMicrotask(async () => {
          if (this.killed) return;
          const match = _text.match(/Candidate (candidate-\d+)/);
          const candidateId = match?.[1] ?? "candidate-1";
          await this.answerTool?.({ tool: "submit_gate_decision", args: this.decisionFor(candidateId), toolCallId: "tc-gate", usage: null });
          this.emitSettled(taskRunId, generation, "succeeded", "review submitted");
        });
        return;
      }
      if (this.script === "gate-manual") {
        this.manualText = _text;
        return;
      }
      if (this.script === "tool-then-settle") {
        queueMicrotask(async () => {
          if (this.killed) return;
          this.toolCalls.push({ tool: "read", args: { path: "." } });
          await this.answerTool?.({ tool: "read", args: { path: "." }, toolCallId: "tc-1", usage: null });
          this.emitSettled(taskRunId, generation, "succeeded", this.settleText);
        });
        return;
      }
      queueMicrotask(() => {
        this.fire({ kind: "preview", taskRunId, executionGeneration: generation, detail: { text: this.settleText } });
        this.emitSettled(taskRunId, generation, "succeeded", this.settleText);
      });
    });
  }

  private emitSettled(taskRunId: string, generation: number, status: string, text: string): void {
    if (this.killed && status !== "interrupted") return;
    this.fire({ kind: "settled", taskRunId, executionGeneration: generation, detail: { status, lastAssistantText: text } });
  }

  private fire(event: WorkerEvent): void {
    this.emit?.(event);
  }
}

/** Wait until a predicate holds (poll); rejects on timeout. */
export async function until(fn: () => boolean, timeoutMs = 5000, what = "condition"): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}
