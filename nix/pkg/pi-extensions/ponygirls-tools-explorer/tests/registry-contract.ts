/**
 * What any tool registry must do, and how loading behaves on top of one. The
 * same clauses run against the in-memory registry and against a real pi
 * session, so the in-memory one cannot drift from pi unnoticed.
 */
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { ToolActivation } from "../src/activation.ts";
import { buildCatalog, findEntry, type ToolEntry } from "../src/catalog.ts";
import type { JsonSchema, PromptLines, RegisteredTool, ToolExposure, ToolRegistry } from "../src/registry.ts";

export interface ContractTool {
  name: string;
  description: string;
  parameters: JsonSchema;
  exposure: ToolExposure;
  /** pi's `defaultActive`; it only matters for directly exposed tools. */
  activeOnRegistration: boolean;
  promptLines: PromptLines;
}

const NO_LINES: PromptLines = { snippet: null, guidelines: [] };
const QUERY: JsonSchema = { type: "object", properties: { query: { type: "string", description: "What to look for" } }, required: ["query"] };

export const CONTRACT_TOOLS: readonly ContractTool[] = [
  { name: "probe_direct", description: "A directly exposed probe", parameters: QUERY, exposure: "direct", activeOnRegistration: true,
    promptLines: { snippet: "Probe directly", guidelines: ["Use probe_direct before guessing."] } },
  { name: "probe_inactive", description: "A direct probe registered inactive", parameters: QUERY, exposure: "direct", activeOnRegistration: false, promptLines: NO_LINES },
  { name: "probe_deferred", description: "A probe tool search can load", parameters: QUERY, exposure: "deferred", activeOnRegistration: false, promptLines: NO_LINES },
  { name: "probe_codemode", description: "A probe scripts can call", parameters: QUERY, exposure: "codemode", activeOnRegistration: false, promptLines: NO_LINES },
  { name: "probe_hidden", description: "An unreachable probe", parameters: QUERY, exposure: "hidden", activeOnRegistration: false, promptLines: NO_LINES },
];
export const CONTRACT_CONTEXT_WINDOW = 100_000;

export interface RegistryUnderTest {
  registry: ToolRegistry;
  /** One model request with the current active set. */
  request(): Promise<void>;
}

export type RegistryFactory = (t: TestContext) => Promise<RegistryUnderTest>;

function registered(registry: ToolRegistry, name: string): RegisteredTool {
  const tool = registry.snapshot().tools.find((candidate) => candidate.name === name);
  assert.ok(tool, `${name} is registered`);
  return tool;
}

function entryOf(registry: ToolRegistry, name: string): ToolEntry {
  const entry = findEntry(buildCatalog(registry.snapshot()), name);
  assert.ok(entry, `${name} is in the catalog`);
  return entry;
}

function probes(names: Iterable<string>): string[] {
  return [...names].filter((name) => name.startsWith("probe_")).sort();
}

