# Haystack — API schemas (frozen, Step 0)

MCP and browser transports call the same application service; one rulebook.
All JSON parsed with the lossless codec (`model.md` §2). Raw-text fields
(`document_json`, query bodies) are parsed exactly once server-side.

## 1. Faults (typed, stable codes)

`invalid-id | invalid-document | invalid-query | invalid-cursor |
not-found | conflict | replay-conflict | unauthorized | forbidden |
ambiguous-credentials | rate-limited | bad-envelope | too-large |
unavailable`. Faults carry a stable code, a short message, and (for
`invalid-query`) UTF-16 spans. No credential/secret material in faults.

## 2. MCP tools

### `get`

```json
{ "key": "example-project:fact-mcp-auth", "revision": 1 }
```

`revision` optional (default: current). Returns full item (key, revision,
document, metadata). Archived items accessible. Unknown key → `not-found`.

### `put`

```json
{
  "key": "example-project:fact-mcp-auth",
  "document_json": "{\"title\":\"…\",\"fields\":{…},\"links\":[…],\"tags\":[\"mcp\"]}",
  "expected_revision": 0,
  "request_id": "0193e8d5-…"
}
```

`document_json` is a JSON **string** (raw text — never a nested object —
so the SDK's `JSON.parse` cannot round numbers before the application
codec sees them). Stringify the document client-side first. `expected_revision`
and `request_id` (UUIDv7) required. Returns `{ key, revision, metadata }`.
Create/update/archive share this op.

`request_id` must match
`xxxxxxxx-xxxx-7xxx-8/9/a/bxx-xxxxxxxxxxxx` (third group starts with `7`).
UUIDv4 (`crypto.randomUUID`, third group `4xxx`) is rejected with
`bad-envelope`. Mint a fresh v7 per operation:

```bash
python3 -c 'import time,os,uuid;print(uuid.UUID(int=(int(time.time()*1000)<<80)|int.from_bytes(os.urandom(10),"big"),version=7))'
```

Minimal valid `document_json` (a *string* holding this object):

```json
{"title":"t","description":"d","fields":{},"type":"fact","status":"actual","importance":"low","human-attention":"cleared","links":[]}
```

`human-attention` is only `required`|`cleared`; `status:archived` hides
from browse/search defaults.

MCP tool faults return `{ code, message }` plus `error <code>: <message>`
text — read the message; `bad-envelope` alone never tells you which field
was wrong. (The browser HTTP API keeps the generic public message.)

### `search`

```json
{ "query": "type:todo importance:high tag:mcp", "project": "example-project",
  "limit": 20, "cursor": "…" }
```

`project`/`cursor` optional. Returns `{ items: [summaries], cursor? }`
(summaries carry `tags: string[]`). Empty/whitespace query browses. Scope
intersects predicates.

## 3. Browser API (`/api/v1`, JSON bodies, versioned envelope)

- `POST /login { token }` → sets cookie; `{ user }` (no secret echo).
- `POST /logout` → expires cookie.
- `GET /whoami` (cookie or bearer) → `{ userId, type, tokenId,
  activityProjectId }`.
- `POST /get { key, revision? }`, `POST /put { key, document_json,
  expected_revision, request_id }`, `POST /search { query, project?,
  limit?, cursor? }` — same semantics as MCP.
- `POST /history { key }` → revision list (numbers, authors, times —
  no document bodies); `POST /history/get { key, revision }` → snapshot.
- `POST /query/analyze { query }` → `{ ast?, diagnostics[] }` (bounded,
  same parser); `POST /complete { query, caret }` → bounded suggestions
  (built-ins, vocabulary, observed values incl. `tag:` values, IDs).
- `GET /values/{type,status,importance,tags}` → configured + conventional +
  observed values (bounded, current items only).
- All responses: `Cache-Control: no-store`. All errors: typed faults.
  Item bodies render client-side as untrusted data (escaped; CSP; no raw
  HTML, no auto-executed instructions/skills, no unsafe schemes).

## Browser live updates

`GET /api/v1/live` upgrades to WebSocket on the same origin. Authentication
uses the HttpOnly session cookie; bearer headers and token query parameters
are rejected. The configured Host and Origin allowlists apply to upgrades.
Sessions are revalidated on messages, broadcasts, and server heartbeats.
Login changes and logout close the previous cookie's connections with 4401;
revocation uses the same permanent close code.

Client heartbeat: `{"type":"ping","nonce":"…","clientTs":123}`. The server
echoes the nonce and client timestamp in a `pong`, adding `serverTs`.
Committed HTTP and MCP writes push `{"type":"changed","key":"p:i","revision":2}`.
Replays and rejected writes produce no change notification. Documents stay
on the lossless HTTP API; notifications invalidate views rather than carry
document bodies. Reconnecting and recovering a stale connection refetch
current views, including history and relationships. Unsaved editors keep
their original CAS revision and draft; remote updates never overwrite them.

The channel is an ephemeral notification feed for one server process.
Direct SQL writes and writes through another process do not publish here.
Missed notifications are recovered by refetch on reconnection, not replayed.
Mutations remain explicit HTTP requests and are never automatically retried
over a replacement connection.
