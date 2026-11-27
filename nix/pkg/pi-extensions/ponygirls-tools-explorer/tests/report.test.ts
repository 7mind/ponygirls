import assert from "node:assert/strict";
import test from "node:test";
import { buildCatalog, findEntry, totalTokens, type ToolCatalog } from "../src/catalog.ts";
import { shareText, tokenText } from "../src/present.ts";
import { summarize } from "../src/query.ts";
import type { RegistrySnapshot } from "../src/registry.ts";
import { summaryReport, toolsReport } from "../src/report.ts";
import { HOSTILE, TERMINAL_ACTIVE, extensionFile, mcpTool, snapshot, tool } from "./fixtures.ts";

const TOOLS = [
  tool("read", { description: "Read the contents of a file" }),
  tool("grep", { description: "Search file contents for a pattern" }),
  tool("bg_task", { provenance: extensionFile("/ext/ponygirls-bg-tasks/index.ts"), description: "Run background shell commands" }),
  mcpTool("linear", "save_issue", { description: "Create or update a Linear issue" }),
  mcpTool("linear", "get_issue", { description: "Retrieve an issue" }),
];

function catalogOf(overrides: Partial<Omit<RegistrySnapshot, "tools">>): ToolCatalog {
  return buildCatalog(snapshot(TOOLS, { active: ["read", "bg_task"], model: { id: "claude-haiku-5-5", contextWindow: 2_000 }, ...overrides }));
}

function tokens(catalog: ToolCatalog, ...names: string[]): string {
  return tokenText(names.reduce((sum, name) => sum + totalTokens(findEntry(catalog, name)!.cost), 0));
}

test("the summary gives the totals, the basis of the estimates and a line per source", () => {
  const catalog = catalogOf({});
  const summary = summarize(catalog);
  const lines = summaryReport(catalog).split("\n");
  assert.equal(lines[0], `Tools: 5 registered · 2 active, ${tokens(catalog, "read", "bg_task")} tok (${shareText(summary.windowShare!, catalog.model!)}) · `
    + `3 inactive, ${tokens(catalog, "grep", "mcp__linear__save_issue", "mcp__linear__get_issue")} tok if loaded`);
  assert.equal(lines[1], "Estimates: 2.7 characters per token for declarations, 3.1 for prompt lines; measured for Claude models.");
  assert.equal(lines[2], "");
  assert.deepEqual(lines.slice(3).map((line) => line.split(/ {2,}/)), [
    ["SOURCE", "TOOLS", "ACTIVE", "ACTIVE TOK", "ALL TOK"],
    ["built-in", "2", "1", tokens(catalog, "read"), tokens(catalog, "read", "grep")],
    ["ponygirls-bg-tasks", "1", "1", tokens(catalog, "bg_task"), tokens(catalog, "bg_task")],
    ["mcp · linear", "2", "·", "·", tokens(catalog, "mcp__linear__save_issue", "mcp__linear__get_issue")],
  ]);
});

test("the summary's columns line up: names to the left, numbers to the right", () => {
  const lines = summaryReport(catalogOf({})).split("\n").slice(3);
  const header = lines[0]!;
  for (const column of ["TOOLS", "ACTIVE", "ACTIVE TOK", "ALL TOK"]) {
    const end = header.indexOf(column) + column.length;
    for (const line of lines.slice(1)) assert.match(line.slice(0, end), /\S$/, `${column} ends at ${end} in: ${line}`);
  }
  for (const line of lines) assert.equal(line, line.trimEnd());
  assert.ok(lines.slice(1).every((line) => /^\S/.test(line)));
});

test("without a model the summary has no share of a window and says which rule it used", () => {
  const lines = summaryReport(catalogOf({ model: null })).split("\n");
  assert.match(lines[0]!, /^Tools: 5 registered · 2 active, ~\d+ tok · 3 inactive, ~\d+ tok if loaded$/);
  assert.equal(lines[1], "Estimates: 4 characters per token; pi's rule: no model is selected.");
});

test("a filter lists the matching tools with state, estimate and source", () => {
  const catalog = catalogOf({ active: ["read", "mcp__linear__get_issue"] });
  const lines = toolsReport(catalog, "issue").split("\n");
  assert.equal(lines[0], 'Tools matching "issue": 2 of 5');
  assert.equal(lines[1], "Estimates: 2.7 characters per token for declarations, 3.1 for prompt lines; measured for Claude models.");
  assert.deepEqual(lines.slice(3).map((line) => line.split(/ {2,}/)), [
    ["TOOL", "STATE", "TOKENS", "SOURCE"],
    ["mcp__linear__get_issue", "● active", tokens(catalog, "mcp__linear__get_issue"), "mcp · linear"],
    ["mcp__linear__save_issue", "○ deferred", tokens(catalog, "mcp__linear__save_issue"), "mcp · linear"],
  ]);
});

test("matching tools are listed source by source, like the pane's first view", () => {
  const rows = toolsReport(catalogOf({}), "e").split("\n").slice(4).map((line) => line.split(/ {2,}/)[0]);
  assert.deepEqual(rows, ["grep", "read", "bg_task", "mcp__linear__get_issue", "mcp__linear__save_issue"]);
});

test("a filter that matches nothing says so, with how many tools there are", () => {
  assert.equal(toolsReport(catalogOf({}), "no-such-thing"), 'No tool matches "no-such-thing" (5 registered).');
});

test("a session without tools gets one sentence either way", () => {
  const empty = buildCatalog(snapshot([], {}));
  assert.equal(summaryReport(empty), "No tools are registered in this session.");
  assert.equal(toolsReport(empty, "x"), "No tools are registered in this session.");
});

test("hostile names and filters are escaped in the text", () => {
  const hostile = tool(HOSTILE, { provenance: extensionFile(`/x/${HOSTILE}.ts`) });
  const catalog = buildCatalog(snapshot([hostile], {}));
  for (const text of [summaryReport(catalog), toolsReport(catalog, "evil"), toolsReport(catalog, HOSTILE)]) {
    assert.doesNotMatch(text, TERMINAL_ACTIVE);
    assert.ok(text.includes("\\u001b"), "the escape character is shown as text");
  }
});
