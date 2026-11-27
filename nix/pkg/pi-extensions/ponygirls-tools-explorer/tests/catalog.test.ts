import assert from "node:assert/strict";
import test from "node:test";
import { buildCatalog, canLoad, canUnload, findEntry, isActive, isCharged, totalTokens, type ToolCatalog, type ToolEntry } from "../src/catalog.ts";
import type { PromptLines, RegistrySnapshot, ToolDeclaration } from "../src/registry.ts";
import { PI_BASIS, basisFor, declarationTokens, promptLineTokens } from "../src/tokens.ts";
import { declared, declarationOf, extensionFile, mcpTool, snapshot, tool } from "./fixtures.ts";

const READ = tool("read", {});
const GREP = tool("grep", {});
const SEARCH = tool("tool_search", { exposure: "model-only" });
const ISSUE = mcpTool("linear", "save_issue", { hints: { readOnly: false, destructive: false, idempotent: true, openWorld: null } });
const SCRIPTED = mcpTool("docs", "lookup", { exposure: "codemode" });
const SECRET = tool("secret", { exposure: "hidden", provenance: extensionFile("/x/secret.ts") });
const ALL = [READ, GREP, SEARCH, ISSUE, SCRIPTED, SECRET];

function entry(catalog: ToolCatalog, name: string): ToolEntry {
  const found = findEntry(catalog, name);
  assert.ok(found, `${name} is in the catalog`);
  return found;
}

function catalogOf(overrides: Partial<Omit<RegistrySnapshot, "tools">>): ToolCatalog {
  return buildCatalog(snapshot(ALL, overrides));
}

test("every registered tool is an entry, whatever its exposure", () => {
  const catalog = catalogOf({});
  assert.deepEqual(catalog.entries.map((item) => item.name), ALL.map((item) => item.name));
  assert.equal(findEntry(catalog, "absent"), null);
});

test("state says whether the model has the tool and how it could get it", () => {
  const catalog = catalogOf({ active: ["read", "tool_search"] });
  assert.deepEqual(Object.fromEntries(catalog.entries.map((item) => [item.name, item.state])), {
    read: "active",
    grep: "off",
    tool_search: "active",
    mcp__linear__save_issue: "deferred",
    mcp__docs__lookup: "codemode",
    secret: "hidden",
  });
});

test("an active tool whose declaration is withheld is indirect: active, not charged", () => {
  const catalog = catalogOf({ active: ["read", "mcp__docs__lookup"], withheld: ["read"] });
  const read = entry(catalog, "read");
  assert.equal(read.state, "indirect");
  assert.equal(read.delivery, "withheld");
  assert.equal(isActive(read), true);
  assert.equal(isCharged(read), false);
  assert.equal(isCharged(entry(catalog, "mcp__docs__lookup")), true);
});

test("delivery compares the active set with what the transcript has declared", () => {
  const catalog = catalogOf({ active: ["read", "mcp__linear__save_issue"], declared: declared([READ, GREP]) });
  assert.equal(entry(catalog, "read").delivery, "declared");
  assert.equal(entry(catalog, "mcp__linear__save_issue").delivery, "next-request");
  assert.equal(entry(catalog, "grep").delivery, "removal-pending");
  assert.equal(entry(catalog, "mcp__docs__lookup").delivery, "none");
});

test("every inactive tool can be loaded except a hidden one, and every active tool unloaded", () => {
  const catalog = catalogOf({ active: ["read", "mcp__docs__lookup"], withheld: ["read"] });
  const loadable = catalog.entries.filter(canLoad).map((item) => item.name);
  const unloadable = catalog.entries.filter(canUnload).map((item) => item.name);
  assert.deepEqual(loadable, ["grep", "tool_search", "mcp__linear__save_issue"]);
  assert.deepEqual(unloadable, ["read", "mcp__docs__lookup"], "a withheld tool is active, so it can be unloaded");
  for (const item of catalog.entries) assert.equal(canLoad(item) && canUnload(item), false, item.name);
});

test("cost is the declaration plus the prompt lines the tool adds", () => {
  const lines: PromptLines = { snippet: "Read file contents", guidelines: ["Use read instead of cat."] };
  const catalog = catalogOf({ active: ["read"], promptLines: new Map([["read", lines]]) });
  const read = entry(catalog, "read");
  assert.deepEqual(read.cost, { declaration: declarationTokens(declarationOf(READ), PI_BASIS), promptLines: promptLineTokens("read", lines, PI_BASIS) });
  assert.equal(totalTokens(read.cost), read.cost.declaration + read.cost.promptLines);
  assert.deepEqual(read.promptLines, lines);
  assert.deepEqual(entry(catalog, "grep").cost, { declaration: declarationTokens(declarationOf(GREP), PI_BASIS), promptLines: 0 });
});

