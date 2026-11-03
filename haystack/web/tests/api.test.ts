// Behavioral-Active-Blackbox-Atomic; regression: UUIDv7 must carry Unix time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDocumentJson, parseTagsInput, uuidv7 } from "../src/api.ts";

test("UUIDv7 carries its creation timestamp, version, and variant", () => {
  const before = Date.now();
  const id = uuidv7();
  const after = Date.now();
  const timestamp = Number.parseInt(id.replaceAll("-", "").slice(0, 12), 16);
  assert.ok(timestamp >= before && timestamp <= after, `timestamp ${timestamp} is outside ${before}..${after}`);
  assert.equal(id[14], "7");
  assert.match(id[19]!, /[89ab]/);
});

test("parseTagsInput splits on commas and trims", () => {
  assert.deepEqual(parseTagsInput(""), []);
  assert.deepEqual(parseTagsInput("mcp, urgent "), ["mcp", "urgent"]);
  assert.deepEqual(parseTagsInput("a,, b , ,c"), ["a", "b", "c"]);
  assert.deepEqual(parseTagsInput("Machine Learning, mcp"), ["Machine Learning", "mcp"]);
});

test("buildDocumentJson carries tags verbatim", () => {
  const json = buildDocumentJson({
    title: "t",
    description: "d",
    fieldsRaw: '{"n":9007199254740993}',
    type: "fact",
    status: "actual",
    importance: "low",
    attention: "cleared",
    links: [],
    tags: ["mcp", "Machine Learning"],
  });
  assert.ok(json.includes('"tags":["mcp","Machine Learning"]'));
  assert.ok(json.includes("9007199254740993"));
  const omitted = buildDocumentJson({
    title: "t",
    description: "d",
    fieldsRaw: "{}",
    type: "fact",
    status: "actual",
    importance: "low",
    attention: "cleared",
    links: [],
  });
  assert.ok(omitted.includes('"tags":[]'));
});

// BG, specified: exercise the owned client against the actual generated current
// codecs, not duplicate structural DTOs or historical hand-written envelopes.
import { api, ApiError, AuthError, NetworkError } from "../src/api.ts";
import { BaboonCodecContext } from "../../generated/typescript/BaboonSharedRuntime.ts";
import {
  Ack, AnalyzeResult, CompletionResult, DocumentPayload, Failure, HistoryResult, Identity,
  Item, LoginResult, Metadata, PutResult, RevisionInfo, SearchResult, Span, Summary,
  ValuesResult, VersionInfo,
} from "../../generated/typescript/haystack/api/index.ts";
const context = BaboonCodecContext.Default;
const metadata = new Metadata("2026-10-07T18:00:00Z", "agent", "2026-10-07T18:01:00Z", "op");
const identity = new Identity("op", "human", "browser", "agent-activity");
const documentJson = '{"title":"t","description":"d","fields":{"n":9007199254740993,"decimal":0.12345678901234567890123456789},"type":"fact","status":"actual","importance":"low","human-attention":"cleared","links":[],"tags":["mcp"]}';
function response<T>(codec: { encode(ctx: BaboonCodecContext, value: T): unknown }, value: T, status = 200): Response {
  return Response.json(codec.encode(context, value), { status });
}

test("login/logout/whoami consume generated current identity and version shapes", async (t) => {
  const requests: Array<{ path: string; init: RequestInit }> = [];
  const replies = [response(LoginResult.jsonCodec(), new LoginResult(identity, new VersionInfo("1.0.0", "1.0.0", ["1.0.0"]))),
    response(Identity.jsonCodec(), identity), response(Ack.jsonCodec(), new Ack(true))];
  t.mock.method(globalThis, "fetch", async (path: string, init: RequestInit) => { requests.push({ path, init }); return replies.shift()!; });
  const login = await api.login("secret");
  assert.equal(login.identity.userId, "op"); assert.equal(login.versions.current, "1.0.0");
  assert.deepEqual(await api.whoami(), { userId: "op", type: "human", tokenId: "browser", activityProjectId: "agent-activity" });
  assert.equal((await api.logout()).ok, true);
  assert.deepEqual(requests.map(r => r.path), ["/api/v1/login", "/api/v1/whoami", "/api/v1/logout"]);
  assert.deepEqual(JSON.parse(requests[0]!.init.body as string), { token: "secret" });
  for (const r of requests) assert.equal(new Headers(r.init.headers).get("X-Haystack-Version"), "1.0.0");
  assert.equal(requests[1]!.init.method, "GET");
});

test("get and historical get decode nested DocumentPayload without rounding or old route", async (t) => {
  const requests: Array<{ path: string; body: unknown }> = [];
  t.mock.method(globalThis, "fetch", async (path: string, init: RequestInit) => {
    requests.push({ path, body: JSON.parse(init.body as string) });
    return response(Item.jsonCodec(), new Item("p:i", 7, new DocumentPayload(documentJson), metadata));
  });
  for (const item of [await api.get("p:i"), await api.historyGet("p:i", 3)]) {
    assert.equal(item.key, "p:i"); assert.equal(item.revision, 7);
    assert.match(item.document.fieldsJson, /9007199254740993/);
    assert.match(item.document.fieldsJson, /0\.12345678901234567890123456789/);
    assert.deepEqual(item.document.tags, ["mcp"]); assert.equal(item.metadata.modifiedBy, "op");
  }
  assert.deepEqual(requests, [{ path: "/api/v1/get", body: { key: "p:i", revision: null } }, { path: "/api/v1/get", body: { key: "p:i", revision: 3 } }]);
});

