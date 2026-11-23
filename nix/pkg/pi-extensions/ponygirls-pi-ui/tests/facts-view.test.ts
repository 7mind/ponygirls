/** Behavioral-Active × Blackbox × Group; specified read-only facts pane contract. */
import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import * as ui from "../src/index.ts";

const WIDTHS = [40, 60, 80, 120, 170] as const;
const HASH = "4be1c0a97d3f52e86a1b09c4d7f3e2a5b8c6d1e0f9a7b4c3d2e1f0a9b8c7d6e5";
const END = "\u001b[F";
const HOME = "\u001b[H";

const GROUPS: readonly ui.FactGroup[] = [
  [
    { label: "State", value: [{ text: "off (global setting)", state: "settled" }, { text: "not capturing this session" }] },
    { label: "Model", value: [{ text: "openai-codex/gpt-6.1-sol" }, { text: "medium" }, { text: "disclosure approved" }] },
    { label: "Journal", value: [{ text: "~/.pi/agent/historian/projects/4be1c0a9…/journal.md" }] },
  ],
  [
    { label: "Activity", value: [{ text: "journaling", state: "running" }, { text: "2 pending" }] },
    { label: "Chronicle", value: [{ text: "upload on → chronicle.example" }, { text: "idle" }, { text: "nothing pending" }] },
  ],
];
/** An unbreakable value wider than any tested terminal's value column but the widest. */
const UNBROKEN: readonly ui.FactGroup[] = [...GROUPS, [{ label: "Path", value: [{ text: `/home/u/.pi/agent/historian/projects/${HASH}/journal.md` }, { text: "end-of-path" }] }]];
const DETAILS = Array.from({ length: 40 }, (_, n) => `detail line ${n} 日本語 with enough words to wrap on a narrow terminal`).join("\n");

interface Fixture {
  view: ui.FactsView;
  closed(): number;
  renders(): number;
}

function fixture(overrides: Partial<ui.FactsViewOptions>): Fixture {
  let closed = 0;
  let renders = 0;
  const view = new ui.FactsView({
    title: "Historian", state: { text: "off · global", state: "settled" }, facts: () => GROUPS, details: () => DETAILS,
    theme: ui.PLAIN_THEME, keys: { matches: (data, action) => data === "cancel" && action === "tui.select.cancel" },
    rows: () => 24, requestRender: () => { renders++; }, close: () => { closed++; }, ...overrides,
  });
  return { view, closed: () => closed, renders: () => renders };
}

test("facts view puts the name and state in the title and aligns values under one column", () => {
  const { view } = fixture({});
  assert.deepEqual(view.render(80), [
    `── Historian ${"─".repeat(51)} off · global ──`,
    "  State      off (global setting) · not capturing this session",
    "  Model      openai-codex/gpt-6.1-sol · medium · disclosure approved",
    "  Journal    ~/.pi/agent/historian/projects/4be1c0a9…/journal.md",
    "",
    "  Activity   journaling · 2 pending",
    "  Chronicle  upload on → chronicle.example · idle · nothing pending",
    "─".repeat(80),
    "↑↓ scroll  d details  esc close",
  ]);
});

test("every facts and details line fits the width; values wrap under the value column", () => {
  for (const width of WIDTHS) {
    const { view } = fixture({ facts: () => UNBROKEN, rows: () => 400 });
    const facts = view.render(width);
    assert.ok(facts.every((line) => visibleWidth(line) <= width), `facts at ${width}`);
    assert.equal(visibleWidth(facts[0]!), width, `title fills ${width}`);
    const body = facts.slice(1, -2);
    // A row either starts a fact (label in the gutter column) or continues a value under the value column.
    for (const line of body) assert.match(line, /^(?:| {2}\S.*| {13}(?: {2})?\S.*)$/, `row ${JSON.stringify(line)} at ${width}`);
    assert.equal(body.map((line) => line.trim()).join("").split(HASH).length, 2, `the unbreakable value is wrapped, not cut, at ${width}`);
    assert.match(facts.join("\n"), /end-of-path/, `nothing is cut at ${width}`);
    view.handleInput("d");
    const details = view.render(width);
    assert.ok(details.every((line) => visibleWidth(line) <= width), `details at ${width}`);
    assert.match(details.join("\n"), /detail line 39/, `complete details at ${width}`);
  }
});

test("a segment that does not fit moves to its own line before it is broken", () => {
  const { view } = fixture({});
  const body = view.render(60).slice(1, -2);
  assert.deepEqual(body.slice(0, 4), [
    "  State      off (global setting)",
    "             · not capturing this session",
    "  Model      openai-codex/gpt-6.1-sol · medium",
    "             · disclosure approved",
  ]);
});

