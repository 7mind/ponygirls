import assert from "node:assert/strict";
import test from "node:test";
import { buildCatalog, findEntry, totalTokens, type ToolCatalog } from "../src/catalog.ts";
import { SORT_KEYS, TABS, filterTerms, listItems, nextOf, selectTools, summarize, type ListItem, type Query } from "../src/query.ts";
import type { RegistrySnapshot } from "../src/registry.ts";
import { originLabel } from "../src/origin.ts";
import { extensionFile, mcpTool, snapshot, tool } from "./fixtures.ts";

const TOOLS = [
  tool("write", {}),
  tool("read", { description: "Read the contents of a file" }),
  tool("grep", { description: "Search file contents for a pattern, with a description long enough to cost more than read" }),
  tool("bg_task", { provenance: extensionFile("/ext/ponygirls-bg-tasks/index.ts"), description: "Run background shell commands" }),
  mcpTool("linear", "save_issue", { description: "Create or update a Linear issue with many fields: title, team, labels, priority, estimate, due date" }),
  mcpTool("linear", "get_issue", { description: "Retrieve an issue" }),
  mcpTool("github", "list_issues", { description: "List issues in a GitHub repository" }),
];
const ACTIVE = ["read", "write", "bg_task", "mcp__github__list_issues"];

function catalogOf(overrides: Partial<Omit<RegistrySnapshot, "tools">>): ToolCatalog {
  return buildCatalog(snapshot(TOOLS, { active: ACTIVE, ...overrides }));
}

function names(catalog: ToolCatalog, query: Query): string[] {
  return selectTools(catalog, query).map((entry) => entry.name);
}

function tokensOf(catalog: ToolCatalog, name: string): number {
  const entry = findEntry(catalog, name);
  assert.ok(entry);
  return totalTokens(entry.cost);
}

function labels(items: readonly ListItem[]): string[] {
  return items.map((item) => (item.kind === "source" ? `# ${originLabel(item.summary.origin)}` : item.entry.name));
}

test("tabs and sort keys cycle in their fixed order", () => {
  assert.deepEqual(TABS, ["all", "active", "inactive"]);
  assert.deepEqual(SORT_KEYS, ["source", "tokens", "name"]);
  assert.equal(nextOf(TABS, "all"), "active");
  assert.equal(nextOf(TABS, "inactive"), "all");
  assert.equal(nextOf(SORT_KEYS, "name"), "source");
});

test("sorted by source: built-in, then extensions, then MCP servers, tools by name inside each", () => {
  const catalog = catalogOf({});
  assert.deepEqual(names(catalog, { tab: "all", sort: "source", filter: "" }),
    ["grep", "read", "write", "bg_task", "mcp__github__list_issues", "mcp__linear__get_issue", "mcp__linear__save_issue"]);
});

test("sorted by tokens: the costliest first, ties by name", () => {
  const catalog = catalogOf({});
  const order = names(catalog, { tab: "all", sort: "tokens", filter: "" });
  const costs = order.map((name) => tokensOf(catalog, name));
  assert.deepEqual(costs, [...costs].sort((a, b) => b - a));
  assert.equal(order[0], "mcp__linear__save_issue");
  assert.deepEqual(names(buildCatalog(snapshot([tool("b", { description: "x" }), tool("a", { description: "x" })], {})), { tab: "all", sort: "tokens", filter: "" }), ["a", "b"]);
});

test("sorted by name: plain alphabetical", () => {
  assert.deepEqual(names(catalogOf({}), { tab: "all", sort: "name", filter: "" }),
    ["bg_task", "grep", "mcp__github__list_issues", "mcp__linear__get_issue", "mcp__linear__save_issue", "read", "write"]);
});

test("the active and inactive tabs split the catalog by pi's active set", () => {
  const catalog = catalogOf({ withheld: ["write"] });
  const active = names(catalog, { tab: "active", sort: "name", filter: "" });
  const inactive = names(catalog, { tab: "inactive", sort: "name", filter: "" });
  assert.deepEqual(active, ["bg_task", "mcp__github__list_issues", "read", "write"], "a withheld tool is still in the active set");
  assert.deepEqual(inactive, ["grep", "mcp__linear__get_issue", "mcp__linear__save_issue"]);
  assert.equal(active.length + inactive.length, catalog.entries.length);
});

test("a filter keeps tools where every word occurs in the name, the source or the description", () => {
  const catalog = catalogOf({});
  const filtered = (filter: string): string[] => names(catalog, { tab: "all", sort: "name", filter });
  assert.deepEqual(filtered("issue"), ["mcp__github__list_issues", "mcp__linear__get_issue", "mcp__linear__save_issue"]);
  assert.deepEqual(filtered("ISSUE linear"), ["mcp__linear__get_issue", "mcp__linear__save_issue"]);
  assert.deepEqual(filtered("  linear   update "), ["mcp__linear__save_issue"], "update is in the description, linear in the name");
  assert.deepEqual(filtered("ponygirls"), ["bg_task"], "the source label is searched");
  assert.deepEqual(filtered("built-in pattern"), ["grep"]);
  assert.deepEqual(filtered("nothing-matches-this"), []);
  assert.deepEqual(filterTerms("  Issue\tLinear "), ["issue", "linear"]);
});

