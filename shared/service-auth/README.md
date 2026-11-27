# Shared service accounts

`serviceAuth` owns password verification, opaque browser sessions, issued API
credentials, the separately versioned account JSON protocol, the mechanisms of the
request boundary (`ponygirls.auth.boundary`), the declared users' account service and
the http4s account plane (below). Each service owns its policy
values: allowed hosts and origins, cookie names, which rule variants it selects, and
the failure codes, messages and statuses of every refusal. It does not own service
permissions, database connections or transactions.
`AccountSql` receives the caller's existing `Connection`; initialize once at startup
and reconcile the complete loaded declarative directory on startup/configuration
replacement before accepting account operations. Reconciliation persists current
account fingerprints and disabled tombstones. Login checks that current state
under the same owner lock: an old request waiting behind removal, disable or a
password replacement cannot recreate revoked authority. Password hashes themselves
are not copied into the directory table. Never invoke a second database
transaction from inside an existing callback.

Use `AccountSql.loginReplacing` when password login replaces an existing cookie.
It acquires the target and prior owners in sorted order, matching reconciliation,
then creates the new session and revokes only the valid presented old session.
Wrong credentials leave the old session intact. Its returned prior credential
lets the service invalidate derived grants in the same transaction.

Haystack and Manure use the shared tables. Chronicle retains its scoped-token,
sharing and security-epoch tables and adapts them to the same account boundary.
Password hashes retain Chronicle's `pbkdf2-sha256$rounds$salt$hash` format.
References to password/hash files are runtime secrets, never Nix-store values.

## Session and token guarantees

- Browser sessions have independent random secrets and **no server-side expiry**.
  Logout deletes the current session; copied cookies then fail. Sessions survive
  service restart, but removal/disable/password replacement invalidates them.
- Browser-session secrets cannot be API bearer tokens and vice versa. Account
  management requires a current browser session, never an API bearer credential.
- Issued API secrets are random 256-bit values; only SHA-256 digests are stored.
  A secret is returned once, never included in token lists or receipts. In
  Haystack/Manure, removal or disable persistently revokes issued credentials;
  restart does not recreate them. Chronicle retains its existing disabled-owner
  bearer gate and explicit token-revocation lifecycle.
- Configuration-managed token metadata is visible, but only declarative changes
  may rotate/remove those credentials. Services enforce this, not just the UI.
- H/M issued tokens have the owner's existing API authority (`api`). Chronicle
  retains `Ingest`, `Read`, `Raw` and the `Raw`-requires-`Read` constraint.
- Haystack/Manure retain at most 100 active issued tokens and 100 recently revoked
  metadata records per owner. Chronicle retains its existing total active-token
  quota and bounded-list policy. Revoking an issued token rejects its secret.
- Persistent cookies use 400-day browser retention, refreshed on use. This is not
  a session timeout. Browsers may cap/evict cookies or users may clear them; the
  server cannot guarantee retention of client-side storage indefinitely.

## Request boundary (`ponygirls.auth.boundary`)

HTTP-neutral transport and configuration rules; nothing in the package imports an
HTTP library. Request-time rules throw `BoundaryRefused(Refusal)`; configuration
loaders return `Either[ConfigRefusal, A]`. An `OriginPolicy` from `deferred` checks a
configured origin only when a request check first needs it and then throws
`ConfigRefused`; one from `load` (or `checked`) has validated every origin. A service maps each refusal to its own
failure with an exhaustive match, so a refusal added here cannot fall through to a
generic 503. Refusals and failures never carry a presented secret.

