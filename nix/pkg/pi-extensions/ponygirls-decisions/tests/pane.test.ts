/** Behavioral-Active × Blackbox × Group (specified): pane + real Pi widgets.
 * These headless keyboard/render checks complement, not replace, real PTY tests.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { DecisionsPane } from "../src/pane.ts";
import type { Decision } from "../src/store.ts";

const ENTER = "\r", ESC = "\x1b", TAB = "\t", UP = "\x1b[A", DOWN = "\x1b[B";
const SAVE = "\x13", REBASE = "\x12", PGDOWN = "\x1b[6~", END = "\x1b[F", HOME = "\x1b[H";
// Each token gets its own 256-colour code so tests can tell which token styled what.
const TOKENS = ["text", "muted", "dim", "accent", "border", "borderMuted", "success", "warning", "error", "mdHeading", "mdLink",
  "mdLinkUrl", "mdCode", "mdCodeBlock", "mdCodeBlockBorder", "mdQuote", "mdQuoteBorder", "mdHr", "mdListBullet"];
const fgCode = (token: string) => `\x1b[38;5;${TOKENS.indexOf(token) + 1}m`;
const SELECTED_BG = "\x1b[48;5;236m";
const theme = {
  fg: (token: string, s: string) => { assert.ok(TOKENS.includes(token), token); return `${fgCode(token)}${s}\x1b[39m`; },
  bg: (token: string, s: string) => { assert.equal(token, "selectedBg"); return `${SELECTED_BG}${s}\x1b[49m`; },
  bold: (s: string) => `\x1b[1m${s}\x1b[22m`, italic: (s: string) => `\x1b[3m${s}\x1b[23m`,
  underline: (s: string) => `\x1b[4m${s}\x1b[24m`, strikethrough: (s: string) => `\x1b[9m${s}\x1b[29m`,
} as unknown as Theme;
const plain = (s: string) => s.replaceAll(CURSOR_MARKER, "").replaceAll("\x1b_pi:fc\x07", "").replaceAll("\x1b_pi:/fc\x07", "").replace(/\x1b\[[\d;:]*m/g, "");

function decision(number: number, overrides: Partial<Decision> = {}): Decision {
  return {
    id: `Q${number}`, number, project: "/projects/pony/.git", question: `Question ${number}?`, context: "**Useful** context.",
    options: ["First option", "Second option"], recommendation: "Prefer the second option.", status: "pending", answer: null,
    revision: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", sessionId: "session", toolCallId: `call-${number}`,
    ...overrides,
  };
}

function open(items = [decision(1)], initialId: string | null = null, projectName = "pony") {
  let records = structuredClone(items), height = 40, closed = false, renders = 0;
  let loadError: Error | null = null, saveError: Error | null = null;
  const writes: { base: Decision; status: Decision["status"]; answer: string | null }[] = [];
  const tui = { terminal: { get rows() { return height; } }, requestRender: () => { renders++; } } as unknown as TUI;
  const pane = new DecisionsPane(theme, {
    tui,
    load: () => { if (loadError) throw loadError; return structuredClone(records); },
    resolve: (base, status, answer) => {
      writes.push({ base, status, answer });
      if (saveError) throw saveError;
      const index = records.findIndex((d) => d.id === base.id);
      if (index < 0 || records[index]!.revision !== base.revision) throw new Error("Stale revision; reload before saving");
      records[index] = { ...records[index]!, status, answer, revision: base.revision + 1 };
    },
    requestRender: () => { renders++; }, close: () => { closed = true; },
  }, projectName, initialId, () => height);
  const press = (...keys: string[]) => { for (const key of keys) pane.handleInput(key); };
  const screen = (width = 100) => plain(pane.render(width).join("\n"));
  /** The highlighted tab label in the title rule. */
  const activeTab = (width = 100) => new RegExp(`${SELECTED_BG.replace("[", "\\[")}${fgCode("text").replace("[", "\\[")} (pending \\d+|all) `).exec(pane.render(width)[0])?.[1];
  return {
    pane, press, screen, activeTab, writes, records: () => records, setRecords: (value: Decision[]) => { records = structuredClone(value); },
    resize: (rows: number) => { height = rows; }, closed: () => closed, renders: () => renders,
    loadFails: (error: Error | null) => { loadError = error; }, saveFails: (error: Error | null) => { saveError = error; },
  };
}

