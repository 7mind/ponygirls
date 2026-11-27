# Account HTTP code: one shared implementation for Haystack, Manure and Chronicle

Status: stages 1 and 2 on `main`; stage 3 done, reviewed, two review rounds done; stages 4 and 5 and three fixes follow. This file records the work for a reader
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
session, the client address, admission and labelling of authenticated requests, the body timeout and the `Retry-After`
choice.

**Stayed in Haystack**: `AccountService` with its constructor and methods as a façade that maps the shared refusals
to its `Fault`s; `HaystackIdentityHistory`; `Http` with its constructor, the domain routes, the access log, the
per-principal rate limiter, the live sockets and the legacy `/api/v1/login` and `/api/v1/logout`. Haystack passes
`SecureAttribute.Last`, its `json` response, its failure-code mapping, its status map, one JSON log line per security
event, `LiveHub.endSession`, a loopback-trusting client address, its rate limiter, the access-log attribute, a 30 s
body timeout and `Retry-After` on 503.

**Tests.** New shared suites state the service's and the plane's rules over the shared types and run on a hand-written
in-memory store and on the shared PostgreSQL tables (dual tests); the value Manure will use for `Retry-After` was tested
first. No existing test file changed. Inner loop: Haystack JVM 41 suites, 764 cases; `serviceAuth` 21 suites, 193 cases,
PostgreSQL cases executed.

**Review round of stage 2.** Three changes to the shared interface, each tested first:

- *Login admission.* `AccountPlaneSettings.loginAdmission: LoginAdmission` is required, with no default: `Unguarded` or
  `Guarded(admit: Request => IO[Unit])`. A guard runs before a declared user's password is verified (imperative
  accounts off); an error it raises refuses the attempt with that error's failure. Haystack states `Unguarded`, which is
  what it did before; its imperative dispatcher, with its own limits, is unchanged. The owner's later fix (a per-client
  limit on password-login attempts in all three services) plugs in here.
- *One scope.* The scope parameters of the service and the plane are gone. `AccountScopes.Api` (`["api"]`) is the one
  scope the account read advertises, `POST /tokens` accepts, and issued and configured tokens carry: the shared tables and
  the services' authorisation represent nothing narrower. Haystack's answers are unchanged.
- *No-store.* Every final response of the account plane carries exactly one `Cache-Control: no-store`, whatever the
  service's responder writes; a responder that already writes exactly that keeps its headers as they are (Haystack).

Also in that round: a failure code the protocol does not know is normalised to `unavailable` once, before body and
status are derived; Haystack's translation of a shared refusal into its `Fault` keeps the cleanup failures (a failed
rollback or close) that the transaction engine attached; the new suites run on a fixed clock with timers that never
fire and a fresh credential runtime per case, and the new PostgreSQL suite fails with setup instructions where the
module's older suites skip. A browser session's id (`session-<uuid>`) is a row id, not a secret: Haystack logs it as
`tokenId`; the session's cookie secret and its stored digest are what the string forms never print.

**What stages 3 to 5 still need** (not provided yet): for Blabber, a cookie-only credential kind, an actor helper for
domain routes, refusing a token secret as a password, an install hook for retained declared ids, its indexing service
key, and a shared version of Haystack's domain-route credential pipeline if Blabber wants it; for Manure, an owner-key
mapping in the shared store, a store over its own transactions and memory dummy, a hook for grant revocation inside the
transaction, the "configured and issued at once is ambiguous" precedence, a boundary parameter in place of the fixed
origin-policy boundary (its Host and TLS context, three cookie names), its body handling of indexing requests, its
login throttle, and statuses that depend on the route; for Chronicle, the reply writer and pipeline as separately
usable functions. Narrower token scopes need a store and an authorisation model that represent them first.

## Stage 3: what Blabber's accounts unit needs

Written before stage 3's code. Sources, read on 2026-11-27: **R** = `blabber/README.md` of branch `product/blabber`
at `2c444ad4` (into which `product/blabber-u9` was merged meanwhile), section "For the accounts unit" (lines 363-400)
unless a line is given; **M** = `blabber/models/current.baboon` there (header comment, `Failure`, `Identity`); **D** =
`docs/drafts/20261127-1430-blabber-product-design.md` on `main`, read with the owner's later corrections (the shared
module; administrators are the accounts administrators, only on a browser session, Q209; the browser password is
separate from every bearer secret; a declared id stays bound to one principal). "After stage 2" is what the shared
module has at `58c40b55`.

