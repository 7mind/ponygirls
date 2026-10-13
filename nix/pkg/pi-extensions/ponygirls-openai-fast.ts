import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const PREFERENCE_FILENAME = "openai-fast.json";
const DEFAULT_ENABLED = true;
type ServiceTier = "priority" | "default";

export interface FastPreferenceStore {
  readonly path: string;
  read(): boolean;
  write(enabled: boolean): void;
}

export class FilePreferenceStore implements FastPreferenceStore {
  constructor(readonly path: string) {}

  read(): boolean {
    let text: string;
    try {
      text = readFileSync(this.path, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return DEFAULT_ENABLED;
      throw error;
    }
    const preference: unknown = JSON.parse(text);
    if (typeof preference !== "object" || preference === null || Array.isArray(preference) ||
        !("enabled" in preference) || typeof preference.enabled !== "boolean") {
      throw new Error(`Invalid OpenAI fast preference in ${this.path}: expected {"enabled": boolean}`);
    }
    return preference.enabled;
  }

  write(enabled: boolean): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporaryPath, `${JSON.stringify({ enabled })}\n`, { mode: 0o600, flag: "wx" });
      renameSync(temporaryPath, this.path);
    } finally {
      rmSync(temporaryPath, { force: true });
    }
  }
}

interface RequestObservation {
  provider: string;
  model: string;
  requestedTier: ServiceTier;
  reportedTier: string | undefined;
  httpStatus: number | undefined;
}

function isOpenAI(provider: string): boolean {
  return provider === "openai" || provider === "openai-codex";
}

export function registerFastMode(pi: ExtensionAPI, preferences: FastPreferenceStore): void {
  let lastRequest: RequestObservation | undefined;

  pi.registerCommand("fast", {
    description: "OpenAI priority processing: /fast on, off, or status (saved across sessions)",
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase();
      if (action !== "" && action !== "status" && action !== "on" && action !== "off") {
        ctx.ui.notify("Usage: /fast [on|off|status]", "warning");
        return;
      }
      if (action === "on" || action === "off") preferences.write(action === "on");
      const enabled = preferences.read();
      const model = ctx.model;
      const nextRequest = model && isOpenAI(model.provider)
        ? `${enabled ? "priority" : "default"} (${model.provider}/${model.id})`
        : `unchanged (${model ? `${model.provider}/${model.id}; not an OpenAI provider` : "no model selected"})`;
      const observation = lastRequest
        ? `Last OpenAI request (this runtime): ${lastRequest.provider}/${lastRequest.model}\n` +
          `Requested tier: ${lastRequest.requestedTier}\n` +
          `OpenAI-reported tier: ${lastRequest.reportedTier === undefined ? "not reported; unverified" : lastRequest.reportedTier}\n` +
          `HTTP status: ${lastRequest.httpStatus === undefined ? "not observed" : lastRequest.httpStatus}`
        : "OpenAI-reported tier: unverified; no OpenAI request observed in this runtime";
      ctx.ui.notify(
        `Fast mode: ${enabled ? "ON" : "OFF"} (persistent)\nNext request: ${nextRequest}\n${observation}\nPreference file: ${preferences.path}`,
        "info",
      );
    },
  });

  pi.on("before_provider_request", (event, ctx) => {
    const model = ctx.model;
    if (!model) throw new Error("OpenAI fast mode requires a selected model");
    if (!isOpenAI(model.provider)) return;
    lastRequest = undefined;
    if (typeof event.payload !== "object" || event.payload === null || Array.isArray(event.payload)) {
      throw new Error("OpenAI fast mode requires an object request payload");
    }
    const requestedTier: ServiceTier = preferences.read() ? "priority" : "default";
    lastRequest = { provider: model.provider, model: model.id, requestedTier, reportedTier: undefined, httpStatus: undefined };
    return { ...event.payload, service_tier: requestedTier };
  });

  pi.on("after_provider_response", (event, ctx) => {
    const model = ctx.model;
    if (lastRequest && model && model.provider === lastRequest.provider && model.id === lastRequest.model) {
      lastRequest.httpStatus = event.status;
    }
  });

  pi.on("provider_stream_event", (event) => {
    if (!lastRequest || event.provider !== lastRequest.provider || event.model !== lastRequest.model) return;
    const data = event.data;
    if (typeof data !== "object" || data === null) return;
    if ("type" in data && (data.type === "response.completed" || data.type === "response.incomplete")) {
      const response = "response" in data ? data.response : undefined;
      lastRequest.reportedTier = typeof response === "object" && response !== null &&
        "service_tier" in response && typeof response.service_tier === "string" ? response.service_tier : undefined;
    } else if ("object" in data && data.object === "chat.completion.chunk" &&
               "service_tier" in data && typeof data.service_tier === "string") {
      lastRequest.reportedTier = data.service_tier;
    }
  });
}

export default function (pi: ExtensionAPI): void {
  registerFastMode(pi, new FilePreferenceStore(join(getAgentDir(), PREFERENCE_FILENAME)));
}
