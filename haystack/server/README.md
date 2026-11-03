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

## Executable acceptance runner

From repository root in the pinned Chronicle shell, run:

```
HAYSTACK_SERVER_COMMAND=/absolute/path/haystack-server \
HAYSTACK_SERVER_ARTIFACT_FILE=/absolute/path/haystack-server \
HAYSTACK_ARTIFACT_KIND=native \
  bash haystack/scripts/test-current.sh
```

For JVM use command `java -jar /absolute/path/haystack-server.jar`, artifact file
that exact JAR, and kind `jvm`. This is explicit selection, never a native fallback.
Required tools: pinned Node24+, locked `haystack/package-lock.json` npm tree
(`cd haystack && npm ci --offline --ignore-scripts`), PostgreSQL18 **with pgvector**
(`initdb`, `pg_ctl`, `psql` on PATH), Python3, coreutils (including `timeout`). The
Node tree contains official MCP SDK1.32.1, ws8.22.0 and the locked rolldown
transformer used only to load generated TypeScript in tests. No external provider
or production database is read; the script creates its own cluster/database and
sets the guarded fixture environment itself. Never set that guard against an
existing database.

The runner has a 240-second whole-node deadline and 10-second forced cleanup;
each Node test is bounded60seconds; readiness15seconds and WS assertion1second
are separately bounded. It always stops its owned PG via EXIT trap. Child process
fixtures stop their server on suite exit. Full test inventory is committed at
`server/tests-current/inventory.json`; fresh JUnit names must match it exactly,
with zero skips/errors/failures and nonempty cases. The full TAP and JUnit XML,
runner log, source/artifact SHA256 binding and machine receipt are in a fresh
`$HAYSTACK_REPORT_DIR`, or the printed disposable report directory. Existing
nonempty reports are never overwritten. This is the HTTP/MCP/WS process leg,
not a substitute for Scala dual-PG, browser, model-provider or downstream gates.
