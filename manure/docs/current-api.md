# Manure current API — 1.0.0

Normative schema: [`../models/manure.baboon`](../models/manure.baboon).
Pinned compiler: Baboon 0.0.198, SHA256
`6470f599d47cc3f685efc4ccf4ddcc8492bfd0dcd87a88bf76ed7bfee0f77f36`.
One current contract only. No old REST dispatch, versioned codecs or cursor
conversion. This is a coordinated server/owned-client replacement, **not** a
production activation approval. The historical Python implementation remains
source evidence until its replacement checks pass.

## Transport

* Management: `POST /api/current`, `Content-Type: application/json`.
  Generated `ClientEnvelope {requestId: uid, apiVersion: "1.0.0", command: Command}`
  produces `ServerEnvelope {requestId: uid, result: Result}`. Echo the request ID;
  it is correlation, **not** write deduplication or an exactly-once guarantee.
* Content control: `POST /__manure/current`, or
  `POST /view/<artifactId>/__manure/current` in path mode. Generated
  `ContentEnvelope` has the same correlation/version fields and a narrower
  `ContentCommand` (Unlock, RedeemGrant, Logout, GetManifest). Return
  `ServerEnvelope`. Artifact identity comes exclusively from validated routing,
  never from a body field or an untrusted Host-derived absolute URL.
* ADTs use the generator's one-key wrappers, e.g.
  `{"Whoami":{}}`, `{"File":{"path":"a","size":"0","sha256":"..."}}`.
  Enum values use generated case (`"Directory"`, `"External"`, `"Ready"`).
  All `i64` values encode as decimal **strings**, including byte counts/ranges
  and search totals. `i32` values are JSON integers. Options encode JSON null.
  Never stringify generated TypeScript objects directly; use generated codecs.
* Strict boundary validation precedes generated decoding: UTF-8, duplicate keys,
  exact object keys, one ADT variant, enum membership, required fields, integer
  bounds and canonical UUID correlation ID. Generated codecs alone are not a
  hostile-input validator. Failure responses must not echo submitted fields.
* Unknown/removed/future `apiVersion` returns `UnsupportedVersion` before a
  command can execute. Version/Capabilities are unauthenticated safe reads;
  Version returns current `1.0.0`, supported `["1.0.0"]`. There is no minimum
  compatibility range. All management commands except Version, GetCapabilities,
  Login and eligible public GetManifest require live management authentication.
* Management HTTP failures keep their domain status; generated Result.Error
  carries `Failure {code, message, retryAfterSeconds}` and `Retry-After` for
  429/503. A pre-envelope framing/Host/TLS fault cannot echo an unparsed ID;
  use the reserved all-zero UUID in the generated error envelope. Raw paths
  use that same error envelope on failure. Codes map to historical kebab-case
  meanings in CONTRACT §7.4; new UnsupportedVersion=400,
  SearchUnavailable=503 and SearchNotReady=503. No secrets in errors/logs.

## Command/result mapping

| Command | Success Result | Authority / special behavior |
|---|---|---|
| Version | Version | safe, no cookie mutation |
| GetCapabilities | CapabilityInfo | finite bounds; available search modes only |
| Login(token) | Identity | always exact matched API Origin; sets session cookie |
| Logout | Ok | Origin/auth guards; revoke token-bound grants; clear session |
| Whoami | Identity | live principal attribution, not role-based authorization |
| ListArtifacts(query) | Catalogue(page) | all authenticated users; exact catalogue |
| InitUpload(name,kind,visibility,expiresInSeconds,files) | UploadInitialized | atomic quota/session reservation; initial external password |
| GetArtifact(artifactId) | ArtifactInfo | any authenticated user; expired=410 |
| PatchArtifact(artifactId,patch) | ArtifactPatched | owner while incomplete; everyone when ready; external password only on transition |
| DeleteArtifact(artifactId) | Ok | everyone, any state, frees reservation and revokes grants |
| RotateExternalPassword(artifactId) | PasswordRotated | everyone, any state; external only; revoke old grants |
| GetExternalPassword(artifactId) | ExternalPasswordRetrieved | everyone, any state; external only; optional recoverable current password; strict cookie Origin |
| GetManifest(artifactId) | ArtifactManifest | auth, or public anonymous only; hashes and empty directories |
| GetUploadStatus(artifactId) | UploadProgress | any authenticated user; no activity refresh |
| FinishUpload(artifactId) | UploadFinished | owner; ready retry idempotent; publishing=409 until recovery |
| CreateGrant(artifactId) | GrantCreated | internal + ready, authenticated, single-use handoff |
| Search(query) | SearchResults | authenticated only; ready/unexpired only |