test("below a readable value width the value moves under its label instead of being clipped", () => {
  for (const width of [4, 12, 24]) {
    const { view } = fixture({ rows: () => 400 });
    const lines = view.render(width);
    assert.ok(lines.every((line) => visibleWidth(line) <= width), `width ${width}`);
  }
  const { view } = fixture({ rows: () => 400 });
  const body = view.render(24).slice(1, -3);
  assert.deepEqual(body.slice(0, 4), ["  State", "    off (global setting)", "    · not capturing this", "      session"]);
});

test("a wrapped segment hangs under its own text and a long path breaks after a separator", () => {
  const groups: readonly ui.FactGroup[] = [[
    { label: "Journal", value: [{ text: "~/.pi/agent/historian/projects/4be1c0a9…/journal.md" }] },
    { label: "Settings", value: [{ text: "~/.pi/agent/context-archive.json" }, { text: "project .pi/context-archive.json (ignored: untrusted)" }] },
    { label: "Id", value: [{ text: "short" }, { text: HASH }] },
  ]];
  const { view } = fixture({ facts: () => groups });
  assert.deepEqual(view.render(48).slice(1, -2), [
    "  Journal   ~/.pi/agent/historian/projects/",
    "            4be1c0a9…/journal.md",
    "  Settings  ~/.pi/agent/context-archive.json",
    "            · project .pi/context-archive.json",
    "              (ignored: untrusted)",
    "  Id        short",
    "            · 4be1c0a97d3f52e86a1b09c4d7f3e2a5b8",
    "              c6d1e0f9a7b4c3d2e1f0a9b8c7d6e5",
  ]);
});

test("colour carries state only: dim labels and separators, state colours on segments and the title", () => {
  const FG: readonly ui.UiFg[] = ["text", "muted", "dim", "accent", "border", "success", "warning", "error"];
  /** Zero-width, distinguishable SGR codes per token, so widths stay real. */
  const fg = (color: ui.UiFg, text: string): string => `\x1b[38;5;${FG.indexOf(color) + 1}m${text}\x1b[39m`;
  const theme: ui.UiTheme = { fg, bg: (_color, text) => text, bold: (text) => text };
  const { view } = fixture({ theme, state: { text: "attention", state: "attention" } });
  for (const width of WIDTHS) assert.ok(view.render(width).every((line) => visibleWidth(line) <= width), `styled lines at ${width}`);
  const lines = view.render(120);
  assert.ok(lines[0]!.includes(fg("warning", "attention")), "the title state takes its state colour");
  assert.equal(lines[1], `  ${fg("dim", "State")}      ${fg("muted", "off (global setting)")}${fg("dim", " · ")}${fg("text", "not capturing this session")}`);
  assert.ok(lines.some((line) => line.includes(fg("accent", "journaling"))), "a running segment takes the running colour");
});

test("d switches between facts and the complete details under the same title", () => {
  const { view } = fixture({});
  view.render(80);
  view.handleInput(END);
  view.handleInput("d");
  const details = view.render(80);
  assert.equal(details[0], `── Historian ${"─".repeat(51)} off · global ──`);
  assert.match(details[1]!, /^detail line 0 /, "details open at their first line");
  assert.doesNotMatch(details.join("\n"), /State {6}off/);
  assert.equal(details.at(-1), "↑↓ scroll  d facts  esc close");
  assert.equal(details.at(-2), "─".repeat(80));
  view.handleInput(END);
  assert.match(view.render(80).join("\n"), /detail line 39/);
  view.handleInput("d");
  const facts = view.render(80);
  assert.equal(facts[1], "  State      off (global setting) · not capturing this session");
  assert.equal(facts.at(-1), "↑↓ scroll  d details  esc close");
  view.handleInput("\u001b[100u");
  assert.equal(view.render(80).at(-1), "↑↓ scroll  d facts  esc close", "the key is recognised in the kitty keyboard encoding too");
});

test("a configured cancel on d closes without switching bodies or resetting the page", () => {
  const { view, closed } = fixture({ keys: { matches: (data, action) => data === "d" && action === "tui.select.cancel" }, rows: () => 5 });
  const top = view.render(80);
  view.handleInput(END);
  const bottom = view.render(80);
  assert.notDeepEqual(bottom, top);
  view.handleInput("d");
  assert.equal(closed(), 1);
  assert.deepEqual(view.render(80), bottom);
});

test("without details there is no d hint and the key does nothing", () => {
  const { view, closed } = fixture({ details: null });
  const before = view.render(80);
  assert.equal(before.at(-1), "↑↓ scroll  esc close");
  view.handleInput("d");
  assert.deepEqual(view.render(80), before);
  assert.equal(closed(), 0);
});

