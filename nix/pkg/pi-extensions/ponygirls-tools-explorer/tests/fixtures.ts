import type { JsonSchema, PromptLines, RegisteredTool, RegistrySnapshot, ToolDeclaration, ToolProvenance } from "../src/registry.ts";

export const EMPTY_OBJECT: JsonSchema = { type: "object", properties: {} };

export const BUILTIN: ToolProvenance = { path: "builtin:read", source: "builtin", scope: "temporary", origin: "top-level", baseDir: null };

export function extensionFile(path: string): ToolProvenance {
  return { path, source: "local", scope: "user", origin: "top-level", baseDir: null };
}

/** A registered tool: a directly exposed built-in unless the overrides say otherwise. */
export function tool(name: string, overrides: Partial<Omit<RegisteredTool, "name">>): RegisteredTool {
  return {
    name,
    description: `${name} description`,
    parameters: EMPTY_OBJECT,
    exposure: "direct",
    namespace: null,
    hints: null,
    reachesOtherTools: false,
    provenance: BUILTIN,
    ...overrides,
  };
}

export function mcpTool(server: string, name: string, overrides: Partial<Omit<RegisteredTool, "name">>): RegisteredTool {
  return tool(`mcp__${server}__${name}`, {
    exposure: "deferred",
    namespace: { name: `mcp__${server}`, description: null },
    provenance: { ...BUILTIN, path: "builtin:mcp" },
    ...overrides,
  });
}

export function snapshot(tools: readonly RegisteredTool[], overrides: Partial<Omit<RegistrySnapshot, "tools">>): RegistrySnapshot {
  return {
    tools,
    active: [],
    withheld: [],
    promptLines: new Map<string, PromptLines>(),
    promptLinesSent: true,
    declared: new Map<string, ToolDeclaration>(),
    contextWindow: null,
    ...overrides,
  };
}

export function declarationOf(registered: RegisteredTool): ToolDeclaration {
  return { name: registered.name, description: registered.description, parameters: registered.parameters };
}

export function declared(tools: readonly RegisteredTool[]): Map<string, ToolDeclaration> {
  return new Map(tools.map((registered) => [registered.name, declarationOf(registered)]));
}
