# Account HTTP code: one shared implementation for Haystack, Manure and Chronicle

Status: stage 1 done and reviewed; stage 2 done, under review; stages 3 to 5 and three fixes follow. This file records the work for a reader
who has not seen the plan it condenses (`account-glue-dedup.md`, a survey kept outside the repository).

## What the work is and why

Haystack, Manure and Chronicle each carry their own HTTP side of accounts around the shared account logic of
`shared/service-auth`: cookies, Host and Origin checks, same-origin proof for writes, credential selection, tokens
declared in the configuration, and the account routes. A fourth service, Blabber, needs the same. The question was
whether to copy Haystack's code into Blabber or to move it into a shared module that all of them use.

## The owner's decisions

- **Q204**: "Option 2. Check if we have a shared library already. If thre is duplication across
  manure/haystack/chronicle -- deduplicate!"
- **Q214**: "Fix the three security-relevant ones (1 to 3), each as its own change with a failing test first;
  record the minor ones"
- **Q216**: "Land each stage and each fix on `main` when it is verified and reviewed; I am told at each landing"

Option 2 is read as: move the code into a shared module the services use; where the move cannot be made without
changing what a service's tests assert, stop.

## The three questions

**Was there a shared library?** Yes. `shared/service-auth` (sbt project `serviceAuth`) already held about half of
the account plane: the HTTP-neutral dispatcher of every account route except five (login with imperative accounts
off, logout, the account read, token issue, token revoke), the account JSON protocol, sessions, issued tokens,
attempt limits, the client-address rule and the cookie lifetime. All three services call that dispatcher. No shared
code touched http4s, cookie names or attributes, Host, Origin, Fetch Metadata, configured tokens or configuration
parsing. Its classpath already carried http4s.

**How much was duplicated?** About 585 lines of glue in Haystack, 510 in Manure and 575 in Chronicle. Of 29
responsibilities compared between Haystack and Manure, 4 were textually the same, 8 were the same rule written
differently and 17 were different rules (9 deliberate, 5 drift, 3 with no reason found). Chronicle shares with the
other two the pipeline around the dispatcher and nothing at the store level: it keeps its own tables.

**Why one module with per-service parameters, not one behaviour?** All three run http4s on Ember with cats-effect
`IO`, so one implementation can serve them. But the composition of the rules differs and is pinned by each
service's tests: the Host and Origin rules, the same-origin proof for cookie writes, the status of the same refusal
(a bearer token on the account plane is 401 in Haystack, 400 or 401 in Manure, 403 in Chronicle), cookie value
trimming, when configured digests are read. Changing any of these would change tested behaviour. So the module
owns the mechanisms, and each service passes its policy values (hosts, origins, cookie names, which rule variant it
selects) and maps each refusal to its own failure code, message and status.

Placement: two packages inside the existing `serviceAuth` project, `ponygirls.auth.boundary` (HTTP-neutral) and,
from stage 2, `ponygirls.auth.http4s`. No new sbt project, no change to `build.sbt` or the lock files.

## Stages and fixes

Stages, in order:

1. Haystack's transport rules, configured tokens, declared-user validation and imperative settings move into
   `ponygirls.auth.boundary`; Haystack keeps thin façades.
2. Haystack's account service and the five account routes move into the shared module (service and http4s adapter).
3. The parameters Blabber needs (cookie-only routes, an actor helper for domain routes, its id rule, its indexing
   service), so that Blabber uses the module instead of a copy.
4. Manure adopts the shared code (reply writer, pipeline, configured tokens with per-check reading, the shared
   account store over its transactions).
5. Chronicle adopts the pipeline only; its store, typed scopes and static tokens stay.

**Stop rule, every stage.** The stage stops and nothing of it lands if an existing test file needs any edit beyond
an import line, if the expected counts of Haystack's `HttpAuthenticationCountTest` change, or if a pinned status,
failure code, message, cookie string or log line changes.

Fixes, after the stages, each its own change with a failing test first (Q214):

1. A per-client limit on password-login attempts in all three services. Today Haystack has none while imperative
   accounts are off, Manure keys its limit by the socket peer (behind its proxy that is the proxy, one bucket for
   all clients), Chronicle limits concurrency only.
2. Haystack's strict reader for token-digest files: today it opens any path, so a FIFO would block start-up or a
   reload; Manure's bounded reader refuses non-regular files.
3. Chronicle's session cookie gets a `__Host-` name. This logs every Chronicle user out once.

## What stage 1 did

**Moved** from `haystack/server/src/main/scala/haystack/auth/Auth.scala` (230 lines before, 151 after) into
`shared/service-auth/src/main/scala/ponygirls/auth/boundary/` (about 465 lines in three files):

