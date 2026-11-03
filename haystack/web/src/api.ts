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
  currentRevision?: number;
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
import { WriteCoordinator } from "./pending-write.ts";
export { PendingWriteBlocked } from "./pending-write.ts";
import { parseRaw as parse } from "./lossless-json.ts";
import { BaboonCodecContext } from "../../generated/typescript/BaboonSharedRuntime.ts";
import {
  Ack, AnalyzeResult, CompletionResult, DocumentPayload, Failure, GetRequest,
  HistoryRequest, HistoryResult, Identity, Item as WireItem, LoginRequest, LoginResult,
  PutRequest, PutResult, QueryRequest, SearchRequest, SearchResult, SearchSort as WireSearchSort,
  ValuesRequest, ValuesResult,
} from "../../generated/typescript/haystack/api/index.ts";

const context = BaboonCodecContext.Default;
const version = WireItem.BaboonDomainVersion;
interface Codec<T> {
  encode(context: BaboonCodecContext, value: T): unknown;
  decode(context: BaboonCodecContext, json: unknown): T;
}
async function request(path: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try { res = await fetch(path, init); } catch { throw new NetworkError(); }
  if (res.status === 401) { writes.clear(); throw new AuthError(); }
  if (res.status === 502 || res.status === 503 || res.status === 504) throw new NetworkError();
  return res;
}
async function call<T>(path: string, codec: Codec<T>, body?: unknown, method = "POST"): Promise<T> {
  const res = await request(path, {
    method, headers: { "Content-Type": "application/json", "X-Haystack-Version": version },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  let parsed: unknown;
  try { parsed = await res.json(); }
  catch { throw new ApiError(res.status, { code: "unavailable", message: "bad response" }); }
  if (!res.ok) {
    try {
      const fault = Failure.jsonCodec().decode(context, parsed);
      if (typeof fault.code !== "string" || typeof fault.message !== "string" || !Array.isArray(fault.spans)) throw new Error("failure");
      throw new ApiError(res.status, fault);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(res.status, { code: "unavailable", message: "bad response" });
    }
  }
  try { return codec.decode(context, parsed); }
  catch { throw new ApiError(res.status, { code: "unavailable", message: "bad response" }); }
}
function encode<T>(codec: Codec<T>, value: T): unknown { return codec.encode(context, value); }

export interface Principal {
  userId: string;
  type: "human" | "agent";
  tokenId: string;
  activityProjectId: string;
}

export type SearchSortField = "key" | "title" | "project" | "type" | "status" | "importance" | "human-attention" | "modified-at" | "revision";
export interface SearchSort {
  readonly field: SearchSortField;
  readonly direction: "asc" | "desc";
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
function toItem(raw: WireItem): Item {
  let doc: Record<string, unknown>;
  try {
    doc = parse(raw.document.json) as Record<string, unknown>;
    if (typeof raw.key !== "string" || !Number.isSafeInteger(raw.revision) || raw.revision < 1 ||
        typeof doc !== "object" || doc === null || Array.isArray(doc)) throw new Error("item");
  } catch { throw new ApiError(200, { code: "unavailable", message: "bad response" }); }
  return {
    key: raw.key, revision: raw.revision,
    document: {
      title: String(doc["title"] ?? ""), description: String(doc["description"] ?? ""),
      fieldsJson: stringify(doc["fields"] ?? {}) ?? "{}", type: String(doc["type"] ?? ""),
      status: String(doc["status"] ?? ""), importance: String(doc["importance"] ?? ""),
      humanAttention: doc["human-attention"] === "required" ? "required" : "cleared",
      links: Array.isArray(doc["links"]) ? doc["links"] as Array<[string, string]> : [],
      tags: Array.isArray(doc["tags"]) ? doc["tags"].filter((t): t is string => typeof t === "string") : [],
    }, metadata: raw.metadata,
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

const writes = new WriteCoordinator<PutResult>(
  async (op) => {
    const result = await call("/api/v1/put", PutResult.jsonCodec(), encode(PutRequest.jsonCodec(),
      new PutRequest(op.key, new DocumentPayload(op.documentJson), op.expectedRevision, op.requestId)));
    if (result.key !== op.key || !Number.isSafeInteger(result.revision) || result.revision < 1 || typeof result.replayed !== "boolean" ||
        typeof result.metadata.modifiedAt !== "string" || typeof result.metadata.modifiedBy !== "string")
      throw new ApiError(200, { code: "unavailable", message: "bad response" });
    return result;
  },
  // A decoded terminal client fault establishes an outcome; transport failures,
  // unreadable 2xx responses, request timeout and server failures do not.
  (error) => error instanceof AuthError || (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408),
);
export const api = {
  pendingWrite: writes.snapshot,
  subscribePendingWrite: writes.subscribe,
  retryPendingWrite: () => writes.retry(),
  login: async (token: string) => {
    const result = await call("/api/v1/login", LoginResult.jsonCodec(), encode(LoginRequest.jsonCodec(), new LoginRequest(token)));
    writes.clear(); return result;
  },
  logout: async () => { const result = await call("/api/v1/logout", Ack.jsonCodec()); writes.clear(); return result; },
  whoami: async (): Promise<Principal> => {
    const identity = await call("/api/v1/whoami", Identity.jsonCodec(), undefined, "GET");
    return { userId: identity.userId, type: identity.userType as Principal["type"], tokenId: identity.tokenId, activityProjectId: identity.activityProjectId };
  },
  get: async (key: string, revision?: number) => toItem(await call("/api/v1/get", WireItem.jsonCodec(),
    encode(GetRequest.jsonCodec(), new GetRequest(key, revision)))),
  put: (key: string, documentJson: string, expectedRevision: number, requestId: string) =>
    writes.execute({ key, documentJson, expectedRevision, requestId }),
  search: async (query: string, opts?: { project?: string; limit?: number; cursor?: string; sort?: SearchSort }) => {
    const sort = opts?.sort ?? { field: "key", direction: "asc" };
    const result = await call("/api/v1/search", SearchResult.jsonCodec(), encode(SearchRequest.jsonCodec(),
      new SearchRequest(query, opts?.project, opts?.limit ?? 20, opts?.cursor, new WireSearchSort(sort.field, sort.direction))));
    return { items: result.items.map((item): Summary => ({ project: item.project, item: item.item, revision: item.revision,
      title: item.title, type: item.docType, status: item.status, importance: item.importance, humanAttention: item.humanAttention,
      tags: item.tags, modifiedAt: item.modifiedAt, modifiedBy: item.modifiedBy })), cursor: result.cursor };
  },
  history: (key: string) => call("/api/v1/history", HistoryResult.jsonCodec(), encode(HistoryRequest.jsonCodec(), new HistoryRequest(key))),
  historyGet: async (key: string, revision: number) => toItem(await call("/api/v1/get", WireItem.jsonCodec(),
    encode(GetRequest.jsonCodec(), new GetRequest(key, revision)))),
  analyze: async (query: string) => {
    const result = await call("/api/v1/query/analyze", AnalyzeResult.jsonCodec(), encode(QueryRequest.jsonCodec(), new QueryRequest(query, query.length)));
    return { valid: result.valid, diagnostics: result.spans };
  },
  complete: (query: string, caret = query.length) => call("/api/v1/complete", CompletionResult.jsonCodec(),
    encode(QueryRequest.jsonCodec(), new QueryRequest(query, caret))),
  values: (field: string) => call("/api/v1/values", ValuesResult.jsonCodec(), encode(ValuesRequest.jsonCodec(), new ValuesRequest(field))),
};
