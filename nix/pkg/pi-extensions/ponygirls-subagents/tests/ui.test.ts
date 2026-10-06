import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { AgentInspector, AgentsScreen, TranscriptView, chatModeFor, countTree, renderHeadless, sanitizeDisplay, widgetLine, type AgentDetails, type ChatMode, type InspectorAction, type TranscriptDeps } from "../src/ui.ts";
import { PLAIN_STYLE } from "../src/display.ts";
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
    model: "p/m",
    observed: "running",
    pendingIntent: "running",
    currentTaskRunId: null,
    generation: 1,
    taskOutcome: null,
    usage: { inputTokens: 1, outputTokens: 2, cost: null, unknown: false },
    lastActivityAt: "2026-10-05T00:00:00.000Z",
    managedGateFor: null,
    gateTaskRunId: null,
    openQuestion: null,
    ...overrides,
  };
}

function inspector(views: AgentView[], opts: { details?: AgentDetails; rows?: number } = {}): { ui: AgentInspector; actions: InspectorAction[]; closed: () => boolean } {
  const actions: InspectorAction[] = [];
  let closed = false;
  const ui = new AgentInspector(views, {
    refresh: () => views,
    describe: () => opts.details ?? { result: null, question: null },
    onAction: (a) => actions.push(a),
    onClose: () => { closed = true; },
    rows: () => opts.rows ?? 40,
    style: PLAIN_STYLE,
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
    }),
    onAction: () => {},
    onClose: () => {},
    requestRender: () => {},
    rows: () => 24,
    style: PLAIN_STYLE,
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
