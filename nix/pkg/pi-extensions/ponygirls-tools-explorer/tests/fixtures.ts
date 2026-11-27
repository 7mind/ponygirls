import assert from "node:assert/strict";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import type { UiTheme } from "@ponygirls/pi-ui";
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
    nonTextDescription: false,
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
    model: null,
    ...overrides,
  };
}

export function declarationOf(registered: RegisteredTool): ToolDeclaration {
  return { name: registered.name, description: registered.description, parameters: registered.parameters };
}

export function declared(tools: readonly RegisteredTool[]): Map<string, ToolDeclaration> {
  return new Map(tools.map((registered) => [registered.name, declarationOf(registered)]));
}

/** Styling as visible tags (`<success>text</>`, `[selectedBg …]`, `*bold*`), for assertions on colour. */
const TAG_TOKENS: readonly string[] = ["text", "muted", "dim", "accent", "border", "borderMuted", "success", "warning", "error", "selectedBg", "customMessageBg", "toolPendingBg"];
export const TAG_THEME: UiTheme = {
  fg: (color, text) => `\x1b[38;5;${TAG_TOKENS.indexOf(color)}m${text}\x1b[39m`,
  bg: (color, text) => `\x1b[48;5;${TAG_TOKENS.indexOf(color)}m${text}\x1b[49m`,
  bold: (text) => `\x1b[1m${text}\x1b[22m`,
};

export function tags(line: string): string {
  return line
    .replace(/\x1b\[38;5;(\d+)m/g, (_match, index: string) => `<${TAG_TOKENS[Number(index)]}>`)
    .replace(/\x1b\[48;5;(\d+)m/g, (_match, index: string) => `[${TAG_TOKENS[Number(index)]} `)
    .replace(/\x1b\[39m/g, "</>").replace(/\x1b\[49m/g, "]").replace(/\x1b\[1m|\x1b\[22m/g, "*");
}

/** Rendered lines as the text a user reads: no styling, no cursor markers, no trailing blanks. */
export function plain(lines: readonly string[]): string[] {
  return lines.map((line) => stripTerminalSequences(line).trimEnd());
}

/**
 * Anything that would act on the terminal or be drawn as nothing: controls other than the line feed, format
 * characters (bidi controls, Unicode tags, zero-width characters), separators, selectors, lone surrogates.
 */
export const HIDDEN = /(?!\n)[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\p{Default_Ignorable_Code_Point}]/u;

/** Text that tries to clear the screen, set the title, reorder the line, hide in a tab and smuggle invisible words. */
export const HOSTILE = "evil\u001b[2J\u001b]0;owned\u0007\u009b31m\u202egnp\ttab\u2028end\u200b\u{e0068}\u{e0069}";

export function assertFits(lines: readonly string[], width: number, what: string): void {
  for (const line of lines) assert.ok(visibleWidth(line) <= width, `${what} at ${width}: ${visibleWidth(line)} columns: ${JSON.stringify(stripTerminalSequences(line))}`);
}

/** Nothing tool-supplied acts on the terminal or stays unseen: only the pane's own SGR styling is left. */
export function assertInert(lines: readonly string[], what: string): void {
  for (const line of lines) assert.doesNotMatch(line.replace(/\x1b\[[0-9;]*m/g, ""), HIDDEN, `${what}: ${JSON.stringify(line)}`);
}
