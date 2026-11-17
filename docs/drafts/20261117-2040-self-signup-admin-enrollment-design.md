# Self-signup and admin enrollment for Chronicle, Haystack and Manure — design v2

Status: **design v2** (design only; nothing in this document is implemented). Base commit `f153d1ae`. Supersedes v1 (commit `834ed1fe` of this file).

Evidence markers used throughout:

- **[O]** observed in this checkout (file:line given);
- **[I]** inferred from observed facts or general knowledge, not verified here;
- **[P]** proposed by this design.

"Declarative user" = account defined in service configuration (Nix → JSON).
"Imperative user" = account created at runtime (self-signup or admin enrollment) and stored in the service database.

---

## 0 Changes since v1

Sources: owner decisions Q83/Q84 (binding), orchestrator decisions on the v1 open questions, and an independent review (one blocker, five majors). Every reviewer claim was checked against the source before adoption; the "Verified" column records the check.

### 0.1 Owner decisions

| Item | Outcome | Where |
|---|---|---|
| **A1 / Q83** — `signup.requireApproval`, default `true` | **Adopted.** Explicit account status `pending → active` (not "disabled"); signup answers `202 {"status":"pending"}` with no session; a pending account is indistinguishable from a nonexistent one on login and recovery, is outside the directory (no sessions, tokens or service API), holds its username and counts toward the caps; admins approve or reject; **reject deletes the row and frees the name** (a pending account never held authority or produced data, so the reuse hazard that motivates permanent reservation does not exist, whereas keeping rejected rows would let spam consume names and cap slots for ever); approval re-checks the namespace and is always an explicit admin action — no rule keyed on the unverified e-mail exists; a declarative admin is required whenever approval is on; enrollment-created accounts are active immediately. | D9, D21, §4.1, §4.3, §4.6, §5, §6 |
| **A2 / Q84** — Manure signup allowed in `path` content mode | **Adopted.** The v1 configuration rule and Nix assertion are removed. The risk is stated in §8.4 and as text for `manure/docs/account-auth.md` (§8.5). Admin-flag changes and credential resets require the acting admin's current password (§4.6.3), which closes the non-interactive "same-origin script mints an admin" path for both admin kinds. | D26, §4.6.3, §6, §8.4, §8.5 |
| A3 — Q78–Q80; Q81/Q82 | Q78–Q80 stand as in v1 (now listed as owner decisions O1–O6). Q81/Q82 concern the host and do not affect this design. | §3 |

### 0.2 Orchestrator decisions on the v1 open questions

| v1 item | Decision | Effect on v2 |
|---|---|---|
| OQ1 | superseded by A1 | approval mode |
| OQ2, OQ3, OQ4, OQ5, OQ9, OQ10, OQ11, OQ13 | yes | now decisions, no longer questions (D7, D6, D4, D2, §6.3–§6.4, D10, D2, §4.6.4) |
| OQ7 | backoff only; counters split (C8) | §4.7 |
| OQ8 | no | recovery unchanged for mandatory-TOTP users |
| OQ12 | defer K1 | K1 stays optional and unscheduled |
| OQ6 / D14 | **replaced** by a master switch | `accounts.enable` is an explicit option that is never derived from the creation flags; `signup.enable` / `enrollment.enable` require it and imply nothing. Turning a creation feature off cannot suspend accounts. Master-off **suspends without revoking**: imperative sessions and issued tokens are refused while off and work again when it returns (Chronicle: sessions are deleted by its existing startup rule, tokens are gated). This costs nothing because of the C4 resolution (imperative owners are outside reconciliation). D13, D14, §6, §7 |

### 0.3 Reviewer findings

| # | Finding | Verified | Outcome |
|---|---|---|---|
| C1 (blocker) | Removed declarative identities can be reclaimed. | **Confirmed** for Chronicle exactly as stated (`chronicle/.../Database.scala:28-36`: removed users stay in `ch_users` disabled; eleven foreign keys keep referencing them; the v1 projection was an upsert). For Haystack/Manure the claim holds with a narrower effect: fingerprint tombstones are retained (`Accounts.scala:69`) and data stays keyed by the id (Haystack `created_by`/`modified_by`/`principal_user`, Manure `created_by_user`), but v1 would not have resurrected credentials there (revoked tokens stay revoked, sessions are deleted). | **Adopted.** Retained historical identities are reserved in all three services through a service port `IdentityHistory`; creation is insert-only (Chronicle projection `INSERT`, never upsert; startup refresh is update-only); contract and Chronicle adapter regressions added. D3, §2.11, §4.1.3, §4.8.4 |
| C2 (major) | Chronicle has configuration-only owner registries. | **Confirmed** (`plugins/ChroniclePlugin.scala:21`, `ModelTelemetry.scala:149-153,171,204-206`, `Models.scala:42,73-74`, `McpRuntimeResources.scala:9`, `McpTestRuns.scala:108`). | **Adopted.** New unit CH0: telemetry slices are created on first use; the static MCP owner set is removed in favour of the live authorization that already follows it (`RunAuthorization.scala:21-30`). Every use of the configured user list in the three services is classified in §2.12. D24 |
| C3 (major) | Manure search excludes imperative users. | **Confirmed** (`manure/.../Search.scala:46-49,98`, `PostgresRetrieval.scala:216`). | **Adopted as suggested.** One constant management audience used only after live authentication — the pattern Haystack already uses (`HaystackRetrieval.scala:56,62`). The existing startup backfill re-publishes every artifact (`manure/.../Main.scala:155-169`), so no rewrite at account creation is needed. New unit M0. D25 |
| C4 (major) | Reconciliation can overwrite newer imperative state. | **Confirmed** as a defect of the v1 design (v1 put imperative users into the reconciled directory and reconciled after each mutation). | **Adopted; resolved differently from the proposed fix.** Instead of serialising every imperative mutation and every reconciliation behind one lock (in Manure reconciliation runs on every authentication, so that lock would serialise all requests), imperative accounts are taken **out of reconciliation entirely**: they have no fingerprint row, and reconciliation is scoped to owners that are declared or have a fingerprint row. A stale snapshot therefore cannot touch imperative sessions, tokens or credentials. The one remaining interaction — a declared name against a concurrent creation — is serialised under the directory lock with a re-read after acquisition, as proposed. One PostgreSQL interleaving regression. D19, §4.8.5 |
| C5 (major) | Owner-lock ordering violated by `directoryChanged`. | **Confirmed** for v1 (`Accounts.scala:65-74,92-96`). | **Adopted.** No mutation-time reconciliation exists any more (C4). A total lock order is defined: directory lock → declarative-scope owners (sorted) → imperative owners (sorted), acquired through one helper; `loginReplacing` sorts by that order. One PostgreSQL regression. D22, §4.8.6 |
| C6 (major) | Earlier password-only sessions can replace the TOTP secret after mandatory TOTP is enabled. | **Confirmed** against v1 §4.5.3. | **Adopted, both measures.** Enabling mandatory TOTP revokes all other sessions atomically; while it is on, replacing the secret also requires a code from the current authenticator (lost authenticator → admin reset). Fresh password proof for admin-flag changes and resets (see A2). D23, §4.5.3, §4.6.3 |
| C7 (minor) | Enrollment re-issuance contradicts the namespace rule. | **Confirmed** (v1 §4.1.3 rule 1 against §4.4). | **Adopted.** Expired rows are deleted first; signup rejects only *live* pending invitations; issuance replaces the matching pending row under the directory lock. §4.1.3, §4.4 |
| C8 (decided) | Shared TOTP failure counter lets anonymous `/recover` spam lock login. | **Confirmed** against v1 §4.7. | **Adopted.** Three independent counters (password, recovery, password-proven TOTP); single-use step protection stays shared. TOTP counters are no longer cleared by a success (a legitimate success must not hand an attacker fresh guesses); they lapse after seven quiet days. Numbers re-derived per path and the residual denial of service restated per endpoint. D8, §4.2.5, §4.7 |
| C9 | Factual corrections. | **Confirmed**, all three. | **Applied** in §2.1 and §2.2 (`Accounts.tokens(owner)` takes no directory; schema versions 1 and 2 are accepted, 1 is upgraded, anything else is rejected; Chronicle also uses the shared account DTOs). |
| C10a | Targeted fingerprint synchronisation instead of mutation-time reconciliation. | — | **Superseded by a stronger form**: no fingerprint rows for imperative accounts at all (C4). |
| C10b | Remove redundant static owner allowlists. | — | **Adopted** (C2). |
| C10c | One PostgreSQL contract instead of an additional in-memory backend. | — | **Rejected.** Manure's dual fixture (`MemoryAuthTxn`, `AccountsContract(postgres)`) needs an in-memory implementation regardless; the dummy is a few dozen lines over a narrow trait; with an injected password hasher the in-memory run costs milliseconds. The PostgreSQL binding of the same suite supplies the constraint, locking and commit guarantees. Fewer and faster tests are obtained by not copying the matrix into the services, not by dropping a backend. §9 |
| C10d | Fold race/integration regressions into existing suites. | — | **Adopted**: the two interleavings go into the existing `AccountRaceSuite`. |
| C10e | Returned-rejection rule explicit for all adapters. | — | **Adopted**, including Chronicle's tuple-returning `login`/`accountLogin`. D27, §4.5.1 |

No reviewer claim was found to be wrong. Two were adopted with a different remedy than proposed (C4, C10a) and one suggestion was rejected (C10c); C1 is narrower for Haystack/Manure than for Chronicle, as noted.

### 0.4 Coordination

- §4.9 remains the behavioural contract for the UX workstream; it gains the pending-approval, approve/reject and fresh-proof states.
- Tests are named by build module and suite only; no assumption is made about runner scripts.

---

## 1 Summary of decisions

"v2" marks decisions that changed or are new.

| # | Decision | Rejected alternative (why) |
|---|---|---|
| D1 | One shared implementation in `shared/service-auth` ("imperative accounts"), identical additive tables in each service database, a thin adapter per service. All new operations are additions to the existing account HTTP plane `/api/account/v1`; no Baboon model changes; the five existing account endpoints keep byte-identical shapes. | Baboon operations / Chronicle WS commands (three model bumps; the account plane is deliberately independent of Baboon). Adding members to existing responses (breaks deployed CLIs — §2.7). |
| D2 | Imperative user **id = immutable username = login**, policy `^[a-z][a-z0-9_-]{2,31}$`. Accounts that have been active are never deleted, only disabled; their names are never reused. | Opaque id + separate login (unreadable attribution; Chronicle invitations target ids). Hard delete (identity reuse). |
| D3 (v2) | Namespace: a new imperative name must not equal (ASCII case-insensitively where the store allows it) any declared id or login, any reserved name, any existing imperative row, or any **retained historical identity** of the service. Creation is insert-only and never adopts an existing row. A declared id/login that collides with an active or disabled imperative account fails closed at startup/reload, with the master switch on or off. Pending applications never cause that fault. | Checking only currently declared users (v1; lets a newcomer inherit the data of a removed account). Shadowing/takeover. |
| D4 (v2) | Effective admin = declarative flag OR imperative flag. Declarative accounts are immutable through the API. An admin cannot demote or disable itself. Changing an admin flag and issuing a credential reset require the acting admin's **current password**. | Overlay rows for declarative users. Password proof on every admin mutation (habituation; no additional authority protected — §4.6.3). |
| D5 | TOTP per RFC 6238: HMAC-SHA1, 6 digits, 30 s, 160-bit secret, window {T−1, T, T+1}, each step usable once across all paths. | SHA-256/8 digits; drift learning. |
| D6 | The TOTP secret is generated in the browser and proven with a current code in the creating transaction. | Server-generated secret in a sealed blob; pending rows. |
| D7 | TOTP secrets are encrypted at rest (AES-256-GCM, per-service key file, `rites` `Vault` precedent). | Plaintext (a database/backup read would enable takeover of every imperative account). |
| D8 (v2) | Throttling: three independent persistent per-account counters — password (anonymous-reachable), recovery (anonymous-reachable), TOTP in password-proven contexts — plus in-memory per-client-address windows and a global PBKDF2 gate. Recovery failures can never block login. TOTP counters are not cleared by a success; they lapse after 7 days without a failure. | One shared TOTP counter (v1). Clearing on success (hands an attacker fresh free guesses after each legitimate success). |
| D9 (v2) | Signup is one POST and one transaction. With `signup.requireApproval` (default **true**) the account is created `pending` and no session is issued; without it the account is active and a session is established. | E-mail confirmation; "administratively disabled" as the approval state. |
| D10 (v2) | Enrollment code: 256-bit random, digest stored, default TTL 24 h, single use, create-or-replace per username under the directory lock after deleting expired rows, delivered in the URL fragment. Kind `reset` replaces the credentials of an existing imperative user. | Code in query/path. |
| D11 | Login gains an optional `totp`; two-step login is stateless (`401 totp-required`). Declarative logins take the unchanged path. | Half-authenticated server state. |
| D12 | Recovery = username + current TOTP code + new password; revokes that account's browser sessions, keeps API tokens, establishes a session; it has its own failure counter. | — |
| D13 (v2) | Configuration: explicit master switch `accounts.enable` (imperative authentication and lifecycle; requires the key file), `signup.enable` (+ `requireApproval`, `maxUsers`), `enrollment.enable`, `users.<id>.admin`. The master is never derived; a creation flag without it is a configuration fault. Everything defaults to off, and Nix omits the keys when the master is off. | Master computed from the two creation flags (turning signup off would silently suspend accounts). |
| D14 (v2, replaces v1) | Master off = suspension, not revocation: no new endpoint is reachable; imperative sessions and issued tokens are refused but kept, and work again when the master returns. | v1: both creation flags off deactivated accounts and revoked Haystack/Manure tokens irreversibly. |
| D15 | Schema: additive tables created by a shared idempotent initializer with its own version table. `ponygirls_account_schema` is not bumped (it accepts 1 and 2 only), so older binaries keep starting. | Bumping it to 3; numbered per-service SQL files. |
| D16 | E-mail exists only on imperative users: stored, editable, unverified, not unique; never used for login, recovery or approval logic. | Unique e-mail. |
| D17 | Audit = structured security events through each service's logger plus provenance columns. | Audit table and browsing endpoint. |
| D18 | Web: DOM-free `shared/account-web/account-client.js` plus views owned by the UX workstream; QR rendered client-side into DOM nodes. | Server-side QR image. |
| D19 (v2) | **Imperative accounts are outside reconciliation.** They have no fingerprint row; `AccountUser` carries its origin; `Accounts.reconcile` accepts declarative users only, touches only owners that are declared or have a fingerprint row, and returns without locks or writes when nothing changed. | Reconciling the merged directory after every mutation (v1; stale-snapshot overwrite and lock-order violation). One global lock around all mutations and reconciliations. |
| D20 (v2) | Tests: pure unit tests; one contract suite on an in-memory dummy and PostgreSQL with an injected password hasher; two interleaving cases folded into the existing race suite; 3–4 seam cases per service; Node tests for the client; ≤ 5 controlled-route browser flows; one real-backend smoke. About 75 new cases. | Per-service matrices; VM tests; PostgreSQL-only contract (C10c). |
| D21 (v2) | Account status is explicit: `pending`, `active`, `disabled`. Approve: `pending → active`. Reject: the pending row is deleted and the name is free again. | Rejected tombstones. |
| D22 (v2) | Lock hierarchy: directory lock → declarative-scope owner locks in sorted order → imperative owner locks in sorted order; one acquisition helper. | Per-row locks in a separate namespace with no defined order relative to owner locks. |
| D23 (v2) | Mandatory TOTP invariant: while it is on, every live session was established or confirmed with a TOTP proof after it was turned on, and the secret can be replaced only with a code from the current authenticator. | Password-only replacement (v1). |
| D24 (v2) | Chronicle: owner registries derived from configuration are removed (telemetry slices on first use; live authorization instead of the static MCP owner set). | Seeding from the merged directory at startup (later signups would still fail). |
| D25 (v2) | Manure: search uses one constant management audience and relies on the live authentication it already performs. | Rewriting every artifact's audience at account creation. |
| D26 (v2) | Manure self-signup is allowed in `path` content mode; the risk is documented, not asserted. | v1 assertion. |
| D27 (v2) | A rejection that must persist state (failure counters) is returned as a value from the transaction and turned into an error response after commit — in the shared dispatcher and in every adapter login path. | Throwing inside the transaction (rolls the counter back). |