| # | Need | Source | After stage 2 | Missing |
|---|---|---|---|---|
| 1 | A caller per request, before the body: account id, account type, credential kind (bearer or browser session), credential id | R 365-369; `Caller` (`blabber/.../domain/Model.scala:116`) | `CredentialSelection.resolve`, `DeclarativeAccountService.resolve` (`Captured`: user id, type, token id, cookie or not) | one call that also gives 2 and 3 |
| 2 | The account's display name | R 371 (`Caller.displayName` at each `join`) | read only inside the service | the directory entry's display name with the caller |
| 3 | The administrator flag, read per request, effective only on a browser session | R 369-370, R 142; M `Identity.admin`; D 4.8 (`ImperativeAccountSql.admin` requested) | computed privately inside `ImperativeAccounts` | a public read (service level and connection level) |
| 4 | A route served by one credential kind only; the other kind is `forbidden` for an authenticated caller, decided first | M header ("forbidden: a route used with the other kind of credential (the caller is authenticated)"); R 139-142; D 4.4 table | `CredentialAccept.BearerOnly` refuses a cookie *before* authentication (Haystack's `/mcp`, `unauthorized`); no browser-only kind | a post-authentication kind check. The earlier list's "cookie-only `CredentialAccept`" would refuse before authentication and contradict M |
| 5 | `X-Account-Actor` on browser-session requests of the service's own routes (not `whoami`, not the socket): missing or malformed `invalid`, another account's `conflict` with reason `actor-mismatch` | M header, M `Failure` reasons; R 396-398; D 4.5 | `AccountJson.requireActor` (untyped `AccountFailure` codes), applied by the account plane only | the check on domain routes, with typed refusals so that only the mismatch gets the reason |
| 6 | The same-origin proof for every cookie `POST` | D 4.5 | `CredentialSelection.resolve(mutate = true)` | — (already there) |
| 7 | The re-check of authority after the body and after a pull's waits, before delivery | R 368; D 4.7 | `live(captured)` (no transport re-check); Haystack's own `revalidate` in its `Http.scala` | a shared re-check for a service's routes |
| 8 | The session cookie renewed on use | D 4.4 | `SessionCookie.serialize`; Haystack renews in its own `delivered` | a shared renewal for a service's routes |
| 9 | The live socket's standing: does the browser session still authenticate, is the account an administrator now | R 381-384; `LiveSessions.standing` | `live(captured)` (a boolean) | a re-read giving both |
| 10 | Ending live connections after logout, a replacing login, any session revocation; `accountChanged` after role, enabled or display-name changes | R 385-389 | `AccountPlaneSettings.endSession` with the session *secret* (logout, replacing login); every dispatcher change reaches `audit` as an event with its target (`account.admin.granted`, `account.disabled`, `account.password.changed`, ...) | see "found, not built" below |
| 11 | No bearer secret (configured or live issued token) accepted as a password; same `401` as a wrong password | D 4.4, D 4.10 (acceptance); owner's correction | none: any password that verifies signs in | a service choice; Haystack keeps accepting (its stack derives the operator's password from a token file, D 4.10) |
| 12 | Attempt limits per client address on `POST /login` | D 4.6 table | `LoginAdmission` (required; `Unguarded` must be written out); `AttemptLimiter` | nothing to build in stage 3 (fix 1); the README states what Blabber passes |
| 13 | Declared ids `[a-z0-9][a-z0-9._-]{0,31}` | D 4.2 | `DeclaredIdRules` (a trait; Haystack's and Manure's values) | Blabber's value |
| 14 | A declared id bound to one principal: Blabber's own check of the declared ids (`declared_ids`, `reinstatedIds`) in the installing transaction, at start and every reload; refused installation writes nothing | D 4.3; R 399 | `install` = the shared collision check and reconciliation only | an installation hook in the same transaction |
| 15 | Its own indexing-preference key | D 8.2 | `IndexingService` with three keys | `IndexingService.Blabber` |
| 16 | `Identity.actor` from the shared rule | R 372-373 | `AccountJson.actor` | — (already there) |
| 17 | Retained names for imperative creation (chat columns) | D 4.7 end | `SharedAccountStorage(transactions, history)` | — (already there) |
| 18 | Host and Origin model, cookies `__Host-blabber` / `blabber-dev`; account plane with its one scope, `endSession`, a bearer on the plane `401` | D 4.4-4.6 | `OriginPolicy`, `SessionCookies`, `AccountPlane` | — (already there) |
| 19 | `LiveSessions.allowsOrigin`: the one `Origin` of an upgrade is the service's own | R 380 | Blabber's configured origins; `OriginPolicy.validateTransport` | — (already there; the count check is Blabber's) |

Choices the mechanisms leave to Blabber's unit, named so that it makes them: whether its own domain code keeps its kind
check once the shared one runs (4); which of its routes require the actor (5; the socket and `whoami` do not); whether
it reads the administrator flag in the account transaction at admission or again in its chat transaction (3); how its
live sockets keep the session secret that the standing re-read needs, since `LiveSessions.standing` receives a
`Caller` without it (9); its token-id and login rules (13: Haystack's, unless it states others); the content of its
installation check (14).

## What stage 3 did

**Added to the shared module** (each test first; signatures in brief):

- `DeclarativeAccountService` takes two more choices, without defaults: `BearerSecretPasswords` (`Accepted` |
  `Refused`) and `DeclaredInstallation[S]` (`Reconciled` | `Own(install: S => IO[Unit])`). With `Refused`, a password
  that is the secret of a configured token or of a live issued token is refused as a wrong password is: after the
  declared user's verification (the throw rolls the new session back) and inside the imperative core's verifications
  (a wrapped `PasswordHasher`, so failure counting is a wrong password's). `install` runs the chosen installation;
  `SharedAccountStorage.checked(check: (Connection, S) => Unit)` runs the service's rule under the directory lock, after
  the shared collision check and before the reconciliation, in one transaction.
- `identify(select: S => Presented): IO[Identified]` and `standing(captured): IO[Option[Identified]]`, with
  `Identified(captured, displayName, administrator)`; `administrator` is read in the same transaction for a browser
  session and is false for every bearer token. `ImperativeAccounts.administrator(userId)` (the rule of the
  authenticated operations, now one private function both use) and `ImperativeAccountSql.administrator(c, settings,
  declared, userId)`.
- `ServiceCallers[S](service, ServiceCallerSettings(origins, cookies, cookieOrder))` with `admit(r, route)`,
  `recheck(r, route, admitted: Captured)`, `renewed(response, current: Captured)`; `CallerRoute(accept:
  CredentialAccept, serves: RouteCredential, mutate, actor: ActorRule)`; refusals `CallerRefused(CallerRefusal)`
  (`CredentialKindNotServed`, `ActorRequired`, `ActorMismatch`). Admission order: transport and the one credential, its
  authority, the kind the route serves, the actor.
- `DeclaredIdRules.Blabber` (`[a-z0-9][a-z0-9._-]{0,31}`; token ids and logins as Haystack's) and
  `IndexingService.Blabber` (key `blabber`).

Corrections to the plan (7.6, 8): the bearer-secret rule is the service's choice, not an `AccountPlane.routes`
parameter, because the imperative core verifies passwords too; the per-route kind is checked after authentication
(Blabber's contract answers `forbidden` to an authenticated caller), not as a `CredentialAccept.CookieOnly`; the
design's `ImperativeAccountSql.admin` is `administrator`. The stage-2 constructor signature of
`DeclarativeAccountService` stays as a package-private secondary constructor with Haystack's choices, because the
stage-2 suites construct the service with it and their files may not change.

**Haystack** moved its own routes' `admitted`, `revalidate` and the cookie renewal of `delivered` onto
`ServiceCallers` (`RouteCredential.Either`, `ActorRule.NotRequired`; `/mcp` with `CredentialAccept.BearerOnly`);
`AccountService.caller` maps the shared refusals to the same `Fault`s. Its legacy logout, live upgrade and the access
log's own lookup keep `AccountService.resolve`. The stop rule did not trigger: no existing test file changed, and
`HttpAuthenticationCountTest`'s counts are as before. It passes `BearerSecretPasswords.Accepted` (its Home Manager
stack derives the operator's browser password from the operator's token when no hash is supplied,
`nix/hm/agentic-services-credentials.py`) and `DeclaredInstallation.Reconciled`. Manure and Chronicle untouched.

**Tests.** `ServiceCallersContract` runs a test-only consumer, wired as Blabber's unit will be (its own routes for
bearer only, browser session only, either, `whoami`, an administrator-only route and a waiting `pull`; the account
plane with `Refused` and a `Guarded` login admission; its own declared-id rule and indexing key), on the in-memory
store and on the shared PostgreSQL tables (`MemoryServiceCallersSuite`, `PostgresServiceCallersSuite`, 12 cases each);
`ServiceCallersTypesSuite` and `BlabberIdRulesSuite` beside them. Failing first: with each new rule disabled in one
run (no password rule, no kind or actor check, no administrator read, the own installation ignored, Haystack's id rule
for Blabber's), 8 of 12 cases failed on each backend and the id-rule case failed, each at the assertion of the
disabled rule; the four that passed exercise what was not disabled (the re-check, `Accepted`, the indexing key, the
login guard).

**Verification (inner loop only).** `nix develop .#backend --command bash shared/service-auth/scripts/test-postgres.sh`:
25 suites, 232 cases, PostgreSQL cases executed, no skip (before: 21 suites, 205 cases). `nix develop .#chronicle
--command bash haystack/scripts/test-postgres-scala.sh`: 42 suites, 765 cases (before: the same). `manureServer` and
`chronicleServer` `Test/compile` pass against the changed module. `scripts/verify`, the native, browser and VM checks
were not run (the owner runs them behind a load gate). The Haystack suites ran on the final tree; the first code commit
alone (Haystack's construction choices without the pipeline move) was compiled, not tested.

**Found, not built.** Blabber's live hub ends sockets by credential id (`LiveHub.endSession(credentialId)`), the
plane's `endSession` passes the session secret (logout, replacing login); the unit keeps the secret with its sockets
anyway (the standing re-read needs it, need 9). Session revocations inside the dispatcher (password change, TOTP
requirement, disable, reset) and role, enabled or display-name changes reach the service only as `audit` events with
their target, and declared changes through its own reload; a dedicated hook would need a new `AccountPlaneSettings`
field, which the stage-2 suite constructs. The per-client login limit is fix 1.

## Stage 3 review round

An advisory review (7 findings, 3 advisories) was accepted in full by the owner, with these rulings. **Stop rule:** it
protects Haystack's, Manure's and Chronicle's behaviour as their tests pinned it before this refactor; the suites the
refactor wrote (stages 1 to 3) may get a new argument at a construction site when a settings type gains a member, with
no assertion changed; the package-private five-argument constructor kept for the stage-2 suite is removed.

What changed, item by item (each test first; the failing run is below):

1. *haystack-extra-reads.* What a service learns of a caller beyond the credential is `ServiceCallerSettings.reads:
   CallerReads[C]`, no default: `CredentialOnly` (`Captured`, exactly the reads of `resolve`) or `WithAdministrator`
   (`Identified`). Haystack names `CredentialOnly`; `ServiceCallers` became `ServiceCallers[S, C]`. New Haystack test
   `HttpAccountReadsTest`: a JDBC driver registered ahead of PostgreSQL's records every statement; one `whoami` by an
   imperative user's browser session makes exactly two statements on the shared tables (the imperative accounts of the
   merged directory, the session by digest). It failed on `e79a5b54` (a third: the imperative row by id) and passed on
   `58c40b55`'s code and on the new code.
2. *ambiguous-domain-transport.* `ServiceCallerSettings.ambiguity: RequestAmbiguity`, no default:
   `FirstHostClassCookie` (Haystack's present rule; its `version` counts `Host` headers itself) or `OneHostAnyCookie`
   (exactly one `Host`, `AmbiguousHost`; a bearer beside a session cookie of either name, `AmbiguousCredentials`).
3. *stale-declared-admin.* `identify` and `standing` judge a credential looked up in a transaction against the
   configuration read inside the transaction's callback. Gated test: the demotion (and a re-promotion) is published by a
   probe that runs after the check started and before its transaction. Haystack's path (`resolve`) is unchanged; its
   count test is unchanged.
4. *missing-live-hooks.* `DeclarativeAccountService` takes `lifecycle: AccountLifecycle`, no default: `Unobserved`
   (Haystack: its plane's `endSession` by secret keeps its behaviour) or `Observed(credentialEnded, accountChanged)`,
   told after the commit, never after a rollback: a session's id at sign-out and when a sign-in replaced it (declared,
   imperative, sign-up, redemption, recovery, password change), an issued token's id at revocation; an account's id
   when the dispatcher committed a disable or enable, a role change, a password change or recovery, a reset redemption
   or a TOTP-requirement change, when a reload changed or removed its declared entry or administrator flag (compared with
   the configuration installed before), and for every active imperative account when a reload turned the master switch
   off. Sessions revoked in bulk are told through their account. Tests from real operations through the consumer
   (declared and imperative sign-ins, a password change, promotion, disable, reloads; sign-up, redemption and recovery
   with a replaced cookie take the same reply path, not tested),
   including a rolled-back sign-out and revocation (nothing told, credentials still valid) and a refused reload.
5. *disabled-configured-secret.* `ConfiguredTokens.configures(secret)`: membership over every declared user's digests,
   enabled or not, shared or not (per check: the files as they are now). `Refused` uses it. Cases: a disabled owner's
   retained digest (snapshot and per check), a digest two tokens share after the load (per check), and a person whose
   password is a disabled owner's token through the consumer.
6. *distinguishable-declared-refusal.* With `Refused`, every canonical candidate password is looked up (configured,
   then live issued), whatever the outcome; a refused one is replaced by a fresh 256-bit random secret before
   `loginReplacing`, so it fails inside the verification, on the wrong password's path and with its failure, before any
   lock or session write. The imperative core's verification does the same. `PostgresDeclaredRefusalSuite` counts
   session-table writes with a trigger into a sequence (a rollback does not undo it) while another connection holds the
   owner's lock: both a refused and a wrong password answer `unauthorized` with no write and no lock attempt; a control
   sign-in counts its two writes. The consumer case compares the two answers byte for byte.
7. *unusable-new-password.* With `Refused`, a new password that is a bearer secret (sign-up, redemption, recovery,
   password change) is `weak-password` (`400`, the plane's existing failure for an unacceptable password) before it is
   hashed; the operation's transaction rolls back. Cases: a refused sign-up creates no account; a refused change keeps
   the old password and both sessions and tells nothing. Redemption and recovery hash on the same path; not tested.
   `Accepted` (Haystack) unchanged.
8. *test-secret-diagnostics.* The stage-3 suites compare cookies with a fixed message and report the redaction test's
   failing type and field only.
9. *consumer-reload-example.* The test consumer publishes a reload's result, a failure included (Haystack's pattern);
   one case shows every request refused (`503`) while the failure is published, another the return to a valid
   configuration and that the refused installation wrote nothing.
10. *retry-after-doc.* The README states that Blabber's contract requires `Retry-After` on every `429` and that a
    guard's `429` lacks it until fix 1.

**Edits to suites of stages 1 to 3.** `AccountPlaneContract.scala` (stage 2): the service construction gets
`BearerSecretPasswords.Accepted, DeclaredInstallation.Reconciled, AccountLifecycle.Unobserved`; nothing else.
`ServiceCallersContract.scala` (stage 3): construction of the service and the callers (new settings members), the probe
storage and the published configuration; assertions changed only where items 7 to 9 require: the cookie comparisons and
the redaction clue (same conditions, sanitised messages), the password test's imperative case (a token secret can no
longer be set as a password under `Refused`: the configuration now declares a token with the password's digest
afterwards), and the installation test (split in two: refusals while the failure is published; the return to a valid
configuration). No test that existed before the refactor changed.

**Failing first.** With each new rule disabled in one run (no strict ambiguity, the selected configuration in the
callback, nothing told, membership as authentication, the stage-3 declared path, new passwords unchecked), 6 consumer
cases failed on each backend, `PostgresDeclaredRefusalSuite` failed with PostgreSQL's lock timeout, and the three
`ConfiguredSecretsSuite` cases failed; the strict-ambiguity case failed in a run of its own (the first mutation did not
disable it). Each at the assertion of its rule.

**Verification (inner loop).** Shared: 27 suites, 258 cases, PostgreSQL cases executed, no skip. Haystack JVM: 43
suites, 766 cases (the new `HttpAccountReadsTest`; the 765 before unchanged). `manureServer` and `chronicleServer`
`Test/compile` pass. Not run: `scripts/verify`, native, browser, VM.

## Stage 3, last review round

A focused review of the first round found twelve points; the owner accepted them as a closed list with item 13 (my own
open points) and a relaxed stop rule (Haystack's, Manure's and Chronicle's behaviour and their tests from before the
refactor do not change; the refactor's own suites may change where an item requires it).

1. *F1.* `identify` and `standing` take the whole decision under one configuration: a configured token is decided
   under the current one without waiting; otherwise, inside the lookup's transaction callback, the configuration is
   read again and the transport rule, the credential selection, the configured-token precedence and the lookup all
   use it. Haystack's `resolve` path is unchanged (its reads test passes unchanged).
2. *F2.* Notifications are delivered by `committed`: observed, the transaction and the delivery run in one
   uncancelable region, and a failure the storage reports as after the commit (`AccountStorage.afterCommit`,
   `ConnectionTransactions.afterCommit`; `ConnectionTransactions.jdbc(database)` recognises `JdbcDatabase`'s
   `database-close-failed`) is raised after delivering. Each callback is isolated: a failure is reported to
   `AccountLifecycle.Observed.log` as one line with the kind and the id (the failure's class, never its message) and
   changes neither the result nor later notifications. No queue. The README says callbacks must be quick and must not
   block.
3. *F3.* `reloaded(next, publish)`: installs, publishes through `publish`, then tells; a failing notification is
   logged and the reload stays successful. Unobserved (Haystack) it is `next.flatTap(install).attempt.flatTap(publish)`,
   with Haystack's façade passing a `publish` that does nothing and publishing itself afterwards, as before.
4. *F4.* `ConfiguredTokens.sameFor(other, owner)` (ids and digests; per check, ids and digest files): a reload that
   removes or rotates an owner's configured token tells `accountChanged` for the owner.
5. *F5.* What is told as ended is carried out of the committing operation: `loginReplacing`'s replaced credential
   (declared sign-in), `SharedAccountSessions.establishing` through `RecordingSessions` (imperative sign-up,
   redemption, recovery; the in-memory store records the same), the deleted session of the separate replacement
   transaction after a `Refused` imperative sign-in (item 6), the session a sign-out deleted, the token a revocation
   revoked. The reply-and-lookup inference is gone; account changes are recorded in the transaction by the sessions
   port (`revokeSessions`, `revokeTokens`, `activated`, `updated`, and the new hook `adminChanged`, which does nothing
   by default so that Manure's and Chronicle's implementations are unchanged).
6. *F6.* With `Refused`, `imperativeLogin` dispatches the sign-in without the presented cookie (no read or lock of the
   earlier session's owner for a wrong or refused password); once a sign-in succeeded, the earlier session, if still
   live, is deleted in its own transaction and told. `Accepted` (Haystack) is unchanged. The declared path already
   verified before any session work.
7. *F7 (no change).* With `Refused`, every canonical candidate password is looked up among all configured digests
   (the same constant-time comparison over every digest, hit or miss) and among issued tokens (one read by digest). A
   string that is a bearer secret can therefore cost more work than one that is not; that difference can tell an
   attacker only whether the string is a bearer secret, which presenting the same string as `Authorization: Bearer`
   answers directly. The remaining difference, named: on a hit of a live issued token of a declared owner,
   `Accounts.bearer` reads the owner's fingerprint row once more; on a miss it does not.
8. *F8.* A bearer secret offered as a new password no longer fails in the hasher: the hasher marks it, the operation
   runs its password-independent checks, and only an operation that completed is turned into `weak-password` and
   rolled back. A taken or reserved name stays `username-unavailable`, a malformed one `invalid`, disabled sign-up
   `not-found`.
9. *F9.* Approval (and every activation: sign-up, redemption) tells `accountChanged`; a reload that turns the master
   switch on tells every active imperative account it restores.
10. *F10.* `OneHostAnyCookie` checks the presence of either cookie name (`SessionCookie.present`) before any value is
    read: a bearer beside duplicate cookies of one name is `AmbiguousCredentials`; `FirstHostClassCookie` still answers
    `DuplicateSessionCookie`. Typed refusals asserted.
11. *F11.* Assertions of the stage 1 to 3 suites that could print a secret, a cookie value or a value derived from one
    now compare with `assert(a == b, fixed message)` or report booleans: `SessionCookieSuite`,
    `CredentialSelectionSuite`, `DeclaredUsersSuite`, `OriginPolicySuite` (stage 1), `AccountPlaneContract` (stage 2),
    `ServiceCallersContract` (stage 3). Conditions unchanged.
12. *F12.* The sign-up test signs up the same name with an allowed password after the refusal.
13. Tests for the lifecycle at sign-up, redemption and recovery (each tells the session it replaced and the account),
    and for `weak-password` at redemption (the code is not consumed: it redeems afterwards) and at recovery (the
    password is unchanged).

**Edits to suites of stages 1 to 3.** Construction and plumbing: `MemoryAccountStorage` (records into the lifecycle
record, `afterCommit`), `AccountPlaneContract` and `AccountPlaneSuites` (new members passed through), the stage-3
suites (the probe, the published configuration, the consumer's policy in `ChatSnapshot`). Assertions: item 11's
messages (conditions unchanged); in `ServiceCallersContract` the expectations items 5, 9 and 12 change (a sign-up now
tells its activation, a password change tells its account rather than an inferred session, the refused sign-up is
followed by a sign-up of the same name), and effects run off the test's thread no longer assert (a gate's reload
fails its effect instead): an `assert` evaluating a blocking condition held the suite's monitor while a gate's
assertion on another thread waited for it (observed as a deadlock in a thread dump).

**Failing first.** One run with each rule of this round reverted to the present head's behaviour (the early selection
and precedence kept, delivery after the transaction and unisolated, told before published, tokens not compared,
reply-inferred replacement with the cookie passed to the sign-in, the hasher throwing, activation and restoration not
told, duplicate cookies selected): 11 consumer cases failed on the in-memory store, 12 on PostgreSQL (the
sign-up/redemption/recovery case also there: the reverted activation lives in the shared tables' recorder), and the
imperative case of `PostgresDeclaredRefusalSuite` failed with PostgreSQL's lock timeout; each at the assertion of its
rule.

**Verification (inner loop).** Shared: 27 suites, 285 cases, PostgreSQL cases executed, no skip. Haystack JVM: 43
suites, 766 cases. `manureServer` and `chronicleServer` `Test/compile`. Not run: `scripts/verify`, native, browser, VM.

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
- The module's older PostgreSQL suites skip their cases when the owned database is not configured and
  `ACCOUNT_REQUIRE_POSTGRES` is unset; both runners set it, so no case is skipped there. The suites added in stage 2 fail
  instead. Read.
- The shared type `AccountCredential` is a plain case class whose generated `toString` prints the stored digest of its
  session or token secret. It exists on `main` in that form and is not known to be logged anywhere. Read from the code,
  not reproduced.
- A `429` that a `LoginAdmission.Guarded` guard raises carries no `Retry-After` (the plane's login path is not a
  dispatched route); Blabber's contract requires it on every `429`. For fix 1. Read.
- `ServiceCallers` repeats the actor pattern of `AccountJson.requireActor` (with typed refusals instead of its
  `AccountFailure` codes); the service's `authenticate` and `identified` repeat the configured, issued and browser
  branching, kept apart so that the account plane's resolution does exactly what it did. Read.
- `PostgresServiceCallersSuite` creates the test table `consumer_declared_ids` in the owned database and empties it; it
  does not drop it. Read.
- A refused bearer-secret password is verified as a fresh random secret: it would verify against a stored hash with
  probability 2^-256. The wrong-password path still rolls back its read-only transaction, as before; no written work is
  rolled back on either path. Read.
- Sessions revoked in bulk are told by account, not by id. Read.
- `HttpAccountReadsTest` re-registers PostgreSQL's JDBC driver behind its recorder in the JVM-wide `DriverManager` for
  the test; Haystack's suites run in sbt's JVM, one at a time. `PostgresDeclaredRefusalSuite` waits for PostgreSQL's
  200 ms `lock_timeout` only when the owner's lock is attempted, which the code under test must not do. Read.
- With `Observed`, a mutation and its delivery are one uncancelable region, including the wait for a connection: a
  cancelled request still waits for its connection and completes its mutation. Unobserved (Haystack) is unchanged.
  Read.
- With `Refused`, replacing the earlier session after a sign-in is a second transaction: a request cancelled between
  them keeps the earlier session (its browser never received the new cookie either). Read.
- With `Refused`, a sign-up refused for a bearer-secret password keeps its per-address successful-sign-up slot: the
  dispatcher keeps the slot inside the transaction that is then rolled back. Read.
- `ConnectionTransactions.jdbc` names `JdbcTransactionEngine`'s failure code `database-close-failed` as a literal of its
  own. `ConfiguredTokens.sameFor` compares a per-check owner by token ids and digest files, not file contents. A failure
  to read the imperative accounts a master-switch change affects is logged, and those accounts are not told. Read.
- The `assert(a == b, message)` form of item 11 no longer prints a diff for any mismatch, secret or not. Read.
