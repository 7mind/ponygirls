/**
 * pi-subagents — deterministic provider driver for development/tests.
 *
 * Registers a scripted `test-sim` provider through the real ModelRuntime
 * extension-provider path (ProviderConfigInput.streamSimple), so SDK
 * integration — listener registration, proxy execution, agent_settled,
 * tool-call/result pairing, retry/compaction boundaries — is exercised
 * without provider credentials and without network. The script can request
 * tools, pause at controlled boundaries, emit errors, and generate context
 * volume.
 *
 * Paid/live-provider tests remain opt-in and separate.
 */

export type ScriptStep =
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; args: Record<string, unknown> }
  | { kind: "batch"; calls: Array<{ name: string; args: Record<string, unknown> }> }
  | { kind: "error"; message: string };

export interface DeterministicModelRuntime {
  registerProvider: (id: string, config: Record<string, unknown>) => void;
  getModel: (provider: string, id: string) => Record<string, unknown> | undefined;
}

interface EventStreamCtor {
  new (
    isTerminal: (e: { type: string }) => boolean,
    getResult: (e: { type: string; message?: unknown; error?: unknown }) => unknown,
  ): { push: (e: unknown) => void };
}
export const SIM_PROVIDER = "test-sim";
export const SIM_MODEL = "sim-1";

function usage(): Record<string, unknown> {
  return {
    input: 10,
    output: 5,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 15,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function assistantText(text: string): Record<string, unknown> {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-responses",
    provider: SIM_PROVIDER,
    model: SIM_MODEL,
    usage: usage(),
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

let toolCallSeq = 1;

function assistantToolCall(name: string, args: Record<string, unknown>): Record<string, unknown> {  return {
    role: "assistant",
    content: [{ type: "toolCall", id: `sim-${toolCallSeq++}`, name, arguments: args }],
    api: "openai-responses",
    provider: SIM_PROVIDER,
    model: SIM_MODEL,
    usage: usage(),
    stopReason: "toolUse",
    timestamp: Date.now(),
  };
}

/**
 * Register the scripted provider on a real ModelRuntime. Consumes one script
 * step per model turn; extra turns receive a terminal text step.
 */
export function registerDeterministicProvider(
  runtime: DeterministicModelRuntime,
  EventStream: EventStreamCtor,
  steps: ScriptStep[],
): { provider: string; id: string } {
  let index = 0;
  runtime.registerProvider(SIM_PROVIDER, {
    api: "openai-responses",
    apiKey: "deterministic",
    baseUrl: "https://example.invalid",
    streamSimple: () => {
      const step: ScriptStep = index < steps.length ? steps[index++]! : { kind: "text", text: "done" };
      const stream = new EventStream(
        (e) => e.type === "done" || e.type === "error",
        (e) => {
          const ev = e as { type: string; message?: unknown; error?: unknown };
          if (ev.type === "done") return ev.message;
          if (ev.type === "error") return ev.error;
          throw new Error("unexpected event type");
        },
      );
      queueMicrotask(() => {
        if (step.kind === "text") {
          stream.push({ type: "done", reason: "stop", message: assistantText(step.text) });
        } else if (step.kind === "tool") {
          stream.push({ type: "done", reason: "toolUse", message: assistantToolCall(step.name, step.args) });
        } else if (step.kind === "batch") {
          const calls = step.calls.map((c) => ({ type: "toolCall" as const, id: `sim-${toolCallSeq++}`, name: c.name, arguments: c.args }));
          stream.push({
            type: "done",
            reason: "toolUse",
            message: {
              role: "assistant",
              content: calls,
              api: "openai-responses",
              provider: SIM_PROVIDER,
              model: SIM_MODEL,
              usage: usage(),
              stopReason: "toolUse",
              timestamp: Date.now(),
            },
          });
        } else {
          // Provider failures end with stopReason "error" and an errorMessage, as real providers report them.
          stream.push({ type: "error", reason: "error", error: { ...assistantText(""), content: [], stopReason: "error", errorMessage: step.message } });
        }
      });
      return stream;
    },
    models: [
      {
        type: "chat",
        id: SIM_MODEL,
        name: "deterministic sim",
        api: "openai-responses",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 32768,
        maxTokens: 4096,
      },
    ],
  });
  return { provider: SIM_PROVIDER, id: SIM_MODEL };
}
