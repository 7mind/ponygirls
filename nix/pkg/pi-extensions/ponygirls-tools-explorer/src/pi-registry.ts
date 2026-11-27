/** The registry of a live pi session, read through the extension API. */
import { getCurrentTools } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ToolInfo } from "@earendil-works/pi-coding-agent";
import type { JsonSchema, PromptLines, RegisteredTool, RegistrySnapshot, ToolDeclaration, ToolRegistry } from "./registry.ts";

export type PiTools = Pick<ExtensionAPI, "getAllTools" | "getActiveTools" | "setActiveTools">;
/** A command context: only commands can read the prompt options. */
export type PiSession = Pick<ExtensionCommandContext, "getSystemPromptOptions" | "sessionManager" | "model">;

interface Transcript {
  leafId: string | null;
  declared: ReadonlyMap<string, ToolDeclaration>;
}

function registeredTool(tool: ToolInfo): RegisteredTool {
  const { namespace, annotations, sourceInfo } = tool;
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters as JsonSchema,
    exposure: tool.exposure,
    namespace: namespace === undefined ? null : { name: namespace.name, description: namespace.description ?? null },
    hints: annotations === undefined ? null : {
      readOnly: annotations.readOnlyHint ?? null,
      destructive: annotations.destructiveHint ?? null,
      idempotent: annotations.idempotentHint ?? null,
      openWorld: annotations.openWorldHint ?? null,
    },
    provenance: { path: sourceInfo.path, source: sourceInfo.source, scope: sourceInfo.scope, origin: sourceInfo.origin, baseDir: sourceInfo.baseDir ?? null },
  };
}

export class PiToolRegistry implements ToolRegistry {
  private readonly tools: PiTools;
  private readonly session: PiSession;
  private transcript: Transcript | null = null;

  constructor(tools: PiTools, session: PiSession) {
    this.tools = tools;
    this.session = session;
  }

  /** Replaying the transcript walks the whole branch; it only changes when the branch does. */
  private declared(): ReadonlyMap<string, ToolDeclaration> {
    const leafId = this.session.sessionManager.getLeafId();
    if (this.transcript === null || this.transcript.leafId !== leafId) {
      const tools = getCurrentTools(this.session.sessionManager.buildSessionProjection().messages);
      this.transcript = {
        leafId,
        declared: new Map(tools.map((tool) => [tool.name, { name: tool.name, description: tool.description, parameters: tool.parameters as JsonSchema }])),
      };
    }
    return this.transcript.declared;
  }

  snapshot(): RegistrySnapshot {
    const options = this.session.getSystemPromptOptions();
    const model = this.session.model;
    const snippets = options.toolSnippets ?? {};
    const guidelines = options.toolGuidelines ?? {};
    const promptLines = new Map<string, PromptLines>();
    for (const name of new Set([...Object.keys(snippets), ...Object.keys(guidelines)])) {
      promptLines.set(name, { snippet: snippets[name] ?? null, guidelines: guidelines[name] ?? [] });
    }
    return {
      tools: this.tools.getAllTools().map(registeredTool),
      active: this.tools.getActiveTools(),
      withheld: options.hiddenTools ?? [],
      promptLines,
      // A custom prompt replaces the default one, which is where the tool list and the rules are.
      promptLinesSent: !options.customPrompt,
      declared: this.declared(),
      model: model === undefined ? null : { api: model.api, contextWindow: model.contextWindow },
    };
  }

  setActive(names: readonly string[]): void {
    this.tools.setActiveTools([...names]);
  }
}
