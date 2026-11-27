import assert from "node:assert/strict";
import test from "node:test";
import { PLAIN_THEME } from "@ponygirls/pi-ui";
import { buildCatalog, findEntry, type ToolCatalog, type ToolEntry } from "../src/catalog.ts";
import { declarationJson, jsonLines, outlineLines } from "../src/detail.ts";
import type { PromptLines, RegisteredTool, RegistrySnapshot } from "../src/registry.ts";
import { HOSTILE, TAG_THEME, assertFits, assertInert, declared, mcpTool, plain, snapshot, tags, tool } from "./fixtures.ts";

const HOME = "/home/u";
const WIDTH = 100;

const SAVE_ISSUE = mcpTool("linear", "save_issue", {
  description: "Create or update a Linear issue.\n\nWhen creating, `title` and `team` are required.",
  hints: { readOnly: false, destructive: false, idempotent: true, openWorld: false },
  parameters: {
    type: "object",
    required: ["title"],
    properties: {
      title: { type: "string", description: "Issue title" },
      priority: { type: "number", enum: [0, 1, 2], description: "0 = none, 1 = urgent, 2 = high" },
      labels: { type: "array", items: { type: "string" } },
    },
  },
});
const RECALL = tool("context_recall", {
  parameters: {
    anyOf: [
      { type: "object", required: ["action"], properties: { action: { type: "string", const: "list" }, limit: { type: "integer" } } },
      { type: "object", required: ["action", "query"], properties: { action: { type: "string", const: "find" }, query: { type: "string", description: "Literal to find" } } },
    ],
  },
});
const READ = tool("read", { description: "Read a file" });
const READ_LINES: PromptLines = { snippet: "Read file contents", guidelines: ["Use read instead of cat."] };

interface Rendered {
  entry: ToolEntry;
  catalog: ToolCatalog;
  lines: string[];
}

function render(registered: RegisteredTool, overrides: Partial<Omit<RegistrySnapshot, "tools">>, width: number): Rendered {
  const catalog = buildCatalog(snapshot([registered], overrides));
  const entry = findEntry(catalog, registered.name);
  assert.ok(entry);
  return { entry, catalog, lines: plain(outlineLines(entry, catalog, { theme: PLAIN_THEME, width, home: HOME })) };
}

function section(lines: readonly string[], title: string): string[] {
  const start = lines.findIndex((line) => line.startsWith(`  ${title}`));
  assert.notEqual(start, -1, `no ${title} section in:\n${lines.join("\n")}`);
  const end = lines.findIndex((line, index) => index > start && line === "");
  return lines.slice(start, end === -1 ? lines.length : end);
}

