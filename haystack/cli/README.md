# Haystack application CLI

Standalone Node24 client, executable `haystack`. It does not embed the server,
GraalVM, a browser, or an MCP proxy. Run `haystack --help` for examples. Human
output is the default even when piped; `--json` is explicit and accepted before
or after commands. Help/version need neither credentials, state nor network.
Use `haystack COMMAND --help` or `haystack help COMMAND` for focused usage,
examples and command-specific safeguards; token actions likewise support
`haystack token issue --help` / `haystack help token issue`. Required option
presence, exclusive `--file`/`--stdin` sources, irrelevant token options and
incorrect action arity are checked before configuration, credentials, state or
input reads. Static validation does not read files or authenticate.

`--color auto|always|never` works before or after commands. The default `auto`
styles human headings/help only on that output stream's TTY; redirected human
output stays plain. A nonempty `NO_COLOR` or `TERM=dumb` suppresses automatic
colour. Explicit `always`/`never` overrides those environment controls. Stderr
uses its own TTY capability. `--json` always disables ANSI, including help,
errors and watch NDJSON; stripping colour from human output preserves its text.

## Configuration and authentication

```bash
export HAYSTACK_URL=https://haystack.example
export HAYSTACK_TOKEN_FILE=/run/credentials/haystack-token
haystack whoami
haystack get corporate-activity:example --json
```

- `--url` overrides `HAYSTACK_URL`. Supply one HTTP(S) **origin**, no credentials,
  path, query or fragment. There is no URL-file parser. HTTPS is mandatory by
  default. `--allow-http` is an explicit per-invocation cleartext opt-in for an
  owned loopback test or a trusted encrypted private overlay; it is not TLS.
- Data commands select bearer if nonempty `HAYSTACK_TOKEN` or
  `HAYSTACK_TOKEN_FILE`/`--token-file` is configured, otherwise the origin's
  password session. `--auth token|session` selects explicitly. In bearer mode,
  simultaneous TOKEN and TOKEN_FILE is an error **before any credential read
  or network request**. The explicit token-file overrides the environment's
  token-file, not a nonempty TOKEN. Empty environment values are absent.
- `health` and `versions` are unauthenticated and never read credentials.
  `login`, `logout`, `status`, `account` and `token` always select the independent
  password session. Watch likewise requires a password session (the server does not admit bearer live sockets).
  They ignore unrelated bearer environment values and reject
  explicit `--auth token`/`--token-file`. `--auth session` likewise never reads
  bearer contents. No request combines Authorization and Cookie.
- Credentials are canonical unpadded32-byte base64url. Files allow one final LF;
  other whitespace is rejected. Token/password files must be bounded regular
  files owned by this UID, without group/other permissions or hardlinks. Managed
  credential symlinks are resolved and the opened regular file identity is checked.
  A token is never accepted as a password-session credential.
- `HAYSTACK_STATE_DIR`/`--state-dir` selects an absolute private state directory;
  default `${XDG_STATE_HOME:-$HOME/.local/state}/haystack-cli`. Directories are
  0700, state files0600; symlink components and wrong ownership/modes are errors.
  Session files are hashed by exact canonical origin (scheme, host and port).
  Never copy them to another machine/account. HTTP sessions cannot be sent to
  HTTPS or another origin. State contains credentials and possibly documents:
  do not commit, publish, back it up insecurely, or send it to an artifact host.
- Redirects are always refused, including same-origin redirects. There is no
  credential forwarding, automatic retry, endpoint fallback or body replay.

### Persistent state in restricted agent sandboxes

A sandbox may bind `HOME`/`.cache` without persisting `.local/state`. Fsync makes
entries durable on the selected filesystem; it does **not** make an ephemeral
container filesystem host-persistent. For recovery across sandbox launches,
explicitly provision a dedicated agent-only0700 host directory, authorize a bind
of only that directory to a private sandbox path, and set `HAYSTACK_STATE_DIR`
to that path. Preserve its0600 journals between launches. There is no automatic
bind or permission expansion. Never mount an ordinary human-login state/session
directory into an agent sandbox merely to obtain persistence; use separate
agent credentials and state.

