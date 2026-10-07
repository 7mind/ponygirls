/** Extension wiring: the border badge follows unfinished tasks. */
import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { advanceStatusEpisode } from "../index.ts";
import { defer, eventually, tempDir } from "./fixtures.ts";

type BadgeFactory = () => { render(): string[]; handleMouse?: (event: unknown) => unknown };
type StatusEntry = [string, BadgeFactory | undefined, ({ placement: "borderBottomLeft" } | undefined)?];

/** The published badge's first rendered line. */
function badgeLine(factory: unknown): string {
  return (factory as BadgeFactory)().render()[0] ?? "";
}

test("border badge shows running tasks and clears when none remain", async (t) => {
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
      setWidget: (...args: StatusEntry) => { statuses.push(args); },
      theme: { bg: (_color: string, text: string) => text },
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

  await eventually(async () => (statuses.some(([k, v]) => k === "bg" && v !== undefined && badgeLine(v) === " bg 1 running ") ? true : null), "running status");
  const mark = statuses.length;

  await tool.execute("terminate-1" as never, { action: "terminate", id } as never, undefined as never);
  await eventually(async () => (statuses.slice(mark).some(([k, v]) => k === "bg" && v === undefined) ? true : null), "status clear after finish");

  await tool.execute("clear-1" as never, { action: "clear", id } as never, undefined as never);
  assert.ok(statuses.slice(mark).every(([k]) => k === "bg"));
});

test("outage episodes keep the badge and report once until recovery", () => {
  const episode = { statusError: null as string | null };
  assert.equal(advanceStatusEpisode(episode, false, ""), null);
  assert.equal(episode.statusError, null);
  const first = advanceStatusEpisode(episode, true, "NO_PERSISTENT_SESSION");
  assert.ok(first?.text.includes("unreachable") && first?.text.includes("NO_PERSISTENT_SESSION"));
  assert.equal(first?.status, "unavailable");
  assert.equal(episode.statusError, "NO_PERSISTENT_SESSION");
  assert.equal(advanceStatusEpisode(episode, true, "NO_PERSISTENT_SESSION"), null);
  const changed = advanceStatusEpisode(episode, true, "boom");
  assert.ok(changed?.text.includes("boom"));
  const recovered = advanceStatusEpisode(episode, false, "");
  assert.equal(recovered?.status, "recovered");
  assert.ok(recovered?.text.includes("reachable again"));
  assert.equal(episode.statusError, null);
  assert.equal(advanceStatusEpisode(episode, false, ""), null);
});

test("a status-backend outage keeps the badge and reports once per episode", async (t) => {
  const statuses: StatusEntry[] = [];
  const sent: Array<{ content: string }> = [];
  const handlers = new Map<string, (...args: never[]) => Promise<unknown>>();
  const pi = {
    registerTool: () => {},
    registerCommand: () => {},
    registerMessageRenderer: () => {},
    on: (event: string, handler: (...args: never[]) => Promise<unknown>) => { handlers.set(event, handler); },
    sendMessage: (message: unknown) => { sent.push(message as { content: string }); },
  };
  const mod = (await import("../index.ts")) as { default: (api: unknown) => void };
  mod.default(pi);
  // No session file: the status backend is unreachable (NO_PERSISTENT_SESSION).
  const ctx = {
    sessionManager: {
      getSessionId: () => "bg-status-outage",
      getSessionFile: () => null,
      getEntries: () => [],
    },
    ui: {
      setWidget: (...args: StatusEntry) => { statuses.push(args); },
      theme: { bg: (_color: string, text: string) => text },
      notify: () => {},
    },
    hasUI: true,
    isIdle: () => true,
  };
  await handlers.get("session_start")!({} as never, ctx as never);
  defer(t, () => handlers.get("session_shutdown")!({ reason: "quit" } as never));

  await eventually(async () => (sent.length === 1 ? true : null), "outage notice");
  assert.match(sent[0]!.content, /unreachable/);
  assert.match(sent[0]!.content, /NO_PERSISTENT_SESSION/);
  // The badge is kept, never cleared: no clear was published.
  assert.ok(!statuses.some(([k, v]) => k === "bg" && v === undefined), "no badge clear on outage");
  // A repeated failure in the same episode stays silent.
  await handlers.get("turn_end")!({} as never, ctx as never);
  await new Promise((resolve) => setTimeout(resolve, 300));
  await handlers.get("turn_end")!({} as never, ctx as never);
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(sent.length, 1);
});
