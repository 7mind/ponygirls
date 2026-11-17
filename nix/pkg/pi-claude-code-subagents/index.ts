import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { BackendOffer, BackendOfferResult } from "ponygirls-subagents/src/backend-contract.ts";
import { ClaudeExecutor } from "./executor/claude-cli.ts";
import { createClaudeBackend, CLAUDE_API_ID, CLAUDE_PROVIDER_ID } from "./src/backend.ts";
import { nativeCapability } from "./src/native-contract.ts";
import type { NativeInferenceService } from "./src/native-service.ts";

const REQUEST_CHANNEL = "ponygirls-subagents:backend-request.v1";
const OFFER_CHANNEL = "ponygirls-subagents:backend-offer.v1";

export default function (pi: ExtensionAPI): void {
  const executor = new ClaudeExecutor();
  const sessions = new Set<NativeInferenceService>();
  let currentContext: ExtensionContext | null = null;
  let active = true;
  let registration: BackendOfferResult | null = null;
  let failure: string | null = null;
  const assertActive = (): void => {
    if (!active) throw new Error("MODEL_UNAVAILABLE: Claude Code subagents addon was revoked");
    if (failure !== null) throw new Error(`MODEL_UNAVAILABLE: ${failure}`);
  };
  const currentRegistry = (): ExtensionContext["modelRegistry"] => {
    if (!active) throw new Error("MODEL_UNAVAILABLE: Claude Code subagents addon was revoked");
    if (currentContext === null) throw new Error("MODEL_UNAVAILABLE: Claude Code subagents session is not bound");
    return currentContext.modelRegistry;
  };
  const backend = createClaudeBackend(currentRegistry, executor, sessions, assertActive);
  const offer = (): void => {
    if (!active || registration !== null) return;
    const request: BackendOffer = {
      version: 1, registration: backend,
      respond: (result) => {
        if (registration !== null) { failure = "multiple subagents backend hosts acknowledged one addon"; if (result.ok) result.unregister(); return; }
        registration = result;
        if (!result.ok) failure = result.error;
      },
    };
    pi.events.emit(OFFER_CHANNEL, request);
  };
  const unsubscribe = pi.events.on(REQUEST_CHANNEL, (request) => {
    if (typeof request === "object" && request !== null && (request as { version?: unknown }).version === 1) offer();
  });
  offer();
  pi.on("session_start", (_event, ctx) => {
    currentContext = ctx;
    offer();
    if (registration === null) failure = "pi-claude-code-subagents requires ponygirls-subagents";
    try {
      nativeCapability(ctx.modelRegistry.getRegisteredNativeProvider(CLAUDE_PROVIDER_ID), CLAUDE_API_ID);
      assertActive();
    } catch (error) {
      failure = error instanceof Error ? error.message : "incompatible Claude Code provider";
      ctx.ui.notify(`pi-claude-code-subagents unavailable: ${failure}`, "error");
    }
  });
  pi.on("session_shutdown", async () => {
    active = false;
    unsubscribe();
    if (registration !== null && registration.ok) registration.unregister();
    for (const service of sessions) service.cancel();
    const outcomes = await Promise.allSettled([...sessions].map((service) => Promise.resolve().then(() => service.dispose())));
    const cleanup = await Promise.allSettled([executor.closeClaudeProcesses()]);
    currentContext = null;
    const failures = [...outcomes, ...cleanup].filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
    if (failures.length > 0) throw new AggregateError(failures.map((outcome) => outcome.reason as unknown), "Claude Code subagents cleanup failed");
  });
}
