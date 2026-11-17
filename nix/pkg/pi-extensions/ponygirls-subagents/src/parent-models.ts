import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { Api, Model, Provider, ProviderStreams, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { err } from "./errors.ts";
import type { ResolvedModel } from "./types.ts";

const MODEL_MAX_BYTES = 64 * 1024;
const AUTH_MAX_BYTES = 32 * 1024;
const MODEL_FIELDS = ["type", "id", "name", "api", "provider", "baseUrl", "input", "inputLimits", "cost", "reasoning", "thinkingLevelMap", "promptCache", "contextWindow", "maxTokens", "samplingParams", "samplingParamsByThinkingLevel", "compat"] as const;

export interface ProviderRequestAuth {
  apiKey?: string;
  headers?: Record<string, string | null>;
  baseUrl?: string;
  /** Provider-scoped credential environment, never the ambient parent environment. */
  env?: Record<string, string>;
}

export type ParentAuthResolution = ({ ok: true } & ProviderRequestAuth) | { ok: false; error: string };

export interface ParentModels {
  describe(model: ResolvedModel): Model<Api> | null;
  resolveAuth(model: Model<Api>): Promise<ParentAuthResolution>;
}

type ParentRegistry = Pick<ModelRegistry, "find" | "getRegisteredProviderConfig" | "getRegisteredNativeProvider" | "getApiKeyAndHeaders">;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedJson(value: unknown, limit: number): void {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value, (_key, entry: unknown) => {
      if (typeof entry === "function" || typeof entry === "symbol" || typeof entry === "bigint") throw new Error("non-JSON value");
      return entry;
    });
  } catch {
    throw err("INVALID", "parent model data must be JSON serializable");
  }
  if (encoded === undefined) throw err("INVALID", "parent model data must be JSON serializable");
  if (Buffer.byteLength(encoded, "utf8") > limit) throw err("PAYLOAD_TOO_LARGE", "parent model data exceeds its IPC bound");
}

function httpUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch { return false; }
}

/** Only public chat metadata crosses initialization; headers and auth fields are forbidden. */
export function parseParentModel(value: unknown, admitted: { provider: string; id: string }): Model<Api> {
  boundedJson(value, MODEL_MAX_BYTES);
  if (!record(value) || Object.keys(value).some((key) => !(MODEL_FIELDS as readonly string[]).includes(key))) throw err("INVALID", "invalid parent model descriptor fields");
  if (value["provider"] !== admitted.provider || value["id"] !== admitted.id) throw err("POLICY_DENIED", "parent model descriptor does not match the admitted model");
  if (typeof value["api"] !== "string" || value["api"].length === 0 || typeof value["name"] !== "string" || !httpUrl(value["baseUrl"])) throw err("INVALID", "parent model descriptor requires api, name, and HTTP baseUrl");
  if ((value["type"] !== undefined && value["type"] !== "chat") || typeof value["reasoning"] !== "boolean") throw err("INVALID", "parent model descriptor must describe a chat model");
  if (!Array.isArray(value["input"]) || value["input"].length === 0 || !value["input"].every((input) => input === "text" || input === "image")) throw err("INVALID", "invalid parent model input modalities");
  for (const key of ["contextWindow", "maxTokens"] as const) if (!Number.isSafeInteger(value[key]) || (value[key] as number) <= 0) throw err("INVALID", "invalid parent model token limits");
  const cost = value["cost"];
  if (!record(cost) || !["input", "output", "cacheRead", "cacheWrite"].every((key) => typeof cost[key] === "number" && Number.isFinite(cost[key]) && cost[key] >= 0)) throw err("INVALID", "invalid parent model cost metadata");
  return JSON.parse(JSON.stringify(value)) as Model<Api>;
}

/** Private, bounded request credentials; errors must never echo their values. */
export function parseProviderRequestAuth(value: unknown): ProviderRequestAuth {
  boundedJson(value, AUTH_MAX_BYTES);
  if (!record(value) || Object.keys(value).some((key) => !["apiKey", "headers", "baseUrl", "env"].includes(key))) throw err("INVALID", "invalid parent provider authentication fields");
  if (value["apiKey"] !== undefined && typeof value["apiKey"] !== "string") throw err("INVALID", "invalid parent provider API key");
  if (value["baseUrl"] !== undefined && !httpUrl(value["baseUrl"])) throw err("INVALID", "invalid parent provider authentication endpoint");
  if (value["headers"] !== undefined && (!record(value["headers"]) || !Object.values(value["headers"]).every((entry) => typeof entry === "string" || entry === null))) throw err("INVALID", "invalid parent provider authentication headers");
  if (value["env"] !== undefined && (!record(value["env"]) || !Object.values(value["env"]).every((entry) => typeof entry === "string"))) throw err("INVALID", "invalid parent provider credential environment");
  return value as ProviderRequestAuth;
}

export interface ParentModelProvider extends Provider {
  matchesRequest(model: Model<Api>): boolean;
  prepareRequest(model: Model<Api>, options: SimpleStreamOptions | undefined): { model: Model<Api>; options: SimpleStreamOptions };
}

