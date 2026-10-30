/** /bg panel and transcript rendering against the in-memory backend. */
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { PLAIN_THEME, type UiTheme } from "@ponygirls/pi-ui";
import { formatSize, informativeReason, shortTaskId } from "../src/present.ts";
import type { CompletionDetails, SessionId, TaskId, TaskRecord } from "../src/protocol.ts";
import { collapsedCall, collapsedResult, completionLine, expandedCall, resultText, statusLine, type TranscriptTheme } from "../src/transcript.ts";
import { BgInspector, type ViewerDeps } from "../src/ui.ts";
import { defer, eventually } from "./fixtures.ts";
import { MemoryTaskBackend } from "./memory-backend.ts";

const ENTER = "\r";
const DOWN = "\x1b[B";
const PAGE_UP = "\x1b[5~";
const WIDTH = 120;

/** Zero-width styling (256-colour SGR indexed by token) that `tags` turns into `<color>text</>`, `[bg …]`, `*bold*`. */
const TOKENS: readonly string[] = ["text", "muted", "dim", "accent", "border", "success", "warning", "error", "toolTitle", "toolOutput", "selectedBg", "toolPendingBg"];
const TAG: UiTheme & TranscriptTheme = {
  fg: (color, s) => `\x1b[38;5;${TOKENS.indexOf(color)}m${s}\x1b[39m`,
  bg: (color, s) => `\x1b[48;5;${TOKENS.indexOf(color)}m${s}\x1b[49m`,
  bold: (s) => `\x1b[1m${s}\x1b[22m`,
};