- origin canonicalisation and Host parsing (`CanonicalOrigin`, `RequestAuthority`);
- the origin policy: Host admission, Origin admission, the same-origin proof for writes, the account-plane rule
  with the `X-Account-Request` header on opted-in plain-HTTP origins (`OriginPolicy`);
- session cookie serialisation and selection (`SessionCookie`, `SessionCookies`);
- credential selection: one bearer or the session cookie of the request's security class (`CredentialSelection`);
- the digest-file reader, configured tokens and declared-user validation (`DigestReader`, `ConfiguredTokens`,
  `DeclaredUsers`, `DeclaredIdRules`);
- the imperative-account settings (`ImperativeConfig`, `KeyFilePolicy`).

**Shared interface, in brief.** Request checks throw `BoundaryRefused(Refusal)`; configuration loaders return
`Either[ConfigRefusal, A]`. Parameters where services differ: `SecureAttribute` (`Last` for Haystack,
`BeforeMaxAge` for Manure), `CookieValue` (`Trimmed`, `Exact`), `DeclaredIdRules` (`Haystack`, `Manure`),
`DigestRead` (`Snapshot`, `PerCheck`), `DigestReader` (`Stream`, `Bounded`), `KeyFilePolicy`
(`LiteralStorePrefix`, `NormalizedPath`), `CredentialAccept` (`BearerOrCookie`, `BearerOnly`). An `OriginPolicy`
parses a configured origin only when a check first needs it and keeps the parse; `OriginPolicy.load` validates
every origin up front. `ConfiguredTokens.live(userId, tokenId, digest)` answers whether a persisted grant is still
live. The values Manure will need in stage 4 are implemented and tested now, so stage 4 does not widen the types.

**Stayed in Haystack**: its configuration types (`AuthConfig`, `UserConfig` and the rest), configuration parsing,
the reload loop, and façades with today's names and signatures (`Tokens`, `Origin`, `Sessions`, `Auth`,
`RequestHeaders`, `Presented`, `Authenticated`). A private `Refused` object maps every shared refusal to Haystack's
`Fault` with today's code and message, by an exhaustive match. `AuthConfig` compiles its origin policy once per
configuration value (a lazy member); a reload builds a new configuration value and so a new policy.

**Review round.** An advisory review found three blockers, all fixed with a failing test first: the façades rebuilt
and validated the whole origin policy on every request, which changed which failure wins for a configuration built
without `Auth.load` and cost work on requests refused at the Host check; the request-header type printed bearer
tokens and cookie values in its string form; and (advisory) Manure's key-file check on the normalised path and a
grant-liveness check without the user type were missing. The regression test for the first passes unchanged
against the code before the move.

**Verification.** `scripts/verify haystack` and `scripts/verify all` passed on the first round. Haystack JVM
suites: 40 suites, 758 cases before the review round; 41 suites, 764 cases after it (one new regression suite).
Shared JVM: 44 suites, 359 cases on the first round. Manure backend 303 cases, Manure native 411, Chronicle
backend 1464, all unchanged by the stage. The counts of the verification of the landed tree are in its landing
report. No existing test file of Haystack changed; Manure and Chronicle are untouched.

## What stage 2 did

**Moved** from `haystack/server/src/main/scala/haystack/auth/AccountService.scala` (172 lines before, 73 after) and
`haystack/server/src/main/scala/haystack/http/Http.scala` (469 lines before, 343 after) into `shared/service-auth`:

- `ImperativeRuntime` and the account service itself (`DeclarativeAccountService`, package `ponygirls.auth`):
  credential resolution with configured tokens first, liveness, password login, the imperative and indexing
  dispatch, logout, the account read, token issue and revoke. It reads the service's configuration exactly where
  Haystack read it, so the number of reads per route (pinned by `HttpAuthenticationCountTest`) is unchanged.
- The storage it needs as a port, `AccountStore` / `AccountStorage`, with `SharedAccountStorage` making exactly the
  calls on the shared tables that Haystack made.
- The account routes (`AccountPlane`, package `ponygirls.auth.http4s`): the five endpoints, the imperative and
  indexing pipelines, the account boundary and body envelope, the reply writer, `Retry-After` on a 503 outside the
  dispatcher, and the telemetry labels.

**Shared interface, in brief.** `DeclarativeAccountService[S <: AccountSnapshot[S]](storage, current, runtime,
indexingService, indexingPolicy, scopes)` with `install`, `reloaded`, `suspended`, `resolve(select: S => Presented)`,
`live`, `login`, `imperativeLogin`, `imperativeRequest`, `indexingRequest`, `logout`, `account`, `issue`, `revoke`.
Refusals are `AccountRefused(AccountRefusal)`. `AccountPlane[S](service, AccountPlaneSettings[S])` with `routes`, plus
`AccountPlane.label` and `AccountPlane.headers`. The settings carry the service's transport supplier and origin
policy, cookie names and attribute order, JSON responses, failure codes and statuses, the audit sink, what ends with a
session, the client address, admission and labelling of authenticated requests, the body timeout, the `Retry-After`
choice and the offered scopes.

