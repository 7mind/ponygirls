import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { VStack, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { renderLayoutFrame } from "@earendil-works/pi-tui/dist/layout.js";
import { PLAIN_THEME, type UiTheme } from "@ponygirls/pi-ui";
import { buildCatalog, findEntry, totalTokens } from "../src/catalog.ts";
import { REFRESH_MS, ToolsPane } from "../src/pane.ts";
import { tokenText } from "../src/present.ts";
import { summarize } from "../src/query.ts";
import type { RegisteredTool, RegistrySnapshot, ToolRegistry } from "../src/registry.ts";
import { HOSTILE, TAG_THEME, assertFits, assertInert, extensionFile, mcpTool, plain, tags, tool } from "./fixtures.ts";
import { InMemoryToolRegistry } from "./memory-registry.ts";

const KEY = {
  up: "\x1b[A", down: "\x1b[B", right: "\x1b[C", left: "\x1b[D", enter: "\r", esc: "\x1b", tab: "\t",
  pageUp: "\x1b[5~", pageDown: "\x1b[6~", home: "\x1b[H", end: "\x1b[F", backspace: "\x7f",
} as const;
const WIDTH = 120;
/** Terminal rows of the fixture: 21 body lines once the pane's chrome and pi's footer are taken off. */
const ROWS = 30;

const SAVE_ISSUE = mcpTool("linear", "save_issue", {
  description: "Create or update a Linear issue",
  parameters: { type: "object", required: ["title"], properties: Object.fromEntries(Array.from({ length: 30 }, (_unused, index) => [`field${index}`, { type: "string", description: `Field number ${index}` }])) },
});
const TOOLS: readonly RegisteredTool[] = [
  tool("read", { description: "Read the contents of a file" }),
  tool("grep", { description: "Search file contents for a pattern" }),
  tool("bash", { description: "Execute a bash command" }),
  tool("bg_task", { description: "Run background shell commands", provenance: extensionFile("/ext/ponygirls-bg-tasks/index.ts") }),
  mcpTool("github", "search_code", { description: "Search code across repositories" }),
  mcpTool("github", "list_issues", { description: "List issues in a repository" }),
  SAVE_ISSUE,
  mcpTool("linear", "get_issue", { description: "Retrieve an issue" }),
];
const ACTIVE = ["read", "bash", "bg_task", "mcp__github__search_code"];

interface Opened {
  pane: ToolsPane;
  registry: InMemoryToolRegistry;
  closed(): number;
  renders(): number;
}

interface OpenOptions {
  tools: readonly RegisteredTool[];
  active: readonly string[];
  theme: UiTheme;
  rows: number;
  filter: string;
}

const DEFAULTS: OpenOptions = { tools: TOOLS, active: ACTIVE, theme: PLAIN_THEME, rows: ROWS, filter: "" };

const CLOCKED = new WeakSet<TestContext>();

function paneOver(t: TestContext, registry: ToolRegistry, options: OpenOptions): { pane: ToolsPane; closed(): number; renders(): number } {
  // The pane refreshes on an interval; a controlled clock keeps that out of tests that are not about it.
  if (!CLOCKED.has(t)) {
    t.mock.timers.enable({ apis: ["setInterval"] });
    CLOCKED.add(t);
  }
  let closed = 0;
  let renders = 0;
  const pane = new ToolsPane({
    registry,
    theme: options.theme,
    keys: { matches: (data) => data === KEY.esc },
    rows: () => options.rows,
    requestRender: () => { renders += 1; },
    close: () => { closed += 1; },
    highlightJson: (json) => json.split("\n"),
    home: "/home/u",
    refreshEveryMs: REFRESH_MS,
    filter: options.filter,
  });
  t.after(() => pane.dispose());
  return { pane, closed: () => closed, renders: () => renders };
}

function open(t: TestContext, overrides: Partial<OpenOptions>): Opened {
  const options = { ...DEFAULTS, ...overrides };
  const registry = new InMemoryToolRegistry({ tools: options.tools, active: options.active, promptLines: new Map(), model: { id: "scripted", contextWindow: 100_000 } });
  registry.request();
  return { ...paneOver(t, registry, options), registry };
}

function press(pane: ToolsPane, ...keys: string[]): void {
  for (const key of keys) pane.handleInput(key);
}

function type(pane: ToolsPane, text: string): void {
  press(pane, ...text);
}

function screen(pane: ToolsPane, width: number): string[] {
  return plain(pane.render(width));
}

/** The rows of the list: everything between the column header and the footer rule. */
function listRows(pane: ToolsPane, width: number): string[] {
  const lines = screen(pane, width);
  const header = lines.findIndex((line) => /^ {2}TOOL\b/.test(line));
  assert.notEqual(header, -1, lines.join("\n"));
  const end = lines.findIndex((line, index) => index > header && (line.startsWith("──") || line.startsWith("  hidden at this width")));
  return lines.slice(header + 1, end);
}

/** A source heading: its name, then how many tools it has. */
const HEADING = /^ {2}\S.* {2}\d+ tools? · /;

/** Tool names in list order, the selected one marked with `>`. */
function names(pane: ToolsPane): string[] {
  return listRows(pane, WIDTH).filter((line) => !HEADING.test(line)).map((line) => `${line.startsWith("▌") ? ">" : ""}${line.slice(2).split(/\s+/)[0]}`);
}

function selected(pane: ToolsPane): string {
  const marked = names(pane).filter((name) => name.startsWith(">"));
  assert.equal(marked.length, 1, `one selected row, got ${JSON.stringify(marked)}`);
  return marked[0]!.slice(1);
}

function hints(pane: ToolsPane, width: number): string {
  const lines = screen(pane, width);
  return lines.slice(lines.lastIndexOf("─".repeat(width)) + 1).join("  ");
}

/** What stands between the footer rule and the hints, if anything. */
function notice(pane: ToolsPane): string | null {
  const lines = screen(pane, WIDTH);
  const footer = lines.slice(lines.lastIndexOf("─".repeat(WIDTH)) + 1);
  const hint = footer.findIndex((line) => /^(↑↓|⏎|tab|esc|v|l|u|s|\/) /.test(line));
  assert.notEqual(hint, -1, `no hints in ${JSON.stringify(footer)}`);
  return hint === 0 ? null : footer.slice(0, hint).join(" ");
}

function tokensOf(snapshot: RegistrySnapshot, ...toolNames: string[]): string {
  const catalog = buildCatalog(snapshot);
  return tokenText(toolNames.reduce((sum, name) => sum + totalTokens(findEntry(catalog, name)!.cost), 0));
}

// ---- list ------------------------------------------------------------------------

test("the pane opens on every tool grouped by source, with totals in the title", (t) => {
  const { pane, registry } = open(t, {});
  const lines = screen(pane, WIDTH);
  const snapshot = registry.snapshot();
  const charged = summarize(buildCatalog(snapshot)).chargedTokens;
  assert.match(lines[0]!, new RegExp(`^── Tools {3}all 8 {3}active 4 {3}inactive 4 {2}─+ ${tokenText(charged).replace(".", "\\.")} tok active · \\d+\\.\\d% of 100k ──$`));
  assert.equal(lines[1], "  TOOL                      STATE       TOKENS  DESCRIPTION");
  assert.deepEqual(lines.slice(2, 14), [
    `  built-in  3 tools · 2 active · ${tokensOf(snapshot, "read", "bash")} of ${tokensOf(snapshot, "read", "bash", "grep")} tok`,
    `▌ bash                      ● active    ${tokensOf(snapshot, "bash").padStart(6)}  Execute a bash command`,
    `  grep                      ○ off       ${tokensOf(snapshot, "grep").padStart(6)}  Search file contents for a pattern`,
    `  read                      ● active    ${tokensOf(snapshot, "read").padStart(6)}  Read the contents of a file`,
    `  ponygirls-bg-tasks  1 tool · active · ${tokensOf(snapshot, "bg_task")} tok`,
    `  bg_task                   ● active    ${tokensOf(snapshot, "bg_task").padStart(6)}  Run background shell commands`,
    `  mcp · github  2 tools · 1 active · ${tokensOf(snapshot, "mcp__github__search_code")} of ${tokensOf(snapshot, "mcp__github__search_code", "mcp__github__list_issues")} tok`,
    `  mcp__github__list_issues  ○ deferred  ${tokensOf(snapshot, "mcp__github__list_issues").padStart(6)}  List issues in a repository`,
    `  mcp__github__search_code  ● active    ${tokensOf(snapshot, "mcp__github__search_code").padStart(6)}  Search code across repositories`,
    `  mcp · linear  2 tools · none active · ${tokensOf(snapshot, "mcp__linear__get_issue", "mcp__linear__save_issue")} tok if loaded`,
    `  mcp__linear__get_issue    ○ deferred  ${tokensOf(snapshot, "mcp__linear__get_issue").padStart(6)}  Retrieve an issue`,
    `  mcp__linear__save_issue   ○ deferred  ${tokensOf(snapshot, "mcp__linear__save_issue").padStart(6)}  Create or update a Linear issue`,
  ]);
  assert.equal(lines[14], "─".repeat(WIDTH));
  assert.equal(lines[15], "↑↓ select  ⏎ details  tab active  s sort by tokens  / filter  u unload  esc close");
  assert.equal(lines.length, 16);
});

test("state is coloured, the estimate of an uncharged tool and all secondary text are muted, the selection is a band", (t) => {
  const { pane } = open(t, { theme: TAG_THEME });
  const lines = pane.render(WIDTH).map(tags);
  assert.match(lines[1]!, /^<dim> {2}TOOL +STATE +TOKENS +DESCRIPTION<\/>$/);
  assert.match(lines[2]!, /^ {2}\*<text>built-in<\/>\* {2}<dim>3 tools · 2 active · .* tok<\/>$/);
  assert.match(lines[3]!, /^\[selectedBg <accent>▌<\/> \*<text>bash<\/> +<success>● active<\/> +<text>~\d+<\/> +<muted>Execute a bash command<\/>\* *\]$/);
  assert.match(lines[4]!, /^ {2}<text>grep<\/> +<muted>○ off<\/> +<muted>~\d+<\/> +<muted>Search file contents for a pattern<\/>$/);
});

test("arrows, PgUp/PgDn, Home and End move the selection, stopping at the ends", (t) => {
  const { pane } = open(t, {});
  assert.equal(selected(pane), "bash");
  press(pane, KEY.down, KEY.down);
  assert.equal(selected(pane), "read");
  press(pane, KEY.down);
  assert.equal(selected(pane), "bg_task", "the selection steps over a source heading");
  press(pane, KEY.up, KEY.up, KEY.up, KEY.up, KEY.up);
  assert.equal(selected(pane), "bash");
  press(pane, KEY.end);
  assert.equal(selected(pane), "mcp__linear__save_issue");
  press(pane, KEY.down);
  assert.equal(selected(pane), "mcp__linear__save_issue");
  press(pane, KEY.home);
  assert.equal(selected(pane), "bash");
  press(pane, "j", "j", "k");
  assert.equal(selected(pane), "grep", "j and k stay bound");
});

test("a list longer than the pane shows a window around the selection; paging moves by a window", (t) => {
  const many = Array.from({ length: 60 }, (_unused, index) => tool(`tool_${String(index).padStart(2, "0")}`, {}));
  const { pane } = open(t, { tools: many, active: [], rows: 20 });
  // 20 rows less the chrome leave 11 body lines: the column header and 10 list lines.
  assert.deepEqual(names(pane), [">tool_00", "tool_01", "tool_02", "tool_03", "tool_04", "tool_05", "tool_06", "tool_07", "tool_08"], "a heading and nine tools");
  press(pane, KEY.pageDown);
  assert.equal(selected(pane), "tool_09");
  assert.equal(names(pane).length, 10);
  assert.ok(names(pane).includes("tool_05") && names(pane).includes("tool_13"), "the window is centred on the selection");
  press(pane, KEY.pageDown, KEY.pageDown);
  assert.equal(selected(pane), "tool_27");
  press(pane, KEY.pageUp);
  assert.equal(selected(pane), "tool_18");
  press(pane, KEY.end);
  assert.deepEqual(names(pane).slice(-2), ["tool_58", ">tool_59"], "the last tool is on the last line");
});

test("tab cycles all, active and inactive; each list starts at its first tool", (t) => {
  const { pane } = open(t, {});
  press(pane, KEY.down, KEY.down, KEY.tab);
  assert.match(screen(pane, WIDTH)[0]!, /^── Tools {3}all 8 {3}active 4 {3}inactive 4 /);
  assert.deepEqual(names(pane), [">bash", "read", "bg_task", "mcp__github__search_code"]);
  assert.match(hints(pane, WIDTH), /tab inactive/);
  press(pane, KEY.tab);
  assert.deepEqual(names(pane), [">grep", "mcp__github__list_issues", "mcp__linear__get_issue", "mcp__linear__save_issue"]);
  assert.match(hints(pane, WIDTH), /tab all .* l load /);
  press(pane, KEY.tab);
  assert.equal(names(pane).length, 8);
  assert.equal(selected(pane), "bash");
});

test("the active tab is highlighted in the title", (t) => {
  const { pane } = open(t, { theme: TAG_THEME });
  press(pane, KEY.tab);
  assert.match(tags(pane.render(WIDTH)[0]!), /<muted> all 8 <\/> \[selectedBg <text> active 4 <\/>\] <muted> inactive 4 <\/>/);
});

test("s cycles the order: by source, by tokens with a source column, by name", (t) => {
  const { pane, registry } = open(t, {});
  press(pane, "s");
  const byTokens = listRows(pane, WIDTH);
  assert.match(screen(pane, WIDTH)[1]!, /^ {2}TOOL +STATE +TOKENS +SOURCE +DESCRIPTION$/);
  assert.equal(byTokens.length, 8, "no source headings in a flat list");
  assert.match(byTokens[0]!, /^▌ mcp__linear__save_issue +○ deferred +~\d+ +mcp · linear +Create or update a Linear issue$/);
  const catalog = buildCatalog(registry.snapshot());
  const costs = names(pane).map((name) => totalTokens(findEntry(catalog, name.replace(">", ""))!.cost));
  assert.deepEqual(costs, [...costs].sort((a, b) => b - a));
  assert.match(hints(pane, WIDTH), /s sort by name/);
  press(pane, "s");
  assert.deepEqual(names(pane), [">bash", "bg_task", "grep", "mcp__github__list_issues", "mcp__github__search_code", "mcp__linear__get_issue", "mcp__linear__save_issue", "read"]);
  assert.match(hints(pane, WIDTH), /s sort by source/);
  press(pane, "s");
  assert.match(listRows(pane, WIDTH)[0]!, /^ {2}built-in {2}3 tools/);
});

test("/ filters while typing; enter keeps the filter, esc clears it, and only then closes the pane", (t) => {
  const { pane, closed } = open(t, {});
  press(pane, "/");
  assert.equal(screen(pane, WIDTH)[1], "  /    8 of 8");
  assert.equal(hints(pane, WIDTH), "↑↓ select  ⏎ keep filter  esc clear filter");
  type(pane, "issue");
  assert.equal(screen(pane, WIDTH)[1], "  / issue   3 of 8");
  assert.deepEqual(names(pane), [">mcp__github__list_issues", "mcp__linear__get_issue", "mcp__linear__save_issue"]);
  type(pane, " lin");
  assert.deepEqual(names(pane), [">mcp__linear__get_issue", "mcp__linear__save_issue"], "every word has to match");
  press(pane, KEY.down);
  assert.equal(selected(pane), "mcp__linear__save_issue", "arrows select while the filter is being typed");
  press(pane, KEY.backspace, KEY.backspace, KEY.backspace, KEY.backspace);
  assert.equal(names(pane).length, 3);
  press(pane, KEY.enter);
  assert.equal(screen(pane, WIDTH)[1], "  / issue  3 of 8");
  assert.match(hints(pane, WIDTH), /\/ edit filter .* esc clear filter$/);
  type(pane, "s");
  assert.equal(screen(pane, WIDTH)[1], "  / issue  3 of 8", "letters are commands again once the filter is kept");
  press(pane, KEY.esc);
  assert.equal(closed(), 0);
  assert.equal(names(pane).length, 8);
  assert.match(hints(pane, WIDTH), /esc close$/);
  press(pane, KEY.esc);
  assert.equal(closed(), 1);
});

test("letters typed into the filter are text, not commands", (t) => {
  const { pane, closed, registry } = open(t, {});
  press(pane, "/");
  type(pane, "qlus");
  assert.equal(screen(pane, WIDTH)[1], "  / qlus   0 of 8");
  assert.equal(closed(), 0);
  assert.deepEqual(registry.snapshot().active, ACTIVE);
});

test("editing a kept filter continues after its text; esc while typing clears it", (t) => {
  const { pane } = open(t, {});
  press(pane, "/");
  type(pane, "iss");
  press(pane, KEY.enter, "/");
  type(pane, "ue");
  assert.equal(screen(pane, WIDTH)[1], "  / issue   3 of 8");
  press(pane, KEY.esc);
  assert.equal(names(pane).length, 8);
  assert.doesNotMatch(screen(pane, WIDTH)[1]!, /^ {2}\//);
});

test("the filter counts within the current tab", (t) => {
  const { pane } = open(t, {});
  press(pane, KEY.tab, KEY.tab, "/");
  type(pane, "issue");
  assert.equal(screen(pane, WIDTH)[1], "  / issue   3 of 4");
});

test("the pane opens with the filter it was given", (t) => {
  const { pane } = open(t, { filter: "linear" });
  assert.equal(screen(pane, WIDTH)[1], "  / linear  2 of 8");
  assert.deepEqual(names(pane), [">mcp__linear__get_issue", "mcp__linear__save_issue"]);
});

test("an empty list says why and how to get content", (t) => {
  const filtered = open(t, { filter: "nothing-matches" }).pane;
  assert.deepEqual(screen(filtered, WIDTH).slice(1, 3), ["  / nothing-matches  0 of 8", "  No tool matches the filter. esc clears it."]);
  assert.equal(hints(filtered, WIDTH), "tab active  s sort by tokens  / edit filter  esc clear filter");
  const noInactive = open(t, { active: TOOLS.map((item) => item.name) }).pane;
  press(noInactive, KEY.tab, KEY.tab);
  assert.equal(screen(noInactive, WIDTH)[1], "  No inactive tools. tab shows all.");
  const empty = open(t, { tools: [], active: [] }).pane;
  assert.equal(screen(empty, WIDTH)[1], "  No tools are registered in this session.");
  press(empty, KEY.enter, "l", "u", KEY.down);
  assert.equal(screen(empty, WIDTH)[1], "  No tools are registered in this session.");
});

test("a narrow pane drops columns and names them; the tool and its state stay", (t) => {
  const { pane } = open(t, {});
  const lines = screen(pane, 50);
  assert.equal(lines[1], "  TOOL                      STATE       TOKENS");
  assert.match(lines[3]!, /^▌ bash +● active +~\d+$/);
  assert.ok(lines.includes("  hidden at this width: Description"));
  const narrower = screen(pane, 44);
  assert.equal(narrower[1], "  TOOL                      STATE");
  assert.ok(narrower.includes("  hidden at this width: Tokens, Description"));
});

// regression: seen in a real pi terminal at 80 columns, where the share of the window pushed the last tab out.
test("a narrow title gives up the share of the window before it gives up a tab", (t) => {
  // As many tools, and as costly, as the session it was seen in: the title is as wide as it was there.
  const many = Array.from({ length: 195 }, (_unused, index) => tool(`tool_${String(index).padStart(3, "0")}`, { description: "word ".repeat(240) }));
  const { pane } = open(t, { tools: many, active: many.slice(0, 36).map((item) => item.name) });
  const title = (width: number): string => screen(pane, width)[0]!;
  assert.match(title(120), / ~\d\d\.\dk tok active /);
  assert.match(title(120), /^── Tools {3}all 195 {3}active 36 {3}inactive 159 {2}─+ ~[\d.]+k tok active · \d+\.\d% of 100k ──$/);
  assert.match(title(88), / tok active · \d+\.\d% of 100k ──$/, "the share stays while every tab fits beside it");
  assert.match(title(80), /^── Tools {3}all 195 {3}active 36 {3}inactive 159 {2}─+ ~[\d.]+k tok active ──$/);
  assert.match(title(70), /^── Tools {3}all 195 {3}active 36 {3}inactive 159 {2}─+ ~[\d.]+k tok active ──$/);
  assert.match(title(60), /^── Tools {3}all 195 {3}active 36 {2}› ─+ ~[\d.]+k tok active ──$/, "narrower still, the kit shows the tabs around the current one");
  for (const width of [120, 80, 70, 60]) assert.equal(title(width).length, width);
});

test("esc and q close the pane from the list", (t) => {
  for (const key of [KEY.esc, "q"]) {
    const { pane, closed } = open(t, {});
    press(pane, key);
    assert.equal(closed(), 1);
  }
});

test("every key asks for a repaint", (t) => {
  const { pane, renders } = open(t, {});
  press(pane, KEY.down, "x", KEY.enter, KEY.esc);
  assert.equal(renders(), 4);
});

// ---- detail ----------------------------------------------------------------------

test("enter opens the selected tool; esc returns to the list with it still selected", (t) => {
  const { pane, closed } = open(t, {});
  press(pane, KEY.down, KEY.enter);
  const lines = screen(pane, WIDTH);
  assert.match(lines[0]!, /^── grep ─+ ○ off ──$/);
  assert.equal(lines[1], "  State   off · not declared to the model");
  assert.equal(lines[2], "  Source  built into pi · builtin:read");
  assert.ok(lines.includes("  Description") && lines.includes("    Search file contents for a pattern"));
  assert.equal(hints(pane, WIDTH), "↑↓ scroll  PgUp/PgDn page  ←→ previous/next tool  v JSON  l load  esc back");
  press(pane, KEY.esc);
  assert.equal(closed(), 0);
  assert.equal(selected(pane), "grep");
});

test("v shows the declaration as JSON and switches back", (t) => {
  const { pane } = open(t, {});
  press(pane, KEY.enter, "v");
  const lines = screen(pane, WIDTH);
  assert.match(lines[0]!, /^── bash ─+ ● active ──$/);
  assert.deepEqual(lines.slice(1, 4), ["  {", '    "name": "bash",', '    "description": "Execute a bash command",']);
  assert.match(hints(pane, WIDTH), /v parameters/);
  press(pane, "v");
  assert.equal(screen(pane, WIDTH)[1], "  State   active · declared to the model");
});

test("a detail longer than the pane scrolls by line and by page, and says where it is", (t) => {
  const { pane } = open(t, { rows: 20 });
  press(pane, KEY.end, KEY.enter);
  const position = (): string => screen(pane, WIDTH).find((line) => /^ {2}lines \d+-\d+ of \d+$/.test(line))!;
  assert.match(screen(pane, WIDTH)[0]!, /^── mcp__linear__save_issue /);
  // 20 rows less the chrome leave 11 lines of the detail.
  const total = Number(/of (\d+)$/.exec(position())![1]);
  assert.ok(total > 30);
  assert.equal(position(), `  lines 1-11 of ${total}`);
  press(pane, KEY.down);
  assert.equal(position(), `  lines 2-12 of ${total}`);
  press(pane, KEY.pageDown);
  assert.equal(position(), `  lines 12-22 of ${total}`);
  press(pane, KEY.pageUp, KEY.up, KEY.up);
  assert.equal(position(), `  lines 1-11 of ${total}`);
  press(pane, KEY.end);
  assert.equal(position(), `  lines ${total - 10}-${total} of ${total}`);
  press(pane, KEY.down);
  assert.equal(position(), `  lines ${total - 10}-${total} of ${total}`);
  press(pane, KEY.home);
  assert.equal(position(), `  lines 1-11 of ${total}`);
});

test("left and right step through the tools of the list, starting each at its top", (t) => {
  const { pane } = open(t, { rows: 20 });
  press(pane, KEY.end, KEY.up, KEY.enter);
  assert.match(screen(pane, WIDTH)[0]!, /^── mcp__linear__get_issue /);
  press(pane, KEY.right, KEY.pageDown);
  assert.match(screen(pane, WIDTH)[0]!, /^── mcp__linear__save_issue /);
  assert.ok(screen(pane, WIDTH).some((line) => /^ {2}lines 11-/.test(line)));
  press(pane, KEY.right);
  assert.ok(screen(pane, WIDTH).some((line) => /^ {2}lines 11-/.test(line)), "no next tool: nothing moves");
  press(pane, KEY.left, KEY.left);
  assert.match(screen(pane, WIDTH)[0]!, /^── mcp__github__search_code /);
  assert.equal(screen(pane, WIDTH)[1], "  State   active · declared to the model", "a new tool starts at its top");
  press(pane, KEY.esc);
  assert.equal(selected(pane), "mcp__github__search_code");
});

test("a tool reached by stepping starts at its top; the last tool keeps its place when there is no next one", (t) => {
  const long = (name: string): RegisteredTool => tool(name, { parameters: SAVE_ISSUE.parameters });
  const { pane } = open(t, { tools: [long("first"), long("second")], active: [], rows: 20 });
  const top = (): string => screen(pane, WIDTH).find((line) => /^ {2}lines \d+-/.test(line))!.replace(/ of \d+$/, "");
  press(pane, KEY.enter, KEY.pageDown);
  assert.equal(top(), "  lines 11-21");
  press(pane, KEY.right);
  assert.match(screen(pane, WIDTH)[0]!, /^── second /);
  assert.equal(top(), "  lines 1-11");
  press(pane, KEY.pageDown, KEY.right);
  assert.equal(top(), "  lines 11-21", "nothing to step to: the view stays where it is");
  press(pane, KEY.left);
  assert.match(screen(pane, WIDTH)[0]!, /^── first /);
  assert.equal(top(), "  lines 1-11");
});

test("switching between the outline and the JSON starts each at its top", (t) => {
  const { pane } = open(t, { rows: 20 });
  const top = (): string => screen(pane, WIDTH).find((line) => /^ {2}lines \d+-/.test(line))!.replace(/ of \d+$/, "");
  press(pane, KEY.end, KEY.enter, KEY.pageDown, "v");
  assert.equal(screen(pane, WIDTH)[1], "  {");
  assert.equal(top(), "  lines 1-11");
  press(pane, KEY.pageDown, "v");
  assert.match(screen(pane, WIDTH)[1]!, /^ {2}State /);
  assert.equal(top(), "  lines 1-11");
});

test("stepping follows the list as filtered", (t) => {
  const { pane } = open(t, { filter: "issue" });
  press(pane, KEY.enter, KEY.right, KEY.right, KEY.right);
  assert.match(screen(pane, WIDTH)[0]!, /^── mcp__linear__save_issue /);
  const single = open(t, { filter: "bash" }).pane;
  press(single, KEY.enter);
  assert.doesNotMatch(hints(single, WIDTH), /previous\/next/);
});

// ---- loading ---------------------------------------------------------------------

test("l loads a deferred tool: it is active at once and the totals follow", (t) => {
  const { pane, registry } = open(t, {});
  press(pane, KEY.end);
  const before = summarize(buildCatalog(registry.snapshot())).chargedTokens;
  assert.match(hints(pane, WIDTH), / l load /);
  press(pane, "l");
  assert.deepEqual(registry.snapshot().active, [...ACTIVE, "mcp__linear__save_issue"]);
  const cost = totalTokens(findEntry(buildCatalog(registry.snapshot()), "mcp__linear__save_issue")!.cost);
  const lines = screen(pane, WIDTH);
  assert.match(lines[0]!, new RegExp(`all 8 {3}active 5 {3}inactive 3 .* ${tokenText(before + cost).replace(".", "\\.")} tok active`));
  assert.match(lines.find((line) => line.startsWith("▌"))!, /^▌ mcp__linear__save_issue +● active /);
  assert.equal(notice(pane), `Loaded mcp__linear__save_issue: declared to the model from the next request (${tokenText(cost)} tok).`);
  assert.match(hints(pane, WIDTH), / u unload /);
  assert.doesNotMatch(hints(pane, WIDTH), / l load /);
  press(pane, KEY.enter);
  assert.equal(screen(pane, WIDTH)[1], "  State   active · declared to the model with the next request");
  registry.request();
  t.mock.timers.tick(REFRESH_MS);
  assert.equal(screen(pane, WIDTH)[1], "  State   active · declared to the model");
});

test("u unloads a tool, a direct one included, and the notice goes with the next key", (t) => {
  const { pane, registry } = open(t, {});
  press(pane, "u");
  assert.deepEqual(registry.snapshot().active, ACTIVE.filter((name) => name !== "bash"));
  assert.match(screen(pane, WIDTH).find((line) => line.startsWith("▌"))!, /^▌ bash +○ off /);
  assert.equal(notice(pane), "Unloaded bash: dropped from the declarations with the next request.");
  press(pane, KEY.enter);
  assert.equal(notice(pane), null);
  assert.equal(screen(pane, WIDTH)[1], "  State   off · still declared to the model · dropped with the next request");
  press(pane, "l");
  assert.deepEqual(registry.snapshot().active, [...ACTIVE.filter((name) => name !== "bash"), "bash"]);
  assert.equal(screen(pane, WIDTH)[1], "  State   active · declared to the model");
});

test("a key that does not apply is not advertised, and explains itself when pressed", (t) => {
  const { pane, registry } = open(t, {});
  assert.doesNotMatch(hints(pane, WIDTH), / l load /);
  press(pane, "l");
  assert.equal(notice(pane), "bash is already active.");
  press(pane, KEY.down, "u");
  assert.equal(notice(pane), "grep is not active.");
  assert.deepEqual(registry.snapshot().active, ACTIVE);
});

test("a hidden tool can be neither loaded nor unloaded", (t) => {
  const { pane, registry } = open(t, { tools: [tool("secret", { exposure: "hidden" })], active: [] });
  assert.match(screen(pane, WIDTH)[3]!, /^▌ secret +– hidden /);
  assert.doesNotMatch(hints(pane, WIDTH), / (l load|u unload) /);
  press(pane, "l");
  assert.equal(notice(pane), "secret is hidden: pi does not activate hidden tools.");
  assert.deepEqual(registry.snapshot().active, []);
});

test("a tool pi will not activate stays as it was, and the pane says why", (t) => {
  const { pane, registry } = open(t, {});
  registry.refuse("mcp__linear__save_issue");
  press(pane, KEY.end, "l");
  assert.equal(notice(pane), "pi did not activate mcp__linear__save_issue: this session's --tools selection excludes it.");
  assert.match(screen(pane, WIDTH).find((line) => line.startsWith("▌"))!, /^▌ mcp__linear__save_issue +○ deferred /);
  assert.deepEqual(registry.snapshot().active, ACTIVE);
});

test("in the inactive tab a loaded tool leaves the list and the selection keeps its place", (t) => {
  const { pane } = open(t, {});
  press(pane, KEY.tab, KEY.tab, KEY.down, "l");
  assert.deepEqual(names(pane), ["grep", ">mcp__linear__get_issue", "mcp__linear__save_issue"]);
  assert.match(notice(pane)!, /^Loaded mcp__github__list_issues: /);
  press(pane, KEY.end, "l");
  assert.deepEqual(names(pane), ["grep", ">mcp__linear__get_issue"], "the last tool gone, the selection moves up");
});

test("a tool loaded from its detail view stays open after it left the tab; stepping goes on from its place", (t) => {
  const { pane } = open(t, {});
  press(pane, KEY.tab, KEY.tab, KEY.down, KEY.enter, "l");
  assert.match(screen(pane, WIDTH)[0]!, /^── mcp__github__list_issues ─+ ● active ──$/);
  assert.match(hints(pane, WIDTH), / u unload /);
  press(pane, KEY.right);
  assert.match(screen(pane, WIDTH)[0]!, /^── mcp__linear__get_issue /, "the tool that took its place is next");
  press(pane, KEY.left);
  assert.match(screen(pane, WIDTH)[0]!, /^── grep /);
  press(pane, KEY.esc);
  assert.deepEqual(names(pane), [">grep", "mcp__linear__get_issue", "mcp__linear__save_issue"]);
});

test("closing the detail of a tool that left the tab selects the tool in its place", (t) => {
  const { pane } = open(t, {});
  press(pane, KEY.tab, KEY.tab, KEY.down, KEY.enter, "l", KEY.esc);
  assert.deepEqual(names(pane), ["grep", ">mcp__linear__get_issue", "mcp__linear__save_issue"]);
});

// ---- refresh ---------------------------------------------------------------------

test("the pane reads the registry again once a second", (t) => {
  assert.equal(REFRESH_MS, 1000);
  const { pane, registry, renders } = open(t, {});
  registry.register(mcpTool("github", "create_issue", { description: "Create an issue" }));
  registry.setActive([...registry.snapshot().active, "grep"]);
  t.mock.timers.tick(REFRESH_MS - 1);
  assert.match(screen(pane, WIDTH)[0]!, /all 8 {3}active 4 {3}inactive 4 /, "not before the interval has passed");
  assert.equal(renders(), 0);
  t.mock.timers.tick(1);
  assert.match(screen(pane, WIDTH)[0]!, /all 9 {3}active 5 {3}inactive 4 /);
  assert.ok(names(pane).includes("mcp__github__create_issue"));
  assert.equal(renders(), 1, "a refresh asks for a repaint");
  assert.equal(selected(pane), "bash", "the selection stays on its tool");
});

test("a selected tool that is gone hands the selection to the tool in its place", (t) => {
  const { pane, registry } = open(t, {});
  press(pane, KEY.down);
  registry.unregister("grep");
  t.mock.timers.tick(REFRESH_MS);
  assert.equal(selected(pane), "read");
  assert.equal(notice(pane), null);
});

test("an open tool that is gone returns to the list with a notice", (t) => {
  const { pane, registry } = open(t, {});
  press(pane, KEY.down, KEY.enter);
  registry.unregister("grep");
  t.mock.timers.tick(REFRESH_MS);
  assert.match(screen(pane, WIDTH)[0]!, /^── Tools /);
  assert.equal(notice(pane), "grep is no longer registered.");
  assert.equal(selected(pane), "read");
});

test("a session that can no longer be read keeps the last list, says so once and stops refreshing", (t) => {
  const registry = new InMemoryToolRegistry({ tools: TOOLS, active: ACTIVE, promptLines: new Map(), model: null });
  let reads = 0;
  let stale = false;
  const failing: ToolRegistry = {
    snapshot: () => {
      reads += 1;
      if (stale) throw new Error("This extension ctx is stale\u001b[2J");
      return registry.snapshot();
    },
    setActive: (activeNames) => registry.setActive(activeNames),
  };
  const { pane } = paneOver(t, failing, DEFAULTS);
  stale = true;
  t.mock.timers.tick(REFRESH_MS);
  assert.equal(names(pane).length, 8);
  assert.equal(notice(pane), "The tools can no longer be read: This extension ctx is stale\\u001b[2J");
  const readsAfterFailure = reads;
  t.mock.timers.tick(10 * REFRESH_MS);
  assert.equal(reads, readsAfterFailure);
  press(pane, "u");
  assert.match(notice(pane)!, /^The active tools could not be changed: This extension ctx is stale/);
});

test("a disposed pane no longer reads the registry", (t) => {
  let reads = 0;
  const registry = new InMemoryToolRegistry({ tools: TOOLS, active: ACTIVE, promptLines: new Map(), model: null });
  const counting: ToolRegistry = { snapshot: () => { reads += 1; return registry.snapshot(); }, setActive: (activeNames) => registry.setActive(activeNames) };
  const { pane } = paneOver(t, counting, DEFAULTS);
  t.mock.timers.tick(REFRESH_MS);
  assert.equal(reads, 2, "once to open, once to refresh");
  pane.dispose();
  t.mock.timers.tick(10 * REFRESH_MS);
  assert.equal(reads, 2);
});

// ---- geometry and safety ---------------------------------------------------------

test("every view fits the pane at any width", (t) => {
  const { pane } = open(t, { theme: TAG_THEME, tools: [...TOOLS, tool(HOSTILE, { description: HOSTILE.repeat(5) })] });
  const steps: [string, () => void][] = [
    ["list", () => {}],
    ["flat list", () => press(pane, "s")],
    ["filter being typed", () => { press(pane, "/"); type(pane, "issue of some length"); }],
    ["kept filter", () => { press(pane, KEY.backspace.repeat(1)); press(pane, KEY.enter); }],
    ["empty list", () => { press(pane, "/"); type(pane, "zzz"); press(pane, KEY.enter); }],
    ["detail", () => { press(pane, KEY.esc, KEY.end, KEY.enter); }],
    ["notice", () => press(pane, "l")],
    ["JSON", () => press(pane, "v")],
  ];
  for (const [view, enter] of steps) {
    enter();
    // The kit's list row is never narrower than its selection marker.
    for (let width = 2; width <= 170; width++) assertFits(pane.render(width), width, view);
  }
});

test("hostile tool text never reaches the terminal from any view", (t) => {
  const hostile = mcpTool(HOSTILE, HOSTILE, { description: HOSTILE, namespace: { name: `mcp__${HOSTILE}`, description: HOSTILE } });
  const { pane, registry } = open(t, { theme: TAG_THEME, tools: [hostile], active: [] });
  const check = (view: string): void => { for (const width of [40, 100, 160]) assertInert(pane.render(width), `${view} at ${width}`); };
  check("list");
  press(pane, "s");
  check("flat list");
  press(pane, "l");
  check("loaded notice");
  press(pane, KEY.enter);
  check("detail");
  press(pane, "v");
  check("JSON");
  registry.unregister(hostile.name);
  t.mock.timers.tick(REFRESH_MS);
  check("gone notice");
  assert.match(notice(pane)!, /is no longer registered\.$/);
});

test("with a height from pi's layout the list fills it and regrows after a resize", (t) => {
  const many = Array.from({ length: 60 }, (_unused, index) => tool(`tool_${String(index).padStart(2, "0")}`, {}));
  const { pane } = open(t, { tools: many, active: [], rows: 40 });
  const root = new VStack([
    { component: { render: () => ["chat"], invalidate() {} }, basis: 0, grow: 1 },
    { component: pane, grow: 0 },
    { component: { render: () => ["status"], invalidate() {} }, shrink: 0 },
  ]);
  const frame = (height: number): string[] => {
    renderLayoutFrame(root, WIDTH, height, () => {});
    return plain(renderLayoutFrame(root, WIDTH, height, () => {}).lines);
  };
  const toolRows = (lines: readonly string[]): string[] => lines.filter((line) => /^[▌ ] tool_\d\d /.test(line));
  const small = frame(14);
  assert.equal(small[small.length - 1], "status");
  assert.equal(small.filter((line) => line.startsWith("── Tools")).length, 1);
  // 14 rows less the status line, the title, the rule and the hints leave the column header and 9 list lines.
  assert.equal(toolRows(small).length, 8, "a heading and eight tools");
  press(pane, KEY.pageDown);
  assert.match(toolRows(frame(14)).find((line) => line.startsWith("▌"))!, /^▌ tool_08 /, "a page is the window less one line");
  const large = frame(30);
  assert.ok(toolRows(large).length > toolRows(small).length);
  assert.equal(large[large.length - 1], "status");
});

// regression: found in a real pi terminal, where a ten-line detail kept a nine-line body and a position line.
test("a detail that fits the height pi gives the pane is shown whole, without a position line", (t) => {
  const { pane } = open(t, { filter: "bash", rows: 40 });
  const root = new VStack([
    { component: { render: () => ["chat"], invalidate() {} }, basis: 0, grow: 1 },
    { component: pane, grow: 0 },
    { component: { render: () => ["status"], invalidate() {} }, shrink: 0 },
  ]);
  /** A few frames: pi draws again whenever a layout pass changed the body's height. */
  const settled = (): string[] => {
    for (let frame = 0; frame < 4; frame++) renderLayoutFrame(root, WIDTH, 40, () => {});
    return plain(renderLayoutFrame(root, WIDTH, 40, () => {}).lines);
  };
  assert.ok(settled().some((line) => /^▌ bash /.test(line)));
  press(pane, KEY.enter);
  const detail = settled();
  const title = detail.findIndex((line) => line.startsWith("── bash "));
  assert.notEqual(title, -1, detail.join("\n"));
  const shown = detail.slice(title, detail.indexOf("status"));
  assert.equal(shown.some((line) => /^ {2}lines \d+-\d+ of \d+$/.test(line)), false, shown.join("\n"));
  assert.ok(shown.includes("    The tool takes no parameters."), "the last line of the detail is on screen");
  assert.equal(shown[shown.length - 2], "─".repeat(WIDTH));
});

test("a detail longer than the height pi gives the pane keeps its position line, and the body fills the rest", (t) => {
  const { pane } = open(t, { filter: "save_issue", rows: 40 });
  const root = new VStack([
    { component: { render: () => ["chat"], invalidate() {} }, basis: 0, grow: 1 },
    { component: pane, grow: 0 },
    { component: { render: () => ["status"], invalidate() {} }, shrink: 0 },
  ]);
  const settled = (): string[] => {
    for (let frame = 0; frame < 4; frame++) renderLayoutFrame(root, WIDTH, 20, () => {});
    return plain(renderLayoutFrame(root, WIDTH, 20, () => {}).lines);
  };
  settled();
  press(pane, KEY.enter);
  const detail = settled();
  // 20 rows less the status line: the title, 15 lines of text, the position line, the rule and the hints.
  assert.equal(detail.length, 20);
  assert.match(detail[0]!, /^── mcp__linear__save_issue /);
  assert.match(detail[16]!, /^ {2}lines 1-15 of \d+$/);
  assert.equal(detail[17], "─".repeat(WIDTH));
  assert.equal(detail[19], "status");
});

test("the wheel moves the selection in the list and scrolls the detail", (t) => {
  const { pane } = open(t, { rows: 20 });
  const wheel = (delta: number): TuiMouseEvent => ({ type: "wheel", wheelDelta: delta, x: 0, y: 0, screenX: 0, screenY: 0, width: WIDTH, height: 20 }) as TuiMouseEvent;
  assert.equal(pane.handleMouse(wheel(3))?.handled, true);
  assert.equal(selected(pane), "bg_task");
  pane.handleMouse(wheel(-1));
  assert.equal(selected(pane), "read");
  press(pane, KEY.end, KEY.enter);
  pane.handleMouse(wheel(3));
  assert.ok(screen(pane, WIDTH).some((line) => /^ {2}lines 4-14 of /.test(line)));
  assert.equal(pane.handleMouse({ ...wheel(0), type: "press" } as TuiMouseEvent), undefined, "other mouse events are not the pane's");
});
