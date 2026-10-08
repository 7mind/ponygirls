# manure — file & directory hosting (frozen contract v0.1.0)

Freeze for implementation. Later agents build strictly to this document.
No drift without a contract amendment. Runtime is Python ≥3.12 stdlib
only (`http.server`, `sqlite3`, `hashlib`, `urllib`, MCP over stdio line
JSON). Typed dataclasses, explicit constructor dependencies, no global
mutable state.

## 0. Status and references

- Version: `0.1.0` (this file + `pyproject.toml` + `manure/__init__.py`
  `__version__` must agree; checked by `test_contract_*`).
- Dashboard/API origin (production): `https://artifacts.7mind.io`.
- Content origin (default): `https://<artifact-id>.artifacts.7mind.io`.
  A separate registrable content suffix/domain is configurable and
  strongly recommended (see §5.6).
- Auth codec follows haystack (`haystack/docs/auth.md`, `server/src/auth/`):
  32 random bytes → 43-char canonical unpadded base64url; files hold the
  43 chars plus at most one final LF; SHA-256 hex digests server-side;
  constant-time compare; generation never via argv/logs.
- Browser cookie rules cite
  <https://developer.mozilla.org/en-US/docs/Web/Security/Practical_implementation_guides/Cookies>
  (`__Host-` + `Secure` + `Path=/`, no `Domain`, `HttpOnly`).
- `Origin-Agent-Cluster` is an optional performance hint and explicitly
  NOT a security boundary, per
  <https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Origin-Agent-Cluster>.
  Actual controls are SOP separate origins, Host checks, Origin-checked
  APIs, `__Host-` cookies, and content restrictions below. The server MAY
  send `Origin-Agent-Cluster: ?1` as a hint; tests MUST NOT assert it as
  a boundary.

## 1. Scope, non-goals, ownership

In scope: authenticated human/agent file & directory hosting; directory
artifacts served as static sites when `index.html`/`index.htm` present;
visibilities internal / external(password) / public; optional TTL; bounded
resumable chunked uploads with atomic publish; CLI; stdio MCP tools +
skill; dashboard UI shell; NixOS/HM storage configuration.

Non-goals: no archive upload/extraction (manifest per-file chunks only),
no auto-index listings, no per-artifact ACLs beyond visibility (every
authenticated user lists/inspects/deletes all artifacts), no versioning
inside an artifact (re-upload = new artifact), no server-side search,
no OAuth server, no non-stdio MCP transport.