Every authenticated user can read and write **every item**. User type controls
attribution, not item authorization. Token settings are cookie-only and limited
to the signed-in owner. There is no cross-user account administration.

## Exact data, browse and retrieval

```bash
haystack put my-project:fact --file document.json --expected-revision 0
haystack get my-project:fact --revision 1 --json
haystack history my-project:fact
haystack search 'type:fact and importance:high' --sort title --direction asc --limit 10
haystack search 'type:fact' --limit 10 --cursor 'opaque cursor returned above'
haystack retrieve 'protocol recovery' --limit 20
haystack retrieve 'protocol recovery' --mode lexical --limit 20
haystack analyze 'type:fact' --caret 9
haystack complete 'type:'
haystack values type
```

IDs must be full canonical `encode(project):encode(item)` IDs, using uppercase
RFC3986 percent escapes. Namespace `--project` is a **raw** component, not a
qualified ID. IDs, revisions, request IDs, cursors and provenance are never
shortened. Each decoded ID component is limited to256 UTF16 code units and1024
UTF8 bytes, matching the server; supplementary characters occupy two units.
Revisions use the generated i32 bounds. Document JSON numeric source
tokens (`9007199254740993`, `0.10`, `1e2`, `-0`) remain exact; duplicate keys,
invalid Unicode and exponent overflow are rejected rather than rounded.

The sole current generated Baboon1.0.0 request/response codecs are compiled from
`../generated/typescript`; nothing patches them. DTO shape checks close their
TypeScript cast-only scalar boundary. `Item.document.json` is the exact document
text, not a lossy parsed JS object. Retrieval's generated i64 `total` is decoded
losslessly and encoded as a **decimal string** in JSON output. Search reports
returned summaries, **not** a claimed corpus total. Retrieval keeps the server's
`ExactMatches` versus `CandidateWindow` label, `rankingLimit`, source revision,
generation, profile/embedding space, policy, pointer/field, text, score and UTF16
ranges, and `pending`: the number of in-scope items not yet indexed for semantic
search (always `0` for lexical).

Without `--mode`, `retrieve` first reads `GET /api/v1/capabilities`: it runs
**hybrid** when the server offers it, otherwise lexical with one stderr notice
`Notice: Hybrid search is not available on this server: <reason>; showing lexical results`.
If a defaulted hybrid request is refused with a typed `unavailable` reason (for
example `query embedding failed`), it is re-run once as lexical with the same
kind of notice naming the server's reason. An explicit `--mode` is never substituted: an
unavailable explicit mode fails with exit6, code `unavailable`, the server's
fixed reason as `message` and `reason` `not-configured`|`embedding-failed`; no
other server message text is ever shown. `pending > 0` adds the stderr note
`Notice: N items are not yet indexed for semantic search; results may be incomplete`
(`Notice: 1 item is not yet indexed …` for one).
Notices go to stderr when they are known: a downgrade notice before the lexical
request, the pending note after the answer; stdout stays the result. If the
lexical re-run fails too, stderr holds the notice line followed by the usual
error output (one JSON line with `--json`), and the exit status is the lexical
failure's.
`call retrieve` sends exactly the given mode. This CLI requires the current
server: an older server without `pending` or the capability read is rejected.

Values/completion are bounded suggestions, not exhaustive facets or counts.

Search excludes archived items by default; use the query language's
`archived:all`/`archived:true` selectors when intended. A cursor is bound to its
original query/project/limit/sort. `--all` deliberately follows pages, with a
1000-page guard, a combined response-byte bound and a total pagination deadline
based on `--timeout-ms`. Every page's in-flight request/body is aborted when the
remaining total budget expires, without replacing the captured credential promise.
It fails instead of returning an undisclosed partial answer. Save the explicit cursor for manual continuation.

For scripts/rare request shapes, `call OP --file FILE|-` accepts **only** the
current generated requests for `get`, `put`, `search`, `history`, `analyze`,
`complete`, `values`, `retrieve`. Input is strict duplicate-free JSON, checked
against the selected schema and semantic bounds, decoded and re-encoded by the
same codecs. Optional fields are nullable per those codecs. It is not an
unvalidated HTTP escape hatch. Example:

