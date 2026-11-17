import type { Api, AssistantMessageEventStream, Model, SimpleStreamOptions, TranscriptContext } from "@earendil-works/pi-ai";

import { err } from "./errors.ts";

export const NATIVE_DELEGATION = "ponygirls.nativeDelegation.v1";
export const NATIVE_CAPABILITY = Symbol.for(NATIVE_DELEGATION);
export const NATIVE_PROFILE = "canonical-simple-no-provider-hooks-v1";

export interface NativeDelegationV1 {
  readonly version: 1;
  readonly apis: readonly string[];
  readonly requestProfile: typeof NATIVE_PROFILE;
  disposeSession(lifecycleSessionId: string): Promise<void>;
}

export interface NativeRequestContext {
  readonly capability: NativeDelegationV1;
  readonly cwd: string;
  readonly lifecycleSessionId: string;
  beforeEntry(actualCapability: NativeDelegationV1): void;
  captureOriginal(stream: AssistantMessageEventStream): AssistantMessageEventStream;
}

export interface NativeBinding {
  readonly capability: NativeDelegationV1;
  readonly model: Model<Api>;
  assertCurrent(): void;
  stream(context: TranscriptContext, options: SimpleStreamOptions): AssistantMessageEventStream;
}

export function nativeCapability(provider: unknown, api: string): NativeDelegationV1 {
  const value: unknown = typeof provider === "object" && provider !== null ? Reflect.get(provider, NATIVE_CAPABILITY) : undefined;
  if (typeof value !== "object" || value === null) throw err("MODEL_UNAVAILABLE", "native provider has not opted into delegation");
  const cap = value as NativeDelegationV1;
  if (cap.version !== 1 || cap.requestProfile !== NATIVE_PROFILE || !Array.isArray(cap.apis) || !cap.apis.includes(api) || typeof cap.disposeSession !== "function") throw err("MODEL_UNAVAILABLE", "incompatible native delegation capability");
  return cap;
}
