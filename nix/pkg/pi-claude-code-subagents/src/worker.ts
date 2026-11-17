import type { Api, Model } from "@earendil-works/pi-ai";
import type { BackendWorkerAdapter } from "ponygirls-subagents/src/backend-contract.ts";
import { nativeModelProxy } from "./native-proxy.ts";

export const createBackendProvider: BackendWorkerAdapter["createBackendProvider"] = ({ model, initialization, createRoundTrip }) => {
  if (typeof initialization !== "object" || initialization === null || Array.isArray(initialization)) throw new Error("INVALID: Claude Code worker model descriptor");
  const descriptor = initialization as unknown as Model<Api>;
  if (descriptor.provider !== model.provider || descriptor.id !== model.id || typeof descriptor.api !== "string" || typeof descriptor.baseUrl !== "string") throw new Error("POLICY_DENIED: Claude Code worker model is not admitted");
  return nativeModelProxy(descriptor, createRoundTrip);
};
