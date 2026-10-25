import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkerHandle } from "../src/worker-launch.ts";
import { bindChannel } from "../src/protocol.ts";
import { Supervisor } from "../src/supervisor.ts";
import { InMemoryRunStore } from "../src/store.ts";
import { DummyToolExecutor } from "../src/sandbox.ts";
import { DummyWorkspaceManager } from "../src/workspace.ts";
import { defaultSupervisorPolicy } from "../src/policy.ts";

const SDK_ROOT: string | null = process.env["PI_SUBAGENTS_SDK_ROOT"] ?? null;
const CG = "mcp__codegraph__codegraph_explore";
const PROBE_PATH = new URL("./fixtures/prepare-receiver-worker.ts", import.meta.url).pathname;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Receipt = {
  at: number;
  requestId: string | null;
  rootEpoch: string | null;
  agentId: string | null;
  workerInstanceId: string | null;
  taskRunId: string | null;
  executionGeneration: number | null;
  ok: boolean | null;
  ticket: string | null;
  preparedArgs: unknown;
  error: string | null;
};

function readReceipts(file: string): Receipt[] {
  if (!existsSync(file)) return [];
  const text = readFileSync(file, "utf8");
  const out: Receipt[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    out.push(JSON.parse(line) as Receipt);
  }
  return out;
}

async function waitForReceipt(file: string, match: (r: Receipt) => boolean, timeoutMs: number): Promise<Receipt> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = readReceipts(file).find(match);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`prepare receipt never arrived (saw ${readReceipts(file).length} lines)`);
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    let names: string[];
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const name of names) {
      const full = join(d, name);
      try {
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
      } catch {
        // file
      }
      out.push(full);
    }
  };
  walk(dir);
  return out;
}

type SessionRecord = {
  type?: unknown;
  message?: {
    role?: unknown;
    content?: unknown;
    toolCallId?: unknown;
    toolName?: unknown;
    isError?: unknown;
    usage?: unknown;
  };
};

function loadRecords(sessionsDir: string): SessionRecord[] {
  const out: SessionRecord[] = [];
  for (const f of walkFiles(sessionsDir)) {
    let text = "";
    try {
      text = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line) continue;
      try {
        out.push(JSON.parse(line) as SessionRecord);
      } catch {
        // ignore
      }
    }
  }
  return out;
}

async function waitTerminal(sup: Supervisor, taskRunId: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const recs = sup.runStore.readSince(0, 100000).records;
    if (recs.some((r) => r.kind === "task.terminal" && (r.body as Record<string, unknown>)["taskRunId"] === taskRunId)) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`terminal never arrived for ${taskRunId}`);
}

