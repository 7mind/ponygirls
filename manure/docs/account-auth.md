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

## Imperative accounts (self-signup and admin enrollment)

Accounts created at runtime ("imperative" accounts) are off by default. With the
`accounts` block absent, or present with `"enabled": false`, no new endpoint is
reachable, `/login` is handled exactly as above, and the only difference from a
deployment without this feature is three empty tables (`ponygirls_imperative_*`),
created at startup and by `migrate`. The protocol of the added endpoints is the
shared one in `shared/service-auth/README.md` ("Imperative accounts"); Manure adds
no endpoint or shape of its own.

Configuration (top-level keys snake_case, per-user keys camelCase, closed key
sets at every level; an unknown key is a configuration fault):

```json
"users": [{"id": "operator", "type": "human", "login": "operator", "passwordHashFile": "...", "admin": true}],
"accounts": {"enabled": true, "key_file": "/run/credentials/manure.service/accounts-key",
             "signup": {"enabled": true, "require_approval": true, "max_users": 100},
             "enrollment": {"enabled": false, "ttl_s": 86400},
             "issuer": "Manure (artifacts.example.net)", "reserved_usernames": []}
```

- `accounts.enabled` is required whenever `accounts` is present and is the master
  switch. It is never derived from `signup.enabled` or `enrollment.enabled`;
  either of those set while the master is off is a configuration fault.
- With the master on: `key_file` is required, absolute and outside `/nix/store`;
  at least one enabled declarative user has `admin: true`. `signup`,
  `enrollment` and their members default to off, `require_approval` true,
  `max_users` 100 (1–1000), `ttl_s` 86400 (300–604800); `issuer` defaults to
  `Manure (<api_origin host>)` and must be 1–64 characters without `:` or
  control characters; `reserved_usernames` must satisfy the username policy.
- `admin: true` requires a human user with `login`/`passwordHashFile` whose id
  contains no NUL character (admin ids are recorded as approver/issuer in text
  columns). `admin` defaults to false. Imperative account administration
  remains unavailable with the master off, even for a declarative admin.
- `check-config` stays parse-only and does not open `key_file`. Service
  acquisition (`serve`, `migrate`) reads it as the base64url encoding of 32 bytes;
  an unreadable or malformed key fails startup with code `config`.

Switch semantics. `signup.enabled` governs self-registration, `enrollment.enabled`
invitations. Credential resets, recovery, profile and user management exist
whenever the master is on (turning both creation flags off leaves existing
accounts, sessions and tokens working). **Turning the master off suspends every
imperative account without revoking anything:** their names are unknown to
`/login`, their browser sessions and issued API tokens are refused but kept, and
they work again when the master returns. To destroy credentials, an admin disables
the accounts first. Rolling back to a binary without this feature is different: its
reconciliation deletes imperative sessions and irreversibly revokes their tokens.

Identity and directory. An imperative user id is its lower-case username
(`^[a-z][a-z0-9_-]{2,31}$`), also its login. Every authentication (bearer,
browser, liveness and content-grant checks) uses the merged directory: the
configured users, reconciled as before (a lock-free read when unchanged), plus
the active imperative users (one further read of the imperative table, no lock).
Imperative accounts are never reconciled; their sessions and tokens use the same
digest-mapped owner keys as configured users. A name can never be registered
when it is declared (id or login, ASCII case-insensitively), reserved, an existing
imperative account, or a retained identity: any user id that ever had a
reconciled account row (including removed users) or that is the
`created_by_user` of an artifact. An active or disabled imperative account whose
id equals a declared id or login fails startup with `config`, with the master on
or off; choose another declarative id or login. Imperative users get the rights
of a regular human user: they read internal artifacts, upload, and can delete any
artifact.

Login and limits. A declared login takes the existing path. Any other login is
decided by the imperative core (optional TOTP step `401 totp-required`, `403
pending-approval` for a correct password of an unapproved applicant, persistent
per-account failure counters that are committed before the rejection is
answered). `/login` keeps `login_rate_per_min_per_ip` (socket peer) and, while
the master is on, additionally passes the shared per-address window and the
PBKDF2 gate; the other unauthenticated endpoints use only the shared limits. The
client address is the socket peer, or the right-most `X-Forwarded-For` element
when the peer is in `trusted_proxies`. The added endpoints accept only the
browser session cookie (an `Authorization` header is `400 invalid`), exist only
in the management context and never on content hosts or `/view/<id>/` mounts.

Security events are written to standard output after commit, one line each:
`MANURE_ACCOUNT_EVENT {"event":...,"actor":...,"target":...,"outcome":...,"clientAddress":...}`
with exactly these optional fields; never a secret, e-mail address, code or
request body. `clientAddress` is personal data in logs.

Operations. Back up the key file separately from the database. Database dumps
contain password hashes, e-mail addresses (also of pending applicants) and the
encrypted TOTP secrets; a dump together with the key file allows recovering every
imperative account. Losing the key makes TOTP `unavailable` for existing accounts
(recovery and mandatory-TOTP login stop working) until an admin issues a reset;
password login without mandatory TOTP keeps working. Key rotation is not provided.

**Self-signup and path-mode hosting.** In `path` content mode artifacts are served from the dashboard origin. Script in an uploaded artifact runs with the viewer's browser session and can call the account API as that viewer. For an administrator this includes approving or rejecting applicants, issuing invitations, enabling or disabling users and reading the user list; it does not include changing an admin flag or issuing a credential reset, which require the administrator's current password, nor changing the viewer's own password or TOTP secret. Enabling self-signup in path mode is permitted. Approving an applicant then means trusting every artifact that user uploads. Keep `signup.requireApproval` enabled, approve only trusted people, and prefer `subdomain` content mode whenever uploaders are not fully trusted.

Per-account [indexing preferences](../../docs/indexing-preferences.md) share that
path-mode boundary. An artifact script can change the viewer’s own indexing
choice when policy allows it, and can read indexing settings of other accounts
if the viewer is an administrator. Forcing or clearing an administrator override
additionally requires the acting administrator’s current password.

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