| Mechanism | What the service passes |
|---|---|
| `CanonicalOrigin`, `RequestAuthority` | — (canonical `scheme://host[:port]` origins; the authority a `Host` names) |
| `OriginPolicy.load` or `deferred`, `secureCookie`, `validateTransport`, `csrf`, `accountTransport` | allowed host names, allowed origins, opted-in plain-HTTP origins, `cookieSecure` (build the policy once per configuration value) |
| `SessionCookie.serialize`, `select` | cookie name, `SecureAttribute` (`Last` or `BeforeMaxAge`), `CookieValue` (`Trimmed` or `Exact`) |
| `CredentialSelection.resolve` | `SessionCookies` (secure and plain names, value reading), `CredentialAccept` per route, `mutate` |
| `DeclaredUsers.load` | parsed users (`DeclaredUserConfig`), `DeclaredIdRules`, `DigestRead` (`Snapshot` or `PerCheck`), `DigestReader` (`Stream` or `Bounded`) |
| `ConfiguredTokens` | — (lookup by secret; liveness of a persisted grant by user id, token id and digest; listing with `source: "configured"` and scope `api`) |
| `ImperativeConfig.settings` | service name, parsed `accounts` settings, the declared directory, `KeyFilePolicy` (`LiteralStorePrefix` or `NormalizedPath`) |

`OriginPolicy` is the origin model of Haystack: host names admitted on any port,
an Origin of the request's own security class, a cookie write proven by an allowed
`Origin` or by `Sec-Fetch-Site: same-origin` without one, and the account plane on
the exact authority, where an opted-in plain-HTTP origin's GET may prove same origin
with `X-Account-Request: 1` instead. Services with another origin model keep it and
use the other mechanisms. Configuration parsing (key names, file layout) stays in the
service; the loaders take parsed values. Users today: Haystack.

## Account service and account plane

`DeclarativeAccountService[S]` (package `ponygirls.auth`, HTTP-neutral) serves the
declared users' accounts over an `AccountStorage`: credential resolution (configured
tokens first, then issued tokens; browser sessions), liveness, password login, the
operations of the five account endpoints, and the imperative and indexing dispatch.
`S` is the service's configuration snapshot (`AccountSnapshot`: declared users and
directory, imperative settings, configured tokens); every account decision reads it
once through the supplier the service passes, inside the transaction where the
decision has one, so a reload published meanwhile decides it. Refusals are
`AccountRefused(AccountRefusal)`; the service maps them. `SharedAccountStorage` is the
store over the shared tables in the service's `ConnectionTransactions`, with the
service's retained identities as `IdentityHistory`; owner keys are the user ids.

`AccountPlane[S]` (package `ponygirls.auth.http4s`) serves every request under
`/api/account/`: the five endpoints, the imperative paths (404 with the master switch
off) and the indexing paths, behind one boundary (exactly one `Host`, at most one
`Sec-Fetch-Site`, no query, `OriginPolicy.accountTransport`, bounded JSON bodies) and
with one reply writer (status, body, `Retry-After`, `Set-Cookie`, then the reply's
security events). `AccountPlaneSettings` carries the service's choices: its
transport configuration supplier and origin policy, cookie names and attribute order,
JSON responses, failure codes and statuses, the audit sink, what ends with a session,
the client address, its admission and labelling of authenticated requests, the body
timeout, `Retry-After` on a `503` outside the dispatcher, and the offered scopes.
Users today: Haystack.

## Account HTTP protocol v1

The account plane is an intentional addition to each service's domain API.
Prefix: `/api/account/v1`. Requests reject query parameters, duplicate JSON keys,
unknown fields, invalid UTF-8 and oversized/deep bodies. `AccountJson.parseUtf8`
provides the shared 16-KiB, depth-eight boundary. Use exact validated service Host
and Origin, cookie-only account authority, HttpOnly host-only SameSite=Strict
cookies (Secure for HTTPS), no-store responses and sanitized failure codes.
Revalidate authority after asynchronous input and before effects/delivery.

| Method/path | Input | Output |
|---|---|---|
| POST `/login` | `{login,password}` | `{user}` plus session cookie |
| POST `/logout` | `{}` | `{ok:true}` and cleared cookie |
| GET prefix | none | `{user,tokens,scopes}` |
| POST `/tokens` | `{name,scopes:[...]}` | `{token,secret}` once |
| POST `/tokens/{id}/revoke` | `{}` | `{ok:true}` |

