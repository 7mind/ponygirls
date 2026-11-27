import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { getCurrentTools } from "@earendil-works/pi-ai";
import { estimateTokens as piEstimateTokens, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { ToolActivation } from "../src/activation.ts";
import { buildCatalog, findEntry, isCharged } from "../src/catalog.ts";
import { PiToolRegistry } from "../src/pi-registry.ts";
import type { JsonSchema } from "../src/registry.ts";
import { PI_BASIS, declarationTokens, promptLineText } from "../src/tokens.ts";
import { SCRIPTED_CONTEXT_WINDOW, SCRIPTED_MODEL, requestedTools, startPiSession, type PiSession } from "./pi-session.ts";
import { PROBED, registerProbes } from "./probes.ts";
import { CONTRACT_MODEL, registryContract } from "./registry-contract.ts";

interface Started extends PiSession {
  registry: PiToolRegistry;
}

async function startWith(t: TestContext, extension: ExtensionFactory, systemPrompt: string | null, toolAllowlist: readonly string[] | null): Promise<Started> {
  const session = await startPiSession(t, { extension, extensionPaths: [], systemPrompt, toolAllowlist, ui: { mode: "print" } });
  return { ...session, registry: new PiToolRegistry(session.pi, session.ctx) };
}

function start(t: TestContext, extension: ExtensionFactory, systemPrompt: string | null): Promise<Started> {
  return startWith(t, extension, systemPrompt, null);
}

assert.deepEqual({ id: SCRIPTED_MODEL, contextWindow: SCRIPTED_CONTEXT_WINDOW }, CONTRACT_MODEL);

registryContract("pi session", async (t) => {
  const started = await start(t, registerProbes, null);
  t.after(() => assert.deepEqual(started.errors, []));
  return started;
});

test("pi session: a loaded tool is in the next request the provider receives, an unloaded one is not", async (t) => {
  const { registry, request, requests, errors } = await start(t, registerProbes, null);
  await request();
  assert.equal(requestedTools(requests[0]!).includes("probe_deferred"), false);
  registry.setActive([...registry.snapshot().active, "probe_deferred"]);
  await request();
  assert.equal(requestedTools(requests[1]!).includes("probe_deferred"), true);
  registry.setActive(registry.snapshot().active.filter((name) => name !== "probe_deferred"));
  await request();
  assert.equal(requestedTools(requests[2]!).includes("probe_deferred"), false);
  assert.deepEqual(errors, []);
});

test("pi session: with pi's rule the declaration estimate is pi's own estimate for the declaration pi sent", async (t) => {
  const { registry, pi, request, requests } = await start(t, registerProbes, null);
  // Everything pi lets a session declare, so that the request carries pi's own form of each declaration.
  pi.setActiveTools(registry.snapshot().tools.filter((tool) => tool.exposure !== "hidden").map((tool) => tool.name));
  await request();
  const sent = (JSON.parse(requests[0]!) as { messages: { role: string }[] }).messages;
  const declarations = getCurrentTools(sent);
  const catalog = buildCatalog(registry.snapshot());
  assert.equal(catalog.basis, PI_BASIS);
  assert.ok(declarations.some((tool) => tool.name === "read") && declarations.some((tool) => tool.name === "probe_deferred"), "built-in and loaded tools are declared");
  const directed: string[] = [];
  for (const declaration of declarations) {
    const entry = findEntry(catalog, declaration.name);
    assert.ok(entry, declaration.name);
    // pi keeps a sampling directive with some declarations. It is no text for the model, and the explorer
    // leaves it out; any other field pi adds to a declaration has to show up here.
    const { constrainedSampling, ...forTheModel } = declaration;
    if (constrainedSampling !== undefined) directed.push(declaration.name);
    assert.deepEqual(Object.keys(forTheModel).sort(), ["description", "name", "parameters"], declaration.name);
    assert.equal(entry.cost.declaration, piEstimateTokens({ role: "system", content: "", toolsAdded: [forTheModel], timestamp: 0 }), declaration.name);
  }
  assert.deepEqual(directed.sort(), ["bash", "edit", "powershell", "read", "write"], "the tools pi's own count is higher for, by the directive (README, Limits)");
});

test("pi session: a tool's prompt lines are exactly what the system prompt loses without the tool", async (t) => {
  const { registry, ctx, pi } = await start(t, registerProbes, null);
  const snapshot = registry.snapshot();
  const lines = snapshot.promptLines.get("probe_direct");
  assert.ok(lines);
  const text = promptLineText("probe_direct", lines);
  assert.equal(text, "- probe_direct: Probe directly\n- Use probe_direct before guessing.\n");
  const withTool = ctx.getSystemPrompt();
  pi.setActiveTools(snapshot.active.filter((name) => name !== "probe_direct"));
  const withoutTool = ctx.getSystemPrompt();
  let expected = withTool;
  for (const line of text.split("\n").filter((candidate) => candidate !== "")) {
    assert.equal(expected.split(`${line}\n`).length, 2, `the line occurs once: ${line}`);
    expected = expected.replace(`${line}\n`, "");
  }
  assert.equal(withoutTool, expected, "nothing else in the prompt belongs to the tool");
  assert.equal(withTool.length - withoutTool.length, text.length);
  const read = snapshot.promptLines.get("read");
  assert.ok(read, "built-in tools report their lines too");
  assert.ok(withTool.includes(`\n- read: ${read.snippet}\n`));
});

test("pi session: two effects of tool combinations on the prompt are attributed to no tool (README, Limits)", async (t) => {
  const { registry, ctx, pi } = await start(t, registerProbes, null);
  const base = registry.snapshot().active;
  assert.deepEqual(base.filter((name) => ["bash", "powershell", "grep", "find", "ls"].includes(name)), ["bash"], "the default selection");
  /** What the prompt has with the tool on top of `others` and not without it, and the other way round. */
  const effectOf = (name: string, others: readonly string[]): { lost: string[]; gained: string[]; mirrored: string[] } => {
    pi.setActiveTools([...others, name]);
    const withTool = ctx.getSystemPrompt().split("\n");
    const lines = registry.snapshot().promptLines.get(name);
    assert.ok(lines, name);
    pi.setActiveTools([...others]);
    const withoutTool = ctx.getSystemPrompt().split("\n");
    pi.setActiveTools([...base]);
    return {
      lost: withTool.filter((line) => !withoutTool.includes(line)),
      gained: withoutTool.filter((line) => !withTool.includes(line)),
      mirrored: promptLineText(name, lines).split("\n").filter((line) => line !== ""),
    };
  };
  const combinationRule = "- Use bash for file operations like ls, rg, find";
  const withoutBash = base.filter((name) => name !== "bash");
  // The rule is in the prompt while bash is active and none of grep, find and ls is. It is no line of bash's.
  const bash = effectOf("bash", withoutBash);
  assert.deepEqual(bash.lost.filter((line) => !bash.mirrored.includes(line)), [combinationRule]);
  assert.deepEqual(bash.gained, []);
  for (const name of ["grep", "find", "ls"]) {
    const searching = effectOf(name, base);
    assert.deepEqual([searching.lost, searching.gained], [searching.mirrored, [combinationRule]], `${name} takes the rule out`);
  }
  // A rule two active tools share is in the prompt once; each of the two lists it.
  const powershell = effectOf("powershell", base);
  const shared = powershell.mirrored.filter((line) => bash.mirrored.includes(line));
  assert.equal(shared.length, 1);
  assert.equal(powershell.lost.includes(shared[0]!), false, "it stays while bash is active");
  assert.deepEqual(powershell.mirrored.filter((line) => !powershell.lost.includes(line) && line !== shared[0]), []);
});

test("pi session: a custom system prompt leaves the tool lines out", async (t) => {
  const { registry, ctx } = await start(t, registerProbes, "You are a probe.");
  const snapshot = registry.snapshot();
  assert.equal(snapshot.promptLinesSent, false);
  assert.equal(ctx.getSystemPrompt().includes("probe_direct"), false);
  const entry = findEntry(buildCatalog(snapshot), "probe_direct");
  assert.ok(entry);
  assert.equal(entry.cost.promptLines, 0);
});

test("pi session: a declaration an orchestrating tool withholds is active, reported as withheld, and not sent", async (t) => {
  const { registry, ctx, request, requests } = await start(t, (pi) => {
    registerProbes(pi);
    pi.registerTool({
      name: "probe_orchestrator", label: "probe_orchestrator", description: "Reaches probe_direct on the model's behalf",
      parameters: { type: "object", properties: {} } as TSchema,
      prepareLoadout: () => ({ hiddenDeclarations: ["probe_direct"] }),
      reachesTools: () => "all",
      execute: async () => PROBED,
    });
  }, null);
  const snapshot = registry.snapshot();
  assert.deepEqual(snapshot.tools.filter((tool) => tool.reachesOtherTools).map((tool) => tool.name), ["probe_orchestrator"], "only the tool that declares it reaches others");
  assert.ok(snapshot.active.includes("probe_direct"));
  assert.deepEqual(snapshot.withheld, ["probe_direct"]);
  const entry = findEntry(buildCatalog(snapshot), "probe_direct");
  assert.ok(entry);
  assert.equal(entry.state, "indirect");
  assert.equal(isCharged(entry), false);
  await request();
  const sent = requestedTools(requests[0]!);
  assert.equal(sent.includes("probe_direct"), false);
  assert.equal(sent.includes("probe_orchestrator"), true);
  assert.equal(ctx.getSystemPrompt().includes("- probe_direct: Probe directly"), false, "its prompt lines are left out with it");
});

test("pi session: an MCP tool the --tools selection does not match stays registered, and loading it is reported as not activated", async (t) => {
  const { registry, errors } = await startWith(t, (pi) => {
    registerProbes(pi);
    pi.registerTool({
      name: "mcp__probe__direct", label: "direct", description: "A directly exposed tool of the probe server",
      parameters: { type: "object", properties: {} } as TSchema,
      namespace: { name: "mcp__probe" },
      execute: async () => PROBED,
    });
  }, null, ["read", "probe_direct"]);
  const before = registry.snapshot();
  assert.deepEqual(before.tools.map((tool) => tool.name).sort(), ["mcp__probe__direct", "probe_direct", "read"], "the selection keeps other tools out of the session");
  assert.deepEqual([...before.active].sort(), ["probe_direct", "read"]);
  assert.deepEqual(new ToolActivation(registry).load("mcp__probe__direct"), { kind: "refused", name: "mcp__probe__direct", reason: "not-activated" });
  assert.deepEqual(registry.snapshot().active, before.active);
  assert.deepEqual(errors, []);
});

test("pi session: a description that is not text arrives as text, and is marked", async (t) => {
  // pi checks a tool's parameters, not its description: an MCP tool without one gets its `title`, whatever that is.
  const { registry, request } = await start(t, (pi) => {
    registerProbes(pi);
    const parameters = { type: "object", properties: {} } as TSchema;
    pi.registerTool({ name: "probe_numbered", label: "numbered", description: 42 as unknown as string, parameters, execute: async () => PROBED });
    pi.registerTool({ name: "probe_structured", label: "structured", description: { en: "Reads" } as unknown as string, parameters, execute: async () => PROBED });
    pi.registerTool({ name: "probe_undescribed", label: "undescribed", description: undefined as unknown as string, parameters, execute: async () => PROBED });
  }, null);
  const described = (): (string | boolean)[][] => registry.snapshot().tools.filter((tool) => /^probe_(numbered|structured|undescribed|direct)$/.test(tool.name))
    .map((tool) => [tool.name, tool.description, tool.nonTextDescription]).sort();
  assert.deepEqual(described(), [
    ["probe_direct", "A directly exposed probe", false],
    ["probe_numbered", "42", true],
    ["probe_structured", '{"en":"Reads"}', true],
    ["probe_undescribed", "", false],
  ], "no description is no text, not a wrong kind of text");
  await request();
  const declared = registry.snapshot().declared;
  assert.deepEqual([declared.get("probe_numbered")?.description, declared.get("probe_structured")?.description, declared.get("probe_undescribed")?.description], ["42", '{"en":"Reads"}', ""],
    "what the transcript declares is read the same way");
  const catalog = buildCatalog(registry.snapshot());
  assert.deepEqual(["probe_numbered", "probe_structured", "probe_undescribed"].map((name) => findEntry(catalog, name)?.differsFromRegistered), [false, false, false]);
});

test("pi session: namespace, hints and provenance come through as pi records them", async (t) => {
  const { registry } = await start(t, (pi) => {
    pi.registerTool({
      name: "mcp__probe__lookup", label: "lookup", description: "Look something up on the probe server",
      parameters: { type: "object", properties: {} } as TSchema,
      exposure: "deferred",
      namespace: { name: "mcp__probe", aliases: ["probe"], description: "A server for probing" },
      annotations: { readOnlyHint: true, openWorldHint: false },
      execute: async () => PROBED,
    });
  }, null);
  const catalog = buildCatalog(registry.snapshot());
  const lookup = findEntry(catalog, "mcp__probe__lookup");
  assert.ok(lookup);
  assert.deepEqual(lookup.origin, { kind: "mcp", name: "probe" });
  assert.deepEqual(lookup.namespace, { name: "mcp__probe", description: "A server for probing" });
  assert.deepEqual(lookup.hints, { readOnly: true, destructive: null, idempotent: null, openWorld: false });
  const read = findEntry(catalog, "read");
  assert.ok(read);
  assert.deepEqual(read.origin, { kind: "built-in", name: "built-in" });
  assert.deepEqual(read.provenance, { path: "builtin:read", source: "builtin", scope: "temporary", origin: "top-level", baseDir: null });
  assert.equal(read.hints, null);
  assert.equal(read.namespace, null);
});

test("pi session: after compaction the transcript still declares the active tools", async (t) => {
  const { registry, session, request, errors } = await start(t, registerProbes, null);
  const padding = "padding text ".repeat(1500);
  await session.prompt(`First ${padding}`);
  registry.setActive([...registry.snapshot().active, "probe_deferred"]);
  await session.prompt(`Second ${padding}`);
  await session.compact();
  assert.ok(session.sessionManager.getBranch().some((entry) => entry.type === "compaction"), "the branch was compacted");
  const compacted = registry.snapshot();
  assert.deepEqual([...compacted.declared.keys()].sort(), [...compacted.active].sort());
  assert.ok(compacted.declared.has("probe_deferred"));
  await request();
  const after = registry.snapshot();
  assert.deepEqual([...after.declared.keys()].sort(), [...after.active].sort());
  assert.deepEqual(errors, []);
});
