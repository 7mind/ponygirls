import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { AgentInspector, AgentsScreen, TranscriptView, badgeState, chatModeFor, compactBadge, countTree, renderHeadless, sanitizeDisplay, widgetLine, type AgentDetails, type ChatMode, type InspectorAction, type TranscriptDeps } from "../src/ui.ts";
import { PLAIN_STYLE } from "../src/display.ts";
import { PLAIN_THEME, type UiTheme } from "@ponygirls/pi-ui";
import type { AgentView, TranscriptSource } from "../src/supervisor.ts";

const UP = "\x1b[A";
const DOWN = "\x1b[B";
const ENTER = "\r";
const ESC = "\x1b";
const PAGE_UP = "\x1b[5~";

function view(overrides: Partial<AgentView> = {}): AgentView {
  return {
    id: "a-1",
    path: "/root/a",
    parentId: null,
    depth: 1,
    profile: "reader",
    isolation: "none",
    workdir: "/proj",
    externalTools: [],
    model: "p/m",
    observed: "running",
    pendingIntent: "running",
    currentTaskRunId: null,
    generation: 1,
    taskOutcome: null,
    usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: null, cost: null, unknown: false },
    lastActivityAt: "2026-10-05T00:00:00.000Z",
    managedGateFor: null,
    gateTaskRunId: null,
    openQuestion: null,
    ...overrides,
  };
}

function inspector(views: AgentView[], opts: { details?: AgentDetails; rows?: number; theme?: UiTheme } = {}): { ui: AgentInspector; actions: InspectorAction[]; closed: () => boolean } {
  const actions: InspectorAction[] = [];
  let closed = false;
  const ui = new AgentInspector(views, {
    refresh: () => views,
    describe: () => opts.details ?? { result: null, question: null },
    onAction: (a) => actions.push(a),
    onClose: () => { closed = true; },
    rows: () => opts.rows ?? 40,
    theme: opts.theme ?? PLAIN_THEME,
  });
  return { ui, actions, closed: () => closed };
}

test("hostile ANSI/OSC output is sanitized", () => {
  const evil = "\x1b]0;pwned\x07hello\x1b[31mred\x1b[0m\x00\x1f";
  const clean = sanitizeDisplay(evil);
  assert.ok(!clean.includes("\x1b"));
  assert.ok(!clean.includes("\x00"));
  assert.equal(clean, "hellored");
});

test("the footer status names the total and only nonzero states", () => {
  const views = [view(), view({ id: "a-2", path: "/root/b", observed: "queued", pendingIntent: "queued" })];
  assert.equal(widgetLine(views), "agents 2 · running 1 · queued 1");
  assert.equal(widgetLine([view({ observed: "settled", pendingIntent: "settled" })]), "agents 1");
  assert.deepEqual(countTree(views), { running: 1, queued: 1, parked: 0, questions: 0 });
});

test("headless output contains no terminal escapes and names isolation and workdir", () => {
  const out = renderHeadless([view({ path: "/root/\x1b[31mevil" })]);
  assert.ok(!out.includes("\x1b"));
  assert.ok(out.includes("/root/evil") && out.includes("[reader, none]") && out.includes("workdir=/proj"));
  assert.equal(renderHeadless([]), "No subagents.");
});

test("the inspector shows the selected agent's details and opens its transcript on enter", () => {
  const views = [view(), view({ id: "a-2", path: "/root/b", profile: "writer", isolation: "worktree", workdir: "/wt/b", observed: "settled", pendingIntent: "settled", taskOutcome: "passed", gateTaskRunId: "task-b" })];
  const { ui, actions, closed } = inspector(views, { details: { result: "RESULT TEXT", question: "which file?" } });
  ui.handleInput(DOWN);
  const screen = ui.render(100).join("\n");
  for (const needle of ["/root/b", "writer · worktree", "passed", "workdir /wt/b", "gated task task-b", "question: which file?", "RESULT TEXT"]) {
    assert.ok(screen.includes(needle), `missing ${needle}:\n${screen}`);
  }
  ui.handleInput(ENTER);
  ui.handleInput("i");
  ui.handleInput("g");
  assert.deepEqual(actions, [{ kind: "transcript", agentId: "a-2" }, { kind: "interrupt", agentId: "a-2" }, { kind: "retry_review", agentId: "a-2" }]);
  ui.handleInput(ESC);
  assert.equal(closed(), true);
});