---

## 2 Current state (observed)

### 2.1 What is shared today

| Topic | Observation |
|---|---|
| Module scope | `serviceAuth` "owns password verification, opaque browser sessions, issued API credentials, and the separately versioned account JSON protocol. It does not own service permissions, origins, HTTP admission, database connections or transactions." **[O]** `shared/service-auth/README.md:3-5` |
| Password hashing | `ponygirls.auth.Password`: PBKDF2-HMAC-SHA256, 600 000–2 000 000 iterations, 16-byte salt, 32-byte key, text form `pbkdf2-sha256$ROUNDS$SALT$KEY`; constant-time compare; `readHash` for hash files. **[O]** `shared/service-auth/src/main/scala/ponygirls/auth/Account.scala:51-92` |
| Directory model | Every `Accounts` operation that decides authority (`reconcile`, `login`, `loginReplacing`, `browser`, `bearer`, `live`, `logout`, `issue`, `revoke`) receives the **complete directory** `users: Vector[AccountUser]` built by the service from configuration; the exception is `tokens(owner)`, a plain listing by owner key that takes no directory. `AccountUser(id, userType, displayName, login, passwordHash, enabled)`. **[O]** `Account.scala:13-16`, `Accounts.scala:32-43,65-139` |
| Persistence | Three tables created by `AccountSql.initialize`: `ponygirls_account_users` (id, fingerprint, enabled — *not* the password hash), `ponygirls_account_sessions`, `ponygirls_account_tokens`, plus `ponygirls_account_schema(version)`, currently 2. A stored version 1 is accepted and upgraded to 2; an empty table is initialised to 2; any other stored value (in particular a higher one written by a newer binary) is rejected with `config`. **[O]** `AccountSql.scala:11-29` |
| Sessions | Random 256-bit secret, SHA-256 digest stored, no server-side expiry; a session is live only while its owner is enabled, the stored fingerprint equals the directory entry, and the session's `password_identity` equals the digest of the current password hash. **[O]** `Accounts.scala:45-50`, `README.md:28-30` |
| Reconciliation | `reconcile` locks every known owner in sorted order (directory ∪ stored fingerprints ∪ session owners ∪ token owners), tombstones stored users missing from the directory (`enabled = false`, row kept), upserts every fingerprint, deletes dead sessions, revokes issued tokens of ineligible owners. **[O]** `Accounts.scala:65-74`. `loginReplacing` locks the target and the prior session's owner in sorted order. **[O]** `Accounts.scala:92-96` |
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
- Chronicle does not use `Accounts`/`AccountSql` at all; it keeps `ch_users`, `ch_sessions`, `ch_tokens` and its own login/session code. From the shared module it uses `Password`, the account DTOs (`AccountUser`, `AccountToken`, `AccountIssued`), `AccountJson`, `AccountFailure` and `PersistentCookie`. **[O]** `chronicle/server/src/main/scala/chronicle/Auth.scala:6,10-106`, `chronicle/.../Http.scala:13`, `chronicle/.../Core.scala:146-149`, `shared/service-auth/README.md:21-23`

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
- Row counts of the Haystack `items`/`item_revisions` tables in deployments (the retained-identity check of §4.1.3 scans them at signup).

### 2.11 Retained identities of removed declarative users (v2)

| Service | Observation |
|---|---|
| Chronicle | Startup disables every `ch_users` row, then upserts the configured users. A user removed from configuration therefore **stays in `ch_users` as a disabled row**; its archives, group memberships, mutation receipts, issued tokens (gated, not revoked) and login keep referencing the id, and `login` stays under the `UNIQUE` constraint. **[O]** `chronicle/.../Database.scala:28-36`, `chronicle/migrations/001.sql:2-11` |
| Shared tables (Haystack, Manure) | Reconciliation keeps a tombstone (`enabled = false`) for every id that was ever reconciled and is no longer in the directory; the upsert `ON CONFLICT(id) DO UPDATE` would overwrite it if the id reappeared. Issued tokens of removed owners are marked revoked and sessions deleted, so no credential survives; the *login* text of a removed user is not retained (only a digest). **[O]** `Accounts.scala:69-72`, `AccountSql.scala:51` |
| Haystack data | Author ids are stored as text in `items.created_by`, `items.modified_by`, `item_revisions.modified_by` and as the leading key column of `write_requests(principal_user, token_id, request_id)`. There is no foreign key to an account table. **[O]** `haystack/migrations/0001-initial.sql:23-25,36,54-61` |
| Manure data | `manure.artifacts.created_by_user` (bytea) records the creator; mutation of an in-progress upload requires the same user id. **[O]** `manure/backend/src/main/resources/001_metadata.sql:11`, `manure/.../Artifacts.scala:33,75`, `manure/.../Domain.scala:143` |

Consequence **[I]**: an account created later under such an id would be treated by the service as the same owner (Chronicle: archives, memberships and the old owner's still-valid tokens; Haystack: authorship and replay identity; Manure: creator of existing artifacts and control of in-progress uploads).

### 2.12 Every use of the configured user list (v2)

Search performed: `config.users`, `auth.users`, `users` members and derived owner sets in the production sources of the three services.

| Use | Location | Classification for imperative users |
|---|---|---|
| Chronicle: uniqueness of ids and logins | `chronicle/.../Core.scala:51` | Declarative validation; unaffected. |
| Chronicle: static token owner must be configured | `Core.scala:55` | Declarative by design: static tokens cannot name an imperative owner. Unaffected. |
| Chronicle: startup synchronisation into `ch_users` | `Database.scala:28-37` | Must become collision-aware and must not touch imperative projections except through the update-only refresh (§4.8.4). |
| Chronicle: model-telemetry owner registry | `plugins/ChroniclePlugin.scala:21`, `ModelTelemetry.scala:149-153`; unknown owners are rejected with `model-telemetry-invariant` in `begin` and `snapshot` (`ModelTelemetry.scala:171-175,204-206`); used by every annotation and embedding request and by the usage view (`Models.scala:42,73-74`, `ProblemPassageHttp.scala:51`, `McpTestModel.scala:167`, `ModelUsageView.scala:9`) | **Configuration-only assumption that breaks imperative owners** (indexing, embedding-backed search, usage view). Must change (unit CH0). |
| Chronicle: MCP test-run owner allowlist | `McpRuntimeResources.scala:9`, `McpTestRuns.scala:75-88,108` | **Configuration-only assumption**; redundant with the live check that follows it (`McpTestRuns.scala:109` → `RunAuthorization.scala:21-30`, which revalidates the browser session and the security epoch). Must be removed (unit CH0). |
| Haystack: directory for every account operation | `haystack/.../auth/AccountService.scala:18,21,35,42,53,69,78` | Must receive the merged directory. |
| Haystack: reconciliation | `AccountService.scala:15`, `Main.scala:46,53` | Stays declarative-only (§4.8.5). |
| Haystack: user lookup for account views | `Auth.scala:50`, `AccountService.scala:43,60` | Must resolve imperative ids. |
| Haystack: configured tokens and digests | `Auth.scala:51-58,96-106`, `AccountService.scala:60,77` | Declarative by design; an imperative user has none. |
| Haystack: validation | `Auth.scala:63-65,85-95` | Declarative validation; gains `admin`. |
| Haystack: retrieval audience | `haystack/.../retrieval/HaystackRetrieval.scala:56,62` | Already a single constant principal (`"authenticated"`); unaffected. |
| Manure: validation and startup hash checks | `manure/.../Auth.scala:43-52,59-64`, `Config.scala:70,100-108` | Declarative validation; gains `admin`. |
| Manure: configured token authentication | `Auth.scala:65-78,105-107` | Declarative by design. |
| Manure: directory snapshot + reconciliation on every authentication | `Auth.scala:79-103`, used by `Accounts` (`Auth.scala:149-191`) | Reconciliation stays declarative-only; the snapshot returned to callers is the merged directory. |
| Manure: owner-key mapping | `Auth.scala:124-131` | Operates on the directory it is given; works for the merged directory. |
| Manure: search audience | `manure/.../Search.scala:46-49` (publication), `Search.scala:98` (query principal); enforced by `shared/retrieval-postgres/.../PostgresRetrieval.scala:216` | **Configuration-only assumption that excludes imperative users from search.** Must change (unit M0). |
| Manure: dependency binding | `manure/.../plugins/ManurePlugin.scala:29` | Wiring only. |

No other production use was found. Everything else that depends on users reads the database at request time (Chronicle `ch_users` joins — e.g. `Database.scala:81`, `Search.scala:113`, `Activity.scala:70`) or the live account check (Manure `auth.live`, Haystack `accounts.resolve`).

---

## 3 Requirements and decisions in force

Requirements derived from the owner's original text:

| # | Requirement |
|---|---|
| R1 | Self-signup, enabled by configuration; no confirmation e-mail. |
| R2 | One page: username, e-mail, password, TOTP setup. |
| R3 | TOTP is not required for login by default; it confirms identity during password recovery; a user may opt in to mandatory TOTP at login. |
| R4 | E-mail is editable; username is not. |
| R5 | Admins can enroll new users, enabled by configuration. |
| R6 | The admin flag can be set declaratively; an admin can set it on an imperative user; a declaratively set flag cannot be removed. |

Owner decisions (binding). They are numbered O1–O8; C-numbers elsewhere in this document always denote the reviewer findings of §0.3.

| # | Decision | Where it lives |
|---|---|---|
| O1 (Q78) | Accounts stay per service; one shared implementation, three independent signups. | Shared core + per-service tables; the user store is behind `ImperativeUserRepository` (§4.8). |
| O2 (Q79) | Admin enrollment issues a one-time enrollment link/code; the invitee sets password and TOTP. The same mechanism is the admin reset for an imperative user who lost both factors; a declarative user is repaired in configuration. | §4.4 |
| O3 (Q80) | TOTP setup is mandatory at signup; TOTP at login only after opt-in; turning the opt-in off requires a TOTP code; recovery = username + TOTP + new password, revokes browser sessions, API tokens stay; per-account and per-address limits; single-use time steps. | §4.2, §4.5, §4.7 |
| O4 (Q80) | E-mail is a stored, editable, unverified contact attribute; username is the immutable login. | One column; no logic depends on it. |
| O5 (Q80) | Declarative users keep config-owned credentials: no password change, recovery or TOTP management in the UI. | Every self-service operation begins with "target is imperative" (§4.5). |
| O6 (Q80) | Self-signed-up users get the rights of a regular non-admin human user of that service. | Active imperative users enter the directory as `userType = "human"`. Consequences: §8.3. |
| O7 (Q83) | `signup.requireApproval`, default true: a self-signed-up account has password and TOTP set but is not active until an admin approves it. | §4.1.2, §4.3, §4.6.2 |
| O8 (Q84) | Manure self-signup is allowed in `path` content mode; the risk is documented. | §8.4, §8.5 |

Orchestrator decisions: see §0.2 (master switch `accounts.enable`; encrypted TOTP secrets; browser-generated secret; declarative accounts not promotable; disable-only; backoff only with split counters; no recovery opt-out; HM `operator.admin` default true; declarative admin required when enrollment or approval is on; K1 deferred; client address in security events).

Scope from the brief: only Chronicle, Haystack and Manure (not `rites`, `ontology`).

Assumptions of this design:

| # | Assumption | Reason |
|---|---|---|
| A8 | Usernames are public identifiers, not secrets. | Signup without e-mail is an inherent existence oracle; Haystack shows author ids and Chronicle invitations use ids already. |
| A9 | Account and user management stays browser-session-only (never bearer tokens). | Existing rule **[O]** `shared/service-auth/README.md:31-32`. |
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
  status         text NOT NULL CHECK(status IN ('pending','active','disabled')),
  email          text NOT NULL CHECK(length(email) BETWEEN 3 AND 254),
  password_hash  text NOT NULL,                       -- ponygirls.auth.Password format
  totp_key_id    text NOT NULL,                       -- vault key identifier
  totp_nonce     bytea NOT NULL,                      -- 12 bytes
  totp_secret    bytea NOT NULL,                      -- AES-256-GCM(20-byte secret) incl. 16-byte tag
  totp_last_step bigint NOT NULL,                     -- highest accepted RFC 6238 time step (shared by all paths)
  totp_required  boolean NOT NULL,
  admin          boolean NOT NULL,
  password_failures integer NOT NULL, password_failed_at timestamptz,   -- /login password step
  totp_failures     integer NOT NULL, totp_failed_at     timestamptz,   -- codes checked after a correct password or inside a session
  recovery_failures integer NOT NULL, recovery_failed_at timestamptz,   -- /recover
  created_at     timestamptz NOT NULL,
  created_via    text NOT NULL CHECK(created_via IN ('signup','enrollment')),
  created_by     text,                                -- enrolling admin; NULL for signup
  approved_by    text, approved_at timestamptz,       -- set when a pending signup is approved
  credentials_at timestamptz NOT NULL,                -- last password or TOTP replacement
  updated_at     timestamptz NOT NULL,
  CHECK(status <> 'pending' OR NOT admin));

