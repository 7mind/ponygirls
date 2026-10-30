import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  PLAIN_THEME, columnCells, columnHeader, compactChip, countCell, fractionState, frameRule, frameTitle, gridRule, hintAt,
  keyHints, listRow, stateColor, usageBar, zebra, type UiBg, type UiFg, type UiTheme,
} from "../src/index.ts";

const FG: readonly UiFg[] = ["text", "muted", "dim", "accent", "border", "borderMuted", "success", "warning", "error"];
const BG: readonly UiBg[] = ["selectedBg", "toolPendingBg"];

/** Zero-width, distinguishable SGR codes per token, so widths stay real. */
const TAGGED: UiTheme = {
  fg: (color, text) => `\x1b[38;5;${FG.indexOf(color) + 1}m${text}\x1b[39m`,
  bg: (color, text) => `\x1b[48;5;${BG.indexOf(color) + 1}m${text}\x1b[49m`,
  bold: (text) => `\x1b[1m${text}\x1b[22m`,
};
const fgCode = (color: UiFg): string => `\x1b[38;5;${FG.indexOf(color) + 1}m`;
const bgCode = (color: UiBg): string => `\x1b[48;5;${BG.indexOf(color) + 1}m`;

test("frameTitle fills exactly the width with title, meta, tabs and right part", () => {
  for (const width of [30, 60, 117]) {
    const { line } = frameTitle(TAGGED, width, { title: "Usage", meta: "3 models", tabs: { labels: ["All Time", "Today"], active: 0 }, right: "lines 1–24 of 61 ↓" }, "none");
    assert.equal(visibleWidth(line), width, `width ${width}`);
  }
  const box = frameTitle(PLAIN_THEME, 40, { title: "Model" }, "box");
  assert.equal(box.line, `┌─ Model ${"─".repeat(30)}┐`);
});

test("frameTitle reports tab spans in visible columns and highlights the active tab", () => {
  const { line, tabSpans } = frameTitle(TAGGED, 80, { title: "Model", tabs: { labels: ["★ Favourites", "All"], active: 1 } }, "box");
  const plain = frameTitle(PLAIN_THEME, 80, { title: "Model", tabs: { labels: ["★ Favourites", "All"], active: 1 } }, "box").line;
  assert.equal(tabSpans.length, 2);
  assert.equal(plain.slice(tabSpans[0]!.start, tabSpans[0]!.end), " ★ Favourites ");
  assert.equal(plain.slice(tabSpans[1]!.start, tabSpans[1]!.end), " All ");
  assert.ok(line.includes(`${bgCode("selectedBg")}${fgCode("text")} All `));
});

test("frameTitle keeps the right part when the left part must truncate", () => {
  const { line } = frameTitle(PLAIN_THEME, 30, { title: "A very long panel title that cannot fit", right: "live" }, "none");
  assert.equal(visibleWidth(line), 30);
  assert.ok(line.endsWith(" live ──"), line);
  assert.ok(line.includes("…"));
});

test("frameRule is a full-width border rule", () => {
  assert.equal(frameRule(PLAIN_THEME, 12), "─".repeat(12));
  assert.ok(frameRule(TAGGED, 5).startsWith(fgCode("border")));
});

test("keyHints styles key as text and action as muted, wraps, and reports spans", () => {
  const hints = [{ key: "↑↓", action: "select" }, { key: "⏎", action: "open" }, { key: "q", action: "close" }];
  const one = keyHints(PLAIN_THEME, 80, hints);
  assert.deepEqual(one.lines, ["↑↓ select  ⏎ open  q close"]);
  assert.equal(hintAt(one.spans[0], 0), 0);
  assert.equal(hintAt(one.spans[0], 11), 1);
  assert.equal(hintAt(one.spans[0], 10), undefined);
  const wrapped = keyHints(PLAIN_THEME, 16, hints);
  assert.deepEqual(wrapped.lines, ["↑↓ select", "⏎ open  q close"]);
  assert.equal(hintAt(wrapped.spans[1], 9), 2);
  const styled = keyHints(TAGGED, 80, hints).lines[0]!;
  assert.ok(styled.includes(`${fgCode("text")}↑↓\x1b[39m ${fgCode("muted")}select`));
});

