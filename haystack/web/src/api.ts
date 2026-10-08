// Haystack browser API client. All state travels in JSON bodies or the
// HttpOnly cookie (never URLs); saved UI state lives in the URL fragment,
// which browsers never send to the server.
export class AuthError extends Error {
  constructor() {
    super("not authenticated");
    this.name = "AuthError";
  }
}

export class NetworkError extends Error {
  constructor() {
    super("server unreachable");
    this.name = "NetworkError";
  }
}

export interface ApiFault {
  code: string;
  message: string;
  spans?: Array<{ message: string; start: number; end: number }>;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly spans: ApiFault["spans"];
  constructor(status: number, fault: ApiFault) {
    super(fault.message);
    this.name = "ApiError";
    this.code = fault.code;
    this.status = status;
    this.spans = fault.spans;
  }
}

import { stringify } from "lossless-json";
import { parseRaw as parse } from "../../server/src/domain/json.ts";

async function request(path: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new NetworkError();
  }
  if (res.status === 401) throw new AuthError();
  if (res.status === 502 || res.status === 503 || res.status === 504) throw new NetworkError();
  return res;
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    throw new ApiError(res.status, { code: "unavailable", message: "bad response" });
  }
  if (!res.ok) {
    const fault = (parsed as { error?: ApiFault }).error ?? { code: "unavailable", message: "request failed" };
    throw new ApiError(res.status, fault);
  }
  return parsed as T;
}

async function get<T>(path: string): Promise<T> {
  const res = await request(path, { method: "GET" });
  const parsed = (await res.json()) as T;
  if (!res.ok) {
    const fault = (parsed as unknown as { error?: ApiFault }).error ?? { code: "unavailable", message: "request failed" };
    throw new ApiError(res.status, fault);
  }
  return parsed;
}

export interface Principal {
  userId: string;
  type: "human" | "agent";
  tokenId: string;
  activityProjectId: string;
}

export interface ItemMetadata {
  createdAt: string;
  createdBy: string;
  modifiedAt: string;
  modifiedBy: string;
}

export interface Item {
  key: string;
  revision: number;
  document: DocumentBody;
  metadata: ItemMetadata;
}

export interface DocumentBody {
  title: string;
  description: string;
  // fields stays raw text client-side so big integers never round.
  fieldsJson: string;
  type: string;
  status: string;
  importance: string;
  humanAttention: "required" | "cleared";
  links: Array<[string, string]>;
  tags: string[];
}

export interface Summary {
  project: string;
  item: string;
  revision: number;
  title: string;
  type: string;
  status: string;
  importance: string;
  humanAttention: string;
  tags?: string[];
  modifiedAt: string;
  modifiedBy: string;
}

