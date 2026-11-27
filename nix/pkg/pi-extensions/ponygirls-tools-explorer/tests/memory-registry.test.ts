import assert from "node:assert/strict";
import test from "node:test";
import { ToolActivation } from "../src/activation.ts";
import type { PromptLines, RegisteredTool } from "../src/registry.ts";
import { extensionFile } from "./fixtures.ts";
import { InMemoryToolRegistry } from "./memory-registry.ts";
import { CONTRACT_CONTEXT_WINDOW, CONTRACT_TOOLS, registryContract } from "./registry-contract.ts";

function contractRegistry(): InMemoryToolRegistry {
  const tools: RegisteredTool[] = CONTRACT_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    exposure: tool.exposure,
    namespace: null,
    hints: null,
    reachesOtherTools: false,
    provenance: extensionFile("/fixtures/probes.ts"),
  }));
  const promptLines = new Map<string, PromptLines>(CONTRACT_TOOLS
    .filter((tool) => tool.promptLines.snippet !== null || tool.promptLines.guidelines.length > 0)
    .map((tool) => [tool.name, tool.promptLines]));
  return new InMemoryToolRegistry({
    tools,
    active: CONTRACT_TOOLS.filter((tool) => tool.activeOnRegistration).map((tool) => tool.name),
    promptLines,
    contextWindow: CONTRACT_CONTEXT_WINDOW,
  });
}

registryContract("in-memory registry", async () => {
  const registry = contractRegistry();
  return { registry, request: async () => registry.request() };
});

test("a tool pi refuses to activate is reported as not applied, and nothing changes", () => {
  const registry = contractRegistry();
  registry.refuse("probe_deferred");
  const before = registry.snapshot().active;
  assert.deepEqual(new ToolActivation(registry).load("probe_deferred"), { kind: "refused", name: "probe_deferred", reason: "not-applied" });
  assert.deepEqual(registry.snapshot().active, before);
});

test("a tool that disappears before it is unloaded is reported as unknown", () => {
  const registry = contractRegistry();
  const activation = new ToolActivation(registry);
  assert.equal(activation.load("probe_deferred").kind, "loaded");
  registry.unregister("probe_deferred");
  assert.deepEqual(activation.unload("probe_deferred"), { kind: "refused", name: "probe_deferred", reason: "unknown-tool" });
});
