import assert from "node:assert/strict";
import test from "node:test";
import { buildCatalog, findEntry, type ToolEntry } from "../src/catalog.ts";
import {
  activationNotice, basisLine, basisText, budgetText, costFacts, hintFacts, shareText, sourceFacts, sourceFactsOf, stateFacts, stateLabel, stateTone,
  tabCount, tabLabel, tokenText,
} from "../src/present.ts";
import { summarize, type SourceSummary } from "../src/query.ts";
import type { PromptLines, RegisteredTool, RegistrySnapshot, SessionModel } from "../src/registry.ts";
import { PI_BASIS, basisFor } from "../src/tokens.ts";
import { declared, extensionFile, mcpTool, snapshot, tool } from "./fixtures.ts";

const CLAUDE: SessionModel = { id: "claude-haiku-5-5", contextWindow: 1_000_000 };
const OTHER: SessionModel = { id: "kimi-k2.6", contextWindow: 200_000 };

function entryOf(registered: RegisteredTool, overrides: Partial<Omit<RegistrySnapshot, "tools">>): ToolEntry {
  const entry = findEntry(buildCatalog(snapshot([registered], overrides)), registered.name);
  assert.ok(entry);
  return entry;
}

function source(tools: number, active: number, chargedTokens: number, allTokens: number): SourceSummary {
  return { origin: { kind: "extension", name: "x" }, tools, active, chargedTokens, allTokens };
}

test("a state reads as a glyph and its name; only active states are on", () => {
  assert.deepEqual(["active", "indirect", "deferred", "codemode", "off", "hidden"].map((state) => stateLabel(state as ToolEntry["state"])),
    ["● active", "◐ indirect", "○ deferred", "○ codemode", "○ off", "– hidden"]);
  assert.equal(stateTone(entryOf(tool("read", {}), { active: ["read"] })), "ok");
  assert.equal(stateTone(entryOf(tool("read", {}), { active: ["read"], withheld: ["read"] })), "ok");
  assert.equal(stateTone(entryOf(tool("read", {}), {})), "settled");
  assert.equal(stateTone(entryOf(tool("read", { exposure: "hidden" }), {})), "settled");
});

test("token amounts are marked as estimates and kept to three digits", () => {
  assert.equal(tokenText(0), "~0");
  assert.equal(tokenText(836), "~836");
  assert.equal(tokenText(2319), "~2.32k");
  assert.equal(tokenText(11_842), "~11.8k");
  assert.equal(tokenText(1_500_000), "~1.5M");
});

test("a share of the context window is a percentage of the window's size", () => {
  assert.equal(shareText(0.0118, CLAUDE), "1.2% of 1M");
  assert.equal(shareText(0.25, OTHER), "25.0% of 200k");
  assert.equal(shareText(0, CLAUDE), "0.0% of 1M");
  assert.equal(shareText(0.0004, CLAUDE), "<0.1% of 1M", "a small share is not shown as nothing");
});

test("tabs are labelled with their counts", () => {
  const summary = summarize(buildCatalog(snapshot([tool("a", {}), tool("b", {}), tool("c", {})], { active: ["a"] })));
  assert.deepEqual(["all", "active", "inactive"].map((tab) => tabCount(summary, tab as "all")), [3, 1, 2]);
  assert.equal(tabLabel(summary, "inactive"), "inactive 2");
});

test("a source line says how many tools are active and what they cost", () => {
  assert.equal(sourceFacts(source(7, 4, 836, 1400)), "7 tools · 4 active · ~836 of ~1.4k tok");
  assert.equal(sourceFacts(source(8, 8, 4431, 4431)), "8 tools · all active · ~4.43k tok");
  assert.equal(sourceFacts(source(1, 1, 676, 676)), "1 tool · active · ~676 tok");
  assert.equal(sourceFacts(source(84, 0, 0, 29_373)), "84 tools · none active · ~29.4k tok if loaded");
  assert.equal(sourceFacts(source(1, 0, 0, 500)), "1 tool · none active · ~500 tok if loaded");
  assert.equal(sourceFacts(source(2, 2, 100, 300)), "2 tools · all active · ~100 of ~300 tok", "active but partly withheld");
});

test("the state fact says whether the model has the tool and what would change that", () => {
  const read = tool("read", {});
  assert.deepEqual(stateFacts(entryOf(read, { active: ["read"], declared: declared([read]) })), ["active", "declared to the model"]);
  assert.deepEqual(stateFacts(entryOf(read, { active: ["read"] })), ["active", "declared to the model with the next request"]);
  assert.deepEqual(stateFacts(entryOf(read, { active: ["read"], withheld: ["read"] })), ["indirect", "active, but another tool keeps its declaration out of requests"]);
  assert.deepEqual(stateFacts(entryOf(read, {})), ["off", "not declared to the model"]);
  assert.deepEqual(stateFacts(entryOf(mcpTool("s", "t", {}), {})), ["deferred", "not declared to the model", "tool_search can load it"]);
  assert.deepEqual(stateFacts(entryOf(mcpTool("s", "t", { exposure: "codemode" }), {})), ["codemode", "not declared to the model", "callable from codemode scripts"]);
  assert.deepEqual(stateFacts(entryOf(tool("x", { exposure: "hidden" }), {})), ["hidden", "never declared: pi does not activate hidden tools"]);
});