test("the inspector fills the terminal, keeps its selection across refreshes, and takes clicks", () => {
  const a = view();
  const b = view({ id: "a-2", path: "/root/b" });
  const { ui, actions } = inspector([a, b], { rows: 30 });
  ui.handleInput(DOWN);
  ui.refreshViews([view({ id: "a-0", path: "/root/0" }), a, b]);
  assert.equal(ui.selectedId(), "a-2");
  const lines = ui.render(90);
  assert.equal(lines.length, 30);
  assert.ok(lines.every((l) => visibleWidth(l) <= 90));
  const row = lines.findIndex((l) => l.includes("/root/a "));
  const click = { type: "click" as const, button: "left" as const, x: 3, y: row, screenX: 3, screenY: row, width: 90, height: 30, shift: false, alt: false, ctrl: false };
  ui.handleMouse({ ...click, clickCount: 2 });
  assert.equal(ui.selectedId(), "a-1");
  assert.deepEqual(actions, [{ kind: "transcript", agentId: "a-1" }]);
});

test("chat answers an open question, steers a running task, and otherwise starts a task", () => {
  assert.deepEqual(chatModeFor(view(), { messageId: "q1" }), { kind: "answer", replyTo: "q1" });
  assert.deepEqual(chatModeFor(view(), null), { kind: "steer" });
  assert.deepEqual(chatModeFor(view({ observed: "awaiting_parent", pendingIntent: "awaiting parent reply" }), null), { kind: "steer" });
  assert.deepEqual(chatModeFor(view({ observed: "settled", pendingIntent: "settled" }), null), { kind: "task" });
  assert.equal(chatModeFor(view({ pendingIntent: "closed" }), null).kind, "unavailable");
  assert.equal(chatModeFor(view({ managedGateFor: "t" }), null).kind, "unavailable");
});

function session(texts: string[]): string {
  return texts.map((text, i) => JSON.stringify({ type: "message", id: `e${i}`, parentId: i ? `e${i - 1}` : null, message: { role: "assistant", content: [{ type: "text", text }] } })).join("\n");
}

function transcriptView(over: Partial<TranscriptDeps> & { file?: () => { version: string; text: string }; source?: () => TranscriptSource } = {}): { ui: TranscriptView; sent: Array<{ text: string; mode: ChatMode }>; reads: () => number; back: () => boolean } {
  const sent: Array<{ text: string; mode: ChatMode }> = [];
  let reads = 0;
  let back = false;
  const file = over.file ?? (() => ({ version: "1", text: session(["hello"]) }));
  const ui = new TranscriptView({
    view: () => view(),
    source: () => ({ sessionFile: "/s.jsonl", reviews: [], streaming: null, messages: new Map() }),
    question: () => null,
    send: async (text, mode) => {
      sent.push({ text, mode });
      return "delivered";
    },
    back: () => { back = true; },
    requestRender: () => {},
    rows: () => 24,
    reader: { version: () => file().version, read: () => { reads++; return file().text; } },
    style: PLAIN_STYLE,
    theme: PLAIN_THEME,
    ...over,
  });
  return { ui, sent, reads: () => reads, back: () => back };
}

test("the transcript re-reads the session only when it changes and stays within the terminal", () => {
  let current = { version: "1", text: session(["hello"]) };
  const { ui, reads } = transcriptView({ file: () => current });
  ui.refresh();
  assert.equal(reads(), 1);
  current = { version: "2", text: session(["hello", "world"]) };
  assert.equal(ui.refresh(), true);
  const lines = ui.render(70);
  assert.equal(reads(), 2);
  assert.equal(lines.length, 24);
  assert.ok(lines.some((l) => l.includes("world")) && lines.every((l) => visibleWidth(l) <= 70));
});

test("streamed text shows with a cursor and stays until the session holds the message", () => {
  let streaming: string | null = "partial answ";
  let current = { version: "1", text: session(["earlier"]) };
  const { ui } = transcriptView({ file: () => current, source: () => ({ sessionFile: "/s.jsonl", reviews: [], streaming, messages: new Map() }) });
  ui.refresh();
  assert.ok(ui.render(70).some((l) => l.includes("partial answ▍")));
  streaming = null;
  ui.refresh();
  assert.ok(ui.render(70).some((l) => l.includes("partial answ▍")), "no gap before the session catches up");
  current = { version: "2", text: session(["earlier", "partial answer, complete"]) };
  ui.refresh();
  const lines = ui.render(70);
  assert.ok(lines.some((l) => l.includes("partial answer, complete")) && !lines.some((l) => l.includes("▍")));
});