test("the summary counts tools and tokens overall and per source", () => {
  const catalog = catalogOf({ model: { id: "scripted", contextWindow: 10_000 } });
  const summary = summarize(catalog);
  const charged = ACTIVE.reduce((sum, name) => sum + tokensOf(catalog, name), 0);
  const all = TOOLS.reduce((sum, item) => sum + tokensOf(catalog, item.name), 0);
  assert.equal(summary.all, 7);
  assert.equal(summary.active, 4);
  assert.equal(summary.inactive, 3);
  assert.equal(summary.chargedTokens, charged);
  assert.equal(summary.inactiveTokens, all - charged);
  assert.equal(summary.windowShare, charged / 10_000);
  assert.deepEqual(summary.sources.map((source) => [originLabel(source.origin), source.tools, source.active]), [
    ["built-in", 3, 2],
    ["ponygirls-bg-tasks", 1, 1],
    ["mcp · github", 1, 1],
    ["mcp · linear", 2, 0],
  ]);
  const linear = summary.sources[3]!;
  assert.equal(linear.chargedTokens, 0);
  assert.equal(linear.allTokens, tokensOf(catalog, "mcp__linear__save_issue") + tokensOf(catalog, "mcp__linear__get_issue"));
  const builtIn = summary.sources[0]!;
  assert.equal(builtIn.chargedTokens, tokensOf(catalog, "read") + tokensOf(catalog, "write"));
  assert.equal(builtIn.allTokens, builtIn.chargedTokens + tokensOf(catalog, "grep"));
});

test("a withheld tool is active but its tokens are not charged", () => {
  const catalog = catalogOf({ withheld: ["read"] });
  const summary = summarize(catalog);
  assert.equal(summary.active, 4);
  assert.equal(summary.chargedTokens, ACTIVE.filter((name) => name !== "read").reduce((sum, name) => sum + tokensOf(catalog, name), 0));
  assert.equal(summary.inactiveTokens, ["grep", "mcp__linear__save_issue", "mcp__linear__get_issue"].reduce((sum, name) => sum + tokensOf(catalog, name), 0));
});

test("without a model there is no share of a context window", () => {
  assert.equal(summarize(catalogOf({ model: null })).windowShare, null);
  assert.equal(summarize(catalogOf({ model: { id: "scripted", contextWindow: 0 } })).windowShare, null);
});

test("an empty catalog summarizes to zeros", () => {
  assert.deepEqual(summarize(buildCatalog(snapshot([], { model: { id: "scripted", contextWindow: 1000 } }))), {
    all: 0, active: 0, inactive: 0, chargedTokens: 0, inactiveTokens: 0, windowShare: 0, sources: [],
  });
});

test("sorted by source, the list puts each source's heading before its tools", () => {
  const catalog = catalogOf({});
  const summary = summarize(catalog);
  const grouped = listItems(selectTools(catalog, { tab: "all", sort: "source", filter: "" }), summary, "source");
  assert.deepEqual(labels(grouped), [
    "# built-in", "grep", "read", "write",
    "# ponygirls-bg-tasks", "bg_task",
    "# mcp · github", "mcp__github__list_issues",
    "# mcp · linear", "mcp__linear__get_issue", "mcp__linear__save_issue",
  ]);
  const heading = grouped[8]!;
  assert.ok(heading.kind === "source");
  assert.equal(heading.summary.tools, 2, "a heading describes its whole source");
});

test("a heading appears only for sources that still have tools after tab and filter", () => {
  const catalog = catalogOf({});
  const tools = selectTools(catalog, { tab: "inactive", sort: "source", filter: "issue" });
  const items = listItems(tools, summarize(catalog), "source");
  assert.deepEqual(labels(items), ["# mcp · linear", "mcp__linear__get_issue", "mcp__linear__save_issue"]);
  const heading = items[0]!;
  assert.ok(heading.kind === "source");
  assert.equal(heading.summary.tools, 2);
});

test("the other sort keys give a flat list without headings", () => {
  const catalog = catalogOf({});
  const summary = summarize(catalog);
  for (const sort of ["tokens", "name"] as const) {
    const items = listItems(selectTools(catalog, { tab: "all", sort, filter: "" }), summary, sort);
    assert.equal(items.length, 7);
    assert.equal(items.every((item) => item.kind === "tool"), true);
  }
});