```bash
printf '%s\n' '{"query":"horse","mode":"Lexical","project":null,"includeArchived":false,"offset":0,"limit":20}' |
  haystack call retrieve --file - --json
```

## Deliberate writes and recovery

`put` is a whole-document CAS: `--expected-revision 0` creates only; a positive
revision replaces exactly that revision. `--file -` (or `--stdin`) reads bounded
UTF8 stdin. Request IDs are fresh UUIDv7 by default, optionally supplied through
`--request-id UUIDv7`. Successful receipts include that complete ID.

```bash
haystack edit my-project:fact --file revised-document.json
haystack archive my-project:fact
haystack unarchive my-project:fact --status actual
haystack attention my-project:fact required
haystack restore my-project:fact --revision 1
```

These helpers read head and deliberately submit a **new full-document CAS**;
restore reads the requested historical snapshot and creates a new revision.
They never delete, merge concurrent changes, guess a prior unarchive status,
overwrite a newer revision, or retry a conflict. Read and deliberately edit
again after a conflict. Unchanged numeric lexemes survive helper writes.

Before transmission, a private file retains the exact generated put request:
document text, canonical key, expected revision, original UUIDv7, origin and
user/token identity. Transport loss, interrupted/invalid success bodies and
server failures leave it intact. A new operation for that principal is blocked.
Authentication/authority rejections can follow a committed write and retain uncertainty.
Only a validated non-authentication terminal response clears it; no fallback/fresh-ID retry occurs.

```bash
haystack pending --json
haystack replay
# Same explicit operation as replay; it does not guess from a current head:
haystack reconcile
```

`pending` inspects all retained operations for the selected origin **offline**,
without reading credentials; it reveals identity/key/CAS/request ID but never
prints document contents. `result.operations` is always an array; `operation`
is also populated when exactly one operation is retained.
Replay requires the same authenticated user/token identity. A head/history
comparison is not proof of a particular outcome; `reconcile` therefore replays
the **original exact** request ID, which consults the server's durable receipt.
The origin's exclusive lock serializes state mutations. If a process is killed
without cleanup, a retained lock fails closed: independently verify no operation
is running before manually removing **only that origin's lock file**. Do not
remove pending-operation files or mint a new ID as recovery. A terminal conflict
is not silently merged; a retained pre-cutover replay may need operator review.

## Password sessions and token settings

```bash
haystack login alice --password-file /run/credentials/haystack-password
haystack status
haystack account
haystack token list
haystack token issue --name worker --secret-file ./new-worker.token
haystack token revoke 'opaque issued token ID'
haystack logout
```

`--password-file -` accepts an explicitly piped protected input instead of an
interactive terminal. Passwords never appear in argv, URLs, output or diagnostics.
One trailing file/input LF is removed; other password characters are not trimmed.
Login installs only the selected origin's secure/explicit-development cookie.
Subsequent settings mutations fetch the current account actor, retain the exact
session captured by this invocation, and send owner-bound `X-Account-Actor`.
Configured tokens are immutable. Logout revokes this session on the server and
removes its local cookie after acknowledgement; outages do not discard it.

A newly issued token's secret is returned by the server **once**, saved directly
to a new0600 `--secret-file` (never overwrite), and never placed on stdout,
stderr or in the pending guard. The file path is user-chosen, not returned by
server input. Token issue has **no idempotency key**. An uncertain issue leaves a
private guard and blocks issuing again, even if no secret was received. Inspect
`token list`, revoke any unintended issued token, then explicitly
`token acknowledge` to clear the guard. Acknowledgement does not recover a lost
secret, prove rollback, revoke a token or issue a replacement. An empty reserved
secret file may remain after failure. Login/logout are never automatically
retried either; a lost login response can leave a server session whose cookie
was never received.

## Output, errors and streaming