export function registryContract(label: string, make: RegistryFactory): void {
  test(`${label}: lists every registered tool with its exposure and definition`, async (t) => {
    const { registry } = await make(t);
    for (const expected of CONTRACT_TOOLS) {
      const tool = registered(registry, expected.name);
      assert.equal(tool.exposure, expected.exposure, expected.name);
      assert.equal(tool.description, expected.description);
      assert.deepEqual(JSON.parse(JSON.stringify(tool.parameters)), expected.parameters);
    }
  });

  test(`${label}: starts with the directly exposed tools that are active on registration`, async (t) => {
    const { registry } = await make(t);
    assert.deepEqual(probes(registry.snapshot().active), ["probe_direct"]);
  });

  test(`${label}: activating a tool appends it and keeps the others in place`, async (t) => {
    const { registry } = await make(t);
    const before = registry.snapshot().active;
    registry.setActive(["probe_deferred", ...[...before].reverse()]);
    assert.deepEqual(registry.snapshot().active, [...before, "probe_deferred"]);
  });

  test(`${label}: ignores names that are unknown or hidden`, async (t) => {
    const { registry } = await make(t);
    const before = registry.snapshot().active;
    registry.setActive([...before, "no_such_tool", "probe_hidden"]);
    assert.deepEqual(registry.snapshot().active, before);
  });

  test(`${label}: deactivating a tool removes only that tool`, async (t) => {
    const { registry } = await make(t);
    const before = registry.snapshot().active;
    registry.setActive([...before, "probe_codemode"]);
    registry.setActive(registry.snapshot().active.filter((name) => name !== "probe_direct"));
    assert.deepEqual(registry.snapshot().active, [...before.filter((name) => name !== "probe_direct"), "probe_codemode"]);
  });

  test(`${label}: reports the lines a tool adds to the system prompt`, async (t) => {
    const { registry } = await make(t);
    const snapshot = registry.snapshot();
    assert.deepEqual(snapshot.promptLines.get("probe_direct"), CONTRACT_TOOLS[0]!.promptLines);
    assert.equal(snapshot.promptLines.has("probe_deferred"), false);
    assert.equal(snapshot.promptLinesSent, true);
    assert.deepEqual(snapshot.withheld, []);
  });

  test(`${label}: reports the context window of the model`, async (t) => {
    const { registry } = await make(t);
    assert.equal(registry.snapshot().contextWindow, CONTRACT_CONTEXT_WINDOW);
  });

  test(`${label}: the transcript declares nothing before the first request, then the active set`, async (t) => {
    const { registry, request } = await make(t);
    assert.deepEqual(probes(registry.snapshot().declared.keys()), []);
    await request();
    const snapshot = registry.snapshot();
    assert.deepEqual(probes(snapshot.declared.keys()), ["probe_direct"]);
    assert.deepEqual([...snapshot.declared.keys()].sort(), [...snapshot.active].sort());
    const declared = snapshot.declared.get("probe_direct");
    assert.ok(declared);
    assert.equal(declared.description, CONTRACT_TOOLS[0]!.description);
    assert.deepEqual(JSON.parse(JSON.stringify(declared.parameters)), CONTRACT_TOOLS[0]!.parameters);
  });

  test(`${label}: a tool activated between requests is declared by the next one, a deactivated one dropped`, async (t) => {
    const { registry, request } = await make(t);
    await request();
    registry.setActive([...registry.snapshot().active, "probe_deferred"]);
    assert.deepEqual(probes(registry.snapshot().declared.keys()), ["probe_direct"], "not declared before a request is made");
    await request();
    assert.deepEqual(probes(registry.snapshot().declared.keys()), ["probe_deferred", "probe_direct"]);
    registry.setActive(registry.snapshot().active.filter((name) => name !== "probe_deferred"));
    assert.deepEqual(probes(registry.snapshot().declared.keys()), ["probe_deferred", "probe_direct"], "still declared until a request is made");
    await request();
    assert.deepEqual(probes(registry.snapshot().declared.keys()), ["probe_direct"]);
  });

  test(`${label}: loading a deferred tool makes it active now and declared by the next request`, async (t) => {
    const { registry, request } = await make(t);
    await request();
    const activation = new ToolActivation(registry);
    const before = registry.snapshot().active;
    assert.equal(entryOf(registry, "probe_deferred").state, "deferred");
    const result = activation.load("probe_deferred");
    assert.equal(result.kind, "loaded");
    assert.deepEqual(registry.snapshot().active, [...before, "probe_deferred"], "every other tool stays active");
    assert.equal(entryOf(registry, "probe_deferred").state, "active");
    assert.equal(entryOf(registry, "probe_deferred").delivery, "next-request");
    await request();
    assert.equal(entryOf(registry, "probe_deferred").delivery, "declared");
  });

  test(`${label}: unloading returns a loaded tool to deferred, and the next request drops it`, async (t) => {
    const { registry, request } = await make(t);
    const activation = new ToolActivation(registry);
    const before = registry.snapshot().active;
    assert.equal(activation.load("probe_codemode").kind, "loaded");
    await request();
    assert.equal(entryOf(registry, "probe_codemode").delivery, "declared");
    const result = activation.unload("probe_codemode");
    assert.equal(result.kind, "unloaded");
    assert.deepEqual(registry.snapshot().active, before, "only the unloaded tool leaves the active set");
    assert.equal(entryOf(registry, "probe_codemode").state, "codemode");
    assert.equal(entryOf(registry, "probe_codemode").delivery, "removal-pending");
    await request();
    assert.equal(entryOf(registry, "probe_codemode").delivery, "none");
  });

  test(`${label}: loading and unloading refuse what tool search could not have loaded`, async (t) => {
    const { registry } = await make(t);
    const activation = new ToolActivation(registry);
    const before = registry.snapshot().active;
    assert.deepEqual(activation.load("no_such_tool"), { kind: "refused", name: "no_such_tool", reason: "unknown-tool" });
    assert.deepEqual(activation.load("probe_inactive"), { kind: "refused", name: "probe_inactive", reason: "not-loadable" });
    assert.deepEqual(activation.load("probe_hidden"), { kind: "refused", name: "probe_hidden", reason: "not-loadable" });
    assert.deepEqual(activation.load("probe_direct"), { kind: "refused", name: "probe_direct", reason: "not-loadable" });
    assert.deepEqual(activation.unload("probe_direct"), { kind: "refused", name: "probe_direct", reason: "not-unloadable" });
    assert.deepEqual(activation.unload("probe_deferred"), { kind: "refused", name: "probe_deferred", reason: "not-unloadable" });
    assert.deepEqual(activation.unload("no_such_tool"), { kind: "refused", name: "no_such_tool", reason: "unknown-tool" });
    assert.deepEqual(registry.snapshot().active, before, "a refusal changes nothing");
  });
}
