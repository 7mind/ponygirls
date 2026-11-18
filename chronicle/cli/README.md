# Chronicle application CLI

`chronicle` is a standalone Node24 application client, not the collector or server
administration executable. No server/Graal dependency is installed. Run
`chronicle --help` for commands/examples; help and `rpc help` need neither
credentials nor a running service.

Human-readable, untruncated output is the default, even in pipes. Use
`chronicle COMMAND --help` or `chronicle help COMMAND` for relevant options and
examples (including `chronicle groups invite --help`). Invalid commands, arity,
unused flags and numeric bounds fail locally with usage guidance, without
requiring an origin, credential file or service. Use `--` before literal
option-like positional text, for example `chronicle search -- '--help'`.

`--color auto|always|never` works before or after a command. Auto styles human
output only when that output stream is a TTY, unless `NO_COLOR` is nonempty or
`TERM=dumb`; explicit always/never overrides those environment conventions.
Stdout and diagnostic stderr resolve TTY support independently. Pipes stay plain
human text unless always is selected. `--json` always disables ANSI, including
errors, and before or after a command emits one JSON document on success;
errors are sanitized stderr only.
Both forms escape terminal controls and directional-formatting characters while
preserving Unicode and exact parsed text. Full IDs, source identities, views,
spans, counts and cursors remain visible. Spans are half-open **UTF-8 bytes**, not
JavaScript/terminal character offsets. Archived content is untrusted data.

## Independent authentication

```bash
export CHRONICLE_URL=https://archive.example
chronicle login --login alice --password-file /private/password
chronicle search 'database migration'
chronicle messages SESSION_UUID --revision 3 --generation GENERATION_UUID --json
chronicle logout --yes

# A configured static or issued bearer token works without a human login.
export CHRONICLE_TOKEN_FILE=/private/archive-token
chronicle search 'database migration' --json
chronicle tags '' --limit 100
# Explicit selection wins when both independent credentials exist:
chronicle --auth session search 'database migration'
chronicle --auth bearer whoami
```

`--url` overrides nonsecret `CHRONICLE_URL`; there is no URL_FILE setting. Require
an exact canonical origin, without a path, query, fragment, username or password.
HTTPS is required unless **each invocation** explicitly opts into trusted
private-network plaintext with `--allow-insecure-http`. That flag exposes
passwords, cookies, tokens and source data to observers; it does not establish
network privacy. Neither HTTP nor WS follows credential-bearing redirects.

`--auth auto` is the default. For supported MCP reads (`whoami`, `search`,
`session`, `messages`, `chunks`, `context`, `related`, `facets`, `progress`, and
their typed `rpc` forms), auto selects a configured `CHRONICLE_TOKEN`,
`CHRONICLE_TOKEN_FILE` or explicit `--token-file`; otherwise it selects the human
session. `tags`, `ingest` and `report-progress` are bearer-only. Login, logout,
settings, account token management and WS-only operations remain independent
human-session operations and ignore unrelated bearer environment credentials.
`versions` is public. There is no family conversion, credential mixing or
fallback after credential/authentication failure. A configured bearer therefore
wins supported reads even when a different human session exists; use
`--auth session` to choose that session deliberately. Explicit unsupported
families and unused `--token-file` fail before credential reads or network I/O.

`CHRONICLE_TOKEN` and `CHRONICLE_TOKEN_FILE` are mutually exclusive when nonempty;
`--token-file` is an alternative, not an overriding third credential. Tokens use
Chronicle's43..1024-character `[A-Za-z0-9_+/.=-]` domain (not exact43/base64url);
credential files are bounded to4096bytes. Trailing whitespace is removed from
both literal and file inputs; leading whitespace is rejected. This follows the
Chronicle configured-token normalization rather than the separate runtime-token
wrapper's exact43/single-LF boundary. Password handling is independent. Ambiguity
for the selected family fails before credential reads/network. Human login,
settings and WS commands do not read unrelated bearer credential contents.
Bearer credentials never accompany cookies. No token/password argv option is
provided. Protected credential references resolve once (including managed/agenix symlinks)
to bounded regular files with no group/other permissions, outside `/nix/store`;
replacement symlinks and FIFOs/special files are rejected without blocking.
CLI-owned state separately requires current-user ownership and no symlinks.