Ordinary success uses domain-labeled human views, including when piped: identity
and write receipts, decoded document title/status/attention/description and audit
metadata, complete browse/retrieval provenance, revision/token rows, bounded
suggestion lists, pending-operation recovery identifiers and explicit empty states.
Only arbitrary document fields are rendered as clearly labeled lossless JSON;
ordinary DTOs and escaped `document.json` are not the default interface. Rare
structured results use indented keys/lists. For example:

```text
Item: project:fact
Revision: 1
Title: Exact counts
Type: fact
Status: actual
Attention: required
Importance: low
Created: 2026-11-16T00:00:00Z by bot
Modified: 2026-11-16T00:00:00Z by bot
Description:
  A readable description, not an escaped envelope string.
Fields (JSON):
  {
    "n": 9007199254740993
  }
Links: none
Tags: none
```

`--json` instead emits one unchanged machine-contract object on stdout:

```json
{"ok":true,"command":"get","result":{"key":"p:i","revision":1,"document":{"json":"..."},"metadata":{}}}
```

Writes additionally include top-level `requestId`. Errors go **only to stderr**;
`--json` gives `{"ok":false,"error":{"code":"...","message":"..."}}`, with
safe numeric status/currentRevision/span offsets/requestId/pending when relevant.
Raw server messages, exception strings, submitted values, filesystem paths,
headers and credentials never enter diagnostics. Human errors retain the same
safe HTTP status, current revision, UTF16 span offsets and complete request ID
when present; usage errors point to focused help. Human text escapes terminal
controls (including ESC, C1, bidi/format controls); JSON preserves data and must
not be printed unsafely to a terminal by a downstream consumer.

| Exit | Meaning |
|---|---|
| 0 | Success (including an observed watch reaching its bound or Ctrl-C cancellation) |
| 2 | Usage/input/configuration/credential format or rejected client request |
| 3 | Unauthorized/forbidden |
| 4 | Not found |
| 5 | CAS/replay/owner conflict |
| 6 | Transport/deadline/protocol/output/resource failure |
| 7 | Uncertain or blocked write/token issue requiring deliberate recovery |

Watch is the explicit streaming exception:

```bash
haystack watch --json --duration-ms 60000 --max-events 1000
```

JSON mode is **NDJSON**, one `{ok:true,command:"watch",event:<LiveFrame>}` per
changed frame. No progress banners or heartbeats appear on stdout. Errors still
go to stderr and terminate nonzero; earlier events are not retracted. Human mode
prints escaped frames. WS follows the current generated framing, application
ping/pong plus transport heartbeat. Incoming frames are bounded to64KiB, matching
the server's outgoing queue budget and admitting complete legal encoded keys.
The client queue is bounded to64KiB/64frames, including pending delivery.
No auto-reconnect or hidden cursor recovery occurs. Default bound60seconds or
1000changed events; configurable finite maxima1day/1million. Ctrl-C/SIGTERM
cancels and closes the stream. Expiry before an authenticated application frame
is observed is an error, not successful observation. Application pongs must echo
the pending nonce/clock exactly. A stalled output consumer does not extend the
observation deadline or prevent Ctrl-C cleanup: undelivered output is cancelled,
the owned pipe is closed, and `output-failed`/exit6 reports incomplete delivery
instead of silently dropping a partial frame and claiming success.

Requests default to30seconds (maximum10minutes); responses default32MiB
(maximum64MiB). Inputs are bounded, invalid UTF8 and truncation are errors.

## Build and validation

```bash
cd haystack/cli
npm ci --offline --ignore-scripts --no-audit --no-fund
npm run typecheck
npm test
# Explicitly provision an owned disposable PG cluster + built Scala artifact:
npm run test:real
```

`npm test` runs specified behavioral blackbox process tests against a controlled
loopback API, real PTY/pipe presentation checks (using test-only Python 3), and
generated-codec boundary tests. `test:real` is a separate,
fail-closed no-browser acceptance leg against an owned real Scala server and PG,
not a substitute mock. See `tests/real.acceptance.mjs` and
`tests/run-real.sh` for its explicit prerequisites. There are no live-service
reads/writes. New application protocol changes require updating this validated
command inventory; the legacy rejected bearer-login endpoint is intentionally
not exposed as a password-login fallback.