test("the chat line sends with the agent's mode and clears; escape goes back", async () => {
  const { ui, sent, back } = transcriptView();
  for (const ch of "go on") ui.handleInput(ch);
  ui.handleInput(ENTER);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(sent, [{ text: "go on", mode: { kind: "steer" } }]);
  const lines = ui.render(70);
  assert.ok(lines.some((l) => l.includes("delivered")));
  assert.ok(!lines.some((l) => l.includes("go on")), "the input was cleared");
  ui.handleInput(ESC);
  assert.equal(back(), true);
});

test("a closed agent cannot be messaged; a reviewer without reviews says so", () => {
  const closed = transcriptView({ view: () => view({ pendingIntent: "closed" }) });
  for (const ch of "hi") closed.ui.handleInput(ch);
  closed.ui.handleInput(ENTER);
  assert.equal(closed.sent.length, 0);
  assert.ok(closed.ui.render(70).some((l) => l.includes("not sent: the agent is closed")));
  const reviewer = transcriptView({ view: () => view({ managedGateFor: "t1" }), source: () => ({ sessionFile: null, reviews: [], streaming: null, messages: new Map() }) });
  assert.ok(reviewer.ui.render(70).some((l) => l.includes("No reviews yet.")));
});

test("scrolling moves through history by line, page, and wheel", () => {
  const { ui } = transcriptView({ view: () => view({ observed: "settled", pendingIntent: "settled" }), file: () => ({ version: "1", text: session(Array.from({ length: 60 }, (_, i) => `line ${i}`)) }) });
  const last = (): string => ui.render(70).filter((l) => l.startsWith("line ")).at(-1) ?? "";
  assert.equal(last(), "line 59");
  ui.handleInput(UP);
  assert.equal(last(), "line 58");
  ui.handleInput(PAGE_UP);
  assert.ok(Number(last().split(" ")[1]) < 58);
  ui.handleMouse({ type: "wheel", button: "none", x: 0, y: 0, screenX: 0, screenY: 0, width: 70, height: 24, shift: false, alt: false, ctrl: false, wheelDelta: 100 });
  assert.equal(last(), "line 59");
});

test("the screen switches between the list and a transcript and passes focus to the chat line", () => {
  const views = [view()];
  const screen = new AgentsScreen({
    list: () => views,
    describe: () => ({ result: null, question: null }),
    transcript: (_id, back) => ({
      view: () => views[0]!,
      source: () => ({ sessionFile: null, reviews: [], streaming: null, messages: new Map() }),
      question: () => null,
      send: async () => "ok",
      back,
      requestRender: () => {},
      rows: () => 24,
      reader: { version: () => null, read: () => "" },
      style: PLAIN_STYLE,
      theme: PLAIN_THEME,
    }),
    onAction: () => {},
    onClose: () => {},
    requestRender: () => {},
    rows: () => 24,
    theme: PLAIN_THEME,
  });
  screen.focused = true;
  screen.handleInput(ENTER);
  assert.ok(screen.transcript, "enter opened the transcript");
  assert.equal(screen.transcript!.focused, true);
  assert.ok(screen.render(70).some((l) => l.includes("No conversation yet")));
  screen.handleInput(ESC);
  assert.equal(screen.transcript, null);
  assert.ok(screen.render(70).some((l) => l.includes("Subagents")));
});