Login accepts exactly one `--password-file` or `--password-stdin` (explicit
noninteractive pipe/redirection). Passwords do not appear in errors. Human
sessions use independent `/api/account/v1` cookies and owner-bound
`X-Account-Actor`, then exact-Origin WS negotiation/heartbeat/correlation. No
server authentication changes or bearer-to-session conversion are attempted.

Session files are bound to the exact origin and displayed owner, under
`CHRONICLE_STATE_DIR` or `${XDG_STATE_HOME:-$HOME/.local/state}/chronicle-cli`.
The CLI-owned directory must be0700 and session files0600; symlinks and cross-origin
state are rejected. This is separate from the collector's `chronicle` spool.
Session secrets stay in those private files and are not emitted. This client
manages one independent human session per origin/state directory. A second
login replaces local state; it does not revoke an earlier server session.
Use different private `CHRONICLE_STATE_DIR` directories for separate accounts.

Sandbox/container ephemeral filesystems do not establish cross-launch session or
uncertainty recovery. If persistence is required, explicitly provision a separate
private persistent state directory/bind for that context and retain request/run
identities. Do not bind a host human-login folder into an agent sandbox: that
would expose independent account/cookie authority. No automatic bind is created.
Logout removes only the captured session and preserves a concurrently replaced
local account. State writers serialize through a short-lived origin-specific
private lock directory; an interrupted writer leaves an explicit lock error,
never an automatic stale-lock deletion/retry. Inspect the directory and ensure
no writer remains before manually removing an interrupted lock. The server owns
revocation and cookie lifetime, not a fabricated local TTL.

## Coverage

| Interface | Commands / coverage |
|---|---|
| Public discovery | `versions` requires the sole current1.9.0 API |
| Bearer Read/MCP | Auto with a configured token, or explicit `--auth bearer`: `whoami`, `search`, `session`, `messages`, `chunks`, `context`, `related`, `facets`, `progress`, `tags` (all ten current tools) |
| Bearer Ingest | `ingest --file PATH\|- --yes`, `report-progress --file PATH\|- --yes` |
| Human retrieval | `search`, `archive`, `session`, `messages`, `chunks`, `passages`, `passage-spans`, `find`, `locate`, `context`, `raw`, `related`, `facets` |
| Activity/settings | `activity`, `jobs`, `usage`, `collectors`, `progress`, `settings`, `session-status`, `tokens list` |
| Deliberate management | `jobs retry`, `retry-failed preview/apply`, `reindex preview/apply/status`, groups/invitations/membership, token mint/revoke, purge, logout |
| Complete typed application API | `rpc help [Operation]`, `rpc --file PATH\|-` (`call` alias); every current operation has a checked effect policy. Includes expression hints, legacy Archive result, LocateMessage, MCP test catalog/start/read/cancel and durable receipt lookup. Hello/Ping/Pong are transport-owned, not a raw escape hatch. |

All RPC input is validated against a checked-in boundary schema derived directly
from `models/chronicle.baboon`, **then** decoded/encoded with its sole current
Baboon generated codecs. Missing/extra fields, duplicate JSON keys, invalid
UUIDs, primitives, enum values, unsupported unions, unsafe numeric i64 and
out-of-range integers fail before transport.

UUID comparisons use their case-insensitive domain identity, including envelope
correlation, receipt IDs, pinned generations and MCP run keys. Accepted input
spellings and payload text are not rewritten. Null generation equals only null;
opaque user/source identifiers, JSON-RPC IDs and profile names remain exact.

`rpc help Operation` describes
required-present nullable fields and nested types. JSON i64 output is exact
decimal strings; safe numeric input is accepted, unsafe numeric input is
rejected rather than silently rounded. No removed-version compatibility path.