/** Auth can precede the guard in SDK summaries; remember only its current approved endpoint. */
export function parentModelProvider(model: Model<Api>, api: ProviderStreams, resolveAuth: (signal: AbortSignal) => Promise<ProviderRequestAuth>): ParentModelProvider {
  let endpoint = model.baseUrl;
  const requestHints = new WeakMap<Model<Api>, string>();
  const identityMatches = (selected: Model<Api>): boolean => selected.provider === model.provider && selected.id === model.id && selected.api === model.api;
  const matchesRequest = (selected: Model<Api>): boolean => identityMatches(selected) && (selected.baseUrl === model.baseUrl || selected.baseUrl === endpoint || requestHints.get(selected) === selected.baseUrl);
  const checkTransport = (selected: Model<Api>): void => {
    if (!identityMatches(selected) || selected.baseUrl !== endpoint) throw err("POLICY_DENIED", "provider request does not match the parent-authorized model endpoint");
  };
  return {
    matchesRequest,
    prepareRequest: (selected, options) => {
      if (!matchesRequest(selected)) throw err("POLICY_DENIED", "provider request does not match the parent-authorized model endpoint");
      // SDK summary halves reuse one model object. Its URL remains a hint, never a transport grant.
      requestHints.set(selected, selected.baseUrl);
      // Summaries carry pre-resolved auth. Do not combine it with a later auth/endpoint lookup.
      const { apiKey: _key, headers: _headers, env: _env, ...requestOptions } = options ?? {};
      return { model: { ...selected, baseUrl: model.baseUrl }, options: requestOptions };
    },
    id: model.provider, name: model.provider, baseUrl: model.baseUrl,
    getModels: () => [model],
    auth: { apiKey: {
      name: "Governing session",
      check: async () => ({ type: "api_key", source: "governing session" }),
      resolve: async ({ signal }) => {
        const { env, ...auth } = parseProviderRequestAuth(await resolveAuth(signal));
        endpoint = auth.baseUrl ?? model.baseUrl;
        return { auth, ...(env === undefined ? {} : { env }), source: "governing session" };
      },
    } },
    stream: (selected, context, options) => { checkTransport(selected); return api.stream(selected, context, options); },
    streamSimple: (selected, context, options) => { checkTransport(selected); return api.streamSimple(selected, context, options); },
  };
}

/** Adapts the live governing registry, not a fresh SDK registry without extensions. */
export class GoverningModels implements ParentModels {
  private readonly currentRegistry: () => ParentRegistry;

  constructor(currentRegistry: () => ParentRegistry) {
    this.currentRegistry = currentRegistry;
  }

  describe(model: ResolvedModel): Model<Api> | null {
    return this.describeReference(model);
  }

  private describeReference(selected: { provider: string; id: string }): Model<Api> | null {
    const registry = this.currentRegistry();
    if (registry.getRegisteredNativeProvider(selected.provider) !== undefined) throw err("MODEL_UNAVAILABLE", "native extension providers cannot be transferred to a worker");
    const registration = registry.getRegisteredProviderConfig(selected.provider);
    if (registration === undefined) return null;
    if (registration.streamSimple !== undefined) throw err("MODEL_UNAVAILABLE", "custom extension streaming implementations cannot be transferred to a worker");
    const model = registry.find(selected.provider, selected.id);
    if (model === undefined) throw err("MODEL_UNAVAILABLE", "selected model is absent from the governing provider registration");
    const descriptor: Model<Api> = {
      type: "chat", id: model.id, name: model.name, api: model.api, provider: model.provider, baseUrl: model.baseUrl,
      input: model.input, cost: model.cost, reasoning: model.reasoning, contextWindow: model.contextWindow, maxTokens: model.maxTokens,
      inputLimits: model.inputLimits, thinkingLevelMap: model.thinkingLevelMap, promptCache: model.promptCache,
      samplingParams: model.samplingParams, samplingParamsByThinkingLevel: model.samplingParamsByThinkingLevel, compat: model.compat,
    };
    return parseParentModel(descriptor, selected);
  }

  async resolveAuth(admitted: Model<Api>): Promise<ParentAuthResolution> {
    const current = this.describeReference(admitted);
    if (current === null || current.api !== admitted.api || current.baseUrl !== admitted.baseUrl) return { ok: false, error: "governing provider registration changed; reload the worker" };
    const registry = this.currentRegistry();
    const registration = registry.getRegisteredProviderConfig(admitted.provider);
    const model = registry.find(admitted.provider, admitted.id);
    if (model === undefined) return { ok: false, error: "selected governing model is unavailable" };
    try {
      const result = await registry.getApiKeyAndHeaders(model);
      if (!result.ok) return { ok: false, error: "governing provider authentication is unavailable" };
      if (this.currentRegistry() !== registry || registry.getRegisteredProviderConfig(admitted.provider) !== registration) return { ok: false, error: "governing provider registration changed during authentication" };
      const latest = this.describeReference(admitted);
      if (latest === null || latest.api !== admitted.api || latest.baseUrl !== admitted.baseUrl) return { ok: false, error: "governing provider registration changed during authentication" };
      const { ok: _ok, ...auth } = result;
      return { ok: true, ...parseProviderRequestAuth(auth) };
    } catch {
      return { ok: false, error: "governing provider authentication failed" };
    }
  }
}
