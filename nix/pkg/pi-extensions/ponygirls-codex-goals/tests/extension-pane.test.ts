/** Extension wiring: /goal opens the pane, its keys run the /goal subcommands; transcript renderers collapse and expand. */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { GoalRecord } from "../src/goal.ts";
import { renderContinuation, renderKickoff } from "../src/prompts.ts";

interface PaneLike {
  render(width: number): string[];
  handleInput(data: string): void;
}
interface Rendered {
  render(width: number): string[];
}
type MessageRenderer = (message: unknown, options: { expanded: boolean; outputPad: number }, theme: unknown) => Rendered | undefined;
type EntryRenderer = (entry: unknown, options: { expanded: boolean }, theme: unknown) => Rendered | undefined;
type Handler = (...args: never[]) => Promise<unknown>;
interface ToolRow { args: unknown; expanded: boolean; isPartial: boolean; isError: boolean }
interface ToolResultView { content: Array<{ type: string; text: string }>; details: undefined }
interface RegisteredTool {
  name: string;
  renderCall(args: unknown, theme: unknown, context: ToolRow): Rendered;
  renderResult(result: ToolResultView, options: { expanded: boolean; isPartial: boolean }, theme: unknown, context: ToolRow): Rendered;
}

const plainTheme = { fg: (_c: string, text: string) => text, bg: (_c: string, text: string) => text, bold: (text: string) => text };

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

async function load(t: test.TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "goals-pane-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sessionFile = join(dir, "session.jsonl");
  const commands = new Map<string, { description: string; handler: Handler }>();
  const tools = new Map<string, RegisteredTool>();
  const handlers = new Map<string, Handler>();
  const messageRenderers = new Map<string, MessageRenderer>();
  const entryRenderers = new Map<string, EntryRenderer>();
  const entries: Array<{ customType: string; data: Record<string, unknown> }> = [];
  const userMessages: string[] = [];
  const notices: string[] = [];
  const confirms: boolean[] = [];
  let badge: { handleMouse(event: { type: string; button: string }): unknown } | undefined;
  let opens = 0;
  let closes = 0;
  let pane: PaneLike | undefined;
  let closePane: (() => void) | undefined;
  const pi = {
    registerTool: (tool: RegisteredTool) => { tools.set(tool.name, tool); },
    registerCommand: (name: string, cmd: { description: string; handler: Handler }) => { commands.set(name, cmd); },
    registerMessageRenderer: (type: string, renderer: MessageRenderer) => { messageRenderers.set(type, renderer); },
    registerEntryRenderer: (type: string, renderer: EntryRenderer) => { entryRenderers.set(type, renderer); },
    on: (event: string, handler: Handler) => { handlers.set(event, handler); },
    getCommands: () => [],
    sendMessage: () => {},
    sendUserMessage: (content: string) => { userMessages.push(content); },
    appendEntry: (customType: string, data: Record<string, unknown>) => { entries.push({ customType, data }); },
  };
  const mod = (await import("../index.ts")) as { default: (api: unknown) => void };
  mod.default(pi);
  const sessionManager = {
    getSessionId: () => "goals-pane-test",
    getSessionFile: () => sessionFile,
    getEntries: () => [] as never[],
  };
  const ui = {
    notify: (message: string) => { notices.push(message); },
    setWidget: (_key: string, factory: (() => typeof badge) | undefined) => { badge = factory?.(); },
    theme: plainTheme,
    confirm: async () => confirms.shift() ?? false,
    editor: async () => "edited objective",
    custom: (factory: (tui: unknown, theme: unknown, kb: unknown, done: () => void) => PaneLike) =>
      new Promise<void>((resolve) => {
        opens += 1;
        closePane = resolve;
        pane = factory({ requestRender: () => {} }, plainTheme, {}, () => { closes += 1; resolve(); });
      }),
  };
  const ctx = { sessionManager, ui, isIdle: () => true, hasPendingMessages: () => false, mode: "tui", hasUI: true, abort: () => {} };
  await handlers.get("session_start")!({ reason: "startup" } as never, ctx as never);
  const goal = (): GoalRecord | null => JSON.parse(readFileSync(`${sessionFile}.codex-goals.json`, "utf8")).goal;
  return {
    ctx, commands, tools, messageRenderers, entryRenderers, entries, userMessages, notices, confirms, goal,
    pane: () => pane!,
    badge: () => badge!, opens: () => opens, closes: () => closes, handlers,
    closed: () => closePane === undefined,
  };
}