test("pending inbox, wrapped Markdown detail, history toggle, and stable selection after refresh", () => {
  const h = open([decision(1), decision(2), decision(3, { status: "answered", answer: "HISTORY-ANSWER" })]);
  assert.equal(h.activeTab(), "pending 2");
  assert.doesNotMatch(h.screen(), /Question 3|HISTORY-ANSWER/);
  assert.match(h.screen(), /Useful context\./);
  assert.ok(h.pane.render(100).join("\n").includes("\x1b[1mUseful"), "Markdown styling is retained");
  assert.doesNotMatch(h.screen(), /(?:38;5;\d+|39|22)m/, "sanitization must not leak raw SGR fragments");  assert.match(h.screen(), /Recommendation[\s\S]*Prefer the second/);
  h.press(DOWN);
  h.setRecords([decision(9), decision(1), decision(2), decision(3, { status: "answered", answer: "HISTORY-ANSWER" })]);
  assert.match(h.screen(), /▌ Q2/);
  h.press("a", "answer-two", SAVE);
  assert.equal(h.writes[0]!.base.id, "Q2");
  assert.equal(h.writes[0]!.answer, "answer-two");
  h.press(TAB);
  assert.equal(h.activeTab(), "all");
  assert.match(h.screen(), /Q3\s+✓ answered/);
  h.press(TAB);
  assert.doesNotMatch(h.screen(), /Q3/);
  assert.ok(h.renders() > 0);
});

test("saving the last pending answer returns from detail to an inbox that closes with one Escape", () => {
  for (const mode of ["a", "1"]) {
    const h = open([decision(1)], "Q1");
    h.press(mode);
    if (mode === "a") h.press("My answer");
    h.press(SAVE);
    assert.equal(h.records()[0]!.status, "answered");
    assert.equal(h.activeTab(), "pending 0");
    assert.match(h.screen(), /No pending decisions/);
    assert.match(h.screen(), /esc close/);
    assert.doesNotMatch(h.screen(), /esc inbox/);
    assert.equal(h.closed(), false, "saving returns to the inbox without closing it");
    h.press(ESC);
    assert.equal(h.closed(), true, "one Escape closes the empty inbox");
  }
});

test("saving from detail returns to the remaining pending list and preserves history navigation", () => {
  const h = open([decision(1), decision(2), decision(3)], "Q1");
  h.press("1", SAVE);
  assert.match(h.screen(), /▌ Q2\s+\? pending/);
  assert.match(h.screen(), /Q3\s+\? pending/);
  h.press(DOWN);
  assert.match(h.screen(), /▌ Q3\s+\? pending/, "arrows select questions rather than scrolling obsolete detail");
  const history = open([decision(7, { status: "answered", answer: "Existing answer" })], "Q7");
  history.press("e", "!", SAVE);
  assert.equal(history.activeTab(), "all");
  assert.match(history.screen(), /▌ Q7\s+✓ answered/);
  history.press(ESC);
  assert.equal(history.closed(), true);
});

test("narrow inbox retains the full answer/dismiss/reopen keyboard hint", () => {
  const h = open();
  h.resize(14);
  assert.match(h.screen(48), /u\s+reopen/);
});

test("option numbers and arrows stage an answer; Enter does not save; Ctrl+S explicitly saves", () => {
  const h = open();
  h.press("1", "2", ENTER);
  assert.equal(h.writes.length, 0);
  assert.match(h.screen(), /Selected option[\s\S]*Second option/);
  h.press(SAVE);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0]!.answer, "Second option");
  const many = open([decision(1, { options: Array.from({ length: 15 }, (_, i) => `Choice ${i + 1}`) })]);
  many.press("o", ...Array(10).fill(DOWN), ENTER);
  assert.equal(many.writes.length, 0);
  assert.match(many.screen(), /Selected option[\s\S]*Choice 11/);
  many.press(SAVE);
  assert.equal(many.writes[0]!.answer, "Choice 11");
});

test("free-form answers are multiline; focus and IME cursor survive short-height cropping", () => {
  const h = open();
  h.pane.focused = true;
  h.press("a", "alpha", ENTER, "βeta");
  assert.match(h.screen(), /alpha[\s\S]*βeta/);
  assert.ok(h.pane.render(60).join("\n").includes(CURSOR_MARKER));
  h.pane.focused = false;
  assert.ok(!h.pane.render(60).join("\n").includes(CURSOR_MARKER));
  h.pane.focused = true;
  h.press(...Array.from({ length: 20 }, (_, i) => `\x1b[200~\nrow-${i}\x1b[201~`));
  h.resize(6);
  const rendered = h.pane.render(30);
  assert.ok(rendered.length <= 6);
  assert.ok(rendered.join("\n").includes(CURSOR_MARKER), "short viewport keeps focused editor cursor visible");
  assert.equal(h.writes.length, 0);
  h.press(SAVE);
  assert.match(h.writes[0]!.answer!, /^alpha\nβeta\nrow-0[\s\S]*row-19$/);
});