export function summaryKey(summary: Pick<Summary, "project" | "item">): string {
  const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${encode(summary.project)}:${encode(summary.item)}`;
}

export interface RevisionMeta {
  revision: number;
  modifiedAt: string;
  modifiedBy: string;
  tokenId: string;
}

/** Parse a served item with the shared exact JSON codec: it arrives as lossless
 *  canonical text and big integers must survive the browser too. fieldsJson
 *  stays canonical text end to end (displayed and re-sent verbatim). */
function toItemFromText(text: string): Item {
  let raw: { key: string; revision: number; document: unknown; metadata: ItemMetadata };
  try {
    raw = parse(text) as unknown as typeof raw;
  } catch {
    throw new ApiError(200, { code: "unavailable", message: "bad response" });
  }
  const doc = raw.document as Record<string, unknown>;
  return {
    key: raw.key,
    // Envelope numbers are LosslessNumber instances: counters fit safely.
    revision: Number(raw.revision),
    document: {
      title: String(doc["title"] ?? ""),
      description: String(doc["description"] ?? ""),
      fieldsJson: stringify(doc["fields"] ?? {}) ?? "{}",
      type: String(doc["type"] ?? ""),
      status: String(doc["status"] ?? ""),
      importance: String(doc["importance"] ?? ""),
      humanAttention: doc["human-attention"] === "required" ? "required" : "cleared",
      links: Array.isArray(doc["links"]) ? (doc["links"] as Array<[string, string]>) : [],
      tags: Array.isArray(doc["tags"])
        ? (doc["tags"] as unknown[]).filter((t): t is string => typeof t === "string")
        : [],
    },
    metadata: raw.metadata,
  };
}

/** Assemble a put body with the fields textarea spliced in RAW (validated
 *  losslessly first) so edited big integers never round-trip through
 *  JSON.parse/stringify. Throws Error("fields") on invalid JSON. */
export function buildDocumentJson(parts: {
  title: string;
  description: string;
  fieldsRaw: string;
  type: string;
  status: string;
  importance: string;
  attention: string;
  links: Array<[string, string]>;
  tags?: string[];
}): string {
  try {
    parse(parts.fieldsRaw);
  } catch {
    throw new Error("fields");
  }
  return (
    `{"title":${JSON.stringify(parts.title)},` +
    `"description":${JSON.stringify(parts.description)},` +
    `"fields":${parts.fieldsRaw},` +
    `"type":${JSON.stringify(parts.type)},` +
    `"status":${JSON.stringify(parts.status)},` +
    `"importance":${JSON.stringify(parts.importance)},` +
    `"human-attention":${JSON.stringify(parts.attention)},` +
    `"links":${JSON.stringify(parts.links)},` +
    `"tags":${JSON.stringify(parts.tags ?? [])}}`
  );
}

/** Parse a comma-separated tags input into a clean string array. */
export function parseTagsInput(text: string): string[] {
  return text
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/** Client-generated UUIDv7 request ids (time-ordered, random). */
export function uuidv7(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const timestampBytes = 6;
  let timestamp = BigInt(Date.now());
  for (let i = timestampBytes - 1; i >= 0; i--) {
    bytes[i] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** POST returning raw text (for lossless document bodies). */
async function callText(path: string, body?: unknown): Promise<string> {
  const res = await request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    let fault: ApiFault = { code: "unavailable", message: "request failed" };
    try {
      fault = (JSON.parse(text) as { error?: ApiFault }).error ?? fault;
    } catch {
      // keep default
    }
    throw new ApiError(res.status, fault);
  }
  return text;
}

export const api = {
  login: (token: string) => call<{ user: { id: string; type: string } }>("/api/v1/login", { token }),
  logout: () => call<{ ok: boolean }>("/api/v1/logout", {}),
  whoami: () => get<Principal>("/api/v1/whoami"),
  get: async (key: string, revision?: number) => toItemFromText(await callText("/api/v1/get", { key, revision })),
  put: (key: string, documentJson: string, expectedRevision: number, requestId: string) =>
    call<{ key: string; revision: number; metadata: ItemMetadata; replayed: boolean }>("/api/v1/put", {
      key,
      document_json: documentJson,
      expected_revision: expectedRevision,
      request_id: requestId,
    }),
  search: (query: string, opts?: { project?: string; limit?: number; cursor?: string }) =>
    call<{ items: Summary[]; cursor?: string }>("/api/v1/search", { query, ...opts }),
  history: (key: string) => call<{ revisions: RevisionMeta[] }>("/api/v1/history", { key }),
  historyGet: async (key: string, revision: number) =>
    toItemFromText(await callText("/api/v1/history/get", { key, revision })),
  analyze: (query: string) =>
    call<{ diagnostics: Array<{ message: string; start: number; end: number }> }>("/api/v1/query/analyze", { query }),
  complete: (query: string, caret?: number) =>
    call<{ suggestions: string[] }>("/api/v1/complete", { query, caret }),
  values: (field: string) => get<{ values: string[] }>(`/api/v1/values/${field}`),
};