test("pane keys pause, resume, edit, and clear through the /goal subcommands", async (t) => {
  const f = await load(t);
  const goal = f.commands.get("goal")!;
  await goal.handler("pane objective" as never, f.ctx as never);
  assert.equal(f.goal()!.status, "active");
  const shown = goal.handler("" as never, f.ctx as never);
  await settle();
  assert.match(f.pane().render(100)[0]!, /◎ active/);

  f.pane().handleInput("p");
  await settle();
  assert.equal(f.goal()!.status, "paused");
  const pause = f.entries.find((e) => e.customType === "codex-goal-notice" && e.data.event === "paused")!;
  assert.match(String(pause.data.text), /^Goal paused \(.+\)\.$/);
  assert.equal(typeof pause.data.revision, "number");
  assert.ok(!f.notices.includes("Goal paused."), "the TUI transcript notice is not repeated as a status line");
  assert.match(f.pane().render(100).join("\n"), /◉ paused[\s\S]*r resume/);

  f.pane().handleInput("r");
  await settle();
  assert.equal(f.goal()!.status, "active");
  assert.deepEqual(f.userMessages, ["pane objective", "pane objective"]);

  f.pane().handleInput("e");
  await settle();
  assert.equal(f.goal()!.objective, "edited objective");

  f.confirms.push(false);
  f.pane().handleInput("c");
  await settle();
  assert.equal(f.goal()!.status, "active", "declining the confirmation keeps the goal");
  f.confirms.push(true);
  f.pane().handleInput("c");
  await settle();
  assert.equal(f.goal(), null);
  assert.ok(f.entries.some((e) => e.customType === "codex-goal-notice" && e.data.text === "Goal cleared. Transcript entries retained."));
  assert.ok(!f.notices.includes("Goal cleared. Transcript entries retained."));
  assert.match(f.pane().render(100).join("\n"), /No goal\. \/goal <objective> sets one\./);

  f.pane().handleInput("\x1b");
  await shown;
});

test("/goal alone opens the pane and leaves the transcript alone; other modes get the status as before", async (t) => {
  const f = await load(t);
  const goal = f.commands.get("goal")!;
  assert.equal(goal.description, "Session goal: set, pause, resume, edit, clear");
  const shown = goal.handler("" as never, f.ctx as never);
  await settle();
  assert.equal(f.opens(), 1);
  assert.deepEqual(f.entries.map((e) => e.customType), [], "the pane already shows the status; no echo is appended");
  assert.deepEqual(f.notices, []);
  f.pane().handleInput("\x1b");
  await shown;

  await goal.handler("" as never, { ...f.ctx, mode: "rpc", hasUI: false } as never);
  assert.equal(f.opens(), 1);
  assert.deepEqual(f.notices, ["No current goal (rev 0)."]);
  assert.deepEqual(f.entries.map((e) => [e.customType, e.data.text]), [["codex-goal-notice", "No current goal (rev 0)."]]);
});

const kickoffGoal: GoalRecord = {
  id: "goal-1" as GoalRecord["id"],
  objective: "Improve the UX\nof every extension",
  status: "active",
  tokenBudget: null,
  tokensUsed: 0,
  timeUsedSeconds: 0,
  createdAt: "2026-10-30T20:46:48.973Z",
  updatedAt: "2026-10-30T20:46:48.973Z",
};

test("goal instructions collapse to one line and expand to pi's full default rendering", async (t) => {
  const f = await load(t);
  const render = f.messageRenderers.get("codex-goal-context")!;
  const kickoff = renderKickoff(kickoffGoal, 1);
  const message = { role: "custom", customType: "codex-goal-context", content: kickoff, display: true, timestamp: 0 };
  const collapsed = render(message, { expanded: false, outputPad: 1 }, plainTheme)!.render(200);
  assert.equal(collapsed.length, 1);
  assert.match(collapsed[0]!, new RegExp(`^ ◎ goal · kickoff · active · “Improve the UX of every extension” · ${kickoff.split("\n").length} lines(?: ▸ \\S+)? *$`));
  assert.equal(visibleWidth(render(message, { expanded: false, outputPad: 1 }, plainTheme)!.render(30)[0]!), 30);
  assert.equal(render(message, { expanded: true, outputPad: 1 }, plainTheme), undefined, "expanded falls back to the full default text");

  const continuation = { ...message, content: renderContinuation({ ...kickoffGoal, status: "active" }, 5, 3) };
  assert.match(render(continuation, { expanded: false, outputPad: 1 }, plainTheme)!.render(200)[0]!, /◎ goal · continuation 3 · active · \d+ lines/);
  const foreign = { ...message, content: "not a goal instruction" };
  assert.equal(render(foreign, { expanded: false, outputPad: 1 }, plainTheme), undefined);
});

