import type { Model, Api, Provider } from "@earendil-works/pi-ai";
import type { CodexCatalog, CodexLimit } from "./catalog.ts";

const PROVIDER_ID = "openai-codex";
const OFFICIAL_BASE_URL = "https://chatgpt.com/backend-api";

export interface MaximumContextProvider {
  readonly provider: Provider;
  status(): string;
  hasLimit(id: string): boolean;
  needsRefresh(): boolean;
}

export function maximumContextProvider(base: Provider, catalog: CodexCatalog): MaximumContextProvider {
  if (base.id !== PROVIDER_ID) throw new Error("Codex limits requires the openai-codex provider");
  let limits: readonly CodexLimit[] = [];
  let credentialScope: string | undefined;
  let pendingRefresh = true;
  let status = "Discovery not performed; Pi catalog limits retained.";
  const project = (model: Model<Api>): Model<Api> => {
    const entry = limits.find((item) => item.slug === model.id);
    return entry && entry.contextWindow !== undefined ? { ...model, contextWindow: entry.contextWindow } : model;
  };
  const provider: Provider = {
    ...base,
    getModels: () => base.getModels().map(project),
    getAllModels: () => base.getModels().map(project),
    async refreshModels(context) {
      const credential = context.credential;
      if (!credential || credential.type !== "oauth") return;
      const endpoint = context.baseUrl === undefined ? OFFICIAL_BASE_URL : context.baseUrl.replace(/\/$/, "");
      const account = typeof credential.accountId === "string" ? credential.accountId : credential.access;
      const scope = JSON.stringify([account, endpoint]);
      if (credentialScope !== scope) {
        const accepted = await context.publish({ update: () => {
          limits = [];
          credentialScope = scope;
          pendingRefresh = true;
          status = "Discovery pending for this account/endpoint; Pi catalog limits retained.";
        } });
        if (!accepted) return;
      }
      if (!context.allowNetwork) return;
      try {
        if (endpoint !== OFFICIAL_BASE_URL) {
          throw new Error("Codex discovery is disabled for a nonstandard provider endpoint");
        }
        const discovered = await catalog.load(credential, context.signal);
        await context.publish({ update: () => {
          limits = discovered;
          credentialScope = scope;
          pendingRefresh = false;
          const count = base.getModels().filter((model) => discovered.some((item) => item.slug === model.id && item.contextWindow !== undefined)).length;
          status = `Live context limits applied to ${count} catalog models. Output limits retained from Pi's catalog (Codex discovery exposes no output maximum).`;
        } });
      } catch (error) {
        await context.publish({ update: () => {
          pendingRefresh = false;
          status = "Discovery failed; last-known limits (or Pi catalog defaults) retained.";
        } });
        throw error;
      }
    },
  };
  return {
    provider, status: () => status, needsRefresh: () => pendingRefresh,
    hasLimit: (id) => limits.some((item) => item.slug === id && item.contextWindow !== undefined),
  };
}
