/**
 * What the explorer reads from a pi session and the one change it asks for.
 * `PiToolRegistry` implements it over pi's extension API; tests use
 * `InMemoryToolRegistry`. Both pass the contract in tests/registry-contract.ts.
 */

/** How the model reaches a tool (pi's `ToolExposure`). */
export type ToolExposure = "direct" | "model-only" | "codemode" | "deferred" | "hidden";

/** A JSON Schema document; only the parameter outline looks inside. */
export type JsonSchema = Readonly<Record<string, unknown>>;

/** A tool as it is declared to the model. */
export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: JsonSchema;
}

/** pi's provenance record of whatever registered the tool. */
export interface ToolProvenance {
  /** `builtin:<name>`, `<sdk:name>`, or the file that registered the tool. */
  path: string;
  /** `builtin`, `sdk`, how an extension was found (`local`, `auto`, …), or a package source. */
  source: string;
  scope: "user" | "project" | "temporary";
  origin: "package" | "top-level";
  baseDir: string | null;
}

/** The group a tool belongs to, such as one MCP server. */
export interface ToolNamespace {
  name: string;
  description: string | null;
}

/** What the tool's author says it does (MCP tool annotations); `null` is unstated. */
export interface ToolHints {
  readOnly: boolean | null;
  destructive: boolean | null;
  idempotent: boolean | null;
  openWorld: boolean | null;
}

export interface RegisteredTool extends ToolDeclaration {
  exposure: ToolExposure;
  namespace: ToolNamespace | null;
  hints: ToolHints | null;
  provenance: ToolProvenance;
}

/** The lines a tool adds to the default system prompt while it is declared. */
export interface PromptLines {
  /** Its one-line entry in the tool list. */
  snippet: string | null;
  /** Its rule bullets. */
  guidelines: readonly string[];
}

/** The session's current model, as far as the explorer needs it. */
export interface SessionModel {
  /** pi's API family of the model, such as `anthropic-messages`; it decides the token ratios. */
  api: string;
  contextWindow: number;
}

export interface RegistrySnapshot {
  tools: readonly RegisteredTool[];
  /** pi's active tool set: declared to the model from the next request on. */
  active: readonly string[];
  /** Active tools whose declarations an orchestrating tool keeps out of requests. */
  withheld: readonly string[];
  promptLines: ReadonlyMap<string, PromptLines>;
  /** False when a custom system prompt replaces the tool list and rules. */
  promptLinesSent: boolean;
  /** The declarations the transcript holds now; empty before the session's first request. */
  declared: ReadonlyMap<string, ToolDeclaration>;
  /** `null` while no model is selected. */
  model: SessionModel | null;
}

export interface ToolRegistry {
  snapshot(): RegistrySnapshot;
  /** Replace the active set. pi drops names it does not activate; read `snapshot()` for the outcome. */
  setActive(names: readonly string[]): void;
}
