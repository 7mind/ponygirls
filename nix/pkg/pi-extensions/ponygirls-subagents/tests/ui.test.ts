import { renderLayoutFrame } from "@earendil-works/pi-tui/dist/layout.js";
import assert from "node:assert/strict";
import test from "node:test";
import { BoundedVStack, VStack, visibleWidth } from "@earendil-works/pi-tui";
import { AgentInspector, AgentsScreen, TranscriptView, agentsBadge, chatModeFor, countTree, phaseOf, renderHeadless, sanitizeDisplay, widgetLine, type AgentDetails, type AgentsScreenDeps, type ChatMode, type InspectorAction, type TranscriptDeps } from "../src/ui.ts";
import { PLAIN_STYLE, homeRelative, type UiStyle } from "../src/display.ts";
import { PLAIN_THEME, borderBadge, borderBadgeCompact, type UiTheme } from "@ponygirls/pi-ui";
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
    requestedThinkingLevel: "off",
    thinkingLevel: "off",
    observed: "running",
    desiredLifecycle: "open",
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

const HOME = "/home/u";

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
    home: HOME,
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

test("the headless summary names the total and only nonzero states", () => {
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
  for (const needle of [/\/root\/b/, /writer · worktree/, /✓ passed/, /^ {2}workdir +\/wt\/b$/m, /^ {2}gate +task task-b$/m, /^ {2}question +which file\?$/m, /^ {2}result +RESULT TEXT$/m]) {
    assert.match(screen, needle);
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

// Behavioral-Active × Blackbox × Group; specified pane visibility and action targeting.
test("the inspector defaults to non-closed agents and toggles all retained agents with f", () => {
  const closed = view({ id: "closed", path: "/root/closed", observed: "settled", desiredLifecycle: "closed", pendingIntent: "closed" });
  const idle = view({ id: "idle", path: "/root/idle", observed: "settled", pendingIntent: "settled", taskOutcome: "succeeded" });
  const { ui, actions } = inspector([closed, idle]);
  assert.equal(ui.selectedId(), "idle");
  assert.doesNotMatch(ui.render(120).join("\n"), /\/root\/closed/);
  assert.match(ui.render(120).join("\n"), /f show closed/);
  ui.handleInput("f");
  assert.equal(ui.selectedId(), "idle");
  assert.match(ui.render(120).join("\n"), /\/root\/closed/);
  assert.match(ui.render(120).join("\n"), /f hide closed/);
  ui.handleInput(UP);
  ui.handleInput(ENTER);
  assert.deepEqual(actions, [{ kind: "transcript", agentId: "closed" }]);
  ui.handleInput("r");
  assert.equal(ui.selectedId(), "closed");
  ui.handleInput("f");
  assert.equal(ui.selectedId(), "idle");
  ui.refreshViews([closed, { ...idle, desiredLifecycle: "closed", pendingIntent: "closed" }]);
  assert.equal(ui.selectedId(), null);
  assert.match(ui.render(120).join("\n"), /No active subagents/);
  ui.handleInput(DOWN);
  ui.handleInput(ENTER);
  assert.equal(actions.length, 1);
  ui.refreshViews([closed, idle]);
  assert.equal(ui.selectedId(), "idle");
  ui.handleInput("f");
  ui.refreshViews([closed, idle, view({ id: "new-closed", desiredLifecycle: "closed", pendingIntent: "closed" })]);
  assert.match(ui.render(120)[0]!, /^── Subagents · 3 /);
});

test("closed agents stay hidden when a storage failure overrides their display intent", () => {
  const closed = view({ id: "closed", path: "/root/closed", desiredLifecycle: "closed", pendingIntent: "storage failed: restart/reopen required; observed state is last known" });
  const { ui } = inspector([closed]);
  assert.equal(ui.selectedId(), null);
  assert.ok(ui.render(40).every((line) => visibleWidth(line) <= 40));
  ui.handleInput("f");
  assert.equal(ui.selectedId(), "closed");
  ui.handleInput("f");
  assert.equal(ui.selectedId(), null);
});

test("filtered mouse rows target visible agents and toggling resets a scrolled empty list", () => {
  const closed = Array.from({ length: 10 }, (_, i) => view({ id: `closed-${i}`, path: `/root/closed-${i}`, desiredLifecycle: "closed", pendingIntent: "closed" }));
  const { ui, actions } = inspector([...closed, view()], { rows: 24 });
  ui.handleMouse({ type: "click", button: "left", x: 3, y: 2, screenX: 3, screenY: 2, width: 120, height: 24, shift: false, alt: false, ctrl: false, clickCount: 2 });
  assert.deepEqual(actions, [{ kind: "transcript", agentId: "a-1" }]);
  ui.handleInput("f");
  ui.render(120);
  ui.refreshViews(closed);
  ui.render(120);
  ui.handleInput("f");
  assert.equal(ui.selectedId(), null);
  assert.match(ui.render(120).join("\n"), /No active subagents/);
  ui.handleInput("f");
  assert.equal(ui.selectedId(), "closed-0");
  assert.match(ui.render(120)[0]!, /1–4 of 10/);
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
  const deps: TranscriptDeps = {
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
  };
  const ui = new TranscriptView(deps, { home: HOME, paneRows: deps.rows });
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
  const views = [view(), view({ id: "closed", path: "/root/closed", desiredLifecycle: "closed", pendingIntent: "closed" })];
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
  assert.doesNotMatch(screen.render(100).join("\n"), /\/root\/closed/);
  screen.handleInput("f");
  assert.match(screen.render(100).join("\n"), /\/root\/closed/);
  screen.handleInput(ENTER);
  assert.ok(screen.transcript, "enter opened the transcript");
  assert.equal(screen.transcript!.focused, true);
  assert.ok(screen.render(70).some((l) => l.includes("No conversation yet")));
  screen.handleInput(ESC);
  assert.equal(screen.transcript, null);
  assert.ok(screen.render(70).some((l) => l.includes("Subagents")));
  screen.refresh();
  assert.match(screen.render(100).join("\n"), /\/root\/closed/);
  screen.handleInput("f");
  assert.doesNotMatch(screen.render(100).join("\n"), /\/root\/closed/);
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
    source: () => ({ sessionFile: "/main.jsonl", streaming: null, messages: new Map(), reviews: [{ reviewId: "review-1", taskRunId: "t1", candidateId: "candidate-1", model: "zai/glm", requestedThinkingLevel: "off", thinkingLevel: "off", sessionFile: "/review-1.jsonl", at: "2026-10-06T10:00:30.000Z", active: false, streaming: null }] }),
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
  const lines = ui.render(140);
  assert.equal(lines.length, 30);
  assert.ok(lines.every((l) => visibleWidth(l) <= 140));
  const plain = lines.map((l) => tags(l).replace(/<[^>]*>/g, ""));
  assert.match(plain[0]!, /^── Subagents · 3 ─+ 1 running · 2 settled ──$/);
  assert.match(tags(lines[0]!), /<accent>1 running<\/><dim> · <\/><muted>2 settled<\/>/, "counts carry their state's colour");
  assert.match(tags(lines[1]!), /^<dim> {2}AGENT +KIND +STATE +MODEL +TOKENS<\/>$/);
  const column = (header: string): number => plain[1]!.indexOf(header);
  for (const row of plain.slice(2, 5)) {
    assert.equal(row.indexOf(row.includes("writer") ? "writer" : "reader"), column("KIND"), row);
  }
  assert.equal(plain[2]!.indexOf("✓ succeeded"), column("STATE"));
  assert.equal(plain[3]!.indexOf("● running"), column("STATE"));
  assert.equal(plain[4]!.indexOf("✖ failed"), column("STATE"));
  assert.equal(plain[4]!.indexOf("kimi-k3"), column("MODEL"));
  assert.equal(plain[4]!.indexOf("1 in · 2 out"), column("TOKENS"));
  assert.ok(plain[4]!.startsWith("    /root/b/fix"), "nested agents are indented");
  assert.match(plain[5]!, /^─+$/, "a rule separates the list from the details");
  assert.equal(plain[6], "  id       a-1 · generation 1");
  assert.equal(plain[7], "  workdir  /proj");
  assert.match(tags(lines[6]!), /^ {2}<muted>id {5}<\/> {2}a-1/, "detail keys are muted");
  assert.match(plain[28]!, /^─+$/);
  assert.equal(plain[29], "↑↓ select  ⏎ transcript  t new task  m note  c close agent  f show closed  esc close");
});

test("the model cell appends the effective effort in the picker colour without adding a column", () => {
  const { ui } = inspector([
    view({ model: "claude-code/claude-sonnet-5-5", thinkingLevel: "xhigh", requestedThinkingLevel: "max" }),
    view({ id: "off", path: "/root/off", model: "test/plain", thinkingLevel: "off", requestedThinkingLevel: "high" }),
    view({ id: "pending", path: "/root/pending", model: "test/next", observed: "queued", pendingIntent: "queued", thinkingLevel: "unresolved", requestedThinkingLevel: "high" }),
  ], { theme: TAG_THEME });
  const lines = ui.render(140).map(tags);
  assert.match(lines[1]!, /STATE +MODEL +TOKENS/);
  assert.match(lines[2]!, /claude-code\/claude-sonnet-5-5:<\/><thinkingXhigh>xhigh<\/>/);
  assert.match(lines[3]!, /test\/plain:<\/><thinkingOff>off<\/>/);
  assert.match(lines[4]!, /test\/next:unresolved/);
});

test("a short narrow inspector still shows the selected model's wrapped effort", () => {
  const { ui } = inspector([
    view({ model: "claude-code/claude-sonnet-5-5", thinkingLevel: "xhigh" }),
    view({ id: "queued", path: "/root/queued", observed: "queued", pendingIntent: "queued", thinkingLevel: "unresolved" }),
    view({ id: "review", path: "/root/review", managedGateFor: "test" }),
  ], { rows: 13 });
  const lines = text(ui.render(40));
  assert.equal(lines.length, 13);
  assert.match(lines.join("\n"), /hidden at this width/);
  assert.ok(lines.some((line) => /^  model +claude-code\/.*….*:xhigh$/.test(line)), lines.join("\n"));
});

test("the selected row spans the width, keeps state and outcome colours, and uses muted rather than dim", () => {
  const unused = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: null, cost: null, unknown: false };
  const views = [view({ openQuestion: { messageId: "q", to: "governor", text: "?", deadlineAt: "" }, pendingIntent: "awaiting parent reply", observed: "awaiting_parent", usage: unused }), view({ id: "a-2", path: "/root/b", observed: "settled", pendingIntent: "settled", taskOutcome: "succeeded" })];
  const { ui } = inspector(views, { rows: 30, theme: TAG_THEME });
  const first = ui.render(100)[2]!;
  assert.equal(visibleWidth(first), 100, "full-width selection band");
  assert.match(tags(first), /^<bg:selectedBg><accent>▌<\/> <bold>/);
  assert.match(tags(first), /<warning>\? awaiting parent reply<\/>/);
  assert.match(tags(first), /<muted>·<\/>/, "no tokens yet is a quiet dot");
  assert.doesNotMatch(tags(first), /<dim>/);
  ui.handleInput(DOWN);
  const lines = ui.render(100);
  assert.match(tags(lines[2]!), /^ {2}.*<dim>·<\/>/, "unselected rows may use dim");
  assert.match(tags(lines[3]!), /<success>✓ succeeded<\/>/);
});

test("the inspector shows its scroll position in the title when the list overflows", () => {
  const views = Array.from({ length: 12 }, (_, i) => view({ id: `a-${i}`, path: `/root/a${i}` }));
  const { ui } = inspector(views, { rows: 24 });
  assert.match(ui.render(90)[0]!, /^── Subagents · 1–4 of 12 ─+ 12 running ──$/);
});

test("the border badge is the agent count, then the live agents by the pane's glyphs, in the tree's state colour", () => {
  const settled = (id: string): AgentView => view({ id, observed: "settled", pendingIntent: "settled", taskOutcome: "succeeded" });
  const running = (id: string): AgentView => view({ id });
  const starting = (id: string): AgentView => view({ id, observed: "starting", pendingIntent: "starting" });
  const queued = (id: string): AgentView => view({ id, observed: "queued", pendingIntent: "queued" });
  const asking = (id: string): AgentView => view({ id, observed: "awaiting_parent", pendingIntent: "awaiting parent reply", openQuestion: { messageId: "q", to: "governor", text: "?", deadlineAt: "" } });
  const quiet = [settled("a"), settled("b"), settled("c")];
  const busy = [running("a"), settled("b"), starting("c")];
  const waiting = [running("a"), asking("b"), settled("c")];
  const all = [queued("a"), asking("b"), queued("c"), running("d")];
  assert.deepEqual(agentsBadge(quiet), { glyph: "👥", state: "settled", label: "3", compact: "3" });
  assert.deepEqual(agentsBadge(busy), { glyph: "👥", state: "running", label: "3 ●2", compact: "3" });
  assert.deepEqual(agentsBadge(waiting), { glyph: "👥", state: "attention", label: "3 ●1 ?1", compact: "3?" });
  assert.deepEqual(agentsBadge(all), { glyph: "👥", state: "attention", label: "4 ●1 ○2 ?1", compact: "4?" });
  assert.deepEqual(agentsBadge([queued("a"), settled("b")]), { glyph: "👥", state: "running", label: "2 ○1", compact: "2" });
  // An agent is counted once: a question it asked while running makes it asking, as in the pane.
  assert.equal(agentsBadge([view({ openQuestion: { messageId: "q", to: "/root/a", text: "?", deadlineAt: "" } })]).label, "1 ?1");
  // Through the kit: no background chip, the glyph unstyled, the label in the state's colour.
  assert.equal(tags(borderBadge(TAG_THEME, agentsBadge(quiet), 80)), " 👥 <muted>3</> ");
  assert.equal(tags(borderBadge(TAG_THEME, agentsBadge(busy), 80)), " 👥 <accent>3 ●2</> ");
  assert.equal(tags(borderBadge(TAG_THEME, agentsBadge(waiting), 80)), " 👥 <warning>3 ●1 ?1</> ");
  assert.equal(tags(borderBadgeCompact(TAG_THEME, agentsBadge(waiting), 80)), "👥<warning>3?</>");
  assert.equal(tags(borderBadgeCompact(TAG_THEME, agentsBadge(busy), 80)), "👥<accent>3</>");
  assert.equal(borderBadge(PLAIN_THEME, agentsBadge(all), 80), " 👥 4 ●1 ○2 ?1 ");
});

test("the transcript is framed with the agent path, kind and model, and its state and outcome on the right", () => {
  const { ui } = transcriptView({ view: () => view({ observed: "settled", pendingIntent: "settled", taskOutcome: "failed" }), theme: TAG_THEME });
  const lines = ui.render(90);
  assert.equal(lines.length, 24);
  const title = tags(lines[0]!);
  assert.match(title.replace(/<[^>]*>/g, ""), /^── \/root\/a · reader · none · p\/m ─+ settled · ✖ failed ──$/);
  assert.match(title, /<error>✖ failed<\/>/);
  assert.match(tags(lines[1]!), /^<muted>workdir<\/> \/proj/);
  assert.equal(tags(lines.at(-1)!).replace(/<[^>]*>/g, ""), "⏎ send task  ↑↓ scroll  PgUp/PgDn page  esc back");
  assert.match(tags(lines.at(-1)!), /^<text>⏎<\/> <muted>send task<\/>/);
  const narrow = ui.render(40);
  assert.equal(narrow.length, 24, "wrapped hints shrink the viewport, not the frame");
  assert.ok(narrow.every((l) => visibleWidth(l) <= 40));
});

// Behavioral-Active × Blackbox × Group; regression: allocated-height clipping lost pane actions.
test("allocated inspector layout retains close hints", () => {
  const { ui } = inspector([], { rows: 24 });
  const frame = renderLayoutFrame(ui, 100, 18, () => {});
  assert.match(frame.lines.join("\n"), /esc close/);
});

// Regression: intrinsic wide previews must not change an allocated transcript's reading position.
test("transcript measurement preserves scroll position and fixed chat/footer", () => {
  const { ui } = transcriptView({ file: () => ({ version: "1", text: session([Array.from({ length: 40 }, (_, i) => `word-${i}`).join(" ")]) }) });
  const root = new VStack([{ component: ui, grow: 0 }]);
  const draw = () => renderLayoutFrame(root, 48, 12, () => {}).lines;
  draw();
  const initial = draw();
  ui.handleInput(PAGE_UP);
  const before = draw();
  assert.notDeepEqual(before, initial, "page up must actually change the reading position before preview");
  ui.render(120);
  const after = draw();
  assert.deepEqual(after, before);
  assert.ok(after.some((line) => line.includes("›")), "the input remains outside the scrollable body");
  assert.ok(after.some((line) => line.includes("esc")), "transcript exit hints remain visible");
});

test("an auto-basis inspector grows with its available height", () => {
  const { ui } = inspector(Array.from({ length: 30 }, (_, i) => view({ id: `agent-${i}`, path: `/root/agent-${i}` })), { rows: 30 });
  const root = new VStack([
    { component: { render: () => ["chat"], invalidate() {} }, basis: 0, grow: 1 },
    { component: ui, grow: 0 },
    { component: { render: () => ["status", "badges"], invalidate() {} }, shrink: 0 },
  ]);
  renderLayoutFrame(root, 48, 12, () => {});
  const short = ui.bodyScroll.viewportHeight;
  renderLayoutFrame(root, 100, 24, () => {});
  assert.ok(ui.bodyScroll.viewportHeight > short);
});

// ---- /agents pane rework: one STATE column, TOKENS, key/value details, state-dependent hints ----

const WIDTHS = [60, 80, 100, 120, 170];
const usage = (inputTokens: number, outputTokens: number, cost: number | null = null): AgentView["usage"] => ({ inputTokens, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: null, cost, unknown: false });
/** Lines as the terminal shows them: no SGR sequences (truncation appends resets), no trailing blanks. */
const text = (lines: string[]): string[] => lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").trimEnd());
const hintLine = (lines: string[]): string => text(lines).slice(lines.findLastIndex((l) => /^─+$/.test(l)) + 1).join("  ");

/** The agent of the specification's capture: settled, succeeded, 8.8k tokens in. */
const demo = view({
  id: "7c1d4e9a-2b6f-4a35-8e0c-1f9b3d5a7e24", path: "/root/demo-reader", isolation: "worktree", workdir: `${HOME}/work/flakes/ponygirls`,
  model: "openai-codex/gpt-6.1-sol", thinkingLevel: "high", requestedThinkingLevel: "high", observed: "settled", pendingIntent: "settled", taskOutcome: "succeeded", usage: usage(8800, 5),
});

const question = "Which of the two candidate files should I change: the legacy adapter under compat/, which every caller still imports, or the new facade, which only the tests use so far? I would rather not touch both.";

/** One agent in every state the list distinguishes, with long values in every field. */
const crowd: AgentView[] = [
  view({ id: "11111111-1111-4111-8111-111111111111", path: "/root/orchestrator", profile: "writer", isolation: "worktree", workdir: `${HOME}/work/flakes/ponygirls/.worktrees/wt-ponygirls-orchestrator`, model: "anthropic/claude-opus-4-20250514", pendingIntent: "tool bash running", usage: usage(115173, 4210, 1.2345) }),
  view({ id: "22222222-2222-4222-8222-222222222222", path: "/root/orchestrator/implement-the-feature-with-a-long-name/verify-and-fix-regressions", parentId: "11111111-1111-4111-8111-111111111111", depth: 3, observed: "awaiting_parent", pendingIntent: "awaiting parent reply", openQuestion: { messageId: "q1", to: "governor", text: question, deadlineAt: "" }, usage: usage(52000, 900) }),
  view({ id: "33333333-3333-4333-8333-333333333333", path: "/root/queued", observed: "queued", pendingIntent: "queued: waiting for runnable capacity; wait for running work to settle", usage: usage(0, 0) }),
  view({ id: "44444444-4444-4444-8444-444444444444", path: "/root/gated", profile: "writer", isolation: "sandbox", observed: "settled", pendingIntent: "settled", taskOutcome: "review_limit_reached", gateTaskRunId: "task-run-0001", workdir: "/srv/checkouts/a-directory-name-without-any-space-that-is-longer-than-a-narrow-terminal-line/repo", usage: { ...usage(2400000, 31000), unknown: true } }),
  view({ id: "55555555-5555-4555-8555-555555555555", path: "/root/gated-review", observed: "settled", pendingIntent: "settled", managedGateFor: "task-run-0001", model: "zai/glm-5.3", usage: usage(900, 40) }),
  view({ id: "66666666-6666-4666-8666-666666666666", path: "/root/closed", observed: "settled", desiredLifecycle: "closed", pendingIntent: "closed", taskOutcome: "failed" }),
];
const crowdDetails: AgentDetails = { result: Array.from({ length: 9 }, (_, i) => `result line ${i}: ${"word ".repeat(30).trim()}`).join("\n"), question };

function crowdAt(selected: number, width: number): { lines: string[]; ui: AgentInspector } {
  const { ui } = inspector(crowd, { details: crowdDetails, rows: 60 });
  ui.handleInput("f");
  for (let i = 0; i < selected; i++) ui.handleInput(DOWN);
  return { lines: text(ui.render(width)), ui };
}

test("target screen at 120 columns: one settled agent", () => {
  const { ui } = inspector([demo], { details: { result: "pong", question: null }, rows: 12 });
  const lines = ui.render(120);
  assert.ok(lines.every((l) => visibleWidth(l) <= 120));
  assert.equal(visibleWidth(lines[0]!), 120);
  assert.match(lines[0]!, /^── Subagents · 1 ─+ 1 settled ──$/);
  assert.deepEqual(text(lines).slice(1), [
    "  AGENT              KIND               STATE        MODEL                          TOKENS",
    "▌ /root/demo-reader  reader · worktree  ✓ succeeded  openai-codex/gpt-6.1-sol:high  8.8k in · 5 out",
    "─".repeat(120),
    "  id       7c1d4e9a-2b6f-4a35-8e0c-1f9b3d5a7e24 · generation 1",
    "  workdir  ~/work/flakes/ponygirls",
    "  result   pong",
    "",
    "",
    "",
    "─".repeat(120),
    "↑↓ select  ⏎ transcript  t new task  m note  c close agent  f show closed  esc close",
  ]);
});

test("no rendered line exceeds the terminal and no detail value is cut with an ellipsis", () => {
  for (const width of WIDTHS) {
    for (let selected = 0; selected < crowd.length; selected++) {
      const { lines } = crowdAt(selected, width);
      for (const line of lines) assert.ok(visibleWidth(line) <= width, `${width} columns, agent ${selected}: ${visibleWidth(line)} > ${width}: ${line}`);
      const details = lines.slice(lines.findIndex((l) => /^─+$/.test(l)) + 1, lines.findLastIndex((l) => /^─+$/.test(l)));
      for (const line of details) assert.doesNotMatch(line, /…$/, `${width} columns, agent ${selected}: ${line}`);
    }
    const empty = inspector([], { rows: 12 }).ui.render(width);
    assert.ok(empty.every((l) => visibleWidth(l) <= width), `${width} columns, empty list`);
  }
});

test("the selected agent's facts survive every width: id, generation, tokens, cost, workdir, gate, question", () => {
  const flat = (lines: string[]): string => lines.map((l) => l.trim()).join(" ").replace(/\s+/g, " ");
  for (const width of WIDTHS) {
    const running = flat(crowdAt(0, width).lines);
    for (const needle of ["11111111-1111-4111-8111-111111111111 · generation 1", "writer · worktree", "anthropic/claude-opus-4-20250514", "115k in · 4.21k out", "cost $1.2345", "tool bash running"]) {
      assert.ok(running.includes(needle), `${width} columns: missing ${needle}:\n${crowdAt(0, width).lines.join("\n")}`);
    }
    assert.ok(running.replace(/ /g, "").includes("anthropic/claude-opus-4-20250514:off"), `${width} columns: the model and effort are visible together`);
    assert.ok(running.replace(/ /g, "").includes("~/work/flakes/ponygirls/.worktrees/wt-ponygirls-orchestrator"), `${width} columns: workdir relative to home`);
    const asking = flat(crowdAt(1, width).lines);
    assert.ok(asking.includes(`question ${question}`), `${width} columns: the whole question, wrapped:\n${crowdAt(1, width).lines.join("\n")}`);
    const gated = flat(crowdAt(3, width).lines);
    for (const needle of ["⚠ review_limit_reached", "gate task task-run-0001", "cost unknown", "2.4M in · 31k out"]) assert.ok(gated.includes(needle), `${width} columns: missing ${needle}`);
    assert.ok(gated.replace(/ /g, "").includes("/srv/checkouts/a-directory-name-without-any-space-that-is-longer-than-a-narrow-terminal-line/repo"), `${width} columns: a path outside home stays absolute and whole`);
    assert.ok(flat(crowdAt(4, width).lines).includes("gate reviews task task-run-0001"), `${width} columns: reviewer's gate`);
    assert.ok(flat(crowdAt(5, width).lines).includes("state closed"), `${width} columns: a closed agent says so`);
  }
});

test("narrowing drops TOKENS, then MODEL, then KIND, names them, and never drops AGENT or STATE", () => {
  const headersAt = (width: number): string[] => crowdAt(0, width).lines[1]!.trim().split(/ {2,}/);
  const seen: string[] = [];
  for (let width = 170; width >= 40; width--) {
    const headers = headersAt(width).join(" ");
    if (seen.at(-1) !== headers) seen.push(headers);
  }
  assert.deepEqual(seen, ["AGENT KIND STATE MODEL TOKENS", "AGENT KIND STATE MODEL", "AGENT KIND STATE", "AGENT STATE"]);
  assert.deepEqual(headersAt(170), ["AGENT", "KIND", "STATE", "MODEL", "TOKENS"]);
  assert.ok(!crowdAt(0, 170).lines.some((l) => l.includes("hidden at this width")));
  const narrow = crowdAt(0, 60);
  assert.deepEqual(headersAt(60), ["AGENT", "STATE"]);
  assert.ok(narrow.lines.includes("  hidden at this width: KIND, MODEL, TOKENS"), narrow.lines.join("\n"));
  const dim = inspector(crowd, { rows: 60, theme: TAG_THEME }).ui.render(60).map(tags).find((l) => l.includes("hidden at this width"));
  assert.equal(dim, "<dim>  hidden at this width: KIND, MODEL, TOKENS</>");
  for (const width of WIDTHS) {
    const rows = crowdAt(0, width).lines.slice(2, 2 + crowd.length);
    for (const [i, state] of ["● tool bash running", "? awaiting parent reply", "○ queued", "⚠ review_limit_reached", "— settled", "✖ failed"].entries()) {
      assert.ok(rows[i]!.includes(state), `${width} columns: row ${i} shows its state whole: ${rows[i]}`);
    }
  }
});

test("a long path trades spare width for metadata before dropping columns on resize", () => {
  const parent = view({
    id: "resize-parent", path: "/root/terminal-layout-review", profile: "writer", isolation: "worktree",
    model: "anthropic/claude-opus-4-20250514", thinkingLevel: "high", usage: usage(12340, 820),
  });
  const child = view({
    ...parent, id: "resize-child", parentId: parent.id, depth: 2,
    path: `${parent.path}/背景作業/terminal-layout-checks`,
    observed: "awaiting_parent", pendingIntent: "awaiting parent reply",
  });
  const { ui, actions } = inspector([parent, child]);
  ui.handleInput(DOWN);
  for (const width of [132, 76, 180, 132]) {
    const rendered = ui.render(width);
    assert.ok(rendered.every((line) => visibleWidth(line) <= width), `every line fits at ${width}`);
    const lines = text(rendered);
    assert.match(lines[3]!, /^▌ /, `the child stays selected at ${width}`);
    assert.ok(lines[3]!.includes("? awaiting parent reply"), lines[3]);
    if (width === 76) {
      assert.deepEqual(lines[1]!.trim().split(/ {2,}/), ["AGENT", "KIND", "STATE"]);
      assert.ok(lines.includes("  hidden at this width: MODEL, TOKENS"));
    } else {
      assert.deepEqual(lines[1]!.trim().split(/ {2,}/), ["AGENT", "KIND", "STATE", "MODEL", "TOKENS"]);
      assert.ok(lines[3]!.endsWith("anthropic/claude-opus-4-20250514:high  12.3k in · 820 out"), lines[3]);
      assert.ok(!lines.some((line) => line.includes("hidden at this width")));
    }
    if (width === 180) {
      assert.ok(lines[3]!.startsWith(`▌   ${child.path}  `), lines[3]);
    } else {
      assert.match(lines[3]!, /^▌ +\/root\/\S*…\S*checks {2}/);
      const detail = lines.slice(4).join("").replace(/ /g, "");
      assert.ok(detail.includes(`path${child.path}`), `the detail keeps the whole path at ${width}`);
    }
  }
  ui.handleInput(ENTER);
  assert.deepEqual(actions, [{ kind: "transcript", agentId: child.id }]);
});

test("an over-long agent path is shortened in the middle and spelled out in the details", () => {
  const long = crowd[1]!.path;
  for (const width of WIDTHS) {
    const { lines } = crowdAt(1, width);
    const row = lines[3]!;
    assert.match(row, /^▌ +\/root\/orch\S*…\S*regressions {2}/, `${width} columns: head and leaf stay: ${row}`);
    assert.ok(!row.includes(long));
    assert.ok(lines.map((l) => l.trim()).join("").replace(/ /g, "").includes(`path${long}`), `${width} columns: the details carry the whole path`);
  }
  const short = crowdAt(0, 120).lines;
  assert.ok(short[2]!.startsWith("▌ /root/orchestrator  "));
  assert.ok(!short.some((l) => /^ {2}path /.test(l)), "a path the row shows whole is not repeated");
});

test("one STATE column: a settled agent shows its outcome, a live agent its state with a glyph in the state's colour", () => {
  const { ui } = inspector(crowd, { rows: 60, theme: TAG_THEME });
  ui.handleInput("f");
  const lines = ui.render(170).map(tags);
  assert.doesNotMatch(lines[1]!, /OUTCOME/);
  assert.match(lines[2]!, /<accent>● tool bash running<\/>/);
  assert.match(lines[3]!, /<warning>\? awaiting parent reply<\/>/);
  assert.match(lines[4]!, /<muted>○ queued<\/>/);
  assert.match(lines[5]!, /<warning>⚠ review_limit_reached<\/>/);
  assert.match(lines[6]!, /<muted>— settled<\/>/);
  assert.match(lines[7]!, /<error>✖ failed<\/>/);
  assert.deepEqual(crowd.map(phaseOf), ["running", "asking", "queued", "settled", "settled", "settled"]);
  // What the row abbreviates or replaces is spelled out below it.
  ui.handleInput(DOWN);
  ui.handleInput(DOWN);
  assert.ok(ui.render(170).map(tags).some((l) => /^ {2}<muted>state *<\/> {2}<muted>queued: waiting for runnable capacity; wait for running work to settle<\/>$/.test(l)));
});

test("the title counts agents by state in a fixed order and omits zeros", () => {
  const settled = (id: string): AgentView => view({ id, observed: "settled", pendingIntent: "settled", taskOutcome: "succeeded" });
  const asking = view({ id: "q", observed: "awaiting_parent", pendingIntent: "awaiting parent reply", openQuestion: { messageId: "m", to: "governor", text: "?", deadlineAt: "" } });
  const queued = view({ id: "w", observed: "queued", pendingIntent: "queued" });
  const title = (views: AgentView[]): string => inspector(views).ui.render(120)[0]!;
  assert.match(title([settled("s1"), view(), asking, settled("s2"), view({ id: "r2", observed: "starting", pendingIntent: "starting" }), settled("s3")]), /^── Subagents · 6 ─+ 2 running · 1 asking · 3 settled ──$/);
  assert.match(title([queued, settled("s1"), asking, view()]), /^── Subagents · 4 ─+ 1 running · 1 queued · 1 asking · 1 settled ──$/);
  assert.match(title([]), /^── Subagents · 0 ─+$/);
  assert.equal(phaseOf(view({ observed: "awaiting_parent", pendingIntent: "awaiting parent reply" })), "asking", "waiting for a reply, whoever was asked");
  assert.equal(phaseOf(view({ observed: "lost", pendingIntent: "lost" })), "settled");
  // Too narrow for every count: the name and the total stay whole, the last counts go.
  const narrow = inspector([queued, settled("s1"), asking, view()]).ui.render(60)[0]!;
  assert.match(narrow, /^── Subagents · 4 ─+ 1 running · 1 queued · 1 asking ──$/);
  assert.equal(visibleWidth(narrow), 60);
});

test("hints name only what applies to the selected agent in its state", () => {
  const hintsFor = (v: AgentView): string => hintLine(inspector([v]).ui.render(170));
  assert.equal(hintsFor(demo), "↑↓ select  ⏎ transcript  t new task  m note  c close agent  f show closed  esc close");
  assert.equal(hintsFor(view()), "↑↓ select  ⏎ transcript  i interrupt  t new task  m note  c close agent  f show closed  esc close");
  assert.equal(hintsFor(crowd[1]!), "↑↓ select  ⏎ transcript  a answer  i interrupt  t new task  m note  c close agent  f show closed  esc close");
  assert.equal(hintsFor(crowd[2]!), "↑↓ select  ⏎ transcript  i interrupt  t new task  m note  c close agent  f show closed  esc close");
  assert.equal(hintsFor(crowd[3]!), "↑↓ select  ⏎ transcript  t new task  m note  g gate  c close agent  f show closed  esc close");
  assert.equal(hintsFor(crowd[4]!), "↑↓ select  ⏎ transcript  g gate  c close agent  f show closed  esc close", "a gate reviewer takes no notes or tasks");
  const closed = inspector([crowd[5]!]);
  assert.equal(hintLine(closed.ui.render(170)), "f show closed  esc close", "only closed agents: nothing is listed until they are shown");
  closed.ui.handleInput("f");
  assert.equal(hintLine(closed.ui.render(170)), "↑↓ select  ⏎ transcript  f hide closed  esc close");
  for (const width of WIDTHS) {
    for (const v of crowd) assert.doesNotMatch(hintsFor(v) + inspector([v]).ui.render(width).join("\n"), /refresh|show all/);
  }
});

test("keys that are no longer advertised stay bound", () => {
  const views = [demo];
  const { ui, actions } = inspector(views);
  for (const key of ["i", "a", "g", "c", "m", "t"]) ui.handleInput(key);
  assert.deepEqual(actions.map((a) => a.kind), ["interrupt", "answer", "retry_review", "close", "message", "task"]);
  views.push(view({ id: "late" }));
  ui.handleInput("r");
  ui.handleInput(DOWN);
  assert.equal(ui.selectedId(), "late", "r still refreshes the list");
});

test("an empty list says how agents appear and offers only esc", () => {
  for (const width of WIDTHS) {
    const lines = text(inspector([], { rows: 12 }).ui.render(width));
    assert.match(lines[0]!, /^── Subagents · 0 ─+$/);
    assert.equal(lines.slice(1).filter((l) => l !== "" && !/^─+$/.test(l)).map((l) => l.trim()).join(" "), "No subagents yet. The model starts them with spawn_agent. esc close", `${width} columns`);
    assert.equal(hintLine(lines), "esc close");
  }
  const tagged = inspector([], { rows: 12, theme: TAG_THEME }).ui.render(120).map(tags);
  assert.equal(tagged[1], "<muted>  No subagents yet. The model starts them with spawn_agent.</>");
  // Agents exist, all closed and hidden: the way to them is the one key offered besides esc.
  const hidden = text(inspector([crowd[5]!], { rows: 12 }).ui.render(120));
  assert.equal(hidden[1], "  No active subagents. f shows the closed ones.");
  assert.equal(hintLine(hidden), "f show closed  esc close");
});

test("paths under the home directory are shown relative to it", () => {
  assert.equal(homeRelative("/home/u/work/x", "/home/u"), "~/work/x");
  assert.equal(homeRelative("/home/u", "/home/u"), "~");
  assert.equal(homeRelative("/home/user2/x", "/home/u"), "/home/user2/x");
  assert.equal(homeRelative("/srv/x", "/home/u"), "/srv/x");
  assert.equal(homeRelative("/srv/x", "/"), "/srv/x");
});

const TAG_STYLE: UiStyle = { ...PLAIN_STYLE, muted: (s) => mark("muted", s), accent: (s) => mark("accent", s) };

test("a transcript that has not arrived says so instead of showing an empty body", () => {
  const named = (): TranscriptSource => ({ sessionFile: "/not-written-yet.jsonl", reviews: [], streaming: null, messages: new Map() });
  let written = false;
  const reader = { version: () => (written ? "1" : null), read: () => session(["first answer"]) };
  for (const width of WIDTHS) {
    written = false;
    const { ui } = transcriptView({ source: named, reader, style: TAG_STYLE });
    const lines = ui.render(width);
    assert.equal(lines.length, 24);
    assert.ok(lines.every((l) => visibleWidth(l) <= width));
    const body = lines.slice(3, lines.findLastIndex((l) => /^─+$/.test(l))).filter((l) => l !== "").map(tags);
    assert.deepEqual(body, ["<muted>loading transcript…</>"], `${width} columns`);
    written = true;
    assert.equal(ui.refresh(), true);
    const loaded = ui.render(width).map(tags);
    assert.ok(loaded.some((l) => l.includes("first answer")) && !loaded.some((l) => l.includes("loading transcript")));
  }
  // A settled agent's missing session is not on its way.
  const settled = transcriptView({ view: () => view({ observed: "settled", pendingIntent: "settled" }), source: named, reader: { version: () => null, read: () => "" } });
  assert.ok(settled.ui.render(80).some((l) => l.includes("(empty conversation)")) && !settled.ui.render(80).some((l) => l.includes("loading transcript")));
});

test("the transcript footer: send, scroll, page, back", () => {
  const footer = (over: Partial<TranscriptDeps>): string => transcriptView(over).ui.render(170).at(-1)!;
  assert.equal(footer({ view: () => view({ observed: "settled", pendingIntent: "settled" }) }), "⏎ send task  ↑↓ scroll  PgUp/PgDn page  esc back");
  assert.equal(footer({}), "⏎ steer the running task  ↑↓ scroll  PgUp/PgDn page  esc back");
  assert.equal(footer({ question: () => ({ messageId: "q", text: "?" }) }), "⏎ answer its question  ↑↓ scroll  PgUp/PgDn page  esc back");
  for (const width of WIDTHS) assert.ok(transcriptView().ui.render(width).every((l) => visibleWidth(l) <= width));
});

function screenOf(views: AgentView[], rows: number, sessionText: string): AgentsScreen {
  const deps: AgentsScreenDeps = {
    list: () => views,
    describe: () => ({ result: "pong", question: null }),
    transcript: (id, back) => ({
      view: () => views.find((v) => v.id === id) ?? null,
      source: () => ({ sessionFile: "/s.jsonl", reviews: [], streaming: null, messages: new Map() }),
      question: () => null,
      send: async () => "ok",
      back,
      requestRender: () => {},
      rows: () => rows,
      reader: { version: () => "1", read: () => sessionText },
      style: PLAIN_STYLE,
      theme: PLAIN_THEME,
    }),
    onAction: () => {},
    onClose: () => {},
    requestRender: () => {},
    rows: () => rows,
    theme: PLAIN_THEME,
  };
  return new AgentsScreen(deps);
}

// Regression: the first frame after ⏎ was laid out for the terminal's height, not the pane's, and showed an empty body.
test("a transcript opened from the list shows its conversation in the first frame", () => {
  const TERMINAL_ROWS = 30;
  /** The pane as pi hosts it, drawing `paneRows` rows of a taller terminal. */
  const hosts: Record<string, (screen: AgentsScreen, paneRows: number) => (width: number) => string[]> = {
    // Regular mode: the pane replaces the editor and gets the terminal less the footer and the widgets below.
    "bounded editor slot": (screen, paneRows) => {
      const host = new BoundedVStack({ getMaxHeight: () => paneRows, requestRender: () => {} });
      host.addChild(screen);
      return (width) => host.render(width);
    },
    // Fullscreen mode: an auto-sized slot between the chat and the status rows.
    "auto-sized slot": (screen, paneRows) => {
      const root = new VStack([
        { component: { render: () => ["chat"], invalidate() {} }, basis: 0, grow: 1 },
        { component: screen, grow: 0 },
        { component: { render: () => Array.from({ length: TERMINAL_ROWS - paneRows }, () => "status"), invalidate() {} }, shrink: 0 },
      ]);
      return (width) => renderLayoutFrame(root, width, TERMINAL_ROWS, () => {}).lines.slice(0, paneRows);
    },
  };
  for (const [name, mount] of Object.entries(hosts)) {
    for (const paneRows of [26, 18, 29]) {
      for (const width of WIDTHS) {
        const screen = screenOf([demo], TERMINAL_ROWS, session(["pong"]));
        const draw = mount(screen, paneRows);
        draw(width);
        screen.handleInput(ENTER);
        const first = text(draw(width));
        assert.equal(first.length, paneRows);
        const rule = first.findLastIndex((l) => /^─+$/.test(l));
        assert.equal(first[rule - 1], "pong", `${name}, ${width}×${paneRows}: the newest line sits on the rule above the chat line:\n${first.join("\n")}`);
        assert.deepEqual(text(draw(width)), first, `${name}, ${width}×${paneRows}: the follow-up frame changes nothing`);
      }
    }
  }
});