test("commit entries draw nothing collapsed, a clear is one line, pause notices collapse; expanded they show today's text", async (t) => {
  const f = await load(t);
  const commit = f.entryRenderers.get("codex-goal-commit")!;
  const data = { sessionId: "s", goalId: "g", revision: 2 };
  assert.equal(commit({ type: "custom", customType: "codex-goal-commit", data }, { expanded: false }, plainTheme), undefined, "bookkeeping: no component, so pi adds no row");
  const tombstone = { sessionId: "s", goalId: null, revision: 9, tombstone: true };
  const cleared = commit({ type: "custom", customType: "codex-goal-commit", data: tombstone }, { expanded: false }, plainTheme)!;
  assert.deepEqual(cleared.render(80).map((line) => line.trimEnd()), [" 🎯 goal cleared"]);
  for (const width of [60, 80, 100, 120, 170]) assert.equal(visibleWidth(cleared.render(width)[0]!), width);
  assert.equal(commit({ type: "custom", customType: "codex-goal-commit", data }, { expanded: true }, plainTheme)!.render(200)[0]!.trimEnd(), `[codex-goal-commit] ${JSON.stringify(data)}`);
  assert.equal(commit({ type: "custom", customType: "codex-goal-commit", data: tombstone }, { expanded: true }, plainTheme)!.render(200)[0]!.trimEnd(), `[codex-goal-commit] ${JSON.stringify(tombstone)}`);

  const notice = f.entryRenderers.get("codex-goal-notice")!;
  const pause = { text: "Goal paused (g).", at: "2026-10-30T20:46:55.412Z", event: "paused", goalId: "g", revision: 474, timeUsedSeconds: 6 };
  const collapsed = notice({ type: "custom", customType: "codex-goal-notice", data: pause }, { expanded: false }, plainTheme)!.render(120);
  assert.deepEqual(collapsed.map((line) => line.trimEnd()), [" ◉ goal paused · rev 474 · 6s · /goal resume"]);
  assert.equal(notice({ type: "custom", customType: "codex-goal-notice", data: pause }, { expanded: true }, plainTheme)!.render(120)[0]!.trimEnd(), "Goal paused (g).");
  const legacy = { text: "Goal paused (g).", at: "2026-10-30T20:46:55.412Z" };
  assert.equal(notice({ type: "custom", customType: "codex-goal-notice", data: legacy }, { expanded: false }, plainTheme)!.render(120)[0]!.trimEnd(), "Goal paused (g).");

  // The tombstone commit before it already draws the one line for a clear.
  const clearedNotice = { text: "Goal cleared. Transcript entries retained.", at: "2026-10-30T20:47:00.000Z" };
  assert.equal(notice({ type: "custom", customType: "codex-goal-notice", data: clearedNotice }, { expanded: false }, plainTheme), undefined);
  assert.equal(notice({ type: "custom", customType: "codex-goal-notice", data: clearedNotice }, { expanded: true }, plainTheme)!.render(120)[0]!.trimEnd(), "Goal cleared. Transcript entries retained.");
});

test("/goal clear leaves a tombstone commit followed by its notice, so one of them draws the line", async (t) => {
  const f = await load(t);
  const goal = f.commands.get("goal")!;
  await goal.handler("objective to clear" as never, f.ctx as never);
  assert.equal(f.goal()!.status, "active");
  await goal.handler("clear" as never, f.ctx as never);
  const tail = f.entries.slice(-2);
  assert.deepEqual(tail.map((e) => e.customType), ["codex-goal-commit", "codex-goal-notice"]);
  assert.equal(tail[0]!.data.tombstone, true);
  assert.equal(tail[1]!.data.text, "Goal cleared. Transcript entries retained.");
  const drawn = [
    f.entryRenderers.get("codex-goal-commit")!({ type: "custom", customType: "codex-goal-commit", data: tail[0]!.data }, { expanded: false }, plainTheme),
    f.entryRenderers.get("codex-goal-notice")!({ type: "custom", customType: "codex-goal-notice", data: tail[1]!.data }, { expanded: false }, plainTheme),
  ].flatMap((component) => (component === undefined ? [] : component.render(80).map((line) => line.trimEnd())));
  assert.deepEqual(drawn, [" 🎯 goal cleared"]);
});