Ownership (files; no agent touches another owner's paths except review):

| Owner | Paths |
|---|---|
| Contract (this task) | `manure/CONTRACT.md`, `manure/pyproject.toml`, `manure/README.md`, `manure/.gitignore`, `manure/manure/__init__.py`, `manure/tests/test_contract_*.py` |
| Server agent | `manure/manure/server.py`, `manure/manure/domain.py`, `manure/manure/storage.py`, `manure/manure/auth.py`, `manure/tests/test_server_*.py`, `manure/tests/test_storage_*.py` |
| Client agent | `manure/manure/client.py`, `manure/manure/cli.py`, `manure/manure/mcp.py`, `manure/tests/test_client_*.py`, `manure/tests/test_cli_*.py`, `manure/tests/test_mcp_*.py`, `manure/skill/SKILL.md` |
| UI/security agent | `manure/web/*` (dashboard shell + unlock shell), `manure/tests/test_browser_*.py` (+ `manure/tests/browser_fixtures.py` helper only) |
| Nix agent | `nix/nixos/manure.nix`, `nix/hm/manure.nix`, `nix/pkg/manure/package.nix`, root `flake.nix`/`flake.lock` edits |

Test discovery is `python -m unittest discover -s manure/tests -p "test_*.py"`.
Filename prefixes above are exclusive: no `test_server_*` outside the
server agent, etc. `test_contract_*` stays green without any
implementation present (metadata/agreement only).

This task implements no `server.py`/`client.py`/`cli.py`/`mcp.py`/
`domain.py`/`storage.py`/`auth.py`, no `web/*`, no `nix/*`, no root
flake edits.

## 2. Runtime and entrypoints (frozen)

- `requires-python >= 3.12`. Zero runtime dependencies
  (`pyproject.toml` `[project] dependencies = []`). Test-only browser
  driver is NOT a runtime dependency (§11).
- Modules (frozen import paths; signatures below are minimal, agents may
  add private helpers but not change these):
  - `manure.server`: `create_server(config: ServerConfig) -> RunningServer`,
    `ServerConfig` dataclass (§3), `RunningServer` with
    `api_url: str`, `content_url(artifact_id: str) -> str`,
    `close() -> None`, context-manager support. `main()` for
    `python -m manure.server --config PATH`.
  - `manure.client`: `ManureClient(base_url, token=None, token_file=None)`
    (exactly one of token/token_file for authed calls; both set →
    `AmbiguousCredentials` without network, §9).
  - `manure.cli`: `main(argv=None) -> int`.
  - `manure.mcp`: `main() -> None` (stdio loop, §10).
  - `manure.domain`, `manure.storage`, `manure.auth`: dataclasses and
    helpers; no network/globals.
- Entrypoints: `python -m manure.server`, `python -m manure.cli`,
  `python -m manure.mcp`; console scripts `manure-server`, `manure`,
  `manure-mcp` map to the same `main`s. `manure/__init__.py` exposes
  only `__version__ = "0.1.0"` (plus `__all__`).
- Single-socket Host dispatch: one `ThreadingHTTPServer` serves both the
  API host and `<id>.<content_suffix>` hosts, routed by `Host` header.
  No globals; all state via explicit `data_dir`/sqlite handles.

## 3. Configuration (closed sets — no other options without amendment)

### 3.1 Server JSON config (pointed at by `--config` / `MANURE_CONFIG`)

Top-level keys are exactly (unknown keys → startup failure, fail closed):

| Key | Type | Default | Notes |
|---|---|---|---|
| `listen_address` | str | `"127.0.0.1"` | Non-loopback requires documented operator ack (Nix layer); server itself only binds. |
| `port` | int | `47329` | `0` = ephemeral (tests). |
| `data_dir` | str | — (required) | sqlite + staging + live dirs live here. Tests use tmp. |
| `api_origin` | str | — (required) | e.g. `https://artifacts.7mind.io`; local `http://127.0.0.1:PORT`. |
| `content_suffix` | str | — (required) | e.g. `artifacts.7mind.io`; local `artifacts.localhost`. Content host `<id>.<suffix>`. |
| `loopback_dev` | bool | `false` | `true` allows http + non-Secure dev cookies on loopback only (§5.7). Production MUST be `false`. |
| `dashboard_dir` | str\|null | package `manure/web/dashboard` | `null` = JSON API only (`dashboard-disabled`). |
| `unlock_shell_dir` | str\|null | package `manure/web/unlock` | `null` = built-in minimal unlock form (§5.4). |
| `users` | list | `[]` (≥1 required unless `loopback_dev` test with ephemeral users? No: always ≥1, fail closed) | `{id, type: human\|agent, displayName?, tokens: [{id, hashFile}]}`. Type is attribution only. |
| `storage_quota_bytes` | int | `21474836480` (20 GiB) | Total live+staging cap; over → `quota-exceeded`. |
| `chunk_bytes` | int | `1048576` | Server-dictated; 256 KiB–4 MiB enforced. |
| `max_file_bytes` | int | `536870912` (512 MiB) | Per file. |
| `max_artifact_bytes` | int | `2147483648` (2 GiB) | Sum of file sizes. |
| `max_files_per_artifact` | int | `10000` | Files + dir entries. |
| `max_list_limit` | int | `200` | List pagination ceiling. |
| `sweep_interval_s` | int | `300` | Expired/orphan sweeper period. |
| `incomplete_session_ttl_s` | int | `86400` | No-progress incomplete sessions become sweepable. |
| `grant_ttl_s` | int | `86400` | Content grant cookie lifetime (capped by artifact TTL). |
| `one_time_grant_ttl_s` | int | `60` | Single-use handoff grant lifetime. |
| `rate_limit_per_min` | int | `600` | Per-principal API mutations (haystack-like). |
| `unlock_rate_per_min` | int | `10` | Per artifact+IP password attempts. |

Web asset loading: explicit `dashboard_dir`/`unlock_shell_dir`; defaults
resolved as `Path(manure.__file__).parent / "web" / ...`. Missing dir
with non-null config → startup failure. `null` semantics above.

### 3.2 Env names (frozen)

- Server: `MANURE_CONFIG` (config path; `--config` flag wins if both).
- Client/CLI: `MANURE_URL` / `MANURE_URL_FILE`, `MANURE_TOKEN` /
  `MANURE_TOKEN_FILE`, `MANURE_EXTERNAL_PASSWORD` /
  `MANURE_EXTERNAL_PASSWORD_FILE` (fetch/unlock of external artifacts).
  Direct+file both non-empty (after stripping one trailing LF/whitespace;
  empty = unset) → exit 2 `ambiguous-credentials`, no network (§9).
- Tests: `MANURE_PLAYWRIGHT_CORE_PATH` (absolute dir of `playwright-core`
  package), `MANURE_CHROMIUM_BIN` (optional override; default PATH/Nix
  chromium). No other envs. No `MANURE_ALLOW_INSECURE`: http URLs are
  accepted by the client only for loopback hosts (`127.0.0.1`, `::1`,
  `localhost`, `*.localhost`), else rejected before network.

### 3.3 Nix option names (frozen names; implemented by the Nix agent)

- `smind.services.manure.{enable, package, listenAddress, port,
  apiOrigin, contentSuffix, dataDir, users, storageQuotaBytes,
  chunkBytes, maxFileBytes, maxArtifactBytes, maxFilesPerArtifact,
  sweepInterval, incompleteSessionTtl, grantTtl, oneTimeGrantTtl,
  rateLimitPerMin, unlockRatePerMin, loopbackDev}`.
  `users` mirrors the JSON shape but with `tokenHashFile` secret-manager
  paths loaded via `LoadCredential` (haystack pattern), never store
  material. No proxy/backup/firewall options are frozen here: TLS
  terminates on the existing host edge; if the Nix agent needs more it
  requests a contract amendment. Storage is `dataDir` only.
- `smind.hm.dev.llm.manure.{enable, url, tokenFile, userId, tokenId,
  cacheDir}`. `cacheDir` is the CLI fetch/resume cache; nothing else.

## 4. Identity and auth

- Users static, exactly haystack semantics: `type` is attribution, never
  authorization. Every authenticated user lists/inspects/deletes every
  artifact. Token codec/validation identical to haystack (§0).
- API auth: `Authorization: Bearer <43-char token>` for machines;
  browser dashboard session cookie for humans (`POST /api/v1/login`
  verifies token, sets cookie; `POST /api/v1/logout` clears it). Both
  present on one request → `ambiguous-credentials` (no network side
  effects beyond the fault). `GET /api/v1/whoami` returns
  `{user_id, type, token_id}` (bearer or cookie).
- Dashboard session cookie: production `__Host-manure`, `Secure`,
  `HttpOnly`, `Path=/`, no `Domain`, `SameSite=Strict`, 180-day sliding
  renewal; loopback-dev `manure-dev` without `Secure` (browsers reject
  Secure-less `__Host-`; same split as haystack). Never in URLs,
  localStorage, logs.
- Internal content views without leaking the long-term token to uploaded
  JS: origin-safe POST one-time handoff. Authenticated dashboard client
  calls `POST /api/v1/artifacts/<id>/grants` → `{grant, expires_in_s}`
  (single-use, `one_time_grant_ttl_s`, bound to artifact+principal).
  Dashboard then top-level form-POSTs `{grant}` to
  `https://<id>.<suffix>/__manure/grant` (body, never URL). Content host
  validates, sets content grant cookie, 303-redirects to `/`. Uploaded JS
  on the content origin sees only the grant cookie (scoped to that
  artifact host), never the dashboard session or bearer token.
- External password: generated by the server at init/rotate, 32 random
  bytes base64url (43 chars), stored as SHA-256 hex only. Returned once
  in the init/rotate response; never in listings, info, manifest, logs,
  or errors (§7.5). Entry is `POST /__manure/unlock {password}` on the
  content host (body, never URL), rate-limited, constant-time compare;
  success sets the same host-only grant cookie (fresh random value bound
  to the artifact), failure is `password-invalid` with identical timing
  shape. `GET /__manure/password` serves the entry form.
- Content grant cookie: production `__Host-mgrant`, `Secure`,
  `HttpOnly`, `Path=/`, no `Domain`, `SameSite=Lax` (Lax so the
  dashboard→content top-level navigation after handoff carries it;
  dashboard session stays Strict). Loopback-dev `mgrant-dev` without
  `Secure`. Value is a fresh random grant id (NOT the password, NOT the
  one-time grant); server-side record binds it to exactly one artifact
  host and expiry (`min(grant_ttl_s, artifact TTL)`). Revoked by logout,
  artifact delete/rotate/visibility-change, TTL expiry, or timeout.
- Revocation: remove token/user from config + restart/reload; cookies and
  grants revalidate against live config/DB on every request (persistence
  ≠ immunity). Rotating an external password invalidates old password
  and all its grant cookies immediately.

## 5. Origins and browser security

### 5.1 Split

- Dashboard/API origin serves management API + dashboard shell. Content
  origin(s) serve artifact bytes inline. Artifact bytes MUST NEVER be
  served inline (or executed) under the dashboard/API origin: API byte
  downloads use `Content-Type: application/octet-stream` +
  `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff`
  + `Cross-Origin-Resource-Policy: same-origin`.
- Each artifact gets its own origin (`<artifact-id>.<content_suffix>`).
  `artifact_id` = 128-bit CSPRNG, 32 lowercase hex chars (DNS-safe,
  unguessable). Cross-artifact SOP isolation is the boundary; tests
  assert two artifacts' pages cannot read each other's DOM/storage.

### 5.2 Management APIs exist only on the API origin

Content hosts serve ONLY: `GET <file|dir-index>`, `GET /__manure/password`,
`POST /__manure/grant`, `POST /__manure/unlock`, `POST /__manure/logout`.
Any `/api/*` (or other unknown `/__manure/*`) on a content host → 404
`not-found` JSON. Tests assert this from a browser and over HTTP.

### 5.3 Reserved namespace (no collision with uploads)

- `__manure` (exact) and any path starting with `__manure/` is reserved.
  Manifest validation rejects such paths (`invalid-path`). Uploaded
  `index.html` etc. can never shadow control endpoints, and control
  endpoints never serve user bytes.
- Manifest path rules (also §6): relative POSIX only; no leading `/`,
  no drive, no backslash escapes, no NUL; `posixpath.normpath(p) == p`;
  not `.`/`..`-escaping; length ≤1024, depth ≤64; reject reserved prefix.

### 5.4 External unlock shell

`unlock_shell_dir` provides the password-entry page (static, no secrets,
`no-store`). If `null`/missing at runtime, content hosts fall back to a
built-in minimal stdlib form (same POST target, same rate limits) so the
external flow stays offline-testable.

### 5.5 Headers (normative minima)

API/dashboard responses (dynamic + shell):

- `Cross-Origin-Opener-Policy: same-origin` (defense-in-depth)
- `Cross-Origin-Resource-Policy: same-origin`
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`
- Dynamic/API/errors: `Cache-Control: no-store`. Static hashed assets
  only may be immutable-cached; shell carries no item/token data.
- Dashboard shell CSP: `default-src 'self'; base-uri 'none';
  frame-ancestors 'none'; form-action 'self'; object-src 'none'`
  (tight; dashboard has no user HTML).
- `Origin-Agent-Cluster: ?1` MAY be sent as a hint; it is NOT a boundary.

Content responses (untrusted bytes, per-artifact origin):

- `Cross-Origin-Opener-Policy: same-origin`,
  `Cross-Origin-Resource-Policy: same-origin`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`
- `Content-Security-Policy: frame-ancestors 'none'; base-uri 'none';
  form-action 'self'` (uploaded JS may run under its own origin, but it
  cannot frame anything or submit off-origin; no `sandbox` directive so
  plain static sites keep working — isolation comes from the separate
  origin, not CSP sandbox).
- Correct MIME via stdlib `mimetypes` (+ `text/html; charset=utf-8` for
  `.html`/`.htm`); unknown → `application/octet-stream`.
- No `Access-Control-Allow-Origin` on either origin by default.

### 5.6 Residual risks (explicit)

- `Origin-Agent-Cluster`, COOP/COEP/CORP are hardening hints, not the
  boundary. The boundary is: distinct origins + Host enforcement +
  Origin-checked state-changing endpoints + `__Host-` cookies.
- Parent-domain cookies/CSRF from unrelated sibling apps: manure never
  sets a `Domain=` cookie and never trusts non-`__Host-` cookies, but it
  cannot stop another app on the shared parent from setting
  `Domain=artifacts.7mind.io` cookies or from same-site (sibling) CSRF
  pressure. State-changing dashboard/content endpoints therefore require
  `Origin` checks (§5.7) in addition to cookies. For hosts that run
  unrelated apps on the parent domain, deploy content on a SEPARATE
  registrable domain (e.g. `artifacts-content.example` ≠
  `artifacts.example`); the default `<id>.artifacts.7mind.io` is
  same-site-isolated but not separate-site. Tests assert no `Domain`
  attribute on any manure cookie; the separate-domain recommendation is
  documented, not silently assumed.

### 5.7 Host and Origin checks

- Every request validates `Host`: equals the API host or
  `<hex32>.<content_suffix>` (port ignored for loopback). Else 404/400
  `bad-host`, no cookies set/read.
- Cookie-authenticated state changes (dashboard `/api/*` mutations,
  content `/__manure/*` POSTs) require `Origin` exactly equal to the
  owning origin (`api_origin` for dashboard mutations and
  `/__manure/grant`; own content origin for `/__manure/unlock|logout`).
  Missing/mismatched → `forbidden` (CSRF). Bearer-authed API calls allow
  absent `Origin` but reject a mismatched one.
- TLS: `loopback_dev=false` requires `api_origin` shorts `https:` and
  `Secure` cookies; plain-http API requests are rejected (308/403
  `tls-required`) — the edge terminates TLS. `loopback_dev=true`
  permits `http:` only for loopback hosts and uses dev cookie names.
  Fully functional default local HTTP mode uses `127.0.0.1` /
  `*.localhost` with Host dispatch; no extra hosts edits or network
  needed (§11).

## 6. Data model and storage

- Artifact: `{id (hex32), name, kind: file|dir, visibility:
  internal|external|public, created_by_user, created_by_token,
  created_at, expires_at|null, state: uploading|ready, total_bytes,
  file_count, external_password_hash|null, content_url}`.
- Manifest (per artifact): ordered list of `{path, kind: file|dir,
  size (files only), sha256 (files only, lowercase hex)}`. Empty
  directories ARE retained as `kind: dir` entries (no size/sha); upload
  MUST include them and fetch MUST recreate them. (If a future profile
  drops them it must amend here first.)
- `total_bytes` = sum of file sizes (dirs excluded). Init validation:
  per-file ≤ `max_file_bytes`, total ≤ `max_artifact_bytes`, entries ≤
  `max_files_per_artifact`, live+staging ≤ `storage_quota_bytes`, TTL
  within bounds (§12), visibility valid, paths valid (§5.3).
- Layout under `data_dir` (sqlite WAL `manure.db` + fs):
  `staging/<id>/...` (partial chunks + `manifest.json`),
  `live/<id>/...` (published tree), plus sqlite rows. Publish =
  verify-all-hashes then one `os.rename(staging/<id>, live/<id>)` (same
  filesystem) inside a single sqlite transaction flipping
  `uploading→ready`. No partial visibility. Restarts reload
  staging+sqlite; `upload-status` reports received/missing ranges.
- No symlinks (upload entries that are symlinks are rejected; server
  never creates/follows symlinks; fetch writes regular files/dirs only,
  validates each path pre-write, uses temp-file + rename per file, never
  follows existing symlinks), no traversal (validated + contained
  join), no archive extraction (there is no archive path; chunks are raw
  file bytes keyed by manifest path).
- TTL: `expires_at` set at init (`expires_in_s`) and patchable by any
  authenticated user (shorten/extend/clear within `max_ttl_s`). Expiry
  is authorization-immediate: after `expires_at` every read/grant/unlock
  fails (`expired`: 410 for authenticated API reads, 404 on content and
  for anonymous) even before the sweeper runs. The sweeper (every
  `sweep_interval_s`) physically deletes expired artifacts, orphan
  staging older than `incomplete_session_ttl_s`, and expired grants.
- Incomplete-session ownership (explicit decision): the creating
  `user_id` owns mutation of an `uploading` artifact (chunk PUTs,
  publish, visibility/TTL patch while uploading). Other user_ids get
  `session-not-owned` (403) on those. Rationale: prevents concurrent
  interference between agents/humans while surviving token rotation
  within one identity. Reads (`info`, `upload-status`, `files`) and
  `delete` (abort) are allowed to ANY authenticated user, consistent
  with "every user sees/deletes all artifacts" and letting anyone GC a
  stuck session. Chunk design (§8) is idempotent so same-owner retries
  are safe.

## 7. REST API v1 (API origin prefix `/api/v1` + content-host controls)

JSON bodies; errors `{error: {code, message}}` with stable codes, no
secrets/hashes/paths-beyond-request in messages. Auth per §4.

| Method + path | Auth | Request | Response |
|---|---|---|---|
| `POST /api/v1/login` | token in body | `{token}` | sets session cookie; `{user: {user_id, type, token_id}}` |
| `POST /api/v1/logout` | cookie | — | clears session cookie |
| `GET /api/v1/whoami` | bearer/cookie | — | `{user_id, type, token_id}` |
| `GET /api/v1/health` | none | — | `{ok: true, version}` (no storage details) |
| `GET /api/v1/artifacts?limit=&cursor=&include_expired=false&visibility=&state=` | authed (any user) | pagination | `{artifacts: [ArtifactSummary...], next_cursor: str\|null}`; summaries NEVER contain password/hash/file-sha/grant values |
| `POST /api/v1/artifacts:init` | authed | `{name, kind: file\|dir, visibility, expires_in_s?, files: [{path, kind, size?, sha256?}]}` | `{artifact_id, chunk_bytes, content_url, external_password?}` — `external_password` present exactly once iff `visibility == external` at init; never again from this endpoint |
| `GET /api/v1/artifacts/<id>` | authed (expired → 410) | — | `ArtifactSummary` (no secrets/hashes) |
| `PATCH /api/v1/artifacts/<id>` | authed (owner-only while `uploading`, any user once `ready`) | `{visibility?, expires_in_s?\|null}` | summary; switching TO external generates+returns `{external_password}` once; switching AWAY clears hash + kills grants; rotation is separate |
| `DELETE /api/v1/artifacts/<id>` | authed (any user) | — | `{deleted: true}` (also aborts `uploading`, kills grants) |
| `POST /api/v1/artifacts/<id>/external-password:rotate` | authed (any user; `ready` or `uploading`) | — | `{external_password}` once; old password + grants dead immediately; non-external artifact → `invalid-visibility` |
| `GET /api/v1/artifacts/<id>/files` | authed for internal; authed OR (public anon) for public; external NEVER anon here (use content unlock) | — | `{files: [{path, kind, size?, sha256?}], ...}` — the ONLY listing carrying hashes; never in list/info |
| `GET /api/v1/artifacts/<id>/upload-status` | authed (any user) | — | `{state, chunk_bytes, files: [{path, size, received_ranges: [[s,e]...], received_bytes}]}` |
| `PUT /api/v1/artifacts/<id>/chunks?path=<urlenc>&offset=<n>` | authed owner-only while `uploading` | `application/octet-stream` body = one chunk; req header `X-Chunk-Sha256: <hex>` | `{received_bytes}`; misaligned/oversize/hash-mismatch → 400/409; non-owner → 403 |
| `POST /api/v1/artifacts/<id>/publish` | authed owner-only | — (all bytes present + hashes verified) | `{artifact_id, content_url}` (NO password here) |
| `GET /api/v1/artifacts/<id>/files/<p>/content` | internal: authed; public: anon ok; external: authed only (anon uses content host) | — | bytes as `attachment` (never inline), `Accept-Ranges` + `Range` support for resume |
| `POST /api/v1/artifacts/<id>/grants` | authed; internal `ready` only | — | `{grant, expires_in_s}` one-time handoff (60 s default) |

Content-host controls (`https://<id>.<suffix>`):

| Method + path | Auth | Notes |
|---|---|---|
| `GET /<path>` | public anon; internal/external need grant cookie | dirs/ `/` serve `<dir>/index.html` then `<dir>/index.htm` else 404 (never a listing). External without grant → password form; internal without grant → 401 `grant-required` (built-in hint page linking back to dashboard URL from config, no secrets). |
| `GET /__manure/password` | — | password form (external `ready` only; else 404) |
| `POST /__manure/unlock` | password in JSON body `{password}` | rate-limited; sets `mgrant` cookie; no URL secrets anywhere |
| `POST /__manure/grant` | one-time `{grant}` in body, `Origin == api_origin` | sets `mgrant` cookie; single-use |
| `POST /__manure/logout` | grant cookie, own-Origin | clears grant cookie |

Error codes (stable; HTTP in parentheses): `bad-envelope` (400),
`invalid-path` (400), `invalid-manifest` (400), `invalid-range` (400),
`invalid-ttl` (400), `invalid-visibility` (400), `bad-host` (400),
`ambiguous-credentials` (400), `unauthorized` (401),
`password-required`/`password-invalid` (401), `grant-required`/
`grant-invalid`/`grant-expired` (401), `session-not-owned` (403),
`forbidden` = CSRF/origin (403), `not-found` (404),
`chunk-conflict` (409), `state-conflict` (409),
`expired` (410 authed / 404 anon+content), `too-large`/
`quota-exceeded` (413), `rate-limited` (429), `unavailable` (503),
`tls-required` (403 or 308 per edge), `dashboard-disabled` (404).
No password/hash/token/grant values in faults or logs (allowlisted
logging: route label, request id, timing, status, principal/token
LABELS, artifact id, byte counts only).

### 7.5 Password/hash non-leak rule (normative)

No response under `GET /api/v1/artifacts*` (list/info), no error, no
log line, and no `publish` response carries `external_password`,
`external_password_hash`, per-file `sha256`, or grant values. Hashes
appear only in `GET .../files` (authorized readers) and in the
server-side DB. Password plaintext appears only in the init/rotate
response that created it and in the unlock POST body. Retry-after-loss
= `rotate` (any authenticated user). Tests assert the negative.

## 8. Upload protocol (mandatory chunked, bounded, resumable)

1. `init` with full manifest (including empty-dir entries). Server
   returns `artifact_id`, authoritative `chunk_bytes`, `content_url`
   (+ one-time `external_password` iff external).
2. Client splits each file on deterministic `chunk_bytes` boundaries
   (all chunks except each file's tail MUST be exactly `chunk_bytes`;
   misaligned → `invalid-range`). Chunk `PUT` carries raw bytes with
   `?path=&offset=` and `X-Chunk-Sha256`. Server verifies length/hash,
   appends idempotently: identical `(offset, bytes, sha)` re-PUT → 200
   no-op; same offset different bytes → 409 `chunk-conflict`.
3. Disconnects/restarts resume via `upload-status` (received ranges per
   file persisted in sqlite + staging bytes on disk). CLI/MCP MUST
   implement resume (skip received ranges), never restart from zero
   when status shows progress.
4. `publish` when every file is complete. Server re-verifies every
   per-file SHA-256 against the manifest, then atomically publishes
   (§6). Hash mismatch → 409, stays `uploading`.
5. Fetch (`files` + per-file `content` GETs with `Range`) streams,
   writes temp + rename per file, verifies SHA-256, recreates empty
   dirs, never creates/follows symlinks, caps total bytes against
   quota/bounds before writing.

## 9. CLI (frozen)

Commands: `list [--limit N] [--cursor C] [--include-expired]
[--visibility V] [--state S] [--json]`, `info <id> [--json]`,
`upload <path> [--name N] --access internal|external|public
[--expires-in 3600|30m|7d|...] [--json]`,
`fetch <id-or-url> <dest> [--password P] [--password-file F] [--json]`,
`delete <id>`, `rotate-password <id> [--json]`, `whoami [--json]`.
`upload` of a directory walks regular files + empty dirs (never
symlinks), posts the manifest, streams chunk-resumable PUTs, publishes,
prints `{artifact_id, content_url, access, expires_at}` and — ONLY for
`--access external` at create time — `{external_password}` once.
`fetch` recreates the tree safely (§8), resumes partial files, streams
(no whole-artifact buffering).

Env precedence: for each pair (`MANURE_URL`/`MANURE_URL_FILE`,
`MANURE_TOKEN`/`MANURE_TOKEN_FILE`,
`MANURE_EXTERNAL_PASSWORD`/`MANURE_EXTERNAL_PASSWORD_FILE`): strip one
trailing LF then surrounding whitespace; empty = unset; both non-empty
→ stderr `ambiguous-credentials` + exit 2, no network. Token files use
the haystack exact-byte rule (43 base64url chars + at most one LF).
URL files hold one URL (http only for loopback hosts, else reject).
`fetch` of public artifacts works without any token; all other authed
commands fail clearly (`missing-credentials`, exit 2) before network.

## 10. MCP stdio tools + skill

`python -m manure.mcp` speaks line-delimited JSON over stdio (stdlib
only): request `{"id": N, "tool": "<name>", "params": {...}}` →
response `{"id": N, "ok": true, "result": {...}}` or `{"id": N, "ok":
false, "error": {"code": "...", "message": "..."}}`. Tools (frozen
names): `whoami {}`, `list_artifacts {limit?, cursor?,
include_expired?}`, `get_artifact {artifact_id}`,
`get_manifest {artifact_id}`, `upload_artifact {local_path, access,
expires_in_s?, name?}`, `fetch_artifact {artifact_id, dest_dir,
password?}`, `delete_artifact {artifact_id}`,
`rotate_external_password {artifact_id}`. Uploads/fetches chunk-resume
like the CLI (MCP wraps the same client code, not shell-outs). The
skill at `manure/skill/SKILL.md` (client-agent owned) documents bearer
setup, visibility choice, TTL syntax, resume behavior, and the
external-password-once rule; it MUST NOT embed credentials.

## 11. Test fixtures and browser harness (frozen)

- Standalone server fixture (integration + browser tests alike):

  ```python
  from manure.server import create_server, ServerConfig
  config = ServerConfig(data_dir=str(tmp_path), api_origin=...,
                        content_suffix=..., loopback_dev=True, users=[...])
  server = create_server(config)          # ThreadingHTTPServer, ephemeral port when port=0
  try:
      api = server.api_url                # e.g. http://127.0.0.1:PORT
      content = server.content_url(artifact_id)
      ...
  finally:
      server.close()
  # or: with create_server(config) as server: ...
  ```

  No subprocess servers in tests except `test_cli_*` (which may exec
  `python -m manure.server --config ...` against tmp dirs). No module
  globals; parallel tests use separate `data_dir`s/ports.
- `ManureClient` import: `from manure.client import ManureClient`.
- Browser tests (`manure/tests/test_browser_*.py`, unittest-discoverable)
  drive the REAL Chromium via the installed `playwright-core` JS driver:
  Node ≥24 executes small `.mjs` helpers from the test via subprocess;
  Python asserts. Driver resolution: `MANURE_PLAYWRIGHT_CORE_PATH` MUST
  be an absolute directory containing `playwright-core`'s `package.json`
  (dev-only; e.g. the repo's `haystack/node_modules/playwright-core`
  or the Nix-provided driver). Chromium via `MANURE_CHROMIUM_BIN` else
  PATH/Nix chromium. Tests `SkipTest` cleanly when either is absent;
  the Nix check provides both. No global installs, no private network:
  local runs use `artifacts.localhost`-style suffixes with Chromium
  `--host-resolver-rules="MAP *.artifacts.localhost 127.0.0.1"`.
- Offline: the full non-browser suite (`test_server_*`,
  `test_storage_*`, `test_client_*`, `test_cli_*`, `test_mcp_*`,
  `test_contract_*`) runs with stdlib only, no network, no playwright.

## 12. Defaults and limits (normative)

`chunk_bytes=1048576` (256 KiB–4 MiB); `max_file_bytes=512 MiB`;
`max_artifact_bytes=2 GiB`; `max_files_per_artifact=10000`;
path ≤1024 chars, depth ≤64; `storage_quota_bytes=20 GiB`;
list default `50`, ceiling `max_list_limit=200`;
`rate_limit_per_min=600`, `unlock_rate_per_min=10` per artifact+IP;
session cookie 180 d sliding; grant `grant_ttl_s=86400` (capped by TTL);
one-time grant 60 s single-use; `sweep_interval_s=300`;
`incomplete_session_ttl_s=86400`; TTL grammar
`<seconds>|<n>s|m|h|d` (e.g. `3600`, `30m`, `7d`), `max_ttl_s=31536000`
(365 d); server port `47329`; API prefix `/api/v1`. These are the ONLY
tunable bounds; anything else is an amendment.

## 13. Acceptance matrix

H = here (this skeleton: metadata/agreement only). S/C/U/N = later
server/client/UI+security/Nix agents. All rows MUST pass before release.

| # | Check | Owner | How |
|---|---|---|---|
| F1 | upload file + fetch round-trip (bytes+sha identical) | S/C | unittest offline |
| F2 | upload dir incl. EMPTY dirs recreated; `index.html` preferred over `index.htm`; dir without index → 404, never listing | S/C/U | unittest + browser |
| F3 | visibilities: internal (authed ok, anon denied), external (password unlock, no URL secret), public (anon ok) | S/C/U | unittest + browser |
| F4 | every user lists/inspects/deletes all artifacts; incomplete mutation owner-only (403 `session-not-owned` cross-user), delete-anyone | S | unittest |
| F5 | TTL: immediate auth cut-off (410 authed/404 anon+content) + sweeper physically removes | S | unittest (fake clock + sweep) |
| F6 | resume: kill mid-upload → `upload-status` → resume completes; duplicate chunk idempotent; conflicting chunk 409 | S/C | unittest |
| F7 | atomic publish: no partial tree visible pre-publish; restart mid-publish recovers cleanly | S | unittest |
| F8 | list pagination (`limit`/`cursor`/`next_cursor`), `files` metadata endpoint carries hashes; list/info carry none | S | unittest |
| F9 | CLI env precedence: direct+file → exit 2 `ambiguous-credentials` no-network; exact-byte token files | C | unittest |
| F10 | MCP stdio round-trip for all §10 tools; upload/fetch resume via MCP | C | unittest (stdlib subprocess) |
| B1 | dashboard login sets `__Host-`/`-dev` session, NO `Domain` attr; CSRF without `Origin` rejected | U | browser + HTTP |
| B2 | internal view: one-time grant POST handoff sets `Lax` grant cookie; uploaded JS cannot read dashboard token (assert via page JS: no token in `document.cookie`/storage/DOM) | U | browser |
| B3 | external unlock: password POST (no URL secret), wrong password 401 + rate-limit, grant revocable via rotate | U | browser |
| B4 | content isolation: artifact A JS cannot read artifact B (SOP); `/api/*` on content host 404s; framing blocked (`frame-ancestors 'none'`) | U | browser |
| B5 | API byte downloads are `attachment`, never execute under API origin (navigate-to-download-URL yields attachment, not HTML execution) | U | browser |
| B6 | reserved `__manure/*` never servable as user content; manifest with it rejected | S/U | unittest + browser |
| N1 | Nix eval: options shape, `LoadCredential` digests (no material), storage paths configurable, service starts, health ok | N | `nix flake check` |
| M1 | H: `pyproject.toml` parses stdlib-only, version triple-agrees, entrypoints frozen, no impl modules, no root/nix changes | H | `test_contract_*` |

## 14. Versioning

Contract `0.1.0`. Any change to paths, envelopes, codes, cookie names,
env/config/Nix names, entrypoints, fixture signatures, defaults, or the
reserved namespace requires a version bump + amendment note here.
Additive new tools/endpoints are minor; breaking/rename/removal is
major. Builders MUST NOT accept or emit anything outside this document.