test("put encodes DocumentPayload and current camelCase CAS/replay fields", async (t) => {
  const requestId = "0193e8d5-6f5c-7a1b-8c2d-000000000001";
  t.mock.method(globalThis, "fetch", async (path: string, init: RequestInit) => {
    assert.equal(path, "/api/v1/put");
    assert.deepEqual(JSON.parse(init.body as string), { key: "p:i", document: { json: documentJson }, expectedRevision: 7, requestId });
    return response(PutResult.jsonCodec(), new PutResult("p:i", 8, metadata, true));
  });
  const result = await api.put("p:i", documentJson, 7, requestId);
  assert.equal(result.revision, 8); assert.equal(result.replayed, true); assert.equal(result.metadata.modifiedBy, "op");
});

test("search uses generated defaults/explicit sort and projects docType for UI only", async (t) => {
  const requests: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (path: string, init: RequestInit) => {
    assert.equal(path, "/api/v1/search"); requests.push(JSON.parse(init.body as string));
    return response(SearchResult.jsonCodec(), new SearchResult([
      new Summary("p:i", "p", "i", 2, "Title", "todo", "actual", "high", "required", ["mcp"], metadata.modifiedAt, "op"),
    ], "opaque"));
  });
  const first = await api.search("hello");
  assert.equal(first.items[0]!.type, "todo"); assert.equal(first.cursor, "opaque");
  await api.search("q", { project: "p", limit: 5, cursor: "opaque", sort: { field: "modified-at", direction: "desc" } });
  assert.deepEqual(requests, [
    { query: "hello", project: null, limit: 20, cursor: null, sort: { field: "key", direction: "asc" } },
    { query: "q", project: "p", limit: 5, cursor: "opaque", sort: { field: "modified-at", direction: "desc" } },
  ]);
});

test("history/analyze/completion/values use sole current generated bodies and results", async (t) => {
  const requests: Array<{ path: string; method: string; body: unknown }> = [];
  const replies = [response(HistoryResult.jsonCodec(), new HistoryResult([new RevisionInfo(2, metadata.modifiedAt, "op", "browser")])),
    response(AnalyzeResult.jsonCodec(), new AnalyzeResult(false, [new Span("bad", 2, 4)])),
    response(CompletionResult.jsonCodec(), new CompletionResult(["type:"])), response(ValuesResult.jsonCodec(), new ValuesResult(["fact"]))];
  t.mock.method(globalThis, "fetch", async (path: string, init: RequestInit) => {
    requests.push({ path, method: init.method!, body: JSON.parse(init.body as string) }); return replies.shift()!;
  });
  assert.equal((await api.history("p:i")).revisions[0]!.revision, 2);
  const analysis = await api.analyze("bad"); assert.equal(analysis.valid, false);
  assert.deepEqual(analysis.diagnostics.map(d => [d.message, d.start, d.end]), [["bad", 2, 4]]);
  assert.deepEqual((await api.complete("typ", 2)).suggestions, ["type:"]);
  assert.deepEqual((await api.values("type")).values, ["fact"]);
  assert.deepEqual(requests, [
    { path: "/api/v1/history", method: "POST", body: { key: "p:i" } },
    { path: "/api/v1/query/analyze", method: "POST", body: { query: "bad", caret: 3 } },
    { path: "/api/v1/complete", method: "POST", body: { query: "typ", caret: 2 } },
    { path: "/api/v1/values", method: "POST", body: { field: "type" } },
  ]);
});

test("current direct Failure preserves diagnostics/status; outages and auth remain distinct", async (t) => {
  t.mock.method(globalThis, "fetch", async () => response(Failure.jsonCodec(), new Failure("invalid-query", "bad query", [new Span("bad", 1, 4)], undefined), 400));
  await assert.rejects(api.search("bad"), (e: unknown) => e instanceof ApiError && e.code === "invalid-query" && e.status === 400 && e.spans?.[0]?.start === 1);
  for (const status of [502, 503, 504]) {
    t.mock.method(globalThis, "fetch", async () => new Response("gateway", { status }));
    await assert.rejects(api.whoami(), NetworkError);
  }
  t.mock.method(globalThis, "fetch", async () => new Response("auth", { status: 401 }));
  await assert.rejects(api.whoami(), AuthError);
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("offline"); });
  await assert.rejects(api.whoami(), NetworkError);
});

test("malformed current item payload cannot fall back to an old document envelope", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ key: "p:i", revision: 1, document: JSON.parse(documentJson), metadata: {} }));
  await assert.rejects(api.get("p:i"), ApiError);
});
