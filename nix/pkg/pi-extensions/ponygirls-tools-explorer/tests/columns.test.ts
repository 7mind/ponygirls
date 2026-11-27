import assert from "node:assert/strict";
import test from "node:test";
import { MARKER_WIDTH } from "@ponygirls/pi-ui";
import { buildCatalog, findEntry } from "../src/catalog.ts";
import { COLUMN_GAP, clip, listCells, listLayout, type ListCells, type ListLayout } from "../src/columns.ts";
import { extensionFile, mcpTool, snapshot, tool } from "./fixtures.ts";

/** Cells as wide as real ones: a 26-column name, a 10-column state, a 6-column estimate, a 12-column source. */
const ROWS: readonly ListCells[] = [
  { tool: "mcp__linear__list_projects", state: "○ deferred", tokens: "~1.01k", source: "mcp · linear" },
  { tool: "read", state: "● active", tokens: "~181", source: "built-in" },
];
const TOOL = 26;
const STATE = 10;
const TOKENS = 6;
const SOURCE = 12;

function widths(layout: ListLayout): Record<string, number> {
  return Object.fromEntries(layout.columns.map((column) => [column.header, column.width]));
}

/** Columns the layout takes, with the row gutter and the gaps between columns. */
function total(layout: ListLayout): number {
  return MARKER_WIDTH + layout.columns.reduce((sum, column) => sum + column.width, 0) + COLUMN_GAP * (layout.columns.length - 1);
}

test("a wide pane shows every column, and the description takes what is left", () => {
  const layout = listLayout(120, ROWS, true);
  assert.deepEqual(layout.shown, ["tool", "state", "tokens", "source", "description"]);
  assert.deepEqual(widths(layout), { TOOL, STATE, TOKENS, SOURCE, DESCRIPTION: 120 - MARKER_WIDTH - TOOL - STATE - TOKENS - SOURCE - 4 * COLUMN_GAP });
  assert.deepEqual(layout.hidden, []);
  assert.equal(total(layout), 120);
});

test("a list grouped by source has no source column, and does not report it as hidden", () => {
  const layout = listLayout(120, ROWS, false);
  assert.deepEqual(layout.shown, ["tool", "state", "tokens", "description"]);
  assert.deepEqual(layout.hidden, []);
  assert.equal(total(layout), 120);
});

test("measured columns are as wide as their widest cell or their header", () => {
  const short: ListCells[] = [{ tool: "ls", state: "○ off", tokens: "~9", source: "x" }];
  assert.deepEqual(widths(listLayout(120, short, true)), { TOOL: 4, STATE: 5, TOKENS: 6, SOURCE: 6, DESCRIPTION: 120 - MARKER_WIDTH - 4 - 5 - 6 - 6 - 4 * COLUMN_GAP });
  assert.deepEqual(listLayout(120, [], false).shown, ["tool", "state", "tokens", "description"], "headers alone lay out too");
});

test("the description goes first, when less than 20 columns are left for it", () => {
  const fixed = MARKER_WIDTH + TOOL + STATE + TOKENS + SOURCE + 4 * COLUMN_GAP;
  const kept = listLayout(fixed + 20, ROWS, true);
  assert.equal(widths(kept).DESCRIPTION, 20);
  const dropped = listLayout(fixed + 19, ROWS, true);
  assert.deepEqual(dropped.shown, ["tool", "state", "tokens", "source"]);
  assert.deepEqual(dropped.hidden, ["Description"]);
});

test("then the source goes, then the estimate; the tool and its state stay whole", () => {
  const withSource = MARKER_WIDTH + TOOL + STATE + TOKENS + SOURCE + 3 * COLUMN_GAP;
  assert.deepEqual(listLayout(withSource, ROWS, true).shown, ["tool", "state", "tokens", "source"]);
  const noSource = listLayout(withSource - 1, ROWS, true);
  assert.deepEqual(noSource.shown, ["tool", "state", "tokens"]);
  assert.deepEqual(noSource.hidden, ["Source", "Description"]);
  const withTokens = MARKER_WIDTH + TOOL + STATE + TOKENS + 2 * COLUMN_GAP;
  assert.deepEqual(listLayout(withTokens, ROWS, true).shown, ["tool", "state", "tokens"]);
  const bare = listLayout(withTokens - 1, ROWS, true);
  assert.deepEqual(bare.shown, ["tool", "state"]);
  assert.deepEqual(bare.hidden, ["Tokens", "Source", "Description"]);
  assert.deepEqual(widths(bare), { TOOL, STATE });
});

test("only when the name and the state alone do not fit is the name cut, never the state", () => {
  const whole = MARKER_WIDTH + TOOL + STATE + COLUMN_GAP;
  assert.deepEqual(widths(listLayout(whole, ROWS, true)), { TOOL, STATE });
  const cut = listLayout(whole - 6, ROWS, true);
  assert.deepEqual(widths(cut), { TOOL: TOOL - 6, STATE });
  assert.equal(total(cut), whole - 6);
  assert.deepEqual(widths(listLayout(10, ROWS, true)), { TOOL: 8, STATE }, "the name keeps a few columns even then");
});

test("a layout never asks for more columns than the pane has, down to the name's floor", () => {
  for (let width = 22; width <= 140; width++) {
    for (const withSource of [true, false]) {
      const layout = listLayout(width, ROWS, withSource);
      assert.ok(total(layout) <= width, `${total(layout)} columns at ${width}`);
      assert.deepEqual(layout.shown.slice(0, 2), ["tool", "state"]);
    }
  }
});

test("text is cut to a width with an ellipsis, and left alone when it fits", () => {
  assert.equal(clip("description", 11), "description");
  assert.equal(clip("description", 6), "descr…");
  assert.equal(clip("description", 1), "…");
  assert.equal(clip("標題標題標題", 5), "標題…", "a wide character is not split");
});

test("a row's cells are its name, state, estimate and source, safe to draw", () => {
  const tools = [
    mcpTool("linear", "save_issue", {}),
    tool("evil\u001b[2Jname", { provenance: extensionFile("/x/weird\u202ename.ts") }),
  ];
  const catalog = buildCatalog(snapshot(tools, { active: ["mcp__linear__save_issue"] }));
  const issue = findEntry(catalog, "mcp__linear__save_issue");
  const evil = findEntry(catalog, "evil\u001b[2Jname");
  assert.ok(issue && evil);
  assert.deepEqual(listCells(issue), { tool: "mcp__linear__save_issue", state: "● active", tokens: `~${issue.cost.declaration}`, source: "mcp · linear" });
  assert.equal(listCells(evil).tool, "evil\\u001b[2Jname");
  assert.equal(listCells(evil).source, "weird\\u202ename");
  assert.equal(listCells(evil).state, "○ off");
});