**Stayed in Haystack**: `AccountService` with its constructor and methods as a façade that maps the shared refusals
to its `Fault`s; `HaystackIdentityHistory`; `Http` with its constructor, the domain routes, the access log, the
per-principal rate limiter, the live sockets and the legacy `/api/v1/login` and `/api/v1/logout`. Haystack passes
`SecureAttribute.Last`, its `json` response, its failure-code mapping, its status map, one JSON log line per security
event, `LiveHub.endSession`, a loopback-trusting client address, its rate limiter, the access-log attribute, a 30 s
body timeout, `Retry-After` on 503, and the scope `api`.

**Tests.** New shared suites state the service's and the plane's rules over the shared types and run on a hand-written
in-memory store and on the shared PostgreSQL tables (dual tests); the value Manure will use for `Retry-After` was tested
first. No existing test file changed. Inner loop: Haystack JVM 41 suites, 764 cases; `serviceAuth` 21 suites, 193 cases,
PostgreSQL cases executed.

**What stages 3 to 5 still need** (not provided yet): for Blabber, a cookie-only credential kind, an actor helper for
domain routes, refusing a token secret as a password, an install hook for retained declared ids, its indexing service
key, and a shared version of Haystack's domain-route credential pipeline if Blabber wants it; for Manure, an owner-key
mapping in the shared store, a store over its own transactions and memory dummy, a hook for grant revocation inside the
transaction, the "configured and issued at once is ambiguous" precedence, a boundary parameter in place of the fixed
origin-policy boundary (its Host and TLS context, three cookie names), its body handling of indexing requests, its
login throttle, and statuses that depend on the route; for Chronicle, the reply writer and pipeline as separately
usable functions.

## Recorded, not fixed

Each item was noticed and deliberately left. "Read" means read from the code; "reproduced" means a test or run
showed it.

- Manure answers some account 503s without `Retry-After` (those raised outside the shared dispatcher); Haystack and
  Chronicle add it. Read.
- Manure answers `GET /api/account/v1/policy` with imperative accounts off and no session with 401 instead of 404.
  Read.
- In Manure and Chronicle, an answer for a failure code outside the account set can carry a status that disagrees
  with the code in its body (the body code is sanitised to `unavailable`, the status is not). Read.
- Haystack's key-file store check is literal, Manure's is on the normalised path: a path that enters the store
  through `..` (for example `/etc/../nix/store/x`) passes Haystack's check; `/nix/store` itself passes it too.
  Reproduced in the shared suite (`KeyFilePolicy`).
- Haystack's id rule allows NUL in a declared administrator id; the shared imperative-account tables cannot store
  NUL in their provenance columns, which Manure's rule respects. Noticed, not reproduced.
- Haystack's `RequestHeaders` (its own type, kept as it was) prints Authorization and Cookie values in its
  generated string form; the shared `PresentedHeaders` now redacts them. Read.
- Configured versus issued tokens: Haystack takes the configured token first; Manure refuses a secret that matches
  both. Reachable only if an operator declares the digest of an issued secret. Read.
- Haystack accepts `Sec-Fetch-Site: same-origin` without `Origin` as the same-origin proof of a cookie write;
  Manure and Chronicle demand `Origin`. Pinned by tests in both directions. Read.
- The same refusal answers with different statuses across the services (see above). Pinned. Read.
- Cookie values: Haystack trims them, Manure deliberately does not. Read.
- Declared-user rules differ beyond the documented id rule: Haystack refuses logins with surrounding spaces and
  token ids with whitespace or `:`, Manure accepts both; no reason found. Read.
- Haystack applies its per-principal rate limit to account routes, Manure a per-user mutation throttle, Chronicle
  none. Read.
- Manure's bounded digest reader accepts a relative path (it resolves it against the working directory first). Read.
- For stage 4: the shared declared-user loader checks users one at a time, Manure validates all users before reading
  any file; Manure raises `bad-envelope` for an empty hash-file path where the shared loader reports an unreadable
  file; Manure reads password hashes again in every account transaction while the shared loader keeps a snapshot.
  Each needs a decision or a parameter in stage 4. Read.
- The plan's statement that the imperative-settings requirements of Haystack and Manure are the same is wrong on
  the key-file check (above). Read.
- Haystack decides transport (Host, Origin, cookie selection) with the configuration its HTTP layer reads and account
  questions with the configuration its account service reads; in production both read the same reference, so a reload
  between two reads of one request can split them. Stage 2 keeps both reads where they were. Read.
- The account plane's body timeout (30 s) and the probe for a body on an indexing GET are real-time limits; unchanged.
  Read.
- The shared test sources keep their in-memory account rows private to one file, so the new in-memory store has its
  own copy of those rows (test code only). Read.