test("CAS conflicts preserve text and original revision; explicit reload adopts latest without dropping draft", () => {
  const h = open();
  h.press("a", "my-draft");
  h.setRecords([decision(1, { revision: 2, status: "answered", answer: "other-window" }), decision(2)]);
  assert.match(h.screen(), /my-draft/);
  assert.match(h.screen(), /Changed elsewhere/);
  h.press(SAVE);
  assert.equal(h.writes[0]!.base.revision, 1);
  assert.match(h.screen(), /Save failed; draft retained/);
  assert.match(h.screen(), /my-draft/);
  h.press(REBASE);
  assert.match(h.screen(), /draft kept/);
  h.press(SAVE);
  assert.equal(h.writes[1]!.base.revision, 2);
  assert.equal(h.writes[1]!.answer, "my-draft");
  assert.equal(h.records()[0]!.answer, "my-draft");
});

test("save/load failures retain draft; cancellation never writes or closes the interaction", () => {
  const h = open();
  h.press("a", "keep-me");
  h.loadFails(new Error("disk unavailable"));
  h.press(SAVE);
  assert.equal(h.writes.length, 0);
  assert.match(h.screen(), /Cannot load decisions/);
  assert.match(h.screen(), /keep-me/);
  h.loadFails(null);
  h.saveFails(new Error("readonly disk \x1b]52;c;secret\x07"));
  h.press(SAVE);
  assert.match(h.screen(), /Save failed; draft retained/);
  assert.match(h.screen(), /keep-me/);
  assert.doesNotMatch(h.screen(), /secret/);
  h.press(ESC);
  assert.equal(h.closed(), false);
  assert.equal(h.writes.length, 1);
  h.press(ESC);
  assert.equal(h.closed(), true);
});

test("dismiss/reopen require explicit confirmation; existing answers can be edited in history", () => {
  const h = open();
  h.press("d", ENTER, "y");
  assert.equal(h.writes.length, 0);
  assert.match(h.screen(), /Dismiss this decision/);
  h.press(ESC, "d", SAVE, TAB);
  assert.equal(h.writes[0]!.status, "dismissed");
  assert.match(h.screen(), /dismissed/);
  h.press("u", ENTER);
  assert.equal(h.writes.length, 1);
  h.press(SAVE);
  assert.equal(h.writes[1]!.status, "pending");
  assert.equal(h.writes[1]!.answer, null);
  const answered = open([decision(7, { status: "answered", answer: "Existing answer" })], "Q7");
  assert.equal(answered.activeTab(), "all");
  answered.press("e", "!", SAVE);
  assert.equal(answered.writes[0]!.answer, "Existing answer!");
  assert.equal(answered.writes[0]!.status, "answered");
});

test("Escape discards a draft, backs out of detail, then closes; empty answer never writes", () => {
  const h = open([decision(1)], "Q1");
  h.press("a", SAVE);
  assert.match(h.screen(), /cannot be empty/);
  h.press(ESC);
  assert.equal(h.closed(), false);
  h.press(ESC);
  assert.equal(h.closed(), false);
  h.press(ESC);
  assert.equal(h.closed(), true);
  assert.equal(h.writes.length, 0);
  const empty = open([]);
  assert.match(empty.screen(), /No pending/);
  empty.press("o", "a", "d", "u", SAVE);
  assert.equal(empty.writes.length, 0);
});

test("detail scrolling is bounded across refresh and resize, including very narrow/short terminals", () => {
  const h = open([decision(1, { context: Array.from({ length: 100 }, (_, i) => `context-line-${i}`).join("\n\n"), options: [], recommendation: "TAIL-MARKER" })], "Q1");
  h.resize(12);
  assert.match(h.screen(40), /Question 1/);
  h.press(...Array(50).fill(PGDOWN));
  assert.match(h.screen(40), /TAIL-MARKER/);
  h.press(HOME);
  assert.match(h.screen(40), /Question 1/);
  h.press(END);
  h.resize(28);
  assert.match(h.screen(80), /TAIL-MARKER/);
  for (const rows of [1, 2, 4, 8, 20, 40]) {
    h.resize(rows);
    for (const width of [1, 2, 8, 20, 40, 80]) {
      const lines = h.pane.render(width);
      assert.ok(lines.length <= rows, `${lines.length} lines > ${rows}`);
      assert.ok(lines.every((line) => visibleWidth(line) <= width), `line overflow at ${width}×${rows}`);
    }
  }
});