```bash
chronicle rpc help ReadMessageContext
# An operation, not a hand-constructed HTTP request:
printf '%s\n' '{"ListTokens":{}}' | chronicle rpc --file - --json
chronicle reindex preview --json
# Review target/profile and selection before explicitly applying:
chronicle reindex apply --target-profile PROFILE --selection-hash HASH --yes
```

Ingestion accepts a complete generated `IngestRequest` JSON document, including
explicit source identity, CAS revision, request UUID, raw files/digests and
normalized messages. It **never** discovers, reads or uploads local session
history implicitly. `report-progress` accepts a generated
`CollectorProgressUpdate`. Use the collector for deliberate discovery/parser
workflows, not this application's read commands.

### Views and pagination

Null view discovers current publication or unindexed HEAD. Copy its returned
`revision` and optional `generationId` into all subsequent content reads.
Revision without generation explicitly selects archive-only content.
Find/context/passages/locate require `--revision`; they never silently repin to
HEAD. Returned pins/pages must match the request. Retired indexed views return
`indexed-view-retired`, not newer content. Raw reads accept an explicit revision.

Pages are explicit: `--offset/--limit` or returned `--cursor`, with no hidden
all-pages traversal. Tag cursors are **exact last tag values**, including the
empty string (`--cursor ''`); pages are live, not a frozen snapshot. Search
retains ExactMatches/CandidateWindow and ranking limits rather than presenting
candidate counts as global counts. Archive uses generated expressions and
cursor/relevance/sort metadata without treating MCP filters as expressions.

### Mutations, secrets and uncertainty

Every mutation requires `--yes`. Read commands reject unused `--yes` rather than
silently ignoring it. `--request-id` is accepted only for WS operations, and
`--secret-out` only for token mints; supplying either to another operation is a
usage error. Sharing acceptance also requires
`--confirm-sharing`. Reindex/failed-retry apply binds an exact reviewed
`--target-profile`/`--selection-hash`; it does not preview and silently apply.
No automatic mutation retry, WS reconnect or token-secret replay is performed.

Typed faults do not by themselves prove rejection before commit. A dispatched
WS mutation followed by a delivery-time authentication, availability, protocol
or unrecognized error remains uncertain and retains its original receipt UUID.
Current transaction/pre-admission business rejections remain definitive. HTTP
failures must match their independent account wrapper or generated Failure DTO,
recognized status/code semantics and route before they count as rejections;
malformed, wrong-family and availability faults after dispatch remain uncertain.

A schema-valid acknowledgement must also bind to the submitted request UUID,
operation and known entity/target. A mismatched receipt remains uncertain with
its **original** UUID; it is never printed as success. Retry/reindex apply binds
both UUID and target profile. Receipt lookup instead validates the historical
UUID requested by the lookup, not its new transport-envelope UUID. Token results
contain no request UUID: dispatch checks the requested name/permission set;
lookup can verify metadata-only/no-secret semantics but cannot independently
bind an absent UUID or infer an unknown original operation/entity payload.

All token mints additionally require `--secret-out NEW_PATH` in an existing
private0700 directory. The secret is written exclusively as0600, never printed.
The response contains metadata with null/omitted secret plus `secretSaved`.
Replay/receipt responses have no recoverable secret. Account HTTP mint has no
request-ID receipt; after acknowledgement loss inspect token metadata,
identify/revoke the uncertain token and deliberately issue a replacement.
Use typed WS `MintToken` when durable **metadata** receipt recovery is needed.

For ordinary WS mutations, `--request-id UUID` provides an explicit receipt
identity. After an uncertain acknowledgement, the error includes the UUID:

```bash
chronicle receipt REQUEST_UUID --json
```

Do not blindly replay, especially when a secret was returned once. An ingest
retry must deliberately retain exactly the same source, requestId, payload and
expectedRevision; an acknowledgement means durable ingestion, not publication.