const toolText = (text: string): ToolResultView => ({ content: [{ type: "text", text }], details: undefined });

/** One tool row as pi composes it: the call component, then the result component once there is a result. */
function toolRow(tool: RegisteredTool, args: unknown, result: { text: string; isError: boolean } | null, expanded: boolean, width: number): string[] {
  const context: ToolRow = { args, expanded, isPartial: result === null, isError: result?.isError ?? false };
  const call = tool.renderCall(args, plainTheme, context).render(width);
  if (result === null) return call;
  return [...call, ...tool.renderResult(toolText(result.text), { expanded, isPartial: false }, plainTheme, context).render(width)].map((line) => line.trimEnd());
}

test("goal tool rows are one line collapsed; errors and the expanded form keep the full text", async (t) => {
  const f = await load(t);
  const get = f.tools.get("get_goal")!;
  const create = f.tools.get("create_goal")!;
  const update = f.tools.get("update_goal")!;
  const state = "Goal 3f2a9c1e-5b7d-4e80-a1c4-9d6e2f0b8a37: status active. Objective: Say the word ok, then immediately mark this goal complete with update_goal.. Used 0 tokens in 0.0s.";
  const done = "Goal 3f2a9c1e-5b7d-4e80-a1c4-9d6e2f0b8a37 is now complete. Report the successful result and final usage in your visible follow-up reply; it remains in the transcript.";
  const created = "Goal created (3f2a9c1e-5b7d-4e80-a1c4-9d6e2f0b8a37). Objective: Ship the release. Status: active.";

  assert.deepEqual(toolRow(get, {}, null, false, 120), ["get_goal"]);
  assert.deepEqual(toolRow(get, {}, { text: state, isError: false }, false, 120), ["get_goal → active · 0 tokens · 0s"]);
  assert.deepEqual(toolRow(get, {}, { text: "No current goal. State observations cannot declare completion.", isError: false }, false, 120), ["get_goal → no goal"]);
  assert.deepEqual(toolRow(update, { status: "complete" }, null, false, 120), ["update_goal complete"]);
  assert.deepEqual(toolRow(update, { status: "complete" }, { text: done, isError: false }, false, 120), ["update_goal complete"]);
  assert.deepEqual(toolRow(create, { objective: "Ship the release" }, { text: created, isError: false }, false, 120), ["create_goal → set · “Ship the release”"]);

  const rejected = "update_goal rejected: no current goal.";
  assert.deepEqual(toolRow(update, { status: "blocked" }, { text: rejected, isError: true }, false, 120), ["update_goal blocked", rejected]);

  assert.deepEqual(toolRow(get, {}, { text: state, isError: false }, true, 200), ["get_goal", state]);
  assert.deepEqual(toolRow(update, { status: "complete" }, { text: done, isError: false }, true, 200), ["update_goal", "  status: complete", done]);
  assert.deepEqual(toolRow(create, { objective: "Ship the release" }, { text: created, isError: false }, true, 200), ["create_goal", "  objective: Ship the release", created]);
});

// Behavioral-Active × Blackbox × Group: command and badge share one custom interaction.
test("goal badge toggles and closes command-opened panes, then ignores shutdown callbacks", async (t) => {
  const f = await load(t);
  const goal = f.commands.get("goal")!;
  await goal.handler("toggle objective" as never, f.ctx as never);
  const badge = f.badge();
  const click = () => badge.handleMouse({ type: "click", button: "left" });
  click(); click();
  assert.equal(f.opens(), 1);
  assert.equal(f.closes(), 1);
  await settle();
  const command = goal.handler("" as never, f.ctx as never);
  await settle();
  click();
  await command;
  assert.equal(f.opens(), 2);
  assert.equal(f.closes(), 2);
  click();
  await f.handlers.get("session_shutdown")!({} as never, f.ctx as never);
  click();
  assert.equal(f.opens(), 3);
  assert.equal(f.closes(), 3);
});