### Recoverable external passwords (Q38)

The additive sole-current1.0.0 command `GetExternalPassword {artifactId: str}`
returns `ExternalPasswordRetrieved {externalPassword: opt[str]}`. All registered
human and agent managers may retrieve, regardless of artifact ownership. This
sensitive read uses the same authentication, exact-cookie-Origin, bearer-Origin
and rate guards as management mutations, and returns `Cache-Control: no-store`.
Revoked credentials fail before artifact lookup. Anonymous/content-grant users
cannot retrieve. Non-external artifacts return `InvalidVisibility`; unknown or
deleted IDs return `NotFound`. Like existing rotation, retrieval is available for
uploading/publishing/ready and expired-but-not-deleted records. It does not refresh
idle activity, change the hash, revoke grants or automatically rotate anything.

New external initialization, transitions to External and explicit rotations
atomically write the hash and recoverable value. A metadata-only patch preserves
both; switching away removes the recoverable value; deletion cascades. Historical
hash-only records return null until an explicit rotation, even if their existing
password still unlocks content. A stored value whose hash disagrees with the
artifact fails sanitized `Unavailable`, never returns a possibly stale secret.

Recoverable values live in a separate FK table, not `Artifact`, manifests,
catalogue, search corpus/evidence, sidecars, errors or logs. Only dedicated
password-bearing command responses disclose them (including the existing
initialization, visibility-transition and rotation responses). The named storage
wrapper redacts `toString`. PostgreSQL and its snapshots/backups are now
secret-bearing like credential files; protect DB access and backup access
accordingly. There is no separately configured encryption key or new key service.
This feature grants no deployment, backup export or credential access authority.

The exact current schema mirrors are `migration/schema.sql` and
`backend/src/main/resources/manure-schema.sql`. Migration4 creates the separate
table without backfill. Original migration1 SQL is frozen as `001_metadata.sql`
to preserve existing checksum ledgers; startup applies migration4 to old databases
without rewriting metadata or reconstructing historical passwords.

Content Unlock and RedeemGrant return Ok and set a bound content cookie;
Logout returns Ok and clears/revokes it. GetManifest returns ArtifactManifest,
public anonymously or after a valid grant. Content expiry remains masked 404.

`ArtifactPatch` uses optional name/visibility (null = keep); `expiry` is the
explicit ADT `Keep {}`, `Clear {}`, or `Set {seconds}`. An empty name is never
"keep". File manifests are immutable; Directory variants cannot carry sizes
or hashes. Keep manifest entry ordering and every empty directory.

## Streaming and browser protocol adapters

These are current routes, not retained legacy management APIs:

* `PUT /api/current/artifacts/<id>/chunks?path=<urlencoded>&offset=<decimal>`:
  raw `application/octet-stream`, `X-Chunk-Sha256`, bounded global chunk size;
  success is the generated **ChunkReceipt** root JSON (not a Result variant).
* `GET /api/current/artifacts/<id>/files/<encoded-segments>/content`:
  authorized/public eligible raw attachment download. `Range`/206/416,
  `Accept-Ranges`, `Content-Range` and streaming bounds unchanged.
* `GET /__manure/files/<encoded-segments>/content`: grant-authorized/public
  attachment download; same range contract. Prefix `/view/<id>` in path mode.
* `GET /__manure/raw/<encoded-segments>`: authorized inline original bytes,
  with the same range contract; viewer source/image reads use this route.
* Standalone supported file roots negotiate a trusted formatted viewer for
  `Accept: text/html` when viewer assets are enabled. Responses vary on Accept;
  range requests and non-HTML clients receive original bytes. Unsupported files
  remain raw. Supported formats are Markdown, images/SVG, PDF, Mermaid and
  Graphviz; no generated API version or model change is required.
* `GET /__manure/view/<encoded-segments>` explicitly views a supported manifest
  file (including directory members). `GET /__manure/viewer/<asset-name>` serves
  only allowlisted bundled assets, after artifact authorization. Viewers retain
  restrictive CSP through final response middleware. No external renderer/CDN.
