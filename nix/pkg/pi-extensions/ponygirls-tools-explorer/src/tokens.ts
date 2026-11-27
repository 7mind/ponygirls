/**
 * Token estimates. pi has no tokenizer, and what a declaration costs depends
 * on the provider: its tokenizer and the form it rewrites tool declarations
 * into. The estimate is therefore characters over a ratio measured for the
 * API family of the current model, or pi's own ratio where none was measured.
 * live-calibration.mjs measures the ratios again; README.md has the method.
 */
import type { PromptLines, ToolDeclaration } from "./registry.ts";

/** Characters per token, for tool declarations (JSON) and for the tool lines of the system prompt. */
export interface TokenBasis {
  declaration: number;
  promptLine: number;
  /** `measured` for the API family of the model, `pi` for pi's own rule. */
  source: "measured" | "pi";
}

/** The ratio of pi's own `estimateTokens`, which it applies to everything. */
export const PI_CHARS_PER_TOKEN = 4;
export const PI_BASIS: TokenBasis = { declaration: PI_CHARS_PER_TOKEN, promptLine: PI_CHARS_PER_TOKEN, source: "pi" };

/**
 * Provider-reported prompt tokens of requests that differ only in the declared
 * tools or in a block of prompt lines, 2026-11-27 (README.md, "Token estimates"):
 * - anthropic-messages: claude-haiku-5-5 and claude-fable-5-2, 195 declarations
 *   of 290,459 characters for 107,664 tokens; prompt lines 5,622 for 1,811.
 * - openai-codex-responses: gpt-6.2, 75 declarations of 110,518 characters for
 *   20,565 tokens; prompt lines 5,622 for 1,124.
 */
export const MEASURED_BASES: Readonly<Record<string, TokenBasis>> = {
  "anthropic-messages": { declaration: 2.7, promptLine: 3.1, source: "measured" },
  "openai-codex-responses": { declaration: 5.4, promptLine: 5, source: "measured" },
};

/** The basis for a model's API family (pi's `model.api`); pi's rule without a model or a measurement. */
export function basisFor(api: string | null): TokenBasis {
  return api !== null && Object.hasOwn(MEASURED_BASES, api) ? MEASURED_BASES[api]! : PI_BASIS;
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
