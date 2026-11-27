import assert from "node:assert/strict";
import test from "node:test";
import { buildCatalog, canLoad, canUnload, findEntry, isActive, isCharged, totalTokens, type ToolCatalog, type ToolEntry } from "../src/catalog.ts";
import type { PromptLines, RegistrySnapshot, ToolDeclaration } from "../src/registry.ts";
import { declarationTokens, promptLineTokens } from "../src/tokens.ts";
import { declared, declarationOf, extensionFile, mcpTool, snapshot, tool } from "./fixtures.ts";

const READ = tool("read", {});
const GREP = tool("grep", {});
const SEARCH = tool("tool_search", { exposure: "model-only", reachesOtherTools: true });
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

test("only inactive tools that tool search could load can be loaded, and only those unloaded", () => {
  const catalog = catalogOf({ active: ["read", "mcp__docs__lookup"] });
  const loadable = catalog.entries.filter(canLoad).map((item) => item.name);
  const unloadable = catalog.entries.filter(canUnload).map((item) => item.name);
  assert.deepEqual(loadable, ["mcp__linear__save_issue"]);
  assert.deepEqual(unloadable, ["mcp__docs__lookup"]);
});

test("cost is the declaration plus the prompt lines the tool adds", () => {
  const lines: PromptLines = { snippet: "Read file contents", guidelines: ["Use read instead of cat."] };
  const catalog = catalogOf({ active: ["read"], promptLines: new Map([["read", lines]]) });
  const read = entry(catalog, "read");
  assert.deepEqual(read.cost, { declaration: declarationTokens(declarationOf(READ)), promptLines: promptLineTokens("read", lines) });
  assert.equal(totalTokens(read.cost), read.cost.declaration + read.cost.promptLines);
  assert.deepEqual(read.promptLines, lines);
  assert.deepEqual(entry(catalog, "grep").cost, { declaration: declarationTokens(declarationOf(GREP)), promptLines: 0 });
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
  assert.equal(read.cost.declaration, declarationTokens(rewritten));
  assert.equal(entry(catalog, "tool_search").differsFromRegistered, false, "the same text and schema is not a difference");
});

test("a tool that is no longer active is shown as registered, even while the transcript still has it", () => {
  const stale: ToolDeclaration = { ...declarationOf(GREP), description: "An older description" };
  const grep = entry(catalogOf({ declared: new Map([["grep", stale]]) }), "grep");
  assert.equal(grep.definition.description, GREP.description);
  assert.equal(grep.differsFromRegistered, false);
});

test("an entry keeps its source, namespace, hints and provenance", () => {
  const catalog = catalogOf({ contextWindow: 200_000 });
  const issue = entry(catalog, "mcp__linear__save_issue");
  assert.deepEqual(issue.origin, { kind: "mcp", label: "mcp · linear" });
  assert.deepEqual(issue.namespace, { name: "mcp__linear", description: null });
  assert.deepEqual(issue.hints, { readOnly: false, destructive: false, idempotent: true, openWorld: null });
  assert.equal(issue.provenance.path, "builtin:mcp");
  assert.equal(entry(catalog, "tool_search").reachesOtherTools, true);
  assert.deepEqual(entry(catalog, "secret").origin, { kind: "extension", label: "secret" });
  assert.equal(catalog.contextWindow, 200_000);
});