test("Unicode and ANSI-safe rendering covers all stored fields, Markdown and editor paste", () => {
  const bad = "\x1b]0;bad-title\x07\x1b]52;c;secret\x07\x1bPbad-dcs\x1b\\\x1b[2J\x1b[10;10H\x9b?1049h\x1b[31mSAFE\x1b[0m\u202e";
  const unicode = "日本語 👩🏽‍💻 café é";
  const h = open([decision(1, { question: `${unicode} ${bad}`, project: bad, context: `${bad}\n\n| a | b |\n|---|---|\n| ${unicode} | long-content |`,
    options: [bad], recommendation: bad, status: "answered", answer: `${bad} saved` })], "Q1", `${bad}name`);
  h.resize(60);
  const screen = h.screen(100);
  assert.match(screen, /日本語 👩🏽‍💻 café é/);
  assert.match(screen, /SAFE/);
  assert.match(screen.split("\n")[0]!, /SAFEname/, "project name is sanitized");
  assert.doesNotMatch(screen, /bad-title|secret|bad-dcs|\u202e/);
  assert.doesNotMatch(screen, /[\x00-\x09\x0b-\x1f\x7f-\x9f]/, "only theme SGR may survive rendering");
  h.press("e");
  h.press("\x1b[200~", `\n${bad} pasted`, SAVE);
  assert.equal(h.writes.length, 0, "split paste contents must not trigger pane shortcuts");
  h.press("\x1b[201~");
  assert.doesNotMatch(h.screen(), /[\x00-\x09\x0b-\x1f\x7f-\x9f]|secret/);
  h.press(SAVE);
  assert.doesNotMatch(h.writes[0]!.answer!, /\x1b|\x9b|secret|\u202e/);
  assert.match(h.writes[0]!.answer!, /SAFE pasted/);
});

test("framed inbox: tabs and repository name in the title rule, status glyphs, full-width selection, rules, labelled sections", () => {
  const h = open([decision(1), decision(2), decision(10, { status: "answered", answer: "Done" }), decision(11, { status: "dismissed" })]);
  const width = 90;
  const raw = h.pane.render(width);
  const lines = raw.map(plain);
  assert.match(lines[0]!, /^── Decisions\s+pending 2\s+all\s+─+ pony ──$/);
  assert.equal(visibleWidth(raw[0]!), width);
  assert.ok(raw[0]!.includes(fgCode("dim") + "pony"), "project name is dim on the right");
  assert.doesNotMatch(lines.join("\n"), /\.git|\/projects\//, "the raw project path is never printed");
  assert.match(lines[1]!, /^▌ Q1\s+\? pending\s+Question 1\?\s*$/);
  assert.equal(visibleWidth(raw[1]!), width, "selection spans the full width");
  assert.ok(raw[1]!.startsWith(SELECTED_BG));
  assert.ok(raw[1]!.includes(fgCode("muted") + "Q1"), "ids are muted, not dim, inside the selection band");
  assert.ok(raw[1]!.includes(fgCode("warning") + "? pending"));
  assert.match(lines[2]!, /^ {2}Q2\s+\? pending\s+Question 2\?$/);
  assert.ok(raw[2]!.includes(fgCode("dim") + "Q2"), "unselected ids are dim");
  assert.match(lines[3]!, /^─+$/, "a rule separates the list from the detail");
  assert.equal(lines[4], "Question");
  assert.ok(raw[4]!.includes(`\x1b[1m${fgCode("accent")}Question`), "section labels are bold accent");
  assert.doesNotMatch(lines.join("\n"), /###/);
  assert.match(lines.join("\n"), /\nContext\n {2}Useful context\.\s*\nOptions\n {2}1\. First option\s*\n {2}2\. Second option\s*\nRecommendation\n {2}Prefer the second option\./);
  const rule = lines.findLastIndex((line) => /^─+$/.test(line));
  assert.deepEqual(lines.slice(rule + 1), [
    "↑↓ select  ⏎ detail  ⇥ pending/all  ⇞⇟ scroll detail  esc close",
    "a/e answer  1–9/o options  d dismiss  u reopen",
  ]);
  assert.ok(raw[rule + 1]!.includes(fgCode("muted") + "select"), "hint actions are muted");
  h.press(TAB);
  const history = h.pane.render(width);
  assert.ok(history.some((line) => line.includes(fgCode("success") + "✓ answered")));
  assert.ok(history.some((line) => line.includes(fgCode("muted") + "– dismissed")));
  h.press("x");
  h.press("d");
  const confirm = h.pane.render(width).map(plain);
  assert.match(confirm.join("\n"), /\nQ1\s+\? pending\nDismiss this decision\?\n {2}Question 1\?/);
  assert.equal(confirm.at(-1), "ctrl+s confirm dismiss  esc cancel");
  h.press(ESC);
  h.press("r");
  const notice = h.pane.render(width);
  assert.ok(notice.some((line) => line.startsWith(fgCode("warning") + "Refreshed.")), "notices keep the warning colour");
});
