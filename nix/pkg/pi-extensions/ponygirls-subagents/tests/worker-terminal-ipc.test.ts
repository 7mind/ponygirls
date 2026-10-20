import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkerHandle } from "../src/worker-launch.ts";
import { bindChannel, MAX_PAYLOAD_BYTES, type WorkerEvent } from "../src/protocol.ts";
import { Supervisor } from "../src/supervisor.ts";
import { InMemoryRunStore } from "../src/store.ts";
import { defaultSupervisorPolicy } from "../src/policy.ts";
import { DummyToolExecutor } from "../src/sandbox.ts";
import { DummyWorkspaceManager } from "../src/workspace.ts";

const SDK_ROOT = process.env["PI_SUBAGENTS_SDK_ROOT"];
const WORKER_PATH = new URL("../src/worker.ts", import.meta.url).pathname;
const ERROR_PREFIX = "LOCAL_TERMINAL_ERROR: ";
const SDK_ERROR_PREFIX = "local_terminal_error: ";
const ERROR_MAX_BYTES = 8 * 1024;
const TRUNCATION_MARKER = "\n[truncated terminal error: ";
const MODEL = { provider: "local-terminal", id: "terminal", thinkingLevel: "off" };
const REAL_WORKER = { skip: SDK_ROOT === undefined ? "PI_SUBAGENTS_SDK_ROOT unset; real worker not executed" : false };

async function until(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
}

interface LocalProvider {
  hostAgentDir: string;
  close: () => Promise<void>;
  requests: () => number;
}

async function localProvider(dir: string, error: string, priorText: string | null): Promise<LocalProvider> {
  let requests = 0;
  const server = createServer((request, response) => {
    requests++;
    request.resume();
    response.writeHead(200, { "content-type": "text/event-stream" });
    const emit = (event: { type: string } & Record<string, unknown>): void => {
      response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    if (requests === 1 && priorText !== null) {
      const message = { type: "message", id: "local-message", role: "assistant", status: "completed", content: [{ type: "output_text", text: priorText, annotations: [] }] };
      const call = { type: "function_call", id: "local-call", call_id: "local-tool-call", name: "read", arguments: JSON.stringify({ path: "local.txt" }), status: "completed" };
      emit({ type: "response.created", response: { id: "local-response", status: "in_progress" } });
      emit({ type: "response.output_item.added", output_index: 0, item: { ...message, status: "in_progress", content: [] } });
      emit({ type: "response.output_text.delta", output_index: 0, content_index: 0, item_id: message.id, delta: priorText });
      emit({ type: "response.output_item.done", output_index: 0, item: message });
      emit({ type: "response.output_item.added", output_index: 1, item: { ...call, arguments: "", status: "in_progress" } });
      emit({ type: "response.function_call_arguments.delta", output_index: 1, item_id: call.id, delta: call.arguments });
      emit({ type: "response.output_item.done", output_index: 1, item: call });
      emit({ type: "response.completed", response: {
        id: "local-response", status: "completed", output: [message, call],
        usage: { input_tokens: 16, output_tokens: 7, total_tokens: 23, input_tokens_details: { cached_tokens: 3, cache_write_tokens: 2 }, output_tokens_details: { reasoning_tokens: 2 } },
      } });
    } else {
      emit({ type: "response.failed", response: { id: "local-failure", status: "failed", error: { message: error, code: "local_terminal_error" } } });
    }
    response.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  const hostAgentDir = join(dir, "provider-config");
  mkdirSync(hostAgentDir, { recursive: true });
  writeFileSync(join(hostAgentDir, "auth.json"), "{}");
  writeFileSync(join(hostAgentDir, "models.json"), JSON.stringify({ providers: { "local-terminal": {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    api: "openai-responses",
    apiKey: "local-no-auth",
    models: [{ id: MODEL.id, reasoning: false, input: ["text"], contextWindow: 131072, maxTokens: 16, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
  } } }));
  return {
    hostAgentDir,
    requests: () => requests,
    close: () => new Promise((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections(); }),
  };
}

function workerHome(dir: string): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false } }));
  return dir;
}

interface WorkerRun {
  dir: string;
  settled: WorkerEvent;
  requests: number;
  toolRequests: number;
}