async function waitForTimeoutToolResult(
  sessionsDir: string,
  toolName: string,
  timeoutMs: number,
): Promise<{ toolCallId: string; content: string; at: number }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const records = loadRecords(sessionsDir);
    const calls = new Map<string, { name: string }>();
    for (const r of records) {
      if (r.type !== "message") continue;
      const msg = r.message as { role?: unknown; content?: unknown } | undefined;
      if (!msg || msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
      for (const c of msg.content as Array<{ type?: unknown; id?: unknown; name?: unknown }>) {
        if (c.type === "toolCall" && typeof c.id === "string" && typeof c.name === "string") {
          calls.set(c.id, { name: c.name });
        }
      }
    }
    for (const r of records) {
      if (r.type !== "message") continue;
      const msg = r.message as { role?: unknown; toolCallId?: unknown; toolName?: unknown; content?: unknown; isError?: unknown } | undefined;
      if (!msg || msg.role !== "toolResult") continue;
      if (typeof msg.toolCallId !== "string" || msg.toolName !== toolName || msg.isError !== true) continue;
      if (!calls.has(msg.toolCallId)) continue;
      const text = Array.isArray(msg.content)
        ? (msg.content as Array<{ text?: unknown }>).map((b) => String(b.text ?? "")).join("\n")
        : String(msg.content ?? "");
      if (text.includes(`tool ${toolName} preparation timed out`)) {
        return { toolCallId: msg.toolCallId, content: text, at: Date.now() };
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`genuine preparation TIMEOUT toolResult never appeared for ${toolName}`);
}

test("prepare timeout true receiver: gated positive RX strictly after parsed SDK timeout", async (t) => {
  assert.ok(SDK_ROOT, "PI_SUBAGENTS_SDK_ROOT must be set to pinned SDK; invalid setup fails");
  const sdkRoot = SDK_ROOT as string;
  const state = {
    prepareCalls: 0,
    effects: 0,
    entries: [] as number[],
    live: [] as Array<{
      requestId: string | null;
      executionGeneration: number | null;
      taskRunId: string | null;
      agentId: string | null;
      rootEpoch: string | null;
      workerInstanceId: string | null;
      toolCallId: string | null;
    }>,
    first: true,
  };
  const bindBox: { current: { rootEpoch: string; agentId: string; instanceId: string } | null } = { current: null };
  const handleBox: { current: WorkerHandle | null } = { current: null };
  const gateBox: { release: (() => void) | null; promise: Promise<void> } = (() => {
    let release: (() => void) | null = null;
    const promise = new Promise<void>((r) => {
      release = r;
    });
    return { release, promise };
  })();

  const parent = {
    name: CG,
    description: "d",
    parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
    prepareArguments: ((a: unknown) => {
      state.prepareCalls++;
      state.entries.push(Date.now());
      return a;
    }) as never,
    execute: (async () => {
      state.effects++;
      return { content: [{ type: "text", text: "must-not-run" }], details: {} };
    }) as never,
  };

  const dir = mkdtempSync(join(tmpdir(), "subagents-true-rx-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const receiptFile = join(dir, "receipts", "prepare.jsonl");

  const sup = new Supervisor({
    rootId: "root-true-rx",
    rootDir: join(dir, "root"),
    store: new InMemoryRunStore("root-true-rx"),
    policy: (() => {
      const p = defaultSupervisorPolicy();
      p.allowedModels = [{ provider: "p", id: "m" }];
      p.allowedTools = [CG];
      return p;
    })(),
    governor: () => ({ model: { provider: "p", id: "m", thinkingLevel: "off" }, cwd: dir, instructions: { contextFiles: [], skills: [] } }),
    schedulerLimits: { maxRunnable: 2, maxResidentWorkers: 4, maxOpenAgents: 8, maxDepth: 1 },
    executors: { sandbox: new DummyToolExecutor(), host: new DummyToolExecutor() },
    workspace: new DummyWorkspaceManager(),
    workerFactory: (o) => {
      const binding = bindChannel(o.rootEpoch, o.agentId, o.instanceId);
      bindBox.current = { rootEpoch: o.rootEpoch, agentId: o.agentId, instanceId: o.instanceId };
      const hostAgentDir = join(dir, "host-agent");
      mkdirSync(hostAgentDir, { recursive: true });
      writeFileSync(join(hostAgentDir, "auth.json"), JSON.stringify({}));
      const handle = new WorkerHandle(
        {
          workerPath: PROBE_PATH,
          rootEpoch: o.rootEpoch,
          agentId: o.agentId,
          sdkRoot,
          deterministic: true,
          agentDir: join(dir, "worker-home", o.agentId),
          sessionsDir: join(dir, "sessions"),
          hostAgentDir,
          script: [
            { tool: CG, args: { q: "slow" } },
            { text: "first done" },
            { tool: CG, args: { q: "fast-second" } },
            { text: "second done" },
          ],
          extraEnv: { PI_SUBAGENTS_RECEIPT_FILE: receiptFile },
        },
        binding,
      );
      handleBox.current = handle;
      const origSetPrepare = handle.setPrepareRequestHandler.bind(handle);
      handle.setPrepareRequestHandler = ((h: (payload: unknown, env: unknown) => Promise<unknown>) => {
        return origSetPrepare((async (payload: unknown, env: unknown) => {
          const envRec = env as Record<string, unknown> | undefined;
          const payRec = payload as Record<string, unknown> | undefined;
          const live = {
            requestId: typeof envRec?.["requestId"] === "string" ? (envRec["requestId"] as string) : null,
            executionGeneration:
              typeof envRec?.["executionGeneration"] === "number" ? (envRec["executionGeneration"] as number) : null,
            taskRunId: typeof envRec?.["taskRunId"] === "string" ? (envRec["taskRunId"] as string) : null,
            agentId: typeof envRec?.["agentId"] === "string" ? (envRec["agentId"] as string) : null,
            rootEpoch: typeof envRec?.["rootEpoch"] === "string" ? (envRec["rootEpoch"] as string) : null,
            workerInstanceId:
              typeof envRec?.["workerInstanceId"] === "string" ? (envRec["workerInstanceId"] as string) : null,
            toolCallId: typeof payRec?.["toolCallId"] === "string" ? (payRec["toolCallId"] as string) : null,
          };
          state.live.push(live);
          const isFirst = state.first;
          state.first = false;
          const res = await h(payload, env);
          if (isFirst) {
            await gateBox.promise;
          }
          return res;
        }) as never);
      }) as typeof handle.setPrepareRequestHandler;
      return handle;
    },
    governingRegistry: () => ({ isActive: () => true, listHandles: () => [parent as never], getHandle: () => parent as never, baseCtx: () => ({}) }),
  });
  t.after(() => sup.shutdown());

  const g = await sup.spawn("governor", { taskName: "true-rx", message: "go", profile: "reader" }, `true-rx-${Date.now()}`);
  const entryStart = Date.now();
  while (state.entries.length < 1 && Date.now() - entryStart < 20000) {
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(state.entries.length === 1, "genuine sync handler entry never observed");
  assert.equal(state.prepareCalls, 1, "parent prepare must enter exactly once");
  const live0 = state.live[0];
  assert.ok(live0, "live prepared request context missing");
  assert.ok(typeof live0.requestId === "string" && live0.requestId.length > 0, "live requestId missing");
  assert.equal(live0.taskRunId, g.taskRunId, "live taskRunId must match spawned task");
  assert.equal(live0.agentId, g.agentId, "live agentId must match spawned agent");
  assert.equal(live0.executionGeneration, g.generation, "live executionGeneration must match spawned generation");

  const timeoutHit = await waitForTimeoutToolResult(join(dir, "sessions"), CG, 20000);
  const timeoutObservedAt = timeoutHit.at;
  assert.ok(timeoutHit.toolCallId.length > 0, "timeout toolCallId missing");
  assert.equal(timeoutHit.toolCallId, live0.toolCallId, "parsed timeout must link to LIVE captured toolCallId");
  assert.ok(timeoutHit.content.includes(`tool ${CG} preparation timed out`), "timeout content mismatch");

  const handle = handleBox.current;
  assert.ok(handle, "actual WorkerHandle missing for public checkpoint API");
  type CheckpointReply =
    | { ok: true; materialized: true; sessionFile: string }
    | { ok: true; materialized: false }
    | { ok: false; code: string; message: string };
  const CHECKPOINT_SETTLE_TIMEOUT_MS = 20000;
  const CHECKPOINT_SETTLE_POLL_MS = 200;
  const requestCheckpoint = (): Promise<CheckpointReply> =>
    handle.request("checkpoint", {}, { taskRunId: g.taskRunId, generation: g.generation, timeoutMs: 15000 }) as Promise<CheckpointReply>;
  let cp: CheckpointReply = await requestCheckpoint();
  let conflicts = 0;
  const settleStart = Date.now();
  while (cp.ok === false && cp.code === "CONFLICT") {
    assert.ok(
      Date.now() - settleStart < CHECKPOINT_SETTLE_TIMEOUT_MS,
      `checkpoint still streaming at settled-boundary deadline (conflicts=${conflicts}, last=${JSON.stringify(cp)})`,
    );
    conflicts++;
    await new Promise((r) => setTimeout(r, CHECKPOINT_SETTLE_POLL_MS));
    cp = await requestCheckpoint();
  }
  if (conflicts > 0) t.diagnostic(`checkpoint settled after ${conflicts} CONFLICT retries`);
  if (cp.ok !== true) {
    assert.fail(`checkpoint failed before settled boundary (conflicts=${conflicts}, last=${JSON.stringify(cp)})`);
  }
  assert.equal(cp.materialized, true, `public checkpoint must materialize after genuine timeout (conflicts=${conflicts}, got=${JSON.stringify(cp)})`);
  if (cp.materialized !== true) {
    assert.fail(`checkpoint unmaterialized after settled boundary (conflicts=${conflicts}, last=${JSON.stringify(cp)})`);
  }
  assert.ok(typeof cp.sessionFile === "string" && cp.sessionFile.length > 0, "checkpoint sessionFile missing");

  const preReleaseMatches = readReceipts(receiptFile).filter((r) => r.requestId === live0.requestId);
  assert.equal(preReleaseMatches.length, 0, `causal gate: no matching RX trace before release while timeout+checkpoint resolved (found ${preReleaseMatches.length})`);

  const releaseAt = Date.now();
  const rel = gateBox.release;
  assert.ok(rel, "transport gate release missing");
  rel();

  const rx = await waitForReceipt(receiptFile, (r) => r.ok === true && r.requestId === live0.requestId, 20000);
  assert.ok(rx.at >= timeoutObservedAt, `diag walltime non-descending (same ms bucket allowed with gate+absence): rx=${rx.at} timeoutObserved=${timeoutObservedAt}`);
  assert.ok(rx.at >= releaseAt, `diag walltime non-descending after release: rx=${rx.at} rel=${releaseAt}`);
  assert.equal(rx.rootEpoch, live0.rootEpoch, "RX rootEpoch must match live");
  assert.equal(rx.agentId, live0.agentId, "RX agentId must match live");
  assert.equal(rx.workerInstanceId, live0.workerInstanceId, "RX workerInstanceId must match live");
  assert.equal(rx.taskRunId, live0.taskRunId, "RX taskRunId must match live");
  assert.equal(rx.executionGeneration, live0.executionGeneration, "RX executionGeneration must match live callerGeneration");
  assert.deepEqual(rx.preparedArgs, { q: "slow" }, "preparedArgs mismatch");
  assert.ok(typeof rx.ticket === "string" && UUID_RE.test(rx.ticket), `RX ticket must be UUID, got ${String(rx.ticket)}`);

  await new Promise((r) => setTimeout(r, 1000));
  const leftover = [...(sup as unknown as { preparedTickets: Map<string, { agentId: string }> }).preparedTickets.values()].filter(
    (tk) => tk.agentId === g.agentId,
  );
  assert.equal(leftover.length, 0, `tickets remain after RX: ${leftover.length}`);
  const terminals = sup.runStore.readSince(0, 100000).records.filter(
    (r) => r.kind === "task.terminal" && (r.body as Record<string, unknown>)["taskRunId"] === g.taskRunId,
  );
  assert.equal(terminals.length, 1, `original task must have exactly 1 terminal after RX, got ${terminals.length}`);
  const execIntents = sup.runStore.readSince(0, 100000).records.filter(
    (r) =>
      r.kind === "tool.intent" &&
      (r.body as Record<string, unknown>)["tool"] === CG &&
      (r.body as Record<string, unknown>)["prepareOnly"] !== true &&
      (r.body as Record<string, unknown>)["taskRunId"] === g.taskRunId,
  );
  assert.equal(execIntents.length, 0, `must have 0 exec intents after RX, got ${execIntents.length}`);
  assert.equal(state.effects, 0, "must have 0 effects after RX");
  assert.equal(state.prepareCalls, 1, "must have 1 prepare after RX");

  const { randomUUID: uuid } = await import("node:crypto");
  const second = await sup.sendMessage("governor", g.agentId, "task", "second valid work", {}, uuid());
  const secondId = second.taskRunId as string;
  assert.ok(typeof secondId === "string" && secondId.length > 0, "second task missing taskRunId");
  await waitTerminal(sup, secondId, 20000);
  const live1 = state.live.find((l) => l.taskRunId === secondId);
  assert.ok(live1, "live context for followup missing");
  assert.ok(typeof live1.requestId === "string" && live1.requestId.length > 0, "followup live requestId missing");
  const rx2 = await waitForReceipt(receiptFile, (r) => r.ok === true && r.requestId === live1.requestId, 20000);
  assert.equal(rx2.workerInstanceId, rx.workerInstanceId, "followup must verify SAME workerInstanceId as first RX (resident lease)");
  assert.equal(rx2.executionGeneration, live1.executionGeneration, "followup RX generation must match its callerGeneration");
  assert.deepEqual(rx2.preparedArgs, { q: "fast-second" }, "followup preparedArgs mismatch");
  assert.ok(typeof rx2.ticket === "string" && UUID_RE.test(rx2.ticket), "followup ticket must be UUID");
  const secondTerms = sup.runStore.readSince(0, 100000).records.filter(
    (r) => r.kind === "task.terminal" && (r.body as Record<string, unknown>)["taskRunId"] === secondId,
  );
  assert.equal(secondTerms.length, 1, "followup must have 1 terminal");
  assert.equal((secondTerms[0].body as Record<string, unknown>)["outcome"], "succeeded", "followup must succeed");
  assert.equal(state.prepareCalls, 2, "followup must prepare once");
  assert.equal(state.effects, 1, "followup must execute once");
});

test("prepare interrupt while awaiting RPC: exact positive ACK, single interrupted, late UUID RX, rechecked cleanup", async (t) => {
  assert.ok(SDK_ROOT, "PI_SUBAGENTS_SDK_ROOT must be set to pinned SDK; invalid setup fails");
  const sdkRoot = SDK_ROOT as string;
  const state = { prepareCalls: 0, effects: 0, live: [] as Array<{ requestId: string | null; executionGeneration: number | null; taskRunId: string | null; agentId: string | null; rootEpoch: string | null; workerInstanceId: string | null }> };
  const seenParams: unknown[] = [];
  const entryBox: { at: number | null } = { at: null };
  const releaseBox: { fn: null | (() => void) } = { fn: null };
  const transportGate = new Promise<void>((r) => {
    releaseBox.fn = r;
  });
  const ackBox: { list: unknown[] } = { list: [] };
  const handleBox: { current: WorkerHandle | null } = { current: null };
  const bindBox: { current: { rootEpoch: string; agentId: string; instanceId: string } | null } = { current: null };

  const schema = { type: "object", properties: { q: { type: "string" }, n: { type: "number" } }, required: ["q", "n"] };
  const parent = {
    name: CG,
    description: "d",
    parameters: schema,
    prepareArguments: ((a: unknown) => {
      state.prepareCalls++;
      entryBox.at = Date.now();
      return a;
    }) as never,
    execute: (async (_id: string, params: unknown) => {
      state.effects++;
      seenParams.push(params);
      return { content: [{ type: "text", text: "must-not-run-interrupted" }], details: {} };
    }) as never,
  };

  const dir = mkdtempSync(join(tmpdir(), "subagents-prep-int-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const receiptFile = join(dir, "receipts", "prepare-int.jsonl");

  const sup = new Supervisor({
    rootId: "root-prep-int",
    rootDir: join(dir, "root"),
    store: new InMemoryRunStore("root-prep-int"),
    policy: (() => {
      const p = defaultSupervisorPolicy();
      p.allowedModels = [{ provider: "p", id: "m" }];
      p.allowedTools = [CG];
      return p;
    })(),
    governor: () => ({ model: { provider: "p", id: "m", thinkingLevel: "off" }, cwd: dir, instructions: { contextFiles: [], skills: [] } }),
    schedulerLimits: { maxRunnable: 2, maxResidentWorkers: 4, maxOpenAgents: 8, maxDepth: 1 },
    executors: { sandbox: new DummyToolExecutor(), host: new DummyToolExecutor() },
    workspace: new DummyWorkspaceManager(),
    workerFactory: (o) => {
      const binding = bindChannel(o.rootEpoch, o.agentId, o.instanceId);
      bindBox.current = { rootEpoch: o.rootEpoch, agentId: o.agentId, instanceId: o.instanceId };
      const hostAgentDir = join(dir, "host-agent");
      mkdirSync(hostAgentDir, { recursive: true });
      writeFileSync(join(hostAgentDir, "auth.json"), JSON.stringify({}));
      const handle = new WorkerHandle(
        {
          workerPath: PROBE_PATH,
          rootEpoch: o.rootEpoch,
          agentId: o.agentId,
          sdkRoot,
          deterministic: true,
          agentDir: join(dir, "worker-home", o.agentId),
          sessionsDir: join(dir, "sessions"),
          hostAgentDir,
          script: [
            { tool: CG, args: { q: "held", n: null } },
            { tool: CG, args: { q: "after", n: null } },
            { text: "after done" },
          ],
          extraEnv: { PI_SUBAGENTS_RECEIPT_FILE: receiptFile },
        },
        binding,
      );
      handleBox.current = handle;
      const origRequest = handle.request.bind(handle);
      (handle as unknown as { request: typeof origRequest }).request = (async (
        op: string,
        payload: unknown,
        opts?: { taskRunId?: string; generation?: number; timeoutMs?: number },
      ) => {
        const res = await origRequest(op, payload, opts);
        if (op === "interrupt") ackBox.list.push(res);
        return res;
      }) as typeof origRequest;
      const origSetPrepare = handle.setPrepareRequestHandler.bind(handle);
      handle.setPrepareRequestHandler = ((h: (payload: unknown, env: unknown) => Promise<unknown>) => {
        return origSetPrepare((async (payload: unknown, env: unknown) => {
          const envRec = env as Record<string, unknown> | undefined;
          state.live.push({
            requestId: typeof envRec?.["requestId"] === "string" ? (envRec["requestId"] as string) : null,
            executionGeneration: typeof envRec?.["executionGeneration"] === "number" ? (envRec["executionGeneration"] as number) : null,
            taskRunId: typeof envRec?.["taskRunId"] === "string" ? (envRec["taskRunId"] as string) : null,
            agentId: typeof envRec?.["agentId"] === "string" ? (envRec["agentId"] as string) : null,
            rootEpoch: typeof envRec?.["rootEpoch"] === "string" ? (envRec["rootEpoch"] as string) : null,
            workerInstanceId: typeof envRec?.["workerInstanceId"] === "string" ? (envRec["workerInstanceId"] as string) : null,
          });
          const res = await h(payload, env);
          await transportGate;
          return res;
        }) as never);
      }) as typeof handle.setPrepareRequestHandler;
      return handle;
    },
    governingRegistry: () => ({ isActive: () => true, listHandles: () => [parent as never], getHandle: () => parent as never, baseCtx: () => ({}) }),
  });
  t.after(() => {
    const fn = releaseBox.fn;
    if (fn) fn();
  });
  t.after(() => sup.shutdown());

  const g = await sup.spawn("governor", { taskName: "prep-int", message: "go", profile: "reader" }, `prep-int-${Date.now()}`);
  const entryStart = Date.now();
  while (entryBox.at === null && Date.now() - entryStart < 20000) {
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(entryBox.at !== null, "sync parent prepare handler never entered");
  assert.equal(state.prepareCalls, 1, "parent prepare must enter exactly once before interrupt");
  const live0 = state.live[0];
  assert.ok(live0, "live held request context missing");
  assert.ok(typeof live0.requestId === "string" && live0.requestId.length > 0, "live requestId missing");
  assert.equal(live0.taskRunId, g.taskRunId, "live taskRunId must match");
  assert.equal(live0.agentId, g.agentId, "live agentId must match");
  assert.equal(live0.executionGeneration, g.generation, "live generation must match spawned generation");

  const interruptRes = await sup.interrupt("governor", g.agentId, `int-${Date.now()}`);
  assert.equal((interruptRes as { accepted?: unknown }).accepted, true, "interrupt admission not accepted (admission only, not application ACK)");
  assert.ok(ackBox.list.length >= 1, "no correlated worker interrupt application ACK observed");
  for (const ack of ackBox.list) {
    assert.ok(ack !== null && typeof ack === "object", `interrupt application ACK must be object, got ${JSON.stringify(ack)}`);
    assert.equal((ack as { ok?: unknown }).ok, true, `interrupt application ACK must be positive ok===true, got ${JSON.stringify(ack)}`);
    assert.equal((ack as { idle?: unknown }).idle, undefined, `interrupt ACK must be non-idle while awaiting RPC, got ${JSON.stringify(ack)}`);
  }

  await waitTerminal(sup, g.taskRunId, 20000);
  const rel = releaseBox.fn;
  assert.ok(rel, "transport release missing");
  rel();
  const late = await waitForReceipt(receiptFile, (r) => r.ok === true && r.requestId === live0.requestId, 20000);
  assert.equal(late.rootEpoch, live0.rootEpoch, "late RX rootEpoch must match live");
  assert.equal(late.agentId, live0.agentId, "late RX agentId must match live");
  assert.equal(late.workerInstanceId, live0.workerInstanceId, "late RX workerInstanceId must match live");
  assert.equal(late.taskRunId, live0.taskRunId, "late RX taskRunId must match live");
  assert.equal(late.executionGeneration, live0.executionGeneration, "late RX generation must match live callerGeneration");
  assert.equal(late.ok, true, "late RX must be supported positive body");
  assert.ok(typeof late.ticket === "string" && UUID_RE.test(late.ticket), `late RX ticket must exist UUID, got ${String(late.ticket)}`);
  assert.deepEqual(late.preparedArgs, { q: "held", n: 0 }, "late RX must carry validator null->0, not just args");

  await new Promise((r) => setTimeout(r, 1000));
  const leftover = [...(sup as unknown as { preparedTickets: Map<string, { agentId: string }> }).preparedTickets.values()].filter(
    (tk) => tk.agentId === g.agentId,
  );
  assert.equal(leftover.length, 0, `tickets must be 0 after RX, got ${leftover.length}`);
  const terms = sup.runStore.readSince(0, 100000).records.filter(
    (r) => r.kind === "task.terminal" && (r.body as Record<string, unknown>)["taskRunId"] === g.taskRunId,
  );
  assert.equal(terms.length, 1, `original task must have exactly 1 terminal after RX, got ${terms.length}`);
  assert.equal((terms[0].body as Record<string, unknown>)["outcome"], "interrupted", "original terminal must be interrupted");
  const execIntents = sup.runStore.readSince(0, 100000).records.filter(
    (r) =>
      r.kind === "tool.intent" &&
      (r.body as Record<string, unknown>)["tool"] === CG &&
      (r.body as Record<string, unknown>)["prepareOnly"] !== true &&
      (r.body as Record<string, unknown>)["taskRunId"] === g.taskRunId,
  );
  assert.equal(execIntents.length, 0, `exec intents must be 0 after RX, got ${execIntents.length}`);
  assert.equal(state.effects, 0, "effects must be 0 after RX");
  assert.equal(state.prepareCalls, 1, "prepare must be 1 after RX");

  const { randomUUID: uuid2 } = await import("node:crypto");
  const second = await sup.sendMessage("governor", g.agentId, "task", "after valid", {}, uuid2());
  const secondId = second.taskRunId as string;
  assert.ok(typeof secondId === "string" && secondId.length > 0, "followup missing taskRunId");
  await waitTerminal(sup, secondId, 20000);
  const live1 = state.live.find((l) => l.taskRunId === secondId);
  assert.ok(live1, "live context for followup missing");
  const rx2 = await waitForReceipt(receiptFile, (r) => r.ok === true && r.requestId === live1.requestId, 20000);
  assert.equal(rx2.workerInstanceId, late.workerInstanceId, "followup must verify SAME workerInstanceId as first RX");
  assert.equal(rx2.executionGeneration, live1.executionGeneration, "followup RX generation must match its callerGeneration");
  assert.ok(typeof rx2.ticket === "string" && UUID_RE.test(rx2.ticket), "followup ticket must be UUID");
  assert.deepEqual(rx2.preparedArgs, { q: "after", n: 0 }, "followup preparedArgs must be null->0");
  const secondTerms = sup.runStore.readSince(0, 100000).records.filter(
    (r) => r.kind === "task.terminal" && (r.body as Record<string, unknown>)["taskRunId"] === secondId,
  );
  assert.equal(secondTerms.length, 1, "followup must have 1 terminal");
  assert.equal((secondTerms[0].body as Record<string, unknown>)["outcome"], "succeeded", "followup must succeed");
  assert.equal(state.prepareCalls, 2, "followup must prepare once");
  assert.equal(state.effects, 1, "followup must execute once");
  assert.deepEqual(seenParams[0], { q: "after", n: 0 }, "followup execute must see null->0");

  const idleHandle = handleBox.current;
  assert.ok(idleHandle, "handle missing for idle control");
  const idleAck = (await idleHandle.request("interrupt", {}, { taskRunId: secondId, generation: live1.executionGeneration ?? undefined, timeoutMs: 15000 })) as {
    ok?: unknown;
    idle?: unknown;
  };
  assert.equal(idleAck.ok, true, `idle control ACK must still be positive ok===true, got ${JSON.stringify(idleAck)}`);
  assert.equal(idleAck.idle, true, `idle control must show idle:true (proving non-idle check would fail for idle), got ${JSON.stringify(idleAck)}`);
});