* Directory `/`, nested static paths, canonical 303 redirects and
  `GET /__manure/password` retain their behavior. Never auto-list.
* HTML navigation uses URL-encoded form adapters `POST /__manure/unlock`,
  `/__manure/grant`, `/__manure/logout` and API `/api/current/login` and
  `/api/current/logout`, with the same Origin/auth checks as their typed
  commands and 303 to the canonical root. These exist because cross-origin
  browser navigation cannot submit application/json; they are not alternate
  JSON management DTOs. Only `application/x-www-form-urlencoded` is admitted.
* No JSON `GET /__manure/manifest` alternate: use ContentCommand.GetManifest.

Every content route above receives the path-mode prefix when selected.
Strict single-pass segment decoding, reserved namespaces, symlink containment,
MIME, headers, grant separation and low-security path-mode warning remain.

In opt-in **low-security path mode only**, direct internal document navigation
(`GET`, `Sec-Fetch-Mode: navigate`, `Sec-Fetch-Dest: document`) can exchange a
valid human dashboard session cookie for the ordinary artifact-scoped content
grant. This covers root, nested document and `/__manure/view/...` bookmarks.
The server validates the local path, issues/redeems the credential-bound grant,
and sends an empty 303 to the same canonical path with an HttpOnly grant cookie;
no bearer/grant is put in a URL or HTML. Query data is not copied to Location.
An already valid content grant needs no exchange. Missing Fetch Metadata does
not opt in; fetches, raw/file endpoints, content APIs and management bearers do
not gain this session fallback. A supplied Origin must exactly match the API
origin; existing human/session, rate, visibility and revocation checks apply.
This does not restore path-mode origin isolation. Subdomain mode is unchanged:
its host-only dashboard cookie is not shared with content hosts; use dashboard
Open's one-time POST handoff (or an existing content grant).

## Catalogue requirements and open matching regression

One catalogue, default `CreatedAt Desc`, limit 50 clamped 1..maxListLimit.
All filters/sorts and `limit+1` keyset pagination operate on the full authorized
metadata relation, not an in-memory page or OFFSET. Text ordering compares
**unsigned UTF-8 bytes of the exact stored value**, including embedded NUL in
names/owner labels. Persist source strings losslessly as bytea where PostgreSQL
text cannot represent them; never normalize stored names. Artifact ID breaks
all ties in the requested direction. Epoch values preserve original SQLite
binary64 precision in imported metadata; date sorting/cursors use that exact
numeric epoch, not API display text. `ExpiresAt` null sorts last both ways.
API timestamps are UTC RFC3339 with `Z`, whole-second display for this contract;
never round-trip displayed timestamps into authoritative migration state.

Literal substring query MUST preserve Python Unicode **casefold** from
`CONTRACT.md`§7.1; no wildcard/regex, Unicode normalization, whitespace trimming,
truncation or additional query-length cap beyond transport admission. `Straße`
and `STRASSE` match; final sigma folds with sigma. Composed/decomposed Unicode
strings remain distinct absent casefold equivalence. Original strings/epochs
remain lossless; unsigned UTF-8 ordering is independent of the matching fold.

**OPEN IMPLEMENTATION/VALIDATION GAP:** `3e4bd126` now embeds pinned Unicode16
full-fold mappings and independent dual expected vectors, replacing the
incorrect ROOT-lowercase implementation/characterization. The authorized effective-folded cursor fingerprint and removal of the
unapproved1024-character cap are now implemented in the integrated source,
with independent dual assertions. Compiled corrected assertions and actual
source-bound native all-scalar validation remain mandatory before closure. The previous claim in this document that changing
Python casefold was deliberate/approved was wrong and is withdrawn. Actual
query projection, effective-query cursor equivalence and valid long-query
assertions need the parent/reviewer fail-first+fix; SQL keyset tests alone do
not close this gap. Existing policy labels are not authority to change behavior.

Cursor binds effective casefold-equivalent query, includeExpired, visibility, state,
sort, direction and clamped limit plus typed saved sort value and exact ID.
Reject malformed/type-wrong/mismatched/old cursors with BadEnvelope. No legacy
branch. Cursor is a position, not authorization or a snapshot; boundary deletion
needs no lookup and live mutation can move rows. Evaluate expiry each request.

## Retrieval

