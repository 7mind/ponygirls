/**
 * The words the pane and the text summary use for states, sources, costs and
 * outcomes. Everything here is plain text; tool-supplied text is made safe
 * with `displayLine` before it is put into a sentence.
 */
import { formatCompact, formatCount, homeRelative, type UiState } from "@ponygirls/pi-ui";
import type { ActivationResult, Refusal } from "./activation.ts";
import { isActive, isCharged, totalTokens, type Reach, type ToolEntry, type ToolState } from "./catalog.ts";
import { displayLine } from "./display.ts";
import type { CatalogSummary, SourceSummary, Tab } from "./query.ts";
import type { SessionModel } from "./registry.ts";
import type { TokenBasis } from "./tokens.ts";

const ESTIMATE_MARK = "~";
/** A share below this shows as `<0.1%` instead of `0.0%`. */
const MIN_SHOWN_SHARE = 0.001;
const PERCENT = 100;

const STATE_GLYPH: Readonly<Record<ToolState, string>> = { active: "●", indirect: "◐", deferred: "○", codemode: "○", off: "○", hidden: "–" };

export function stateLabel(state: ToolState): string {
  return `${STATE_GLYPH[state]} ${state}`;
}

/** A tool in the active set is on; every other state is at rest. */
export function stateTone(entry: ToolEntry): UiState {
  return isActive(entry) ? "ok" : "settled";
}

export function tokenText(tokens: number): string {
  return `${ESTIMATE_MARK}${formatCompact(tokens)}`;
}

function plural(count: number, noun: string): string {
  return `${formatCount(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/** `1.4% of 1M`: the share of the model's context window. */
export function shareText(share: number, model: SessionModel): string {
  const percent = share > 0 && share < MIN_SHOWN_SHARE ? `<${(MIN_SHOWN_SHARE * PERCENT).toFixed(1)}%` : `${(share * PERCENT).toFixed(1)}%`;
  return `${percent} of ${formatCompact(model.contextWindow)}`;
}

export function tabCount(summary: CatalogSummary, tab: Tab): number {
  return tab === "all" ? summary.all : tab === "active" ? summary.active : summary.inactive;
}

export function tabLabel(summary: CatalogSummary, tab: Tab): string {
  return `${tab} ${formatCount(tabCount(summary, tab))}`;
}

/** `7 tools · 4 active · ~836 of ~1.4k tok`: one source in one line. */
export function sourceFacts(source: SourceSummary): string {
  const active = source.active === 0 ? "none active" : source.active < source.tools ? `${formatCount(source.active)} active` : source.tools === 1 ? "active" : "all active";
  // A source of hidden tools only has nothing that could be declared, so no figure.
  const tokens = source.allTokens === 0 ? []
    : source.chargedTokens === source.allTokens ? [`${tokenText(source.allTokens)} tok`]
    : source.chargedTokens === 0 ? [`${tokenText(source.allTokens)} tok if loaded`]
    : [`${tokenText(source.chargedTokens)} of ${tokenText(source.allTokens)} tok`];
  return [plural(source.tools, "tool"), active, ...tokens].join(" · ");
}

const REACH_FACT: Readonly<Record<keyof Reach, string>> = { toolSearch: "tool_search can load it", codemode: "callable from codemode scripts" };

/** How the model can get a tool it has no declaration of: by the way meant for the tool's exposure, else by the other. */
function reachFact(reach: Reach, meant: keyof Reach): string {
  const other: keyof Reach = meant === "toolSearch" ? "codemode" : "toolSearch";
  if (reach[meant]) return REACH_FACT[meant];
  return reach[other] ? REACH_FACT[other] : "out of the model's reach: neither tool_search nor codemode is active";
}

/** Whether the model has the tool, then why not or since when. */
export function stateFacts(entry: ToolEntry, reach: Reach): string[] {
  if (entry.delivery === "removal-pending") return [entry.state, "still declared to the model", "dropped with the next request"];
  switch (entry.state) {
    case "active":
      return ["active", entry.delivery === "declared" ? "declared to the model" : "declared to the model with the next request"];
    case "indirect":
      return ["indirect", "active, but another tool keeps its declaration out of requests"];
    case "deferred":
      return ["deferred", "not declared to the model", reachFact(reach, "toolSearch")];
    case "codemode":
      return ["codemode", "not declared to the model", reachFact(reach, "codemode")];
    case "off":
      return ["off", "not declared to the model"];
    case "hidden":
      return ["hidden", "never declared: pi does not activate hidden tools"];
  }
}

/** Where the tool comes from, most specific first; the path is the one pi recorded. */
export function sourceFactsOf(entry: ToolEntry, home: string): string[] {
  const { origin, provenance, namespace } = entry;
  const path = displayLine(homeRelative(provenance.path, home));
  switch (origin.kind) {
    case "mcp": {
      const about = namespace !== null && namespace.description !== null && namespace.description.trim() !== "" ? [displayLine(namespace.description)] : [];
      return [`MCP server ${displayLine(origin.name)}`, ...about, `registered by ${path}`];
    }
    case "built-in":
      return ["built into pi", path];
    case "sdk":
      return ["passed in through the SDK", path];
    case "extension":
      return [`extension ${displayLine(origin.name)}`, `${provenance.scope} scope`, path];
    case "package":
      return [`package ${displayLine(origin.name)}`, `${provenance.scope} scope`, path];
  }
}

/** Where the ratios of an estimate come from, so a figure is not read as a provider's count. */
export function basisText(basis: TokenBasis, model: SessionModel | null): string {
  if (basis.measuredFor !== null) return `measured for ${basis.measuredFor} models`;
  return model === null ? "pi's rule: no model is selected" : `pi's rule: nothing measured for ${displayLine(model.id)}`;
}

