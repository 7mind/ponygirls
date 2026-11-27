import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { getCurrentTools } from "@earendil-works/pi-ai";
import { estimateTokens as piEstimateTokens, type ExtensionAPI, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { buildCatalog, findEntry, isCharged } from "../src/catalog.ts";
import { PiToolRegistry } from "../src/pi-registry.ts";
import type { JsonSchema } from "../src/registry.ts";
import { PI_BASIS, declarationTokens, promptLineText } from "../src/tokens.ts";
import { SCRIPTED_API, SCRIPTED_CONTEXT_WINDOW, startPiSession, type PiSession } from "./pi-session.ts";
import { CONTRACT_MODEL, CONTRACT_TOOLS, registryContract } from "./registry-contract.ts";

const PROBED = { content: [{ type: "text" as const, text: "probed" }], details: undefined };

function registerProbes(pi: ExtensionAPI): void {
  for (const tool of CONTRACT_TOOLS) {
    pi.registerTool({
      name: tool.name,
      label: tool.name,
      description: tool.description,
      parameters: tool.parameters as TSchema,
      exposure: tool.exposure,
      defaultActive: tool.activeOnRegistration,
      ...(tool.promptLines.snippet === null ? {} : { promptSnippet: tool.promptLines.snippet }),
      promptGuidelines: [...tool.promptLines.guidelines],
      execute: async () => PROBED,
    });
  }
}

interface Started extends PiSession {
  registry: PiToolRegistry;
}

async function start(t: TestContext, extension: ExtensionFactory, systemPrompt: string | null): Promise<Started> {
  const session = await startPiSession(t, { extension, extensionPaths: [], systemPrompt, notify: null });
  return { ...session, registry: new PiToolRegistry(session.pi, session.ctx) };
}

/** The tools the provider was told about in a request. */
function requestedTools(request: string): string[] {
  const context = JSON.parse(request) as { messages: { role: string }[] };
  return getCurrentTools(context.messages).map((tool) => tool.name).sort();
}

assert.deepEqual({ api: SCRIPTED_API, contextWindow: SCRIPTED_CONTEXT_WINDOW }, CONTRACT_MODEL);

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

test("pi session: with pi's rule the declaration estimate is pi's own estimate for a message declaring the tool", async (t) => {
  const { registry } = await start(t, registerProbes, null);
  const tools = registry.snapshot().tools;
  assert.ok(tools.some((tool) => tool.name === "read"), "built-in tools are part of the registry");
  for (const tool of tools) {
    const declaration = { name: tool.name, description: tool.description, parameters: JSON.parse(JSON.stringify(tool.parameters)) as JsonSchema };
    const system = { role: "system" as const, content: "", toolsAdded: [declaration], timestamp: 0 };
    assert.equal(declarationTokens(tool, PI_BASIS), piEstimateTokens(system), tool.name);
  }
});

test("pi session: prompt lines are the lines pi puts in the system prompt", async (t) => {
  const { registry, ctx } = await start(t, registerProbes, null);
  const snapshot = registry.snapshot();
  const prompt = ctx.getSystemPrompt();
  const direct = snapshot.promptLines.get("probe_direct");
  assert.ok(direct);
  for (const line of promptLineText("probe_direct", direct).trimEnd().split("\n")) {
    assert.ok(prompt.includes(`\n${line}\n`), `the system prompt has the line ${JSON.stringify(line)}`);
  }
  const read = snapshot.promptLines.get("read");
  assert.ok(read, "built-in tools report their lines too");
  assert.ok(prompt.includes(`\n- read: ${read.snippet}\n`));
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
      execute: async () => PROBED,
    });
  }, null);
  const snapshot = registry.snapshot();
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