Search is distinct from exact ListArtifacts. Lexical/Semantic/Hybrid are
explicit; missing endpoint advertises Lexical only, unavailable requested mode
returns typed failure, never silent fallback. Authorize ready/unexpired rows
before every candidate limit/count/evidence selection, reauthorize at delivery.
Corpus is approved artifact metadata + manifest paths only (Name/ManifestPath
provenance); no credentials, hashes, passwords, grant values or binary contents.
Ordinary writes/catalogue/serving do not call a model. Published hits carry
sourceVersion/generationId/policyId/optional embeddingProfile/optional embeddingSpace and evidence.
ExactMatches versus CandidateWindow + rankingLimit are explicit. Scores are
ranking values, not confidence. Rebuild/profile changes cannot mix vector spaces
or replace good publication with an unlabelled partial generation.

## Build and rollout

`BABOON=<pinned executable> manure/scripts/generate.sh` generates Scala 2.13
and TypeScript, JSON only. Generated Scala root `Baboon*.scala` files are runtime
source; the common build must compile one verified runtime and exclude these
from per-domain modules. Never patch generated code. Python adapter is a strict
current-contract bridge, not a Python server compatibility layer. CLI/MCP keep
resume/cache/credential behavior and JSON-RPC 2025-11-25 framing; update transport
together. Schema, data migration and projection-policy versions are independent.
No activation, data deletion or credential rotation is authorized here.

## Component verification (not release acceptance)

The current Python bridge is generated by `scripts/generate-python.py` from the
sole model; it emits closed dataclasses/enums/ADTs plus a strict stdlib codec.
It has no HTTP server. The dashboard uses Baboon-generated TypeScript compiled
to ES modules under `web/dashboard/current/` by `generate-web.sh` using the
lockfile-pinned Chronicle dashboard compiler (7.0.2). The adjacent generated
`current-schema.js` supplies hostile-input validation before codec decoding.
`current-protocol.js` rejects duplicate JSON keys, mismatched correlation/result
variants and unsafe numeric/enum/object shapes; no secret server message is
shown. Existing DOM/race/access/password-clearing behavior is retained.

Fresh component checks on 2026-11-03, base `e9fda183` plus this contract/client
slice: generator digest verified; regenerate Scala/TS/Python/schema + fixtures
+ compiled browser codecs and compare every generated file SHA256 unchanged;
73 vectors (20 commands,48 results,4 content,1 raw chunk) round-trip in both
Python and generated TypeScript. Python current suites: 14 methods, 0
failures/errors/skips. Browser boundary Node suite: 6 cases, 0 failures/skips.
Existing dashboard markup suite: 7 methods, 0 failures/errors/skips. Commands:

```
BABOON=<pinned> manure/scripts/generate.sh
python3 manure/scripts/generate-fixtures.py
TSC=<lockfile-pinned> manure/scripts/generate-web.sh
node manure/scripts/codec-fixtures.mjs
PYTHONPATH=manure python3 -m unittest discover -s manure/tests -p 'test_current_*.py'
node --test manure/tests/browser/current-protocol.test.mjs
PYTHONPATH=manure python3 -m unittest discover -s manure/tests -p 'test_dashboard_markup.py'
```

These are codec/client-controlled-transport/markup checks, **not** Scala server,
PostgreSQL, native, Chromium or MCP SDK acceptance. An exploratory historical
`test_client_hardening.py` run (49 methods) had 8 failures and 18 error reports
(one parameterized case has two reports): its old REST fixture callbacks still
need conversion to current typed fixtures; all assertions/cases remain present.
No successful full historical-suite claim is made. The baseline 353-method
register is retained as the migration checklist, not replaced by these 27
component methods/cases. Real target-binary fixture migration proceeds separately.

### Actual-target test harness

`tests/target_server.py` requires explicit `MANURE_TEST_SERVER_COMMAND_JSON`
(nonempty JSON argv array, appends `serve CONFIG`),
`MANURE_TEST_ALLOW_CREATEDB=1`, `MANURE_TEST_JDBC_URL`,
`MANURE_TEST_JDBC_USER`, `MANURE_TEST_JDBC_PASSWORD_FILE`, and `psql` on PATH.
The provider must be an owned disposable cluster with CREATEDB permission.
Every fixture creates `manure_browser_<randomhex>` and drops only that owned
name; it never truncates/resets an arbitrary supplied database. Passwords use
an O_EXCL/0600 temporary PGPASSFILE, never argv. Launcher config includes the
required finite JDBC bounds. Root preexists. `MANURE_POSIX_LIBRARY` selects
shared JNI mode for JVM checks; without it the fixture requests linked native
mode, not a Python/JVM fallback.

