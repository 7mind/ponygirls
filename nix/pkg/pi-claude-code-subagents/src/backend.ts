import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { BackendJson, BackendRegistration } from "ponygirls-subagents/src/backend-contract.ts";
import { ClaudeExecutor } from "../executor/claude-cli.ts";
import { NativeModels } from "./models.ts";
import { NativeInferenceService } from "./native-service.ts";

export const CLAUDE_BACKEND_ID = "pi-claude-code-subagents";
export const CLAUDE_PROVIDER_ID = "claude-code";
export const CLAUDE_API_ID = "claude-code-stream-json";

export function createClaudeBackend(currentRegistry: () => ModelRegistry, executor: ClaudeExecutor, sessions: Set<NativeInferenceService>, assertActive: () => void): BackendRegistration {
  const models = new NativeModels(currentRegistry);
  return {
    id: CLAUDE_BACKEND_ID, version: 1, usageOwnership: "parent",
    claims: (selected) => {
      if (selected.provider !== CLAUDE_PROVIDER_ID) return false;
      const model = currentRegistry().find(selected.provider, selected.id);
      return model === undefined || model.api === CLAUDE_API_ID;
    },
    worker: (selected) => {
      assertActive();
      return { version: 1, backendId: CLAUDE_BACKEND_ID, moduleUrl: new URL("./worker.ts", import.meta.url).href, initialization: models.describe(selected) as unknown as BackendJson };
    },
    createSession: (context) => {
      assertActive();
      const admitted = models.describe(context.model);
      const service = new NativeInferenceService({
        ...context,
        binding: () => { assertActive(); return models.nativeBinding(admitted); },
        run: (input) => { assertActive(); return executor.runClaudeRequest(input); },
      });
      sessions.add(service);
      return {
        handle: (payload, envelope) => { assertActive(); return service.handle(payload, envelope); },
        cancel: () => service.cancel(),
        refreshAuthority: () => service.refreshAuthority(),
        dispose: async () => { await service.dispose(); sessions.delete(service); },
      };
    },
  };
}
