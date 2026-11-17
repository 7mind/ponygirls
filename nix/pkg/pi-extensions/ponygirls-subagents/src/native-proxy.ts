import type { AssistantMessage, AssistantMessageEvent, AssistantMessageEventStream, Model, Api, SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { ParentModelProvider } from "./parent-models.ts";
import { NativeRpcClient, type NativeRoundTrip } from "./native-framing.ts";

export function nativeModelProxy(model: Model<Api>, createRoundTrip: () => NativeRoundTrip): ParentModelProvider {
  const client = new NativeRpcClient();
  const matchesRequest = (selected: Model<Api>): boolean => selected.provider === model.provider && selected.id === model.id && selected.api === model.api && selected.baseUrl === model.baseUrl;
  const provider: ParentModelProvider = {
    id: model.provider, name: model.provider, baseUrl: model.baseUrl,
    getModels: () => [model], matchesRequest,
    prepareRequest: (selected, options) => {
      if (!matchesRequest(selected)) throw new Error("POLICY_DENIED: native model is not admitted");
      return { model: selected, options: options ?? {} };
    },
    auth: { apiKey: {
      name: "Parent native service",
      check: async () => ({ type: "api_key", source: "parent native service" }),
      resolve: async () => ({ auth: { apiKey: "parent-native-service" }, source: "parent native service" }),
    } },
    stream: (selected, context, options) => provider.streamSimple(selected, context, options as SimpleStreamOptions),
    streamSimple: (selected, context, options) => {
      if (!matchesRequest(selected)) throw new Error("POLICY_DENIED: native model is not admitted");
      const roundTrip = createRoundTrip();
      const nativeCall = (transport: NativeRoundTrip, value: unknown): Promise<unknown> => client.call(transport, value);
      const { reasoning, maxTokens, timeoutMs, cacheRetention, sessionId } = options ?? {};
      const started = nativeCall(roundTrip, { kind: "start", context: structuredClone(context), options: { reasoning, maxTokens, timeoutMs, cacheRetention, sessionId } }).then((value) => {
        const id = (value as { id: string }).id;
        if (typeof id !== "string") throw new Error("INVALID: missing native invocation identity");
        return id;
      });
      const cancelled = (): void => { void started.then((id) => nativeCall(roundTrip, { kind: "cancel", id })).catch(() => {}); };
      const signal = options?.signal;
      if (signal !== undefined) {
        if (signal.aborted) cancelled();
        else signal.addEventListener("abort", cancelled, { once: true });
      }
      const result = started.then((id) => nativeCall(roundTrip, { kind: "result", id })).then((value) => (value as { message: AssistantMessage }).message).finally(() => {
        if (signal !== undefined) signal.removeEventListener("abort", cancelled);
      });
      void result.catch(() => {});
      return {
        result: () => result,
        async *[Symbol.asyncIterator](): AsyncGenerator<AssistantMessageEvent> {
          const id = await started;
          for (;;) {
            const next = await nativeCall(roundTrip, { kind: "next", id }) as { done: boolean; event: AssistantMessageEvent };
            if (next.done) return;
            if (next.event.type === "done") yield { ...next.event, message: await result };
            else if (next.event.type === "error") yield { ...next.event, error: await result };
            else yield next.event;
            if (next.event.type === "done" || next.event.type === "error") return;
          }
        },
      } as unknown as AssistantMessageEventStream;
    },
  };
  return provider;
}
