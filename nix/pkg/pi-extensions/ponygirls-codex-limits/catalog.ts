import type { Credential } from "@earendil-works/pi-ai";

export const CATALOG_URL = "https://chatgpt.com/backend-api/codex/models?client_version=0.165.0";
const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const DISCOVERY_TIMEOUT_MS = 10000;

export interface CodexLimit {
  readonly slug: string;
  readonly contextWindow: number | undefined;
}

export interface CodexCatalog {
  load(credential: Credential, signal: AbortSignal): Promise<readonly CodexLimit[]>;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function limit(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Codex discovery returned an invalid context limit");
  }
  return value;
}

export function parseCatalog(value: unknown): readonly CodexLimit[] {
  if (!record(value) || !Array.isArray(value.models) || value.models.length === 0) {
    throw new Error("Codex discovery returned no model catalog");
  }
  const seen = new Set<string>();
  return value.models.map((row: unknown) => {
    if (!record(row) || typeof row.slug !== "string" || row.slug.trim() === "" || seen.has(row.slug)) {
      throw new Error("Codex discovery returned an invalid or duplicate model identifier");
    }
    seen.add(row.slug);
    const context = limit(row.context_window);
    const maximum = limit(row.max_context_window);
    if (context !== undefined && maximum !== undefined && maximum < context) {
      throw new Error("Codex discovery returned a maximum below its default context limit");
    }
    return { slug: row.slug, contextWindow: maximum ?? context };
  });
}

export class HttpCodexCatalog implements CodexCatalog {
  constructor(private readonly url: string, private readonly request: typeof fetch) {}

  async load(credential: Credential, signal: AbortSignal): Promise<readonly CodexLimit[]> {
    if (credential.type !== "oauth" || !credential.access) {
      throw new Error("Codex discovery requires subscription OAuth credentials");
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${credential.access}`,
      Accept: "application/json",
      originator: "pi",
    };
    if (typeof credential.accountId === "string" && credential.accountId !== "") {
      headers["ChatGPT-Account-Id"] = credential.accountId;
    }
    try {
      const response = await this.request(this.url, {
        headers, redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(DISCOVERY_TIMEOUT_MS)]),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Codex discovery HTTP ${response.status}`);
      }
      if (!response.body) throw new Error("Codex discovery returned an empty response");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_CATALOG_BYTES) throw new Error("Codex discovery response exceeds 2 MiB");
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
      let data: unknown;
      try {
        data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        throw new Error("Codex discovery returned invalid JSON");
      }
      return parseCatalog(data);
    } catch (error) {
      // Neither provider bodies nor fetch errors are safe diagnostics: they may contain credentials.
      if (error instanceof Error && error.message.startsWith("Codex discovery ")) throw error;
      throw new Error("Codex discovery request failed or timed out");
    }
  }
}
