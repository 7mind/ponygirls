/**
 * Token estimates. pi has no tokenizer, and providers count the same tool
 * declarations very differently: Claude models report about twice as many
 * tokens for them as GPT models. The estimate is therefore characters over a
 * ratio measured for the model's family, or pi's own ratio where none was
 * measured. calibration/live-calibration.ts measures the ratios again;
 * README.md has the method.
 */
import type { PromptLines, ToolDeclaration } from "./registry.ts";

/** Characters per token, for tool declarations (JSON) and for the tool lines of the system prompt. */
export interface TokenBasis {
  declaration: number;
  promptLine: number;
  /** The model family the ratios were measured for; `null` for pi's own rule. */
  measuredFor: string | null;
}

/** The ratio of pi's own `estimateTokens`, which it applies to everything. */
export const PI_CHARS_PER_TOKEN = 4;
export const PI_BASIS: TokenBasis = { declaration: PI_CHARS_PER_TOKEN, promptLine: PI_CHARS_PER_TOKEN, measuredFor: null };

interface MeasuredFamily {
  /** The model ids of the family, under whatever provider and namespace. */
  ids: RegExp;
  basis: TokenBasis;
}

/**
 * From the prompt tokens providers reported for pi requests that differ only
 * in a sample of tool declarations or of prompt lines
 * (calibration/live-calibration.ts; README.md, "Token estimates"). Measured
 * 2026-11-27 with pi 1.5.2. The ratio varied a little between samples of real
 * tools; each value is the middle of what was seen:
 * - Claude (claude-haiku-5-5 and claude-fable-5-2): declarations 2.64 to 2.77,
 *   prompt lines 3.06 to 3.10.
 * - GPT (gpt-6.2): declarations 5.30 to 5.48, prompt lines 4.97 to 5.00.
 *
 * A family is recognized by the model's id, not by pi's API name: a gateway
 * serves Claude under an API name of its own, and Anthropic-compatible APIs
 * also serve other vendors' models, for which nothing was measured.
 */
const MEASURED_FAMILIES: readonly MeasuredFamily[] = [
  { ids: /(?:^|[/.])claude-/i, basis: { declaration: 2.7, promptLine: 3.1, measuredFor: "Claude" } },
  { ids: /(?:^|[/.])gpt-\d/i, basis: { declaration: 5.4, promptLine: 5, measuredFor: "GPT" } },
];

/** The basis for a model, by its id; pi's rule without a model or without a measurement for its family. */
export function basisFor(modelId: string | null): TokenBasis {
  const family = modelId === null ? undefined : MEASURED_FAMILIES.find((candidate) => candidate.ids.test(modelId));
  return family === undefined ? PI_BASIS : family.basis;
}

export function estimateTokens(text: string, charsPerToken: number): number {
  return Math.ceil(text.length / charsPerToken);
}

/** The JSON pi puts into a system message that declares only this tool. */
export function declarationText(declaration: ToolDeclaration): string {
  const { name, description, parameters } = declaration;
  return JSON.stringify([{ name, description, parameters }]);
}

export function declarationTokens(declaration: ToolDeclaration, basis: TokenBasis): number {
  return estimateTokens(declarationText(declaration), basis.declaration);
}

/** The tool's lines in the default system prompt, as pi renders them. */
export function promptLineText(name: string, lines: PromptLines): string {
  const snippet = lines.snippet === null ? [] : [`- ${name}: ${lines.snippet}`];
  return [...snippet, ...lines.guidelines.map((guideline) => `- ${guideline}`)].map((line) => `${line}\n`).join("");
}

export function promptLineTokens(name: string, lines: PromptLines, basis: TokenBasis): number {
  return estimateTokens(promptLineText(name, lines), basis.promptLine);
}