User metadata: `{id,login,displayName,actor}`. `actor` is a public, opaque owner
binding, not a credential. Every account mutation except login must send exactly
one `X-Account-Actor` header from the preflight account response. Services compare
it to the current session owner inside the mutation transaction; a different
owner returns HTTP 409 without effects. This closes the cross-tab cookie-switch
race between preflight and POST. Token metadata:
`{id,name,source:"configured"|"issued",createdAt:string|null,revoked,scopes}`.
Failures: `{error:{code,message}}`; no submitted secrets or raw exceptions.
Clients may send `X-Account-Scopes: all` (the shared browser client always does):
a service with account scopes that its typed API does not carry names them in the
offered `scopes` and in token metadata only for such a request (Chronicle:
`OperateJobs`, see `chronicle/CONTRACT.md`); a service without them ignores the
header (Haystack and Manure keep offering `["api"]`).
Configured-token revocation returns forbidden; a different owner's token is not
found. Account login accepts login/password, not legacy bearer-token exchanges.

A failed/unknown mint acknowledgement is **not safe to retry automatically**:
reconcile the token list, revoke a newly created token whose secret was lost,
then explicitly issue a replacement. The common browser UI preserves this
uncertainty and never stores secrets in browser storage.

### Imperative accounts (additions to v1)

Accounts created at runtime (self-signup, admin enrollment) add the endpoints
below under the same prefix and rules; the five endpoints above keep their exact
shapes. `ImperativeAccountApi.handle` dispatches every new path and
`ImperativeAccountApi.login` decides `POST /login` while the master switch is
on; the service keeps its boundary, cookie serialization, logging and
transactions. Availability: **M** = `accounts.enable` (master switch), **S** = M
and `signup.enable`, **E** = M and `enrollment.enable`. With the master switch
off every new path answers `404 not-found` and `/login` is unchanged.

Unauthenticated (they ignore `X-Account-Actor`):

| Method/path | Exists | Input | Output | Failures |
|---|---|---|---|---|
| GET `/policy` | M | none | `{signup,approval,enrollment,reset,issuer,username:{pattern},password:{minLength,maxLength},totp:{algorithm,digits,period,secretBytes}}` | — |
| POST `/signup` | S | `{username,email,password,totpSecret,totpCode,requireTotp}` | approval: `202 {status:"pending"}`, cookie untouched; otherwise `{status:"active",user}` plus session cookie | 400 `invalid`/`weak-password`/`totp-mismatch`; 409 `username-unavailable`; 403 `forbidden` (user cap); 429; 503 |
| POST `/enrollments/inspect` | M | `{code}` | `{username,kind:"invite"\|"reset",expiresAt}` | 404 (unknown, expired, revoked, or an invitation while E is off); 429 |
| POST `/enrollments/redeem` | M | `{code,password,totpSecret,totpCode,requireTotp}`, plus `email` exactly for an invitation | `{user}` plus session cookie | 404; 400 as signup; 409 `username-unavailable`; 429; 503 |
| POST `/recover` | M | `{username,totp,password}` | `{user}` plus session cookie; other sessions deleted, tokens kept | 401 `unauthorized` (unknown, pending, disabled, declarative or wrong code); 400 `weak-password`; 429; 503 |
| POST `/login` | always | `{login,password}`; also `{login,password,totp}` when M | `{user}` plus session cookie | as before, plus 401 `totp-required`, 403 `pending-approval`, 429 |

Authenticated (browser session; every POST needs exactly one `X-Account-Actor`
naming the session owner: missing or malformed `400 invalid`, another owner
`409 conflict`):