test("listRow: selected rows are a full-width band with an accent marker and bold body", () => {
  const selected = listRow(TAGGED, 20, "row", true);
  assert.equal(visibleWidth(selected), 20);
  assert.ok(selected.startsWith(`${bgCode("selectedBg")}${fgCode("accent")}▌`));
  assert.ok(selected.includes("\x1b[1mrow\x1b[22m"));
  assert.equal(listRow(PLAIN_THEME, 20, "row", false), "  row");
  assert.equal(visibleWidth(listRow(PLAIN_THEME, 6, "a long row", false)), 6);
});

test("columns align styled cells and the dim header to the marker gutter", () => {
  const columns = [{ header: "TASK", width: 6, align: "left" as const }, { header: "LOG", width: 6, align: "right" as const }];
  assert.equal(columnHeader(PLAIN_THEME, columns, 2), "  TASK       LOG");
  assert.equal(columnCells(columns, [TAGGED.fg("success", "ok"), "9 B"], 2).replace(/\x1b\[[0-9;]*m/g, ""), "ok         9 B");
});

test("grid primitives: rules, zero dots, zebra", () => {
  assert.equal(gridRule(PLAIN_THEME, [3, 2], "┼"), "────┼───");
  assert.equal(gridRule(PLAIN_THEME, [3, 2], "┴"), "────┴───");
  assert.equal(countCell(PLAIN_THEME, 0, 4, "error"), "   ·");
  assert.ok(countCell(TAGGED, 0, 4, "error").startsWith(fgCode("dim")));
  assert.ok(countCell(TAGGED, 4, 4, "error").startsWith(fgCode("error")));
  assert.equal(zebra(TAGGED, "x", 0, 5), "x");
  assert.equal(visibleWidth(zebra(TAGGED, "x", 1, 5)), 5);
  assert.ok(zebra(TAGGED, "x", 1, 5).startsWith(bgCode("toolPendingBg")));
});

test("state colours and fraction thresholds", () => {
  assert.equal(stateColor("ok"), "success");
  assert.equal(stateColor("running"), "accent");
  assert.equal(stateColor("attention"), "warning");
  assert.equal(stateColor("error"), "error");
  assert.equal(stateColor("settled"), "muted");
  assert.equal(fractionState(0.89), "ok");
  assert.equal(fractionState(0.9), "attention");
  assert.equal(fractionState(1), "error");
  assert.equal(fractionState(1.5), "error");
});

test("usageBar keeps its width, colours the filled part by state and dims the rest", () => {
  assert.equal(usageBar(PLAIN_THEME, 0.38, 5, "ok"), "██░░░");
  assert.equal(usageBar(PLAIN_THEME, 2, 5, "error"), "█████");
  assert.equal(usageBar(PLAIN_THEME, -1, 5, "ok"), "░░░░░");
  const bar = usageBar(TAGGED, 0.38, 5, "attention");
  assert.ok(bar.startsWith(`${fgCode("warning")}██`));
  assert.ok(bar.includes(`${fgCode("dim")}░░░`));
});

test("compactChip: neutral chip, state glyph, label in text", () => {
  assert.equal(compactChip(PLAIN_THEME, "⚙", "running", "1"), " ⚙1 ");
  assert.equal(compactChip(PLAIN_THEME, "◉", "attention", ""), " ◉ ");
  const chip = compactChip(TAGGED, "✖", "error", "cg");
  assert.ok(chip.startsWith(bgCode("toolPendingBg")));
  assert.ok(chip.includes(`${fgCode("error")}✖`));
  assert.ok(chip.includes(`${fgCode("text")}cg`));
});
