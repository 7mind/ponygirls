# Browser accounts and API credentials

This is the normative Manure browser-account protocol, independently versioned
from `manure.api` 1.0.0. It supersedes historical token-login, stateless dashboard
cookies and 24-hour dashboard session descriptions. It does not change artifact
visibility, ownership, content-grant expiry, password unlock, or machine API wire
formats. No deployment or credential migration is authorized by this document.

## Configuration and persistence

Each configured user retains its exact `id`, `type`, `displayName` and configured
`tokens: [{id,hashFile}]`. `enabled` defaults to true when absent. Human users may
add the paired optional fields `login` and `passwordHashFile`; agents cannot.
Logins are unique, nonempty, at most 128 characters and contain no control
characters. `tokens` may be empty or absent for a password-only human. Token-only
humans and agents continue to authenticate using their existing bearer tokens.
All users must have at least one configured token or the paired human password
credentials. Unknown user fields, duplicate identities/logins/token IDs within
an owner, and unpaired password fields are invalid configuration.

`passwordHashFile` references a bounded UTF-8 secret file, optionally ending in
one LF, containing `pbkdf2-sha256$600000$<base64-salt>$<base64-derived-key>` as
implemented by `ponygirls.auth.Password` (higher supported iteration counts are
accepted). It is not a token SHA-256 file. Plaintext passwords, API tokens and
browser secrets must not appear in configuration, logs or Nix store paths.
`check-config` checks the typed shape without opening referenced secret files;
service acquisition validates them. Missing/malformed password files fail closed
as unavailable rather than being reported as invalid credentials.

Browser sessions and issued API tokens use the common account tables and its
schema-version/state fencing in the application's existing PostgreSQL database.
The root lease, existing JDBC admission and caller-owned transactions remain the
owners of all account effects; authentication does not allocate another pool or
open nested transactions. Manure maps only internal account-store owner keys to
bounded namespaced digests: public user IDs, configured token IDs, audit
attribution and grant credential references remain byte-exact, including existing
wide/NUL-containing user IDs. Duplicate mapped keys fail closed.

Each successful password login generates a fresh independent server session.
Sessions have no server idle or absolute deadline and survive process restart.
Removal/disable/password-hash replacement invalidates browser sessions durably.
Removal/disable also revokes issued API tokens; re-enabling the user must not
resurrect those credentials. Password replacement alone does not revoke API
tokens. Current declarative eligibility governs every authorization check.

A browser session never authenticates as a bearer token. Neither configured nor
issued API tokens authenticate as browser cookies. API tokens retain full
existing Manure management authority (`["api"]`); no new role/scoped authority is
introduced. Configured token metadata is displayed but immutable through HTTP.
Issued tokens belong to their issuing human and can be revoked only by that
owner's current browser session. There may be at most 100 active issued tokens
per owner; retained revoked metadata is bounded by the common account policy.

## HTTP boundary

Only the validated management/API context exposes `/api/account/v1`. These routes
never dispatch through artifact content hosts or `/view/<id>/` mounts. Every
account route rejects query strings, duplicate JSON keys/credentials/headers,
invalid UTF-8 and ambiguous bearer-plus-cookie credentials. JSON bodies are
limited to 16 KiB (or the smaller configured request limit), depth 8, and strict
endpoint fields. Mutations/login require exact matched API Origin; GET accepts
an absent Origin but rejects a mismatched one. Host, port, trusted-proxy and TLS
checks remain mandatory. No CORS access is enabled.

All responses carry `Cache-Control: no-store`. Errors have
`{"error":{"code":"...","message":"..."}}`, never a Baboon envelope or
submitted/provider/SQL details. Invalid input is 400, unauthenticated 401,
forbidden 403, unknown token 404, stale settings actor 409, oversized body 413,
rate-limited 429, and unavailable server/configuration state 503.

| Method and path | Body | Success |
|---|---|---|
| POST `/api/account/v1/login` | `{login,password}` | `{user}` and session cookie |
| GET `/api/account/v1` | none | `{user,tokens,scopes:["api"]}` |
| POST `/api/account/v1/tokens` | `{name,scopes:["api"]}` | `{token,secret}` |
| POST `/api/account/v1/tokens/{id}/revoke` | `{}` | `{ok:true}` |
| POST `/api/account/v1/logout` | `{}` | `{ok:true}` and cleared session cookie |

`user` is `{id,login,displayName,actor}`. `actor` is a public opaque owner binding,
not a credential. A settings client sends exactly one `X-Account-Actor` header
from the displayed user on issue/revoke/account-logout. The server compares it
with the current session owner **inside the mutation's transaction**; a missing,
duplicate or mismatched binding fails without mutation. This prevents a stale
settings tab from issuing/revoking another account's tokens after another tab
changes the browser cookie. Missing/duplicate/malformed actors are invalid (400);
a well-formed different owner binding is conflict (409). Login does not require
an actor header.

Listed `token` metadata is
`{id,name,source:"configured"|"issued",createdAt:string|null,revoked,scopes:["api"]}`.
Configured tokens have null creation times and their configured ID as name.
Settings never return stored secrets/hashes. Only the issue response returns its
new `secret`, once; clients must not retain it in web storage. Revoke rejects
configured tokens as forbidden and another owner's/unknown issued token as
not-found. Invalid scopes cannot escalate authority.

Settings and mutations require a browser session, not any bearer token. Login
rejects Authorization and duplicate cookie credentials. A single old browser
cookie does not authenticate login or prevent password reauthentication. Only
after successful password verification is an identifiable prior session ended,
together with its content grants; failed login leaves a valid prior session
untouched. Public dashboard shell/assets remain accessible with a stale single
cookie so the user can sign in again; duplicate credentials, Host and TLS
restrictions remain enforced.

Session cookies are host-only, HttpOnly, SameSite=Strict, Path=/, Secure on TLS.
Names remain `__Host-manure`, `manure-http` for explicit HTTP opt-in, and
`manure-dev` for loopback development. Max-Age is 400 days and is refreshed on
authenticated use; browser eviction/retention caps are not server expiry.
Logout deletes the durable session and credential-bound one-time/content grants,
then clears the cookie; replay fails, but configured/issued bearer tokens are
not revoked. Other independent browser sessions remain valid.

Generated `Command.Login(token)` and the legacy `/api/current/login` form reject
without installing cookies. Existing generated/domain form logout routes still
invalidate a real browser session and its grants. Their existing Origin guards
remain, and they do not require the new account actor header. Bearer-domain
logout preserves bearer credentials while revoking their existing bound grants.

## Content authorization

Only actual browser sessions enable path-mode document-navigation exchange for
an internal artifact grant. Raw content routes and content commands cannot use
management cookies; subdomain content never receives host-only dashboard cookies.
Content grants keep their existing finite expiry and artifact/password/credential
bindings. Redemption, metadata delivery and each content open revalidate the
current session/runtime/configured token using the **same caller transaction**
as artifact authorization. Logout or token revocation atomically removes the
bound grants; deleting/rotating a configured token file still fails live checks.

Dashboard assets `/account.js` and `/account.css` are allowlisted only as trusted
dashboard assets; no general filesystem/static-path access is added. The shared
framework-independent account UI uses this protocol and does not store secrets
in localStorage/sessionStorage.
