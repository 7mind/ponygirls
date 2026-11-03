# Scala Haystack server

Main class `haystack.Main`; independent assembly `haystack/server/target/haystack-server.jar`.
`haystack-server serve CONFIG.json`, `migrate CONFIG.json`, `check-config CONFIG.json`.
The native binary has the same CLI; there is no Node fallback. `migrate` applies
0001–0004 and reconciles authoritative `activityProjectId`; `serve` does this
again before accepting requests, then initializes/rebuilds approved retrieval
projections on disposable/offline migration runs. It never rewrites history.

[Complete required config](../docs/scala-config.example.json). All displayed keys
are required; `webRoot`, `auth.rateLimit`, `retrieval.embedding` may be null.
Credential values are files, never config values/argv. Only the literal prefix
`$CREDENTIALS_DIRECTORY/` expands to that runtime environment directory. JDBC URL
must be `jdbc:postgresql://HOST:PORT/DB` without credentials/options. One per-host
PG provider supplies isolated role/database/password; pgvector must be provisioned
in the Haystack database. HTTP accepts only current Baboon1.0.0 generated DTOs;
`X-Haystack-Version: 1.0.0` is explicit current negotiation, old/future values fail.
Version info is `GET /api/versions`. Assets are served from `webRoot`; null disables
UI serving. Dynamic responses are no-store. No legacy routes/codecs are registered.

Auth is reloaded every `authReloadMs` (100..60000); invalid replacement fails
closed. Change the file atomically. Database/listen/retrieval config changes need
a restart; changing the authoritative activity project requires deliberate offline
reconciliation and otherwise prevents auth/startup. Session cookies revalidate
against the loaded digest set. Restart preserves sessions and durable replays.

## Retrieval policy

Ordinary Boolean browse/search remains exact and never calls a model. Content
retrieval is `POST /api/v1/retrieve` using generated `RetrieveRequest`. Unconfigured
embedding means lexical-only; requesting semantic/hybrid is typed unavailable.
No hidden fallback. `includeMetadata` explicitly approves title/description/tags.
`approvedFieldPrefixes` are RFC6901 pointers rooted at fields; `[]` approves no
field leaves, `[""]` deliberately approves all string leaves. Do not approve
password/token/credential/sensitive paths. Arrays/objects are traversed only to
string values; numbers/booleans/null are not embedded. Prefix matching is on
decoded segments, and provenance uses escaped pointers and UTF16 spans. Chunking
is byte-bounded, never truncates or splits Unicode scalars. Policy identity covers
all approvals and chunk bounds. Model/profile changes require explicit rebuild;
old publication survives until a complete compatible replacement publishes.

Non-null embedding object requires `operationUrl`, `model`, immutable `revision`,
`dimensions`1..4000, `sendDimensions`, `documentPrefix`, `queryPrefix`,
`normalization:"cosine"`, `credentialFile`, `deadlineMs`, `maxResponseBytes`,
`maxBatch`, `maxInputBytes`, `maxRequestBytes`. Full operation URL, explicit
credential file and bounded admission are mandatory. Chunk bytes plus document
prefix must fit maxInputBytes; batchSize must fit maxBatch. No provider is invoked
by writes or metadata browsing. Approved projections and durable shared index jobs
are written on the authoritative JDBC transaction; worker calls are outside it.