`StartMcpTest` is a connection-owned run, not a durable request-ID mutation.
The CLI retains that same socket, answers heartbeats, polls `ReadMcpTest` and
collects its bounded trace until terminal state, then emits **one** result.
There is no watch/NDJSON or partial stdout. Closing the owner socket cancels and
erases the server trace, including after completed retrieval. On interruption,
provider execution is unknown; inspect the original instanceId/runId explicitly
and never restart blindly. AuthorizationLost discards accumulated protected
trace. Scripted tests do not establish model/semantic relevance quality.

Whole-command deadlines default30s, explicitly configurable with
`--timeout-ms`100..900000; stdin, HTTP and WS share the deadline. HTTP bodies and
decoded WS application messages are at most8MiB; WS requests at most64KiB.
Pinned Node24's native receiver additionally bounds compressed/frame assembly
at128MiB and131072 fragments before application decoding. MCP accumulation is
bounded to256 events/8MiB. MCP test polling does not extend the command deadline.

Exit codes:0 success;2 usage/invalid;3 authentication/credentials/forbidden;
4 missing/gone/retired view;5 conflict;6 transport/protocol/deadline/state/
availability;7 uncertain mutation. Remote error bodies, credentials and stack
traces are never printed.

## Build and verification

Use the repository's pinned development shell and locked dependency tree:

```bash
nix develop .#chronicle --command bash -c 'cd chronicle/cli && npm ci && npm run typecheck && npm test'
```

The same suite runs as `chronicle/scripts/test.sh cli` in the inner loop. It
includes specified blackbox codec/command/output contracts and actual CLI
subprocesses against owned HTTP/WS fixtures. The Nix package (`nix build
.#chronicle-cli`, a member of `scripts/verify chronicle`) runs it once in its
build and then a short smoke test (`test/smoke.mjs`) against the installed
`bin/chronicle` wrapper. Set `CHRONICLE_CLI_EXECUTABLE` to an installed absolute
binary path to run the process tests against it: `node --test
dist/cli/test/cli.test.js` from `cli/` after a source build. No live credential
or service is used. Regenerate the boundary schema only when the current model
changes: `cd chronicle/cli && node scripts/schema.mjs`, then inspect/test it.
A normal build checks that this generated boundary is current.

An expired absolute budget rejects before WebSocket acquisition. Post-acquisition
budget/timer setup is covered by socket ownership and cleanup; it never restarts
the command budget. Direct native-adapter tests cover these resource guarantees.
The held-stdin CLI case checks input-budget rejection, not a whole-process
reproduction of the exported transport acquisition defect.

Real-server acceptance runs on demand, not in `scripts/verify chronicle`: run it
when the CLI's server contract changes. It requires a source-bound executable,
fresh owned provider cluster and Linux `/proc` listener-ownership proof. Inside
the pinned shell, from the repository root:

```bash
CHRONICLE_SERVER="$(nix build --no-link --print-out-paths .#chronicle.nativeArtifact)/libexec/chronicle-server" \
  "$(nix build --no-link --print-out-paths .#service-test-fixture-tools)/bin/with-service-postgres" \
  bash chronicle/cli/scripts/test-server.sh
```

The provider supplies `PONYGIRLS_OWNED_FIXTURE_ROOT` and the Chronicle DB
manifest; arbitrary/live database options are deliberately unavailable. The
runner accepts `CHRONICLE_CLI_EXECUTABLE=/nix/store/.../bin/chronicle` for actual
installed-binary acceptance, or explicitly labels the default as source-built.
An installed run verifies every installed runtime JS/package file against the
fresh source build and binds its wrapper plus the pinned Node executable digest
and version in the receipt. Set that variable outside the owned-PG wrapper; it
does not select any live service or credential. The runner uses `serve-standby`,
synthetic content and an owned scripted model for
the actual MCP test/tool loop; no external models or semantic-quality claim. Each run
creates a fresh ignored `cli/artifacts/server-*/receipt.json` with source hashes,
case counts and errors/skips, plus sanitized owned server logs. It terminates
only its own child server and the provider removes its owned cluster.

These CLI checks do not replace full verification (`scripts/verify chronicle`). Native fixture
acceptance establishes only the exercised local application paths, not live
availability, deployment, real providers or semantic retrieval quality.