test("an unloaded tool the transcript still declares says so", () => {
  const issue = mcpTool("linear", "save_issue", {});
  assert.deepEqual(stateFacts(entryOf(issue, { declared: declared([issue]) })), ["deferred", "still declared to the model", "dropped with the next request"]);
  const read = tool("read", {});
  assert.deepEqual(stateFacts(entryOf(read, { declared: declared([read]) })), ["off", "still declared to the model", "dropped with the next request"]);
});

test("the source fact names the kind of source first and the recorded path last", () => {
  const home = "/home/u";
  assert.deepEqual(sourceFactsOf(entryOf(tool("read", {}), {}), home), ["built into pi", "builtin:read"]);
  assert.deepEqual(sourceFactsOf(entryOf(mcpTool("linear", "save_issue", {}), {}), home), ["MCP server linear", "registered by builtin:mcp"]);
  assert.deepEqual(sourceFactsOf(entryOf(mcpTool("docs", "lookup", { namespace: { name: "mcp__docs", description: "Product documentation" } }), {}), home),
    ["MCP server docs", "Product documentation", "registered by builtin:mcp"]);
  assert.deepEqual(sourceFactsOf(entryOf(tool("quick", { provenance: extensionFile("/home/u/.pi/agent/extensions/quick.ts") }), {}), home),
    ["extension quick", "user scope", "~/.pi/agent/extensions/quick.ts"]);
  const packaged = tool("web_search", { provenance: { path: "/opt/hub/extensions/hub.ts", source: "/opt/hub", scope: "project", origin: "package", baseDir: "/opt/hub" } });
  assert.deepEqual(sourceFactsOf(entryOf(packaged, {}), home), ["package hub", "project scope", "/opt/hub/extensions/hub.ts"]);
  const sdk = tool("probe", { provenance: { path: "<sdk:probe>", source: "sdk", scope: "temporary", origin: "top-level", baseDir: null } });
  assert.deepEqual(sourceFactsOf(entryOf(sdk, {}), home), ["passed in through the SDK", "<sdk:probe>"]);
});

test("the cost fact gives the estimate, its parts with their ratios, and where the ratios come from", () => {
  const lines: PromptLines = { snippet: "Read file contents", guidelines: ["Use read instead of cat."] };
  const read = tool("read", {});
  const active = entryOf(read, { active: ["read"], promptLines: new Map([["read", lines]]), model: CLAUDE });
  assert.deepEqual(costFacts(active, basisFor(CLAUDE.id), CLAUDE), [
    tokenText(active.cost.declaration + active.cost.promptLines),
    `declaration ${tokenText(active.cost.declaration)} at 2.7 characters per token`,
    `prompt lines ${tokenText(active.cost.promptLines)} at 3.1`,
    "measured for Claude models",
  ]);
  const inactive = entryOf(read, { model: OTHER });
  assert.deepEqual(costFacts(inactive, PI_BASIS, OTHER), [
    `${tokenText(inactive.cost.declaration)} if loaded`,
    `declaration ${tokenText(inactive.cost.declaration)} at 4 characters per token`,
    "no prompt lines",
    "pi's rule: nothing measured for kimi-k2.6",
  ]);
});

test("the cost fact says when a tool is not charged, and why", () => {
  const lines: PromptLines = { snippet: "Read file contents", guidelines: [] };
  const read = tool("read", {});
  const withheld = costFacts(entryOf(read, { active: ["read"], withheld: ["read"] }), PI_BASIS, null);
  assert.match(withheld[0]!, /^~\d+, not charged while its declaration is withheld$/);
  assert.equal(withheld[3], "pi's rule: no model is selected");
  assert.match(costFacts(entryOf(tool("x", { exposure: "hidden" }), {}), PI_BASIS, null)[0]!, /^~\d+, never charged$/);
  const custom = costFacts(entryOf(read, { active: ["read"], promptLines: new Map([["read", lines]]), promptLinesSent: false }), PI_BASIS, null);
  assert.equal(custom[2], "prompt lines not sent");
});