| Method/path | Exists | Input | Output | Who |
|---|---|---|---|---|
| GET `/profile` | M | none | `{user,source,admin,email,totp:{required,state:"ok"\|"unavailable"\|"none"},manage:{email,password,totp,users,enrollment,reset}}` | any; declarative: `email:null`, `state:"none"`, `manage.email/password/totp:false` |
| POST `/profile/email` | M | `{email}` | `{ok:true}` | imperative self |
| POST `/profile/password` | M | `{currentPassword,newPassword}` | `{ok:true}` plus a replacement session cookie; other sessions deleted | imperative self |
| POST `/profile/totp` | M | `{currentPassword,totpSecret,totpCode}`, plus `currentTotp` exactly while TOTP is required | `{ok:true}` | imperative self |
| POST `/profile/totp-required` | M | `{required,totp}` | `{ok:true}`; enabling deletes the other sessions | imperative self |
| GET `/admin/users` | M | none | `{users:[{id,login,displayName,type,source,status,admin,email,createdAt,createdVia,createdBy,approvedBy,totpRequired,totpState,locked,pendingEnrollment}]}` | admin |
| POST `/admin/users/{id}/approve` | M | `{}` | `{ok:true}` | admin; pending target; 409 if the name is now claimed |
| POST `/admin/users/{id}/reject` | M | `{}` | `{ok:true}`; the application is deleted | admin; pending target |
| POST `/admin/users/{id}/enabled` | M | `{enabled}` | `{ok:true}` | admin; imperative target other than self |
| POST `/admin/users/{id}/admin` | M | `{admin,currentPassword}` | `{ok:true}` | admin; imperative target other than self; fresh proof |
| POST `/admin/users/{id}/reset` | M | `{currentPassword}` | `{enrollment,code}` | admin; active imperative target other than self; fresh proof |
| GET `/admin/enrollments` | M | none | `{enrollments:[{id,username,kind,createdBy,createdAt,expiresAt}]}` (invitations only while E) | admin |
| POST `/admin/enrollments` | E | `{username}` | `{enrollment,code}`; replaces a pending invitation for the name | admin |
| POST `/admin/enrollments/{id}/revoke` | M | `{}` | `{ok:true}` | admin |

Non-admins get `403 forbidden`, a declarative session on self-service `403
forbidden`, a wrong `currentPassword` or code on these endpoints `403
proof-rejected` (not 401: the session is alive). Path ids are imperative
usernames (`/admin/users/{username}/…`) or `enrollment-<lower-case uuid>`
(`/admin/enrollments/{enrollment}/revoke`); any other segment is `404` before
anything is read or logged. New error codes: `totp-required` (401),
`pending-approval` (403), `proof-rejected` (403), `weak-password` (400),
`totp-mismatch` (400), `username-unavailable` (409). Every 429 and 503 carries
`Retry-After` (seconds). Codes and secrets are returned once and never logged.

Enumeration posture: login answers an unknown, disabled or wrong-password
account with the same `401` after one password verification; a pending
applicant learns `pending-approval` only with the correct password. A locked
account, pending ones included, answers `429` until its lock lapses, whereas an
unknown name never does: a locked name exists. Recovery treats pending like
unknown.

Limits, all in memory and only while the master switch is on
(`AttemptLimiter`, `CredentialGate`): 10 requests per minute per client address
for each of login, signup, recovery, inspection and redemption; 5 successful
signups per address and day and 20 per hour in total; 5 failed admin proofs per
quarter hour for a declarative admin (imperative admins have a persistent
counter). Signups and declarative proofs take their slot when they start and
return it unless they succeed (signup) or fail (proof), also when the request is
cancelled, so concurrent attempts cannot overrun a window. PBKDF2 work of login,
signup, redemption and recovery runs through 2 slots with a queue of 16, beyond
which the answer is `503`; a waiting request leaves the queue when it is
cancelled (for example by the server's request timeout). Every map is
bounded; a new key that does not fit is refused. `ClientAddress.resolve` takes
the right-most `X-Forwarded-For` element only from a trusted peer, otherwise the
socket peer.

A reply with a failure status is a normal value: failure counters and consumed
TOTP steps are committed before it is sent. The adapter logs `AccountReply.events`
after commit with the field allowlist `event, actor, target, outcome,
clientAddress`; events never contain secrets, e-mail addresses, codes or bodies.

## Verification

```bash
nix develop .#backend --command bash shared/service-auth/scripts/test-postgres.sh
```

The same behavioral account contracts run against a handwritten memory repository
and real owned PostgreSQL; the script fails on any failure, error or skip and on
an empty run (`scripts/junit-gate.py`). Service-specific transport, scopes,
live-delivery and content-grant checks remain in their respective full suites.
