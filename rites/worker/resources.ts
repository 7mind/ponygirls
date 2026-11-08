// The Rites worker resource loader. Resource discovery is deliberately absent:
// no extensions, no project or personal skills, prompts, themes, context files
// or agent instruction files are loaded, so repository-controlled files can
// never become executable configuration. The system prompt is fixed here.

import {
  createExtensionRuntime,
  type ExtensionRuntime,
  type LoadExtensionsResult,
  type ResourceLoader,
} from "@earendil-works/pi-coding-agent";

export const RITES_SYSTEM_PROMPT = `You are a Rites repository agent. You run unattended inside an isolated
Linux sandbox whose working directory is the repository workspace for this run.
Follow the run prompt and make the requested changes to the workspace using the
provided read, bash, edit, write, grep, find and ls tools. There is no
interactive user: never ask questions, and finish the run by completing the
work and stopping.`;

export function isolatedResourceLoader(): ResourceLoader {
  const emptyRuntime: ExtensionRuntime = createExtensionRuntime();
  const extensions: LoadExtensionsResult = { extensions: [], errors: [], runtime: emptyRuntime };
  return {
    getExtensions: () => extensions,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => RITES_SYSTEM_PROMPT,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {
      // Resource extension is not available to a Rites run.
    },
    reload: async () => {
      // Nothing is discovered, so there is nothing to reload.
    },
  };
}
