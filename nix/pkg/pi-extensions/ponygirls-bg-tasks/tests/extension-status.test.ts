/** Extension wiring: the footer status follows unfinished tasks. */
import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { defer, eventually, tempDir } from "./fixtures.ts";

type StatusEntry = [string, string | undefined];

test("footer status shows running tasks and clears when none remain", async (t) => {
  const dir = tempDir(t, "bg-status-");
  const sessionFile = join(dir, "session.jsonl");
  const statuses: StatusEntry[] = [];
  const tools = new Map<string, { execute: (...args: never[]) => Promise<{ details: unknown }> }>();
  const handlers = new Map<string, (...args: never[]) => Promise<unknown>>();
  const pi = {
    registerTool: (tool: { name: string }) => { tools.set(tool.name, tool as never as { execute: (...args: never[]) => Promise<{ details: unknown }> }); },
    registerCommand: () => {},
    registerMessageRenderer: () => {},
    on: (event: string, handler: (...args: never[]) => Promise<unknown>) => { handlers.set(event, handler); },
    sendMessage: () => {},
  };
  const mod = (await import("../index.ts")) as { default: (api: unknown) => void };
  mod.default(pi);
  const ctx = {
    sessionManager: {
      getSessionId: () => "bg-status-test",
      getSessionFile: () => sessionFile,
      getEntries: () => [],
    },
    ui: {
      setStatus: (key: string, text: string | undefined) => { statuses.push([key, text]); },
      notify: () => {},
    },
    hasUI: true,
    isIdle: () => true,
  };
  await handlers.get("session_start")!({} as never, ctx as never);
  defer(t, () => handlers.get("session_shutdown")!({ reason: "quit" } as never));

  // No tasks yet: the indicator clears rather than going stale.
  await eventually(async () => (statuses.some(([k, v]) => k === "bg" && v === undefined) ? true : null), "initial status clear");

  const tool = tools.get("bg_task")!;
  const spawned = await tool.execute("spawn-1" as never, { action: "spawn", label: "sleepy", command: "sleep 30", cwd: dir, notify: true } as never, undefined as never);
  const id = (spawned.details as { task: { id: string } }).task.id;
  assert.ok(id);

  await eventually(async () => (statuses.some(([k, v]) => k === "bg" && v === "bg 1 running") ? true : null), "running status");
  const mark = statuses.length;

  await tool.execute("terminate-1" as never, { action: "terminate", id } as never, undefined as never);
  await eventually(async () => (statuses.slice(mark).some(([k, v]) => k === "bg" && v === undefined) ? true : null), "status clear after finish");

  await tool.execute("clear-1" as never, { action: "clear", id } as never, undefined as never);
  assert.ok(statuses.slice(mark).every(([k]) => k === "bg"));
});
