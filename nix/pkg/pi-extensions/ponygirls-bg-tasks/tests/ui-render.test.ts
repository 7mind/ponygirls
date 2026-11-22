import { renderLayoutFrame } from "@earendil-works/pi-tui/dist/layout.js";
/** /bg panel and transcript rendering against the in-memory backend. */
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { VStack, visibleWidth } from "@earendil-works/pi-tui";
import { PLAIN_THEME, type UiTheme } from "@ponygirls/pi-ui";
import { formatSize, informativeReason, shortTaskId, shownReason } from "../src/present.ts";
import type { CompletionDetails, SessionId, TaskId, TaskRecord } from "../src/protocol.ts";
import { OneLine, collapsedCall, collapsedResult, completionLine, expandedCall, resultText, statusLine, type TranscriptTheme } from "../src/transcript.ts";
import { runBgTask, type ToolHost } from "../src/tool.ts";
import { BgInspector, renderCompletion, type ViewerDeps } from "../src/ui.ts";
import { defer, eventually } from "./fixtures.ts";
import { MemoryTaskBackend } from "./memory-backend.ts";

const ENTER = "\r";
const DOWN = "\x1b[B";
const PAGE_UP = "\x1b[5~";
const END = "\x1b[F";
const WIDTH = 120;
/** Widths every pane and transcript line must fit. */
const WIDTHS = [60, 80, 100, 120, 170] as const;

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
/** Styling the kit emits even with an unstyled theme (a reset around its ellipsis). */
const SGR = /\x1b\[[0-9;]*m/g;

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

/** An inspector showing the detail view of the selected (newest) task. */
async function opened(t: TestContext, backend: MemoryTaskBackend, theme: UiTheme): Promise<BgInspector> {
  const view = await inspector(t, backend, theme);
  await press(view, ENTER);
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

/** The key-hint lines: from the footer rule to the closing `esc` hint (a message line may follow). */
function hints(view: BgInspector, width = WIDTH): string[] {
  const lines = view.render(width);
  const last = lines.findLastIndex((line) => /(^| {2})esc (close|back)$/.test(line));
  assert.notEqual(last, -1, `no esc hint at ${width}: ${lines.join("\n")}`);
  return lines.slice(lines.lastIndexOf("─".repeat(width)) + 1, last + 1);
}

function assertFits(lines: readonly string[], width: number, what: string): void {
  for (const line of lines) assert.ok(visibleWidth(line) <= width, `${what} at ${width}: ${visibleWidth(line)} columns: ${line}`);
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
  assert.match(lines[0]!, /^── Background tasks · 3 ─+ 1 running · ● live ──$/);
  assert.equal(visibleWidth(lines[0]!), WIDTH);
  const header = lines[1]!;
  assert.match(header, /^ {2}TASK +LABEL +STATE +TIME +EXIT +NOTICE +LOG$/);
  const rows = lines.slice(2, 5);
  assert.match(rows[0]!, /mem0… +a much longer build label +● running +\d+s +— +on +0 B/);
  assert.match(rows[1]!, /mem0… +tests +✖ failed +\d+s +3 +off +6 B/);
  assert.match(rows[2]!, /mem0… +lint +✓ completed +\d+s +0 +off +9 B/);
  for (const name of ["LABEL", "STATE", "EXIT", "NOTICE", "LOG"]) {
    const column = header.indexOf(name);
    for (const row of rows) assert.notEqual(row[column - 1], undefined, `${name} column exists in ${row}`);
    for (const row of rows) assert.equal(row[column - 1], " ", `${name} starts a cell in: ${row}`);
    for (const row of rows) assert.notEqual(row[column], " ", `${name} cell is aligned in: ${row}`);
  }
  assert.equal(lines[5], "─".repeat(WIDTH));
  assert.equal(lines[6], "↑↓ select  ⏎ open  t terminate  s signal  m mute notice  esc close");
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
  await backend.spawn({ label: "victim", command: "sleep 30", cwd: "/", notify: false });
  // A reason the shown state does not already say (a terminated task's reason is its state).
  await backend.shutdown("quit");
  const view = await inspector(t, backend, PLAIN_THEME);
  await press(view, "m");
  const lines = view.render(WIDTH);
  assert.match(lines[2]!, /✖ failed +\d+s +\? session_shutdown/);
  assert.equal(lines.at(-1), "completion notices on for bgt-mem0001");
  const empty = await inspector(t, new MemoryTaskBackend("ui-empty" as SessionId), PLAIN_THEME);
  assert.match(empty.render(WIDTH).join("\n"), /No background tasks in this session\. The model starts them with bg_task\./);
});

// Defect C: a task ended with `t` was listed as `✖ failed  …  SIGTERM terminated` in red.
test("a task ended with terminate reads terminated and settled; other failures stay failed", async (t) => {
  const backend = new MemoryTaskBackend("ui-render" as SessionId);
  await finishedTask(backend, "tests", "echo FAIL; exit 3");
  const killed = await backend.spawn({ label: "oom", command: "sleep 30", cwd: "/", notify: false });
  backend.kill(killed.id, "SIGKILL");
  const stopped = await backend.spawn({ label: "sleeper", command: "sleep 30", cwd: "/", notify: false });
  await backend.terminate(stopped.id);
  const view = await inspector(t, backend, PLAIN_THEME);
  const lines = view.render(WIDTH);
  assert.match(lines[2]!, /^▌ mem0… +sleeper +■ terminated +\d+s +SIGTERM +off +0 B *$/, "EXIT stays factual");
  assert.match(lines[3]!, /^ {2}mem0… +oom +✖ failed +\d+s +SIGKILL +off +0 B$/, "a signal nobody here sent is a failure");
  assert.match(lines[4]!, /^ {2}mem0… +tests +✖ failed +\d+s +3 +off +6 B$/);
  assert.doesNotMatch(lines.join("\n"), /SIGTERM terminated/);

  const tagged = await inspector(t, backend, TAG);
  const [, , terminatedRow, killedRow] = tagged.render(WIDTH).map(tags);
  assert.match(terminatedRow!, /<muted>■ terminated<\/>/);
  assert.match(terminatedRow!, /<muted>SIGTERM<\/>/, "the expected signal of a requested stop is not an error");
  assert.match(killedRow!, /<error>✖ failed<\/>/);
  assert.match(killedRow!, /<error>SIGKILL<\/>/);

  await press(view, ENTER);
  const title = view.render(WIDTH)[0]!;
  assert.match(title, /· sleeper · killed by SIGTERM · notice off · 0 B ─+ ■ terminated · finished ──$/);
  assert.match(tags((await opened(t, backend, TAG)).render(WIDTH)[0]!), /<muted>■ terminated<\/><dim> · <\/><muted>finished<\/>/);
});

test("terminating from the pane reports and lists the task as terminated", async (t) => {
  const backend = new MemoryTaskBackend("ui-render" as SessionId);
  await backend.spawn({ label: "sleeper", command: "sleep 30", cwd: "/", notify: false });
  const view = await inspector(t, backend, PLAIN_THEME);
  assert.match(view.render(WIDTH)[2]!, /● running/);
  await press(view, "t");
  const lines = view.render(WIDTH);
  assert.match(lines[2]!, /■ terminated +\d+s +SIGTERM/);
  assert.equal(lines.at(-1), "bgt-mem0001: terminated, killed by SIGTERM");
});

test("list: the title counts tasks, and running ones only when there are any", async (t) => {
  const backend = new MemoryTaskBackend("ui-render" as SessionId);
  await finishedTask(backend, "lint", "echo ok; exit 0");
  await finishedTask(backend, "tests", "echo FAIL; exit 3");
  const view = await inspector(t, backend, TAG);
  assert.match(view.render(WIDTH).map(tags)[0]!, /\*<text>Background tasks<\/>\*<dim> · 2<\/><border> ─+<\/> <success>●<\/><dim> live<\/> <border>──<\/>$/);
  await backend.spawn({ label: "build", command: "sleep 30", cwd: "/", notify: true });
  await backend.spawn({ label: "serve", command: "sleep 30", cwd: "/", notify: true });
  await view.refresh();
  assert.match(view.render(WIDTH).map(tags)[0]!, /<dim> · 4<\/><border> ─+<\/> <accent>2 running<\/><dim> · <\/><success>●<\/><dim> live<\/> <border>──<\/>$/);
});

test("list hints follow the selected task; keys no longer advertised stay bound", async (t) => {
  const backend = new MemoryTaskBackend("ui-render" as SessionId);
  const lint = await finishedTask(backend, "lint", "echo ok; exit 0");
  const build = await backend.spawn({ label: "build", command: "sleep 30", cwd: "/", notify: true });
  const view = await inspector(t, backend, PLAIN_THEME);
  assert.deepEqual(hints(view), ["↑↓ select  ⏎ open  t terminate  s signal  m mute notice  esc close"]);
  await press(view, "m");
  assert.deepEqual(hints(view), ["↑↓ select  ⏎ open  t terminate  s signal  m unmute notice  esc close"]);
  await press(view, DOWN);
  assert.deepEqual(hints(view), ["↑↓ select  ⏎ open  c clear  esc close"], "a finished task can only be cleared");
  // `m` on a finished task and `r` are not advertised, and still work.
  assert.equal((await backend.get(lint.id)).notify, false);
  await press(view, "m");
  assert.equal((await backend.get(lint.id)).notify, true);
  backend.append(build.id, "12345");
  await press(view, "r");
  assert.match(view.render(WIDTH)[2]!, /build .* 5 B$/);
});

test("empty list: one sentence that says where tasks come from, and only esc", async (t) => {
  const empty = await inspector(t, new MemoryTaskBackend("ui-empty" as SessionId), PLAIN_THEME);
  assert.deepEqual(empty.render(WIDTH), [
    `── Background tasks ${"─".repeat(WIDTH - 30)} ● live ──`,
    "  No background tasks in this session. The model starts them with bg_task.",
    "─".repeat(WIDTH),
    "esc close",
  ]);
  for (const width of WIDTHS) {
    const lines = empty.render(width);
    assertFits(lines, width, "empty list");
    assert.equal(lines.slice(1, -2).map((line) => line.trim()).join(" "), "No background tasks in this session. The model starts them with bg_task.", `wrapped, not cut, at ${width}`);
    assert.equal(lines.at(-1), "esc close");
  }
});

/** A list with every kind of row: completed, failed, terminated, and a running task with a long label. */
async function mixedBackend(): Promise<MemoryTaskBackend> {
  const backend = new MemoryTaskBackend("ui-render" as SessionId);
  await finishedTask(backend, "lint", "echo lint ok; exit 0");
  await finishedTask(backend, "tests", "echo FAIL; exit 3");
  const stopped = await backend.spawn({ label: "sleeper", command: "sleep 30", cwd: "/", notify: false });
  await backend.terminate(stopped.id);
  await backend.spawn({ label: "a much longer build label", command: "sleep 30", cwd: "/", notify: true });
  return backend;
}

test("list: every line fits 60 to 170 columns; columns are hidden whole and named, never clipped", async (t) => {
  const view = await inspector(t, await mixedBackend(), PLAIN_THEME);
  for (const width of WIDTHS) {
    const lines = view.render(width);
    assertFits(lines, width, "list");
    assert.equal(visibleWidth(lines[0]!), width);
    assert.match(lines[0]!, /^── Background tasks · 4 ─+ 1 running · ● live ──$/);
    const rows = lines.slice(2, 6);
    assert.match(rows[0]!, /^▌ mem0… +a much longer build label +● running/, `identity and state at ${width}`);
    assert.match(rows[1]!, /^ {2}mem0… +sleeper +■ terminated/, `identity and state at ${width}`);
    for (const row of rows) assert.doesNotMatch(row, /…\s*$/, `no cell is cut at the row end at ${width}: ${row}`);
    assert.equal(hints(view, width).join("  "), "↑↓ select  ⏎ open  t terminate  s signal  m mute notice  esc close", `hints wrap, never cut, at ${width}`);
  }
  const narrow = view.render(60);
  assert.match(narrow[1]!, /^ {2}TASK +LABEL +STATE +EXIT$/);
  assert.match(narrow[3]!, /^ {2}mem0… +sleeper +■ terminated +SIGTERM$/);
  assert.equal(narrow[6], "  hidden at this width: Time, Notice, Log");
  assert.equal(narrow[7], "─".repeat(60));
  for (const width of [80, 100, 120, 170]) {
    const lines = view.render(width);
    assert.match(lines[1]!, /^ {2}TASK +LABEL +STATE +TIME +EXIT +NOTICE +LOG$/);
    assert.doesNotMatch(lines.join("\n"), /hidden at this width/);
  }
});

test("list: wide terminals distinguish long labels, and resize keeps the selected task", async (t) => {
  const backend = new MemoryTaskBackend("ui-render" as SessionId);
  const mac = "Build release candidate · macOS arm64 · 結果 package step";
  const linux = "Build release candidate · Linux arm64 · 結果 package step";
  const selected = await finishedTask(backend, mac, "echo mac-build");
  await finishedTask(backend, linux, "echo linux-build");
  const view = await inspector(t, backend, TAG);
  await press(view, DOWN);

  for (const [width, narrow] of [[180, false], [60, true], [180, false]] as const) {
    const rendered = view.render(width);
    assertFits(rendered, width, "long task labels");
    const lines = rendered.map((line) => line.replace(SGR, ""));
    assert.match(lines[3]!, /^▌ /, `the same row stays selected at ${width}`);
    if (narrow) {
      assert.match(lines[1]!, /^ {2}TASK +LABEL +STATE +EXIT$/);
      assert.match(lines[2]!, /Linux… +✓ completed/);
      assert.match(lines[3]!, /macOS… +✓ completed/);
      assert.match(tags(rendered[3]!), /^\[selectedBg <accent>▌<\/> \*.*<text>Build release candidate · macOS…<\/>/);
      assert.doesNotMatch(rendered[3]!, /\x1b\[0m/, "clipping the label does not reset the selection band");
      assert.ok(lines.includes("  hidden at this width: Time, Notice, Log"));
    } else {
      assert.match(lines[1]!, /^ {2}TASK +LABEL +STATE +TIME +EXIT +NOTICE +LOG$/);
      assert.ok(lines[2]!.includes(linux), lines[2]);
      assert.ok(lines[3]!.includes(mac), lines[3]);
      assert.ok(!lines.some((line) => line.includes("hidden at this width")));
    }
  }
  await press(view, ENTER);
  const detail = view.render(180).map((line) => line.replace(SGR, ""));
  assert.ok(detail[0]!.includes(selected.id), detail[0]);
  assert.ok(detail.includes("mac-build"));
});

test("list: a long label yields cells to keep exit evidence visible at 60 columns", async (t) => {
  const backend = new MemoryTaskBackend("ui-render" as SessionId);
  const task = await backend.spawn({ label: "Build release candidate · macOS arm64 · package step", command: "sleep 30", cwd: "/", notify: false });
  await backend.terminate(task.id);
  const view = await inspector(t, backend, PLAIN_THEME);
  const lines = view.render(60);
  assertFits(lines, 60, "terminated task");
  assert.match(lines[1]!, /^ {2}TASK +LABEL +STATE +EXIT$/);
  assert.match(lines[2]!, /^▌ mem0… +Build release candidate · m… +■ terminated +SIGTERM *$/);
  assert.ok(lines.includes("  hidden at this width: Time, Notice, Log"));
});

test("list: when even task, label and state do not fit, the label gives way and the state stays whole", async (t) => {
  const view = await inspector(t, await mixedBackend(), PLAIN_THEME);
  const lines = view.render(40);
  assertFits(lines, 40, "list");
  assert.match(lines[1]!, /^ {2}TASK +LABEL +STATE$/);
  assert.match(lines[2]!, /^▌ mem0… +a much longer bu… +● running *$/);
  assert.match(lines[3]!, /^ {2}mem0… +sleeper +■ terminated$/);
  assert.deepEqual(lines.slice(6, 9), ["  hidden at this width: Time, Exit,", "  Notice, Log", "─".repeat(40)], "the note wraps between words");
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
  assert.equal(lines.at(-1), "↑↓ scroll  PgUp/PgDn page  t terminate  s signal  m mute notice  esc back");
  assert.equal(lines.at(-3), "line-40");
  await press(view, PAGE_UP);
  lines = view.render(WIDTH);
  assert.match(lines[0]!, /● running · paused ──$/);
  assert.doesNotMatch(lines.join("\n"), /line-40/);
  assert.equal(lines.at(-1), "↑↓ scroll  PgUp/PgDn page  f follow  t terminate  s signal  m mute notice  esc back", "follow is offered only away from the end");
  await press(view, "f");
  assert.equal(view.render(WIDTH).at(-1), "↑↓ scroll  PgUp/PgDn page  t terminate  s signal  m mute notice  esc back");
  backend.finish(task.id, 3, "FAIL\r\n");
  await view.refresh();
  lines = view.render(WIDTH);
  assert.match(lines[0]!, /· build · exit 3 · notice pending · \d+ B ─+ ✖ failed · finished ──$/);
  assert.equal(lines.at(-1), "↑↓ scroll  PgUp/PgDn page  c clear  esc back");
  await press(view, PAGE_UP);
  lines = view.render(WIDTH);
  assert.match(lines[0]!, /✖ failed · scrolled back ──$/);
  assert.equal(lines.at(-1), "↑↓ scroll  PgUp/PgDn page  f follow  c clear  esc back");
  // End is no longer advertised and still returns to the end.
  await press(view, END);
  assert.match(view.render(WIDTH)[0]!, /✖ failed · finished ──$/);
});

test("detail: the title keeps whole facts only; the label is the last to give way", async (t) => {
  const backend = new MemoryTaskBackend("ui-render" as SessionId);
  const stopped = await backend.spawn({ label: "sleeper", command: "sleep 30", cwd: "/", notify: false });
  await backend.terminate(stopped.id);
  const view = await opened(t, backend, PLAIN_THEME);
  const title = (width: number): string => view.render(width)[0]!.replace(SGR, "");
  assert.match(title(100), /^── bgt-mem0001 · sleeper · killed by SIGTERM · notice off · 0 B ─+ ■ terminated · finished ──$/);
  assert.match(title(90), /^── bgt-mem0001 · sleeper · killed by SIGTERM · notice off ─+ ■ terminated · finished ──$/);
  assert.match(title(80), /^── bgt-mem0001 · sleeper · killed by SIGTERM ─+ ■ terminated · finished ──$/);
  assert.match(title(60), /^── bgt-mem0001 · sleeper ─+ ■ terminated · finished ──$/);
  assert.match(title(50), /^── bgt-mem0001 · s\w*… ─+ ■ terminated · finished ──$/, "only the label is ever shortened");
  for (const width of [50, ...WIDTHS]) assert.equal(visibleWidth(view.render(width)[0]!), width);
  const tagged = await opened(t, backend, TAG);
  assert.match(tags(tagged.render(80)[0]!), /<dim> · sleeper · killed by SIGTERM<\/><border> ─+<\/> <muted>■ terminated<\/>/);
});

test("detail: every line fits 60 to 170 columns in each view mode", async (t) => {
  const backend = new MemoryTaskBackend("ui-render" as SessionId);
  const task = await backend.spawn({ label: "a much longer build label", command: "sleep 30", cwd: "/", notify: false });
  for (let i = 1; i <= 40; i++) backend.append(task.id, `line-${i} ${"word ".repeat(40)}\r\n`);
  const view = await inspector(t, backend, PLAIN_THEME);
  await press(view, ENTER);
  const everyWidth = (what: string, expected: string) => {
    for (const width of WIDTHS) {
      const lines = view.render(width);
      assertFits(lines, width, what);
      assert.equal(visibleWidth(lines[0]!), width);
      assert.equal(hints(view, width).join("  "), expected, `${what} hints wrap, never cut, at ${width}`);
    }
  };
  everyWidth("following", "↑↓ scroll  PgUp/PgDn page  t terminate  s signal  m unmute notice  esc back");
  await press(view, PAGE_UP);
  everyWidth("paused", "↑↓ scroll  PgUp/PgDn page  f follow  t terminate  s signal  m unmute notice  esc back");
  await backend.terminate(task.id);
  await view.refresh();
  everyWidth("scrolled back", "↑↓ scroll  PgUp/PgDn page  f follow  c clear  esc back");
  assert.match(view.render(170)[0]!, /■ terminated · scrolled back ──$/);
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
  // What the pane and the transcript lines both show: not the reason the shown state already is.
  assert.equal(shownReason({ state: "failed", reason: "terminated", exit: { kind: "signal", signal: "SIGTERM" } }), null);
  assert.equal(shownReason({ state: "failed", reason: "signaled", exit: { kind: "signal", signal: "SIGKILL" } }), null);
  assert.equal(shownReason({ state: "failed", reason: "session_shutdown", exit: null }), "session_shutdown");
  assert.equal(shownReason({ state: "dead", reason: "supervisor_lost", exit: null }), "supervisor_lost");
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

// The transcript still said `✖ failed · killed by SIGTERM · terminated`, in red, for a task stopped on request.
test("completion notice: a task ended by terminate reads terminated and settled, as in the pane", async () => {
  const backend = new MemoryTaskBackend("ui-render" as SessionId);
  const sleeper = await backend.spawn({ label: "sleeper", command: "sleep 30", cwd: "/", notify: true });
  const stopped = await backend.terminate(sleeper.id);
  const event = { taskId: stopped.id, eventId: "e1", state: "failed" as const, reason: "terminated" as const, logPath: "/x/terminal.log" };
  const now = Date.now();
  assert.match(completionLine(details([event]), () => stopped, now, PLAIN_TRANSCRIPT), /^⚙ bg sleeper ■ terminated · killed by SIGTERM · \d+s · log 0 B · \/bg to inspect$/);
  assert.match(tags(completionLine(details([event]), () => stopped, now, TAG)), /^<accent>⚙ bg<\/> <text>sleeper<\/> <muted>■ terminated · killed by SIGTERM<\/><dim> · \d+s · log 0 B · \/bg to inspect<\/>$/);
  assert.equal(completionLine(details([event]), () => undefined, now, PLAIN_TRANSCRIPT), "⚙ bg mem0… ■ terminated · /bg to inspect");
  assert.equal(tags(completionLine(details([event]), () => undefined, now, TAG)), "<accent>⚙ bg</> <text>mem0…</> <muted>■ terminated</><dim> · /bg to inspect</>");

  // A signal nobody here sent: the task failed on its own.
  const oom = await backend.spawn({ label: "oom", command: "sleep 30", cwd: "/", notify: true });
  backend.kill(oom.id, "SIGKILL");
  const killed = await backend.get(oom.id);
  const killedEvent = { ...event, taskId: killed.id, eventId: "e2", reason: "signaled" as const };
  assert.match(tags(completionLine(details([killedEvent]), () => killed, now, TAG)), /^<accent>⚙ bg<\/> <text>oom<\/> <error>✖ failed · killed by SIGKILL<\/><dim> · /);

  const failed = { ...event, eventId: "e3", reason: "exit_nonzero" as const };
  const completed = { ...event, eventId: "e4", state: "completed" as const, reason: "exit" as const };
  const many = details([event, failed, { ...event, eventId: "e5" }, completed]);
  assert.equal(completionLine(many, () => undefined, now, PLAIN_TRANSCRIPT), "⚙ bg 4 tasks finished ✓ 1 completed · ■ 2 terminated · ✖ 1 failed · /bg to inspect");
  assert.match(tags(completionLine(many, () => undefined, now, TAG)), /<success>✓ 1 completed<\/><dim> · <\/><muted>■ 2 terminated<\/><dim> · <\/><error>✖ 1 failed<\/>/);

  // Expanded, the notice is what it was.
  assert.deepEqual(renderCompletion(details([event]), "", PLAIN_THEME), ["Background task finished", "  bgt-mem0001  failed  terminated  log /x/terminal.log (until cleared)"]);

  for (const notice of [details([event]), many]) {
    for (const width of WIDTHS) assertFits(new OneLine(() => completionLine(notice, () => stopped, now, PLAIN_TRANSCRIPT), 1).render(width), width, "completion notice");
  }
});

// `bg_task terminate … → ✖ failed · killed by SIGTERM` for the stop the call itself asked for.
test("bg_task terminate collapsed: a requested stop reads terminated; a task that had already ended keeps its state", async () => {
  const backend = new MemoryTaskBackend("ui-render" as SessionId);
  const host: ToolHost = { backend: async () => backend, sessionId: () => "ui-render" as SessionId, noticeState: () => null, noticeForgotten: () => {} };
  const terminate = async (id: TaskId, theme: TranscriptTheme): Promise<{ line: string; text: string }> => {
    const output = await runBgTask(host, { action: "terminate", id }, undefined);
    const content = [{ type: "text", text: output.text }];
    return { line: collapsedResult({ action: "terminate", id }, { content, details: output.details }, false, theme), text: resultText(content) };
  };
  const sleeper = await backend.spawn({ label: "sleeper", command: "sleep 30", cwd: "/", notify: false });
  const stopped = await terminate(sleeper.id, PLAIN_TRANSCRIPT);
  assert.equal(stopped.line, "bg_task terminate mem0… → ■ terminated · killed by SIGTERM");
  assert.equal(stopped.text, "bgt-mem0001 finished: failed (terminated), killed by SIGTERM. Its log is retained until cleared.", "expanded, the tool's own text is unchanged");
  assert.match(tags((await terminate(sleeper.id, TAG)).line), /<toolOutput> → <\/><muted>■ terminated<\/><toolOutput> · killed by SIGTERM<\/>$/);

  const tests = await finishedTask(backend, "tests", "echo FAIL; exit 3");
  assert.equal((await terminate(tests.id, PLAIN_TRANSCRIPT)).line, "bg_task terminate mem0… → ✖ failed · exit 3");
  assert.match(tags((await terminate(tests.id, TAG)).line), /<error>✖ failed<\/><toolOutput> · exit 3<\/>$/);
  const lint = await finishedTask(backend, "lint", "echo ok; exit 0");
  assert.equal((await terminate(lint.id, PLAIN_TRANSCRIPT)).line, "bg_task terminate mem0… → ✓ completed · exit 0");
  for (const width of WIDTHS) assertFits(new OneLine(() => stopped.line, 0).render(width), width, "terminate result");
});

const unavailable = (error: string): string => `bg-tasks: status backend unreachable (${error}); the badge keeps its last state.`;
const NO_SESSION_NOTICE = unavailable("NO_PERSISTENT_SESSION: background tasks need a persistent session file (not --no-session)");
const RECOVERED_NOTICE = "bg-tasks: status backend reachable again.";

test("status notice: what happened in plain words, without the extension prefix or the error code", () => {
  assert.equal(statusLine("unavailable", NO_SESSION_NOTICE, PLAIN_TRANSCRIPT, WIDTH), "⚙ background tasks are off: this session is not saved (--no-session)");
  assert.equal(statusLine("unavailable", unavailable("boom"), PLAIN_TRANSCRIPT, WIDTH), "⚙ background task status unavailable: boom");
  assert.equal(statusLine("unavailable", unavailable("SUPERVISOR_LOST: the task supervisor connection closed"), PLAIN_TRANSCRIPT, WIDTH),
    "⚙ background task status unavailable: the task supervisor connection closed");
  assert.equal(statusLine("unavailable", unavailable("line one\n  line (two)"), PLAIN_TRANSCRIPT, WIDTH), "⚙ background task status unavailable: line one line (two)");
  assert.equal(statusLine("unavailable", "bg-tasks: something else", PLAIN_TRANSCRIPT, WIDTH), "⚙ background task status unavailable: something else", "text of another shape is shown as the reason");
  assert.equal(statusLine("recovered", RECOVERED_NOTICE, PLAIN_TRANSCRIPT, WIDTH), "⚙ background task status is back");
  assert.equal(tags(statusLine("unavailable", NO_SESSION_NOTICE, TAG, WIDTH)), "<muted>⚙</> <text>background tasks are off: this session is not saved (--no-session)</>", "off by choice: settled, not a warning");
  assert.equal(tags(statusLine("unavailable", unavailable("boom"), TAG, WIDTH)), "<warning>⚙</> <text>background task status unavailable: boom</>");
  assert.equal(tags(statusLine("recovered", RECOVERED_NOTICE, TAG, WIDTH)), "<success>⚙</> <text>background task status is back</>");
});

// Defect B: at 120 columns the collapsed line ended `…(not --no-se...`.
test("status notice: one line at 60 to 170 columns, shortened only between words", () => {
  const long = unavailable("STORE_CORRUPT: the task registry of this session cannot be read because its metadata is damaged beyond what recovery repairs; restore tasks.json from a copy or clear the sidecar directory before starting background tasks again");
  const notices: Array<["unavailable" | "recovered", string]> = [["unavailable", NO_SESSION_NOTICE], ["unavailable", long], ["recovered", RECOVERED_NOTICE]];
  for (const [status, content] of notices) {
    const full = statusLine(status, content, PLAIN_TRANSCRIPT, 1000);
    for (const width of [20, 40, ...WIDTHS]) {
      const line = statusLine(status, content, PLAIN_TRANSCRIPT, width);
      assert.ok(visibleWidth(line) <= width, `${width}: ${line}`);
      assert.doesNotMatch(line, /\n/);
      if (line === full) continue;
      assert.ok(line.endsWith("…"), `${width}: ${line}`);
      assert.ok(full.startsWith(`${line.slice(0, -1)} `), `cut inside a word at ${width}: ${line}`);
    }
  }
  assert.equal(statusLine("unavailable", NO_SESSION_NOTICE, PLAIN_TRANSCRIPT, 60), "⚙ background tasks are off: this session is not saved…");
  assert.equal(statusLine("unavailable", long, PLAIN_TRANSCRIPT, 60), "⚙ background task status unavailable: the task registry of…");
  assert.equal(statusLine("unavailable", long, PLAIN_TRANSCRIPT, 170),
    "⚙ background task status unavailable: the task registry of this session cannot be read because its metadata is damaged beyond what recovery repairs; restore tasks.json…");
  assert.equal(tags(statusLine("unavailable", long, TAG, 60)), "<warning>⚙</> <text>background task status unavailable: the task registry of…</>");
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

// Behavioral-Active × Blackbox × Group; regression: allocated-height clipping lost pane actions.
test("allocated background-task layout retains action hints", async (t) => {
  const backend = new MemoryTaskBackend("layout" as SessionId);
  for (let i = 0; i < 30; i++) await backend.spawn({ label: `task-${i}`, command: "sleep 30", cwd: "/", notify: false });
  const pane = await inspector(t, backend, PLAIN_THEME, 24);
  const frame = renderLayoutFrame(pane, 100, 18, () => {});
  assert.match(frame.lines.join("\n"), /t terminate {2}s signal/);
});

test("background-task pagination regrows under an auto-basis editor", async (t) => {
  const backend = new MemoryTaskBackend("resize" as SessionId);
  for (let i = 0; i < 30; i++) await backend.spawn({ label: `task-${i}`, command: "sleep 30", cwd: "/", notify: false });
  const pane = await inspector(t, backend, PLAIN_THEME, 30);
  const root = new VStack([
    { component: { render: () => ["chat"], invalidate() {} }, basis: 0, grow: 1 },
    { component: pane, grow: 0 },
    { component: { render: () => ["status", "badges"], invalidate() {} }, shrink: 0 },
  ]);
  renderLayoutFrame(root, 48, 12, () => {});
  const short = pane.bodyScroll.viewportHeight;
  renderLayoutFrame(root, 100, 24, () => {});
  assert.ok(pane.bodyScroll.viewportHeight > short);
});

test("fullscreen page keys target the wrapped log in detail and return to the transcript on the task list", async (t) => {
  const { ScrollView, TuiAltScreen, stripTerminalSequences } = await import("@earendil-works/pi-tui");
  const width = 60, height = 28;
  let input: (data: string) => void = () => assert.fail("terminal not started");
  const tui = new TuiAltScreen({
    columns: width, rows: height, kittyProtocolActive: false, start(onInput) { input = onInput; },
    stop() {}, async drainInput() {}, write() {}, moveBy() {}, hideCursor() {}, showCursor() {},
    clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {},
  });
  const backend = new MemoryTaskBackend("paging" as SessionId);
  const task = await backend.spawn({ label: "compiler", command: "running", cwd: "/", notify: false });
  const rows = Array.from({ length: 45 }, (_, i) => `out-${i + 1}:`.padEnd(width, "-"));
  backend.finish(task.id, 0, rows.join("") + "\n");
  const view = await inspector(t, backend, PLAIN_THEME, height);
  const chat = new ScrollView({ render: () => rows.map((_, i) => `Chat row ${i + 1}`), invalidate() {} }, { primary: true, follow: "end" });
  tui.setLayoutRoot(new VStack([{ component: chat, basis: 4, shrink: 0 }, { component: view, grow: 1, minSize: 0 }]));
  tui.setFocus(view);
  const screen = () => { tui.renderNow(); return tui.getScreenLines().map(line => stripTerminalSequences(line).trimEnd()); };
  const output = (lines: string[]) => lines.filter(line => line.startsWith("out-"));
  const send = async (key: string) => { input(key); await view.idle(); return screen(); };
  tui.start();
  try {
    assert.ok(screen().includes("Chat row 45"));
    const tail = output(await send(ENTER));
    assert.ok(tail.length > 1 && tail.length * 2 <= rows.length, tail.join("\n"));
    assert.deepEqual(tail, rows.slice(-tail.length));
    const earlier = await send(PAGE_UP);
    assert.ok(earlier.includes("Chat row 45"), "PgUp must not move the parent transcript from detail");
    assert.deepEqual(output(earlier), rows.slice(-2 * tail.length, -tail.length));
    assert.deepEqual(output(await send("\x1b[6~")), tail);
    assert.match((await send("\x1b")).join("\n"), /Background tasks/);
    assert.ok(!(await send(PAGE_UP)).includes("Chat row 45"), "PgUp belongs to the transcript on the task list");
    assert.ok((await send("\x1b[6~")).includes("Chat row 45"));
  } finally { tui.stop(); }
});
