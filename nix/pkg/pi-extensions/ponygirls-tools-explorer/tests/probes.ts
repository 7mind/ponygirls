/** The contract's probe tools, registered in a real pi session. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { CONTRACT_TOOLS } from "./registry-contract.ts";

export const PROBED = { content: [{ type: "text" as const, text: "probed" }], details: undefined };

export function registerProbes(pi: ExtensionAPI): void {
  for (const tool of CONTRACT_TOOLS) {
    pi.registerTool({
      name: tool.name,
      label: tool.name,
      description: tool.description,
      parameters: tool.parameters as TSchema,
      exposure: tool.exposure,
      defaultActive: tool.activeOnRegistration,
      ...(tool.promptLines.snippet === null ? {} : { promptSnippet: tool.promptLines.snippet }),
      promptGuidelines: [...tool.promptLines.guidelines],
      execute: async () => PROBED,
    });
  }
}
