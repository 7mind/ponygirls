/**
 * Billing-debt production repairs (real WorkerHandle / public SDK, strict types):
 * - onChange-after-commit: committed usage.reported accounts live+dedupe
 *   exactly once; observer fault stays observable only, no false hold.
 * - Nested NEW native: ctx.executeTool / ctx.tools facade deny with exact
 *   RECOVERY_OWNER_UNCONFIRMED while the root normal-debt hold is active,
 *   even inside an admitted outer; SAMEPATH healthy/post-recovery nested
 *   positives use genuine second OUTER runs (not runCheck stand-ins).
 *
 * Required pinned SDK: absence/invalid fails loudly (no skips).
 * Constructor DI only; no private flags, forged fifth ctx, or fabricated
 * callers. Bare joined cleanup (failures propagate, never swallowed).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { WorkerHandle } from "../src/worker-launch.ts";
import { bindChannel } from "../src/protocol.ts";
import { DummyWorkspaceManager } from "../src/workspace.ts";
import { defaultSupervisorPolicy } from "../src/policy.ts";
import { Supervisor } from "../src/supervisor.ts";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DummyToolExecutor } from "../src/sandbox.ts";
import { InMemoryRunStore, FileRunStore, type JournalRecord, type JournalKind, type RunStore } from "../src/store.ts";
import type { AgentId, TaskRunId } from "../src/types.ts";
import type { GoverningToolResult } from "../src/governing-runtime.ts";
import { CtlWorker } from "./ctl-worker.ts";

const SDK_ROOT = process.env["PI_SUBAGENTS_SDK_ROOT"] ?? null;
const CG = "mcp__codegraph__codegraph_explore";
const OUTER = "mcp__codegraph__outer_probe";
const INNER = "mcp__codegraph__inner_charge";

const EXPECTED_INPUT = 5;
const EXPECTED_OUTPUT = 7;
const OPERATIVE_TIMEOUT_MS = 60000;
const TERMINAL_TIMEOUT_MS = 90000;
const FAULT_POLL_MS = 8000;
const READ_PATH = "hello.txt";
const HOLD_CODE = "RECOVERY_OWNER_UNCONFIRMED";

const tick = (ms = 20): Promise<void> => new Promise((r) => setTimeout(r, ms));

function requireSdkRoot(): string {
  assert.ok(SDK_ROOT, "PI_SUBAGENTS_SDK_ROOT must be set (pinned production SDK 1.2.0)");
  const root: string = SDK_ROOT;
  assert.ok(existsSync(root), `pinned SDK root missing: ${root}`);
  const pkgPath = join(root, "package.json");
  assert.ok(existsSync(pkgPath), `pinned SDK package.json missing: ${pkgPath}`);
  const version = (JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: unknown }).version;
  assert.equal(version, "1.2.0", `pinned SDK must be 1.2.0 (got ${String(version)})`);
  return root;
}

function records(sup: Supervisor): JournalRecord[] {
  return sup.runStore.readSince(0, 100000).records;
}
function strBody(r: JournalRecord, key: string): string | null {
  const v: unknown = r.body[key];
  return typeof v === "string" ? v : null;
}
function extReports(sup: Supervisor, op?: string): JournalRecord[] {
  return records(sup).filter((r) => r.kind === "usage.reported" && r.body["external"] === true && (op === undefined || strBody(r, "operationId") === op));
}
function modelReports(sup: Supervisor, agentId?: AgentId): JournalRecord[] {
  return records(sup).filter((r) => r.kind === "usage.reported" && r.body["external"] !== true && (agentId === undefined || strBody(r, "agentId") === agentId));
}
function sumUsage(recs: JournalRecord[]): { input: number; output: number } {
  const acc = { input: 0, output: 0 };
  for (const r of recs) {
    const input: unknown = r.body["input"];
    const output: unknown = r.body["output"];
    if (typeof input === "number" && Number.isFinite(input)) acc.input += input;
    if (typeof output === "number" && Number.isFinite(output)) acc.output += output;
  }
  return acc;
}
async function operativeOp(sup: Supervisor, taskRunId: TaskRunId, tool: string, timeoutMs: number): Promise<{ op: string; outcome: Record<string, unknown> } | null> {
  const t0 = Date.now();
  let found: { op: string; outcome: Record<string, unknown> } | null = null;
  while (!found && Date.now() - t0 < timeoutMs) {
    const recs = records(sup);
    const intents = recs.filter((r) => r.kind === "tool.intent" && r.body["external"] === true && strBody(r, "tool") === tool && strBody(r, "taskRunId") === taskRunId);
    for (const i of intents) {
      const op = strBody(i, "operationId");
      if (!op) continue;
      const out = recs.find((r) => r.kind === "tool.outcome" && strBody(r, "operationId") === op);
      if (out) {
        found = { op, outcome: out.body };
        break;
      }
    }
    if (!found) {
      const t = recs.find((r) => r.kind === "task.terminal" && strBody(r, "taskRunId") === taskRunId);
      if (t) break;
      await tick(50);
    }
  }
  return found;
}
async function waitTerminal(sup: Supervisor, taskRunId: TaskRunId, timeoutMs: number): Promise<Record<string, unknown> | null> {
  const t0 = Date.now();
  let term: Record<string, unknown> | null = null;
  while (!term && Date.now() - t0 < timeoutMs) {
    term = records(sup).find((r) => r.kind === "task.terminal" && strBody(r, "taskRunId") === taskRunId)?.body ?? null;
    if (!term) await tick(100);
  }
  return term;
}

interface NestedInner { isError: boolean }
interface NestedRead { isError: boolean; content: string }
interface FacadeRead { isError?: boolean; content?: string; error?: string; unavailable?: boolean }
interface NestedCapture {
  ctxSeen: boolean;
  hasExecuteTool: boolean;
  hasTools: boolean;
  inner: NestedInner | null;
  nestedRead: NestedRead | null;
  facadeRead: FacadeRead | null;
}
function clearCapture(c: NestedCapture): void {
  c.ctxSeen = false;
  c.hasExecuteTool = false;
  c.hasTools = false;
  c.inner = null;
  c.nestedRead = null;
  c.facadeRead = null;
}
interface ScopedProbeCtx {
  executeTool: (name: string, args: unknown) => Promise<unknown>;
  tools?: unknown;
}
function isScopedCtx(v: unknown): v is ScopedProbeCtx {
  if (typeof v !== "object" || v === null) return false;
  return typeof (v as { executeTool?: unknown }).executeTool === "function";
}
function outcomeIsError(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const rec = v as Record<string, unknown>;
  if (rec["isError"] === true) return true;
  const res: unknown = rec["result"];
  return typeof res === "object" && res !== null && (res as Record<string, unknown>)["isError"] === true;
}
function outcomeContent(v: unknown): string {
  if (typeof v !== "object" || v === null) return String(v);
  const rec = v as Record<string, unknown>;
  const src: unknown = rec["result"] ?? v;
  if (typeof src !== "object" || src === null) return String(src);
  const content: unknown = (src as Record<string, unknown>)["content"] ?? (src as Record<string, unknown>)["error"] ?? src;
  try {
    return JSON.stringify(content).slice(0, 800);
  } catch {
    return String(content).slice(0, 800);
  }
}
function usageOfOutcome(outcome: Record<string, unknown> | null): { input?: unknown; output?: unknown } | null {
  if (!outcome) return null;
  const usage: unknown = outcome["usage"];
  if (typeof usage !== "object" || usage === null) return null;
  const rec = usage as Record<string, unknown>;
  return { input: rec["input"], output: rec["output"] };
}

const cgUsage = async (): Promise<{ content: Array<{ type: string; text: string }>; details: Record<string, never>; usage: { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number; cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number } } }> => ({
  content: [{ type: "text", text: "x" }],
  details: {},
  usage: { input: EXPECTED_INPUT, output: EXPECTED_OUTPUT, cacheRead: 0, cacheWrite: 0, totalTokens: 12, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
});

function faultableRunStore(base: InMemoryRunStore, st: { armed: boolean; firedAt: string | null }): RunStore {
  return new Proxy(base, {
    get(tgt: RunStore, prop: string | symbol): unknown {
      if (prop === "append") {
        return (kind: JournalKind, body: Record<string, unknown>): JournalRecord => {
          if (st.armed && kind === "usage.reported" && body["external"] === true) {
            st.armed = false;
            const op: unknown = body["operationId"];
            st.firedAt = typeof op === "string" ? op : "?";
            throw Object.assign(new Error("STORE_FAILED: injected crash on inner billing commit"), { code: "STORE_FAILED" });
          }
          return tgt.append(kind, body);
        };
      }
      const value: unknown = Reflect.get(tgt, prop, tgt);
      return typeof value === "function" ? value.bind(tgt) : value;
    },
  });
}

test("billing-debt repair: onChange-after-commit accounts once, no false hold (real worker)", () => {
  const sdkRoot = requireSdkRoot();
  const dir = mkdtempSync(join(tmpdir(), "subagents-billfix-cb-"));
  return (async (): Promise<void> => {
    try {
      writeFileSync(join(dir, "hello.txt"), "hello-model-bytes\n");
      const CG_HANDLE = { name: CG, description: "d", parameters: { type: "object" }, execute: cgUsage };
      const SCRIPT = [{ tool: CG, args: { q: "x" } }, { text: "done" }];
      const base = new InMemoryRunStore("root-billfix-cb");
      const st = { armed: true, firedOp: null as string | null };
      const onChange = (): void => {
        if (!st.armed) return;
        const reps = base.readSince(0, 100000).records.filter((r) => r.kind === "usage.reported" && r.body["external"] === true);
        if (reps.length > 0) {
          st.armed = false;
          st.firedOp = strBody(reps[0], "operationId");
          throw new Error("ONCHANGE_FAILED: injected throw after external billing commit");
        }
      };
      const policy = defaultSupervisorPolicy();
      policy.allowedModels = [{ provider: "p", id: "m" }];
      policy.allowedTools = [CG];
      const executors = { sandbox: new DummyToolExecutor(), host: new DummyToolExecutor() };
      const sup = new Supervisor({
        rootId: "root-billfix-cb",
        rootDir: join(dir, "root"),
        store: base,
        policy,
        governor: () => ({ model: { provider: "p", id: "m", thinkingLevel: "off" }, cwd: dir, instructions: { contextFiles: [], skills: [] } }),
        schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 8, maxDepth: 1 },
        executors,
        workspace: new DummyWorkspaceManager(),
        workerFactory: (o) => {
          const binding = bindChannel(o.rootEpoch, o.agentId, o.instanceId);
          const hostAgentDir = join(dir, "host-agent");
          mkdirSync(hostAgentDir, { recursive: true });
          return new WorkerHandle({
            workerPath: new URL("../src/worker.ts", import.meta.url).pathname,
            rootEpoch: o.rootEpoch, agentId: o.agentId, sdkRoot, deterministic: true,
            agentDir: join(dir, "worker-home", o.agentId), sessionsDir: join(dir, "sessions"), hostAgentDir,
            script: SCRIPT,
          }, binding);
        },
        governingRegistry: () => ({ isActive: () => true, listHandles: () => [CG_HANDLE], getHandle: () => CG_HANDLE, baseCtx: () => ({}) }),
        onChange,
      });
      try {
        const g1 = await sup.spawn("governor", { taskName: "billed", message: "do external work", profile: "writer", isolation: "none" }, "billfix-cb-1");
        const found = await operativeOp(sup, g1.taskRunId, CG, OPERATIVE_TIMEOUT_MS);
        assert.ok(found, "no outcome-backed external CG op");
        const op = found.op;
        const term1 = await waitTerminal(sup, g1.taskRunId, TERMINAL_TIMEOUT_MS);
        assert.equal(term1?.["outcome"], "succeeded");
        assert.ok(st.firedOp !== null, "onChange fault never fired");
        assert.equal(st.firedOp, op, "fault hit the genuine op");
        const reps = extReports(sup, op);
        assert.equal(reps.length, 1, "committed report exists exactly once");
        const canon = usageOfOutcome(records(sup).find((r) => r.kind === "tool.outcome" && strBody(r, "operationId") === op && r.body["external"] === true)?.body ?? null);
        assert.deepEqual({ input: canon?.input, output: canon?.output }, { input: EXPECTED_INPUT, output: EXPECTED_OUTPUT });
        const ctrlErr = records(sup).filter((r) => r.kind === "recovery.event" && strBody(r, "phase") === "controller_error").length;
        assert.ok(ctrlErr >= 1, "observer fault stays observable");
        assert.equal(sup.needsRecovery, false, "no hold for already-committed report");
        const modelSum = sumUsage(modelReports(sup, g1.agentId));
        const live = sup.rootUsage();
        assert.deepEqual({ input: live.inputTokens, output: live.outputTokens }, { input: modelSum.input + EXPECTED_INPUT, output: modelSum.output + EXPECTED_OUTPUT });
        const g2 = await sup.spawn("governor", { taskName: "second", message: "m", profile: "writer", isolation: "none" }, "billfix-cb-2");
        const ok = await sup.runCheck(g2.agentId, g2.taskRunId, { id: "after", command: "true", timeoutMs: 60000 });
        assert.equal(ok.exitCode, 0);
        await sup.recover();
        assert.equal(extReports(sup, op).length, 1, "recover never double-bills committed report");
        assert.equal(sup.needsRecovery, false);
      } finally {
        await sup.shutdown();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })();
});

test("billing-debt repair: nested NEW native denied while INNER debt held (real worker)", () => {
  const sdkRoot = requireSdkRoot();
  const dir = mkdtempSync(join(tmpdir(), "subagents-billfix-nest-"));
  return (async (): Promise<void> => {
    try {
      writeFileSync(join(dir, READ_PATH), "hello-model-bytes\n");
      const cap: NestedCapture = { ctxSeen: false, hasExecuteTool: false, hasTools: false, inner: null, nestedRead: null, facadeRead: null };
      clearCapture(cap);
      const INNER_HANDLE = { name: INNER, description: "inner charged", parameters: { type: "object" }, execute: cgUsage };
      const OUTER_HANDLE = {
        name: OUTER, description: "outer probe", parameters: { type: "object" },
        execute: async (toolCallId: string, params: unknown, signal: AbortSignal | undefined, onUpdate: ((partial: GoverningToolResult) => void) | undefined, ctx: unknown): Promise<{ content: Array<{ type: string; text: string }>; details: Record<string, never>; isError: boolean; usage: null }> => {
          void params;
          void signal;
          void onUpdate;
          cap.ctxSeen = typeof ctx === "object" && ctx !== null;
          cap.hasExecuteTool = isScopedCtx(ctx);
          let toolsArr: unknown = null;
          try {
            toolsArr = cap.ctxSeen ? (ctx as Record<string, unknown>)["tools"] : null;
            cap.hasTools = Array.isArray(toolsArr);
          } catch {
            cap.hasTools = false;
          }
          if (!isScopedCtx(ctx)) return { content: [{ type: "text", text: "outer-no-ctx" }], details: {}, isError: true, usage: null };
          let innerOut: unknown = null;
          try {
            innerOut = await ctx.executeTool(INNER, { q: "inner" });
          } catch (e) {
            innerOut = { isError: true, error: String((e as Error)?.message ?? e).slice(0, 200) };
          }
          cap.inner = { isError: outcomeIsError(innerOut) };
          let nestedOut: unknown = null;
          try {
            nestedOut = await ctx.executeTool("read", { path: READ_PATH });
          } catch (e) {
            nestedOut = { isError: true, error: String((e as Error)?.message ?? e).slice(0, 200) };
          }
          cap.nestedRead = { isError: outcomeIsError(nestedOut), content: outcomeContent(nestedOut) };
          if (cap.hasTools && Array.isArray(toolsArr)) {
            try {
              const readProxy = (toolsArr as Array<Record<string, unknown>>).find((x) => typeof x === "object" && x !== null && (x as Record<string, unknown>)["name"] === "read");
              const execFn: unknown = readProxy ? (readProxy as Record<string, unknown>)["execute"] : undefined;
              if (readProxy && typeof execFn === "function") {
                const fac: unknown = await (execFn as (id: string, args: unknown, sig: undefined, upd: undefined) => Promise<unknown>)(`facade-${toolCallId.slice(0, 8)}`, { path: READ_PATH }, undefined, undefined);
                cap.facadeRead = { isError: outcomeIsError(fac), content: outcomeContent(fac) };
              } else {
                cap.facadeRead = { unavailable: true };
              }
            } catch (e) {
              cap.facadeRead = { isError: true, error: String((e as Error)?.message ?? e).slice(0, 200) };
            }
          } else {
            cap.facadeRead = { unavailable: true };
          }
          return { content: [{ type: "text", text: "outer-done" }], details: {}, isError: false, usage: null };
        },
      };
      const SCRIPT = [{ tool: OUTER, args: { q: "outer" } }, { text: "done" }];
      const base = new InMemoryRunStore("root-billfix-nest");
      const st = { armed: true, firedAt: null as string | null };
      const store = faultableRunStore(base, st);
      const policy = defaultSupervisorPolicy();
      policy.allowedModels = [{ provider: "p", id: "m" }];
      policy.allowedTools = [OUTER, INNER];
      const executors = { sandbox: new DummyToolExecutor(), host: new DummyToolExecutor() };
      const handles = [OUTER_HANDLE, INNER_HANDLE];
      const byName = new Map(handles.map((h) => [h.name, h]));
      const sup = new Supervisor({
        rootId: "root-billfix-nest",
        rootDir: join(dir, "root"),
        store,
        policy,
        governor: () => ({ model: { provider: "p", id: "m", thinkingLevel: "off" }, cwd: dir, instructions: { contextFiles: [], skills: [] } }),
        schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 8, maxDepth: 1 },
        executors,
        workspace: new DummyWorkspaceManager(),
        workerFactory: (o) => {
          const binding = bindChannel(o.rootEpoch, o.agentId, o.instanceId);
          const hostAgentDir = join(dir, "host-agent");
          mkdirSync(hostAgentDir, { recursive: true });
          return new WorkerHandle({
            workerPath: new URL("../src/worker.ts", import.meta.url).pathname,
            rootEpoch: o.rootEpoch, agentId: o.agentId, sdkRoot, deterministic: true,
            agentDir: join(dir, "worker-home", o.agentId), sessionsDir: join(dir, "sessions"), hostAgentDir,
            script: SCRIPT,
          }, binding);
        },
        governingRegistry: () => ({ isActive: () => true, listHandles: () => handles, getHandle: (n: string) => byName.get(n), baseCtx: () => ({}) }),
      });
      try {
        const specsBefore = executors.host.specs.length + executors.sandbox.specs.length;
        const g1 = await sup.spawn("governor", { taskName: "nested", message: "do outer work", profile: "writer", isolation: "none" }, "billfix-nest-1");
        const outer = await operativeOp(sup, g1.taskRunId, OUTER, OPERATIVE_TIMEOUT_MS);
        assert.ok(outer, "no outcome-backed OUTER op");
        assert.ok(cap.ctxSeen && cap.hasExecuteTool, "OUTER never got genuine fifth ctx");
        const innerLinked = records(sup).filter((r) => r.kind === "tool.intent" && strBody(r, "tool") === INNER && strBody(r, "taskRunId") === g1.taskRunId).find((r) => strBody(r, "parentOperationId") === outer.op);
        assert.ok(innerLinked, "INNER nested intent linked to OUTER");
        const innerOp = strBody(innerLinked, "operationId");
        assert.ok(innerOp, "INNER op missing");
        assert.ok(st.firedAt !== null, "INNER billing fault never fired");
        assert.equal(st.firedAt, innerOp);
        const innerOutcome = usageOfOutcome(records(sup).find((r) => r.kind === "tool.outcome" && strBody(r, "operationId") === innerOp)?.body ?? null);
        assert.deepEqual({ input: innerOutcome?.input, output: innerOutcome?.output }, { input: EXPECTED_INPUT, output: EXPECTED_OUTPUT });
        assert.equal(extReports(sup, innerOp).length, 0, "INNER report0");
        assert.equal(sup.needsRecovery, true, "health true after INNER fault");
        const term1 = await waitTerminal(sup, g1.taskRunId, TERMINAL_TIMEOUT_MS);
        // Composite authorized behavior (c5ef dispatcher hold + provider-start
        // hold): nested read denied (dispatcher, proven below) AND provider
        // continuation denied (streamFunction guard) → visible task failure
        // with hold code (NOT transparent parking). Admitted OUTER effect
        // itself completed truthfully exactly once (single outcome below).
        assert.equal(term1?.["outcome"], "failed", "held continuation denies → task fails visibly (provider-start policy)");
        assert.match(String(term1?.["detail"] ?? term1?.["error"] ?? JSON.stringify(term1)), new RegExp(HOLD_CODE), "terminal carries hold code");
        assert.equal(records(sup).filter((r) => r.kind === "tool.outcome" && strBody(r, "operationId") === outer.op).length, 1, "exactly one OUTER outcome");
        assert.equal(cap.nestedRead?.isError, true, "NEW nested native denied while held");
        assert.match(String(cap.nestedRead?.content ?? ""), new RegExp(HOLD_CODE));
        assert.equal(executors.host.specs.length + executors.sandbox.specs.length, specsBefore, "denied nested native left zero handler entries");
        assert.equal(cap.hasTools, true, "ctx.tools facade must be present for exact-hold proof");
        assert.ok(cap.facadeRead && !cap.facadeRead.unavailable, "facade present, must deny");
        assert.equal(cap.facadeRead?.isError, true, "facade denied while held");
        assert.match(String(cap.facadeRead?.content ?? cap.facadeRead?.error ?? ""), new RegExp(HOLD_CODE), "facade exact hold code (STALE/POLICY not equivalent)");
        await assert.rejects(
          () => sup.spawn("governor", { taskName: "direct", message: "m", profile: "writer", isolation: "none" }, "billfix-nest-2"),
          new RegExp(HOLD_CODE),
        );
        await sup.recover();
        assert.equal(extReports(sup, innerOp).length, 1, "recover bills INNER once");
        assert.deepEqual(sumUsage(extReports(sup, innerOp)), { input: EXPECTED_INPUT, output: EXPECTED_OUTPUT });
        assert.equal(sup.needsRecovery, false);
        // SAMEPATH healthy positive: genuine second OUTER run (fault healed),
        // awaited outcome-backed op + terminal (not timing proxy).
        clearCapture(cap);
        const specsBeforeG2 = executors.host.specs.length + executors.sandbox.specs.length;
        const g2 = await sup.spawn("governor", { taskName: "nested2", message: "go", profile: "writer", isolation: "none" }, "billfix-nest-3");
        const outer2 = await operativeOp(sup, g2.taskRunId, OUTER, OPERATIVE_TIMEOUT_MS);
        assert.ok(outer2, "no outcome-backed second OUTER op (same-path positive setup failure)");
        const term2 = await waitTerminal(sup, g2.taskRunId, TERMINAL_TIMEOUT_MS);
        assert.equal(term2?.["outcome"], "succeeded", "second OUTER settles");
        assert.equal(cap.nestedRead?.isError, false, "same-path nested read succeeds after heal");
        assert.ok(cap.facadeRead && !cap.facadeRead.unavailable, "same-path facade present after heal");
        assert.equal(cap.facadeRead?.isError, false, "same-path facade succeeds after heal");
        const nativeIntents2 = records(sup).filter((r) => r.kind === "tool.intent" && strBody(r, "tool") === "read" && strBody(r, "taskRunId") === g2.taskRunId);
        assert.ok(nativeIntents2.length > 0, "exact native intent for task2");
        assert.ok(executors.host.specs.length + executors.sandbox.specs.length > specsBeforeG2, "exact backend entries for task2");
        // Independent NEW-check control (separate; never a nested stand-in).
        const g3 = await sup.spawn("governor", { taskName: "check", message: "m", profile: "writer", isolation: "none" }, "billfix-nest-4");
        const specsBeforeCheck = executors.host.specs.length + executors.sandbox.specs.length;
        const ok = await sup.runCheck(g3.agentId, g3.taskRunId, { id: "after", command: "true", timeoutMs: 60000 });
        assert.equal(ok.exitCode, 0, "NEW check admitted after heal");
        assert.ok(executors.host.specs.length + executors.sandbox.specs.length > specsBeforeCheck, "healed check entered a real backend");
        await sup.recover();
        assert.equal(extReports(sup, innerOp).length, 1, "second recover keeps exactly one billing");
      } finally {
        await sup.shutdown();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })();
});

/**
 * Narrow white-box harness for late-receipt intake controls: a bare
 * supervisor with one CtlWorker agent exposes a true AgentRuntime for
 * direct intakeLateUsage invocation (established glassbox style). No
 * workers boot; no inference runs.
 */