CREATE TABLE ponygirls_imperative_enrollments(
  id         text PRIMARY KEY,                        -- public handle 'enrollment-<uuid>'
  digest     text NOT NULL UNIQUE CHECK(digest ~ '^[0-9a-f]{64}$'),
  username   text NOT NULL UNIQUE,                    -- at most one pending enrollment per username
  kind       text NOT NULL CHECK(kind IN ('invite','reset')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL);
```

A lock is not stored: it is derived from a counter and its timestamp (§4.7). No row exists for a half-created account. Imperative accounts have **no row in `ponygirls_account_users`** (the fingerprint table of the declarative directory) — §4.8.5.

#### 4.1.2 Status (v2)

| Status | Created by | In the directory | Can authenticate | Leaves by |
|---|---|---|---|---|
| `pending` | signup while `requireApproval` is true | no | no (answers as a nonexistent account) | approve → `active`; reject → **row deleted** |
| `active` | signup without approval; redemption of an invitation; approval | yes (`enabled = true`) | yes | disable → `disabled` |
| `disabled` | admin action on an active account | no | no | enable → `active` |

- A pending account holds its username (signup and enrollment for that name answer `username-unavailable`) and counts toward `signup.maxUsers` and the hard ceiling.
- A pending account cannot log in, cannot recover (no session, no credential change, no counter change), has no session and no token, and is absent from the directory, so no service API accepts it. Externally it is indistinguishable from a nonexistent account on `/login` and `/recover` (§4.3, enumeration posture); the signup response is the only place that says "pending".
- Reject deletes the row. Reason: a pending account never held authority and no service data is keyed by its id (it was never projected into `ch_users`, never in a directory), so the reuse hazard behind "names are never reused" (D2) does not exist; keeping rejected rows would let rejected or spam applications consume names and cap slots permanently. The rejection is recorded as an audit event. Names of accounts that were ever `active` stay reserved for ever.
- Pending applications do not expire; an admin rejects them. (A time limit would be one more constant; it was not requested.)
- `disabled` keeps the v1 meaning (administrative, reversible, data and name retained).

#### 4.1.3 Identity and namespace (v2)

- `id` = username = login; display name = username; `userType` is always `human`.
- Policy constants (one object in the shared module): username `^[a-z][a-z0-9_-]{2,31}$`; reserved names `admin, administrator, root, operator, agent, system, support, security, service, anonymous, null, undefined, me, self` plus `accounts.reservedUsernames`; password 12–1024 UTF-16 units, not equal to the username or e-mail (case-insensitive), no composition rules; e-mail 3–254 characters, exactly one `@`, non-empty local part and domain, no whitespace or control characters, stored as submitted.
- The policy satisfies every service's id rules: Haystack (no whitespace, no `:`, ≤ 128 — `haystack/.../Auth.scala:84`), Chronicle (non-empty text), Manure (arbitrary).

**Name availability.** All of the following are evaluated inside the creating transaction, under the directory lock, after deleting expired enrollments. A name is unavailable (`409 username-unavailable`) when any holds:

1. it is a reserved name;
2. its lower-case form equals the ASCII-lower-cased form of a **currently declared** id or login;
3. it is a **retained historical identity** of the service — `IdentityHistory.retained(name)`, a service port (§4.8.3):
   - shared part (Haystack, Manure): a row exists in `ponygirls_account_users` for the owner key of the name (live or tombstoned);
   - Haystack: the name occurs as `write_requests.principal_user`, `items.created_by`, `items.modified_by` or `item_revisions.modified_by`;
   - Manure: the name occurs as `manure.artifacts.created_by_user`;
   - Chronicle: any `ch_users` row has `lower(id)` or `lower(login)` equal to the name (this covers current, disabled and removed declarative users; every Chronicle owner reference is a foreign key to `ch_users`);
4. an imperative row with that id exists, in any status;
5. for signup only: a live pending **invitation** exists for the name.

Which operation applies which rule:

| Operation | Rules | Notes |
|---|---|---|
| Signup | 1–5 | |
| Issue invitation | 1–4 | a pending invitation for the same name is **replaced** (create-or-replace, safe to retry) |
| Issue reset | target is an existing `active` imperative account | a pending reset for it is replaced; a disabled account is enabled first |
| Redeem invitation, approve pending signup | 2–3 again (configuration or data may have changed since issuance/signup) | on failure the invitation/application stays; the admin revokes/rejects it |

The checks in rule 3 are equality lookups; the Haystack item tables have no index on the author columns, so a signup performs sequential scans of `items`/`item_revisions` (signups are rate-limited to tens per hour; acceptable **[I]**). Case-insensitive comparison is used where the store holds plain text (declared names, `ch_users`, Haystack fingerprints); Manure's fingerprint keys are digests, so the comparison there is exact — sufficient, because adoption is possible only for the identical id.

**Never adopt.** Creation writes are insert-only: the imperative row is `INSERT`ed (primary key), and Chronicle's projection of a newly active account is a plain `INSERT INTO ch_users` — a primary-key or `login` conflict aborts the transaction as `username-unavailable`. Nothing in this design upserts into `ch_users` or `ponygirls_account_users` on behalf of an imperative account.

**Collision introduced by configuration.** When loading the directory (startup, Haystack reload, and every merged-directory read), an `active` or `disabled` imperative id that equals, case-insensitively, a declared id or login is a configuration fault (`AccountFailure("config")`): Haystack rejects every request as `unavailable` until configuration is corrected (`haystack/.../Main.scala:53`); Manure and Chronicle fail startup. The check runs **with the master switch on or off**, because the rows and their tokens exist either way. A `pending` row never causes the fault; it merely becomes unapprovable. The operator resolves a collision by choosing another declarative id/login.

Login lookup: exact match on declarative logins first (unchanged, `Accounts.scala:78`, restricted to declarative entries), then imperative lookup on the ASCII-lower-cased input.

#### 4.1.4 Admin flag

- `effectiveAdmin(user) = declared.admins.contains(user.id) || (row.status == active && row.admin)`, evaluated from the live directory inside each admin transaction; nothing is cached.
- Declarative `admin = true` requires `type = human` and a browser login (A9).
- API rules: the target must be imperative (`403 forbidden` otherwise, both directions) and not `pending`; actor ≠ target for `admin` and `enabled` changes. A declarative non-admin cannot be promoted imperatively.
- No last-admin counter: every demotion/disable is executed by an admin on a *different* account, so the actor remains an admin. Configuration is the break-glass path.
- Changing the flag needs the actor's current password (§4.6.3).

#### 4.1.5 Disabling

Disabling an imperative user (admin action), in one transaction under that owner's lock: status `disabled`; all its browser sessions are deleted; Haystack/Manure: its issued API tokens are marked revoked (the existing semantics for a disabled declarative owner — `haystack/docs/auth.md:34-36`); Chronicle: the projection row gets `enabled = false`, which gates its tokens and hides its archive from group members (`chronicle/.../Database.scala:81`), as for a disabled configured user; its pending reset enrollment is deleted. Data and the username are retained. Re-enabling restores login with the unchanged password and TOTP; Haystack/Manure tokens must be issued again.

This explicit revocation applies to an administrative disable only. Suspension by the master switch revokes nothing (§6.5).

### 4.2 TOTP

#### 4.2.1 Parameters

RFC 6238 with HMAC-SHA1, 6 digits, X = 30 s, T0 = 0; secret = 20 random bytes; text form = RFC 4648 base32 without padding (32 characters). Provisioning URI:

```
otpauth://totp/{issuer}:{username}?secret={base32}&issuer={issuer}&algorithm=SHA1&digits=6&period=30
```

`issuer` comes from configuration (default: service name and public host, e.g. `Haystack (memory.example.net)`), so the three per-service entries are distinguishable in an authenticator. Worst-case URI length ≈ 195 bytes → QR version ≤ 10 at error-correction level M.

Reference vectors for tests: secret `12345678901234567890`, time 59 → `287082`; time 1111111109 → `081804` (RFC 6238 Appendix B truncated to 6 digits; recomputed with a throwaway script, not committed).

#### 4.2.2 Secret generation and provisioning

The browser generates the 20 bytes with `crypto.getRandomValues`, renders the QR code and the base32 text (manual entry is always offered), and submits `totpSecret` (base32) with `totpCode`. The server requires a canonical 32-character base32 string decoding to exactly 20 bytes and a code that verifies for the current window. Rationale: the secret is shared between the user's authenticator and the server whichever side generates it; a client-chosen secret has the same trust model as the client-chosen password in the same request.

QR rendering is client-side (matrix in the DOM-free client module, DOM `<svg>`/`<canvas>` nodes in the view). Constraint from Manure's CSP **[O]** (`style-src 'self'`, no `img-src data:`): no inline `style`, no `data:` URL.

#### 4.2.3 Verification and replay protection

```
verify(secret, code, now, lastStep):
  T = floor(now / 30)
  for step in [T-1, T, T+1] with step > lastStep:
     if constantTimeEquals(hotp(secret, step), code): return Accepted(step)
  return Rejected
```

On `Accepted(step)` the row's `totp_last_step` is set to `step` in the same transaction, under the account's owner lock. `totp_last_step` is **shared by every path** (login, recovery, settings), so a code is usable once overall. At creation it is initialised to the step that proved possession. Clock skew: ±1 step (A11); no drift learning.

#### 4.2.4 Storage at rest

`TotpVault` (modelled on `rites` `Vault`): AES-256-GCM, fresh 12-byte nonce per encryption, AAD `ponygirls-totp-v1 \0 {service} \0 {userId}`, key = 32 bytes read from `accounts.keyFile` (base64url, via `BoundedSecretFile`), `keyId` stored per row.

Weighing: the key file adds one runtime secret per service and one failure mode (lost key). Against that, TOTP is the sole recovery factor, so a plaintext secret would turn any read of the database or of a `pg_dump` backup (`nix/nixos/haystack.nix:273-294`, `nix/hm/chronicle-server.nix:136-147`) into password reset for every imperative account, including imperative admins.

When a row cannot be decrypted (wrong/lost key): TOTP operations for that user return `503 unavailable` (never "valid", never "invalid code"); password login without mandatory TOTP keeps working; the admin list reports `totpState = "unavailable"`; a `reset` enrollment re-keys the account. Startup logs the number of rows whose `totp_key_id` differs from the loaded key. Key rotation is not provided; `totp_key_id` is recorded so a later multi-key reader needs no schema change.

#### 4.2.5 Brute-force resistance (v2: per path)

A guess succeeds with probability 3 × 10⁻⁶ (three accepted steps). Both TOTP counters (§4.7) use the same schedule: the first five consecutive failures are answered immediately; from the fifth on, each failure locks that path for `min(24 h, 15 min × 2^(failures−5))`. A TOTP counter is **not** cleared by a successful code; it lapses after 7 days without a failure on that path and is cleared when credentials are replaced.

| Path | Who can reach it | Guesses possible: 1 day / 30 days / 1 year | Success probability |
|---|---|---|---|
| `/recover` (recovery counter) | anyone who knows the username | 11 / ≈ 47 / ≈ 530 | 3.3 × 10⁻⁵ / 1.4 × 10⁻⁴ / 1.6 × 10⁻³ |
| Second login step and in-session code checks (TOTP counter) | only a party that already presents the correct password (or holds a session) | same schedule: 11 / ≈ 47 / ≈ 530 | same; conditional on the password already being compromised |

The yearly figure is the attacker's optimum under the lapse rule (twelve guesses, then seven quiet days, repeated ≈ 1.44 guesses/day; computed, not measured); a steady one guess per 24 h gives 375. Because a legitimate success does not clear the counter, the bound does not depend on how often the real user authenticates. Each lock is an audit event and the account shows `locked` in the admin list.

#### 4.2.6 TOTP for declarative users later

It would need: a table keyed by declarative id holding the encrypted secret, `last_step`, `required` and a TOTP counter; an authenticated set-up operation (the config-owned password as proof); cleanup when the id leaves configuration. The login hook of §4.5.1 is generic. Recovery would remain impossible because the hash is config-owned. Not designed further.

### 4.3 Signup (v2)

Request (unauthenticated; master on and `signup.enable`):

```json
POST /api/account/v1/signup
{"username":"…","email":"…","password":"…","totpSecret":"<base32, 32 chars>","totpCode":"123456","requireTotp":false}
```

Processing order:

1. Service boundary: exact Host/Origin as for login, no bearer, strict JSON (existing per-service code).
2. Per-address admission and credential gate (§4.7) — outside any transaction.
3. Pure validation: username pattern, e-mail, password policy, secret shape, code shape → `400 invalid`, `400 weak-password`.
4. TOTP proof → `400 totp-mismatch` if the code does not verify for the submitted secret. Pure; no state.
5. Password hash (PBKDF2) — before taking any lock.
6. One transaction: directory lock → delete expired enrollments → name availability (§4.1.3; `409 username-unavailable`) → `count(imperative rows of any status) < signup.maxUsers` and below the hard ceiling (`403 forbidden` when full) → insert the row (`created_via = 'signup'`, `totp_last_step` = proving step) with
   - `status = 'pending'` when `signup.requireApproval` is true: nothing else happens;
   - `status = 'active'` otherwise: service activation hook (Chronicle: insert the projection and its owner target; Haystack/Manure: nothing) → establish a browser session.
7. Response:
   - approval mode: `202 {"status":"pending"}`; **no cookie is set**, and a presented session cookie is left untouched;
   - otherwise: `200 {"status":"active","user":{id,login,displayName,actor}}` with the session cookie.

Atomicity: the row and (when active) the projection and session commit together or not at all. A lost response is safe to diagnose: a retry answers `username-unavailable`.

Abuse controls: per-address request limit, per-address and global creation limits, global PBKDF2 gate, `signup.maxUsers` (default 100) counting rows of every status, a hard ceiling of 1000 imperative rows per service. In approval mode a flood can at most fill the cap with pending rows, which an admin clears by rejecting them. No CAPTCHA (no external services).

Approval: see §4.6.2. The applicant receives no notification (no e-mail is ever sent); the applicant learns of approval by being able to sign in.

Enumeration posture (A8): signup necessarily reveals whether a username is taken (pending, active and disabled alike). `/login` and `/recover` answer wrong username, wrong password, wrong code, **pending**, disabled and (for recovery) declarative targets with the same `401 unauthorized` after the same work in every case (login: one PBKDF2 verification, against a dummy hash when the account is absent or not active; recovery: one HMAC computation, against a dummy secret likewise). A *locked* active account answers `429 rate-limited`, which reveals its existence after the free attempts are spent. Accepted under A8.

### 4.4 Enrollment (v2)

| Property | Design |
|---|---|
| Format | `code` = 32 random bytes, base64url without padding (43 characters, the existing `Secrets.generate` format — `Account.scala:36-49`). |
| Storage | `digest = SHA-256(code)` only (uniformly random 256-bit value; same reasoning as API tokens — `haystack/docs/auth.md:23-25`). |
| Link | `{origin}/#account-enroll={code}`, composed by the admin view from `window.location.origin`. The fragment never reaches a server or proxy log. The shared client captures and removes it (`history.replaceState`) at module evaluation, before the host application's hash router runs. |
| Expiry | `enrollment.ttlSeconds`, default 86 400 (Chronicle invitations: 24 h — `chronicle/.../Auth.scala:179`), allowed 300–604 800. **Every operation that reads or writes enrollments, and every signup, first deletes expired rows under the directory lock**, so an expired row never reserves a name. |
| Single use | The row is deleted in the transaction that creates or resets the account. |
| Issue | Admin `POST /admin/enrollments {username}` (kind `invite`; name availability rules 1–4 of §4.1.3) or `POST /admin/users/{id}/reset {currentPassword}` (kind `reset`; target an `active` imperative account other than the actor — a self-reset would bypass the old-authenticator requirement of §4.5.3). Under the directory lock, an existing pending row for the same username is **replaced** — repeating a request whose response was lost is safe, and the previous code stops working. The response returns the code once. |
| Inspect | `POST /enrollments/inspect {code}` → `{username, kind, expiresAt}`; unknown, expired and revoked codes are all `404 not-found`. |
| Redeem | `POST /enrollments/redeem {code, email?, password, totpSecret, totpCode, requireTotp}`; `email` is required for `invite` and forbidden for `reset`. Same validation, proof and transaction as signup; the account is `active` immediately (admin-vetted, no approval step); exempt from `signup.maxUsers` but not from the hard ceiling; `created_via = 'enrollment'`, `created_by` = issuing admin. Name rules 2–3 are re-checked. |
| Reset semantics | Existing credentials stay valid until redemption. Redemption replaces password hash and TOTP secret, clears all three counters, revokes all browser sessions, keeps issued API tokens, keeps e-mail and admin flag, and establishes a session. Disabling the account deletes its pending reset, so a reset is only ever redeemed for an active account. A suspected compromise is handled by disabling. |
| Revoke / list | `POST /admin/enrollments/{id}/revoke`, `GET /admin/enrollments` (never returns codes or digests). Disabling a user deletes its pending reset. |
| Availability | Issuance, inspection, redemption, listing and revocation exist only with `enrollment.enable` (and the master). With enrollment off, no admin reset exists; the operator can turn it on to issue one. |

### 4.5 Login, recovery and self-service

All self-service operations apply to `active` imperative users only (O5); for a declarative session they answer `403 forbidden`, and the profile response tells the view not to offer them.

#### 4.5.1 Login

`POST /login` accepts `{login,password}` (unchanged) or `{login,password,totp}`.

```
declared exact match              → existing loginReplacing path, unchanged (totp ignored)
else imperative row (folded name) → lock owner(s)
    missing, pending or disabled  → one dummy PBKDF2, 401 unauthorized            (no counter)
    password locked               → 429 rate-limited (Retry-After)
    password wrong                → password failures+1 (commit), 401 unauthorized
    password right                → clear password counter, then
      totp_required = false       → establish session
      totp_required = true:
        totp absent               → 401 totp-required                             (no TOTP counter change)
        TOTP locked               → 429 rate-limited
        totp wrong / replayed     → totp failures+1 (commit), 401 unauthorized
        totp right                → last_step := step, establish session          (TOTP counter not cleared)
```

The two-step exchange is stateless: after `totp-required` the client resubmits all three values, and the password is verified again. No half-authenticated state exists on the server.

**Returned-rejection rule (D27)** **[O]**: the shared transaction engine rolls back when the callback throws (`shared/service-runtime/src/main/scala/ponygirls/runtime/JdbcTransactionEngine.scala:35-46`). Every outcome that must persist a counter is therefore a **value** returned from the transaction and converted to an error response after commit. This binds:

- the shared dispatcher (`AccountReply` with a non-2xx status is a normal return value; an adapter must not turn it into an exception inside the transaction);
- Haystack `AccountService.login` (today `IO[SignedIn]`, throwing — `AccountService.scala:39-45`);
- Manure `Accounts.login` (today a tuple, throwing — `manure/.../Auth.scala:153-158`);
- Chronicle `Auth.login` and `Auth.accountLogin` (today tuples, failing through `Check` inside `db.transaction` — `chronicle/.../Auth.scala:10-24`) and both routes that call them (`chronicle/.../Http.scala:61-69,100-104`).

Each of these changes its result type to a decision (`Established | Rejected(code, retryAfter)`); the declarative branch may keep throwing, because it persists nothing.

Chronicle's legacy `POST /api/login` cannot carry a code: for an imperative user with `totp_required` it answers `unauthorized`; otherwise it goes through the same shared verification. Chronicle's existing login SQL (`Auth.scala:13`) additionally excludes ids present in the imperative table, so an imperative account can never be authenticated by the legacy statement. Haystack's and Manure's legacy logins already reject everything.

#### 4.5.2 Recovery

`POST /recover {username, totp, password}` (unauthenticated; exists whenever the master switch is on).

Pure password policy first (length; not equal to the submitted username) → `400 weak-password`, independent of whether the account exists. Then: lock owner → `active` imperative user? (otherwise one dummy HMAC, `401`) → recovery counter not locked (`429`) → verify code (failure: **recovery** failures+1, committed, `401 unauthorized`) → password ≠ stored e-mail (failure: `400 weak-password`, nothing consumed) → new hash, `totp_last_step := step`, clear all three counters, delete all browser sessions, keep tokens → establish session → `200 {user}`.

The PBKDF2 of the new password is computed only after a valid code. Recovery failures never touch the password or TOTP counters, so `/recover` cannot be used to block login.

#### 4.5.3 Self-service operations (session + `X-Account-Actor`) (v2)

| Operation | Fresh proof required | Effect |
|---|---|---|
| Change e-mail | none (the e-mail has no security function) | update column |
| Change password | current password | new hash; all *other* sessions deleted; the current one is replaced by a fresh session cookie |
| Replace TOTP secret | current password + proof of the new secret (`totpSecret`, `totpCode`); **while `totp_required` is true, additionally a current code from the old authenticator (`currentTotp`)** | new encrypted secret, `last_step` := proving step, TOTP and recovery counters cleared |
| Enable "require TOTP at login" | current TOTP code | flag set; **all other sessions of the account are deleted in the same transaction** |
| Disable "require TOTP at login" | current TOTP code (O3) | flag cleared |

Mandatory-TOTP invariant (D23): while `totp_required` is true, (a) every live session of the account was established with a TOTP proof or is the session that presented the code when the flag was set, and (b) the secret can be replaced only by a party that presents a code from the current authenticator *now*. This closes the path found in review: a session obtained with a stolen password before the opt-in can no longer replace the secret (it is deleted at opt-in, and replacement needs the old authenticator anyway).

Consequences, stated plainly:

- With mandatory TOTP on, a lost authenticator cannot be replaced by the user, even from a live session. The path is an admin reset (§4.4), which exists only where `enrollment.enable` is on and an admin is available; the settings view must say so before the user opts in.
- Without mandatory TOTP, password + session suffice to replace the secret, because the password alone already grants full access.
- The toggle does not ask for the password: the session required it, and the code is the factor a session thief lacks.

Wrong current password / code in these operations feed the password / TOTP counters. A consumed code advances `totp_last_step`.

### 4.6 Admin operations, authorization, audit

#### 4.6.1 Authorization

In order, inside one transaction: account boundary (Host/Origin, cookie only) → live session → `X-Account-Actor` equals the session owner → locks per §4.8.6 (directory lock if names are involved; actor and target owners in the defined order) → `effectiveAdmin(actor)` from the live directory → fresh proof where required → target rules → effect → service hook for the one changed user.

Availability: user management (list, approve, reject, enable/disable, admin flag) exists whenever the master switch is on — an operator who turns signup off still has pending applicants and existing users to manage. Enrollment and reset operations exist only with `enrollment.enable`.

#### 4.6.2 Approval (v2)

- `GET /admin/users` lists pending applicants with `status: "pending"`, username, e-mail, `createdAt`.
- `POST /admin/users/{id}/approve {}`: directory lock → target is `pending` → name rules 2–3 of §4.1.3 again (`409 username-unavailable` if configuration or data now claims the name; the admin then rejects) → `status := active`, `approved_by`, `approved_at` → service activation hook (Chronicle: insert projection) → `{ok:true}`. No session is created for the applicant; the applicant signs in normally.
- `POST /admin/users/{id}/reject {}`: directory lock → target is `pending` → delete the row → `{ok:true}`.
- Approval is always an explicit action by an effective admin. The server contains no rule that approves or prefers an applicant based on the e-mail (no domain allowlist, no auto-approval). The e-mail and the username are self-asserted; the behavioural contract for the view (§4.9) requires them to be presented as unverified, and deployment documentation must tell admins to confirm an applicant's identity out of band.
- No fresh password is required to approve or reject (§4.6.3).

#### 4.6.3 Fresh proof for admin operations (v2)

Two operations require the acting admin's **current password** in the request body (`currentPassword`):

| Operation | Why |
|---|---|
| `POST /admin/users/{id}/admin` (grant or revoke) | Granting creates an administrator. |
| `POST /admin/users/{id}/reset` | Whoever redeems the code controls the target account, which may be an administrator. |

Verification works for both admin kinds: a declarative admin's password is checked against the config-owned hash in the directory; an imperative admin's against its row (feeding its password counter). Failures answer `403 proof-rejected`. Failed proofs by a declarative admin, which have no persistent counter, are bounded by the in-memory limiter (5 failures per 15 minutes per actor → `429`).

What this achieves, and its limit: a script that runs on the service origin with an admin's session (XSS; uploaded content in Manure path mode) cannot, without interaction, create an administrator or take over another account, because it does not know the password. It does **not** stop a script that can observe the dashboard document while the admin types the password (for example through a window reference on the same origin); no server-side proof can.

Operations deliberately left without a fresh proof — approve, reject, issue/revoke invitation, enable/disable: they create or affect only regular accounts. A script holding an admin's session can already do everything a regular account can (it can issue an API token for the admin through the existing token endpoint), so a password prompt there would protect no additional authority while training admins to type their password for routine actions.

#### 4.6.4 Audit events **[P]**

Emitted by the adapter after commit through the service's existing logger (Haystack structured stdout events `haystack/.../Http.scala:228-239`; Chronicle `logstage`; Manure its request log), with a fixed field allowlist `event, actor, target, outcome, clientAddress` and never any secret, e-mail, code or request body:

`account.signup` (outcome `active` or `pending`), `account.approved`, `account.rejected`, `account.enrollment.created|revoked|redeemed`, `account.reset.issued|redeemed`, `account.recovery.succeeded|rejected`, `account.locked` (path), `account.password.changed`, `account.totp.replaced`, `account.totp.required-changed`, `account.email.changed`, `account.admin.granted|revoked`, `account.enabled|disabled`, `account.proof.rejected`.

`clientAddress` is a new logged field; Haystack's per-layer logging allowlist (`haystack/docs/auth.md:153-160`) must be extended explicitly for these events.

### 4.7 Throttling (v2)

Per-account counters (persistent, on the row). `lock(counter) = failures ≥ threshold ? failed_at + min(cap, base × 2^(failures − threshold)) : none`.

| Counter | Incremented by | Threshold / base / cap | Cleared by |
|---|---|---|---|
| password | wrong password on `/login`; wrong `currentPassword` in an imperative user's self-service or admin-proof request | 10 / 1 min / 15 min | a correct password on any of these paths; recovery; reset redemption |
| recovery | wrong code on `/recover` | 5 / 15 min / 24 h | 7 days without a recovery failure; successful recovery; TOTP replacement; reset redemption |
| TOTP | wrong code in the second login step (after a correct password) or in a session (toggle, replacement) | 5 / 15 min / 24 h | 7 days without such a failure; successful recovery; TOTP replacement; reset redemption — **not** by a successful code |

`totp_last_step` (single use of a time step) is shared by all paths.

Other layers:

| Layer | Key | State | Policy |
|---|---|---|---|
| Client address | resolved client address × endpoint class | in memory, bounded map (as Manure's `Throttle`) | credential endpoints (login, recover, signup, inspect, redeem): 10 requests/minute; successful signups: 5/day |
| Admin proof (declarative actors) | actor id | in memory | 5 failed proofs / 15 min |
| Global | — | in memory | successful signups: 20/hour; PBKDF2 work on unauthenticated endpoints: 2 concurrent, bounded wait queue of 16, otherwise `503 unavailable` (Chronicle's `Semaphore(2)` generalised) |

Client address **[P]**: `ClientAddress.resolve(socketPeer, xForwardedFor, trusted)` — when the socket peer is trusted (loopback for Haystack/Chronicle, `trusted_proxies` for Manure), the right-most `X-Forwarded-For` element is the client address; otherwise, or when the header is absent, the socket peer is. An absent header behind a proxy makes all clients share one bucket: stricter, never weaker.

Scope: per-account counters exist for imperative accounts only (no behaviour change for declarative users). The address and global layers apply to the listed endpoints, including `/login`, only when the master switch is on; with it off, `/login` is handled exactly as today. The absence of any login limiter in Haystack and the uncovered account login path in the Chronicle HM proxy (§2.6) are existing conditions, reported, not changed.

**Residual denial of service — what an anonymous caller who knows a username can do to that imperative user:**

| Endpoint | Effect on the victim | Not affected |
|---|---|---|
| `POST /login` with wrong passwords | After 10 consecutive failures, new password logins are refused while locked; one further bad attempt every 15 minutes keeps it locked indefinitely. This applies to users with and without mandatory TOTP. | Existing sessions and API tokens (sessions do not expire); recovery — which, when it succeeds, clears the password lock and signs the user in. |
| `POST /recover` with wrong codes | Recovery is refused while locked; one bad attempt per 24 h keeps it locked indefinitely. | Login, including the second login step of a mandatory-TOTP user (separate counter); sessions; tokens. |
| Both together | The victim can establish no *new* browser session by self-service for as long as the attack lasts. The remedy is an admin reset (only with `enrollment.enable`), or outlasting the attack. | Existing sessions and tokens; every other account; all declarative accounts. |
| `POST /signup`, `/enrollments/*` | None on existing users. | — |

The second login step cannot be locked anonymously: reaching it requires the correct password. A party that does know the password can lock it (and thereby a mandatory-TOTP user's login) — at that point the password is compromised and locking is the intended failure mode; recovery (which replaces the password and clears the counters) is the way out.

### 4.8 Sharing strategy, store interface, reconciliation and locks

#### 4.8.1 Placement

Compared placements: (a) logic inside each service next to its routes — three copies of TOTP, lockout, enrollment, approval and policy; (b) a shared core that owns *credentials and identity state* but not sessions or HTTP — matches the module's stated boundary (§2.1) and Chronicle's separate session store; (c) a shared core that also owns sessions — would force Chronicle onto the shared session tables. **Chosen: (b).**

#### 4.8.2 Changes to existing shared code (`Accounts`, `AccountUser`) (v2)

- `AccountUser` gains `origin: AccountOrigin` (`Declarative | Imperative`). Eight construction sites exist (three production, five test) **[O]**.
- `Accounts.current(user)`: unchanged for declarative entries (stored fingerprint equals the directory entry); `true` for imperative entries, whose authority is the live row the caller read in the same transaction.
- `Accounts.login` / `loginReplacing` select among **declarative** entries only; an imperative account can be authenticated only by the imperative core (counters, TOTP).
- `Accounts.establish(users, userId, previous)`: session creation for an already-verified user, extracted from `login`/`loginReplacing` (`Accounts.scala:75-101`).
- `Accounts.revokeSessions(owner, keep)` and `revokeTokens(owner)`: targeted, under that owner's lock.
- `Accounts.reconcile(users)` — see §4.8.5.
- One lock helper implementing §4.8.6, used by `loginReplacing` and by the imperative core.

#### 4.8.3 New code in `shared/service-auth` (package `ponygirls.auth`) **[P]**

```scala
// Totp.scala — pure
object Totp { def code(secret: Array[Byte], step: Long): String
              def verify(secret: Array[Byte], code: String, now: Instant, lastStep: Long): Option[Long]
              def decodeSecret(base32: String): Array[Byte] }           // exactly 20 bytes or AccountFailure("invalid")

// TotpVault.scala
final class TotpVault(key: SecretKeySpec, val keyId: String, service: String) { def seal(userId, secret): Sealed; def open(userId, sealed): Array[Byte] }
object TotpVault { def load(path: Path, service: String): TotpVault }

// ImperativeAccounts.scala — model, policy, repository seam, logic (no SQL, no HTTP)
final case class ImperativeSettings(service: String, signup: Boolean, requireApproval: Boolean, enrollment: Boolean,
  maxUsers: Int, enrollmentTtl: FiniteDuration, issuer: String, reservedUsernames: Set[String], vault: TotpVault)
  // exists only when the master switch is on: adapters hold Option[ImperativeSettings]
final case class DeclaredDirectory(users: Vector[AccountUser], admins: Set[String])
trait PasswordHasher { def hash(chars: Array[Char]): String; def verify(chars: Array[Char], encoded: String): Boolean }  // production: Password

private[auth] trait ImperativeUserRepository {            // the user store (O1)
  def lockDirectory(): Unit
  def users: Vector[StoredImperativeUser]
  def user(id: String): Option[StoredImperativeUser]
  def insertUser(row: StoredImperativeUser): Unit          // fails on an existing id
  def updateUser(row: StoredImperativeUser): Unit          // exactly one row
  def deleteUser(id: String): Unit                         // reject of a pending row only
  def enrollments: Vector[StoredEnrollment]
  def enrollmentByDigest(digest: String): Option[StoredEnrollment]
  def putEnrollment(row: StoredEnrollment): Unit           // replaces the pending row for the same username
  def deleteEnrollment(id: String): Unit
  def deleteExpiredEnrollments(now: Instant): Unit
}

trait AccountSessions {                                    // service-owned session/owner seam, same transaction
  def lockOwners(declarative: Vector[String], imperative: Vector[String]): Unit   // §4.8.6 order
  def establish(user: AccountUser, replaced: Option[String]): AccountSession
  def revokeSessions(userId: String, keep: Option[AccountCredential]): Unit
  def revokeTokens(userId: String): Unit                   // Haystack/Manure: mark issued tokens revoked; Chronicle: nothing (disabled-owner gate)
  def activated(user: AccountUser): Unit                   // Chronicle: INSERT ch_users + owner target; Haystack/Manure: nothing
  def updated(user: AccountUser): Unit                     // Chronicle: UPDATE ch_users (credential, enabled), exactly one row; Haystack/Manure: nothing
}
trait IdentityHistory { def retained(username: String): Boolean }   // §4.1.3 rule 3, service-owned

// ImperativeAccountSql.scala — PostgreSQL repository + connection-level facade (caller owns the transaction)
object ImperativeAccountSql {
  def initialize(c: Connection): Unit
  def installDeclared(c: Connection, declared: DeclaredDirectory)(reconcile: => Unit): Unit   // §4.8.5
  def directory(c: Connection, settings: Option[ImperativeSettings], declared: DeclaredDirectory): Vector[AccountUser]
  def authenticate(c: Connection, settings: ImperativeSettings, declared: DeclaredDirectory, sessions: AccountSessions,
                   login: String, password: String, totp: Option[String]): LoginDecision   // NotImperative | Verified(user) | Rejected(code, retryAfter)
}

// ImperativeAccountApi.scala — transport-neutral dispatcher for every NEW endpoint + JSON codec
final case class AccountRequest(method: String, path: String, body: Option[Json], actor: Vector[String],
  session: Option[AccountCredential], sessionSecret: Option[String], clientAddress: String)
final case class AccountReply(status: Int, body: Json, cookie: CookieEffect /* Keep | Set(secret) | Clear */,
  retryAfterSeconds: Option[Int], events: Vector[AccountEvent])
object ImperativeAccountApi {
  def handle(c: Connection, settings: Option[ImperativeSettings], declared: DeclaredDirectory,
             sessions: AccountSessions, history: IdentityHistory, request: AccountRequest): AccountReply }

// AttemptLimiter.scala — in-memory per-address/per-actor/global windows; plain synchronized state usable from blocking and IO code
```

`directory` returns the declared users plus the **active** imperative users (origin `Imperative`) when settings are present, the declared users alone when the master switch is off; in both cases it raises the collision fault of §4.1.3.

`SharedAccountSessions(c, ownerKey: String => String)` implements `AccountSessions` over the existing `Accounts` for Haystack (`ownerKey = identity`) and Manure (`ownerKey` = its digest mapping — `manure/.../Auth.scala:124`), and supplies the shared part of `IdentityHistory` (fingerprint table). Chronicle supplies its own implementations.

#### 4.8.4 What each service does

| Concern | Haystack | Manure | Chronicle |
|---|---|---|---|
| Boundary (Host/Origin/body/cookie) | existing `accountBoundary`, `Sessions` | existing `account()` / `context()` | existing `accountBoundary` |
| Config parsing | `auth.accounts`, `users[].admin` | `accounts`, `users[].admin` (closed key sets) | `accounts`, `users[].admin` |
| Directory for requests | `AccountService`: `auth.users` → `ImperativeAccountSql.directory(c, …)` at every use listed in §2.12 | `Auth.current(tx)`: reconcile the declared snapshot as today, return the merged directory | none per request: `ch_users` is the effective directory (declared ∪ projections); `DeclaredDirectory` for admin checks and the list comes from `config.users` |
| Declared-directory installation | startup and every reload: `installDeclared` | startup (`Accounts.initialize`): `installDeclared`; per-request reconcile unchanged (the declared set is static after start) | startup, inside `Database.initialize` |
| Sessions / owner locks | `SharedAccountSessions` | `SharedAccountSessions` with owner-key mapping | own: `ch_sessions`, `Sql.lock("mutation:<id>")` |
| Activation hook | — | — | `INSERT INTO ch_users(id, login, enabled, credential)` + `ch_owner_targets` (as startup does for configured users — `Database.scala:27,37`); a conflict aborts |
| Update hook | — | — | `UPDATE ch_users SET credential, enabled WHERE id` (exactly one row); delete the owner's sessions when the credential changed or the account was disabled |
| `IdentityHistory` | fingerprint table + author columns (§4.1.3) | fingerprint table (mapped key) + `created_by_user` | `ch_users` (id or login, any row) |
| Startup | `ImperativeAccountSql.initialize` after `AccountSql.initialize` (`Migrations.scala:32`) | same place as `AccountSql.initialize` (`Main.scala:151`) | in `Database.initialize`, in this order: initialize tables → collision check (declared against active/disabled imperative ids, before anything is written) → existing blanket disable and configured-user upsert → **update-only** refresh of projections of active imperative users when the master is on (`UPDATE ch_users … FROM ponygirls_imperative_users`; an active imperative row without a projection row is an invariant violation and fails startup) → existing session cleanup |
| Login | route calls the shared login decision; result type per D27 | same | `Auth.login(c, r)` asks `authenticate` first; `NotImperative` → existing statement, which excludes imperative ids |
| Routes | one catch-all for the new paths delegating to `ImperativeAccountApi.handle`, before the existing account 404 (`Http.scala:153`) | one branch in `account()` | one route group using the existing `loginGate` |
| Client address | socket peer + `X-Forwarded-For` when the peer is loopback | socket peer + `trusted_proxies` | as Haystack |
| Service-specific correction required by imperative owners | none found (§2.12) | search audience (unit M0) | telemetry and MCP owner registries (unit CH0) |

**CH0 — Chronicle owner registries.** `ModelTelemetry.make` no longer receives an owner set: a slice is created the first time a context is used (`begin`), and `snapshot` of an owner without slices returns empty windows instead of failing. Legitimacy of the owner is established upstream, where it already is: contexts are built from claimed jobs of enabled owners or from an authenticated identity (`Models.scala:73-74`, `ProblemPassageHttp.scala:51`, `McpTestModel.scala:167`, `ModelUsageView.scala:9`). `McpTestRuns` loses `configuredOwners`; `freshCaller` keeps the browser/scope checks and the live `authorization.capture`. Memory is bounded by the number of owners that made model calls (≤ declared + ceiling) × workloads. This unit is independent of the rest and correct for declarative-only deployments too.

**M0 — Manure search audience.** Publication uses one constant principal (`ManagementSearchPrincipal.all`, a fixed namespaced digest) as the whole audience of every artifact, and queries use the same principal. Authorization is the live authentication the query path already performs before the search, inside the search transaction and again per hit (`manure/.../Search.scala:81,97,102`); the per-user audience rows add nothing to it (they are derived from the configured list regardless of `enabled`, and every authenticated manager may see every artifact — §2.4). Existing artifacts receive the new audience from the startup backfill that already re-publishes every artifact (`Main.scala:155-169`; `PostgresRetrieval.put` rewrites the audience rows — `PostgresRetrieval.scala:109-110`); audience is not part of the source version or content digest, so no re-embedding is triggered. Evaluated alternative: adding each new account's principal to every artifact at creation — O(artifacts) writes per account, a second code path to keep consistent, and the same reliance on live authentication. Rejected. The wide-id regression (`WideAudienceAuditSuite`) keeps its publication and authorization assertions; its audience-row assertions change to the constant.

#### 4.8.5 Reconciliation and imperative accounts (v2; resolves C4)

Root cause of the review finding: v1 copied imperative state into the reconciled fingerprint table, so a reconciliation computed from an older snapshot could write back an old fingerprint and delete a fresh session.

v2 removes the shared state instead of guarding it:

1. Imperative accounts have **no fingerprint row**. Their credentials, status and counters live only in `ponygirls_imperative_users`, read and written under the owner lock.
2. `Accounts.reconcile(users)` accepts declarative users only (an imperative entry is a programming error → `config`). Its scope is `declared ids ∪ ids that have a fingerprint row`. It deletes sessions and revokes tokens **only for owners in that scope**. For existing deployments this is exactly today's behaviour: every session or token owner has a fingerprint row, because login and issuance require one.
3. Consequently no reconciliation — fresh, stale, at startup, on Haystack's one-second reload or on Manure's per-request path — can read or change an imperative account's session, token or credential. The interleaving "reload reads a snapshot → recovery commits → reload reconciles" is harmless by construction.
4. Change-driven: reconcile first reads the fingerprint rows only; if every declared user has an identical row and every other row is already disabled, it returns without locks or writes. Otherwise it takes the existing full path, restricted to the scope. (Manure calls it on every authentication — `manure/.../Auth.scala:86-103` — so this also removes a per-request cost that would otherwise grow with the session and token tables.)
5. The one remaining interaction is between **names**: a declared id/login being installed while the same name is being created imperatively. `installDeclared` serialises it: take the directory lock → read the imperative ids **after** acquiring it → collision check (§4.1.3) → run the declarative reconciliation. Creation takes the same lock and, besides the declared snapshot it was given, checks the fingerprint table (rule 3), which already contains every installed declared id. Haystack publishes a reloaded directory to request handlers only after its `installDeclared` transaction committed (`Main.scala:53`); a *login* (as opposed to an id) declared in that sub-second gap and signed up simultaneously is detected by the next directory read and fails closed.
6. Ordinary authentication never reconciles imperative state and never writes on the basis of a directory snapshot; a snapshot that is a few milliseconds old only orders the request before a concurrent mutation.

The master switch falls out of the same structure: with it off, `directory` omits imperative users, so their sessions and tokens resolve to no owner and are refused; reconciliation, being scoped, leaves them in place (§6.5).

#### 4.8.6 Lock hierarchy (v2; resolves C5)

| Level | Lock | Taken by |
|---|---|---|
| 1 | directory lock (one advisory lock per database) | signup, invitation/reset issuance, redemption, approve, reject, `installDeclared` |
| 2 | owner locks of **declarative-scope** owners, in sorted key order | declarative reconciliation (all in scope, changed path only); `loginReplacing`; a declarative actor or prior-session owner in an imperative operation |
| 3 | owner locks of **imperative** owners, in sorted key order | every imperative operation on its target(s); an imperative actor |

Rules: a transaction takes the levels in ascending order; within levels 2 and 3 it takes the complete set it needs through one helper (`lockOwners(declarative, imperative)`), never a further owner of the same level later; full reconciliation, when it runs, is the first owner-lock acquisition of its transaction. The class of an owner is stable (an id is permanently declarative-scope or imperative; collisions fail closed), and the directory carries it (`AccountUser.origin`), so `loginReplacing` can order a declarative target against an imperative prior session.

Owner locks keep their existing key (`ponygirls-account:<ownerKey>` — `AccountSql.scala:47`), so session creation, token issuance and credential changes of one account still serialise with each other. There is no separate imperative row lock. Chronicle's adapter maps `lockOwners` onto its per-owner mutation lock (`Sql.lock("mutation:<id>")`, `chronicle/.../Auth.scala:93`), in the same order.

Why the review scenario cannot occur: an admin transaction now holds exactly {actor, target} and performs no reconciliation; reconciliation holds level-2 locks only and never waits for a level-3 lock; a login replacement takes its level-2 owners before its level-3 owners.

#### 4.8.7 Tests are shared the same way

One abstract `ImperativeAccountContract` in the shared module, bound to a handwritten in-memory repository and to PostgreSQL, with an injected `Clock` and `PasswordHasher`. Services do not repeat the matrix. Manure's `MemoryAuthTxn` gains the imperative member(s) and the scoped-reconcile rule; to avoid a third copy of the logic it delegates to the shared in-memory repository, published from the shared module's test scope (sbt `test->test` dependency for `manureServer`; none exists today — `build.sbt:142`).

#### 4.8.8 Cost of the merged directory

`Accounts` validates and scans the directory on every call (`Accounts.scala:32-43`), and the adapters call it one to three times per request. Imperative users add one indexed `SELECT` of ≤ 1000 small rows per call (Haystack, Manure). With the default cap of 100 this is negligible **[I]**; the hard ceiling bounds it. The follow-up, if ever needed, is an indexed directory interface instead of a vector.

### 4.9 Account UI surfaces, states and calls (behavioural contract; no visual design)

The shared client owns the URL fragment prefix `#account-`. Host pages provide triggers; the shared code shows or hides them from `GET /policy` and `GET /profile`.

| Surface | Entry | States | Calls |
|---|---|---|---|
| Login | existing `form[data-account-login]` | `credentials` → `submitting` → done / `error` / `second-factor` (after `401 totp-required`; login and password held in memory only) → `submitting` → done / `error` / `rate-limited(retryAfter)` | `POST /login` |
| Signup | host trigger `[data-account-signup]`, shown when `policy.signup` | `loading-policy` → `form` (secret generated, QR + base32 shown; fields: username, e-mail, password, code, "require TOTP at login"; when `policy.approval`, the form states before submission that an administrator must approve the account) → `submitting` → **`pending-approval`** (terminal; on `202`: no session, no reload; explains that sign-in works after approval and that no notification will be sent) / done (on `200`: reload) / field errors (`username-unavailable`, `weak-password`, `totp-mismatch`, `invalid`) / `closed` (`403`) / `rate-limited` / `unavailable` | `GET /policy`, `POST /signup` |
| Enrollment | fragment `#account-enroll={code}` at load | `inspecting` → `form` (username fixed; e-mail only for `invite`) / `invalid-link` (`404`) → `submitting` → done / field errors | `POST /enrollments/inspect`, `POST /enrollments/redeem` |
| Recovery | host trigger `[data-account-recover]`, shown when the policy endpoint exists | `form` (username, code, new password) → `submitting` → done (reload) / `rejected` (generic; must not distinguish unknown, pending, disabled or wrong code) / `weak-password` / `rate-limited` | `POST /recover` |
| Account settings | existing `[data-account-settings]` dialog | existing token section unchanged; new sections from `profile.manage`: e-mail (`view`/`saving`); password (`form`/`saving`); TOTP replacement (`form` with new QR; **asks for a code from the current authenticator when `profile.totp.required`**; `saving`); require-TOTP toggle (`confirm` with a current code; on enabling, states that other sessions will be signed out and — when `policy.enrollment` is false — that a lost authenticator cannot be replaced; `saving`); `proof-rejected` shown in place for wrong password/code; declarative accounts: sections absent | `GET /profile`, `POST /profile/email`, `/profile/password`, `/profile/totp`, `/profile/totp-required` |
| User management | host trigger `[data-account-users]`, shown when `profile.manage.users` | `loading` → `list` (source, status `active`/`disabled`/`pending`, admin, locked, pending enrollment); **pending applicants** are distinguishable, show username, e-mail and application time, with the e-mail and username presented as self-asserted/unverified, and offer `approve` and `reject` (each `confirming` → `saving` → refreshed list; `username-unavailable` on approve → explain, offer reject); enable/disable (`confirming`/`saving`); **admin flag change and reset: `proof` prompt for the admin's current password** → `saving` / `proof-rejected` / `rate-limited`; invitation `form` → `issued` (link shown once, copy action, not stored) | `GET /admin/users`, `POST /admin/users/{id}/approve`, `/reject`, `/enabled`, `/admin`, `/reset`, `GET /admin/enrollments`, `POST /admin/enrollments`, `/admin/enrollments/{id}/revoke` |

Rules carried over from the existing UI **[O]** (`shared/account-web/README.md`): no secret (password, TOTP secret, enrollment code, session) in browser storage; every mutation sends the `actor` from a fresh read; a mismatched owner closes the dialog and dispatches `account:changed`. Additional rule: a password typed into a `proof` prompt is used for that one request and not retained.

---

## 5 API / wire changes per service

### 5.1 Common additions to account HTTP v1 (identical in the three services) **[P]**

All paths are under `/api/account/v1` and inherit the existing rules **[O]** (`shared/service-auth/README.md:49-76`): strict UTF-8 JSON ≤ 16 KiB, depth ≤ 8, exact member sets, no query string, no bearer credential, exact Host/Origin, `Cache-Control: no-store`, sanitized `{error:{code,message}}`. Authenticated mutations require exactly one `X-Account-Actor`. `{user}` is the existing object `{id,login,displayName,actor}`.

"Exists when": **M** = master switch on; **S** = M and `signup.enable`; **E** = M and `enrollment.enable`. With the master off every row below answers the existing `404 not-found`.

Unauthenticated endpoints:

| Method, path | Exists when | Request | Success | Failures |
|---|---|---|---|---|
| `GET /policy` | M | — | `{signup:bool, approval:bool, enrollment:bool, issuer:string, username:{pattern}, password:{minLength,maxLength}, totp:{algorithm:"SHA1",digits:6,period:30,secretBytes:20}}` | — |
| `POST /signup` | S | `{username,email,password,totpSecret,totpCode,requireTotp}` | approval mode: `202 {status:"pending"}`, **no cookie**; otherwise `200 {status:"active", user}` + session cookie | 400 `invalid` / `weak-password` / `totp-mismatch`; 409 `username-unavailable`; 403 `forbidden` (user cap); 429; 503 |
| `POST /enrollments/inspect` | E | `{code}` | `{username, kind:"invite"\|"reset", expiresAt}` | 404 `not-found`; 429 |
| `POST /enrollments/redeem` | E | `{code,password,totpSecret,totpCode,requireTotp}` plus `email` for `invite` | `{user}` + session cookie | 404; 400 as signup; 409 `username-unavailable` (invitation whose name was claimed meanwhile); 429; 503 |
| `POST /recover` | M | `{username,totp,password}` | `{user}` + session cookie | 401 `unauthorized` (any credential or eligibility failure, including pending and disabled); 400 `weak-password`; 429; 503 |
| `POST /login` (existing) | always | `{login,password}`; additionally `{login,password,totp}` when M | unchanged `{user}` + cookie | unchanged, plus 401 `totp-required`, 429 `rate-limited` |

Authenticated endpoints (browser session; all exist when **M** unless noted):

| Method, path | Request | Success | Notes |
|---|---|---|---|
| `GET /profile` | — | `{user, source:"declarative"\|"imperative", admin:bool, email:string\|null, totp:{required:bool, state:"ok"\|"unavailable"\|"none"}, manage:{email,password,totp,users,enrollment : bool}}` | declarative: `email:null`, `totp.state:"none"`, `manage.email/password/totp:false` |
| `POST /profile/email` | `{email}` | `{ok:true}` | imperative only |
| `POST /profile/password` | `{currentPassword,newPassword}` | `{ok:true}` + replacement session cookie | other sessions deleted |
| `POST /profile/totp` | `{currentPassword,totpSecret,totpCode}`; plus `currentTotp` exactly when mandatory TOTP is on | `{ok:true}` | replaces the secret |
| `POST /profile/totp-required` | `{required,totp}` | `{ok:true}` | both directions need a current code; enabling deletes all other sessions |
| `GET /admin/users` | — | `{users:[{id, login:string\|null, displayName, type, source, status:"active"\|"disabled"\|"pending", admin, email:string\|null, createdAt:string\|null, createdVia:"signup"\|"enrollment"\|null, createdBy:string\|null, approvedBy:string\|null, totpRequired:bool\|null, totpState, locked:bool, pendingEnrollment:"invite"\|"reset"\|null}]}` | admin; declarative users report `active`/`disabled` from `enabled`; at most declared + 1000 entries, unpaginated |
| `POST /admin/users/{id}/approve` | `{}` | `{ok:true}` | admin; target `pending`; 409 `username-unavailable` if the name is now claimed |
| `POST /admin/users/{id}/reject` | `{}` | `{ok:true}` | admin; target `pending`; deletes the application |
| `POST /admin/users/{id}/enabled` | `{enabled}` | `{ok:true}` | admin; imperative `active`/`disabled` target ≠ actor |
| `POST /admin/users/{id}/admin` | `{admin, currentPassword}` | `{ok:true}` | admin; imperative non-pending target ≠ actor; **fresh proof** |
| `POST /admin/users/{id}/reset` | `{currentPassword}` | `{enrollment, code}` | admin; **E**; imperative `active` target ≠ actor; **fresh proof** |
| `GET /admin/enrollments` | — | `{enrollments:[{id,username,kind,createdBy,createdAt,expiresAt}]}` | admin; **E** |
| `POST /admin/enrollments` | `{username}` | `{enrollment, code}` | admin; **E**; create-or-replace; code returned once |
| `POST /admin/enrollments/{id}/revoke` | `{}` | `{ok:true}` | admin; **E** |

Path ids are imperative usernames or `enrollment-<uuid>`; declarative ids appear only inside JSON bodies.

Error vocabulary additions (the allowlist in `AccountJson.failure` — `AccountJson.scala:28` — currently collapses unknown codes to `unavailable` and must be extended): `totp-required` (401), `totp-mismatch` (400, setup proof failed), `username-unavailable` (409), `weak-password` (400), `proof-rejected` (403, wrong current password/code on an authenticated self-service or admin-proof request — distinct from 401 so views do not treat it as a dead session). 429 and 503 carry `Retry-After`.

Unchanged, and to be asserted by tests: request and response shapes of the five existing endpoints, cookie names and attributes, token metadata, bearer authentication, every Baboon model and codec, MCP, WebSocket protocols (required by the exact-shape validators in the deployed CLIs — §2.7).

### 5.2 Haystack

- New routes are matched before the account 404 catch-all (`haystack/.../http/Http.scala:153`) and delegate to the shared dispatcher inside `database.transaction`.
- `AccountService` passes the merged directory at every use listed in §2.12; `Auth.user(id)` and `configuredTokens(id)` (`Auth.scala:50-51`) resolve imperative ids (no configured tokens); `login` returns a decision (D27).
- Startup and reload call `installDeclared` (§4.8.5) instead of a bare reconcile.
- `IdentityHistory`: fingerprint table and the four author columns (§4.1.3).
- Request telemetry: the route-label allowlist (`Http.scala:232`) gains fixed labels for the new routes; security events per §4.6.4.
- Live WebSocket: no change; sockets revalidate the session against the database on every frame and heartbeat (`haystack/docs/auth.md:100-104`).
- Baboon `haystack.api` 1.0.0: unchanged. `/api/v1/login` keeps rejecting.

### 5.3 Manure

- Account routes exist only in the management context (`Require(!ctx.content, "not-found")` — `manure/.../Http.scala:170`); unchanged. They are available in both content modes (O8).
- `/login` keeps `login_rate_per_min_per_ip`; the shared address limiter covers the other unauthenticated endpoints.
- `AuthTxn` gains the imperative operations; `Auth.current` reconciles the declared snapshot and returns the merged directory; `Accounts.login` returns a decision (D27).
- Search uses the constant management audience (unit M0, §4.8.4).
- `IdentityHistory`: fingerprint table through the owner-key mapping and `manure.artifacts.created_by_user`.
- The new client asset is added to both static allowlists (`Http.scala:299-301,350`).
- Content grants bound to a deleted session fail the existing liveness check on every open (`manure/docs/account-auth.md:124-128`).
- Baboon `manure.api`, the Python client, CLI and MCP: unchanged.

### 5.4 Chronicle

- HTTP account plane only. **No WebSocket operation, no `chronicle.api` change** (stays 1.9.0); `UserInfo{id,login,scopes}` is unchanged; the dashboard reads the admin flag from `GET /profile`.
- `Auth.login` and `Auth.accountLogin` consult the shared verification first and return a decision (D27); the legacy `POST /api/login` cannot carry a code and rejects mandatory-TOTP users; the legacy statement excludes imperative ids.
- Active imperative users are projected into `ch_users` by insert at activation and by update afterwards; pending users are not projected. `Invite(groupId,targetId)` works with their ids unchanged (`Auth.scala:174-179`).
- Owner registries no longer derive from configuration (unit CH0, §4.8.4).
- New routes reuse `loginGate` for unauthenticated PBKDF2 work.
- The new client asset is added to the unversioned entry-point set (`chronicle/.../Http.scala:156`).

### 5.5 Unauthenticated surface that becomes reachable, and its hardening

| Endpoint | What an anonymous caller can cause | Controls |
|---|---|---|
| `GET /policy` | learn that the features are enabled, the issuer string and policy constants | static content; no secrets |
| `POST /signup` | create accounts — **pending** by default, so without authority until approved; name squatting; table growth; one PBKDF2 per accepted request | exact Origin; address limit 10/min; creations 5/day per address and 20/h global; PBKDF2 gate; `maxUsers` (all statuses); hard ceiling; proof of TOTP before hashing; admin reject frees name and slot |
| `POST /enrollments/inspect` | test codes | 256-bit code space; address limit; uniform 404 |
| `POST /enrollments/redeem` | as inspect, plus PBKDF2 after a valid code | as above; PBKDF2 only after the code digest matched |
| `POST /recover` | guess TOTP codes for a known username; lock that user's **recovery** | recovery counter (§4.2.5); address limit; uniform 401; PBKDF2 only after a valid code |
| `POST /login` (existing) | guess imperative passwords; delay that user's password login | password counter; address limit; unchanged for declarative users |

All of them are absent (404) when the master switch is off.

---

## 6 Configuration and Nix options

### 6.1 Server JSON **[P]**

Haystack (inside the hot-reloaded `auth` object) and Chronicle (top level):

```json
"users": [{"id": "operator", "…": "…", "admin": true}],
"accounts": {
  "enabled": true,
  "keyFile": "$CREDENTIALS_DIRECTORY/accounts-key",
  "signup": {"enabled": true, "requireApproval": true, "maxUsers": 100},
  "enrollment": {"enabled": false, "ttlSeconds": 86400},
  "issuer": "Haystack (memory.example.net)",
  "reservedUsernames": []
}
```

Manure (snake_case top-level keys, camelCase per-user keys as today):

```json
"users": [{"id": "operator", "…": "…", "admin": true}],
"accounts": {"enabled": true, "key_file": "…",
             "signup": {"enabled": true, "require_approval": true, "max_users": 100},
             "enrollment": {"enabled": false, "ttl_s": 86400},
             "issuer": "Manure (artifacts.example.net)", "reserved_usernames": []}
```

### 6.2 Switch semantics and the defaulting rule (v2)

| Switch | Governs |
|---|---|
| `accounts.enabled` (**master**) | Whether imperative accounts exist for the service at all: imperative login, recovery, profile operations, admin user management (list, approve, reject, enable/disable, admin flag), and the acceptance of imperative sessions and tokens. Requires the key file. |
| `accounts.signup.enabled` | New self-registration (`POST /signup`). `requireApproval` (default **true**) selects pending-until-approved; `maxUsers` bounds rows. |
| `accounts.enrollment.enabled` | Issuance, inspection, redemption, listing and revocation of invitations and credential resets. |

Defaulting rule — precise:

1. An absent `accounts` object means master off. Nothing else switches the master.
2. When the object is present, `enabled` is a **required** boolean. It is never computed from `signup.enabled` or `enrollment.enabled`, in the server or in Nix.
3. `signup.enabled = true` or `enrollment.enabled = true` while `enabled = false` (or the object absent) is a **configuration fault** (fail closed at `check-config`/startup; a Nix assertion with the same meaning). The creation flags require the master; they never imply it.
4. Therefore the only way to suspend imperative accounts is to set the master to false. Setting `signup.enabled` and `enrollment.enabled` to false with the master on leaves every existing account, session and token working, keeps recovery, profile and admin management available, and merely stops new accounts and resets.
5. `signup.requireApproval` defaults to true when the member is absent.

### 6.3 Server-side validation (fail closed, as existing configuration faults)

- Rule 3 above.
- `enabled = true` ⇒ `keyFile` present, absolute, outside `/nix/store`; content = base64url of 32 bytes (validated when credentials are acquired, like password-hash files; Manure's `check-config` stays parse-only **[O]** `manure/docs/account-auth.md:26-27`).
- `maxUsers` 1–1000; `ttlSeconds` 300–604 800; `issuer` 1–64 printable characters without `:`; reserved names satisfy the username policy.
- `admin: true` only on a **human** user with browser credentials.
- **At least one enabled declarative admin is required when `enrollment.enabled` is true or when `signup.enabled` and `signup.requireApproval` are both true** (somebody must be able to approve; bootstrap and break-glass).
- Directory collision check of §4.1.3 at startup and on every Haystack reload, with the master on or off.
- Removed since v1: the rule that Manure signup requires `content_mode = "subdomain"` (O8).

### 6.4 Nix options **[P]**

`nix/lib/service-account-options.nix` gains: `browserOptions.admin` (bool, default `false`), an `accountOptions` constructor, `accountAssertions`, and a renderer that returns `{ }` when the master is off (generated JSON byte-identical to today's — the HM module's existing omission precedent, §2.8).

```nix
smind.services.<haystack|manure|chronicle> = {
  users.<id>.admin = false;
  accounts = {
    enable = false;                                  # master; explicit; never derived
    keyFile = null;                                  # runtime path string, required when enable = true
    signup     = { enable = false; requireApproval = true; maxUsers = 100; };
    enrollment = { enable = false; ttlSeconds = 86400; };
    issuer = "<Service> (<public host>)";
    reservedUsernames = [ ];
  };
};
```

Chronicle's own `users` submodule (`nix/nixos/chronicle.nix:67-76`) gains `admin` directly. The key file is delivered with `LoadCredential` to both the migration and the serving unit.

Assertions:

1. `accounts.signup.enable || accounts.enrollment.enable` ⇒ `accounts.enable`. Message: the master is not derived; set it explicitly, and keep it set when turning signup or enrollment off, otherwise existing accounts are suspended.
2. `accounts.enable` ⇒ `accounts.keyFile` is a non-null absolute runtime path outside the store.
3. `admin = true` ⇒ `type = "human"` with `login` and `passwordHashFile`.
4. `accounts.enrollment.enable || (accounts.signup.enable && accounts.signup.requireApproval)` ⇒ at least one enabled declarative admin.
5. `accounts.enable` ⇒ `publicUrl` is set (enrollment links and the issuer default need an origin).

There is no assertion on Manure's content mode (O8).

Home Manager, combined module (`smind.hm.services.agentic.{haystack,manure}`): the same `accounts` options; `operator.admin` defaults to **`true`** (the fixed `operator` is the deployment's human operator; the flag is inert while the master is off), so assertion 4 is satisfied by default; `users.<id>.admin` as on NixOS. With `accounts.enable = true` and `accounts.keyFile = null`, setup provisions `credentials/<service>-accounts.key` once (0600, 32 random bytes, base64url), then verifies and retains it — the idempotence rule already used for the operator PBKDF2 file (`docs/drafts/20261115-0015-declarative-service-accounts.md`, "Existing combined Home Manager deployments"). This module hardcodes path hosting for Manure (`nix/hm/agentic-services-server.nix:104`); Manure signup is permitted there (O8) with the risk of §8.4.

Home Manager, Chronicle module: `settings` is free-form JSON; the module adds key provisioning (`credentials/accounts.key`) and injects `settings.accounts.keyFile` when the master is on without an explicit key file.

### 6.5 Master switch off: what happens (v2)

**Turning `accounts.enable` off suspends every imperative account of that service.**

| | Haystack / Manure | Chronicle |
|---|---|---|
| Imperative login, recovery, profile, admin management, signup, enrollment | not reachable (404); imperative names are unknown to `/login` | same |
| Browser sessions of imperative users | refused (their owner is not in the directory); **rows kept**; valid again when the master returns | deleted at the next start by the existing rule for disabled owners (`Database.scala:36`); users sign in again after the master returns |
| Issued API tokens of imperative users | refused; **not revoked**; valid again when the master returns | refused by the existing disabled-owner gate; valid again when the master returns |
| Rows (accounts, pending applications, pending enrollments), data | kept; enrollment expiry keeps running | same |
| Collision check against declared names | still enforced | still enforced |

Decision and justification: suspension refuses instead of revoking. It is free — imperative owners are outside reconciliation (§4.8.5), so nothing has to be written when the switch changes — and it makes the switch reversible, which is what an operator turning a feature off and on again expects. An operator who wants credentials destroyed disables the accounts (§4.1.5) before or instead of switching off. Startup logs the number of suspended accounts when the master is off and rows exist.

Not covered by this guarantee: **rolling back to a binary older than this feature**. Its reconciliation is unscoped and will delete imperative sessions and irreversibly revoke imperative tokens in Haystack/Manure (§7).

### 6.6 Reverse proxies

Add `proxy_set_header X-Forwarded-For $remote_addr;` to the proxy blocks that lack it: `nix/hm/agentic-services-server.nix:195-199`, `nix/hm/chronicle-server.nix:17-25`, `nix/nixos/manure.nix:268-269`, `nix/nixos/chronicle.nix:199-206`. NixOS Haystack relies on `recommendedProxySettings`; the implementer verifies that it sets the header in the pinned nixpkgs. With an external edge (`proxy.enable = false`) the operator must forward the header from a trusted peer; otherwise all clients share one address bucket (stricter, not weaker).

Independent observation: the HM Chronicle `limit_req` location covers only the legacy `= /api/login` (§2.6).

### 6.7 Defaults

Everything defaults to off. With the master off and no rows: no new JSON keys are emitted, no key file is required, no new route answers anything but the existing 404, the directory contains declarative users only, `/login` uses the unchanged decoder and path, and the only difference from today is the presence of the empty tables.

---

## 7 Migrations and compatibility

| Topic | Design |
|---|---|
| Schema | `ImperativeAccountSql.initialize(c)`: idempotent `CREATE TABLE IF NOT EXISTS` for the two tables and `ponygirls_imperative_schema` (version 1), under the advisory lock used by `AccountSql.initialize`. Called unconditionally where each service initialises its account tables today (Haystack `Migrations.scala:32`; Manure `Main.scala:151`; Chronicle `Database.initialize`), so no switch requires a migration. |
| No numbered SQL files | Haystack's `schema_migrations` list and Chronicle's migration and native-image resource lists stay untouched. |
| `ponygirls_account_schema` | Not bumped (stays 2). The existing initializer accepts stored versions 1 and 2 and rejects any other value (`AccountSql.scala:16`), so writing 3 would make every older binary refuse to start. The new tables therefore carry their own version table, which older binaries ignore. |
| Existing tables | No column is added to `ponygirls_account_users`, `ch_users` or any service table. The change to reconciliation (scope) is behavioural and equivalent for existing data (§4.8.5 item 2). |
| Existing deployments | Upgrade creates empty tables; Manure's search audience is rewritten by the startup backfill it already runs (M0); nothing else changes. |
| Old binary, new configuration | Master off: configuration is byte-identical. Master on: Manure fails `check-config` on the unknown key (closed key set); Haystack and Chronicle ignore unknown keys and run without the feature. The package must be rebuilt before enabling (same caveat as `chronicle/README.md:152`). |
| Rollback to an older binary after imperative users exist | The old binary starts. **Haystack/Manure:** its unscoped reconciliation deletes imperative sessions and irreversibly revokes imperative tokens; Manure's old startup backfill restores per-user search audiences. **Chronicle:** startup disables the projections and deletes their sessions; tokens are gated. Passwords, TOTP secrets and data remain; rolling forward restores login; Haystack/Manure tokens must be issued again. |
| Master switch off/on | Suspension without revocation (§6.5). |
| Backups | Database dumps contain PBKDF2 hashes, e-mail addresses (also of pending applicants) and *encrypted* TOTP secrets. The key file must be backed up separately; a dump plus the key file equals the ability to recover every imperative account. Losing the key makes TOTP `unavailable` until admin resets. |
| CLI clients and API tokens | Unaffected: existing endpoints keep their shapes; declarative tokens are untouched; imperative users issue tokens through the existing endpoints. Haystack/Chronicle CLI `login` cannot supply a code, so an imperative user with mandatory TOTP cannot use CLI login (K1, deferred). Manure's Python client uses bearer tokens only. |
| Chronicle data model | A newly **active** imperative user receives a `ch_users` row and a `ch_owner_targets` row by insert. |

---

## 8 Threat model and residual risks

### 8.1 Capabilities by attacker

| Attacker | Can | Cannot |
|---|---|---|
| Unauthenticated, network access to the origin, signup enabled **with approval (default)** | Submit applications up to the rate limits and `maxUsers`; hold names while pending; learn which usernames exist. Against a known imperative user: the denial of service of §4.7 (delay new password logins; lock recovery) and TOTP guessing at the bounded rate of §4.2.5. | Obtain any session, token or service access without an admin's approval. Affect declarative accounts. Obtain admin. Read or guess enrollment codes. Learn e-mail addresses. Cause unbounded PBKDF2 work or database growth. Block the login of a mandatory-TOTP user through `/recover`. |
| The same, **approval turned off** | Additionally: become a regular human user of the service immediately (§8.3) and keep the chosen name permanently. | As above, except the first line. |
| Unauthenticated, enrollment only | Probe codes; attack existing imperative users as above. | Create an account without a code issued by an admin. |
| Pending applicant | Nothing beyond an anonymous caller. | Log in, recover, hold a session or token, appear in any directory, reach any service API. |
| Regular authenticated user | Everything the service already grants any human user. Change own e-mail, password, TOTP; issue own tokens. | Call admin operations; read the user list or other users' e-mail through the account plane; alter another account; change own username; promote self; reclaim the identity of a removed account. |
| Imperative admin | Approve/reject applicants, invite users, enable/disable imperative users; with the own password: promote/demote imperative users and issue resets (an admin who redeems a reset code takes over that account — inherent in "admin reset"; audited). | Change, disable or impersonate declarative accounts; demote, disable or reset self; read passwords, TOTP secrets, or enrollment codes after issuance. |
| Database or backup reader (no key file) | Read usernames, e-mail addresses (including pending applicants'), PBKDF2 hashes (offline guessing at 600 000 iterations per guess), all service data. | Use TOTP (encrypted), sessions, tokens or enrollment codes (digests of 256-bit values); recover accounts; pass mandatory-TOTP login even with a cracked password. |
| Database reader **with** the key file | Additionally decrypt TOTP secrets and recover any imperative account. | Affect declarative accounts through this feature. |
| Script running on the service origin with a victim's session (XSS; uploaded content in Manure path mode — §8.4) | Everything the session can do without a fresh proof: as today, issue an API token for the victim and use the service; new with this feature, for an admin victim: approve/reject applicants, issue invitations (and read the code), enable/disable imperative users, read the user list with e-mail addresses. | Without interaction: change an admin flag, issue a reset, change a password, replace a TOTP secret, or turn mandatory TOTP off or on (each needs the current password or a current code). It can still succeed if it can observe the victim typing that proof in the dashboard document. |

### 8.2 Residual risks accepted because there is no e-mail confirmation

1. **Username squatting.** With approval on, a squatter holds a name only until an admin rejects the application. With approval off, anyone can claim any free, non-reserved name permanently. Mitigations: reserved list, `reservedUsernames`, rate limits.
2. **Unverified e-mail.** The address may be mistyped or belong to someone else; it is never used for authentication, authorization, recovery or approval logic, and admins must not treat it as proof of identity when approving.
3. **No ownership proof behind an identity.** Username and e-mail are self-asserted. Approval is only as good as the admin's out-of-band check.
4. **Signup closure.** An attacker can fill `maxUsers` (at ≤ 20 applications/hour globally) and thereby close signup until an admin rejects the pending rows (approval on) or the operator raises the cap (approval off; disabled accounts keep counting).
5. **No notification and no out-of-band recovery.** An applicant is not told about approval or rejection. A user who loses the authenticator and forgets the password depends on an admin reset (imperative) or on configuration (declarative).

### 8.3 Consequence of "regular human user rights" (O6) per service — observed semantics

- **Haystack:** every authenticated user reads and writes every item (`haystack/docs/auth.md:9-10`).
- **Manure:** every authenticated user reads internal artifacts and can delete any artifact (`manure/.../Artifacts.scala:118-122`, `manure/README.md:25-28`), and shares the global storage quota.
- **Chronicle:** archives are per owner; a new user sees nothing of others without a group invitation, but can issue `Ingest` tokens and upload sessions, consuming model capacity and storage; there is no per-user quota.

With approval on (the default), these rights are granted by an admin's explicit decision per account, as for an enrolled user. With approval off, enabling `signup` is an exposure decision equal to "everyone who can reach the origin is a user".

### 8.4 Manure in `path` content mode (O8) — documented risk

Observed **[O]**: in path mode uploaded artifacts are served from the dashboard/API origin (`manure/.../Http.scala:513`; hardcoded in the combined Home Manager module, `nix/hm/agentic-services-server.nix:104`). Any HTML or script in an artifact therefore runs with the origin of the account plane, and the browser attaches the viewer's session cookie to its same-origin requests.

Risk statement:

- Whoever can upload an artifact can run script in the browser of whoever views it. That script can do, with the viewer's session, everything the account plane and the API allow without a fresh proof: read, upload and delete artifacts, issue an API token for the viewer (existing behaviour), and — when the viewer is an admin — approve or reject applicants, issue invitations and read their codes, enable or disable imperative users, and read the user list.
- Self-signup lets people the operator does not know become uploaders. With approval on, an applicant can upload nothing until approved; **approving a user in path mode therefore means trusting that user's uploaded content** as much as the user. With approval off, anyone who reaches the origin can upload such content.
- Mitigation built into the design: changing an admin flag and issuing a credential reset require the acting admin's current password (§4.6.3), and password/TOTP changes require the current password or code (§4.5.3). A script cannot, without interaction, create an administrator, take over another account, or change the viewer's credentials. This does not protect against a script that observes the admin typing the password.
- Not mitigated by this design: everything in the first bullet. The complete remedy is subdomain content mode, where artifacts never share the dashboard origin.

Recommendation carried into the documentation, not enforced: in path mode keep `signup.requireApproval = true`, approve only people whose uploads are trusted, and have admins avoid opening artifacts from recently approved users in the browser profile they use for administration.

### 8.5 Text to add to `manure/docs/account-auth.md` (unit M1)

> **Self-signup and path-mode hosting.** In `path` content mode artifacts are served from the dashboard origin. Script in an uploaded artifact runs with the viewer's browser session and can call the account API as that viewer. For an administrator this includes approving or rejecting applicants, issuing invitations, enabling or disabling users and reading the user list; it does not include changing an admin flag or issuing a credential reset, which require the administrator's current password, nor changing the viewer's own password or TOTP secret. Enabling self-signup in path mode is permitted. Approving an applicant then means trusting every artifact that user uploads. Keep `signup.requireApproval` enabled, approve only trusted people, and prefer `subdomain` content mode whenever uploaders are not fully trusted.

### 8.6 Other residual risks

- **TOTP is equivalent to the password for recovery.** Possession of the authenticator secret alone resets the password, also for a mandatory-TOTP user (orchestrator decision: no opt-out).
- **Mandatory TOTP and a lost authenticator.** The user cannot replace the secret; an admin reset is required, and it exists only where enrollment is enabled.
- **Targeted denial of service** by anyone who knows a username: §4.7, per endpoint.
- **Online password guessing** bounded to ≈ 35 000 attempts/year per account; no breached-password list.
- **Key file loss** disables recovery and mandatory-TOTP login for affected users until an admin reset.
- **Pending applications do not expire**; their password hashes and encrypted TOTP secrets stay stored until an admin rejects them.
- **Name collision introduced by configuration** fails the service closed until the operator changes the configuration; with approval off, an outsider can pre-register a name the operator later wants to declare.
- **Rollback to a pre-feature binary** revokes imperative tokens in Haystack/Manure (§7).
- **Per-request directory cost** grows linearly with active imperative users up to the ceiling (§4.8.8).
- **Client-generated TOTP secret:** a non-browser client can submit a low-entropy secret and weaken its own account.
- **`clientAddress` in security logs** is a new personal datum in logs.

---

## 9 Test plan (lean)

Principle: behaviour is specified **once**, in the shared module; services test only their seam. No sleeps (injected `Clock`); the contract uses an injected `PasswordHasher` so that only the cases about hashing pay for PBKDF2; no VM tests; no per-service copy of the matrix. Locations are given as build module and suite; no runner script is assumed.

| Layer | Module / suite | Cases | Content |
|---|---|---|---|
| Pure unit | `serviceAuth`: `TotpSuite`, `TotpVaultSuite`, `ImperativePolicySuite` (new) | ≈ 13 | RFC 6238 vectors (`287082`, `081804`); ±1 window; replay; canonical base32; vault round trip, wrong key, wrong AAD; username/e-mail/password tables; the three counter schedules at their boundaries, including the 7-day lapse. |
| Contract, in-memory dummy **and** PostgreSQL | `serviceAuth`: `ImperativeAccountContract` (new) bound by `MemoryImperativeAccountSuite` and `PostgresImperativeAccountSuite` | 17 | (1) signup without approval: account + session atomically; (2) signup with approval: `pending`, no session; pending cannot log in or recover and answers exactly like an unknown name; holds the name; counts toward the cap; (3) approve → active and can log in; reject → row gone, name free; approve re-checks the namespace; (4) names refused: reserved, declared id/login (folded), imperative of any status, **retained historical identity**, live pending invitation; cap; nothing persisted; (5) failed TOTP proof persists nothing; (6) login without and with mandatory TOTP, `totp-required`, replayed step refused; (7) password counter is **persisted on a rejected attempt**, backs off, clears on success; (8) recovery replaces the password, deletes sessions, keeps tokens, consumes the step, clears counters; (9) counters are independent: recovery failures never lock the second login step; TOTP counters are not cleared by a success and lapse after 7 days; (10) enrollment: issue → inspect → redeem once; expiry; **re-issue replaces**; revoke; an expired row does not hold the name; (11) reset replaces credentials, keeps tokens, e-mail and admin flag; refused for self, pending or disabled targets; (12) admin rules: imperative target only, not self, non-admin refused, declarative target refused; flag change and reset need the actor's password, for a declarative and for an imperative admin; (13) disable deletes sessions, revokes tokens, keeps the name; enable restores login; (14) mandatory TOTP: enabling deletes other sessions; replacement needs the old code while it is on; (15) declared/imperative collision fails the directory closed, also with the master off; pending rows do not; (16) master switch: off → every new path `not-found`, imperative sessions and tokens refused **and still present**; on → they work again; creation flags off with the master on → existing accounts unaffected; (17) undecryptable secret ⇒ `unavailable`, password login unaffected. |
| Shared existing suite | `serviceAuth`: `AccountContract` | + 3 | reconcile of an unchanged directory performs no writes; reconcile leaves sessions and tokens of owners outside its scope untouched; `establish` yields the same session semantics as `login`; declarative `login` never selects an imperative entry (folded into the third). |
| Interleavings (PostgreSQL) | `serviceAuth`: existing `AccountRaceSuite` | + 2 | (C4) a declarative reconciliation holding a stale snapshot, overlapped with an imperative recovery and a creation, leaves the imperative session, tokens and row intact and creates no fingerprint row; a declared name installed concurrently with a signup of the same name lets exactly one side succeed. (C5) an admin mutation on two owners, a login replacement across a declarative and an imperative owner, and a full reconciliation run concurrently to completion without a deadlock. |
| Haystack adapter | `haystackServer`: existing `AccountHttpTest` | + 3 | signup (pending) → approval by a declared admin → login → `GET /profile` → logout; boundary (Origin required, bearer refused, master-off 404, existing five endpoints byte-identical); a retained author id is refused and a reload with a colliding declared login fails closed. |
| Manure adapter | `manureServer`: existing `HttpSuite` / `AccountsContract` (PostgreSQL binding) | + 3 | the same flow through the owner-key mapping **in path mode**; the approved user finds an artifact through search (M0); closed-key configuration with and without `accounts`, and a retained artifact creator id refused. |
| Manure search | `manureServer`: existing `WideAudienceAuditSuite`, `MetadataSearchSuite` | 0 new, 1 adjusted | audience assertions use the constant principal. |
| Chronicle adapter | `chronicleServer`: existing `AccountHttpTest` | + 4 | flow with insert-only projection into `ch_users` + `ch_owner_targets`; **a retained `ch_users` id and a retained login are refused and the retained row, its archive ownership and tokens are unchanged** (C1); restart keeps active imperative users enabled with the master on and suspends them with it off, tokens intact; legacy `/api/login` refuses a mandatory-TOTP user and a wrong password commits its counter (D27). |
| Chronicle owner registries | `chronicleServer`: existing `ModelTelemetryTest`, `McpTestRunsTest` | + 1, 2 adjusted | an owner unknown at startup gets telemetry slices on first use and an empty snapshot before it; the MCP test run of such an owner passes live authorization; the two cases that asserted the configured-owner rejection are rewritten. |
| Nix evaluation | existing `nix/tests/service-accounts.nix` | ≈ 7 | generated JSON equals the current golden when the master is off; keys present when on; each assertion of §6.4 fires, including "creation flag without master" and "approval without a declarative admin"; Manure path mode with signup evaluates. |
| Provisioner | existing `nix/tests/test_agentic_services_credentials.py` | 2 | key created once with mode 0600; retained unchanged on rerun. |
| Web client, DOM-free | Node test next to `shared/account-web/account-client.js` | ≈ 12 | base32, secret length, `otpauth` URI, one QR matrix vector, state machines against a fake `fetch` (login second factor, signup `pending-approval` and field errors, enrollment invalid link, recovery, toggle, approve/reject, proof prompt). No browser. |
| Web views | existing `shared/account-web/tests/browser.mjs` (controlled routes) | ≤ 5 | signup ending in `pending-approval` (QR node and base32 present, secret not in storage, no reload); login second factor; enrollment code consumed from the fragment and removed from the URL; admin approves an applicant; admin flag change asks for the password. |
| End to end | existing `haystack/web/tests-browser/account.mjs` (one service only) | 1 | real backend: signup → approval → login. |
| Native crypto | one check in an existing native smoke of one service | 1 | HmacSHA1 + AES-GCM reachable in the native image. |

Total: about **75 new cases and 3 adjusted ones** (v1: about 60). The increase is approval, the master switch, the split counters and the review regressions; none of it is a per-service copy. The in-memory binding of the contract runs in milliseconds per case; the PostgreSQL binding adds the constraint, locking and commit-on-rejection guarantees. Final acceptance still follows the repository's full-suite rule for the touched services (`AGENTS.md`).

Deliberately not tested: three-service browser matrices, proxy rate limiting, deployment activation.

---

## 10 Implementation work breakdown

Sizes: S ≤ ~200 changed lines, M ≤ ~600, L above. "UX" marks a conflict with the concurrent redesign of the dashboards and `shared/account-web`.

| Unit | Scope | Files owned | Depends on | Acceptance | Size | UX |
|---|---|---|---|---|---|---|
| **S0** Shared prerequisites | `AccountUser.origin`; origin-aware `current`; declarative-only `login` selection; scoped, change-driven `reconcile`; `establish`, `revokeSessions`, `revokeTokens`; lock helper (§4.8.6); the two interleaving cases need S2/S3 and are added there | `shared/service-auth/src/main/scala/ponygirls/auth/{Account,Accounts,AccountSql}.scala`; `AccountContract`, `AccountBoundarySuite`, `AccountRaceSuite`; the three production `AccountUser(…)` call sites (`haystack/.../auth/Auth.scala:94`, `manure/.../Auth.scala:84`, `chronicle/.../Auth.scala:57`) | — | existing shared suite + 3 new cases on both backends; the three services compile and their existing account tests pass unchanged | M | — |
| **S1** TOTP primitives | `Totp`, `TotpVault` | new `Totp.scala`, `TotpVault.scala`, their suites | — | RFC vectors; vault cases | S | — |
| **S2** Imperative core | model with status, policy, three counters, repository trait, `IdentityHistory`/`AccountSessions`/`PasswordHasher` ports, logic (signup, approval, enrollment, login, recovery, self-service, admin with fresh proof), in-memory dummy, contract suite | new `ImperativeAccounts.scala`; tests `ImperativeAccountContract.scala`, `MemoryImperativeUsers.scala`, `MemoryImperativeAccountSuite.scala` | S0, S1 | 17 contract cases green on the dummy | L | — |
| **S3** PostgreSQL repository | DDL initializer, repository, facade incl. `installDeclared` and `directory`, PostgreSQL binding; the two interleaving cases | new `ImperativeAccountSql.scala`, `PostgresImperativeAccountSuite.scala`; `AccountRaceSuite` | S2 | contract green on PostgreSQL; initializer idempotent; interleavings pass | M | — |
| **S4** API dispatcher | `ImperativeAccountApi`, JSON codec, error codes, `AttemptLimiter`, `SharedAccountSessions`; protocol section of `shared/service-auth/README.md` | new `ImperativeAccountApi.scala`, `AttemptLimiter.scala`; `AccountJson.scala` (code allowlist) | S2 (parallel with S3) | dispatcher cases of the contract; §5.1 reproduced in the README | M | — |
| **CH0** Chronicle owner registries (v2) | telemetry slices on first use; remove `configuredOwners`; mechanical updates of the test call sites | `chronicle/server/src/main/scala/chronicle/{ModelTelemetry,McpTestRuns,McpRuntimeResources}.scala`, `plugins/ChroniclePlugin.scala`; tests that call `ModelTelemetry.make` (7 files) or `McpTestRuns.resource` (6 files) | — (can start immediately) | 1 new + 2 adjusted cases; Chronicle full backend suite | S–M | — |
| **M0** Manure search audience (v2) | constant management principal for publication and query | `manure/backend/src/main/scala/manure/Search.scala`; `WideAudienceAuditSuite`, `MetadataSearchSuite` | — (can start immediately) | adjusted audience assertions; existing search cases pass; a restart re-publishes existing artifacts with the new audience | S | — |
| **H1** Haystack adapter | configuration, merged directory, `installDeclared` at startup/reload, login decision type, routes, `IdentityHistory`, client address, telemetry labels, static entry set; `haystack/docs/auth.md`, `scala-config.example.json` | `haystack/server/src/main/scala/haystack/{Config,Main}.scala`, `auth/{Auth,AccountService}.scala`, `http/Http.scala`, `haystack/server/src/test/scala/haystack/auth/*` | S3, S4 | 3 adapter cases; Haystack full backend suite | M | — |
| **M1** Manure adapter | configuration key sets, `Auth`/`AuthTxn` (merged directory, scoped reconcile in the dummy), login decision type, routes, `IdentityHistory`, asset allowlists, test dummy through the shared test scope; `manure/docs/account-auth.md` including the text of §8.5 | `manure/backend/src/main/scala/manure/{Config,Auth,Http,Metadata,Main}.scala`, `manure/backend/src/test/scala/manure/{MemoryAccounts,MemoryMetadata,AccountsContract,HttpSuite,CheckConfigSuite}.scala`, `build.sbt` (test-scope dependency) | S3, S4, M0 | 3 adapter cases; Manure backend suite | M | — |
| **CH1** Chronicle adapter | configuration, insert-only projection and update hook, startup order of §4.8.4, login decision type for `login`/`accountLogin` and both routes, `IdentityHistory` over `ch_users`, routes, static entry set; `CONTRACT.md`, README auth paragraph | `chronicle/server/src/main/scala/chronicle/{Core,Auth,Database,Http,Main}.scala`, `chronicle/server/src/test/scala/chronicle/Account*Test.scala`, `chronicle/config.example.json` | S3, S4, CH0 | 4 adapter cases; Chronicle full backend suite | M | — |
| **N1** Nix | shared options, assertions and renderer (master switch, approval); three NixOS modules; HM combined module and provisioner; HM Chronicle module; proxy header; evaluation tests | `nix/lib/service-account-options.nix`, `nix/nixos/{haystack,manure,chronicle}.nix`, `nix/hm/agentic-services-server{,-options,-assertions}.nix`, `nix/hm/agentic-services-credentials.py`, `nix/hm/chronicle-server.nix`, `nix/tests/{service-accounts.nix,test_agentic_services_credentials.py}` | §6 only (can start immediately) | golden-off equality; assertions; provisioner cases | M | — |
| **W1** DOM-free web client | API calls, state machines (incl. `pending-approval`, approve/reject, proof prompt), base32, secret generation, `otpauth` URI, QR matrix; Node tests | new `shared/account-web/account-client.js` and its test | §5 and §4.9 only (can start immediately) | ≈ 12 Node cases | M | low (new file) |
| **W2** Shared views | signup incl. pending-approval, enrollment, recovery, login second factor, settings sections, user management incl. approve/reject and proof prompts; controlled-route browser cases | `shared/account-web/{account.js,account.css,README.md,tests/browser.mjs}` | W1 **and the UX specification for these files** | ≤ 5 new browser cases; existing cases still pass | M | **yes — to be done by, or sequenced after, the UX workstream** |
| **W3** Per-service UI integration | triggers (`data-account-signup`, `-recover`, `-users`); build and packaging of the new asset | `haystack/web/src/{Login,App}.tsx`, `haystack/web/vite.config.ts`, `chronicle/web/src/{App,Access}.tsx`, `chronicle/web/vite.config.ts`, `manure/web/dashboard/{index.html,app.js}` + symlink, `nix/pkg/{haystack/web,chronicle/web,manure/package}.nix` | W2; H1/M1/CH1 | one real-backend browser smoke (Haystack); the three dashboards build | S per service | **yes — the dashboards are being redesigned** |
| **K1** CLI second factor | `login --totp-file/--totp-stdin` | `haystack/cli/src/{account,client}.ts`, `chronicle/cli/src/{account,main}.ts` | S4 | — | S | deferred (orchestrator decision) |
| **V1** Final validation | full unfiltered suites of the touched services, native smoke, documentation cross-check | none | all | per `AGENTS.md` | — | — |

Order and parallelism: (S0 ∥ S1 ∥ CH0 ∥ M0 ∥ N1 ∥ W1) → S2 → (S3 ∥ S4) → (H1 ∥ M1 ∥ CH1) → W3 after W2. CH0 and M0 are corrections that are valid for declarative-only deployments and can be merged on their own. S0 touches one line in each service's `Auth` file (the `AccountUser` constructor); it must land before H1/M1/CH1 start, which avoids ownership overlap.

Asset note for W1–W3: every new static file under `shared/account-web` must be registered in nine places (two Vite plugins, three Nix filesets, Manure's two allowlists and its symlink directory, Haystack's and Chronicle's entry-point sets). The design therefore adds exactly one file.

---

## 11 Open questions for the owner

The v1 questions are decided (§0.2). Two points remain that are choices of policy rather than of engineering; the design proceeds with the stated default.

| # | Question | Default in this design | Cost of the other answer |
|---|---|---|---|
| OQ-A | Admin **credential reset** is tied to `enrollment.enable` (orchestrator decision). In a signup-only deployment a user who enabled mandatory TOTP and loses the authenticator, or any user who loses both factors, then has no path short of the operator temporarily enabling enrollment. Should reset instead be part of account lifecycle under the master switch? | Tied to `enrollment.enable`; the settings view warns before the opt-in when enrollment is off. | Small: move one availability check; the reset redemption endpoint would then exist whenever the master is on. |
| OQ-B | Pending applicants and disabled users are answered exactly like unknown names on login (uniform `401`), so an applicant who tries to sign in before approval sees "invalid login or password". Should a pending applicant who presents the **correct password** be told "awaiting approval" instead? | Uniform `401` (required by the brief's enumeration posture). | Small: one extra response code after a successful password check; reveals the pending state only to someone who knows the password. |

---

## 12 Amendments after v2 (orchestrator decisions, 2026-11-17)

These override the text above wherever they differ; implementers follow this section.

| # | Amendment | Replaces |
|---|---|---|
| AM1 (OQ-A) | **Admin credential reset is part of account lifecycle under the master switch.** `POST /admin/users/{id}/reset`, the listing/revocation of pending *reset* enrollments, and inspection/redemption of a code of kind `reset` are available whenever `accounts.enable` is true, independently of `enrollment.enable`. `enrollment.enable` governs only *invitations* (issuing, listing, revoking, inspecting and redeeming codes of kind `invite`). `GET /policy` and `profile.manage` report the two capabilities separately (`enrollment` for invitations, `reset` for resets). A declarative admin is therefore required whenever the master switch is on (configuration validation and Nix assertion), not only when approval or enrollment is on. | §4.4 / §5.1 availability columns, §6.3–§6.4 assertion 3, OQ-A default |
| AM2 (OQ-B) | **A pending applicant who presents the correct password is told so.** Login for a `pending` account performs the normal password verification (same work and same failure counter as an active account); on a correct password it answers `403 pending-approval` (new error code) and establishes no session; on a wrong password it answers the uniform `401 unauthorized`. Recovery keeps the uniform `401` for pending accounts. The pending state is thus revealed only to someone who knows the password. The login view shows "awaiting approval by an administrator". | §4.3/§4.5.1 uniform-401 rule for pending accounts, OQ-B default |

