import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { search } from "./search.ts";

const TOOL_NAME = "ast_grep_search";
const DELEGATED_CALL_CHANNEL = "ponygirls-subagents:prepare-delegated-call";
interface DelegatedCallEvent {
  readonly toolName: string;
  readonly input: object;
  readonly cwd: string;
  waitUntil(work: Promise<void>): void;
}

export default function astGrepExtension(pi: ExtensionAPI): void {
  const binaries = {
    astGrep: process.env.PONYGIRLS_AST_GREP_BIN ?? "ast-grep",
    git: process.env.PONYGIRLS_AST_GREP_GIT_BIN ?? "git",
  };
  const callerDirectories = new WeakMap<object, string>();
  // The dispatcher forwards this validated copy verbatim after preparation. Keep
  // the caller's cwd out of model arguments and never use the parent's cwd for it.
  pi.events.on(DELEGATED_CALL_CHANNEL, (data) => {
    const event = data as DelegatedCallEvent;
    if (event.toolName !== TOOL_NAME) return;
    callerDirectories.set(event.input, event.cwd);
    event.waitUntil(Promise.resolve());
  });

  pi.registerTool({
    name: TOOL_NAME,
    label: "ast-grep search",
    description: "Find syntax shapes in files without an index. Not a call graph or type-aware usage search. Zero matches do not establish absence; cross-check with rg.",
    promptSnippet: "Search syntax shapes in the current worktree with ast-grep",
    promptGuidelines: [
      "Use ast_grep_search for constructs such as nested or multiline calls. Use CodeGraph for symbols and call paths, and grep for text. Cross-check unexpected misses with grep.",
    ],
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    parameters: Type.Object({
      lang: Type.String({ minLength: 1, maxLength: 40, description: "Built-in ast-grep language alias, e.g. go, python, ts or tsx (separate grammars)." }),
      pattern: Type.String({ minLength: 1, maxLength: 4096, description: "Source pattern with optional metavariables $NAME or $$$ARGS. May include enclosing syntax when selector is set." }),
      path: Type.Optional(Type.String({ minLength: 1, maxLength: 4096, description: "File or directory, relative to the caller's cwd or absolute inside its checkout. Defaults to the caller's cwd. Recursive scans skip hidden directories and ignored files; name a hidden directory to search it." })),
      selector: Type.Optional(Type.String({ minLength: 1, maxLength: 128, description: "Select a Tree-sitter node kind inside the pattern's enclosing syntax, e.g. call_expression for a call in a Go function body." })),
    }, { additionalProperties: false }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const cwd = callerDirectories.get(params) ?? ctx.cwd;
      callerDirectories.delete(params);
      const text = await search(pi.exec, binaries, cwd, params, signal);
      return { content: [{ type: "text", text }], details: undefined };
    },
  });
}