test("a gated agent's transcript shows each review in a gate frame where it happened", () => {
  const entry = (id: string, parentId: string | null, at: string, message: Record<string, unknown>): string => JSON.stringify({ type: "message", id, parentId, timestamp: at, message });
  const main = [
    entry("m1", null, "2026-10-06T10:00:00.000Z", { role: "user", content: "fix it" }),
    entry("m2", "m1", "2026-10-06T10:00:05.000Z", { role: "assistant", content: [{ type: "text", text: "FIRST ANSWER" }] }),
    entry("m3", "m2", "2026-10-06T10:01:00.000Z", { role: "user", content: "Reviewer requires changes to candidate candidate-1 (round 1):\n- [F1] add docs" }),
    entry("m4", "m3", "2026-10-06T10:01:05.000Z", { role: "assistant", content: [{ type: "text", text: "SECOND ANSWER" }] }),
  ].join("\n");
  const review = [
    entry("r1", null, "2026-10-06T10:00:30.000Z", { role: "user", content: "[subagent r task t1]\nrubric line 1\nline 2\nline 3\nline 4\nline 5\nline 6" }),
    entry("r2", "r1", "2026-10-06T10:00:40.000Z", { role: "assistant", content: [{ type: "toolCall", id: "d1", name: "submit_gate_decision", arguments: { decision: "revise", candidateId: "candidate-1", blockers: [{ id: "F1" }], reason: "LONG REASON" } }] }),
    entry("r3", "r2", "2026-10-06T10:00:41.000Z", { role: "toolResult", toolCallId: "d1", toolName: "submit_gate_decision", content: [{ type: "text", text: "{\"accepted\":true}" }] }),
  ].join("\n");
  const files = new Map([["/main.jsonl", main], ["/review-1.jsonl", review]]);
  const { ui } = transcriptView({
    view: () => view({ observed: "settled", pendingIntent: "settled" }),
    rows: () => 60,
    source: () => ({ sessionFile: "/main.jsonl", streaming: null, messages: new Map(), reviews: [{ reviewId: "review-1", taskRunId: "t1", candidateId: "candidate-1", model: "zai/glm", sessionFile: "/review-1.jsonl", at: "2026-10-06T10:00:30.000Z", active: false, streaming: null }] }),
    reader: { version: (p) => (files.has(p) ? "1" : null), read: (p) => files.get(p)! },
  });
  const lines = ui.render(90);
  const at = (needle: string): number => lines.findIndex((l) => l.includes(needle));
  assert.ok(at("FIRST ANSWER") < at("╭─ gate review-1 · candidate-1 · zai/glm") && at("╰─ decision: revise · candidate-1 · 1 blocker") < at("repair requested by the gate") && at("repair requested by the gate") < at("SECOND ANSWER"), lines.join("\n"));
  const inside = lines.slice(at("╭─ gate"), at("╰─ decision") + 1);
  assert.ok(inside.slice(1, -1).every((l) => l.startsWith("┃ ")), inside.join("\n"));
  assert.ok(inside.some((l) => l.includes("▸ review prompt")) && !inside.some((l) => l.includes("line 6")), "the review prompt is collapsed");
  assert.ok(inside.some((l) => l.includes("rubric line 1")) && !lines.some((l) => l.includes("[subagent")), "the worker's task header is not shown");
  assert.ok(!lines[at("╰─ decision")]!.includes("LONG REASON"), "the frame's footer is compact");
});

/** Zero-width OSC markers around every styled span, so widths stay real; `tags()` makes them readable. */
const mark = (tag: string, text: string): string => `\x1b]777;${tag}\x07${text}\x1b]777;/\x07`;
const TAG_THEME: UiTheme = {
  fg: (color, text) => mark(color, text),
  bg: (color, text) => mark(`bg:${color}`, text),
  bold: (text) => mark("bold", text),
};
const tags = (line: string): string => line.replace(/\x1b\]777;([^\x07]*)\x07/g, "<$1>");

test("D1: a non-selected row colours its outcome by the outcome, not as an error", () => {
  const views = [view(), view({ id: "a-2", path: "/root/b", observed: "settled", pendingIntent: "settled", taskOutcome: "succeeded" })];
  const { ui } = inspector(views, { rows: 30, theme: TAG_THEME });
  const row = tags(ui.render(120).find((l) => l.includes("/root/b") && !l.includes("workdir"))!);
  assert.match(row, /<success>✓ succeeded<\/>/, row);
  assert.doesNotMatch(row, /<error>/, row);
});

test("the inspector is framed: title with counts, dim column header, aligned cells, indented nesting, rule, hints last", () => {
  const views = [
    view({ observed: "settled", pendingIntent: "settled", taskOutcome: "succeeded" }),
    view({ id: "a-2", path: "/root/b", observed: "running", pendingIntent: "running" }),
    view({ id: "a-3", path: "/root/b/fix", parentId: "a-2", depth: 2, profile: "writer", isolation: "worktree", model: "kimi-k3", observed: "settled", pendingIntent: "settled", taskOutcome: "failed" }),
  ];
  const { ui } = inspector(views, { rows: 30, theme: TAG_THEME });
  const lines = ui.render(120);
  assert.equal(lines.length, 30);
  assert.ok(lines.every((l) => visibleWidth(l) <= 120));
  const plain = lines.map((l) => tags(l).replace(/<[^>]*>/g, ""));
  assert.match(plain[0]!, /^── Subagents · agents 3 · running 1 ─+──$/);
  assert.match(tags(lines[1]!), /^<dim> {2}AGENT +KIND +STATE +OUTCOME +MODEL<\/>$/);
  const column = (header: string): number => plain[1]!.indexOf(header);
  for (const row of plain.slice(2, 5)) {
    assert.equal(row.indexOf(row.includes("writer") ? "writer" : "reader"), column("KIND"), row);
  }
  assert.equal(plain[3]!.indexOf("running"), column("STATE"));
  assert.equal(plain[4]!.indexOf("✖ failed"), column("OUTCOME"));
  assert.equal(plain[4]!.indexOf("kimi-k3"), column("MODEL"));
  assert.ok(plain[4]!.startsWith("    /root/b/fix"), "nested agents are indented");
  assert.ok(plain[3]!.includes("—"), "no outcome yet is a dash");
  assert.match(plain[5]!, /^─+$/, "a rule separates the list from the details");
  assert.ok(plain.some((l) => /^kind reader · none {2}model p\/m {2}state settled {2}outcome ✓ succeeded/.test(l)));
  assert.match(tags(lines.find((l) => tags(l).includes("model"))!), /<muted>kind<\/> reader/, "detail labels are muted");
  assert.match(plain[28]!, /^─+$/);
  assert.match(plain[29]!, /^↑↓ select {2}⏎ transcript {2}m note {2}t task {2}i interrupt {2}c close {2}a answer {2}g gate {2}r refresh {2}esc close$/);
});