Readiness requires the target's exact `MANURE_READY {apiOrigin,port,pid}` record
and a successful unauthenticated generated Version command **after** migration,
reconcile and HTTP bind. Missing launcher/provider/opt-in fails, not skips.
Shutdown waits for the real child before dropping its owned DB. Tests seed via
public typed API only; browser TLS retains the controlled Host-preserving edge.
Real TTL waits replace private clocks. See behavior-inventory.md for precise
executed component scope and remaining full-target acceptance requirements.


### Retained client fixture verification update

At committed source `3f5bba8162dad31fc8042ec3bb69e37837c506aa`, all114 retained
client-only hardening/transport/external/stateful/CLIresume/MCP protocol/hardening
methods now use current typed fixtures and pass without skips. Combined with
current codec/client/fixture-safety/markup/asset hygiene, the fresh Python run is
145 methods,0 failures/errors/skips; Node boundary/CDP run16 cases,0 failures/skips.
The official SDK1.32.1 controlled-current-HTTP stdio leg executes. Full logs and
source SHA binding are in `/tmp/manure-contract-evidence.Dc9gQ7`; the behavior
register records the earlier redirect-fixture failure/fix and current remaining
actual-target acceptance gates. The earlier old-fixture failures are historical,
not the current client-only suite status. No Python legacy server/API fallback
was introduced to make these pass. The nested real-target environment test
retains its real target prerequisite and must run under the parent's owned
PostgreSQL/executable fixture.


### Credential source configuration precedes secret-file I/O

Both a nonempty direct value and a nonempty file reference are always
`ambiguous-credentials`, even when the direct value is malformed or the file
would be missing, empty, unreadable or blocking. Presence is checked before
credential validation or opening a file. URL pairs retain their existing
whitespace/empty-as-unset rule; token/password direct values remain exact.
CLI/MCP preflight all relevant pairs before resolving any other pair's file;
CLI password flag/env combinations obey the same source-first rule. CLI returns
exit2 without file/network effects. Existing one-source canonical file codecs
and no-secret-diagnostics rules are unchanged. Focused fail-first evidence and
the fresh153-method zero-skip regression receipt are in behavior-inventory.md.


### Search embedding-space identity (sole current1.0.0)

`SearchHit.embeddingSpace: opt[str]` follows `embeddingProfile`. Published semantic
hits carry the actual immutable embedding-space ID and profile ID independently;
never reconstruct space from endpoint URL, dimensions or profile text. Lexical
HEAD hits carry null for both profile and space while retaining their actual
source version, HEAD generation, policy and field/path evidence. The current
schema is replaced in place as authorized; no historical version/codec retained.
Goldens now contain74 vectors including distinct explicit published space/profile
identities and a lexical HEAD hit with both null. Server constructors must pass
`hit.embeddingSpace` after `hit.profile`, not duplicate the profile value.

### Q38 focused component receipt (2026-11-08)

On base `f347c282` plus the recoverable-storage slice: the new raw current codec
behavior failed first (`GetExternalPassword` rejected; Python protocol10 methods,
1 error). After implementation, `nix develop .#chronicle` pinned generation,
fixture generation and web compilation reproduced identical generated-file
SHA256 values on a second run. Compiler-generated trailing whitespace is retained;
generated outputs were not manually patched.

Focused owned-disposable-PG/real-FS JVM run: ArtifactsMemory20,
ArtifactsPostgres20, Http20, Runtime8 =68 tests,0 failures/errors/skips. The runner
uses `test-backend.sh` provisioning with only the final sbt command narrowed to
`manureServer/testOnly manure.ArtifactsMemorySuite manure.ArtifactsPostgresSuite
manure.HttpSuite manure.RuntimeSuite`. Full unfiltered acceptance is not claimed.
Local receipt: `backend/target/validation-runs/20261108T224051Z.uwVh23/`;
its compiled-input `source.sha256` digest is
`fa6aa4bf7c0af268f35598ae03c6f7402fb14e34a92b565a4ab958438d710ddd`.
Current Python component suites:35 methods; Node protocol boundary:9 cases;
TypeScript goldens:76 vectors (21 commands,50 results,4 content,1 raw chunk), all
passing without skips. These are not deployed/native/browser release acceptance.
