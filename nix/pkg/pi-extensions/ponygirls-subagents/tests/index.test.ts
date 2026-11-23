/**
 * Extension wiring against a minimal stand-in for pi's ExtensionAPI: the
 * binding never falls back silently, and waits honour the tool abort signal.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import { Type, type TSchema } from "typebox";
import { childToolSpec } from "../src/tools.ts";
import { HISTORY_CHANNEL, type HistoryFeed } from "../src/history.ts";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { BORDER_ORDER } from "@ponygirls/pi-ui";

type Submission = { message: unknown; options: Parameters<ExtensionAPI["enqueueMessage"]>[1] };
type ToolExecute = (id: string, params: unknown, signal: AbortSignal | undefined, onUpdate: undefined, ctx: unknown) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;

type Handler = (event: unknown, ctx: unknown) => Promise<void>;

type Schema = { properties?: Record<string, Schema>; items?: Schema; anyOf?: Schema[] };

async function loadExtension(agentDir: string): Promise<{ tools: Map<string, ToolExecute>; schemas: Map<string, Schema>; descriptions: Map<string, string>; commands: Map<string, string>; handlers: Map<string, Handler>; sent: Submission[]; ctx: unknown; events: EventEmitter }> {
  process.env["PI_CODING_AGENT_DIR"] = agentDir;
  process.env["PI_SUBAGENTS_SDK_ROOT"] = process.env["PI_SUBAGENTS_SDK_ROOT"] ?? "/nonexistent-sdk";
  const tools = new Map<string, ToolExecute>();
  const schemas = new Map<string, Schema>();
  const descriptions = new Map<string, string>();
  const commands = new Map<string, string>();
  const handlers = new Map<string, Handler>();
  const sent: Submission[] = [];
  const events = new EventEmitter();
  const pi = {
    events: {
      on: (channel: string, handler: (value: unknown) => void) => { events.on(channel, handler); return () => { events.off(channel, handler); }; },
      emit: (channel: string, value: unknown) => { events.emit(channel, value); },
    },
    registerTool: (t: { name: string; execute: ToolExecute; parameters: Schema; description: string }) => {
      tools.set(t.name, t.execute);
      schemas.set(t.name, t.parameters);
      descriptions.set(t.name, t.description);
    },
    registerCommand: (name: string, command: { description: string }) => { commands.set(name, command.description); },
    registerMessageRenderer: () => {},
    on: (event: string, h: Handler) => handlers.set(event, h),
    sendMessage: () => { throw new Error("legacy ingress must not be used"); },
    enqueueMessage: (message: unknown, options: Parameters<ExtensionAPI["enqueueMessage"]>[1]) => sent.push({ message, options }),
    getThinkingLevel: () => "low",
  };
  const mod = (await import("../index.ts")) as { default: (api: unknown) => void };
  mod.default(pi);
  const ctx = {
    sessionManager: { getSessionId: () => "sess-1" },
    cwd: agentDir,
    model: { provider: "test", id: "model" },
    modelRegistry: {
      getAvailable: () => [],
      getRegisteredProviderConfig: () => undefined,
      getRegisteredNativeProvider: () => undefined,
    },
    ui: { notify: () => {}, setWidget: () => {}, theme: { fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => text, bold: (text: string) => text } },
  };
  return { tools, schemas, descriptions, commands, handlers, sent, ctx, events };
}

test("the /agents command says what it is for, in at most 60 characters and without syntax", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "subagents-command-"));
  try {
    const { commands } = await loadExtension(agentDir);
    assert.deepEqual([...commands], [["agents", "Subagents: tree, transcripts, messages, controls"]]);
    assert.ok(commands.get("agents")!.length <= 60);
  } finally { rmSync(agentDir, { recursive: true, force: true }); }
});

type BadgeWidget = { render(width: number): string[]; renderCompact(width: number): string; handleMouse(event: { type: string; button: string }): { handled: boolean } | undefined };
type WidgetCall = { key: string; factory: ((tui: unknown, theme: unknown) => BadgeWidget) | undefined; options: unknown };

test("the border badge shows for at least one agent, is styled by the theme at each render, and opens /agents on a click", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "subagents-badge-"));
  const { tools, handlers, ctx } = await loadExtension(agentDir);
  const published: WidgetCall[] = [];
  const notices: string[] = [];
  // One theme object whose colours change, as pi's does on a theme switch.
  let palette = "dark";
  const theme = { fg: (color: string, text: string) => `<${palette}:${color}>${text}</>`, bg: (color: string, text: string) => `<bg:${color}>${text}</>`, bold: (text: string) => `<bold>${text}</>` };
  const ui = (ctx as { ui: { setWidget: (...call: [string, WidgetCall["factory"], unknown]) => void; notify: (text: string) => void; theme: typeof theme } }).ui;
  ui.setWidget = (key, factory, options) => { published.push({ key, factory, options }); };
  ui.notify = (text) => { notices.push(text); };
  ui.theme = theme;
  const until = async (done: () => boolean): Promise<void> => {
    const deadline = Date.now() + 10_000;
    while (!done() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  };
  const unstyled = (text: string | undefined): string | undefined => text?.replace(/<[^>]*>/g, "");
  try {
    await handlers.get("session_start")!({}, ctx);
    await until(() => published.length > 0);
    assert.deepEqual([...published], [{ key: "agents", factory: undefined, options: undefined }], "no agents, no badge");
    // The fixture model is unavailable: the child ends failed, so the tree is one settled agent.
    await tools.get("spawn_agent")!("badge-child", { task_name: "badge-child", message: "unused", profile: "reader", isolation: "none" }, undefined, undefined, ctx);
    await until(() => unstyled(published.at(-1)!.factory?.({}, theme).render(80)[0]) === " 👥 1 ");
    const last = published.at(-1)!;
    assert.equal(last.key, "agents");
    assert.deepEqual(last.options, { placement: "borderBottomLeft", order: BORDER_ORDER.agents });
    // Mounted after a theme switch: nothing styled when the badge was published may remain.
    palette = "dim";
    const badge = last.factory!({}, theme);
    assert.deepEqual(badge.render(80), [" 👥 <dim:muted>1</> "], "no background chip; the count in the settled colour");
    assert.equal(badge.renderCompact(80), "👥<dim:muted>1</>");
    palette = "light";
    assert.deepEqual(badge.render(80), [" 👥 <light:muted>1</> "], "a theme switch restyles the mounted badge");
    assert.equal(badge.renderCompact(80), "👥<light:muted>1</>");
    assert.equal(badge.handleMouse({ type: "click", button: "right" }), undefined);
    assert.deepEqual(badge.handleMouse({ type: "click", button: "left" }), { handled: true });
    // This stand-in has no TUI, so /agents reports the tree instead of opening the pane.
    await until(() => notices.some((text) => text.startsWith("agents 1\n")));
    assert.ok(notices.some((text) => text.startsWith("agents 1\n")), `a left click opens /agents: ${JSON.stringify(notices)}`);
  } finally {
    await handlers.get("session_shutdown")!({}, ctx);
    rmSync(agentDir, { recursive: true, force: true });
  }
  assert.equal(published.at(-1)!.factory, undefined, "shutdown clears the badge");
});

test("capacity tool descriptions explain descendant authority and reclaimable open slots", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "subagents-capacity-tools-"));
  try {
    const { descriptions } = await loadExtension(agentDir);
    assert.match(descriptions.get("spawn_agent")!, /48-agent cap counts open identities/);
    assert.match(descriptions.get("send_message")!, /any ordinary open descendant, including nested agents/);
    assert.match(descriptions.get("close_agent")!, /governing session may target any descendant/);
    assert.match(descriptions.get("close_agent")!, /releases one open-agent admission slot/);
    assert.match(descriptions.get("close_agent")!, /cumulative usage.*preserved/);
    for (const name of ["spawn_agent", "send_message", "close_agent"]) assert.doesNotMatch(descriptions.get(name)!, /lifetime.*cap|cannot refund/);
  } finally { rmSync(agentDir, { recursive: true, force: true }); }
});

test("policy loading defaults to latest generations only and requires a boolean to opt out", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "subagents-model-policy-"));
  const priorDir = process.env["PI_CODING_AGENT_DIR"];
  process.env["PI_CODING_AGENT_DIR"] = agentDir;
  try {
    const { loadPolicy } = await import("../index.ts");
    const path = join(agentDir, "subagents-policy.json");
    assert.equal(loadPolicy().policy.latestModelsOnly, true);
    writeFileSync(path, JSON.stringify({ allowedModels: null }));
    assert.equal(loadPolicy().policy.latestModelsOnly, true);
    writeFileSync(path, JSON.stringify({ latestModelsOnly: false }));
    assert.equal(loadPolicy().policy.latestModelsOnly, false);
    writeFileSync(path, JSON.stringify({ latestModelsOnly: "false" }));
    assert.throws(() => loadPolicy(), /POLICY_DENIED.*latestModelsOnly must be a boolean/);
  } finally {
    if (priorDir === undefined) delete process.env["PI_CODING_AGENT_DIR"];
    else process.env["PI_CODING_AGENT_DIR"] = priorDir;
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("list_agents reports the scheduler limits configured in the policy file", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "subagents-limits-"));
  try {
    writeFileSync(join(agentDir, "subagents-policy.json"), JSON.stringify({ maxRunnable: 6, maxResidentWorkers: 12, maxOpenAgents: 40 }));
    const { tools, ctx } = await loadExtension(agentDir);
    const res = await tools.get("list_agents")!("limits", {}, undefined, undefined, ctx);
    assert.equal(res.isError, undefined, res.content[0]!.text);
    const report = JSON.parse(res.content[0]!.text) as { agents: unknown[]; capacity: { runnable: number; limits: Record<string, number> } };
    assert.deepEqual(report.agents, []);
    assert.equal(report.capacity.runnable, 0);
    assert.deepEqual(report.capacity.limits, { maxRunnable: 6, maxResidentWorkers: 12, maxOpenAgents: 40 });
  } finally { rmSync(agentDir, { recursive: true, force: true }); }
});

test("an SDK without retained ingress is rejected before delegation or legacy fallback", async () => {
  const mod = await import("../index.ts");
  const unsupported = { sendMessage() { throw new Error("legacy ingress must not be used"); } } as unknown as ExtensionAPI;
  assert.throws(() => mod.default(unsupported), /UNSUPPORTED_SDK.*retained-ingress/);
});

test("a corrupt root store is reported, never replaced by an empty in-memory store", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "subagents-ext-"));
  try {
    const root = join(agentDir, "subagents", "sess-1");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "MANIFEST.json"), "{garbage");
    const { tools, ctx } = await loadExtension(agentDir);
    const res = await tools.get("list_agents")!("t1", {}, undefined, undefined, ctx);
    assert.equal(res.isError, true);
    assert.match(res.content[0]!.text, /RECOVERY_CORRUPT/);
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("wait_agent returns promptly when its tool call is aborted", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "subagents-ext-"));
  try {
    const { tools, ctx } = await loadExtension(agentDir);
    const controller = new AbortController();
    const started = Date.now();
    const pending = tools.get("wait_agent")!("t2", { condition: "activity", cursor: 1_000_000, timeout_ms: 60_000 }, controller.signal, undefined, ctx);
    setTimeout(() => controller.abort(), 100);
    const res = await pending;
    assert.ok(Date.now() - started < 5_000, "the wait outlived its abort");
    assert.match(res.content[0]!.text, /"reason":"input"/);
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("a reload handoff that is never reattached retires its supervisor lease", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const agentDir = mkdtempSync(join(tmpdir(), "subagents-reload-timeout-"));
  let replacement: Awaited<ReturnType<typeof loadExtension>> | null = null;
  try {
    const first = await loadExtension(agentDir);
    await first.handlers.get("session_start")!({}, first.ctx);
    await first.handlers.get("session_shutdown")!({ reason: "reload" }, first.ctx);
    const { RELOAD_HANDOFF_TIMEOUT_MS } = await import("../index.ts");
    t.mock.timers.tick(RELOAD_HANDOFF_TIMEOUT_MS);
    replacement = await loadExtension(agentDir);
    await replacement.handlers.get("session_start")!({}, replacement.ctx);
    const result = await replacement.tools.get("list_agents")!("after-timeout", {}, undefined, undefined, replacement.ctx);
    assert.equal(result.isError, undefined, result.content[0]!.text);
  } finally {
    if (replacement) await replacement.handlers.get("session_shutdown")!({ reason: "quit" }, replacement.ctx);
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("a policy-changing reload replaces the supervisor and applies new limits", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "subagents-policy-reload-"));
  let second: Awaited<ReturnType<typeof loadExtension>> | null = null;
  try {
    const first = await loadExtension(agentDir);
    await first.handlers.get("session_start")!({}, first.ctx);
    const before = await first.tools.get("list_agents")!("before-policy-reload", {}, undefined, undefined, first.ctx);
    assert.deepEqual((JSON.parse(before.content[0]!.text) as { capacity: { limits: Record<string, number> } }).capacity.limits,
      { maxRunnable: 16, maxResidentWorkers: 24, maxOpenAgents: 48 });
    writeFileSync(join(agentDir, "subagents-policy.json"), JSON.stringify({ maxRunnable: 6, maxResidentWorkers: 12, maxOpenAgents: 40 }));
    await first.handlers.get("session_shutdown")!({ reason: "reload" }, first.ctx);

    second = await loadExtension(agentDir);
    await second.handlers.get("session_start")!({}, second.ctx);
    const after = await second.tools.get("list_agents")!("after-policy-reload", {}, undefined, undefined, second.ctx);
    assert.deepEqual((JSON.parse(after.content[0]!.text) as { capacity: { limits: Record<string, number> } }).capacity.limits,
      { maxRunnable: 6, maxResidentWorkers: 12, maxOpenAgents: 40 });
  } finally {
    if (second) await second.handlers.get("session_shutdown")!({ reason: "quit" }, second.ctx);
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("history bridge is current-root scoped and old capabilities stay revoked after same-policy reload", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "subagents-history-bridge-"));
  const first = await loadExtension(agentDir); let second: Awaited<ReturnType<typeof loadExtension>> | null = null;
  const feeds: HistoryFeed[] = [];
  const request = (extension: typeof first, rootSessionId: string) => extension.events.emit(HISTORY_CHANNEL, { rootSessionId, respond: (feed: HistoryFeed) => feeds.push(feed) });
  try {
    request(first, "sess-1"); assert.equal(feeds.length, 0);
    await first.handlers.get("session_start")!({}, first.ctx);
    request(first, "foreign"); assert.equal(feeds.length, 0);
    request(first, "sess-1"); assert.equal(feeds.length, 1); assert.deepEqual(feeds[0]!.sources(), []);
    await first.handlers.get("session_shutdown")!({ reason: "reload" }, first.ctx);
    assert.throws(() => feeds[0]!.sources(), /revoked/);
    second = await loadExtension(agentDir); await second.handlers.get("session_start")!({}, second.ctx);
    request(first, "sess-1"); assert.equal(feeds.length, 1, "detached bridge cannot grant another capability");
    request(second, "sess-1"); assert.equal(feeds.length, 2); assert.deepEqual(feeds[1]!.sources(), []);
    assert.throws(() => feeds[0]!.subscribe(() => {}), /revoked/);
    await assert.rejects(feeds[0]!.read("unused", 0, 1), /revoked/);
  } finally {
    if (second) await second.handlers.get("session_shutdown")!({ reason: "quit" }, second.ctx);
    else await first.handlers.get("session_shutdown")!({ reason: "quit" }, first.ctx);
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("an incompatible retained pre-bridge binding fails clearly without cancelling its retirement timer", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "subagents-history-upgrade-"));
  const first = await loadExtension(agentDir);
  await first.handlers.get("session_start")!({}, first.ctx);
  await first.handlers.get("session_shutdown")!({ reason: "reload" }, first.ctx);
  const runtime = (globalThis as Record<symbol, unknown>)[Symbol.for("ponygirls.subagents.process-runtime.v1")] as {
    bindings: Map<string, { historyAbort?: AbortController; handoffTimer: unknown }>;
  };
  const binding = runtime.bindings.get(join(agentDir, "subagents", "sess-1"))!;
  const abort = binding.historyAbort; const timer = binding.handoffTimer; delete binding.historyAbort;
  const second = await loadExtension(agentDir);
  try {
    const result = await second.tools.get("list_agents")!("upgrade", {}, undefined, undefined, second.ctx);
    assert.equal(result.isError, true); assert.match(result.content[0]!.text, /UPGRADE_RESTART_REQUIRED/);
    assert.equal(binding.handoffTimer, timer, "old runtime must retain its own retirement path");
  } finally {
    binding.historyAbort = abort;
    await second.handlers.get("session_start")!({}, second.ctx);
    await second.handlers.get("session_shutdown")!({ reason: "quit" }, second.ctx);
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("notices already in the journal are not redelivered when a session is attached again", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "subagents-ext-"));
  try {
    const { FileRunStore } = await import("../src/store.ts");
    const store = new FileRunStore(join(agentDir, "subagents", "sess-1"), "sess-1");
    store.append("mailbox.accepted", { messageId: "m-old", from: "child-1", to: "governor", mode: "note", text: "delivered before the restart", requestReply: false });
    store.append("task.terminal", { agentId: "child-1", taskRunId: "t-old", outcome: "succeeded" });
    const { handlers, sent, ctx } = await loadExtension(agentDir);
    await handlers.get("session_start")!({}, ctx);
    await handlers.get("input")!({}, ctx);
    assert.deepEqual(sent, [], "old notices were delivered again");
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
});

// Regression: a terminal event after the governing run ends must not wait for input.
test("an idle child's startup failure is displayed without another user message", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "subagents-ext-"));
  const { tools, handlers, sent, ctx } = await loadExtension(agentDir);
  try {
    await handlers.get("session_start")!({}, ctx);
    await tools.get("spawn_agent")!("notice-child", { task_name: "notice-child", message: "unused", profile: "reader", isolation: "none" }, undefined, undefined, ctx);
    const outcome = async (): Promise<string | null> => {
      const result = await tools.get("list_agents")!("notice-status", {}, undefined, undefined, ctx);
      return (JSON.parse(result.content[0]!.text) as { agents: { taskOutcome: string | null }[] }).agents[0]!.taskOutcome;
    };
    const deadline = Date.now() + 10_000;
    while (await outcome() === null && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(await outcome(), "failed", "the unavailable fixture model must produce a terminal event");
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(sent.some((s) => JSON.stringify(s.message).includes("ended failed")), "terminal notice was not delivered without user input");
    assert.deepEqual(sent.map((s) => s.options), [{ triggerTurn: true, deliverAs: "steer" }], "actionable delivery must resume the governor at the next safe model boundary");
  } finally {
    await handlers.get("session_shutdown")!({}, ctx);
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("children can be handed only the skills and context files pi loaded for the current run", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "subagents-ext-"));
  try {
    const { tools, handlers, ctx } = await loadExtension(agentDir);
    await handlers.get("session_start")!({}, ctx);
    const spawn = (params: Record<string, unknown>) => tools.get("spawn_agent")!("t-spawn", { task_name: "k", message: "m", profile: "reader", ...params }, undefined, undefined, ctx);
    const before = await spawn({ all_skills: true });
    assert.match(before.content[0]!.text, /INVALID: the governing session's skills and context files are unavailable/);
    await handlers.get("before_agent_start")!({
      systemPromptOptions: {
        cwd: agentDir,
        contextFiles: [{ path: "/proj/AGENTS.md", content: "rules" }],
        skills: [{ name: "tdd", description: "d", filePath: "/s/tdd/SKILL.md", baseDir: "/s/tdd", sourceInfo: {}, disableModelInvocation: false }],
      },
    }, ctx);
    const unknownSkill = await spawn({ skills: ["nope"] });
    assert.match(unknownSkill.content[0]!.text, /unknown skill\(s\): "nope"; available: "tdd"/);
    const unknownFile = await spawn({ context_files: ["/other/AGENTS.md"] });
    assert.match(unknownFile.content[0]!.text, /unknown context file\(s\): "\/other\/AGENTS.md"; available: "\/proj\/AGENTS.md"/);
    const malformed = await spawn({ skills: "tdd" });
    assert.match(malformed.content[0]!.text, /INVALID: skills must be a list of names/);
    const both = await spawn({ skills: ["tdd"], all_skills: true });
    assert.match(both.content[0]!.text, /INVALID: pass either skills or all_skills, not both/);
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("the governing model is told about gate checks and promised outputs", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "subagents-ext-"));
  try {
    const { schemas } = await loadExtension(agentDir);
    for (const tool of ["spawn_agent", "manage_gate", "send_message"]) {
      const gate = schemas.get(tool)!.properties!["gate"]!;
      const check = gate.properties!["checks"]!.items!;
      assert.deepEqual(Object.keys(check.properties!).sort(), ["command", "id", "timeoutMs"], tool);
      assert.ok(gate.properties!["promisedOutputs"], `${tool} lacks promisedOutputs`);
    }
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("the governing send_message forwards the spawn gate schema and does not expose it to children", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "subagents-followup-schema-"));
  const { schemas, tools, handlers, ctx } = await loadExtension(agentDir);
  try {
    assert.deepEqual(schemas.get("send_message")!.properties!["gate"], schemas.get("spawn_agent")!.properties!["gate"]);
    assert.equal((childToolSpec<TSchema>(Type, "send_message").parameters as Schema).properties?.["gate"], undefined);
    const result = await tools.get("send_message")!("id", {
      target: "missing", mode: "note", message: "not a task", gate: { model: { provider: "p", id: "m" }, thinkingLevel: "low", prompt: "rubric" },
    }, undefined, undefined, ctx);
    assert.equal(result.isError, true);
    assert.match(result.content[0]!.text, /INVALID: gate requires mode=task/);
  } finally {
    await handlers.get("session_shutdown")!({}, ctx);
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("review panels and advisory dispatch are exposed by the governing schemas", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "subagents-ext-"));
  try {
    const { schemas } = await loadExtension(agentDir);
    const spawn = schemas.get("spawn_agent")!.properties!;
    for (const review of [spawn["gate"]!, spawn["review"]!, schemas.get("manage_gate")!.properties!["gate"]!]) {
      assert.ok(review.properties!["prompt"]);
      assert.ok(review.properties!["model"]);
      const slot = review.properties!["reviewers"]!.items!.properties!;
      assert.deepEqual(Object.keys(slot).sort(), ["model", "prompt", "thinkingLevel"]);
    }
    assert.equal(spawn["review"]!.properties!["maxRounds"], undefined);
    assert.equal(spawn["review"]!.properties!["checks"], undefined);
    assert.equal(spawn["review"]!.properties!["promisedOutputs"], undefined);
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("spawn_agent validates workspace_path even with a stale workspaceRoots key in the policy file", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "subagents-ext-"));
  try {
    writeFileSync(join(agentDir, "subagents-policy.json"), JSON.stringify({ workspaceRoots: ["relative/root"] }));
    const { tools, schemas, ctx, handlers } = await loadExtension(agentDir);
    try {
      assert.ok(schemas.get("spawn_agent")!.properties!["workspace_path"]);
      const res = await tools.get("spawn_agent")!("prepared", { task_name: "prepared", message: "m", profile: "writer", workspace_path: "relative/worktree" }, undefined, undefined, ctx);
      assert.equal(res.isError, true);
      assert.match(res.content[0]!.text, /INVALID: workspace_path must be an absolute path/);
    } finally {
      await handlers.get("session_shutdown")!({ reason: "quit" }, ctx);
    }
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("repo_path is exposed only by the governing schema and mapped to source selection", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-repo-tool-"));
  const agentDir = join(dir, "agent");
  const projects = join(dir, "projects");
  const repo = join(projects, "child");
  mkdirSync(agentDir);
  mkdirSync(repo, { recursive: true });
  const git = (...args: string[]): string => {
    const result = spawnSync("git", ["-C", repo, "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  writeFileSync(join(repo, "file.txt"), "base\n");
  git("init", "-q");
  git("add", "file.txt");
  git("commit", "-qm", "base");
  writeFileSync(join(repo, "file.txt"), "dirty source\n");
  const registrations = git("worktree", "list", "--porcelain");
  const extension = await loadExtension(agentDir);
  const ctx = { ...(extension.ctx as object), cwd: projects };
  try {
    assert.ok(extension.schemas.get("spawn_agent")!.properties!["repo_path"]);
    assert.match(extension.descriptions.get("spawn_agent")!, /repo_path selects a committed Git top-level/);
    const childSchema = childToolSpec<TSchema>(Type, "spawn_agent").parameters as Schema;
    assert.equal(childSchema.properties!["repo_path"], undefined);
    const spawn = extension.tools.get("spawn_agent")!;
    const relative = await spawn("relative", { task_name: "relative", message: "m", profile: "writer", repo_path: "child" }, undefined, undefined, ctx);
    assert.equal(relative.isError, true);
    assert.match(relative.content[0]!.text, /INVALID: repo_path must be an absolute path/);
    const selected = await spawn("selected", { task_name: "selected", message: "m", profile: "writer", repo_path: repo }, undefined, undefined, ctx);
    assert.equal(selected.isError, true);
    assert.match(selected.content[0]!.text, /CONFLICT: checkout has uncommitted changes; supply an explicit base_commit/);
    assert.equal(git("worktree", "list", "--porcelain"), registrations);
    const status = await extension.tools.get("list_agents")!("status", {}, undefined, undefined, ctx);
    assert.deepEqual((JSON.parse(status.content[0]!.text) as { agents: unknown[] }).agents, []);
  } finally {
    await extension.handlers.get("session_shutdown")!({ reason: "quit" }, ctx);
    rmSync(dir, { recursive: true, force: true });
  }
});