test("the basis is named by the model family it was measured for, or says why pi's rule applies", () => {
  assert.equal(basisText(basisFor(CLAUDE.id), CLAUDE), "measured for Claude models");
  assert.equal(basisText(basisFor("gpt-6.2"), { id: "gpt-6.2", contextWindow: 400_000 }), "measured for GPT models");
  assert.equal(basisText(PI_BASIS, OTHER), "pi's rule: nothing measured for kimi-k2.6");
  assert.equal(basisText(PI_BASIS, null), "pi's rule: no model is selected");
  assert.equal(basisText(PI_BASIS, { id: "evil\u001b[2J", contextWindow: 1 }), "pi's rule: nothing measured for evil\\u001b[2J");
  assert.equal(basisLine(basisFor(CLAUDE.id), CLAUDE), "Estimates: 2.7 characters per token for declarations, 3.1 for prompt lines; measured for Claude models.");
  assert.equal(basisLine(PI_BASIS, OTHER), "Estimates: 4 characters per token; pi's rule: nothing measured for kimi-k2.6.");
});

test("hints are worded for both answers and left out when unstated", () => {
  const hinted = (hints: RegisteredTool["hints"]): string[] | null => hintFacts(entryOf(tool("t", { hints }), {}));
  assert.equal(hinted(null), null);
  assert.equal(hinted({ readOnly: null, destructive: null, idempotent: null, openWorld: null }), null);
  assert.deepEqual(hinted({ readOnly: true, destructive: null, idempotent: null, openWorld: null }), ["read-only", "stated by its author, unverified"]);
  assert.deepEqual(hinted({ readOnly: false, destructive: true, idempotent: false, openWorld: true }),
    ["writes", "destructive", "not idempotent", "open world", "stated by its author, unverified"]);
  assert.deepEqual(hinted({ readOnly: false, destructive: false, idempotent: true, openWorld: false }),
    ["writes", "not destructive", "idempotent", "closed world", "stated by its author, unverified"]);
});

test("a change of the active set is reported with what happens next", () => {
  const issue = mcpTool("linear", "save_issue", {});
  const loaded = entryOf(issue, { active: [issue.name] });
  assert.deepEqual(activationNotice({ kind: "loaded", entry: loaded }), {
    text: `Loaded mcp__linear__save_issue: declared to the model from the next request (${tokenText(loaded.cost.declaration)} tok).`, state: "ok",
  });
  const unloaded = entryOf(issue, { declared: declared([issue]) });
  assert.deepEqual(activationNotice({ kind: "unloaded", entry: unloaded }), {
    text: "Unloaded mcp__linear__save_issue: dropped from the declarations with the next request.", state: "ok",
  });
});

test("a change the model never sees is reported as such", () => {
  const issue = mcpTool("linear", "save_issue", {});
  // Unloaded and loaded again between two requests: the transcript declared it all along.
  const reloaded = entryOf(issue, { active: [issue.name], declared: declared([issue]) });
  assert.equal(activationNotice({ kind: "loaded", entry: reloaded }).text, `Loaded mcp__linear__save_issue: still declared to the model (${tokenText(reloaded.cost.declaration)} tok).`);
  // Loaded and unloaded again between two requests: it was never declared.
  const neverDeclared = entryOf(issue, {});
  assert.equal(activationNotice({ kind: "unloaded", entry: neverDeclared }).text, "Unloaded mcp__linear__save_issue: it had not been declared to the model yet.");
  const withheld = entryOf(issue, { active: [issue.name], withheld: [issue.name] });
  assert.equal(activationNotice({ kind: "loaded", entry: withheld }).text, "Loaded mcp__linear__save_issue: active, but another tool keeps its declaration out of requests.");
});

test("a refusal says what stood in the way", () => {
  const refused = (reason: "unknown-tool" | "hidden" | "already-active" | "not-active" | "not-activated" | "not-deactivated"): string => {
    const notice = activationNotice({ kind: "refused", name: "x", reason });
    assert.equal(notice.state, "attention");
    return notice.text;
  };
  assert.equal(refused("unknown-tool"), "x is no longer registered.");
  assert.equal(refused("hidden"), "x is hidden: pi does not activate hidden tools.");
  assert.equal(refused("already-active"), "x is already active.");
  assert.equal(refused("not-active"), "x is not active.");
  assert.equal(refused("not-activated"), "pi did not activate x: this session's --tools selection excludes it.");
  assert.equal(refused("not-deactivated"), "pi kept x active.");
});

test("names in notices are made safe to draw", () => {
  assert.equal(activationNotice({ kind: "refused", name: "evil\u001b[2J", reason: "not-active" }).text, "evil\\u001b[2J is not active.");
});

test("the budget is the charged estimate and its share of the window, when there is a model", () => {
  const tools = [tool("a", {}), tool("b", {})];
  const summary = (model: SessionModel | null) => summarize(buildCatalog(snapshot(tools, { active: ["a"], model })));
  const withModel = summary(OTHER);
  assert.deepEqual(budgetText(withModel, OTHER), { tokens: `${tokenText(withModel.chargedTokens)} tok active`, share: shareText(withModel.windowShare!, OTHER) });
  assert.deepEqual(budgetText(summary(null), null), { tokens: `${tokenText(summary(null).chargedTokens)} tok active`, share: null });
});
