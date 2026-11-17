import type * as Ai from "@earendil-works/pi-ai";
import type { ParentModelProvider } from "./parent-models.ts";
import type { IpcEnvelope } from "./protocol.ts";
import type { ResolvedModel } from "./types.ts";

export const BACKEND_REQUEST_CHANNEL = "ponygirls-subagents:backend-request.v1";
export const BACKEND_OFFER_CHANNEL = "ponygirls-subagents:backend-offer.v1";
export const BACKEND_INITIALIZATION_BYTES = 64 * 1024;

export type BackendJson = null | boolean | number | string | BackendJson[] | { [key: string]: BackendJson };

export interface BackendWorkerDescriptor {
  readonly version: 1;
  readonly backendId: string;
  readonly moduleUrl: string;
  readonly initialization: BackendJson;
}

export interface BackendUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number | null;
  reasoning?: number;
  unknown: boolean;
  sourceModel?: { provider: string; id: string; api: string };
}

export interface BackendSessionContext {
  readonly model: ResolvedModel;
  readonly cwd: string;
  assertOwner(envelope: IpcEnvelope): void;
  receipt(envelope: IpcEnvelope, receiptId: string, usage: BackendUsage): boolean;
}

export interface BackendSession {
  handle(payload: unknown, envelope: IpcEnvelope): Promise<unknown>;
  cancel(): void;
  refreshAuthority(): Promise<void>;
  dispose(): Promise<void>;
}

export interface BackendRegistration {
  readonly version: 1;
  readonly id: string;
  readonly usageOwnership: "worker" | "parent";
  claims(model: ResolvedModel): boolean;
  worker(model: ResolvedModel): BackendWorkerDescriptor;
  createSession(context: BackendSessionContext): BackendSession;
}

export type BackendOfferResult = { ok: true; unregister(): void } | { ok: false; error: string };

export interface BackendOffer {
  readonly version: 1;
  readonly registration: BackendRegistration;
  respond(result: BackendOfferResult): void;
}

export interface BackendBus {
  on(channel: string, handler: (value: unknown) => void): () => void;
  emit(channel: string, value: unknown): void;
}

export interface BackendWorkerAdapter {
  createBackendProvider(options: {
    readonly model: ResolvedModel;
    readonly initialization: BackendJson;
    readonly sdk: typeof Ai;
    createRoundTrip(): (payload: unknown) => Promise<unknown>;
  }): ParentModelProvider | Promise<ParentModelProvider>;
}

export function parseBackendWorker(value: unknown): BackendWorkerDescriptor {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("INVALID: backend worker descriptor");
  const descriptor = value as BackendWorkerDescriptor;
  if (descriptor.version !== 1 || typeof descriptor.backendId !== "string" || descriptor.backendId.length === 0 || typeof descriptor.moduleUrl !== "string") throw new Error("INVALID: backend worker identity");
  let url: URL;
  try { url = new URL(descriptor.moduleUrl); } catch { throw new Error("INVALID: backend worker module URL"); }
  if (url.protocol !== "file:" || url.host !== "" || url.search !== "" || url.hash !== "") throw new Error("INVALID: backend worker module must be a local trusted file");
  const encoded = JSON.stringify(descriptor.initialization, (_key, entry: unknown) => {
    if (typeof entry === "function" || typeof entry === "symbol" || typeof entry === "bigint" || entry === undefined || (typeof entry === "number" && !Number.isFinite(entry))) throw new Error("INVALID: backend initialization must be JSON");
    return entry;
  });
  if (encoded === undefined || Buffer.byteLength(encoded, "utf8") > BACKEND_INITIALIZATION_BYTES) throw new Error("PAYLOAD_TOO_LARGE: backend initialization exceeds its bound");
  return { version: 1, backendId: descriptor.backendId, moduleUrl: descriptor.moduleUrl, initialization: JSON.parse(encoded) as BackendJson };
}
