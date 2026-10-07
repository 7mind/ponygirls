/**
 * Extension wiring against a minimal stand-in for pi's ExtensionAPI: the
 * binding never falls back silently, and waits honour the tool abort signal.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type ToolExecute = (id: string, params: unknown, signal: AbortSignal | undefined, onUpdate: undefined, ctx: unknown) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;

type Handler = (event: unknown, ctx: unknown) => Promise<void>;

type Schema = { properties?: Record<string, Schema>; items?: Schema; anyOf?: Schema[] };

async function loadExtension(agentDir: string): Promise<{ tools: Map<string, ToolExecute>; schemas: Map<string, Schema>; handlers: Map<string, Handler>; sent: unknown[]; ctx: unknown }> {
  process.env["PI_CODING_AGENT_DIR"] = agentDir;
  process.env["PI_SUBAGENTS_SDK_ROOT"] = process.env["PI_SUBAGENTS_SDK_ROOT"] ?? "/nonexistent-sdk";
  const tools = new Map<string, ToolExecute>();
  const schemas = new Map<string, Schema>();
  const handlers = new Map<string, Handler>();
  const sent: unknown[] = [];
  const pi = {
    registerTool: (t: { name: string; execute: ToolExecute; parameters: Schema }) => {
      tools.set(t.name, t.execute);
      schemas.set(t.name, t.parameters);
    },
    registerCommand: () => {},
    on: (event: string, h: Handler) => handlers.set(event, h),
    sendMessage: (m: unknown) => sent.push(m),
    getThinkingLevel: () => "low",
  };
  const mod = (await import("../index.ts")) as { default: (api: unknown) => void };
  mod.default(pi);
  const ctx = {
    sessionManager: { getSessionId: () => "sess-1" },
    cwd: agentDir,
    model: { provider: "test", id: "model" },
    ui: { notify: () => {}, setWidget: () => {}, theme: { bg: (_color: string, text: string) => text } },
  };
  return { tools, schemas, handlers, sent, ctx };
}

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
    for (const tool of ["spawn_agent", "manage_gate"]) {
      const gate = schemas.get(tool)!.properties!["gate"]!;
      const check = gate.properties!["checks"]!.items!;
      assert.deepEqual(Object.keys(check.properties!).sort(), ["command", "id", "timeoutMs"], tool);
      assert.ok(gate.properties!["promisedOutputs"], `${tool} lacks promisedOutputs`);
    }
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
});
