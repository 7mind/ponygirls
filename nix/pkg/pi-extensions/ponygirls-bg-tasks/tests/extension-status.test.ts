/** Extension wiring: the border badge follows unfinished tasks; status notices and when they ask for a turn. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync } from "node:fs";
import test, { type TestContext } from "node:test";
import { join } from "node:path";
import { advanceStatusEpisode, type StatusEpisode } from "../index.ts";
import { SIDECAR_SUFFIX, STATUS_CUSTOM_TYPE } from "../src/protocol.ts";
import { defer, eventually, tempDir } from "./fixtures.ts";

type BadgeFactory = () => { render(): string[]; renderCompact?: (width: number) => string; handleMouse?: (event: unknown) => unknown };
type StatusEntry = [string, BadgeFactory | undefined, ({ placement: "borderBottomLeft"; order: number } | undefined)?];

/** The published badge's first rendered line. */
function badgeLine(factory: unknown): string {
  return (factory as BadgeFactory)().render()[0] ?? "";
}

test("border badge shows running tasks and clears when none remain", async (t) => {
  const dir = tempDir(t, "bg-status-");
  const sessionFile = join(dir, "session.jsonl");
  let opens = 0;
  let closes = 0;
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
    mode: "tui",
    ui: {
      custom: (factory: (tui: unknown, theme: unknown, keys: unknown, done: () => void) => { dispose(): void }) => new Promise<void>((resolve) => {
        opens += 1;
        const component = factory({ terminal: { rows: 24 }, requestRender() {} }, { bg: (_color: string, text: string) => text, fg: (_color: string, text: string) => text }, {}, () => { closes += 1; resolve(); component.dispose(); });
      }),
      setWidget: (...args: StatusEntry) => { statuses.push(args); },
      theme: { bg: (color: string, text: string) => `[${color}]${text}`, fg: (color: string, text: string) => `<${color}>${text}` },
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

  await eventually(async () => (statuses.some(([k, v]) => k === "bg" && v !== undefined && badgeLine(v) === "[selectedBg] 🛠️ 1 ") ? true : null), "running status");
  const mark = statuses.length;
  const badge = statuses.findLast(([k, v]) => k === "bg" && v !== undefined)![1]!();
  assert.equal(badge.renderCompact?.(10), "[toolPendingBg] <accent>🛠️<text>1 ", "short form: neutral chip, running glyph, count");

  badge.handleMouse?.({ type: "click", button: "left" });
  badge.handleMouse?.({ type: "click", button: "left" });
  assert.equal(opens, 1, "rapid clicks never duplicate the task inspector");
  assert.equal(closes, 1, "second click invokes the custom completion callback");

  await tool.execute("terminate-1" as never, { action: "terminate", id } as never, undefined as never);
  await eventually(async () => (statuses.slice(mark).some(([k, v]) => k === "bg" && v === undefined) ? true : null), "status clear after finish");

  await tool.execute("clear-1" as never, { action: "clear", id } as never, undefined as never);
  assert.ok(statuses.slice(mark).every(([k]) => k === "bg"));
});

function episode(): StatusEpisode {
  return { statusError: null, statusTurn: false, noSessionShown: false };
}

const outage = (error: string, taskRunning: boolean) => ({ error, noSession: false, taskRunning });

test("outage episodes keep the badge and report once until recovery", () => {
  const state = episode();
  assert.equal(advanceStatusEpisode(state, null), null);
  assert.equal(state.statusError, null);
  const first = advanceStatusEpisode(state, outage("SUPERVISOR_LOST: gone", false));
  assert.ok(first?.text.includes("unreachable") && first?.text.includes("SUPERVISOR_LOST: gone"));
  assert.equal(first?.status, "unavailable");
  assert.equal(state.statusError, "SUPERVISOR_LOST: gone");
  assert.equal(advanceStatusEpisode(state, outage("SUPERVISOR_LOST: gone", false)), null);
  const changed = advanceStatusEpisode(state, outage("boom", false));
  assert.ok(changed?.text.includes("boom"));
  const recovered = advanceStatusEpisode(state, null);
  assert.equal(recovered?.status, "recovered");
  assert.ok(recovered?.text.includes("reachable again"));
  assert.equal(state.statusError, null);
  assert.equal(advanceStatusEpisode(state, null), null);
});

test("an outage notice requests a turn only while a task is known to be running; its recovery follows it", () => {
  const idle = episode();
  assert.equal(advanceStatusEpisode(idle, outage("boom", false))?.triggerTurn, false, "nothing is running: nobody waits for a task");
  assert.equal(advanceStatusEpisode(idle, null)?.triggerTurn, false, "the recovery of a silent outage is silent");

  const waiting = episode();
  assert.equal(advanceStatusEpisode(waiting, outage("boom", true))?.triggerTurn, true, "the model may be waiting for the running task");
  assert.equal(advanceStatusEpisode(waiting, null)?.triggerTurn, true, "the model heard of the outage, so it hears of the recovery");
  assert.equal(advanceStatusEpisode(waiting, outage("boom", false))?.triggerTurn, false, "a later episode decides anew");
  assert.equal(advanceStatusEpisode(waiting, null)?.triggerTurn, false);

  const changing = episode();
  assert.equal(advanceStatusEpisode(changing, outage("first", true))?.triggerTurn, true);
  assert.equal(advanceStatusEpisode(changing, outage("second", false))?.triggerTurn, false, "each notice decides at its own time");
  assert.equal(advanceStatusEpisode(changing, null)?.triggerTurn, true, "one notice of the episode started a turn");
});

test("no persistent session is said once, never requests a turn, and is not an outage", () => {
  const state = episode();
  const noSession = { error: "NO_PERSISTENT_SESSION: background tasks need a persistent session file (not --no-session)", noSession: true, taskRunning: true };
  const first = advanceStatusEpisode(state, noSession);
  assert.equal(first?.status, "unavailable");
  assert.equal(first?.triggerTurn, false);
  assert.ok(first?.text.includes(noSession.error), "the model-visible text keeps the error code");
  assert.equal(advanceStatusEpisode(state, noSession), null);
  assert.equal(advanceStatusEpisode(state, outage("boom", false))?.status, "unavailable");
  assert.equal(advanceStatusEpisode(state, noSession), null, "at most once per session, whatever happens in between");
  assert.equal(advanceStatusEpisode(state, null)?.status, "recovered", "the outage in between still recovers");
  const sessionOnly = episode();
  advanceStatusEpisode(sessionOnly, noSession);
  assert.equal(advanceStatusEpisode(sessionOnly, null), null, "no recovery notice without an outage");
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
      theme: { bg: (color: string, text: string) => `[${color}]${text}`, fg: (color: string, text: string) => `<${color}>${text}` },
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

interface SentNotice {
  message: { customType: string; content: string; details: { status?: string } };
  options: { deliverAs?: string; triggerTurn?: boolean } | undefined;
}

interface FakeSession {
  sent: SentNotice[];
  statuses: StatusEntry[];
  tool(name: string): { execute: (...args: never[]) => Promise<{ details: unknown }> };
  fire(event: string, payload?: object): Promise<unknown>;
}

/** The real extension bound to a faked host; `sessionFile` null is a `--no-session` run. */
async function startSession(t: TestContext, sessionId: string, sessionFile: string | null): Promise<FakeSession> {
  const sent: SentNotice[] = [];
  const statuses: StatusEntry[] = [];
  const tools = new Map<string, { execute: (...args: never[]) => Promise<{ details: unknown }> }>();
  const handlers = new Map<string, (...args: never[]) => Promise<unknown>>();
  const pi = {
    registerTool: (tool: { name: string }) => { tools.set(tool.name, tool as never as { execute: (...args: never[]) => Promise<{ details: unknown }> }); },
    registerCommand: () => {},
    registerMessageRenderer: () => {},
    on: (event: string, handler: (...args: never[]) => Promise<unknown>) => { handlers.set(event, handler); },
    sendMessage: (message: SentNotice["message"], options: SentNotice["options"]) => { sent.push({ message, options }); },
  };
  const mod = (await import("../index.ts")) as { default: (api: unknown) => void };
  mod.default(pi);
  const ctx = {
    // As in pi, a sent notice becomes a custom_message entry of the session.
    sessionManager: { getSessionId: () => sessionId, getSessionFile: () => sessionFile, getEntries: () => sent.map(({ message }) => ({ type: "custom_message", display: true, ...message })) },
    ui: {
      setWidget: (...args: StatusEntry) => { statuses.push(args); },
      theme: { bg: (color: string, text: string) => `[${color}]${text}`, fg: (color: string, text: string) => `<${color}>${text}` },
      notify: () => {},
    },
    hasUI: true,
    isIdle: () => true,
  };
  await handlers.get("session_start")!({} as never, ctx as never);
  defer(t, () => handlers.get("session_shutdown")!({ reason: "quit" } as never));
  return { sent, statuses, tool: (name) => tools.get(name)!, fire: (event, payload = {}) => handlers.get(event)!(payload as never, ctx as never) };
}

const statusNotices = (session: FakeSession) => session.sent.filter((entry) => entry.message.customType === STATUS_CUSTOM_TYPE);

// Defect A: `pi --no-session` with no input ran a model turn about this notice.
test("starting without a session file shows one notice and never asks for a model turn", async (t) => {
  const session = await startSession(t, "bg-status-no-session", null);
  await eventually(async () => (session.sent.length > 0 ? true : null), "the no-session notice");
  // Later refreshes fail the same way.
  for (let i = 0; i < 2; i++) {
    await session.fire("turn_end");
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  assert.equal(session.sent.length, 1, "shown at most once");
  const [notice] = session.sent;
  assert.equal(notice!.message.customType, STATUS_CUSTOM_TYPE);
  assert.match(notice!.message.content, /NO_PERSISTENT_SESSION/, "the expanded text keeps the error code");
  // Explicit false: without it pi would steer the notice into a running turn.
  assert.deepEqual(notice!.options, { deliverAs: "followUp", triggerTurn: false });
});

test("reloading a session without a file does not repeat its notice", async (t) => {
  const session = await startSession(t, "bg-status-no-session-reload", null);
  await eventually(async () => (session.sent.length > 0 ? true : null), "the no-session notice");
  await session.fire("session_shutdown", { reason: "reload" });
  await session.fire("session_start");
  for (let i = 0; i < 2; i++) {
    await session.fire("turn_end");
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  assert.equal(session.sent.length, 1, "the notice is already in this session's transcript");
});

test("an outage while a task is known to be running asks for a turn, and so does its recovery", async (t) => {
  const dir = tempDir(t, "bg-status-turn-");
  const sessionFile = join(dir, "session.jsonl");
  const session = await startSession(t, "bg-status-turn", sessionFile);
  await session.tool("bg_task").execute("spawn-1" as never, { action: "spawn", label: "sleepy", command: "sleep 30", cwd: dir, notify: false } as never, undefined as never);
  await eventually(async () => (session.statuses.some(([k, v]) => k === "bg" && v !== undefined && badgeLine(v) === "[selectedBg] 🛠️ 1 ") ? true : null), "the running task to be known");
  assert.deepEqual(statusNotices(session), []);

  // The supervisor dies and its successor cannot start: the status backend is unreachable.
  const sidecar = `${sessionFile}${SIDECAR_SUFFIX}`;
  chmodSync(sidecar, 0o000);
  defer(t, () => chmodSync(sidecar, 0o700));
  process.kill(Number(execFileSync("pgrep", ["-f", "--", `--sidecar ${sidecar}`], { encoding: "utf8" }).trim()), "SIGKILL");
  await eventually(async () => {
    await session.fire("turn_end");
    return statusNotices(session).length > 0 ? true : null;
  }, "the outage notice");
  const outageNotice = statusNotices(session)[0]!;
  assert.equal(outageNotice.message.details.status, "unavailable");
  assert.deepEqual(outageNotice.options, { deliverAs: "followUp", triggerTurn: true });

  chmodSync(sidecar, 0o700);
  const recovery = await eventually(async () => {
    await session.fire("turn_end");
    return statusNotices(session).find((entry) => entry.message.details.status === "recovered");
  }, "the recovery notice");
  assert.deepEqual(recovery.options, { deliverAs: "followUp", triggerTurn: true });
});