async function withWorker(providerError: string, priorText: string | null, check: (run: WorkerRun) => Promise<void>): Promise<void> {
  assert.ok(SDK_ROOT);
  const dir = mkdtempSync(join(tmpdir(), "subagents-terminal-ipc-"));
  const provider = await localProvider(dir, providerError, priorText);
  const events: WorkerEvent[] = [];
  let toolRequests = 0;
  const handle = new WorkerHandle({
    workerPath: WORKER_PATH,
    rootEpoch: "terminal-epoch",
    agentId: "terminal-agent",
    sdkRoot: SDK_ROOT,
    deterministic: false,
    agentDir: workerHome(join(dir, "worker-home")),
    hostAgentDir: provider.hostAgentDir,
    sessionsDir: join(dir, "sessions"),
  }, bindChannel("terminal-epoch", "terminal-agent", "terminal-instance"));
  handle.setEventHandler((event) => events.push(event));
  handle.setProviderAdmissionRequestHandler(async () => ({ ok: true }));
  handle.setToolRequestHandler(async (payload) => {
    toolRequests++;
    assert.equal(payload.tool, "read");
    return { content: "local tool result", isError: false };
  });
  try {
    await handle.launch();
    const ack = await handle.request("initialize", {
      taskText: "Return the local provider error.",
      profile: "reader",
      instructionHash: "",
      instructions: { contextFiles: [], skills: [] },
      model: MODEL,
      taskRunId: "terminal-task",
      executionGeneration: 1,
      workdir: dir,
      readRoots: [dir],
      writable: false,
      tools: priorText === null ? [] : ["read"],
      resultLimit: 300_000,
    }, { taskRunId: "terminal-task", generation: 1, timeoutMs: 30_000 }) as { ok: boolean; sessionFile: string };
    assert.equal(ack.ok, true);
    await until(() => existsSync(ack.sessionFile) && readFileSync(ack.sessionFile, "utf8").includes(ERROR_PREFIX), 10_000);
    assert.ok(readFileSync(ack.sessionFile, "utf8").includes(ERROR_PREFIX), `provider error not finalized; diagnostics=${JSON.stringify(handle.diagnostics())}`);
    await until(() => events.some((event) => event.kind === "settled"), 2_000);
    const interrupt = await handle.request("interrupt", {}, { taskRunId: "terminal-task", generation: 1, timeoutMs: 5_000 });
    assert.deepEqual(interrupt, { ok: true, idle: true });
    const native = readFileSync(ack.sessionFile, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { message?: { stopReason?: string; errorMessage?: string } });
    const nativeError = native.find((entry) => entry.message?.stopReason === "error")?.message?.errorMessage;
    assert.equal(nativeError, SDK_ERROR_PREFIX + providerError, "the public native transcript retains the complete provider diagnostic");
    const terminal = events.filter((event) => event.kind === "settled");
    assert.equal(terminal.length, 1, `native error bytes=${Buffer.byteLength(providerError)}; worker internally idle; accepted events=${events.map((event) => event.kind).join(",")}; exit=${JSON.stringify(handle.exit)}`);
    const settled = terminal[0]!;
    assert.equal(settled.detail["status"], "failed");
    assert.equal(settled.taskRunId, "terminal-task");
    assert.equal(settled.executionGeneration, 1);
    assert.ok(Buffer.byteLength(JSON.stringify(settled)) <= MAX_PAYLOAD_BYTES);
    await check({ dir, settled, requests: provider.requests(), toolRequests });
  } finally {
    handle.kill();
    await provider.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function assertDiagnostic(event: WorkerEvent, original: string): void {
  const error = event.detail["error"];
  assert.equal(typeof error, "string");
  const diagnostic = error as string;
  assert.ok(Buffer.byteLength(JSON.stringify(diagnostic)) <= ERROR_MAX_BYTES, "JSON-encoded diagnostic, including its marker, exceeds its bound");
  if (Buffer.byteLength(JSON.stringify(original)) <= ERROR_MAX_BYTES) {
    assert.equal(diagnostic, original);
  } else {
    const cut = diagnostic.indexOf(TRUNCATION_MARKER);
    assert.ok(cut > 0, "truncation must be explicit");
    assert.ok(original.startsWith(diagnostic.slice(0, cut)));
    assert.equal(diagnostic.slice(cut), `${TRUNCATION_MARKER}${Buffer.byteLength(original)} UTF-8 bytes total]`);
  }
  assert.ok(diagnostic.isWellFormed(), "truncation introduced an unpaired UTF-16 surrogate");
}

// Behavioral-Active × Effectual-GoodCommunication; regression: provider diagnostics cannot suppress terminal IPC.
const errors = [
  { name: "an oversized ASCII provider error", text: "x".repeat(MAX_PAYLOAD_BYTES + 1) },
  { name: "an oversized Unicode provider error", text: "😀".repeat(70_000) },
  { name: "JSON expansion of quotes, backslashes and control characters", text: "\"\\\u0000\n".repeat(50_000) },
  { name: "a short provider error unchanged", text: "short \"\\\n😀" },
  { name: "an exactly bounded provider error unchanged", text: "x".repeat(ERROR_MAX_BYTES - 2 - SDK_ERROR_PREFIX.length - ERROR_PREFIX.length) },
  { name: "a provider error one JSON byte over the bound", text: "x".repeat(ERROR_MAX_BYTES - 1 - SDK_ERROR_PREFIX.length - ERROR_PREFIX.length) },
];
for (const example of errors) {
  test(`real worker: ${example.name} remains visible as one failed terminal event`, REAL_WORKER, async () => {
    const providerError = ERROR_PREFIX + example.text;
    await withWorker(providerError, null, async ({ settled, requests, toolRequests }) => {
      assertDiagnostic(settled, SDK_ERROR_PREFIX + providerError);
      assert.equal(settled.detail["lastAssistantText"], "");
      assert.equal(settled.detail["textLength"], 0);
      assert.equal(settled.detail["resultFile"], null);
      assert.deepEqual(settled.detail["usage"], { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: null, cost: 0, unknown: false });
      assert.equal(requests, 1);
      assert.equal(toolRequests, 0);
    });
  });
}

test("real worker: error truncation preserves the prior text file, retention bound and exact usage", REAL_WORKER, async () => {
  const text = "result \"\\\u0000\n".repeat(40_000);
  const providerError = ERROR_PREFIX + "😀".repeat(70_000);
  await withWorker(providerError, text, async ({ dir, settled, requests, toolRequests }) => {
    assertDiagnostic(settled, SDK_ERROR_PREFIX + providerError);
    assert.equal(settled.detail["lastAssistantText"], text.slice(0, 8000));
    assert.equal(settled.detail["textLength"], text.length);
    assert.equal(settled.detail["resultFileError"], null);
    const file = settled.detail["resultFile"] as { path: string; byteCount: number; sha256: string };
    assert.ok(file.path.startsWith(join(dir, "sessions", "terminal-agent")));
    const bytes = readFileSync(file.path);
    assert.equal(bytes.toString("utf8"), text.slice(0, 300_000));
    assert.equal(bytes.length, file.byteCount);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256);
    assert.deepEqual(settled.detail["usage"], { input: 16, output: 7, cacheRead: 3, cacheWrite: 2, reasoning: 2, cost: 0, unknown: false });
    assert.equal(requests, 2);
    assert.equal(toolRequests, 1);
  });
});

test("supervisor: an oversized real-provider diagnostic reaches failed status, result reads and one terminal journal record", REAL_WORKER, async () => {
  assert.ok(SDK_ROOT);
  const dir = mkdtempSync(join(tmpdir(), "subagents-terminal-supervisor-"));
  const provider = await localProvider(dir, ERROR_PREFIX + "😀\"\\\u0000\n".repeat(50_000), null);
  const store = new InMemoryRunStore("root-terminal");
  const executor = new DummyToolExecutor();
  const supervisor = new Supervisor({
    rootId: "root-terminal",
    rootDir: dir,
    store,
    policy: defaultSupervisorPolicy(),
    governor: () => ({ model: MODEL, cwd: dir, instructions: { contextFiles: [], skills: [] } }),
    executors: { sandbox: executor, host: executor },
    workspace: new DummyWorkspaceManager(),
    workerFactory: ({ rootEpoch, agentId, instanceId }) => new WorkerHandle({
      workerPath: WORKER_PATH,
      rootEpoch,
      agentId,
      sdkRoot: SDK_ROOT,
      deterministic: false,
      agentDir: workerHome(join(dir, "homes", agentId)),
      hostAgentDir: provider.hostAgentDir,
      sessionsDir: join(dir, "sessions"),
    }, bindChannel(rootEpoch, agentId, instanceId)),
  });
  try {
    const spawned = await supervisor.spawn("governor", { taskName: "terminal", message: "Fail locally.", profile: "reader", isolation: "none" }, "spawn-terminal");
    await until(() => supervisor.list("governor").some((agent) => agent.id === spawned.agentId && agent.taskOutcome === "failed"), 10_000);
    const result = supervisor.read("governor", spawned.agentId, "result", 0, 1, spawned.taskRunId);
    assert.equal(result.status.observed, "settled");
    assert.equal(result.status.taskOutcome, "failed");
    assert.ok(result.result);
    assert.equal(result.result.outcome, "failed");
    assert.ok(result.result.detail.includes(ERROR_PREFIX));
    assert.ok(result.result.detail.includes(TRUNCATION_MARKER));
    const terminal = store.readSince(0, Number.MAX_SAFE_INTEGER).records.filter((record) => record.kind === "task.terminal" && record.body["taskRunId"] === spawned.taskRunId);
    assert.equal(terminal.length, 1);
    assert.equal(terminal[0]!.body["outcome"], "failed");
    assert.equal(provider.requests(), 1);
  } finally {
    await supervisor.shutdown();
    await provider.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