/** One sentence for output without a detail view to explain the estimates in. */
export function basisLine(basis: TokenBasis, model: SessionModel | null): string {
  const ratios = basis.declaration === basis.promptLine ? `${basis.declaration} characters per token`
    : `${basis.declaration} characters per token for declarations, ${basis.promptLine} for prompt lines`;
  return `Estimates: ${ratios}; ${basisText(basis, model)}.`;
}

/** The estimate, then its two parts with the ratio each was divided by, then where the ratios come from. */
export function costFacts(entry: ToolEntry, basis: TokenBasis, model: SessionModel | null): string[] {
  const total = tokenText(totalTokens(entry.cost));
  const headline = isCharged(entry) ? total
    : entry.state === "indirect" ? `${total}, not charged while its declaration is withheld`
    : entry.state === "hidden" ? `${total}, never charged`
    : `${total} if loaded`;
  const promptLines = entry.promptLines.snippet === null && entry.promptLines.guidelines.length === 0 ? "no prompt lines"
    : entry.cost.promptLines === 0 ? "prompt lines not sent"
    : `prompt lines ${tokenText(entry.cost.promptLines)} at ${basis.promptLine}`;
  return [headline, `declaration ${tokenText(entry.cost.declaration)} at ${basis.declaration} characters per token`, promptLines, basisText(basis, model)];
}

/** The author's hints in words, or `null` when none is stated. */
export function hintFacts(entry: ToolEntry): string[] | null {
  const hints = entry.hints;
  if (hints === null) return null;
  const stated = [
    hints.readOnly === null ? null : hints.readOnly ? "read-only" : "writes",
    hints.destructive === null ? null : hints.destructive ? "destructive" : "not destructive",
    hints.idempotent === null ? null : hints.idempotent ? "idempotent" : "not idempotent",
    hints.openWorld === null ? null : hints.openWorld ? "open world" : "closed world",
  ].filter((hint): hint is string => hint !== null);
  return stated.length === 0 ? null : [...stated, "stated by its author, unverified"];
}

export interface Notice {
  text: string;
  state: UiState;
}

const REFUSAL_TEXT: Readonly<Record<Refusal, (name: string) => string>> = {
  "unknown-tool": (name) => `${name} is no longer registered.`,
  hidden: (name) => `${name} is hidden: pi does not activate hidden tools.`,
  "already-active": (name) => `${name} is already active.`,
  "not-active": (name) => `${name} is not active.`,
  "not-activated": (name) => `pi did not activate ${name}: this session's --tools selection excludes it.`,
  "not-deactivated": (name) => `pi kept ${name} active.`,
};

/** What the change means for the model: nothing, when it happened and was undone between two requests. */
function outcome(result: Exclude<ActivationResult, { kind: "refused" }>): string {
  const { entry } = result;
  if (result.kind === "unloaded") {
    return entry.delivery === "removal-pending" ? "dropped from the declarations with the next request" : "it had not been declared to the model yet";
  }
  if (entry.delivery === "withheld") return "active, but another tool keeps its declaration out of requests";
  const cost = `(${tokenText(totalTokens(entry.cost))} tok)`;
  return entry.delivery === "declared" ? `still declared to the model ${cost}` : `declared to the model from the next request ${cost}`;
}

export function activationNotice(result: ActivationResult): Notice {
  if (result.kind === "refused") return { text: REFUSAL_TEXT[result.reason](displayLine(result.name)), state: "attention" };
  const verb = result.kind === "loaded" ? "Loaded" : "Unloaded";
  return { text: `${verb} ${displayLine(result.entry.name)}: ${outcome(result)}.`, state: "ok" };
}

/** `~11.8k tok active` and, with a model, `1.2% of 1M`. */
export function budgetText(summary: CatalogSummary, model: SessionModel | null): { tokens: string; share: string | null } {
  return {
    tokens: `${tokenText(summary.chargedTokens)} tok active`,
    share: summary.windowShare === null || model === null ? null : shareText(summary.windowShare, model),
  };
}