function tags(line: string): string {
  return line
    .replace(/\x1b\[38;5;(\d+)m/g, (_m, i: string) => `<${TOKENS[Number(i)]}>`)
    .replace(/\x1b\[48;5;(\d+)m/g, (_m, i: string) => `[${TOKENS[Number(i)]} `)
    .replace(/\x1b\[39m/g, "</>").replace(/\x1b\[49m/g, "]").replace(/\x1b\[1m|\x1b\[22m/g, "*");
}
const PLAIN_TRANSCRIPT: TranscriptTheme = { fg: (_color, s) => s, bold: (s) => s };

async function inspector(t: TestContext, backend: MemoryTaskBackend, theme: UiTheme, rows = 30): Promise<BgInspector> {
  const deps: ViewerDeps = {
    backend: async () => backend,
    noticeState: () => null,
    noticeForgotten: () => {},
    confirm: async () => true,
    selectSignal: async () => undefined,
    requestRender: () => {},
    rows: () => rows,
    close: () => {},
    theme,
    now: () => Date.now(),
  };
  const view = new BgInspector(deps);
  defer(t, () => view.dispose());
  await view.idle();
  return view;
}

async function settled(backend: MemoryTaskBackend, id: TaskId): Promise<TaskRecord> {
  return eventually(async () => {
    const task = await backend.get(id);
    return task.state !== "running" ? task : null;
  }, `${id} to finish`);
}

async function finishedTask(backend: MemoryTaskBackend, label: string, command: string): Promise<TaskRecord> {
  const task = await backend.spawn({ label, command, cwd: "/", notify: false });
  return settled(backend, task.id);
}

async function press(view: BgInspector, ...keys: string[]): Promise<void> {
  for (const key of keys) {
    view.handleInput(key);
    await view.idle();
  }
}

test("D5: the list does not repeat the exit evidence as a reason", async (t) => {
  const backend = new MemoryTaskBackend("ui-render" as SessionId);
  await finishedTask(backend, "job", "echo ok; exit 0");
  await finishedTask(backend, "job", "echo bad; exit 3");
  const view = await inspector(t, backend, PLAIN_THEME);
  const screen = view.render(WIDTH).join("\n");
  assert.match(screen, /completed/);
  assert.match(screen, /failed/);
  assert.doesNotMatch(screen, /\bexit_nonzero\b/);
  assert.doesNotMatch(screen, /\b0\s+exit\b/);
});

test("D6: the detail view of a finished task does not claim to follow live output", async (t) => {
  const backend = new MemoryTaskBackend("ui-render" as SessionId);
  await finishedTask(backend, "job", "echo done; exit 0");
  const view = await inspector(t, backend, PLAIN_THEME);
  await press(view, ENTER);
  const screen = view.render(WIDTH).join("\n");
  assert.match(screen, /done/);
  assert.doesNotMatch(screen, /following/i);
  assert.match(screen.split("\n")[0]!, /finished ──$/);
});

test("list: frame title, dim column header, aligned cells, hints, exact widths", async (t) => {
  const backend = new MemoryTaskBackend("ui-render" as SessionId);
  await finishedTask(backend, "lint", "echo lint ok; exit 0");
  await finishedTask(backend, "tests", "echo FAIL; exit 3");
  await backend.spawn({ label: "a much longer build label", command: "sleep 30", cwd: "/", notify: true });
  const view = await inspector(t, backend, PLAIN_THEME);
  const lines = view.render(WIDTH);
  for (const line of lines) assert.ok(visibleWidth(line) <= WIDTH, `line wider than ${WIDTH}: ${line}`);
  assert.match(lines[0]!, /^── Background tasks · 3 retained · 1 running ─+ ● live ──$/);
  assert.equal(visibleWidth(lines[0]!), WIDTH);
  const header = lines[1]!;
  assert.match(header, /^ {2}TASK +LABEL +STATE +TIME +EXIT +NOTICE +LOG$/);
  const rows = lines.slice(2, 5);
  assert.match(rows[0]!, /mem0… +a much longer build lab… +● running +\d+s +— +on +0 B/);
  assert.doesNotMatch(rows[0]!, /\x1b/, "a truncated cell carries no reset that would end the selection band");
  assert.match(rows[1]!, /mem0… +tests +✖ failed +\d+s +3 +off +6 B/);
  assert.match(rows[2]!, /mem0… +lint +✓ completed +\d+s +0 +off +9 B/);
  for (const name of ["LABEL", "STATE", "EXIT", "NOTICE", "LOG"]) {
    const column = header.indexOf(name);
    for (const row of rows) assert.notEqual(row[column - 1], undefined, `${name} column exists in ${row}`);
    for (const row of rows) assert.equal(row[column - 1], " ", `${name} starts a cell in: ${row}`);
    for (const row of rows) assert.notEqual(row[column], " ", `${name} cell is aligned in: ${row}`);
  }
  assert.equal(lines[5], "─".repeat(WIDTH));
  assert.equal(lines[6], "↑↓ select  ⏎ open  t terminate  s signal  m mute  c clear  r refresh  q close");
  assert.equal(lines.length, 7);
});

test("list: state glyph colours, non-zero exit in error, full-width selection with muted ids", async (t) => {
  const backend = new MemoryTaskBackend("ui-render" as SessionId);
  await finishedTask(backend, "lint", "echo ok; exit 0");
  await finishedTask(backend, "tests", "echo FAIL; exit 3");
  const view = await inspector(t, backend, TAG);
  const [title, header, selected, other] = view.render(WIDTH).map(tags);
  assert.match(title!, /<success>●<\/><dim> live<\/> <border>──<\/>$/);
  assert.match(header!, /^<dim> {2}TASK/);
  assert.ok(selected!.startsWith("[selectedBg <accent>▌</> *"), selected);
  assert.match(selected!, /<muted>mem0…<\/>/, "the id is muted inside the selection");
  assert.match(selected!, /<error>✖ failed<\/>/);
  assert.match(selected!, /<error>3<\/>/);
  assert.match(other!, /^ {2}<dim>mem0…<\/>/, "the id is dim outside the selection");
  assert.match(other!, /<success>✓ completed<\/>/);
  assert.match(other!, /<muted>0<\/>/);
  const plain = await inspector(t, backend, PLAIN_THEME);
  assert.equal(visibleWidth(plain.render(WIDTH)[2]!), WIDTH, "the selection spans the full width");
  await press(view, DOWN);
  assert.match(tags(view.render(WIDTH)[3]!), /^\[selectedBg <accent>▌<\/> \*.*lint/);
});

test("list: informative reasons stay, the message line stays, more history is marked", async (t) => {
  const backend = new MemoryTaskBackend("ui-render" as SessionId);
  const task = await backend.spawn({ label: "victim", command: "sleep 30", cwd: "/", notify: false });
  await backend.terminate(task.id);
  const view = await inspector(t, backend, PLAIN_THEME);
  await press(view, "m");
  const lines = view.render(WIDTH);
  assert.match(lines[2]!, /✖ failed +\d+s +SIGTERM terminated/);
  assert.equal(lines.at(-1), "completion notices on for bgt-mem0001");
  const empty = await inspector(t, new MemoryTaskBackend("ui-empty" as SessionId), PLAIN_THEME);
  assert.match(empty.render(WIDTH).join("\n"), /0 retained · 0 running[\s\S]*No retained tasks in this session\./);
});

test("detail: frame title with state and view mode, log between rules, hints", async (t) => {
  const backend = new MemoryTaskBackend("ui-render" as SessionId);
  const task = await backend.spawn({ label: "build", command: "sleep 30", cwd: "/", notify: true });
  for (let i = 1; i <= 40; i++) backend.append(task.id, `line-${i}\r\n`);
  const view = await inspector(t, backend, PLAIN_THEME);
  await press(view, ENTER);
  let lines = view.render(WIDTH);
  assert.match(lines[0]!, new RegExp(`^── ${task.id} · build · notice on · \\d+ B ─+ ● running · following ──$`));
  assert.equal(visibleWidth(lines[0]!), WIDTH);
  assert.equal(lines.at(-2), "─".repeat(WIDTH));
  assert.equal(lines.at(-1), "↑ PgUp scroll  f End follow  t terminate  s signal  m mute  c clear  esc back");
  assert.equal(lines.at(-3), "line-40");
  await press(view, PAGE_UP);
  lines = view.render(WIDTH);
  assert.match(lines[0]!, /● running · paused ──$/);
  assert.doesNotMatch(lines.join("\n"), /line-40/);
  await press(view, "f");
  backend.finish(task.id, 3, "FAIL\r\n");
  await view.refresh();
  lines = view.render(WIDTH);
  assert.match(lines[0]!, /· build · exit 3 · notice pending · \d+ B ─+ ✖ failed · finished ──$/);
  assert.equal(lines.at(-1), "↑ PgUp scroll  f End end of log  t terminate  s signal  m mute  c clear  esc back");
  await press(view, PAGE_UP);
  assert.match(view.render(WIDTH)[0]!, /✖ failed · scrolled back ──$/);
});

test("formatSize, short ids and redundant reasons", () => {
  assert.equal(formatSize(9), "9 B");
  assert.equal(formatSize(1023), "1023 B");
  assert.equal(formatSize(1302), "1.3 KiB");
  assert.equal(formatSize(3 * 1024 * 1024), "3.0 MiB");
  assert.equal(shortTaskId("bgt-c7c6d1bd1bd981f9"), "c7c6…");
  assert.equal(shortTaskId("bgt-ab"), "ab");
  assert.equal(shortTaskId("bgt-\x1b]0;x"), "\\x1b…");
  assert.equal(informativeReason("exit", { kind: "code", code: 0 }), null);
  assert.equal(informativeReason("exit_nonzero", { kind: "code", code: 3 }), null);
  assert.equal(informativeReason("signaled", { kind: "signal", signal: "SIGKILL" }), null);
  assert.equal(informativeReason("terminated", { kind: "signal", signal: "SIGTERM" }), "terminated");
  assert.equal(informativeReason("supervisor_lost", null), "supervisor_lost");
});

function details(events: CompletionDetails["events"]): CompletionDetails {
  return { schemaVersion: 1, sessionId: "s", events };
}

test("completion notice: one line from the retained record, or from the notice alone", async () => {
  const backend = new MemoryTaskBackend("ui-render" as SessionId);
  const task = await finishedTask(backend, "tests", "echo FAIL: 1 of 12; exit 3");
  const event = { taskId: task.id, eventId: "e1", state: "failed" as const, reason: "exit_nonzero" as const, logPath: "/x/terminal.log" };
  const known = completionLine(details([event]), (id) => (id === task.id ? task : undefined), Date.now(), PLAIN_TRANSCRIPT);
  assert.match(known, /^⚙ bg tests ✖ failed · exit 3 · \d+s · log 15 B · \/bg to inspect$/);
  const tagged = tags(completionLine(details([event]), () => task, Date.now(), TAG));
  assert.match(tagged, /^<accent>⚙ bg<\/> <text>tests<\/> <error>✖ failed · exit 3<\/><dim> · /);
  const unknown = completionLine(details([event]), () => undefined, Date.now(), PLAIN_TRANSCRIPT);
  assert.equal(unknown, "⚙ bg mem0… ✖ failed · exit_nonzero · /bg to inspect");
  const completed = completionLine(details([{ ...event, state: "completed", reason: "exit" }]), () => undefined, Date.now(), PLAIN_TRANSCRIPT);
  assert.equal(completed, "⚙ bg mem0… ✓ completed · /bg to inspect");
  const many = completionLine(details([event, { ...event, eventId: "e2" }, { ...event, eventId: "e3", state: "completed", reason: "exit" }, { ...event, eventId: "e4", state: "dead", reason: "supervisor_lost" }]), () => undefined, Date.now(), PLAIN_TRANSCRIPT);
  assert.equal(many, "⚙ bg 4 tasks finished ✓ 1 completed · ✖ 2 failed · ⚠ 1 dead · /bg to inspect");
});

test("status notice: one line without the extension prefix", () => {
  assert.equal(statusLine("unavailable", "bg-tasks: status backend unreachable (boom); the badge keeps its last state.", PLAIN_TRANSCRIPT),
    "⚙ bg status backend unreachable (boom); the badge keeps its last state.");
  assert.match(tags(statusLine("recovered", "bg-tasks: status backend reachable again.", TAG)), /^<success>⚙ bg<\/> <text>status backend reachable again\.<\/>$/);
});

test("bg_task collapsed: the call alone, then call and outcome on one line", () => {
  const args = { action: "spawn", label: "tests", command: "echo running tests;\n  sleep 1; exit 3", cwd: "/w", notify: true };
  assert.equal(collapsedCall(args, PLAIN_TRANSCRIPT), "bg_task spawn tests · echo running tests; sleep 1; exit 3");
  assert.equal(collapsedCall({ action: "spa" }, PLAIN_TRANSCRIPT), "bg_task spa", "partial arguments while streaming");
  const task = { id: "bgt-c7c6d1bd1bd981f9", notify: true } as never;
  const spawned = collapsedResult(args, { content: [{ type: "text", text: "Started …" }], details: { action: "spawn", task, logPath: "/l" } }, false, PLAIN_TRANSCRIPT);
  assert.equal(spawned, "bg_task spawn tests · echo running tests; sleep 1; exit 3 → started c7c6… (notice on)");
  const failed = tags(collapsedResult({ action: "clear", id: "bgt-c7c6d1bd1bd981f9" }, { content: [{ type: "text", text: "TASK_UNFINISHED: task is running\nmore" }], details: undefined }, true, TAG));
  assert.match(failed, /<toolOutput>clear c7c6…<\/><toolOutput> → <\/><error>✖ TASK_UNFINISHED: task is running<\/>$/);
  const cleared = collapsedResult({ action: "clear", id: "bgt-c7c6d1bd1bd981f9" }, { content: [], details: { action: "clear", id: "bgt-c7c6d1bd1bd981f9", removedBytes: 2048 } }, false, PLAIN_TRANSCRIPT);
  assert.equal(cleared, "bg_task clear c7c6… → cleared 2.0 KiB");
});

test("bg_task expanded: identical to pi's generic call and result rendering", async () => {
  const root = process.env.PI_BG_TASKS_SDK_ROOT;
  assert.ok(root, "Set PI_BG_TASKS_SDK_ROOT; the drift check must not silently skip.");
  const pi = (await import(`${root}/dist/core/tools/render-utils.js`)) as {
    formatToolCallWithArgs(title: string, args: unknown, theme: TranscriptTheme, expanded: boolean): string;
    getTextOutput(result: { content: Array<{ type: string; text?: string }> }, showImages: boolean): string;
  };
  const argsSamples: unknown[] = [
    { action: "spawn", label: "tests", command: "echo a\n\tb\r\nc", cwd: "/w", notify: true },
    { action: "list", cursor: null, limit: 5 },
    { action: "read", id: "bgt-1", offset: "tail", limit: 100 },
    {},
    null,
  ];
  for (const args of argsSamples) assert.equal(expandedCall(args, TAG), pi.formatToolCallWithArgs("bg_task", args, TAG, true), JSON.stringify(args));
  const contents = [
    [{ type: "text", text: "Started bgt-1 (tests): running. Log: /l." }],
    [{ type: "text", text: "a\r\nb\x07c \x1b[31mred\x1b[0m \uFFFAx" }, { type: "text", text: "second" }],
    [{ type: "text", text: "" }],
  ];
  for (const content of contents) assert.equal(resultText(content), pi.getTextOutput({ content }, true), JSON.stringify(content));
});
