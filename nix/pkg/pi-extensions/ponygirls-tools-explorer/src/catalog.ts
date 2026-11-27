/**
 * The explorer's view of a registry snapshot: one entry per registered tool
 * with its state, source, definition and estimated cost.
 */
import { originOf, type ToolOrigin } from "./origin.ts";
import type { PromptLines, RegisteredTool, RegistrySnapshot, SessionModel, ToolDeclaration, ToolExposure, ToolHints, ToolNamespace, ToolProvenance } from "./registry.ts";
import { basisFor, declarationTokens, promptLineTokens, type TokenBasis } from "./tokens.ts";

/**
 * Whether the model has the tool.
 * - `active`: in pi's active set, so declared to the model.
 * - `indirect`: active, but an orchestrating tool keeps its declaration out of requests.
 * - `deferred`, `codemode`: registered and reachable through tool search or scripts, not declared.
 * - `off`: a directly exposed tool that is not active.
 * - `hidden`: registered but unreachable.
 */
export type ToolState = "active" | "indirect" | "deferred" | "codemode" | "off" | "hidden";

/** How the active set relates to what the transcript has declared so far. */
export type Delivery = "declared" | "next-request" | "withheld" | "removal-pending" | "none";

export interface ToolCost {
  declaration: number;
  promptLines: number;
}

export interface ToolEntry {
  name: string;
  state: ToolState;
  delivery: Delivery;
  exposure: ToolExposure;
  origin: ToolOrigin;
  /** The declaration the model has, or the registered one when it has none. */
  definition: ToolDeclaration;
  /** The model's declaration is not the registered definition (a loadout hook rewrote it, or it is stale). */
  differsFromRegistered: boolean;
  /** The registered description is not text; what is shown is its JSON. */
  nonTextDescription: boolean;
  cost: ToolCost;
  promptLines: PromptLines;
  namespace: ToolNamespace | null;
  hints: ToolHints | null;
  provenance: ToolProvenance;
}

/**
 * Whether the model has pi's two tools that reach tools it has no declaration of: tool search loads
 * them into the active set, codemode scripts call them. Either reaches `deferred` and `codemode` tools alike.
 */
export interface Reach {
  toolSearch: boolean;
  codemode: boolean;
}

export interface ToolCatalog {
  entries: readonly ToolEntry[];
  reach: Reach;
  /** What the costs were estimated with: the ratios of the model's family, or pi's rule. */
  basis: TokenBasis;
  /** `null` while no model is selected. */
  model: SessionModel | null;
}

const NO_PROMPT_LINES: PromptLines = { snippet: null, guidelines: [] };
/**
 * pi's own rule for which tools reach undeclared ones: a tool of one of these names that declares that it
 * reaches other tools. A tool that merely has the name does not.
 */
const TOOL_SEARCH_TOOL = "tool_search";
const CODEMODE_TOOL = "codemode";
const INACTIVE_STATE: Readonly<Record<ToolExposure, ToolState>> = {
  direct: "off",
  "model-only": "off",
  codemode: "codemode",
  deferred: "deferred",
  hidden: "hidden",
};

export function totalTokens(cost: ToolCost): number {
  return cost.declaration + cost.promptLines;
}

/** In pi's active set. */
export function isActive(entry: ToolEntry): boolean {
  return entry.state === "active" || entry.state === "indirect";
}

/** Its declaration and prompt lines are part of every request. */
export function isCharged(entry: ToolEntry): boolean {
  return entry.state === "active";
}

/** Any tool outside the active set can join it, except one pi keeps unreachable. */
export function canLoad(entry: ToolEntry): boolean {
  return !isActive(entry) && entry.exposure !== "hidden";
}

export function canUnload(entry: ToolEntry): boolean {
  return isActive(entry);
}

function sameDeclaration(a: ToolDeclaration, b: ToolDeclaration): boolean {
  return a.description === b.description && JSON.stringify(a.parameters) === JSON.stringify(b.parameters);
}

function stateOf(tool: RegisteredTool, active: boolean, withheld: boolean): ToolState {
  if (!active) return INACTIVE_STATE[tool.exposure];
  return withheld ? "indirect" : "active";
}

function deliveryOf(state: ToolState, declared: boolean): Delivery {
  if (state === "indirect") return "withheld";
  if (state === "active") return declared ? "declared" : "next-request";
  return declared ? "removal-pending" : "none";
}

export function buildCatalog(snapshot: RegistrySnapshot): ToolCatalog {
  const active = new Set(snapshot.active);
  const withheld = new Set(snapshot.withheld);
  const basis = basisFor(snapshot.model === null ? null : snapshot.model.id);
  const entries = snapshot.tools.map((tool): ToolEntry => {
    const state = stateOf(tool, active.has(tool.name), withheld.has(tool.name));
    const declared = snapshot.declared.get(tool.name);
    const registered: ToolDeclaration = { name: tool.name, description: tool.description, parameters: tool.parameters };
    const definition = declared !== undefined && state === "active" ? declared : registered;
    const promptLines = snapshot.promptLines.get(tool.name) ?? NO_PROMPT_LINES;
    return {
      name: tool.name,
      state,
      delivery: deliveryOf(state, declared !== undefined),
      exposure: tool.exposure,
      origin: originOf(tool),
      definition,
      differsFromRegistered: definition !== registered && !sameDeclaration(definition, registered),
      nonTextDescription: tool.nonTextDescription,
      cost: {
        declaration: declarationTokens(definition, basis),
        promptLines: snapshot.promptLinesSent ? promptLineTokens(tool.name, promptLines, basis) : 0,
      },
      promptLines,
      namespace: tool.namespace,
      hints: tool.hints,
      provenance: tool.provenance,
    };
  });
  // The model has a tool only while its declaration is sent.
  const reaching = new Set(snapshot.tools.filter((tool) => tool.reachesOtherTools).map((tool) => tool.name));
  const has = (name: string): boolean => reaching.has(name) && entries.some((entry) => entry.name === name && isCharged(entry));
  return { entries, reach: { toolSearch: has(TOOL_SEARCH_TOOL), codemode: has(CODEMODE_TOOL) }, basis, model: snapshot.model };
}

export function findEntry(catalog: ToolCatalog, name: string): ToolEntry | null {
  return catalog.entries.find((entry) => entry.name === name) ?? null;
}