test("the selected row spans the width, keeps state and outcome colours, and uses muted rather than dim", () => {
  const views = [view({ openQuestion: { messageId: "q", to: "governor", text: "?", deadlineAt: "" }, pendingIntent: "awaiting parent reply", observed: "awaiting_parent" }), view({ id: "a-2", path: "/root/b", observed: "settled", pendingIntent: "settled", taskOutcome: "succeeded" })];
  const { ui } = inspector(views, { rows: 30, theme: TAG_THEME });
  const first = ui.render(100)[2]!;
  assert.equal(visibleWidth(first), 100, "full-width selection band");
  assert.match(tags(first), /^<bg:selectedBg><accent>▌<\/> <bold>/);
  assert.match(tags(first), /<warning>awaiting parent reply<\/>/);
  assert.match(tags(first), /<muted>—<\/>/);
  assert.doesNotMatch(tags(first), /<dim>/);
  ui.handleInput(DOWN);
  const lines = ui.render(100);
  assert.match(tags(lines[2]!), /^ {2}.*<dim>—<\/>/, "unselected rows may use dim");
  assert.match(tags(lines[3]!), /<success>✓ succeeded<\/>/);
});

test("the inspector shows its scroll position in the title when the list overflows", () => {
  const views = Array.from({ length: 12 }, (_, i) => view({ id: `a-${i}`, path: `/root/a${i}` }));
  const { ui } = inspector(views, { rows: 24 });
  assert.match(ui.render(90)[0]!, /── 1–4 of 12 ──$/);
});

test("the border short form is the agent glyph in the tree's state colour and the total", () => {
  const settled = view({ observed: "settled", pendingIntent: "settled" });
  assert.equal(badgeState([settled]), "settled");
  assert.equal(badgeState([settled, view({ id: "a-2", observed: "queued", pendingIntent: "queued" })]), "running");
  assert.equal(badgeState([view(), view({ id: "a-2", openQuestion: { messageId: "q", to: "/root/a", text: "?", deadlineAt: "" } })]), "attention");
  assert.equal(compactBadge(PLAIN_THEME, [settled, settled]), " ◈2 ");
  assert.equal(tags(compactBadge(TAG_THEME, [view()])), "<bg:toolPendingBg> <accent>◈</><text>1</> </>");
});

test("the transcript is framed with the agent path, kind and model, and its state and outcome on the right", () => {
  const { ui } = transcriptView({ view: () => view({ observed: "settled", pendingIntent: "settled", taskOutcome: "failed" }), theme: TAG_THEME });
  const lines = ui.render(90);
  assert.equal(lines.length, 24);
  const title = tags(lines[0]!);
  assert.match(title.replace(/<[^>]*>/g, ""), /^── \/root\/a · reader · none · p\/m ─+ settled · ✖ failed ──$/);
  assert.match(title, /<error>✖ failed<\/>/);
  assert.match(tags(lines[1]!), /^<muted>workdir<\/> \/proj/);
  assert.equal(tags(lines.at(-1)!).replace(/<[^>]*>/g, ""), "⏎ send a new task  ↑↓ PgUp PgDn scroll  esc back to the list");
  assert.match(tags(lines.at(-1)!), /^<text>⏎<\/> <muted>send a new task<\/>/);
  const narrow = ui.render(40);
  assert.equal(narrow.length, 24, "wrapped hints shrink the viewport, not the frame");
  assert.ok(narrow.every((l) => visibleWidth(l) <= 40));
});
