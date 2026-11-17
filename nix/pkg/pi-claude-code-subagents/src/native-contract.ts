import type { Api, AssistantMessageEventStream, Model, SimpleStreamOptions, TranscriptContext } from "@earendil-works/pi-ai";
import type { RunClaudeInput, RunClaudeOutput } from "../executor/claude-cli.ts";

export const NATIVE_DELEGATION = "pi-claude-code.execution.v1";
export const NATIVE_CAPABILITY = Symbol.for(NATIVE_DELEGATION);
export const NATIVE_PROFILE = "canonical-simple-no-provider-hooks-v1";

export interface NativeDelegationV1 {
  readonly version: 1;
  readonly apis: readonly string[];
  readonly requestProfile: typeof NATIVE_PROFILE;
}

export interface NativeExecution {
  readonly cwd: string;
  readonly signal: AbortSignal;
  beforeEntry(): void;
  run(input: RunClaudeInput): Promise<RunClaudeOutput>;
  captureOriginal(stream: AssistantMessageEventStream): AssistantMessageEventStream;
  track<T>(pending: Promise<T>): Promise<T>;
}

export interface NativeRequestContext {
  readonly capability: NativeDelegationV1;
  readonly execution: NativeExecution;
}

export interface NativeBinding {
  readonly capability: NativeDelegationV1;
  readonly model: Model<Api>;
  assertCurrent(): void;
  stream(context: TranscriptContext, options: SimpleStreamOptions): AssistantMessageEventStream;
}

export function nativeCapability(provider: unknown, api: string): NativeDelegationV1 {
  const value: unknown = typeof provider === "object" && provider !== null ? Reflect.get(provider, NATIVE_CAPABILITY) : undefined;
  if (typeof value !== "object" || value === null) throw new Error("MODEL_UNAVAILABLE: Claude Code provider has no execution capability");
  const cap = value as NativeDelegationV1;
  if (cap.version !== 1 || cap.requestProfile !== NATIVE_PROFILE || !Array.isArray(cap.apis) || !cap.apis.includes(api)) throw new Error("MODEL_UNAVAILABLE: incompatible Claude Code execution capability");
  return cap;
}
