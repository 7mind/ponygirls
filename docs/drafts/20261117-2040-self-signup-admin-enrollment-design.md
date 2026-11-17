# Self-signup and admin enrollment for Chronicle, Haystack and Manure — design

Status: **design only**. Nothing in this document is implemented. Base commit `f153d1ae`.

Evidence markers used throughout:

- **[O]** observed in this checkout (file:line given);
- **[I]** inferred from observed facts or general knowledge, not verified here;
- **[P]** proposed by this design.

"Declarative user" = account defined in service configuration (Nix → JSON).
"Imperative user" = account created at runtime (self-signup or admin enrollment) and stored in the service database.

---

## 1 Summary of decisions

| # | Decision | Rejected alternative (why) |
|---|---|---|
| D1 | One shared implementation in `shared/service-auth` ("imperative accounts"), identical additive tables in each service database, a thin adapter per service. All new operations are **additions to the existing account HTTP plane `/api/account/v1`**; no Baboon model changes in any service; the five existing account endpoints keep byte-identical request/response shapes. | New Baboon operations / Chronicle WS commands (three model bumps, codec regeneration, CLI/collector exposure; the account plane was deliberately made independent of Baboon — §2.1). Adding fields to existing responses (breaks deployed CLIs that validate exact key sets — §2.7). |
| D2 | Imperative user **id = immutable username = login**, policy `^[a-z][a-z0-9_-]{2,31}$`. Accounts are never deleted, only disabled; a username is never reused. | Generated opaque id + separate login (unreadable attribution in Haystack `modifiedBy`, Chronicle invitations target user ids). Hard delete (identity reuse would hand the old owner's data and group memberships to a new person). |
| D3 | Namespace: an imperative username may not equal (ASCII case-insensitively) any declarative id or login, nor a reserved name. If configuration later declares a colliding id/login, directory loading **fails closed** (configuration fault at startup / reload). | Shadowing or silent takeover by the declarative account (issued API tokens of the imperative user would silently start authenticating as the declarative identity). |
| D4 | Effective admin = declarative `admin` flag OR imperative `admin` column. Declarative accounts are immutable through the API in both directions (no imperative promotion of a declarative non-admin). An admin can neither demote nor disable itself; with that rule the API can never empty the admin set, so no last-admin counter is needed. | Imperative overlay rows for declarative users (second source of truth for config-owned accounts; survives config removal). |
| D5 | TOTP per RFC 6238: HMAC-SHA1, 6 digits, 30 s step, 160-bit secret, acceptance window {T−1, T, T+1}, each time step usable once (monotonic `last_step`). | SHA-256/8 digits (authenticator-app interoperability is unreliable **[I]**). Drift tracking / resynchronisation (speculative). |
| D6 | The TOTP secret is **generated in the browser** (WebCrypto) and submitted together with a current code; the server verifies proof of possession inside the creating transaction. No pending rows, no setup endpoint, nothing persisted before success. | Server-generated secret in a sealed stateless blob (one more unauthenticated endpoint; only prevents a user from weakening their own secret — same trust model as the user-chosen password). Short-lived pending row (unauthenticated database writes, cleanup). |
| D7 | TOTP secrets are **encrypted at rest** with AES-256-GCM under a per-service key file (`accounts.keyFile`), following the `rites` `Vault` precedent. The key file is required exactly when a feature is enabled. | Plaintext column: a database or backup reader could reset the password of every imperative account through recovery. Today no database content grants impersonation (only SHA-256 digests of 256-bit secrets and PBKDF2 hashes), so plaintext would be a regression. |
| D8 | Throttling: persistent **per-account** lockout with exponential backoff (password: from the 10th consecutive failure, 1 min doubling to 15 min; TOTP: from the 5th consecutive failure, 15 min doubling to 24 h), in-memory **per-client-address** fixed windows, and a global concurrency gate around PBKDF2 work on unauthenticated endpoints. | Proxy-only `limit_req` (absent when `proxy.enable = false`; cannot implement account lockout). |
| D9 | Signup is one POST and one transaction; success establishes a browser session. | E-mail confirmation (excluded by the owner). Half-created accounts. |
| D10 | Enrollment code: 256-bit random, only its SHA-256 digest stored, default TTL 24 h, single use, create-or-replace per username (safe to retry), delivered as a URL **fragment**. The same mechanism (kind `reset`) replaces the credentials of an existing imperative user. | Code in query string or path (reaches proxy/server logs). Separate reset mechanism. |
| D11 | Login gains an optional `totp` member; two-step login is **stateless** (`401 totp-required`, the client resubmits login + password + code). Declarative logins take the unchanged code path. | Half-authenticated server-side login state. |
| D12 | Recovery = username + current TOTP code + new password; success revokes that account's browser sessions, keeps issued API tokens, and establishes a new session. | — (confirmed requirement C3). |
| D13 | Configuration: `accounts.{keyFile, signup.enable, enrollment.enable, …}` and `users.<id>.admin`; both features off by default; Nix omits the new JSON keys when off so generated configuration is byte-identical to today's. | Always-emitted keys (Manure rejects unknown keys → new config would break an old binary). |
| D14 | With both features off, no new endpoint is reachable (`404 not-found` as today) and imperative rows are inert (not part of the directory). | Keeping imperative accounts alive with features off (recovery endpoints would stay reachable while "off"). |
| D15 | Schema: additive tables created by a shared idempotent initializer with its **own** schema-version table. The existing `ponygirls_account_schema` version is not bumped, so older binaries keep starting after a rollback. | Bumping `ponygirls_account_schema` to 3 (older binaries reject unknown versions and would refuse to start — `AccountSql.scala:16`). Per-service numbered SQL migrations (three copies; Chronicle's native-image resource list must be edited per file). |
| D16 | E-mail exists only on imperative users: stored, editable, unverified, not unique, never used for login or recovery. | Unique e-mail (creates an enumeration oracle and e-mail squatting without verification). |
| D17 | Audit = structured security events through each service's existing logger plus provenance columns (`created_via`, `created_by`, timestamps). | Audit table + browsing endpoint (no requirement; adds UI). |
| D18 | Web: a new DOM-free module `shared/account-web/account-client.js` (API calls, state machines, base32, secret generation, `otpauth` URI, QR matrix) plus views in `account.js`/`account.css` that belong to the UX workstream. QR is rendered client-side into DOM nodes; no external service, no `data:` URL, no inline style. | Server-side QR image (image dependency in three native images; secret in one more response). |
| D19 | Prerequisite correction: make `Accounts.reconcile` change-driven. Manure currently reconciles the whole directory (one advisory lock and one upsert per user, full session/token scans) on **every** authentication. | Leaving it (cost and lock contention grow linearly with imperative users). |
| D20 | Tests: pure unit tests for TOTP/vault/policy, **one** contract suite run against an in-memory dummy and PostgreSQL, 3–4 adapter tests per service, Node tests for the DOM-free client, ≤ 4 controlled-route browser flows, one real-backend browser smoke in one service. | Per-service copies of the behaviour matrix, VM tests, a browser matrix per service. |

---

## 2 Current state (observed)

### 2.1 What is shared today

| Topic | Observation |
|---|---|
| Module scope | `serviceAuth` "owns password verification, opaque browser sessions, issued API credentials, and the separately versioned account JSON protocol. It does not own service permissions, origins, HTTP admission, database connections or transactions." **[O]** `shared/service-auth/README.md:3-5` |
| Password hashing | `ponygirls.auth.Password`: PBKDF2-HMAC-SHA256, 600 000–2 000 000 iterations, 16-byte salt, 32-byte key, text form `pbkdf2-sha256$ROUNDS$SALT$KEY`; constant-time compare; `readHash` for hash files. **[O]** `shared/service-auth/src/main/scala/ponygirls/auth/Account.scala:51-92` |
| Directory model | Every `Accounts` operation receives the **complete directory** `users: Vector[AccountUser]` built by the service from configuration; `AccountUser(id, userType, displayName, login, passwordHash, enabled)`. **[O]** `Account.scala:13-16`, `Accounts.scala:32-43` |
| Persistence | Three tables created by `AccountSql.initialize`: `ponygirls_account_users` (id, fingerprint, enabled — *not* the password hash), `ponygirls_account_sessions`, `ponygirls_account_tokens`, plus `ponygirls_account_schema(version)`, currently 2; any other stored version is rejected with `config`. **[O]** `AccountSql.scala:11-29` |
| Sessions | Random 256-bit secret, SHA-256 digest stored, no server-side expiry; a session is live only while its owner is enabled, the stored fingerprint equals the directory entry, and the session's `password_identity` equals the digest of the current password hash. **[O]** `Accounts.scala:45-50`, `README.md:28-30` |
| Reconciliation | `reconcile` locks every known owner, tombstones users missing from the directory, upserts every fingerprint, deletes dead sessions, revokes issued tokens of ineligible owners. **[O]** `Accounts.scala:65-74` |
| Login | Exact match on `login`; exactly one PBKDF2 verification, against a dummy hash when the login is unknown. **[O]** `Accounts.scala:75-91`, `Account.scala:91` |
| Repository seam | `private[auth] trait AccountRepository` with `PostgresAccounts` and a handwritten in-memory implementation in tests; `AccountContract` is run by `MemoryAccountSuite` and `PostgresAccountSuite`. **[O]** `Accounts.scala:11-27`, `AccountSql.scala:44-63`, `src/test/.../AccountContract.scala:6,179-213`, `PostgresAccountSuite.scala` |
| Account HTTP v1 | `/api/account/v1`: `POST /login`, `POST /logout`, `GET` root, `POST /tokens`, `POST /tokens/{id}/revoke`; strict JSON (16 KiB, depth 8, exact fields), cookie-only authority, exact Host/Origin, `X-Account-Actor` owner binding on mutations, error body `{error:{code,message}}` with a fixed code set. Explicitly "not a Baboon domain version". **[O]** `README.md:49-76`, `AccountJson.scala:7,15-19,27-29,38-40`; `haystack/docs/auth.md:112`; `chronicle/CONTRACT.md:14-24`; `manure/docs/account-auth.md:3-7` |
| Web UI | `shared/account-web/account.js` (301 lines, dependency-free) binds `form[data-account-login]` and `[data-account-settings]`, renders the token settings `<dialog>`; `account.css`; a Chromium suite on controlled routes (22 cases according to `docs/drafts/20261115-0225-accounts-validation.md`; not re-run here). **[O]** `account.js:2-3,259-300`, `shared/account-web/README.md`, `tests/browser.mjs` |
| Secret-at-rest precedent | `rites` (out of scope) has `masterKeyFile` → `Vault`: AES-256-GCM, 12-byte nonce, AAD binding, `keyId` = first 16 hex of SHA-256(key), base64url 32-byte key file. **[O]** `rites/server/src/main/scala/rites/Core.scala:74-107`, `rites/.../Config.scala:59,71` |
| Native crypto | Native images for the services are built with `--enable-all-security-services`. **[O]** `nix/pkg/services/native.nix:44`, `chronicle/server/src/main/resources/META-INF/native-image/chronicle/native-image.properties:1`. HmacSHA1 and AES/GCM availability in the Haystack/Manure native binaries is **[I]** (not executed here). |

### 2.2 What is duplicated per service today

- Account route wiring, three idioms: **[O]** `haystack/server/src/main/scala/haystack/http/Http.scala:127-153`, `manure/backend/src/main/scala/manure/Http.scala:169-215`, `chronicle/server/src/main/scala/chronicle/Http.scala:61-98`.
- Host/Origin/CSRF boundary, three implementations: **[O]** `haystack/.../auth/Auth.scala:164-181`, `manure/.../Http.scala:51-78,169-174`, `chronicle/.../Http.scala:38-50`.
- User-configuration validation, four places: **[O]** `Accounts.scala:32-43`, `haystack/.../Auth.scala:61-107`, `manure/.../Auth.scala:42-52`, `nix/lib/service-account-options.nix:26-51` (+ `chronicle/.../Core.scala:51`).
- Rate limiting, three unrelated mechanisms (§2.6).
- Manure carries a second handwritten dummy that re-implements the shared semantics (`MemoryAuthTxn`) besides the shared test dummy. **[O]** `manure/backend/src/test/scala/manure/MemoryAccounts.scala:11-73`
- Chronicle does not use `Accounts`/`AccountSql` at all; it keeps `ch_users`, `ch_sessions`, `ch_tokens` and its own login/session code, sharing only `Password`, `AccountJson` and the cookie constant. **[O]** `chronicle/server/src/main/scala/chronicle/Auth.scala:10-106`, `shared/service-auth/README.md:21-23`

### 2.3 Haystack

| Topic | Observation |
|---|---|
| Config | JSON `auth.users[] = {id, type, displayName, tokens[{id,hashFile}], login?, passwordHashFile?, enabled?}`; unknown keys are not rejected (keys are read individually). **[O]** `haystack/server/src/main/scala/haystack/Config.scala:31-39` |
| Validation | At least one user; unique ids/logins; login ≤ 128, no control characters, no surrounding whitespace; ids: no whitespace or `:`; a user needs a token or a password pair. **[O]** `haystack/.../auth/Auth.scala:61-107` |
| Hot reload | The configuration file and hash files are re-read and the directory reconciled every `authReloadMs` (1000 ms in both Nix modules); a failed reload fails closed for all requests. **[O]** `haystack/.../Main.scala:42-53`, `nix/nixos/haystack.nix:50` |
| Adapter | `AccountService` passes `auth.users` to `AccountSql` inside the caller's transaction. **[O]** `haystack/.../auth/AccountService.scala:14-80` |
| Authorization | "Type is attribution, never item authorization: every authenticated user reads/writes every item." **[O]** `haystack/docs/auth.md:9-10` |
| Legacy login | Baboon `/api/v1/login` remains registered and always rejects. **[O]** `haystack/.../http/Http.scala:154-159` |
| Baboon | Single model `haystack.api` 1.0.0, one lock entry. **[O]** `haystack/models/current.baboon:1-2`, `haystack/models/lock.json` |
| Web | React/Vite; `Login.tsx` renders `form[data-account-login]`; hash routing (`#/browse`, `#/item/…`). **[O]** `haystack/web/src/Login.tsx:9`, `haystack/web/src/App.tsx:13-20,110` |
| CLI | `haystack/cli` logs in through `/api/account/v1/login` and validates account responses against closed shapes (unknown keys rejected). **[O]** `haystack/cli/src/account.ts:19-27`, `haystack/cli/src/protocol.ts:21-23,57` |

### 2.4 Manure

| Topic | Observation |
|---|---|
| Config | Top-level and per-user keys are **closed sets**; an unknown key is a configuration fault. Users: `{id,type,tokens,displayName,enabled,login,passwordHashFile}`. **[O]** `manure/backend/src/main/scala/manure/Config.scala:98-108` |
| Directory | Static after start; hash files are re-read per use; `Auth.current(tx)` builds the directory **and calls `reconcile` on every bearer/browser/liveness check**. **[O]** `manure/.../Auth.scala:79-103` |
| Owner keys | Public user ids are arbitrary byte-exact UTF-8; the shared tables are keyed by `sha256("manure-account-owner-v1\0" + id)`. **[O]** `manure/.../Auth.scala:121-131` |
| Seam | `trait AuthTxn` (PostgreSQL + in-memory dummy) inside the root-protected metadata transaction. **[O]** `manure/.../Auth.scala:109-144`, `manure/.../Metadata.scala:17,150` |
| Authorization | Any authenticated user may read "internal" artifacts and **delete any artifact**; ownership is checked only for in-progress uploads. **[O]** `manure/.../Artifacts.scala:59-63,71-75,118-122`, `manure/README.md:25-28` |
| Hosting modes | `content_mode` `path` serves uploaded content on the dashboard/API origin ("Trusted content only"); the combined Home Manager module hardcodes `path`. **[O]** `manure/.../Http.scala:513`, `nix/hm/agentic-services-server.nix:103-104` |
| Dashboard CSP | `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; …` — no inline styles, no `data:` images. **[O]** `manure/.../Http.scala:363` |
| Static assets | Explicit allowlists (two sets) for dashboard files, including `account.js`/`account.css`. **[O]** `manure/.../Http.scala:299-301,350` |
| Web | Vanilla JS dashboard; `index.html` holds the login form and settings trigger; `account.js`/`account.css` are symlinks into `shared/account-web`. **[O]** `manure/web/dashboard/index.html:9-10,32,53` |
| Clients | The Python client/CLI/MCP use bearer tokens only (no account-plane calls). **[O]** no match for `login`/`account` in `manure/manure/client.py`, `cli.py` |

### 2.5 Chronicle

| Topic | Observation |
|---|---|
| Config | `users[] = {id, login, passwordHashFile, enabled}` (all human, no display name); tokens are a separate `staticTokens` list; circe product decoders ignore unknown keys. **[O]** `chronicle/server/src/main/scala/chronicle/Core.scala:32,45-69,73,122-143` |
| Store | `ch_users(id PK, login UNIQUE, enabled, credential)`; eleven foreign keys reference `ch_users(id)` (eight in `001.sql`, one each in three later migrations). **[O]** `chronicle/migrations/001.sql:2-11`, `004_collector_progress.sql:2`, `007_owner_profiles.sql:12`, `012_reindex_cohorts.sql:2` |
| Startup sync | `UPDATE ch_users SET enabled=false`, upsert each configured user, delete sessions whose owner's credential changed or who is disabled, seed `ch_owner_targets`. No reload; restart applies configuration. **[O]** `chronicle/.../Database.scala:18-45` |
| Login | Own implementation against `ch_users`; sessions in `ch_sessions`; the legacy Baboon route `POST /api/login` still creates sessions. **[O]** `chronicle/.../Auth.scala:10-24`, `chronicle/.../Http.scala:100-104` |
| Authorization | Per-owner archives; groups grant direct read access; invitations target existing **user ids**; scoped tokens `Ingest/Read/Raw`. **[O]** `chronicle/.../Auth.scala:163-189`, `chronicle/README.md:162` |
| Baboon | Single model `chronicle.api` 1.9.0; `UserInfo{id,login,scopes}`; "No … old-version API dispatch". **[O]** `chronicle/models/chronicle.baboon:1-2,32`, `chronicle/models/lock.json`, `chronicle/README.md:174` |
| Migrations | Numbered SQL files listed in code **and** in the native-image resource list. **[O]** `chronicle/.../Database.scala:21`, `native-image.properties:1` |
| Web | React/Vite; login form and settings trigger in `App.tsx`; token settings entry in `Access.tsx`. **[O]** `chronicle/web/src/App.tsx:31,71`, `chronicle/web/src/Access.tsx:17` |
| CLI | `chronicle/cli` uses the account plane and validates **exact key lists** (`actor,displayName,id,login`; `scopes,tokens,user`). **[O]** `chronicle/cli/src/account.ts:7,30,39` |

### 2.6 Rate limiting, client address, proxies

| Service | Observation |
|---|---|
| Haystack | `RateLimiter` is keyed by authenticated principal only; the login route has **no** limiter. **[O]** `haystack/.../http/Http.scala:59,113,127-137,352-361`. The NixOS proxy has no `limit_req`. **[O]** `nix/nixos/haystack.nix:59-73,296-320` |
| Manure | In-memory fixed 60 s window `Throttle`; `login:<peer>` with `login_rate_per_min_per_ip` (default 10); `peer` is the **socket** address, i.e. the reverse proxy ("XFF never used"). **[O]** `manure/.../Http.scala:15-25,44,180`, `nix/nixos/manure.nix:394` |
| Chronicle | A `Semaphore(2)` bounds concurrent logins; no rate limit in the application. **[O]** `chronicle/.../Main.scala:50`, `chronicle/.../Http.scala:60-69`. The Home Manager proxy applies `limit_req` only to the legacy path `= /api/login`; `/api/account/v1/login` is not covered. **[O]** `nix/hm/chronicle-server.nix:48-53,119` |
| Proxies | The Nix-managed proxies set `Host` and `X-Forwarded-Proto`; none sets `X-Forwarded-For` explicitly, and no service reads a forwarded client address. **[O]** `nix/hm/agentic-services-server.nix:195-199`, `nix/hm/chronicle-server.nix:17-25`, `nix/nixos/manure.nix:268-269`. NixOS Haystack uses `recommendedProxySettings = true` (`nix/nixos/haystack.nix:298`), which sets `X-Forwarded-For` **[I]**. |

### 2.7 Client strictness that constrains wire changes

- Chronicle CLI rejects any account `user` object whose key set is not exactly `actor,displayName,id,login`, any login response other than `{user}`, any settings response other than `{scopes,tokens,user}`. **[O]** `chronicle/cli/src/account.ts:7,30,39`
- Haystack CLI rejects unknown keys in every account response. **[O]** `haystack/cli/src/protocol.ts:21-23,57`
- The server rejects unknown members in the login body. **[O]** `AccountJson.scala:38-40`

Consequence **[I]**: existing responses cannot gain members without breaking deployed CLIs; new data needs new endpoints.

### 2.8 Nix surface

| Topic | Observation |
|---|---|
| Shared options | `browserOptions = {enabled, login, passwordHashFile}` and shared assertions. **[O]** `nix/lib/service-account-options.nix:9-51` |
| NixOS | `smind.services.{haystack,manure}.users.<id>` use the shared options; Chronicle has its own `users.<id> = {login,passwordHashFile,enabled}` and asserts at least one enabled user. **[O]** `nix/nixos/haystack.nix:115-134`, `nix/nixos/manure.nix:358-379`, `nix/nixos/chronicle.nix:67-76,138` |
| Home Manager | The combined module (Haystack + Manure) injects fixed ids `agent` and `operator`, reserves both names, derives the operator password hash from the operator token unless `operator.passwordHashFile` is set. **[O]** `nix/hm/agentic-services-server.nix:28-46`, `nix/hm/agentic-services-server-options.nix:47-72`, `nix/hm/agentic-services-server-assertions.nix:62`. Chronicle has a separate module with free-form `settings`. **[O]** `nix/hm/chronicle-server.nix:87,110-116` |
| Compatibility precedent | The HM module omits a default-valued key "for unchanged configs and older package compatibility". **[O]** `nix/hm/agentic-services-server.nix:108-110` |
| Config tests | `nix/tests/service-accounts.nix` is the evaluation contract for declarative accounts. **[O]** |

### 2.9 Existing admin/operator concepts

No administrator role exists in any of the three servers **[O]**: a case-insensitive search for `admin`/`administrator`/`isAdmin` over the production sources (`*/src/main`, the three web sources, `shared/account-web`, the three Baboon models, the service Nix modules) matches only two SQL comments about database fixtures (`manure/backend/src/main/resources/{manure-schema,001_metadata}.sql:5`); the remaining matches in the service directories are test variables naming database administrator connections. The `operator` account is an ordinary human account; the server attaches no authority to the id. Per-resource owner checks exist only in Chronicle (group owner, archive owner) and Manure (uploader of an in-progress upload).

### 2.10 Not determined

- Whether deployed instances are reachable from untrusted networks (deployment state was not inspected, by constraint).
- PBKDF2 wall-clock cost on the target hosts (not measured; order 10⁻¹ s **[I]**).
- Licence/pin of a vendorable QR encoder (not verified offline).
- `X-Forwarded-For` behaviour of `recommendedProxySettings` in the pinned nixpkgs (not read).

---

## 3 Requirements and assumptions

Requirements derived from the owner's text:

| # | Requirement |
|---|---|
| R1 | Self-signup, enabled by configuration; no confirmation e-mail. |
| R2 | One page: username, e-mail, password, TOTP setup. |
| R3 | TOTP is not required for login by default; it confirms identity during password recovery; a user may opt in to mandatory TOTP at login. |
| R4 | E-mail is editable; username is not. |
| R5 | Admins can enroll new users, enabled by configuration. |
| R6 | The admin flag can be set declaratively; an admin can set it on an imperative user; a declaratively set flag cannot be removed. |

Confirmed by the owner on 2026-11-17 20:47Z (decisions Q78–Q80, relayed by the orchestrator). These were working assumptions A1–A6 of the brief and are now requirements; the third column only records where each one lives in the design.

| # | Confirmed requirement | Where it lives |
|---|---|---|
| C1 (A1, Q78) | Accounts stay per service; one shared implementation, three independent signups. | Shared core + per-service tables; the user store is behind `ImperativeUserRepository` (§4.8). |
| C2 (A2, Q79) | Admin enrollment issues a one-time enrollment link/code; the invitee sets password and TOTP. The same mechanism is the admin reset for an imperative user who lost both factors; a declarative user who lost the password is repaired in configuration. | `Enrollment.kind = invite \| reset` (§4.4). |
| C3 (A3, Q80) | TOTP setup is mandatory at signup; TOTP at login only after opt-in; turning the opt-in off requires a TOTP code; recovery = username + TOTP + new password, revokes browser sessions, API tokens stay; per-account and per-address limits; single-use time steps. | §4.2, §4.5, policy constants of §4.7. |
| C4 (A4, Q80) | E-mail is a stored, editable, unverified contact attribute; username is the immutable login. | One column; no code path depends on it. |
| C5 (A5, Q80) | Declarative users keep config-owned credentials: no password change, recovery or TOTP management in the UI. | Every self-service operation begins with "target is imperative" (§4.5). §4.2.6 states what TOTP for declarative users would take. |
| C6 (A6, Q80) | Self-signed-up users get the rights of a regular non-admin human user of that service. | Imperative users enter the directory as `userType = "human"`. Per-service consequences: §8.3. |

Scope assumption from the brief, not separately confirmed: A7 — only Chronicle, Haystack and Manure (not `rites`, `ontology`).

Assumptions added by this design:

| # | Assumption | Reason |
|---|---|---|
| A8 | Usernames are public identifiers, not secrets. | Signup without e-mail is an inherent existence oracle; Haystack shows author ids and Chronicle invitations use ids already. |
| A9 | Account and user management stays browser-session-only (never bearer tokens). | Existing rule **[O]** `shared/service-auth/README.md:31-32`. |
| A10 | Imperative accounts are disabled, never deleted. | D2. |
| A11 | Server clocks are NTP-synchronised; client authenticators are within ±30 s. | TOTP window of ±1 step. |
| A12 | The reverse proxy in front of each service is trusted to supply the client address. | Per-address limits (§4.7). |

---

## 4 Design

### 4.1 Data model and coexistence with declarative users

#### 4.1.1 Tables (identical in the three service databases) **[P]**

```sql
CREATE TABLE ponygirls_imperative_schema(version integer PRIMARY KEY CHECK(version > 0));

CREATE TABLE ponygirls_imperative_users(
  id             text PRIMARY KEY CHECK(id ~ '^[a-z][a-z0-9_-]{2,31}$'),  -- immutable username = login = public user id
  email          text NOT NULL CHECK(length(email) BETWEEN 3 AND 254),
  password_hash  text NOT NULL,                       -- ponygirls.auth.Password format
  totp_key_id    text NOT NULL,                       -- vault key identifier (first 16 hex of SHA-256(key))
  totp_nonce     bytea NOT NULL,                      -- 12 bytes
  totp_secret    bytea NOT NULL,                      -- AES-256-GCM(20-byte secret) incl. 16-byte tag
  totp_last_step bigint NOT NULL,                     -- highest accepted RFC 6238 time step
  totp_required  boolean NOT NULL,
  admin          boolean NOT NULL,
  enabled        boolean NOT NULL,
  password_failures integer NOT NULL, password_locked_until timestamptz,
  totp_failures     integer NOT NULL, totp_locked_until     timestamptz,
  created_at     timestamptz NOT NULL,
  created_via    text NOT NULL CHECK(created_via IN ('signup','enrollment')),
  created_by     text,                                -- enrolling admin id; NULL for signup
  credentials_at timestamptz NOT NULL,                -- last password or TOTP replacement
  updated_at     timestamptz NOT NULL);

CREATE TABLE ponygirls_imperative_enrollments(
  id         text PRIMARY KEY,                        -- public handle 'enrollment-<uuid>'
  digest     text NOT NULL UNIQUE CHECK(digest ~ '^[0-9a-f]{64}$'),
  username   text NOT NULL UNIQUE,                    -- at most one pending enrollment per username
  kind       text NOT NULL CHECK(kind IN ('invite','reset')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL);
```

No row exists for a half-created account. Throttle state is four columns on the user row, so it exists only for real accounts and disappears with nothing to clean up.

#### 4.1.2 Identity

- `id` = username = login. Display name = username (no display-name editing was requested).
- `userType` is always `human`. Imperative users are appended to the declarative directory as ordinary `AccountUser` values, so sessions, issued tokens, the `X-Account-Actor` binding and every service-side authorization check work without modification.
- Policy constants (one object in the shared module): username `^[a-z][a-z0-9_-]{2,31}$`; reserved names `admin, administrator, root, operator, agent, system, support, security, service, anonymous, null, undefined, me, self` plus `accounts.reservedUsernames`; password 12–1024 UTF-16 units, not equal to the username or e-mail (case-insensitive), no composition rules; e-mail 3–254 characters, exactly one `@`, non-empty local part and domain, no whitespace or control characters, stored exactly as submitted.
- The policy satisfies every service's id rules: Haystack (no whitespace, no `:`, ≤ 128 — `haystack/.../Auth.scala:84`), Chronicle (non-empty text), Manure (arbitrary).

#### 4.1.3 Namespace rules

1. Signup / enrollment creation, inside the transaction, under a directory-wide advisory lock: reject (`409 username-unavailable`) when the folded username equals the ASCII-lowercased form of any **currently declared** id or login, a reserved name, an existing imperative id (enabled or disabled), or the username of a pending enrollment.
2. Directory merge (`declared ++ imperative`) on every load: if any imperative id equals, case-insensitively, a declared id or login, throw `AccountFailure("config")`. Effect per service, all existing fail-closed behaviour: Haystack — reload result becomes an error and every request is rejected as `unavailable` until configuration is corrected (`haystack/.../Main.scala:53`); Manure and Chronicle — startup fails.
3. Resolution available to the operator: choose another declarative id/login. Adoption of an imperative account by configuration is not provided (it would have to decide ownership of data, tokens and memberships; no requirement).
4. Login lookup: exact match on declarative logins first (unchanged semantics, `Accounts.scala:78`), then imperative lookup on the ASCII-lowercased input. Rule 2 guarantees the two never both match.

#### 4.1.4 Admin flag

- `effectiveAdmin(user) = declared.admins.contains(user.id) || imperativeRow.admin`. It is evaluated from the live directory inside each admin transaction; nothing is cached, so removing a declarative flag in configuration or revoking an imperative flag takes effect on the next request.
- Declarative `admin = true` requires `type = human` and a browser login (management is session-only, A9); enforced by Nix assertions and by server configuration validation.
- API rules: target must be imperative (`403 forbidden` otherwise, in both directions); actor ≠ target for `admin` and `enabled` changes. A declarative non-admin cannot be promoted imperatively (D4).
- Why no last-admin counter: every demotion/disable is executed by an admin acting on a *different* account, so the actor remains an admin afterwards. Configuration is the break-glass path (declare an admin).

#### 4.1.5 Disabling

Disabling an imperative user (admin action): login, recovery and all self-service operations are refused; the directory entry becomes `enabled = false`, which, through the existing mechanisms, ends browser sessions and, in Haystack/Manure, permanently revokes issued API tokens (`shared/service-auth/README.md:34-36`; "Re-enabling does not resurrect them" — `haystack/docs/auth.md:34-36`); Chronicle gates the owner's tokens while disabled and hides the owner's archive from group members (`chronicle/.../Database.scala:81`). Pending enrollments for the user are deleted. Data and the username are retained. Re-enabling restores login with the unchanged password and TOTP.

### 4.2 TOTP

#### 4.2.1 Parameters

RFC 6238 with HMAC-SHA1, 6 digits, X = 30 s, T0 = 0; secret = 20 random bytes; text form = RFC 4648 base32 without padding (32 characters). Provisioning URI:

```
otpauth://totp/{issuer}:{username}?secret={base32}&issuer={issuer}&algorithm=SHA1&digits=6&period=30
```

`issuer` comes from configuration (default: service name and public host, e.g. `Haystack (memory.example.net)`), so the three per-service entries are distinguishable in an authenticator (C1). Worst-case URI length ≈ 195 bytes (computed for a 32-character username and the example issuer) → QR version ≤ 10 at error-correction level M.

Reference vector for tests: secret `12345678901234567890`, time 59 → `287082`; time 1111111109 → `081804` (RFC 6238 Appendix B truncated to 6 digits; recomputed with a throwaway script, not committed).

#### 4.2.2 Secret generation and provisioning (D6)

The browser generates the 20 bytes with `crypto.getRandomValues`, renders the QR code and the base32 text (manual entry is always offered), and submits `totpSecret` (base32) with `totpCode`. The server requires a canonical 32-character base32 string decoding to exactly 20 bytes and a code that verifies for the current window. Rationale: the secret is shared between the user's authenticator and the server whichever side generates it; a client-chosen secret has the same trust model as the client-chosen password that travels in the same request.

QR rendering is client-side in the DOM-free client module (matrix) and the view (DOM `<svg>`/`<canvas>` nodes). Constraint from Manure's CSP **[O]** (`style-src 'self'`, no `img-src data:`): no inline `style`, no `data:` URL.

#### 4.2.3 Verification and replay protection

```
verify(secret, code, now, lastStep):
  T = floor(now / 30)
  for step in [T-1, T, T+1] with step > lastStep:
     if constantTimeEquals(hotp(secret, step), code): return Accepted(step)
  return Rejected
```

On `Accepted(step)` the row's `totp_last_step` is set to `step` in the same transaction, under the account's owner lock. A code is therefore usable once, and an older step can never be accepted after a newer one. At signup, `totp_last_step` is initialised to the step that proved possession. Clock skew: ±1 step (A11); no drift learning.

#### 4.2.4 Storage at rest (D7)

`TotpVault` (modelled on `rites` `Vault`): AES-256-GCM, fresh 12-byte nonce per encryption, AAD `ponygirls-totp-v1 \0 {service} \0 {userId}`, key = 32 bytes read from `accounts.keyFile` (base64url, via `BoundedSecretFile`), `keyId` stored per row.

Weighing: the key file adds one runtime secret per service and one failure mode (lost key). Against that, TOTP is the *sole* recovery factor, so a plaintext secret would turn any read of the database or of a `pg_dump` backup (the modules write daily dumps — `nix/nixos/haystack.nix:273-294`, `nix/hm/chronicle-server.nix:136-147`) into password reset for every imperative account, including imperative admins. Password hashes do not have that property.

Failure behaviour when a row cannot be decrypted (wrong/rotated/lost key): TOTP operations for that user return `503 unavailable` (never "valid", never "invalid code"); password login without mandatory TOTP keeps working; the admin user list reports `totpState = "unavailable"`; an admin `reset` enrollment re-keys the account. Startup logs the number of rows whose `totp_key_id` differs from the loaded key. Key rotation is not provided in this version; `totp_key_id` is recorded so a later multi-key reader does not need a schema change.

#### 4.2.5 Brute-force resistance

A guess succeeds with probability 3 × 10⁻⁶ (three accepted steps). Per-account TOTP lockout (§4.7): the first four consecutive failures cost nothing; from the fifth on, each failure locks TOTP verification for `min(24 h, 15 min × 2^(failures−5))`; only a successful TOTP verification or an admin reset clears the counter. A sustained attack on one account therefore gets 11 guesses in the first day, 40 in 30 days, 375 in a year: success probability 3.3 × 10⁻⁵, 1.2 × 10⁻⁴ and 1.1 × 10⁻³ respectively (computed, not measured). Each locked attempt is an audit event and the account shows `locked` in the admin list.

The attacker can keep recovery locked for a known username (denial of recovery, not of password login). Accepted; the remedy is an admin reset.

#### 4.2.6 TOTP for declarative users later (C5)

It would need: a table keyed by declarative id holding the encrypted secret, `last_step`, `required` and the TOTP throttle columns; an authenticated "set up TOTP" operation (the config-owned password as the proof); cleanup when the id leaves configuration. The login hook of §4.5.1 is already generic. Recovery would remain impossible because the password hash is config-owned. Estimated at one shared-core unit plus adapter wiring; not designed further.

### 4.3 Signup

Request (unauthenticated, `signup.enable` only):

```json
POST /api/account/v1/signup
{"username":"…","email":"…","password":"…","totpSecret":"<base32, 32 chars>","totpCode":"123456","requireTotp":false}
```

Processing order:

1. Service boundary: exact Host/Origin as for login, no bearer, strict JSON (existing per-service code).
2. Per-address admission and credential gate (§4.7) — outside any transaction.
3. Pure validation: username pattern, e-mail, password policy, secret shape, code shape. Failures: `400 invalid`, `400 weak-password`.
4. TOTP proof (`400 totp-mismatch` if the code does not verify for the submitted secret). Pure; no state.
5. `Password.hash` (PBKDF2) — before taking any lock.
6. One transaction: directory advisory lock → namespace rules §4.1.3 (`409 username-unavailable` for reserved, declared, taken or pending names) → `count(imperative users) < signup.maxUsers` (`403 forbidden` when full) → insert row (`created_via = 'signup'`, `totp_last_step` = proving step) → service `directoryChanged` hook (fingerprint / Chronicle projection) → establish browser session → commit.
7. Response `200 {"user":{id,login,displayName,actor}}` with the session cookie — the same shape as login.

Atomicity: either the row, the directory fingerprint and the session all commit or none does. A lost response is safe to diagnose: a retry answers `username-unavailable`, and the user logs in.

Abuse controls: per-address request limit, per-address and global creation limits, global PBKDF2 gate, `signup.maxUsers` (default 100) counting enabled **and** disabled rows, a hard ceiling of 1000 imperative users per service (also bounds the per-request directory cost — §4.8.5). No CAPTCHA (no external services).

Enumeration posture (A8): signup necessarily reveals whether a username is taken. Login and recovery answer wrong username, wrong password, wrong code, disabled account and (for recovery) declarative target with the same `401 unauthorized` after the same work in every case (login: one PBKDF2 verification, against a dummy hash when there is no account; recovery: one HMAC computation, against a dummy secret when there is no account); a *locked* account answers `429 rate-limited`, which reveals existence of that account after the attacker has spent the free attempts. Accepted under A8.

### 4.4 Enrollment

| Property | Design |
|---|---|
| Format | `code` = 32 random bytes, base64url without padding (43 characters, the existing `Secrets.generate` format — `Account.scala:36-49`). |
| Storage | `digest = SHA-256(code)` only. A fast hash is adequate for a uniformly random 256-bit value (same reasoning as API tokens — `haystack/docs/auth.md:23-25`). |
| Link | `{origin}/#account-enroll={code}`, composed by the admin view from `window.location.origin`. The fragment never reaches a server or proxy log. The shared client captures and removes it (`history.replaceState`) at module evaluation, before the host application's hash router runs. |
| Expiry | `enrollment.ttlSeconds`, default 86 400 (the precedent for Chronicle invitations is 24 h — `chronicle/.../Auth.scala:179`), allowed 300–604 800. Expired rows are deleted lazily by any enrollment operation. |
| Single use | The row is deleted in the transaction that creates or resets the account. |
| Create | Admin `POST /admin/enrollments {username}` (kind `invite`; the username must be free per §4.1.3) or `POST /admin/users/{id}/reset {}` (kind `reset`; target must be imperative). A new enrollment for a username **replaces** the pending one, so a lost response is handled by repeating the request; the previous code stops working. The response returns the code once. |
| Inspect | `POST /enrollments/inspect {code}` → `{username, kind, expiresAt}`; unknown, expired and revoked codes are all `404 not-found`. |
| Redeem | `POST /enrollments/redeem {code, email?, password, totpSecret, totpCode, requireTotp}`; `email` is required for `invite` and forbidden for `reset`. Same validation, proof and atomic transaction as signup, exempt from `signup.maxUsers` (but not from the hard ceiling). `created_via = 'enrollment'`, `created_by` = issuing admin. |
| Reset semantics | Existing credentials stay valid until redemption (an erroneous reset locks nobody out). Redemption replaces password hash and TOTP secret, clears both throttles, revokes all browser sessions, keeps issued API tokens, keeps e-mail and admin flag, and establishes a session. A suspected compromise is handled by *disabling*, not by reset. |
| Revoke / list | `POST /admin/enrollments/{id}/revoke`, `GET /admin/enrollments` (never returns codes or digests). Disabling a user deletes that user's pending enrollment. |

### 4.5 Login, recovery and self-service

All self-service operations apply to imperative users only (C5); for a declarative session they answer `403 forbidden`, and the profile response tells the view not to offer them.

#### 4.5.1 Login

`POST /login` accepts `{login,password}` (unchanged) or `{login,password,totp}`.

```
declared exact match          → existing loginReplacing path, unchanged (totp ignored)
else imperative row (folded)  → lock row
    disabled or missing       → one dummy PBKDF2, 401 unauthorized
    password locked           → 429 rate-limited (Retry-After)
    password wrong            → failures+1 (commit), 401 unauthorized
    password right, totp_required = false → reset password failures, establish session
    password right, totp_required = true      → reset password failures, then:
        totp absent           → 401 totp-required            (no TOTP counter change)
        totp locked           → 429 rate-limited
        totp wrong / replayed → totp failures+1 (commit), 401 unauthorized
        totp right            → last_step := step, reset TOTP failures, establish session
```

The two-step exchange is stateless: after `totp-required` the client resubmits all three values, and the password is verified again (two PBKDF2 computations for a mandatory-TOTP login). No half-authenticated state exists on the server.

Implementation constraint **[O]**: the shared transaction engine rolls back when the callback throws (`shared/service-runtime/src/main/scala/ponygirls/runtime/JdbcTransactionEngine.scala:35-46`). Rejections that must persist a failure counter are therefore **returned as values** from the transaction and converted to an error response after commit; they must not be thrown inside it.

Chronicle's legacy `POST /api/login` cannot carry a code: for an imperative user with `totp_required` it answers `unauthorized`; otherwise it goes through the same shared verification (throttle included). Haystack's and Manure's legacy logins already reject everything.

#### 4.5.2 Recovery

`POST /recover {username, totp, password}` (unauthenticated; available when either feature is enabled).

Pure password policy first (length; not equal to the submitted username) → `400 weak-password`, independent of whether the account exists. Then: row lock → enabled imperative user? → TOTP not locked → verify code (failure: counter + backoff, committed, `401 unauthorized`) → password ≠ stored e-mail (failure: `400 weak-password`, nothing consumed) → new hash, `totp_last_step := step`, clear both throttles, revoke all browser sessions, keep tokens → establish session → `200 {user}`.

The PBKDF2 of the new password is computed only after a valid code, so an attacker without the code cannot spend server CPU through this endpoint beyond one HMAC.

#### 4.5.3 Self-service operations (session + `X-Account-Actor`)

| Operation | Fresh proof required | Effect |
|---|---|---|
| Change e-mail | none (the e-mail has no security function) | update column |
| Change password | current password | new hash; all *other* sessions revoked; the current one is replaced by a fresh session cookie |
| Replace TOTP secret (rotation / lost authenticator while still able to log in) | current password + proof of the new secret (`totpSecret`, `totpCode`) | new encrypted secret, `last_step` := proving step, TOTP throttle cleared |
| Enable "require TOTP at login" | current TOTP code | flag set (the code proves a working authenticator, preventing self-lockout) |
| Disable "require TOTP at login" | current TOTP code (C3) | flag cleared; a hijacked session without the authenticator cannot downgrade the account |

Wrong current password / code in these operations feed the same per-account counters as login. A consumed code advances `totp_last_step` like any other verification.

The toggle does not additionally ask for the password: the session already required it, and the code is the factor a session thief lacks.

Why rotation does not ask for the old code: its purpose includes replacing a lost authenticator. With mandatory TOTP the session itself was obtained with the old authenticator; without it, the password is already sufficient for full access.

### 4.6 Admin API, authorization, audit

Authorization, in order, inside one transaction: account boundary (Host/Origin, cookie only) → live session → `X-Account-Actor` equals the session owner → owner locks for actor and target in sorted order (the existing deadlock-avoidance rule — `Accounts.scala:92-96`) → `effectiveAdmin(actor)` from the live directory → target rules (§4.1.4) → effect → `directoryChanged`.

Operations: list users (declarative and imperative, with provenance), create/list/revoke enrollments, enable/disable imperative user, grant/revoke admin on imperative user, issue credential reset. Exact wire shapes are in §5.

Availability: the user-management operations exist when either feature is enabled (an operator who allows only self-signup still needs to disable abusive accounts); enrollment and reset operations exist only with `enrollment.enable`.

Audit events **[P]** — emitted by the adapter after commit through the service's existing logger (Haystack structured stdout events `haystack/.../Http.scala:228-239`; Chronicle `logstage`; Manure its request log), with a fixed field allowlist `event, actor, target, outcome, clientAddress` and never any secret, e-mail, code or request body:

`account.signup`, `account.enrollment.created|revoked|redeemed`, `account.reset.issued|redeemed`, `account.recovery.succeeded|rejected`, `account.locked` (factor), `account.password.changed`, `account.totp.replaced`, `account.totp.required-changed`, `account.email.changed`, `account.admin.granted|revoked`, `account.enabled|disabled`.

`clientAddress` is a new logged field; Haystack's per-layer logging allowlist (`haystack/docs/auth.md:153-160`) must be extended explicitly for these events.

### 4.7 Throttling

| Layer | Key | State | Policy |
|---|---|---|---|
| Account, password factor | imperative user | row columns (persistent, shared by all processes) | from the 10th consecutive failure (n ≥ 10), lock `min(15 min, 1 min × 2^(n−10))`; reset by a successful password verification. Sustained ≈ 35 000 guesses/year per account (computed). |
| Account, TOTP factor | imperative user | row columns | from the 5th consecutive failure (n ≥ 5), lock `min(24 h, 15 min × 2^(n−5))`; reset only by a successful TOTP verification or admin reset. |
| Client address | resolved client address × endpoint class | in memory, bounded map (as Manure's `Throttle`) | credential endpoints (login, recover, signup, inspect, redeem): 10 requests/minute; successful signups: 5/day. |
| Global | — | in memory | successful signups: 20/hour; PBKDF2 work on unauthenticated endpoints: 2 concurrent, bounded wait queue of 16, otherwise `503 unavailable` (Chronicle's `Semaphore(2)` generalised). |

Client address **[P]**: `ClientAddress.resolve(socketPeer, xForwardedFor, trusted)` — when the socket peer is trusted (loopback for Haystack/Chronicle, `trusted_proxies` for Manure), the right-most `X-Forwarded-For` element is the client address; otherwise, or when the header is absent, the socket peer is. An absent header behind a proxy makes all clients share one bucket: stricter, never weaker. The Nix-managed proxies gain `proxy_set_header X-Forwarded-For $remote_addr;` (§6.4).

Scope: the per-account layer applies to imperative accounts only (no behaviour change for declarative users). The address and global layers apply to the listed endpoints, including `/login`, only when a feature is enabled; with both off, `/login` is handled exactly as today. The absence of any login limiter in Haystack and the uncovered account login path in the Chronicle HM proxy (§2.6) are existing conditions that this design does not change when the features are off; they are reported, not corrected, here.

Denial of service accepted: anyone who knows a username can keep that imperative account's password login delayed by up to 15 minutes per attempt and its recovery locked. Declarative accounts are unaffected.

### 4.8 Sharing strategy and store interface

#### 4.8.1 Placement

Compared placements: (a) logic inside each service next to its routes — three copies of TOTP, lockout, enrollment and policy; (b) shared core that owns *credentials and identity state* but not sessions or HTTP — matches the module's stated boundary (§2.1) and Chronicle's separate session store; (c) shared core that also owns sessions — would force Chronicle onto the shared session tables, a migration nobody asked for. **Chosen: (b).**

#### 4.8.2 New code in `shared/service-auth` (package `ponygirls.auth`) **[P]**

```scala
// Totp.scala — pure
object Totp { def code(secret: Array[Byte], step: Long): String
              def verify(secret: Array[Byte], code: String, now: Instant, lastStep: Long): Option[Long]
              def decodeSecret(base32: String): Array[Byte] }           // exactly 20 bytes or AccountFailure("invalid")

// TotpVault.scala
final class TotpVault(key: SecretKeySpec, val keyId: String, service: String) { def seal(userId, secret): Sealed; def open(userId, sealed): Array[Byte] }
object TotpVault { def load(path: Path, service: String): TotpVault }

// ImperativeAccounts.scala — model, policy, repository seam, logic (no SQL, no HTTP)
final case class ImperativeSettings(service: String, signup: Boolean, enrollment: Boolean, maxUsers: Int,
  enrollmentTtl: FiniteDuration, issuer: String, reservedUsernames: Set[String], vault: TotpVault)
final case class DeclaredDirectory(users: Vector[AccountUser], admins: Set[String])

private[auth] trait ImperativeUserRepository {            // the store interface (C1)
  def lockDirectory(): Unit
  def lockUser(id: String): Unit
  def users: Vector[StoredImperativeUser]
  def user(id: String): Option[StoredImperativeUser]
  def insertUser(row: StoredImperativeUser): Unit
  def updateUser(row: StoredImperativeUser): Unit
  def enrollments: Vector[StoredEnrollment]
  def enrollmentByDigest(digest: String): Option[StoredEnrollment]
  def putEnrollment(row: StoredEnrollment): Unit           // replaces the pending row for the same username
  def deleteEnrollment(id: String): Unit
  def deleteExpiredEnrollments(now: Instant): Unit
}

trait AccountSessions {                                    // service-owned session store, same transaction
  def establish(user: AccountUser, replaced: Option[String]): AccountSession
  def revokeSessions(userId: String, keep: Option[AccountCredential]): Unit
  def directoryChanged(merged: Vector[AccountUser], changedUserId: String): Unit  // fingerprints (H/M) or ch_users projection (Chronicle)
}

// ImperativeAccountSql.scala — PostgreSQL repository + connection-level facade (caller owns the transaction)
object ImperativeAccountSql {
  def initialize(c: Connection): Unit
  def directory(c: Connection, settings: Option[ImperativeSettings], declared: DeclaredDirectory): Vector[AccountUser]
  def authenticate(c: Connection, settings: ImperativeSettings, declared: DeclaredDirectory,
                   login: String, password: String, totp: Option[String]): LoginDecision   // NotImperative | Verified(user) | Rejected(code, retryAfter)
}

// ImperativeAccountApi.scala — transport-neutral dispatcher for every NEW endpoint + JSON codec
final case class AccountRequest(method: String, path: String, body: Option[Json], actor: Vector[String],
  session: Option[AccountCredential], sessionSecret: Option[String], clientAddress: String)
final case class AccountReply(status: Int, body: Json, cookie: CookieEffect /* Keep | Set(secret) | Clear */,
  retryAfterSeconds: Option[Int], events: Vector[AccountEvent])
object ImperativeAccountApi {
  def handle(c: Connection, settings: Option[ImperativeSettings], declared: DeclaredDirectory,
             sessions: AccountSessions, request: AccountRequest): AccountReply }

// AttemptLimiter.scala — in-memory per-address/global windows; plain synchronized state usable from blocking and IO code
```

`SharedAccountSessions(c, ownerKey: String => String)` implements `AccountSessions` over the existing `Accounts` for Haystack (`ownerKey = identity`) and Manure (`ownerKey` = its digest mapping — `manure/.../Auth.scala:124`). Chronicle supplies its own ~30-line implementation.

Two small changes to existing shared code:

- `Accounts.establish(users, userId, previous)`: session creation for an already-verified user, extracted from `login`/`loginReplacing` (`Accounts.scala:75-101`), so that imperative login, signup, redemption, recovery and password change do not verify the password twice or duplicate session code.
- `Accounts.reconcile`: return without locks or writes when nothing would change (D19), i.e. when every directory user has an identical stored fingerprint row **and** every stored row absent from the directory is already disabled. Any difference takes the existing full path unchanged.

Lock order (one rule for all new operations, to stay deadlock-free with the existing sorted owner locks): directory lock → imperative user locks in sorted id order → the existing `Accounts` owner locks. `reconcile` takes owner locks only.

#### 4.8.3 What each service keeps

| Concern | Haystack | Manure | Chronicle |
|---|---|---|---|
| Boundary (Host/Origin/body/cookie) | existing `accountBoundary`, `Sessions` | existing `account()` / `context()` | existing `accountBoundary` |
| Config parsing | `auth.accounts`, `users[].admin` in `Config.scala`, `Auth.scala` | `accounts`, `users[].admin` in `Config.scala` (closed key sets) | `accounts`, `users[].admin` in `Core.scala` |
| Directory | `AccountService`: `auth.users` → `ImperativeAccountSql.directory(c, …)` everywhere it is passed today | `Auth.current(tx)` merges through a new `AuthTxn` member | no merge per request (the projection below makes `ch_users` the merged directory); `DeclaredDirectory` for admin checks and the user list is built from `config.users` |
| Sessions | `SharedAccountSessions` | `SharedAccountSessions` with owner-key mapping | own `ch_sessions` implementation |
| `directoryChanged` | `AccountSql.reconcile(c, merged)` | same | upsert `ch_users(id, login, enabled, credential)` for the changed user, delete its sessions when the credential changed, seed `ch_owner_targets` (as startup does — `Database.scala:27,37`) |
| Startup | `ImperativeAccountSql.initialize` after `AccountSql.initialize` (`Migrations.scala:32`) | same place as `AccountSql.initialize` (`Main.scala:151`) | in `Database.initialize`: after the configured-user upsert loop, collision check, then upsert every imperative row (or leave them disabled when both features are off) |
| Login | route calls the shared login decision | same | `Auth.login(c, r)` asks `authenticate` first; `NotImperative` → existing code |
| Routes | one catch-all for the new paths delegating to `ImperativeAccountApi.handle`, placed before the existing account 404 (`Http.scala:153`) | one branch in `account()` | one route group using the existing `loginGate` |
| Client address | socket peer + `X-Forwarded-For` when the peer is loopback | socket peer + `trusted_proxies` | as Haystack |

Rejected for Chronicle: implementing `ImperativeUserRepository` directly over `ch_users` (a second SQL adapter and a second run of the contract suite, plus new columns in a table that eleven foreign keys reference). The projection keeps `ch_users` as Chronicle's *effective directory* (declared ∪ imperative) and leaves every existing Chronicle query untouched.

#### 4.8.4 Tests are shared the same way

One abstract `ImperativeAccountContract` in `shared/service-auth/src/test`, run against a handwritten `MemoryImperativeUsers` and the PostgreSQL repository through the existing owned-PostgreSQL script (`shared/service-auth/scripts/test-postgres.sh`), with an injected `Clock`. Services do not repeat the behaviour matrix. Manure's `MemoryAuthTxn` needs the new `AuthTxn` member(s); to avoid a third copy of the logic, the shared in-memory repository is published from the shared module's test scope (sbt `test->test` dependency for `manureServer`; no such dependency exists today — `build.sbt:142`).

#### 4.8.5 Cost of the merged directory

`Accounts` validates and scans the whole directory on every call (`Accounts.scala:32-43`), and the adapters call it one to three times per request. Adding imperative users adds one indexed `SELECT` of ≤ 1000 small rows per call. With the default cap of 100 this is negligible **[I]**; the hard ceiling of 1000 bounds it. If a deployment needs more, the follow-up is an indexed directory interface (`byId`, `byLogin`) instead of a vector — not part of this design.

### 4.9 Account UI surfaces, states and calls (no visual design)

The shared client owns the URL fragment prefix `#account-`. Host pages provide triggers; the shared code shows or hides them from `GET /policy` and `GET /profile`.

| Surface | Entry | States | Calls |
|---|---|---|---|
| Login | existing `form[data-account-login]` | `credentials` → `submitting` → done / `error` / `second-factor` (after `401 totp-required`; login and password held in memory only) → `submitting` → done / `error` / `rate-limited(retryAfter)` | `POST /login` |
| Signup | host trigger `[data-account-signup]`, shown when `policy.signup` | `loading-policy` → `form` (secret generated, QR + base32 shown, fields: username, e-mail, password, code, "require TOTP at login") → `submitting` → done (reload) / field errors (`username-unavailable`, `weak-password`, `totp-mismatch`, `invalid`) / `closed` (`403`) / `rate-limited` / `unavailable` | `GET /policy`, `POST /signup` |
| Enrollment | fragment `#account-enroll={code}` at load | `inspecting` → `form` (username fixed; e-mail only for `invite`) / `invalid-link` (`404`) → `submitting` → done / field errors | `POST /enrollments/inspect`, `POST /enrollments/redeem` |
| Recovery | host trigger `[data-account-recover]`, shown when the policy endpoint exists | `form` (username, code, new password) → `submitting` → done (reload) / `rejected` (generic) / `weak-password` / `rate-limited` | `POST /recover` |
| Account settings | existing `[data-account-settings]` dialog | existing token section unchanged; new sections rendered from `profile.manage`: e-mail (`view`/`saving`), password (`form`/`saving`), TOTP replacement (`form` with new QR/`saving`), require-TOTP toggle (`confirm` with a current code/`saving`); declarative accounts: sections absent | `GET /profile`, `POST /profile/email`, `/profile/password`, `/profile/totp`, `/profile/totp-required` |
| User management | host trigger `[data-account-users]`, shown when `profile.manage.users` | `loading` → `list` (source, enabled, admin, locked, pending enrollment) → per-row `confirming`/`saving`; enrollment `form` → `issued` (link shown once, copy action, not stored) | `GET /admin/users`, `POST /admin/users/{id}/enabled`, `/admin/users/{id}/admin`, `/admin/users/{id}/reset`, `GET /admin/enrollments`, `POST /admin/enrollments`, `/admin/enrollments/{id}/revoke` |

Rules carried over from the existing UI **[O]** (`shared/account-web/README.md`): no secret (password, TOTP secret, enrollment code, session) in browser storage; every mutation sends the `actor` from a fresh read; a mismatched owner closes the dialog and dispatches `account:changed`.

---

## 5 API / wire changes per service

### 5.1 Common additions to account HTTP v1 (identical in the three services) **[P]**

All paths are under `/api/account/v1` and inherit the existing rules **[O]** (`shared/service-auth/README.md:49-76`): strict UTF-8 JSON ≤ 16 KiB, depth ≤ 8, exact member sets, no query string, no bearer credential, exact Host/Origin, `Cache-Control: no-store`, sanitized `{error:{code,message}}`. Authenticated mutations require exactly one `X-Account-Actor`. `{user}` is the existing object `{id,login,displayName,actor}`.

Unauthenticated endpoints:

| Method, path | Exists when | Request | Success | Failures |
|---|---|---|---|---|
| `GET /policy` | signup or enrollment enabled | — | `{signup:bool, enrollment:bool, issuer:string, username:{pattern}, password:{minLength,maxLength}, totp:{algorithm:"SHA1",digits:6,period:30,secretBytes:20}}` | 404 |
| `POST /signup` | signup enabled | `{username,email,password,totpSecret,totpCode,requireTotp}` | `{user}` + session cookie | 400 `invalid` / `weak-password` / `totp-mismatch`; 409 `username-unavailable`; 403 `forbidden` (user cap); 429; 503 |
| `POST /enrollments/inspect` | enrollment enabled | `{code}` | `{username, kind:"invite"\|"reset", expiresAt}` | 404 `not-found`; 429 |
| `POST /enrollments/redeem` | enrollment enabled | `{code,password,totpSecret,totpCode,requireTotp}` plus `email` for `invite` | `{user}` + session cookie | 404; 400 as signup; 429; 503 |
| `POST /recover` | signup or enrollment enabled | `{username,totp,password}` | `{user}` + session cookie | 401 `unauthorized` (any credential or eligibility failure); 400 `weak-password`; 429; 503 |
| `POST /login` (existing) | always | `{login,password}`; additionally `{login,password,totp}` when a feature is enabled | unchanged `{user}` + cookie | unchanged, plus 401 `totp-required`, 429 `rate-limited` |

Authenticated endpoints (browser session; exist when signup or enrollment is enabled):

| Method, path | Request | Success | Notes |
|---|---|---|---|
| `GET /profile` | — | `{user, source:"declarative"\|"imperative", admin:bool, email:string\|null, totp:{required:bool, state:"ok"\|"unavailable"\|"none"}, manage:{email,password,totp,users,enrollment : bool}}` | declarative: `email:null`, `totp.state:"none"`, `manage.email/password/totp:false` |
| `POST /profile/email` | `{email}` | `{ok:true}` | imperative only |
| `POST /profile/password` | `{currentPassword,newPassword}` | `{ok:true}` + replacement session cookie | other sessions revoked |
| `POST /profile/totp` | `{currentPassword,totpSecret,totpCode}` | `{ok:true}` | replaces the secret |
| `POST /profile/totp-required` | `{required,totp}` | `{ok:true}` | both directions need a current code |
| `GET /admin/users` | — | `{users:[{id, login:string\|null, displayName, type, source, enabled, admin, email:string\|null, createdAt:string\|null, createdVia:"signup"\|"enrollment"\|null, createdBy:string\|null, totpRequired:bool\|null, totpState, locked:bool, pendingEnrollment:"invite"\|"reset"\|null}]}` | admin; at most declared + 1000 entries, unpaginated |
| `POST /admin/users/{id}/enabled` | `{enabled}` | `{ok:true}` | admin; imperative target ≠ actor |
| `POST /admin/users/{id}/admin` | `{admin}` | `{ok:true}` | admin; imperative target ≠ actor |
| `POST /admin/users/{id}/reset` | `{}` | `{enrollment, code}` | admin; enrollment enabled |
| `GET /admin/enrollments` | — | `{enrollments:[{id,username,kind,createdBy,createdAt,expiresAt}]}` | admin; enrollment enabled |
| `POST /admin/enrollments` | `{username}` | `{enrollment, code}` | create-or-replace; code returned once |
| `POST /admin/enrollments/{id}/revoke` | `{}` | `{ok:true}` | |

Path ids are imperative usernames (`[a-z][a-z0-9_-]{2,31}`) or `enrollment-<uuid>`, so no percent-encoding ambiguity arises. Declarative ids appear only inside JSON bodies.

Error vocabulary additions (the allowlist in `AccountJson.failure` — `AccountJson.scala:28` — currently collapses unknown codes to `unavailable` and must be extended): `totp-required` (401), `totp-mismatch` (400, setup proof failed), `username-unavailable` (409), `weak-password` (400), `proof-rejected` (403, wrong current password/code on an authenticated self-service operation — distinct from 401 so views do not treat it as a dead session). 429 and 503 carry `Retry-After`.

Unchanged, and to be asserted by tests: request and response shapes of the five existing endpoints, cookie names and attributes, token metadata, bearer authentication, every Baboon model and codec, MCP, WebSocket protocols. This is required by the exact-shape validators in the deployed CLIs (§2.7).

### 5.2 Haystack

- New routes are matched before the account 404 catch-all (`haystack/.../http/Http.scala:153`) and delegate to the shared dispatcher inside `database.transaction`.
- `AccountService` passes the merged directory wherever it passes `auth.users` today (`AccountService.scala:15-79`); `Auth.user(id)` and `configuredTokens(id)` (`Auth.scala:50-51`) must resolve imperative ids (no configured tokens).
- Request telemetry: the route-label allowlist (`Http.scala:232`) gains fixed labels for the new routes; security events are logged per §4.6.
- Live WebSocket: no change; sockets already revalidate the session against the database on every frame and heartbeat (`haystack/docs/auth.md:100-104`).
- Baboon `haystack.api` 1.0.0: unchanged. `/api/v1/login` keeps rejecting.

### 5.3 Manure

- Account routes exist only in the management context (`Require(!ctx.content, "not-found")` — `manure/.../Http.scala:170`); unchanged.
- `/login` keeps `login_rate_per_min_per_ip`; the shared address limiter covers the other unauthenticated endpoints.
- `AuthTxn` gains the imperative operations; `Auth.current` merges the directory.
- The new client asset must be added to both static allowlists (`Http.scala:299-301,350`).
- Content grants bound to a revoked session fail the existing liveness check on every open (`manure/docs/account-auth.md:124-128`); no additional revocation code.
- Baboon `manure.api`, the Python client, CLI and MCP: unchanged.

### 5.4 Chronicle

- HTTP account plane only. **No WebSocket operation, no `chronicle.api` change** (stays 1.9.0); `UserInfo{id,login,scopes}` is unchanged, and the dashboard reads the admin flag from `GET /profile`.
- `Auth.login` consults the shared verification first, so the per-account throttle and mandatory TOTP apply to both `POST /api/account/v1/login` and the legacy `POST /api/login`; the legacy route cannot carry a code and rejects mandatory-TOTP users.
- Imperative users are projected into `ch_users`; `Invite(groupId,targetId)` works with their ids unchanged (`Auth.scala:174-179`).
- New routes reuse `loginGate` for unauthenticated PBKDF2 work.
- The new client asset is added to the unversioned entry-point set (`chronicle/.../Http.scala:156`).

### 5.5 Unauthenticated surface that becomes reachable, and its hardening

| Endpoint | What an anonymous caller can cause | Controls |
|---|---|---|
| `GET /policy` | learn that signup/enrollment is enabled, the issuer string and policy constants | static content; no secrets |
| `POST /signup` | create accounts (name squatting, table growth), spend one PBKDF2 per accepted request | exact Origin; address limit 10/min; creations 5/day per address and 20/h global; PBKDF2 gate; `maxUsers`; hard ceiling; proof of TOTP before hashing |
| `POST /enrollments/inspect` | test codes | 256-bit code space; address limit; uniform 404 |
| `POST /enrollments/redeem` | as inspect, plus PBKDF2 after a valid code | as above; PBKDF2 only after the code digest matched |
| `POST /recover` | guess TOTP codes for a known username; lock that user's recovery | per-account backoff (§4.2.5); address limit; uniform 401; PBKDF2 only after a valid code |
| `POST /login` (existing) | guess imperative passwords; delay that user's login | per-account backoff; address limit; unchanged for declarative users |

All of them are absent (404) when both features are off.

---

## 6 Configuration and Nix options

### 6.1 Server JSON **[P]**

Haystack (inside the hot-reloaded `auth` object) and Chronicle (top level) use the same shape:

```json
"users": [{"id": "operator", "…": "…", "admin": true}],
"accounts": {
  "keyFile": "$CREDENTIALS_DIRECTORY/accounts-key",
  "signup": {"enabled": true, "maxUsers": 100},
  "enrollment": {"enabled": true, "ttlSeconds": 86400},
  "issuer": "Haystack (memory.example.net)",
  "reservedUsernames": []
}
```

Manure follows its snake_case convention for top-level keys and keeps camelCase per-user keys as today:

```json
"users": [{"id": "operator", "…": "…", "admin": true}],
"accounts": {"key_file": "…", "signup": {"enabled": true, "max_users": 100},
             "enrollment": {"enabled": true, "ttl_s": 86400}, "issuer": "Manure (artifacts.example.net)", "reserved_usernames": []}
```

Absent `accounts` ⇒ both features off. Absent `admin` ⇒ `false`.

### 6.2 Server-side validation (fail closed, as existing configuration faults)

- `maxUsers` 1–1000; `ttlSeconds` 300–604 800; `issuer` 1–64 printable characters without `:`; reserved names satisfy the username policy.
- `keyFile` present exactly when a feature is enabled; absolute; outside `/nix/store`; content = base64url of 32 bytes (validated when credentials are acquired, like password-hash files; Manure's `check-config` stays parse-only **[O]** `manure/docs/account-auth.md:26-27`).
- `admin: true` only on a **human** user with browser credentials.
- Manure: `signup.enabled` requires `content_mode = "subdomain"`. In path mode uploaded content runs on the dashboard origin (§2.4), where a script can already call the account plane with the viewer's cookie; open signup would let untrusted uploaders target an admin's session. Enrollment remains allowed in path mode (enrolled users are admin-vetted, like declarative ones).
- Directory collision check of §4.1.3 at startup and on every Haystack reload.

### 6.3 Nix options **[P]**

`nix/lib/service-account-options.nix` gains: `browserOptions.admin` (bool, default `false`), an `accountOptions` constructor, `accountAssertions`, and a renderer that returns `{ }` when both features are off (so the generated JSON is byte-identical to today's — the HM module's existing omission precedent, §2.8).

```nix
smind.services.<haystack|manure|chronicle> = {
  users.<id>.admin = false;
  accounts = {
    keyFile = null;                                  # runtime path string, never a store path
    signup     = { enable = false; maxUsers = 100; };
    enrollment = { enable = false; ttlSeconds = 86400; };
    issuer = "<Service> (<public host>)";
    reservedUsernames = [ ];
  };
};
```

Chronicle's own `users` submodule (`nix/nixos/chronicle.nix:67-76`) gains `admin` directly. The key file is delivered with `LoadCredential` to both the migration and the serving unit, as password-hash files are today.

Assertions:

1. A feature enabled ⇒ `accounts.keyFile` is a non-null absolute runtime path outside the store.
2. `admin = true` ⇒ `type = "human"` with `login` and `passwordHashFile`.
3. `enrollment.enable` ⇒ at least one enabled declarative admin (bootstrap and break-glass path).
4. Manure: `signup.enable` ⇒ subdomain content mode.
5. A feature enabled ⇒ `publicUrl` is set (enrollment links and the issuer default need an origin).

Home Manager, combined module (`smind.hm.services.agentic.{haystack,manure}`): the same `accounts` options; `operator.admin` defaults to **`true`** (the fixed `operator` is the deployment's human operator; the flag is inert while both features are off); `users.<id>.admin` as on NixOS. With `accounts.keyFile = null` and a feature enabled, setup provisions `credentials/<service>-accounts.key` once (0600, 32 random bytes, base64url), then verifies and retains it on later runs — the idempotence rule already used for the operator PBKDF2 file (`docs/drafts/20261115-0015-declarative-service-accounts.md`, "Existing combined Home Manager deployments"). Manure signup cannot be enabled in this module while it hardcodes path hosting (assertion 4); Manure enrollment can.

Home Manager, Chronicle module: `settings` is free-form JSON; the module adds key provisioning (`credentials/accounts.key`) and injects `settings.accounts.keyFile` when a feature is enabled without an explicit key file.

### 6.4 Reverse proxies

Add `proxy_set_header X-Forwarded-For $remote_addr;` to the proxy blocks that lack it: `nix/hm/agentic-services-server.nix:195-199`, `nix/hm/chronicle-server.nix:17-25`, `nix/nixos/manure.nix:268-269`, `nix/nixos/chronicle.nix:199-206`. NixOS Haystack relies on `recommendedProxySettings`; the implementer verifies that it sets the header in the pinned nixpkgs. With an external edge (`proxy.enable = false`) the operator must forward the header from a trusted peer; otherwise all clients share one address bucket (stricter, not weaker).

Independent observation: the HM Chronicle `limit_req` location covers only the legacy `= /api/login` (§2.6).

### 6.5 Defaults and behaviour when off

Both features default to off. With both off: no new JSON keys are emitted, no key file is required, no new route answers anything but the existing 404, the directory contains declarative users only, `/login` uses the unchanged decoder and code path, and the only difference from today is the presence of three empty tables (plus the schema-version table).

---

## 7 Migrations and compatibility

| Topic | Design |
|---|---|
| Schema | `ImperativeAccountSql.initialize(c)`: idempotent `CREATE TABLE IF NOT EXISTS` for the three tables and `ponygirls_imperative_schema` (version 1), under the advisory lock used by `AccountSql.initialize`. Called unconditionally where each service initialises its account tables today (Haystack `Migrations.scala:32`; Manure `Main.scala:151`; Chronicle `Database.initialize`), so toggling a feature never requires a migration. |
| No numbered SQL files | Haystack's `schema_migrations` list and Chronicle's migration and native-image resource lists stay untouched. |
| `ponygirls_account_schema` | Not bumped (stays 2). |
| Existing deployments | Upgrade creates empty tables; nothing else changes. No data backfill. |
| Old binary, new configuration | Features off: configuration is byte-identical, so nothing changes. Features on: Manure fails `check-config` on the unknown key (closed key set); Haystack and Chronicle ignore the unknown keys and run without the feature. The package must be rebuilt before enabling (same caveat as `chronicle/README.md:152`). |
| Rollback to an older binary after imperative users exist | The old binary starts (D15). Haystack/Manure reconciliation treats imperative fingerprints as removed users: sessions end and their issued tokens are revoked; Chronicle's startup sync disables their `ch_users` rows and deletes their sessions. Passwords, TOTP secrets and data remain; rolling forward restores login, but Haystack/Manure tokens must be issued again. |
| Turning both features off | Same effect as the rollback row, by design (D14). |
| Backups | Database dumps now contain PBKDF2 hashes, e-mail addresses and *encrypted* TOTP secrets. The key file must be backed up separately from the database; a dump plus the key file equals the ability to recover every imperative account. Losing the key makes TOTP `unavailable` until admin resets. |
| CLI clients and API tokens | Unaffected: existing endpoints keep their shapes; tokens of declarative users are untouched; imperative users issue tokens through the existing endpoints. The only client gap: Haystack/Chronicle CLI `login` cannot supply a code, so an imperative user with mandatory TOTP cannot log in from those CLIs until an optional `--totp-*` input is added (unit K1). Manure's Python client uses bearer tokens only. |
| Chronicle data model | A new imperative user receives a `ch_owner_targets` row at creation (as startup does for configured users). |

---

## 8 Threat model and residual risks

### 8.1 Capabilities by attacker

| Attacker | Can | Cannot |
|---|---|---|
| Unauthenticated, network access to the origin, signup enabled | Create accounts up to the rate limits and `maxUsers`; squat usernames; learn which usernames exist; then act as a regular human user of the service (§8.3). Delay a known imperative user's password login (≤ 15 min per attempt) and lock that user's recovery. Guess TOTP codes at the bounded rate of §4.2.5. | Affect declarative accounts (no lockout, no recovery path, no API mutation). Obtain admin. Read or guess enrollment codes (256 bit). Learn e-mail addresses. Cause unbounded PBKDF2 work or database growth. |
| Unauthenticated, enrollment only | Probe codes; guess passwords/TOTP of existing imperative users as above. | Create an account without a code issued by an admin. |
| Regular authenticated user | Everything the service already grants any human user. Change own e-mail, password, TOTP; issue own tokens. | Call admin operations (`effectiveAdmin` is checked in the transaction); read the user list or other users' e-mail through the account plane; alter another account; change own username; promote self. |
| Imperative admin | Enroll users, disable/enable and promote/demote imperative users, issue resets (an admin who redeems a reset code takes over that imperative account — inherent in "admin reset"; audited). | Change, disable or impersonate declarative accounts; demote or disable self; read passwords, TOTP secrets, or enrollment codes after issuance. |
| Database or backup reader (no key file) | Read usernames, e-mail addresses, PBKDF2 hashes (offline guessing of weak passwords at 600 000 iterations per guess), all service data. | Use TOTP (encrypted), sessions, tokens or enrollment codes (digests of 256-bit values); recover accounts; pass mandatory-TOTP login even with a cracked password. |
| Database reader **with** the key file | Additionally decrypt TOTP secrets and recover any imperative account. | Affect declarative accounts through this feature. |
| Script running on the service origin (XSS, or Manure path-mode content) | Use the victim's session against the account plane (as today for token issuance); with an admin victim: enroll or promote. Capture a password or TOTP secret typed while it runs. | Change a password or TOTP secret, or turn off mandatory TOTP, without the current password/code. Mitigation for Manure: assertion 4 in §6.3. |

### 8.2 Residual risks accepted because there is no e-mail confirmation

1. **Username squatting.** Anyone can claim any free, non-reserved name permanently (accounts are never deleted). Mitigations: reserved list, `reservedUsernames`, rate limits, admin disable. A squatted name cannot be reassigned.
2. **Unverified e-mail.** The address may be mistyped or belong to someone else; it must never be used for authentication, authorization, recovery or as proof of affiliation. It is visible to admins only.
3. **No ownership proof behind an identity.** A username is not evidence of who the person is; attribution in Haystack and Manure (`modifiedBy`, uploader) shows a self-chosen name.
4. **Signup closure.** An attacker can fill `maxUsers` (at ≤ 20 accounts/hour globally) and thereby close signup until the operator raises the cap; disabled accounts keep counting.
5. **No out-of-band recovery.** A user who loses the authenticator and forgets the password depends on an admin (imperative) or on configuration (declarative).

### 8.3 Consequence of "regular human user rights" (C6) per service — observed semantics

- **Haystack:** every authenticated user reads and writes every item (`haystack/docs/auth.md:9-10`). Open signup = anyone who reaches the origin can read and modify the whole memory store.
- **Manure:** every authenticated user reads internal artifacts and can delete any artifact (`manure/.../Artifacts.scala:118-122`, `manure/README.md:25-28`), and shares the global storage quota. Open signup = anyone who reaches the origin can read, fill and delete the store.
- **Chronicle:** archives are per owner; a new user sees nothing of others without a group invitation, but can issue `Ingest` tokens and upload sessions, consuming annotation/embedding model capacity and storage; there is no per-user quota.

These follow directly from C6 and the existing authorization models; this design adds neither roles nor quotas. Enabling `signup` is therefore an exposure decision equal to "everyone who can reach the origin is a user" (OQ1).

### 8.4 Other residual risks

- **TOTP is equivalent to the password for recovery.** Possession of the authenticator secret alone resets the password, also for a user who opted into mandatory TOTP: the opt-in defeats password theft, not authenticator theft (OQ8).
- **Targeted denial of service** on an imperative account's login/recovery by anyone who knows the username (§4.7).
- **Online password guessing** bounded to ≈ 35 000 attempts/year per account; there is no breached-password list (minimum length 12 is the only strength rule).
- **Key file loss** disables recovery and mandatory-TOTP login for affected users until an admin reset.
- **Per-request directory cost** grows linearly with imperative users up to the ceiling (§4.8.5).
- **Client-generated TOTP secret:** a non-browser client can submit a low-entropy secret and weaken its own account.
- **`clientAddress` in security logs** is a new personal datum in logs.

---

## 9 Test plan (lean)

Principle: behaviour is specified **once**, in the shared module; services test only their seam. No sleeps (injected `Clock`), no VM tests, no per-service copy of the matrix.

| Layer | Where | Cases | Notes |
|---|---|---|---|
| Pure unit | `shared/service-auth/src/test` — `TotpSuite`, `TotpVaultSuite`, `ImperativePolicySuite` | ≈ 12 | RFC 6238 vectors (`287082`, `081804`); ±1 window; replay; canonical base32; vault round trip, wrong key, wrong AAD; username/e-mail/password tables; both backoff schedules at their boundaries. Milliseconds. |
| Contract (in-memory dummy **and** PostgreSQL) | `ImperativeAccountContract` + two bindings, run by the existing `shared/service-auth/scripts/test-postgres.sh` | ≈ 14 | (1) signup creates account + session atomically; (2) taken/reserved/declared-colliding names and the cap are refused, nothing persisted; (3) failed TOTP proof persists nothing; (4) login without and with mandatory TOTP, `totp-required`, replayed code refused; (5) password lockout is **persisted on a rejected attempt**, backs off, resets on success; (6) recovery replaces the password, revokes sessions, keeps tokens, consumes the step; (7) recovery lockout and backoff; (8) enrollment: create → inspect → redeem once; expiry; replace on re-issue; revoke; (9) reset replaces credentials, keeps tokens, e-mail and admin flag; (10) admin rules: imperative only, not self, non-admin refused, declarative target refused; (11) disable ends sessions, revokes tokens, keeps the name reserved; enable restores login; (12) declared/imperative collision fails the directory closed; (13) both features off: every new path is `not-found`, directory excludes imperative rows; (14) undecryptable secret ⇒ `unavailable`, password login unaffected. |
| Shared prerequisite | existing `AccountContract` | + 2 | reconcile of an unchanged directory performs no writes; `establish` yields the same session semantics as `login`. |
| Haystack adapter | existing `AccountHttpTest` harness (real PostgreSQL) | 3 | signup → cookie → `GET /profile` → logout → login; boundary (Origin required, bearer refused, features-off 404, existing five endpoints byte-identical); reload with a colliding declared login fails closed. |
| Manure adapter | existing `HttpSuite` / `AccountsContract(postgres)` | 3 | same flow through the owner-key mapping; closed-key configuration with and without `accounts`; signup refused by configuration in path mode. |
| Chronicle adapter | existing `AccountHttpTest` (real PostgreSQL) | 4 | same flow; projection into `ch_users` + `ch_owner_targets`; restart keeps imperative users enabled when on and disables them when off; legacy `/api/login` refuses a mandatory-TOTP user. |
| Nix evaluation | `nix/tests/service-accounts.nix` | ≈ 6 | generated JSON equals the current golden when off; keys present when on; each assertion of §6.3 fires. |
| Provisioner | `nix/tests/test_agentic_services_credentials.py` | 2 | key created once with mode 0600; retained unchanged on rerun. |
| Web client, DOM-free | Node test next to `account-client.js` | ≈ 10 | base32, secret length, `otpauth` URI, one QR matrix vector, state machines against a fake `fetch` (login second factor, signup field errors, enrollment invalid link, recovery, toggle). No browser. |
| Web views | `shared/account-web/tests/browser.mjs` (controlled routes) | ≤ 4 | signup happy path (QR node and base32 present, secret not in storage); login second factor; enrollment code consumed from the fragment and removed from the URL; admin enrollment shows the link once. |
| End to end | `haystack/web/tests-browser/account.mjs` (one service only) | 1 | real backend: signup → logout → login. |
| Native crypto | one check added to an existing native smoke of one service | 1 | HmacSHA1 + AES-GCM reachable in the native image. |

Budget: about 60 new cases in total. PBKDF2 is the only slow primitive; the contract suite reuses one precomputed hash wherever a fresh one is not the subject (as `AccountContract.scala:8` does) and should add well under a minute per backend **[I]**. Final acceptance still follows the repository's full-suite rule for the touched services (`AGENTS.md`).

Deliberately not tested: three-service browser matrices, proxy rate limiting, deployment activation.

---

## 10 Implementation work breakdown

Sizes: S ≤ ~200 changed lines, M ≤ ~600, L above. "UX" marks a conflict with the concurrent redesign of the dashboards and `shared/account-web`.

| Unit | Scope | Files owned | Depends on | Acceptance | Size | UX |
|---|---|---|---|---|---|---|
| **S0** Shared prerequisites | change-driven `reconcile`; extract `Accounts.establish` | `shared/service-auth/src/main/scala/ponygirls/auth/{Accounts,AccountSql}.scala`, `src/test/.../AccountContract.scala` | — | existing shared suite + 2 new cases pass on memory and PostgreSQL; no caller change | S | — |
| **S1** TOTP primitives | `Totp`, `TotpVault` | new `Totp.scala`, `TotpVault.scala`, their suites | — | RFC vectors; vault cases | S | — |
| **S2** Imperative core | model, policy, repository trait, logic, in-memory dummy, contract suite | new `ImperativeAccounts.scala`; tests `ImperativeAccountContract.scala`, `MemoryImperativeUsers.scala` | S0, S1 | contract green on the dummy | L | — |
| **S3** PostgreSQL repository | DDL initializer, repository, facade, PostgreSQL binding of the contract | new `ImperativeAccountSql.scala` + test binding | S2 | contract green on owned PostgreSQL; initializer idempotent | M | — |
| **S4** API dispatcher | `ImperativeAccountApi`, JSON codec, error codes, `AttemptLimiter`, `SharedAccountSessions`; protocol section of `shared/service-auth/README.md` | new `ImperativeAccountApi.scala`, `AttemptLimiter.scala`; `AccountJson.scala` (code allowlist) | S2 (parallel with S3) | dispatcher cases of the contract; §5.1 reproduced in the README | M | — |
| **H1** Haystack adapter | configuration, directory merge, routes, client address, telemetry labels, static entry set; `haystack/docs/auth.md`, `scala-config.example.json` | `haystack/server/src/main/scala/haystack/{Config,Main}.scala`, `auth/{Auth,AccountService}.scala`, `http/Http.scala`, `haystack/server/src/test/scala/haystack/auth/*` | S3, S4 | 3 adapter cases; Haystack full backend suite | M | — |
| **M1** Manure adapter | configuration key sets, `Auth`/`AuthTxn`, routes, asset allowlists, path-mode rule, test dummy through the shared test scope; `manure/docs/account-auth.md` | `manure/backend/src/main/scala/manure/{Config,Auth,Http,Metadata,Main}.scala`, `manure/backend/src/test/scala/manure/{MemoryAccounts,MemoryMetadata,AccountsContract,HttpSuite,CheckConfigSuite}.scala`, `build.sbt` (test-scope dependency) | S3, S4 | 3 adapter cases; Manure backend suite | M | — |
| **C1** Chronicle adapter | configuration, `ch_users` projection, startup sync, login hook, routes, static entry set; `CONTRACT.md`, README auth paragraph | `chronicle/server/src/main/scala/chronicle/{Core,Auth,Database,Http,Main}.scala`, `chronicle/server/src/test/scala/chronicle/Account*Test.scala`, `chronicle/config.example.json` | S3, S4 | 4 adapter cases; Chronicle full backend suite | M | — |
| **N1** Nix | shared options, assertions and renderer; three NixOS modules; HM combined module and provisioner; HM Chronicle module; proxy header; evaluation tests | `nix/lib/service-account-options.nix`, `nix/nixos/{haystack,manure,chronicle}.nix`, `nix/hm/agentic-services-server{,-options,-assertions}.nix`, `nix/hm/agentic-services-credentials.py`, `nix/hm/chronicle-server.nix`, `nix/tests/{service-accounts.nix,test_agentic_services_credentials.py}` | §6 only (can start immediately) | golden-off equality; assertions; provisioner cases | M | — |
| **W1** DOM-free web client | API calls, state machines, base32, secret generation, `otpauth` URI, QR matrix; Node tests | new `shared/account-web/account-client.js` and its test | §5 only (can start immediately) | ≈ 10 Node cases | M | low (new file) |
| **W2** Shared views | signup, enrollment, recovery, login second factor, settings sections, user management; controlled-route browser cases | `shared/account-web/{account.js,account.css,README.md,tests/browser.mjs}` | W1 **and the UX redesign of these files** | ≤ 4 new browser cases; existing cases still pass | M | **yes — to be done by, or sequenced after, the UX workstream** |
| **W3** Per-service UI integration | triggers (`data-account-signup`, `-recover`, `-users`); build and packaging of the new asset | `haystack/web/src/{Login,App}.tsx`, `haystack/web/vite.config.ts`, `chronicle/web/src/{App,Access}.tsx`, `chronicle/web/vite.config.ts`, `manure/web/dashboard/{index.html,app.js}` + symlink, `nix/pkg/{haystack/web,chronicle/web,manure/package}.nix` | W2; H1/M1/C1 | one real-backend browser smoke (Haystack); the three dashboards build | S per service | **yes — the dashboards are being redesigned** |
| **K1** CLI second factor (optional) | `login --totp-file/--totp-stdin` | `haystack/cli/src/{account,client}.ts`, `chronicle/cli/src/{account,main}.ts` | S4 | CLI login for a mandatory-TOTP user | S | — |
| **V1** Final validation | full unfiltered suites of the touched services, native smoke, documentation cross-check | none | all | per `AGENTS.md` | — | — |

Order and parallelism: (S0 ∥ S1) → S2 → (S3 ∥ S4) → (H1 ∥ M1 ∥ C1). N1 and W1 can start immediately, in parallel with everything. W2 and W3 are gated by the UX workstream. Backend and Nix units touch no file the UX redesign owns; the only shared edges are the static-asset allowlists inside the three `Http.scala` files (owned by H1/M1/C1) and the packaging lists in W3.

Asset note for W1–W3: every new static file under `shared/account-web` must be registered in nine places (two Vite plugins, three Nix filesets, Manure's two allowlists and its symlink directory, Haystack's and Chronicle's entry-point sets). The design therefore adds exactly one file.

---

## 11 Open questions for the owner

The working assumptions of the brief are confirmed (§3). The questions below concern decisions introduced by this design. Each has a recommendation; the design proceeds with it unless told otherwise.

| # | Question | Recommendation | Cost of the other answer |
|---|---|---|---|
| OQ1 | Given C6, open signup on Haystack and Manure gives every newcomer read/write of all records (Haystack) and read/delete of all artifacts (Manure) — §8.3. Should self-signed-up accounts instead start **disabled until an admin enables them**? | Keep C6 as confirmed; enable signup only where every client that can reach the origin is trusted. | Approval mode is small: one configuration flag, accounts created disabled; the enable operation already exists. A restricted role would be a per-service authorization project. |
| OQ2 | Encrypt TOTP secrets with a per-service key file (D7), adding one runtime secret per service? | Yes. | Plaintext: remove the vault and key options (small); a database or backup read then enables takeover of every imperative account. |
| OQ3 | Browser-generated TOTP secret (D6)? | Yes. | Server-generated: one unauthenticated setup endpoint and a sealed-blob member (small; needs the key file). |
| OQ4 | Declarative non-admins cannot be promoted through the UI; declarative accounts are entirely configuration-owned (D4). | Yes — matches "an admin can set the flag on a non-declarative user". | Overlay table for declarative ids (medium). |
| OQ5 | Imperative accounts are disabled, never deleted; usernames are never reused (D2). | Yes. | Tombstoned deletion with a data policy per service (medium per service). |
| OQ6 | Turning both features off deactivates imperative accounts and, in Haystack/Manure, revokes their issued tokens (D14). | Yes; to keep users without new signups, leave enrollment enabled. | A third "local accounts" flag (small); recovery endpoints then stay reachable while signup and enrollment are off. |
| OQ7 | Lockout numbers (§4.7) and the accepted denial of service against known usernames. Additionally hard-lock TOTP verification after a fixed number of failures until an admin reset? | Backoff only (≈ 0.11 % success per year of sustained attack on one account). | One more threshold (small); more admin interventions. |
| OQ8 | For a user who opted into mandatory TOTP, recovery by TOTP alone makes the authenticator a single sufficient factor. Offer "no self-service recovery" to such users? | Not now. | One per-user boolean checked in `recover` (small). |
| OQ9 | Home Manager `operator.admin` defaults to `true`; NixOS requires a declarative admin whenever enrollment is enabled. | Yes. | Default `false` is one line; the operator then opts in explicitly. |
| OQ10 | Enrollment defaults: 24 h TTL; a reset leaves the old credentials valid until redeemed. | Yes. | Single constants/branches (small). |
| OQ11 | Username policy `^[a-z][a-z0-9_-]{2,31}$`, used as the public user id and shown as author/owner. | Yes. | The pattern is one constant; a separate opaque id is a redesign of §4.1. |
| OQ12 | Add the optional `--totp` input to the Haystack and Chronicle CLIs now (K1), or leave mandatory-TOTP users browser-only? | Defer K1 until needed. | K1 is small. |
| OQ13 | Log the client address in account security events (new logged personal datum). | Yes, for these events only. | Drop the field; abuse can then not be attributed. |
