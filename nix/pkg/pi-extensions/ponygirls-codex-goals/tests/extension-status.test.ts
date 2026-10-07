/** Extension wiring: the border goal badge follows the persisted goal. */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type StatusEntry = [string, string[] | undefined, ({ placement: "borderBottomLeft" } | undefined)?];

test("border goal badge follows create, pause, resume, and complete", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "goals-status-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sessionFile = join(dir, "session.jsonl");
  const statuses: StatusEntry[] = [];
  const tools = new Map<string, { execute: (...args: never[]) => Promise<{ content: Array<{ text: string }> }> }>();
  const commands = new Map<string, { handler: (...args: never[]) => Promise<unknown> }>();
  const handlers = new Map<string, (...args: never[]) => Promise<unknown>>();
  const pi = {
    registerTool: (tool: { name: string }) => { tools.set(tool.name, tool as never as { execute: (...args: never[]) => Promise<{ content: Array<{ text: string }> }> }); },
    registerCommand: (name: string, cmd: { handler: (...args: never[]) => Promise<unknown> }) => { commands.set(name, cmd); },
    registerMessageRenderer: () => {},
    registerEntryRenderer: () => {},
    on: (event: string, handler: (...args: never[]) => Promise<unknown>) => { handlers.set(event, handler); },
    getCommands: () => [],
    sendMessage: () => {},
    sendUserMessage: () => {},
    appendEntry: () => {},
  };
  const mod = (await import("../index.ts")) as { default: (api: unknown) => void };
  mod.default(pi);
  const sessionManager = {
    getSessionId: () => "goals-status-test",
    getSessionFile: () => sessionFile,
    getEntries: () => [] as never[],
  };
  const ui = {
    notify: () => {},
    setWidget: (...args: StatusEntry) => { statuses.push(args); },
    theme: { bg: (_color: string, text: string) => text },
    confirm: async () => true,
  };
  const startCtx = { sessionManager, ui, isIdle: () => true, hasPendingMessages: () => false, mode: "rpc", hasUI: false };
  await handlers.get("session_start")!({} as never, startCtx as never);
  assert.deepEqual(statuses.at(-1), ["goal", undefined]);

  const cmdCtx = { ...startCtx, abort: () => {} };
  await commands.get("goal")!.handler("status test objective" as never, cmdCtx as never);
  assert.deepEqual(statuses.at(-1), ["goal", [" goal active "], { placement: "borderBottomLeft" }]);

  await commands.get("goal")!.handler("pause" as never, cmdCtx as never);
  assert.deepEqual(statuses.at(-1), ["goal", [" goal paused "], { placement: "borderBottomLeft" }]);

  await commands.get("goal")!.handler("resume" as never, cmdCtx as never);
  assert.deepEqual(statuses.at(-1), ["goal", [" goal active "], { placement: "borderBottomLeft" }]);

  const done = await tools.get("update_goal")!.execute("u1" as never, { status: "complete" } as never, undefined as never, undefined as never, { sessionManager, ui } as never);
  assert.match(done.content[0]!.text, /complete/);
  assert.deepEqual(statuses.at(-1), ["goal", undefined]);

  await handlers.get("session_shutdown")!({} as never, { sessionManager, ui } as never);
  assert.deepEqual(statuses.at(-1), ["goal", undefined]);
});