function makeIntakeSup(dir: string, rootId: string, store: RunStore): { sup: Supervisor } {
  const policy = defaultSupervisorPolicy();
  policy.allowedModels = [{ provider: "p", id: "m" }];
  policy.allowedTools = [];
  const sup = new Supervisor({
    rootId,
    rootDir: join(dir, "root"),
    store,
    policy,
    governor: () => ({ model: { provider: "p", id: "m", thinkingLevel: "off" }, cwd: dir, instructions: { contextFiles: [], skills: [] } }),
    schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 8, maxDepth: 1 },
    executors: { sandbox: new DummyToolExecutor(), host: new DummyToolExecutor() },
    workspace: new DummyWorkspaceManager(),
    workerFactory: (o: any) => new CtlWorker(o.agentId),
    governingRegistry: () => ({ isActive: () => true, listHandles: () => [], getHandle: () => undefined, baseCtx: () => ({}) }),
  });
  return { sup };
}

test("late receipt dedupe keys on immutable receipt ID, not the generation triple", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-latededupe-"));
  try {
    const store = new InMemoryRunStore("root-latededupe");
    const { sup } = makeIntakeSup(dir, "root-latededupe", store);
    const g = await sup.spawn("governor", { taskName: "a", message: "m", profile: "writer", isolation: "none" }, "latededupe-1");
    const agents = (sup as unknown as { agents: Map<string, unknown> }).agents;
    const rt = agents.get(g.agentId);
    assert.ok(rt !== undefined, "agent runtime missing (setup failure)");
    const intake = (sup as unknown as { intakeLateUsage: (rt: unknown, detail: unknown) => void }).intakeLateUsage.bind(sup);
    const usage = { input: 26, output: 6, cacheRead: 7, cacheWrite: 8, reasoning: null, cost: 9, unknown: false };
    // Same receipt ID twice: second delivery bills nothing.
    intake(rt, { usage, agentId: g.agentId, taskRunId: g.taskRunId, generation: 1, receiptId: "r-same" });
    intake(rt, { usage, agentId: g.agentId, taskRunId: g.taskRunId, generation: 1, receiptId: "r-same" });
    // Different receipt ID, same triple: distinct invocation, bills again.
    intake(rt, { usage, agentId: g.agentId, taskRunId: g.taskRunId, generation: 1, receiptId: "r-other" });
    const late = store.readSince(0, Number.MAX_SAFE_INTEGER).records.filter((r) => r.kind === "usage.reported" && (r.body as Record<string, unknown>)["late"] === true);
    assert.equal(late.length, 2, "duplicate delivery billed once, distinct IDs billed independently");
    const ids = late.map((r) => (r.body as Record<string, unknown>)["receiptId"]).sort();
    assert.deepEqual(ids, ["r-other", "r-same"], "receipt IDs carried into durable records");
    const sum = sumUsage(late);
    assert.deepEqual(sum, { input: 52, output: 12 }, "totals bill both distinct receipts exactly once");
    await sup.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("failed late commits retain distinct payloads until recovery bills both", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-latefail-"));
  try {
    const base = new InMemoryRunStore("root-latefail");
    // Faultable journal: ALL late usage.reported commits fail until the
    // test heals the store; everything else passes.
    let healed = false;
    const store = new Proxy(base, {
      get(t: any, prop: string | symbol) {
        if (prop === "append") {
          return (kind: string, body: any) => {
            if (!healed && kind === "usage.reported" && body?.late === true) {
              throw Object.assign(new Error("STORE_FAILED: injected crash on late usage commit"), { code: "STORE_FAILED" });
            }
            return t.append(kind, body);
          };
        }
        const v: any = Reflect.get(t, prop, t);
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
    const { sup } = makeIntakeSup(dir, "root-latefail", store as any);
    const g = await sup.spawn("governor", { taskName: "a", message: "m", profile: "writer", isolation: "none" }, "latefail-1");
    const agents = (sup as unknown as { agents: Map<string, unknown> }).agents;
    const rt = agents.get(g.agentId);
    assert.ok(rt !== undefined, "agent runtime missing (setup failure)");
    const intake = (sup as unknown as { intakeLateUsage: (rt: unknown, detail: unknown) => void }).intakeLateUsage.bind(sup);
    const usage = { input: 26, output: 6, cacheRead: 7, cacheWrite: 8, reasoning: null, cost: 9, unknown: false };
    intake(rt, { usage, agentId: g.agentId, taskRunId: g.taskRunId, generation: 1, receiptId: "r-fail-A" });
    intake(rt, { usage, agentId: g.agentId, taskRunId: g.taskRunId, generation: 1, receiptId: "r-fail-B" });
    // Both obligations retained under their own IDs (no overwrite), debt held.
    const pending = (sup as unknown as { pendingLateBilling: Map<string, unknown> }).pendingLateBilling;
    assert.deepEqual([...pending.keys()].sort(), ["r-fail-A", "r-fail-B"], "distinct failures retained distinctly");
    assert.equal(sup.needsRecovery, true, "failed late commits hold admission");
    assert.equal(base.readSince(0, Number.MAX_SAFE_INTEGER).records.filter((r) => r.kind === "usage.reported" && (r.body as Record<string, unknown>)["late"] === true).length, 0, "failed commits left no durable receipt");
    await assert.rejects(
      sup.spawn("governor", { taskName: "blocked", message: "m", profile: "writer", isolation: "none" }, "latefail-blocked"),
      /RECOVERY_OWNER_UNCONFIRMED/,
      "new admission denied while late billing uncommitted",
    );
    // Heal and recover: both bill exactly once, hold clears.
    healed = true;
    await sup.recover();
    const late = base.readSince(0, Number.MAX_SAFE_INTEGER).records.filter((r) => r.kind === "usage.reported" && (r.body as Record<string, unknown>)["late"] === true);
    assert.equal(late.length, 2, "recovery billed both retained receipts exactly once");
    assert.deepEqual(late.map((r) => (r.body as Record<string, unknown>)["receiptId"]).sort(), ["r-fail-A", "r-fail-B"], "receipt IDs carried into durable records");
    assert.equal(sumUsage(late).input, 52, "recovered totals bill both payloads once each");
    assert.equal(sup.needsRecovery, false, "health clears after billed reconciliation");
    await sup.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("restart replays committed late receipts without loss or duplication", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-latereplay-"));
  const rootDir = join(dir, "root");
  const sid = "root-latereplay";
  try {
    const mk = () => {
      const store = new FileRunStore(rootDir, sid);
      return makeIntakeSup(dir, sid, store as any);
    };
    const first = mk();
    const g = await first.sup.spawn("governor", { taskName: "a", message: "m", profile: "writer", isolation: "none" }, "latereplay-1");
    const agents = (first.sup as unknown as { agents: Map<string, unknown> }).agents;
    const rt = agents.get(g.agentId);
    assert.ok(rt !== undefined, "agent runtime missing (setup failure)");
    const intake = (first.sup as unknown as { intakeLateUsage: (rt: unknown, detail: unknown) => void }).intakeLateUsage.bind(first.sup);
    const usage = { input: 26, output: 6, cacheRead: 7, cacheWrite: 8, reasoning: null, cost: 9, unknown: false };
    intake(rt, { usage, agentId: g.agentId, taskRunId: g.taskRunId, generation: 1, receiptId: "r-replay-A" });
    intake(rt, { usage, agentId: g.agentId, taskRunId: g.taskRunId, generation: 1, receiptId: "r-replay-B" });
    await first.sup.shutdown();
    // Reopen on the same durable store: replay rebuilds both late receipts
    // exactly once (no loss, no duplication across the restart).
    const second = mk();
    try {
      const live = second.sup.rootUsage();
      assert.equal(live.inputTokens, 52, "replay holds both late payloads exactly once");
      assert.equal(live.outputTokens, 12, "replay output totals hold");
      const recs = new FileRunStore(rootDir, sid).readSince(0, Number.MAX_SAFE_INTEGER).records;
      assert.equal(recs.filter((r) => r.kind === "usage.reported" && (r.body as Record<string, unknown>)["late"] === true).length, 2, "durable late records preserved across restart");
    } finally {
      await second.sup.shutdown();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
