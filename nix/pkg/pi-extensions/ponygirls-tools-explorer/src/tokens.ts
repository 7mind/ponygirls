/**
 * Token estimates. pi has no tokenizer: it counts context it has no provider
 * usage for at four characters per token, and so does this pane. The figures
 * are sizes to compare, not what a provider bills.
 */
import type { PromptLines, ToolDeclaration } from "./registry.ts";

/** The ratio of pi's own `estimateTokens`. */
export const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** What pi's estimate counts for a system message that declares only this tool. */
export function declarationTokens(declaration: ToolDeclaration): number {
  const { name, description, parameters } = declaration;
  return estimateTokens(JSON.stringify([{ name, description, parameters }]));
}

/** The tool's lines in the default system prompt, as pi renders them. */
export function promptLineText(name: string, lines: PromptLines): string {
  const snippet = lines.snippet === null ? [] : [`- ${name}: ${lines.snippet}`];
  return [...snippet, ...lines.guidelines.map((guideline) => `- ${guideline}`)].map((line) => `${line}\n`).join("");
}

export function promptLineTokens(name: string, lines: PromptLines): number {
  return estimateTokens(promptLineText(name, lines));
}