test("prompt lines cost nothing when a custom system prompt leaves them out", () => {
  const lines: PromptLines = { snippet: "Read file contents", guidelines: ["Use read instead of cat."] };
  const catalog = catalogOf({ active: ["read"], promptLines: new Map([["read", lines]]), promptLinesSent: false });
  assert.equal(entry(catalog, "read").cost.promptLines, 0);
  assert.deepEqual(entry(catalog, "read").promptLines, lines, "the lines are still part of the definition");
});

test("a declared tool is shown and measured as the model has it", () => {
  const rewritten: ToolDeclaration = { ...declarationOf(READ), description: `${READ.description}\n\nCall it from scripts as tools.read().` };
  const catalog = catalogOf({ active: ["read", "tool_search"], declared: new Map([["read", rewritten], ["tool_search", declarationOf(SEARCH)]]) });
  const read = entry(catalog, "read");
  assert.equal(read.definition, rewritten);
  assert.equal(read.differsFromRegistered, true);
  assert.equal(read.cost.declaration, declarationTokens(rewritten, PI_BASIS));
  assert.equal(entry(catalog, "tool_search").differsFromRegistered, false, "the same text and schema is not a difference");
});

test("a tool that is no longer active is shown as registered, even while the transcript still has it", () => {
  const stale: ToolDeclaration = { ...declarationOf(GREP), description: "An older description" };
  const grep = entry(catalogOf({ declared: new Map([["grep", stale]]) }), "grep");
  assert.equal(grep.definition.description, GREP.description);
  assert.equal(grep.differsFromRegistered, false);
});

test("an entry keeps its source, namespace, hints and provenance", () => {
  const catalog = catalogOf({ model: { id: "scripted", contextWindow: 200_000 } });
  const issue = entry(catalog, "mcp__linear__save_issue");
  assert.deepEqual(issue.origin, { kind: "mcp", name: "linear" });
  assert.deepEqual(issue.namespace, { name: "mcp__linear", description: null });
  assert.deepEqual(issue.hints, { readOnly: false, destructive: false, idempotent: true, openWorld: null });
  assert.equal(issue.provenance.path, "builtin:mcp");
  assert.deepEqual(entry(catalog, "secret").origin, { kind: "extension", name: "secret" });
  assert.deepEqual(catalog.model, { id: "scripted", contextWindow: 200_000 });
});

test("the catalog knows which of pi's two reaching tools the model has", () => {
  const search = tool("tool_search", { exposure: "model-only", reachesOtherTools: true });
  const scripts = tool("codemode", { exposure: "model-only", reachesOtherTools: true });
  const reach = (active: readonly string[], withheld: readonly string[]) => buildCatalog(snapshot([search, scripts, READ], { active, withheld })).reach;
  assert.deepEqual(reach(["tool_search", "codemode"], []), { toolSearch: true, codemode: true });
  assert.deepEqual(reach(["tool_search"], []), { toolSearch: true, codemode: false });
  assert.deepEqual(reach(["read"], []), { toolSearch: false, codemode: false }, "registered is not enough: the model has to have it");
  assert.deepEqual(reach(["tool_search", "codemode"], ["tool_search"]), { toolSearch: false, codemode: true }, "nor is active with its declaration withheld");
  assert.deepEqual(buildCatalog(snapshot([READ], { active: ["read"] })).reach, { toolSearch: false, codemode: false });
  // pi's own rule: a tool of that name reaches other tools only if it declares that it does.
  const namesake = tool("tool_search", { description: "Searches the web for tools to buy" });
  assert.deepEqual(buildCatalog(snapshot([namesake, scripts], { active: ["tool_search", "codemode"] })).reach, { toolSearch: false, codemode: true });
});

test("costs use the token ratios measured for the model's family, and pi's rule otherwise", () => {
  const lines: PromptLines = { snippet: "Read file contents", guidelines: ["Use read instead of cat."] };
  const promptLines = new Map([["read", lines]]);
  const claude = catalogOf({ active: ["read"], promptLines, model: { id: "claude-haiku-5-5", contextWindow: 1_000_000 } });
  const measured = basisFor("claude-haiku-5-5");
  assert.equal(measured.measuredFor, "Claude");
  assert.equal(claude.basis, measured);
  assert.deepEqual(entry(claude, "read").cost, {
    declaration: declarationTokens(declarationOf(READ), measured),
    promptLines: promptLineTokens("read", lines, measured),
  });
  for (const model of [null, { id: "kimi-k2.6", contextWindow: 1_000_000 }]) {
    const other = catalogOf({ active: ["read"], promptLines, model });
    assert.equal(other.basis, PI_BASIS);
    assert.equal(entry(other, "read").cost.declaration, declarationTokens(declarationOf(READ), PI_BASIS));
  }
  assert.ok(entry(claude, "read").cost.declaration > entry(catalogOf({ active: ["read"] }), "read").cost.declaration);
  assert.equal(catalogOf({}).model, null);
});
