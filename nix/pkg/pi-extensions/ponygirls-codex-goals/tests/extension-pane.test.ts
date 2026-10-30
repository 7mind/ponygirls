/** Extension wiring: /goal pane keys run the /goal subcommands; transcript renderers collapse and expand. */
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

const plainTheme = { fg: (_c: string, text: string) => text, bg: (_c: string, text: string) => text, bold: (text: string) => text };

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

async function load(t: test.TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "goals-pane-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sessionFile = join(dir, "session.jsonl");
  const commands = new Map<string, { handler: Handler }>();
  const handlers = new Map<string, Handler>();
  const messageRenderers = new Map<string, MessageRenderer>();
  const entryRenderers = new Map<string, EntryRenderer>();
  const entries: Array<{ customType: string; data: Record<string, unknown> }> = [];
  const userMessages: string[] = [];
  const notices: string[] = [];
  const confirms: boolean[] = [];
  let pane: PaneLike | undefined;
  let closePane: (() => void) | undefined;
  const pi = {
    registerTool: () => {},
    registerCommand: (name: string, cmd: { handler: Handler }) => { commands.set(name, cmd); },
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
    setWidget: () => {},
    theme: plainTheme,
    confirm: async () => confirms.shift() ?? false,
    editor: async () => "edited objective",
    custom: (factory: (tui: unknown, theme: unknown, kb: unknown, done: () => void) => PaneLike) =>
      new Promise<void>((resolve) => {
        closePane = resolve;
        pane = factory({ requestRender: () => {} }, plainTheme, {}, () => resolve());
      }),
  };
  const ctx = { sessionManager, ui, isIdle: () => true, hasPendingMessages: () => false, mode: "tui", hasUI: true, abort: () => {} };
  await handlers.get("session_start")!({ reason: "startup" } as never, ctx as never);
  const goal = (): GoalRecord | null => JSON.parse(readFileSync(`${sessionFile}.codex-goals.json`, "utf8")).goal;
  return {
    ctx, commands, messageRenderers, entryRenderers, entries, userMessages, notices, confirms, goal,
    pane: () => pane!,
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
  assert.match(f.pane().render(100).join("\n"), /no goal/);

  f.pane().handleInput("\x1b");
  await shown;
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

test("commit entries and pause notices collapse; expanded they show today's text", async (t) => {
  const f = await load(t);
  const commit = f.entryRenderers.get("codex-goal-commit")!;
  const data = { sessionId: "s", goalId: "g", revision: 2 };
  assert.equal(commit({ type: "custom", customType: "codex-goal-commit", data }, { expanded: false }, plainTheme)!.render(80)[0]!.trimEnd(), "  · goal rev 2 committed");
  const tombstone = { sessionId: "s", goalId: null, revision: 9, tombstone: true };
  assert.match(commit({ type: "custom", customType: "codex-goal-commit", data: tombstone }, { expanded: false }, plainTheme)!.render(80)[0]!, /goal rev 9 committed · cleared/);
  assert.equal(commit({ type: "custom", customType: "codex-goal-commit", data }, { expanded: true }, plainTheme)!.render(200)[0]!.trimEnd(), `[codex-goal-commit] ${JSON.stringify(data)}`);

  const notice = f.entryRenderers.get("codex-goal-notice")!;
  const pause = { text: "Goal paused (g).", at: "2026-10-30T20:46:55.412Z", event: "paused", goalId: "g", revision: 474, timeUsedSeconds: 6 };
  const collapsed = notice({ type: "custom", customType: "codex-goal-notice", data: pause }, { expanded: false }, plainTheme)!.render(120);
  assert.deepEqual(collapsed.map((line) => line.trimEnd()), [" ◉ goal paused · rev 474 · 6s · /goal resume"]);
  assert.equal(notice({ type: "custom", customType: "codex-goal-notice", data: pause }, { expanded: true }, plainTheme)!.render(120)[0]!.trimEnd(), "Goal paused (g).");
  const legacy = { text: "Goal paused (g).", at: "2026-10-30T20:46:55.412Z" };
  assert.equal(notice({ type: "custom", customType: "codex-goal-notice", data: legacy }, { expanded: false }, plainTheme)!.render(120)[0]!.trimEnd(), "Goal paused (g).");
});