test("the facts come first, state before source, then description and parameters", () => {
  const { lines } = render(SAVE_ISSUE, {}, WIDTH);
  const starts = ["State", "Source", "Tokens", "Hints", "Description", "Parameters"].map((label) => lines.findIndex((line) => line.startsWith(`  ${label}`)));
  assert.ok(starts.every((index) => index !== -1), lines.join("\n"));
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
  assert.equal(lines[0], "  State   deferred · not declared to the model · tool_search can load it");
  assert.equal(lines[1], "  Source  MCP server linear · registered by builtin:mcp");
  assert.match(lines[2]!, /^  Tokens  ~\d+ if loaded · declaration ~\d+ at 4 characters per token · no prompt lines · pi's rule:$/);
  assert.equal(lines[3], "          no model is selected", "a long value continues under the value column");
  assert.equal(lines[4], "  Hints   writes · not destructive · idempotent · closed world · stated by its author, unverified");
});

test("facts that do not apply are left out", () => {
  const { lines } = render(READ, { active: ["read"], declared: declared([READ]) }, WIDTH);
  assert.equal(lines[0], "  State   active · declared to the model");
  assert.equal(lines.some((line) => line.startsWith("  Hints") || line.startsWith("  Note")), false);
});

test("a declaration that differs from the registered definition is flagged", () => {
  const rewritten = { name: "read", description: "Read a file. Call it from scripts as tools.read().", parameters: READ.parameters };
  const { lines } = render(READ, { active: ["read"], declared: new Map([["read", rewritten]]) }, WIDTH);
  assert.ok(lines.includes("  Note    shown as declared to the model · the registered definition differs"));
  assert.deepEqual(section(lines, "Description"), ["  Description", "    Read a file. Call it from scripts as tools.read()."]);
});

test("the description keeps its own line breaks and wraps to the pane", () => {
  assert.deepEqual(section(render(SAVE_ISSUE, {}, WIDTH).lines, "Description").slice(0, 2), ["  Description", "    Create or update a Linear issue."]);
  const narrow = render(SAVE_ISSUE, {}, 40).lines;
  const start = narrow.indexOf("  Description");
  assert.deepEqual(narrow.slice(start, start + 5), [
    "  Description",
    "    Create or update a Linear issue.",
    "",
    "    When creating, `title` and `team`",
    "    are required.",
  ]);
});

test("a tool without a description says so", () => {
  assert.deepEqual(section(render(tool("bare", { description: "  " }), {}, WIDTH).lines, "Description"), ["  Description", "    The tool has no description."]);
});

test("prompt lines are shown as pi renders them, with whether they are sent", () => {
  const sent = render(READ, { active: ["read"], promptLines: new Map([["read", READ_LINES]]) }, WIDTH).lines;
  assert.deepEqual(section(sent, "Prompt lines"), [
    "  Prompt lines  in the system prompt while the tool is declared",
    "    - read: Read file contents",
    "    - Use read instead of cat.",
  ]);
  const custom = render(READ, { active: ["read"], promptLines: new Map([["read", READ_LINES]]), promptLinesSent: false }, WIDTH).lines;
  assert.equal(section(custom, "Prompt lines")[0], "  Prompt lines  not sent: a custom system prompt replaces the tool list and the rules");
  assert.equal(render(READ, { active: ["read"] }, WIDTH).lines.some((line) => line.includes("Prompt lines")), false);
});

test("parameters are a table of name, type and description; required ones are marked", () => {
  assert.deepEqual(section(render(SAVE_ISSUE, {}, WIDTH).lines, "Parameters"), [
    "  Parameters  3 · 1 required (*)",
    "    title *   string     Issue title",
    "    priority  0 | 1 | 2  0 = none, 1 = urgent, 2 = high",
    "    labels    string[]",
  ]);
});

test("the count of required parameters is worded for none and for all", () => {
  const params = (required: string[]): string => {
    const registered = tool("t", { parameters: { type: "object", required, properties: { a: { type: "string" }, b: { type: "string" } } } });
    return section(render(registered, {}, WIDTH).lines, "Parameters")[0]!;
  };
  assert.equal(params([]), "  Parameters  2 · none required");
  assert.equal(params(["a", "b"]), "  Parameters  2 · all required");
});

test("a long parameter description wraps under its own column", () => {
  const registered = tool("t", { parameters: { type: "object", properties: { query: { type: "string", description: "word ".repeat(30).trim() } } } });
  const rows = section(render(registered, {}, 60).lines, "Parameters").slice(1);
  assert.ok(rows.length > 1);
  assert.match(rows[0]!, /^    query  string  word( word)*$/);
  for (const row of rows.slice(1)) assert.match(row, /^ {19}word( word)*$/);
});

test("a parameter too long for the table, or a pane too narrow for it, puts the description below", () => {
  const long = tool("t", { parameters: { type: "object", properties: {
    a_parameter_name_longer_than_the_column: { type: "string", description: "Explained below" },
    short: { type: "string", description: "Explained beside" },
  } } });
  assert.deepEqual(section(render(long, {}, WIDTH).lines, "Parameters").slice(1), [
    "    a_parameter_name_longer_than_the_column  string",
    "      Explained below",
    "    short                     string  Explained beside",
  ]);
  assert.deepEqual(section(render(SAVE_ISSUE, {}, 40).lines, "Parameters").slice(1), [
    "    title *  string",
    "      Issue title",
    "    priority  0 | 1 | 2",
    "      0 = none, 1 = urgent, 2 = high",
    "    labels  string[]",
  ]);
});

test("parameters that are a union are shown shape by shape", () => {
  assert.deepEqual(section(render(RECALL, {}, WIDTH).lines, "Parameters"), [
    "  Parameters  3 · one of 2 shapes",
    '    action "list"  1 required (*)',
    '      action *  "list"',
    "      limit     integer",
    '    action "find"  all required',
    '      action *  "find"',
    "      query *   string  Literal to find",
  ]);
});

test("no parameters and an unreadable schema each get a sentence", () => {
  assert.deepEqual(section(render(tool("t", {}), {}, WIDTH).lines, "Parameters"), ["  Parameters", "    The tool takes no parameters."]);
  assert.deepEqual(section(render(tool("t", { parameters: { type: "string" } }), {}, WIDTH).lines, "Parameters"),
    ["  Parameters", "    The schema is not a plain object; v shows it as JSON."]);
});

test("a pane too narrow for labels beside values stacks them", () => {
  const { lines } = render(READ, {}, 20);
  assert.deepEqual(lines.slice(0, 4), ["  State", "    off · not", "    declared to the", "    model"]);
});

test("every line fits the pane at any width", () => {
  const catalogs: [RegisteredTool, Partial<Omit<RegistrySnapshot, "tools">>][] = [
    [SAVE_ISSUE, {}], [RECALL, { active: ["context_recall"] }], [READ, { active: ["read"], promptLines: new Map([["read", READ_LINES]]) }],
    [tool(HOSTILE, { description: HOSTILE.repeat(20), parameters: { type: "object", properties: { [HOSTILE]: { type: "string", description: HOSTILE } } } }), {}],
  ];
  for (const [registered, overrides] of catalogs) {
    for (let width = 1; width <= 160; width++) {
      const catalog = buildCatalog(snapshot([registered], overrides));
      const entry = findEntry(catalog, registered.name)!;
      assertFits(outlineLines(entry, catalog, { theme: TAG_THEME, width, home: HOME }), width, registered.name);
      assertFits(jsonLines(declarationJson(entry).split("\n"), width), width, `${registered.name} as JSON`);
    }
  }
});

test("hostile tool text is shown as escapes and never reaches the terminal", () => {
  const hostile = mcpTool(HOSTILE, HOSTILE, {
    description: HOSTILE,
    namespace: { name: `mcp__${HOSTILE}`, description: HOSTILE },
    parameters: { type: "object", properties: { [HOSTILE]: { type: "string", enum: [HOSTILE], description: HOSTILE } }, required: [HOSTILE] },
  });
  const catalog = buildCatalog(snapshot([hostile], { active: [hostile.name], promptLines: new Map([[hostile.name, { snippet: HOSTILE, guidelines: [HOSTILE] }]]) }));
  const entry = findEntry(catalog, hostile.name)!;
  for (const width of [30, 80, 140]) {
    const outline = outlineLines(entry, catalog, { theme: TAG_THEME, width, home: HOME });
    assertInert(outline, "outline");
    assert.ok(plain(outline).join("\n").includes("evil\\u001b[2J"), "the escape is visible as text");
    assertInert(jsonLines(declarationJson(entry).split("\n"), width), "JSON");
  }
});

test("the state fact is coloured by state; explanations are secondary", () => {
  const colored = (overrides: Partial<Omit<RegistrySnapshot, "tools">>): string => {
    const catalog = buildCatalog(snapshot([READ], overrides));
    return tags(outlineLines(findEntry(catalog, "read")!, catalog, { theme: TAG_THEME, width: WIDTH, home: HOME })[0]!);
  };
  assert.equal(colored({ active: ["read"], declared: declared([READ]) }), "  <dim>State</>   <success>active</><dim> · </><muted>declared to the model</>");
  assert.equal(colored({}), "  <dim>State</>   <muted>off</><dim> · </><muted>not declared to the model</>");
});

test("the JSON view is the declaration the estimate measures, pretty-printed", () => {
  const { entry } = render(SAVE_ISSUE, {}, WIDTH);
  const json = declarationJson(entry);
  assert.deepEqual(JSON.parse(json), { name: SAVE_ISSUE.name, description: SAVE_ISSUE.description, parameters: SAVE_ISSUE.parameters });
  assert.equal(json.split("\n")[1], '  "name": "mcp__linear__save_issue",');
  assert.deepEqual(Object.keys(JSON.parse(json)), ["name", "description", "parameters"]);
});

test("the JSON view shows the model's declaration, not the registered one, when they differ", () => {
  const rewritten = { name: "read", description: "As the model has it", parameters: READ.parameters };
  const { entry } = render(READ, { active: ["read"], declared: new Map([["read", rewritten]]) }, WIDTH);
  assert.equal(JSON.parse(declarationJson(entry)).description, "As the model has it");
});

test("JSON lines sit under the row gutter and wrap to the pane", () => {
  assert.deepEqual(jsonLines(["{", '  "name": "read"', "}"], 40), ["  {", '    "name": "read"', "  }"]);
  const wrapped = jsonLines([`  "description": "${"word ".repeat(20)}"`], 40);
  assert.ok(wrapped.length > 1);
  assertFits(wrapped, 40, "wrapped JSON");
  assert.ok(wrapped.every((line) => line.startsWith("  ")));
  assert.deepEqual(jsonLines(["", "x"], 40), ["  ", "  x"]);
});
