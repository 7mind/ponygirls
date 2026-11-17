import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import { nativeCapability, type NativeBinding } from "./native-contract.ts";

const MODEL_FIELDS = ["type", "id", "name", "api", "provider", "baseUrl", "input", "inputLimits", "cost", "reasoning", "thinkingLevelMap", "promptCache", "contextWindow", "maxTokens", "samplingParams", "samplingParamsByThinkingLevel", "compat"] as const;

type ParentRegistry = Pick<ModelRegistry, "find" | "getRegisteredNativeProvider" | "streamSimple">;

export class NativeModels {
  private readonly currentRegistry: () => ParentRegistry;

  constructor(currentRegistry: () => ParentRegistry) { this.currentRegistry = currentRegistry; }

  describe(selected: { provider: string; id: string }): Model<Api> {
    const registry = this.currentRegistry();
    const model = registry.find(selected.provider, selected.id);
    if (model === undefined) throw new Error("MODEL_UNAVAILABLE: selected Claude Code model is unavailable");
    nativeCapability(registry.getRegisteredNativeProvider(selected.provider), model.api);
    return JSON.parse(JSON.stringify(Object.fromEntries(MODEL_FIELDS.filter((field) => model[field] !== undefined).map((field) => [field, model[field]])))) as Model<Api>;
  }

  nativeBinding(admitted: Model<Api>): NativeBinding {
    const registry = this.currentRegistry();
    const raw = registry.getRegisteredNativeProvider(admitted.provider);
    const capability = nativeCapability(raw, admitted.api);
    const model = registry.find(admitted.provider, admitted.id);
    if (model === undefined) throw new Error("MODEL_UNAVAILABLE: selected Claude Code model is unavailable");
    const identity = JSON.stringify(this.describe(admitted));
    if (identity !== JSON.stringify(admitted)) throw new Error("MODEL_UNAVAILABLE: Claude Code model metadata changed; reload the worker");
    const assertCurrent = (): void => {
      if (this.currentRegistry() !== registry || registry.getRegisteredNativeProvider(admitted.provider) !== raw || nativeCapability(raw, admitted.api) !== capability || JSON.stringify(this.describe(admitted)) !== identity) throw new Error("MODEL_UNAVAILABLE: Claude Code provider registration changed; reload the worker");
    };
    return { capability, model, assertCurrent, stream: (context, options) => { assertCurrent(); return registry.streamSimple(model, context, options); } };
  }
}
