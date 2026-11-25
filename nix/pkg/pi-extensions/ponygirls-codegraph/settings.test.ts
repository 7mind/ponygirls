import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG_DIR_NAME, createEventBus, SessionManager, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import codegraph from "./index.ts";
import { isolateAgentConfig } from "./test-fixtures.ts";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

async function fixture(t: TestContext, launchDisabled = false) {
  const root = await mkdtemp(join(tmpdir(), "cg-settings-"));
  const agent = isolateAgentConfig(t, root);
  const config = join(root, CONFIG_DIR_NAME);
  await mkdir(config);
  const previous = process.env.SMIND_CODEGRAPH_DISABLED;
  if (launchDisabled) process.env.SMIND_CODEGRAPH_DISABLED = "1";
  else delete process.env.SMIND_CODEGRAPH_DISABLED;
  t.after(() => {
    if (previous === undefined) delete process.env.SMIND_CODEGRAPH_DISABLED;
    else process.env.SMIND_CODEGRAPH_DISABLED = previous;
  });
  let session = SessionManager.inMemory(root);
  let trusted = true;
  const notices: { text: string; level: string }[] = [];
  const handlers = new Map<string, Handler>();
  let command: ((args: string, ctx: ExtensionContext) => Promise<void>) | undefined;
  codegraph({
    on: (event: string, handler: Handler) => handlers.set(event, handler),
    registerCommand(_name: string, entry: { handler: typeof command }) { command = entry.handler; },
    appendEntry(type: string, data: unknown) { session.appendCustomEntry(type, data); },
    events: createEventBus(),
  } as unknown as ExtensionAPI);
  assert.ok(command);
  const ctx = {
    cwd: root, mode: "rpc", hasUI: true,
    get sessionManager() { return session; }, isProjectTrusted: () => trusted,
    ui: {
      custom: () => assert.fail("no TUI in RPC mode"),
      notify: (text: string, level: string) => notices.push({ text, level }),
    },
  } as unknown as ExtensionContext;
  const emit = (event: string, data: object = {}) => handlers.get(event)!({ type: event, ...data }, ctx);
  t.after(async () => {
    await emit("session_shutdown", { reason: "quit" });
    // This fixture owns the scratch directory and its Codegraph test files.
    await rm(root, { recursive: true, force: true });
  });
  return {
    global: join(agent, "codegraph.json"), project: join(config, "codegraph.json"), ctx, notices, emit,
    trust: (value: boolean) => { trusted = value; },
    newSession: () => { session = SessionManager.inMemory(root); },
    cg: (args: string, context = ctx) => command!(args, context),
    async inventory() { return (await emit("before_agent_start") as { message: { content: string } }).message.content; },
    async preference(expected: string) {
      await command!("settings", ctx);
      assert.match(notices.at(-1)!.text, new RegExp(expected));
    },
  };
}

// Specified Behavioral-Active / Effectual-Group: scoped commands with real stores and native Pi session records.
test("Codegraph scopes resolve session, trusted project, global, then default; inherit clears only its scope", async (t) => {
  const f = await fixture(t);
  f.emit("session_start", { reason: "startup" });
  await f.preference("ON · default");
  await assert.rejects(readFile(f.global), { code: "ENOENT" });
  assert.match(await f.inventory(), /Codegraph project inventory/);

  await f.cg("global off");
  assert.match(f.notices.at(-1)!.text, /OFF · global/);
  assert.match(await f.inventory(), /automatic Codegraph preparation\/routing is off/);
  await f.cg("project on");
  await f.preference("ON · project");
  await f.cg("off");
  await f.preference("OFF · session");
  await f.emit("session_shutdown", { reason: "reload" });
  f.emit("session_start", { reason: "reload" });
  await f.preference("OFF · session");
  await f.emit("session_tree");
  await f.preference("OFF · session");

  await f.cg("inherit");
  await f.preference("ON · project");
  await f.cg("project inherit");
  await f.preference("OFF · global");
  await f.cg("on");
  await f.preference("ON · session");
  await f.emit("session_shutdown", { reason: "new" });
  f.newSession();
  f.emit("session_start", { reason: "new" });
  await f.preference("OFF · global");
  await f.cg("global inherit");
  await f.preference("ON · default");
  assert.deepEqual(JSON.parse(await readFile(f.global, "utf8")), { version: 2 });
  assert.deepEqual(JSON.parse(await readFile(f.project, "utf8")), { version: 1 });
});

test("an unreadable policy cannot start automation; an untrusted project policy is neither read nor written", async (t) => {
  const f = await fixture(t);
  const malformed = '{"enabled": bad}\n';
  await writeFile(f.project, malformed);
  f.trust(false);
  f.emit("session_start", { reason: "startup" });
  await f.preference("ON · default");
  await f.cg("project off");
  assert.match(f.notices.at(-1)!.text, /require a trusted project/);
  assert.equal(await readFile(f.project, "utf8"), malformed);

  f.trust(true);
  assert.match(await f.inventory(), /automatic Codegraph preparation\/routing is off/);
  assert.equal(f.notices.at(-1)!.level, "error");
  assert.match(f.notices.at(-1)!.text, /Invalid project toggle preferences/);
  const input = { projectPath: "./not canonicalized" };
  assert.equal(await f.emit("tool_call", { toolName: "mcp__codegraph__codegraph_explore", input }), undefined);
  assert.equal(input.projectPath, "./not canonicalized");
  assert.equal(await readFile(f.project, "utf8"), malformed);
  await writeFile(f.project, '{"version":1,"enabled":true}\n');
  assert.match(await f.inventory(), /Codegraph project inventory/, "a later agent start sees a repaired policy");
});

test("an aborted model run does not cancel the operator's /cg off command", async (t) => {
  const f = await fixture(t);
  f.emit("session_start", { reason: "startup" });
  await f.preference("ON · default");
  // Pi can dispatch a slash command while the aborted agent run is still draining.
  await f.cg("off", { ...f.ctx, signal: AbortSignal.abort() });
  assert.match(f.notices.at(-1)!.text, /OFF · session/);
  assert.match(await f.inventory(), /automatic Codegraph preparation\/routing is off/);
});

test("the launch veto survives all saved preferences and settings are text only outside the TUI", async (t) => {
  const f = await fixture(t, true);
  f.emit("session_start", { reason: "startup" });
  await f.cg("on");
  assert.match(f.notices.at(-1)!.text, /OFF · session preference ON.*SMIND_CODEGRAPH_DISABLED=1/);
  assert.match(await f.inventory(), /automatic Codegraph preparation\/routing is off/);
  const json = { ...f.ctx, mode: "json", hasUI: false } as ExtensionContext;
  const diagnostics = t.mock.method(console, "error", () => {});
  const stdout = t.mock.method(console, "log", () => {});
  await f.cg("settings", json);
  assert.equal(stdout.mock.calls.length, 0);
  assert.match(String(diagnostics.mock.calls[0]?.arguments[0]), /SMIND_CODEGRAPH_DISABLED=1/);
});
