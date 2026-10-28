/**
 * What the governing session is told about a child's reach: which external
 * tools its grant holds, and that external state it relays or answers with
 * must be freshly observed, with source and observation time.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PinnedGoverningHandle } from "../src/governing-runtime.ts";
import { mkSup, tick } from "./ctl-worker.ts";
import { DELEGATION_GUIDELINES, childToolGuidelines } from "../src/tools.ts";

const CG = "mcp__codegraph__codegraph_explore";
const MR_READ = "mcp__gitlab__get_merge_request";
const MR_CREATE = "mcp__gitlab__create_merge_request";

function handle(name: string): PinnedGoverningHandle {
  return { name, description: `${name} d`, parameters: { type: "object" }, execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }) };
}

test("list_agents shows the external tools each child's grant holds", async () => {
  const handles = [handle(CG), handle(MR_READ), handle(MR_CREATE)];
  const built = mkSup({
    policy: (p) => { p.allowedTools = [CG, MR_READ]; },
    governingRegistry: () => ({ isActive: () => true, listHandles: () => handles, getHandle: (n: string) => handles.find((h) => h.name === n), baseCtx: () => ({}) }),
  });
  const spawned = await built.sup.spawn("governor", { taskName: "book", message: "m", profile: "writer", isolation: "none" }, "evidence-1");
  await tick();
  const view = built.sup.list("governor").find((v) => v.id === spawned.agentId);
  assert.ok(view);
  assert.deepEqual(view.externalTools, [CG, MR_READ]);
  assert.deepEqual(built.sup.read("governor", spawned.agentId, "status", 0, 1, null).status.externalTools, [CG, MR_READ]);
});

type Registered = { name: string; description: string; promptGuidelines?: string[] };

async function governingTools(): Promise<Map<string, Registered>> {
  const tools = new Map<string, Registered>();
  const pi = {
    registerTool: (t: Registered) => { tools.set(t.name, t); },
    registerCommand: () => {},
    on: () => {},
    enqueueMessage: () => {},
    getThinkingLevel: () => "low",
  };
  const mod = (await import("../index.ts")) as { default: (api: unknown) => void };
  mod.default(pi);
  return tools;
}

test("the governing session is told to give children fresh, attributed external state", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "subagents-evidence-"));
  process.env["PI_CODING_AGENT_DIR"] = agentDir;
  try {
    const tools = await governingTools();
    const spawn = (tools.get("spawn_agent")!.promptGuidelines ?? []).join("\n");
    assert.match(spawn, /externalTools/);
    assert.match(spawn, /source and observation time/);
    const reply = (tools.get("send_message")!.promptGuidelines ?? []).join("\n");
    assert.match(reply, /read it again/);
    assert.match(reply, /source and observation time/);
    assert.match(reply, /not current state/);
    assert.match(tools.get("list_agents")!.description, /external tools/);
  } finally { rmSync(agentDir, { recursive: true, force: true }); }
});

test("nesting children receive the same delegation guidelines as the governing session", () => {
  assert.deepEqual(childToolGuidelines("spawn_agent"), DELEGATION_GUIDELINES.spawn_agent);
  assert.deepEqual(childToolGuidelines("send_message"), DELEGATION_GUIDELINES.send_message);
  assert.deepEqual(childToolGuidelines("read"), []);
});