test("facts view bounds its viewport and scrolls by keys and wheel like the status view", () => {
  let rows = 12;
  const many: readonly ui.FactGroup[] = [Array.from({ length: 30 }, (_, n) => ({ label: `Fact ${n}`, value: [{ text: `value ${n}` }] }))];
  const { view, renders } = fixture({ facts: () => many, rows: () => rows });
  for (const width of WIDTHS) assert.ok(view.render(width).length <= rows, `rows at ${width}`);
  view.render(100);
  view.handleInput(END);
  assert.match(view.render(100).join("\n"), /value 29/);
  view.handleInput(HOME);
  assert.match(view.render(100).join("\n"), /value 0\b/);
  view.handleMouse({ type: "wheel", wheelDelta: 4 } as never);
  assert.doesNotMatch(view.render(100).join("\n"), /value 0\b/);
  view.handleInput("\u001b[A");
  assert.match(view.render(100).join("\n"), /value 3\b/);
  view.handleInput("\u001b[6~");
  assert.doesNotMatch(view.render(100).join("\n"), /value 3\b/);
  view.handleInput("\u001b[5~");
  assert.match(view.render(100).join("\n"), /value 3\b/);
  rows = 9;
  assert.ok(view.render(100).length <= rows);
  assert.ok(renders() > 0);
});

test("configured cancel and q close; other keys change nothing", () => {
  const { view, closed } = fixture({});
  const before = view.render(80);
  view.handleInput("x");
  assert.deepEqual(view.render(80), before);
  view.handleInput("cancel");
  view.handleInput("q");
  assert.equal(closed(), 2);
});

test("facts and details are read for the current width and again after invalidation", () => {
  const factWidths: number[] = [];
  const detailWidths: number[] = [];
  let revision = "first";
  const { view } = fixture({
    facts: (width) => { factWidths.push(width); return [[{ label: "Width", value: [{ text: `${revision} ${width}` }] }]]; },
    details: (width) => { detailWidths.push(width); return `${revision} details ${width}`; },
  });
  assert.match(view.render(80).join("\n"), /first 80/);
  assert.match(view.render(40).join("\n"), /first 40/);
  revision = "second";
  assert.match(view.render(40).join("\n"), /first 40/, "a snapshot is kept until the width changes or the view is invalidated");
  view.invalidate();
  assert.match(view.render(40).join("\n"), /second 40/);
  view.handleInput("d");
  assert.match(view.render(60).join("\n"), /second details 60/);
  revision = "third";
  view.invalidate();
  assert.match(view.render(60).join("\n"), /third details 60/);
  assert.deepEqual(factWidths, [80, 40, 40]);
  assert.deepEqual(detailWidths, [60, 60]);
});

test("allocated height keeps the title, rule and hints and scrolls facts and details to their last row", async () => {
  const { VStack, Text } = await import("@earendil-works/pi-tui");
  const { renderLayoutFrame } = await import("@earendil-works/pi-tui/dist/layout.js");
  const many: readonly ui.FactGroup[] = [Array.from({ length: 40 }, (_, n) => ({ label: `Fact ${n}`, value: [{ text: `value ${n}` }] }))];
  const { view } = fixture({ facts: () => many, rows: () => 30 });
  const root = new VStack([
    { component: new Text("transcript", 0, 0), shrink: 0 },
    { component: new Text("top badge", 0, 0), shrink: 0 },
    { component: view, shrink: 1 },
    { component: new Text("bottom badge\nPi status", 0, 0), shrink: 0 },
  ]);
  const frame = (width: number, height: number): string[] => renderLayoutFrame(root, width, height, () => {}).lines;
  const first = frame(48, 18);
  assert.ok(first.every((line) => visibleWidth(line) <= 48));
  assert.match(first.join("\n"), /── Historian ─+ off · global ──/);
  assert.match(first.join("\n"), /d details {2}esc close/, "actual allocation must keep the hints visible");
  assert.match(first.join("\n"), /value 0\b/);
  view.handleInput(END);
  const end = frame(48, 18);
  assert.match(end.join("\n"), /value 39/, "End reaches the real last row, not a pre-clipped body");
  assert.equal(end.at(-1)!.trimEnd(), "Pi status");
  assert.equal(end.at(-4)!.trimEnd(), "─".repeat(48), "the rule stays between the body and the hints");
  view.handleInput("d");
  const details = frame(48, 18).join("\n");
  assert.match(details, /detail line 0 /, "details open at their first line");
  assert.match(details, /d facts {2}esc close/);
  view.handleInput(END);
  assert.match(frame(48, 18).join("\n"), /detail line 39/);
  view.handleMouse({ type: "wheel", wheelDelta: -400, x: 0, y: 0, screenX: 0, screenY: 0, width: 48, height: 18 } as never);
  assert.match(frame(48, 18).join("\n"), /detail line 0 /);
  view.handleInput(END);
  assert.match(frame(48, 18).join("\n"), /detail line 39/);
  view.handleInput("d");
  assert.match(frame(48, 18).join("\n"), /value 0\b/, "facts reopen at their first row");
  view.handleInput(END);
  const grown = frame(80, 30).join("\n");
  assert.match(grown, /value 39/);
  assert.match(grown, /esc close/);
  frame(48, 12);
  view.handleInput(END);
  const shrunk = frame(48, 12).join("\n");
  assert.match(shrunk, /value 39/);
  assert.match(shrunk, /esc close/);
});
