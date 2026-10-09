# manure — file & directory hosting (frozen contract v0.2.0)

Freeze for implementation. Later agents build strictly to this document.
No drift without a contract amendment. Runtime is Python ≥3.12 stdlib
only (`http.server`, `sqlite3`, `hashlib`, `urllib`, MCP over stdio line
JSON-RPC). Typed dataclasses, explicit constructor dependencies, no
global mutable state.

## 0. Status and references

- Version: `0.2.0` (this file + `pyproject.toml` + `manure/__init__.py`
  `__version__` must agree).
- Candidate-1 was never frozen. Candidate-2 dispositions (reviewer notes):
  bespoke `{id,tool,params}` RPC dropped — §10 is now real JSON-RPC 2.0
  MCP stdio; external token-free download added via authorized content
  endpoints (`/__manure/manifest`, `/__manure/files/...`, R6); browser
  POSTs use `application/x-www-form-urlencoded` with 303 (R1); crash
  recovery given durable ordering + reconciliation (R3); metadata
  separated from payload tree with manifest topology rules (R4);
  resource bounds, reservation, throttling added (R5); exact schemas,
  examples, state matrix added (R7); edge trust boundary frozen with
  minimal proxy options (R8); CLI resume/cache frozen (R9); single
  web-asset resolution rule frozen (R10); M1 sunset at first
  implementation commit; fixture exposes effective origin for port 0.
- Review round 1 dispositions (contract stays `0.2.0`; documents the
  already-implemented wire, no new protocol): web-asset staging made
  an explicit Nix-owned pre-build step, wheel/sdist guarantees
  conditional on it (R1, §11/M2); client ownership paths corrected to
  `manure/manure/cli.py` + `manure/manure/mcp.py` (R2, §1); init/PATCH
  request objects, unknown-field rejection (for server-side
  validation), and management success statuses/envelopes documented
  to the implemented shapes — init key `files`, flat JSON login
  identity, form-login/logout 303s, PATCH keeps
  name/visibility/expires_in_s, delete `{ok:true}`, rotate
  `{external_password}` only, publish `{artifact_id,state,
  content_url}`, manifests `{artifact_id,state,files}` (R3 correction,
  §§7.1–7.2); MCP initialize shape + per-tool inputSchemas frozen
  against spec `2025-11-25` (R4, §10); dashboard CSP wildcard carries
  the effective non-default content port (R5, §5.5);
  `/__manure/grant` exempted to API Origin + grant-invalid/expired
  aligned to 403 (R6, §§7.3–7.4/9); server-side no-follow containment
  added (R7, §6.6); decoded-segment `/` explicitly rejected (A1,
  §7.3).
- Security clarification (no version change; reproduced Chromium 154
  constraint): trusted HTML ONLY (dashboard shell plus
  server-generated unlock/password form HTML) is served
  `Referrer-Policy: strict-origin` (origin-only, no
  path/query, no HTTPS-downgrade leak) because `no-referrer` on a
  navigational form POST yields `Origin: null`, which exact-Origin
  checks always reject; API JSON/dynamic responses and uploaded
  untrusted bytes retain `no-referrer`;
  the no-URL-secrets invariant (§7.5) is unchanged; B2/B3b assert the
  served policy and a non-`null` form-POST Origin.
- Dashboard/API origin (production): `https://artifacts.7mind.io`.
- Content origin (default): `https://<artifact-id>.artifacts.7mind.io`.
  A separate registrable content suffix/domain is configurable and
  strongly recommended (see §5.6).
- Auth codec follows haystack (`haystack/docs/auth.md`, `server/src/auth/`):
  32 random bytes → 43-char canonical unpadded base64url. Canonical
  means exactly: 43 ASCII chars from the URL-safe base64 alphabet that
  url-base64-decode to 32 bytes and re-encode to the identical 43 chars
  (non-canonical forms are rejected, never normalized). Direct values
  (env, `Authorization: Bearer`, login bodies, cookies) are matched
  exactly: no terminator, no surrounding trim. Plaintext token files
  hold the 43 chars plus at most one final LF (CR, NUL, non-ASCII,
  multiline, extra LF, or surrounding whitespace → rejected). SHA-256
  hex digests live server-side (digest files: 64 lowercase hex plus at
  most one final LF); constant-time compare; generation never via
  argv/logs.
- Browser cookie rules cite
  <https://developer.mozilla.org/en-US/docs/Web/Security/Practical_implementation_guides/Cookies>
  (`__Host-` + `Secure` + `Path=/`, no `Domain`, `HttpOnly`).
- `Origin-Agent-Cluster` MUST be emitted (see §5.5) but is an optional
  performance hint and explicitly NOT a security boundary, per
  <https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Origin-Agent-Cluster>.
  Actual controls are SOP separate origins, Host checks, Origin-checked
  APIs, `__Host-` cookies, and content restrictions below.

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
| Contract (this task) | `manure/CONTRACT.md`, `manure/pyproject.toml`, `manure/MANIFEST.in`, `manure/README.md`, `manure/.gitignore`, `manure/manure/__init__.py`, `manure/tests/test_contract_*.py` (sunsets, §13 M1) |
| Server agent | `manure/manure/server.py`, `manure/manure/domain.py`, `manure/manure/storage.py`, `manure/manure/auth.py`, `manure/tests/test_server_*.py`, `manure/tests/test_storage_*.py` |
| Client agent | `manure/manure/client.py`, `manure/manure/cli.py`, `manure/manure/mcp.py`, `manure/tests/test_client_*.py`, `manure/tests/test_cli_*.py`, `manure/tests/test_mcp_*.py`, `manure/skill/SKILL.md` |
| UI/security agent | `manure/web/*` sources (dashboard shell + unlock shell), `manure/tests/test_browser_*.py` (+ `manure/tests/browser_fixtures.py` helper only) |
| Nix agent | `nix/nixos/manure.nix`, `nix/hm/manure.nix`, `nix/pkg/manure/package.nix` (owns the web-tree copy/install mapping, §11), root `flake.nix`/`flake.lock` edits |

Packaging-metadata adjustments (pyproject package-data, sdist include)
are contract-owned; the Nix copy rule is Nix-owned (§11).

Test discovery is `python -m unittest discover -s manure/tests -p "test_*.py"`.
Filename prefixes above are exclusive. `test_contract_*` runs
pre-implementation only and MUST be removed/replaced at the first
implementation commit (see M1).

This task implements no `server.py`/`client.py`/`cli.py`/`mcp.py`/
`domain.py`/`storage.py`/`auth.py`, no `web/*`, no `nix/*`, no root
flake edits.

## 2. Runtime and entrypoints (frozen)

- `requires-python >= 3.12`. Zero runtime dependencies
  (`pyproject.toml` `[project] dependencies = []`). Test-only browser
  driver and MCP SDK interop check are NOT runtime dependencies (§11).
  Service/storage supported runtime is Linux: the exclusive `data_dir`
  claim requires Linux abstract Unix sockets and fails closed elsewhere
  (`unavailable`); CLI/MCP client portability beyond Linux is unverified.
- Modules (frozen import paths; signatures below are minimal, agents may
  add private helpers but not change these):
  - `manure.server`: `create_server(config: ServerConfig) -> RunningServer`,
    `ServerConfig` dataclass (§3), `RunningServer` with
    `api_url: str`, `bound_port: int`, `effective_api_origin: str`,
    `content_url(artifact_id: str) -> str`,
    `close() -> None`, context-manager support. `main()` for
    `python -m manure.server --config PATH`.
  - `manure.client`: `ManureClient(api_base, token=None, token_file=None,
    cache_dir=None)` (token/token_file ambiguity → `AmbiguousCredentials`
    without network, §9).
  - `manure.cli`: `main(argv=None) -> int`.
  - `manure.mcp`: `main() -> None` (JSON-RPC stdio loop, §10).
  - `manure.domain`, `manure.storage`, `manure.auth`: dataclasses and
    helpers; no network/globals.
- Entrypoints: `python -m manure.server`, `python -m manure.cli`,
  `python -m manure.mcp`; console scripts `manure-server`, `manure`,
  `manure-mcp` map to the same `main`s. `manure/__init__.py` exposes
  only `__version__ = "0.2.0"` (plus `__all__`).
- Single-socket Host dispatch: one bounded-thread HTTP server
  (`http.server.ThreadingHTTPServer` + connection semaphore, §12) serves
  both the API host and `<id>.<content_suffix>` hosts, routed by `Host`.
  No globals; all state via explicit `data_dir`/sqlite handles.

## 3. Configuration (closed sets — no other options without amendment)

### 3.1 Server JSON config (pointed at by `--config` / `MANURE_CONFIG`)

Top-level keys are exactly (unknown keys → startup failure, fail closed):

| Key | Type | Default | Notes |
|---|---|---|---|
| `listen_address` | str | `"127.0.0.1"` | Non-loopback requires documented operator ack (Nix layer); server itself only binds. |
| `port` | int | `47329` | `0` = ephemeral (tests; see `effective_api_origin`, §11). |
| `data_dir` | str | — (required) | sqlite + staging + live dirs live here. Tests use tmp. |
| `api_origin` | str | — (required) | e.g. `https://artifacts.7mind.io`; local `http://127.0.0.1:PORT`. |
| `content_suffix` | str | — (required) | e.g. `artifacts.7mind.io`; local `artifacts.localhost`. Content host `<id>.<suffix>`. |
| `loopback_dev` | bool | `false` | `true` allows http + non-Secure dev cookies on loopback only (§5.7). Production MUST be `false`. |
| `trusted_proxies` | list[str] | `["127.0.0.1/32", "::1/128"]` | CIDRs whose `X-Forwarded-Proto` is honored (§5.8). All other forwarded headers ignored. |
| `dashboard_dir` | str\|null | package `manure/manure/web/dashboard` (repo fallback `manure/web/dashboard`, §11) | `null` = JSON API only (`dashboard-disabled`). |
| `unlock_shell_dir` | str\|null | package `manure/manure/web/unlock` (repo fallback `manure/web/unlock`, §11) | `null` = built-in minimal unlock form (§5.4). |
| `users` | list | `[]` (≥1 required, fail closed) | `{id, type: human\|agent, displayName?, tokens: [{id, hashFile}]}`. Type is attribution only. |
| `storage_quota_bytes` | int | `21474836480` (20 GiB) | Cap enforced by atomic reservation (§6), not best-effort check. |
| `chunk_bytes` | int | `1048576` | Server-dictated; 256 KiB–4 MiB enforced. |
| `max_file_bytes` | int | `536870912` (512 MiB) | Per file. |
| `max_artifact_bytes` | int | `2147483648` (2 GiB) | Sum of file sizes; reserved at init. |
| `max_files_per_artifact` | int | `10000` | Files + dir entries. |
| `max_request_body_bytes` | int | `4194304` (4 MiB) | All non-chunk request bodies; over → 413 before parsing. Chunk PUT bodies capped at `chunk_bytes` (§8). |
| `max_list_limit` | int | `200` | List pagination ceiling. |
| `max_connections` | int | `128` | Global concurrent-request semaphore; excess → 503 `unavailable` + `Retry-After`. |
| `request_timeout_s` | int | `30` | Per-connection socket timeout (slow-request bound). |
| `max_sessions_per_user` | int | `10` | Concurrent `uploading` artifacts per user_id; over → 429 `session-limit`. |
| `max_sessions_global` | int | `1000` | Concurrent `uploading` artifacts total; over → 429 `session-limit`. |
| `max_grants_per_artifact` | int | `10000` | Grant cookies per artifact; oldest evicted. |
| `rate_map_max_entries` | int | `4096` | In-memory throttle-table cap; LRU eviction. |
| `rate_limit_per_min` | int | `600` | Per-principal API mutations (haystack-like). |
| `unlock_rate_per_min` | int | `10` | Per artifact + socket-peer-IP password attempts. |
| `login_rate_per_min_per_ip` | int | `10` | Per socket-peer-IP logins (XFF never used, §5.8). |
| `sweep_interval_s` | int | `300` | Expired/orphan sweeper period. |
| `incomplete_session_ttl_s` | int | `86400` | Idle `uploading` sessions become sweepable (§6). |
| `grant_ttl_s` | int | `86400` | Content grant lifetime (capped by artifact TTL). |
| `one_time_grant_ttl_s` | int | `60` | Single-use handoff grant lifetime. |

Dashboard sessions are stateless (cookie revalidated per request against
live config; no server-side session table, hence no session-count bound
beyond the throttle map). Web asset loading: explicit
`dashboard_dir`/`unlock_shell_dir` with the §11 resolution order; a
configured-but-missing dir → startup failure. `null` semantics above.

### 3.2 Env names (frozen)

- Server: `MANURE_CONFIG` (config path; `--config` flag wins if both).
- Client/CLI: `MANURE_URL` / `MANURE_URL_FILE`, `MANURE_TOKEN` /
  `MANURE_TOKEN_FILE`, `MANURE_EXTERNAL_PASSWORD` /
  `MANURE_EXTERNAL_PASSWORD_FILE` (external unlock/fetch), secret pairs
  with ambiguous-direct+file rejection (§9). `MANURE_CACHE_DIR`
  (non-secret upload-session cache; precedence flag > env > HM default >
  `~/.cache/manure`; no ambiguity error, first-set wins).
- Tests: `MANURE_PLAYWRIGHT_CORE_PATH` (absolute dir of `playwright-core`
  package), `MANURE_CHROMIUM_BIN` (optional override; default PATH/Nix
  chromium), `MANURE_MCP_SDK_PATH` (absolute dir of the official
  `@modelcontextprotocol/sdk` package), `MANURE_OPENSSL_BIN` (optional
  override; default PATH/Nix openssl). No other envs. No `MANURE_ALLOW_INSECURE`: http URLs are
  accepted by the client only for loopback hosts (`127.0.0.1`, `::1`,
  `localhost`, `*.localhost`), else rejected before network.

### 3.3 Nix option names (frozen names; implemented by the Nix agent)

- `smind.services.manure.{enable, package, listenAddress, port,
  apiOrigin, contentSuffix, dataDir, users, storageQuotaBytes,
  chunkBytes, maxFileBytes, maxArtifactBytes, maxFilesPerArtifact,
  maxRequestBodyBytes, maxConnections, requestTimeoutS,
  maxSessionsPerUser, maxSessionsGlobal, maxGrantsPerArtifact,
  loginRatePerMinPerIp, sweepInterval, incompleteSessionTtl, grantTtl,
  oneTimeGrantTtl, rateLimitPerMin, unlockRatePerMin, loopbackDev,
  trustedProxies, dashboardDir, unlockShellDir,
  proxy.{enable, acmeHost, openFirewall}}`.
  `users` mirrors the JSON shape but with `tokenHashFile` secret-manager
  paths loaded via `LoadCredential` (haystack pattern), never store
  material. The `proxy.*` trio + `trustedProxies` are the whole edge
  contract (§5.8); the edge MUST forward Host intact and terminate TLS.
- `smind.hm.dev.llm.manure.{enable, url, tokenFile, userId, tokenId,
  cacheDir}`. `cacheDir` feeds the CLI default cache (§9). Nothing else.

## 4. Identity and auth

- Users static, exactly haystack semantics: `type` is attribution, never
  authorization. Every authenticated user lists/inspects/deletes every
  artifact. Token codec/validation identical to haystack (§0).
- API auth: `Authorization: Bearer <43-char token>` for machines;
  browser dashboard session cookie for humans (`POST /api/v1/login`
  verifies token, sets cookie; `POST /api/v1/logout` clears it). Both
  present on one request → `ambiguous-credentials` (no side effects).
  `GET /api/v1/whoami` returns `{user_id, type, token_id}`.
- `POST /api/v1/login` ALWAYS requires an exact `Origin == api_origin`
  (missing or mismatched → 403, no cookie, no session effect): login sets
  a credentialed cookie from a body token, so it is CSRF-relevant even
  without a pre-existing cookie. Bearer-authed non-login mutations allow
  absent `Origin` but reject a mismatched one; cookie-authed mutations
  always require exact `api_origin`.
- Dashboard session cookie: production `__Host-manure`, `Secure`,
  `HttpOnly`, `Path=/`, no `Domain`, `SameSite=Strict`, 180-day sliding
  renewal; loopback-dev `manure-dev` without `Secure` (browsers reject
  Secure-less `__Host-`; same split as haystack). Never in URLs,
  localStorage, logs.
- Internal content views without leaking the long-term token to uploaded
  JS: origin-safe POST one-time handoff. Authenticated dashboard client
  calls `POST /api/v1/artifacts/<id>/grants` → `{grant, expires_in_s}`
  (single-use, `one_time_grant_ttl_s`, bound to artifact+principal).
  Dashboard then top-level form-POSTs the grant (urlencoded body, never
  URL) to `https://<id>.<suffix>/__manure/grant` (see §7 for encodings
  and 303). Uploaded JS on the content origin sees only the grant cookie
  (scoped to that artifact host), never the dashboard session or bearer.
- External password: generated by the server at init/rotate/patch-to-
  external, 32 random bytes base64url (43 chars), stored as SHA-256 hex
  only. Returned once in the generating response; never in listings,
  info, manifest, publish, logs, or errors (§7.5). Entry is
  `POST /__manure/unlock` on the content host (body, never URL),
  rate-limited, constant-time compare; success sets a host-only grant
  cookie (fresh random value bound to the artifact), failure is
  `password-invalid` with identical timing shape.
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
  and all its grant cookies immediately. Rotation is deletion-class: any
  authenticated user, any state (no upload-ownership check, §7).

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
  Nothing manure does re-enables `document.domain` relaxation (removed
  in modern Chromium); uploaded pages get no affordance to weaken it.

### 5.2 Management APIs exist only on the API origin

Content hosts serve ONLY the §7 control/file routes (`GET` files and
indexes, `GET /__manure/password`, `GET /__manure/manifest`,
`GET /__manure/files/...`, `POST /__manure/grant|unlock|logout`).
Any `/api/*` (or other unknown `/__manure/*`) on a content host → 404
`not-found` JSON. Tests assert this from a browser and over HTTP.

### 5.3 Reserved namespace (no collision with uploads)

- Reserved top-level segments: `__manure` and `api`. Manifest validation
  rejects any entry equal to one of these or starting with `seg + "/"`
  (`invalid-path`). Rationale: uploaded `api/...` files would be
  unservable-but-confusing under the §5.2 no-`/api/*` rule, and
  `__manure/...` would shadow control endpoints.
- Manifest path rules (also §6): relative POSIX only; no leading `/`,
  no drive, no backslash escapes, no NUL; `posixpath.normpath(p) == p`;
  not `.`/`..`-escaping; length ≤1024, depth ≤64; reject reserved prefix.
  `manifest.json` as a user filename is ALLOWED (private metadata lives
  in the sidecar, §6, never in the tree).

### 5.4 External unlock shell

`unlock_shell_dir` provides the password-entry page (static, no secrets,
`no-store`). If `null`, content hosts fall back to a built-in minimal
stdlib form (same field names, target, and rate limits, §7) so the
external flow stays offline-testable. Both shells POST urlencoded to
`/__manure/unlock` on the SAME content origin (no cross-origin form
issue); only the dashboard→content grant handoff is cross-origin
(form-action entry below covers it).

### 5.5 Headers (normative minima)

API/dashboard responses (dynamic + shell). `Origin-Agent-Cluster: ?1`
MUST be emitted on all responses (normative emission); it remains a
performance hint, NOT the boundary (§0).

- `Cross-Origin-Opener-Policy: same-origin` (defense-in-depth)
- `Cross-Origin-Resource-Policy: same-origin`
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`
  for API JSON/dynamic/error responses; `Referrer-Policy:
  strict-origin` ONLY for trusted HTML documents (the dashboard shell
  page; server-generated unlock/password forms are covered by the
  content-origin exception below). `strict-origin` is origin-only
  (no path/query, no HTTPS→HTTP downgrade leak) and REQUIRED on those
  pages so Chromium sends a real `Origin` on navigational form POSTs —
  `no-referrer` there yields `Origin: null`, which §5.7 always
  rejects — while secrets never appear in URLs per §7.5, so the
  origin-only referrer exposes nothing)
- Dynamic/API/errors: `Cache-Control: no-store`. Static hashed assets
  only may be immutable-cached; shell carries no item/token data.
- Dashboard shell CSP, delivered via response HEADER computed from
  config (static files stay static):
  `default-src 'self'; base-uri 'none'; frame-ancestors 'none';
  form-action 'self' <scheme>://*.<content_suffix><port>; object-src 'none'`
  where `<scheme>` matches `api_origin` (`https` prod, `http` loopback)
  and `<port>` is empty for the scheme default (production `https`/443)
  but MUST carry the effective content port otherwise — including local
  `47329` and the port-0 bound port (via `effective_api_origin`, §11) —
  or the handoff POST is CSP-blocked. The wildcard entry exists exactly
  to permit the grant-handoff form POST to per-artifact hosts; tests
  assert it contains the configured suffix and nothing broader.
- Content responses (untrusted bytes, per-artifact origin):
  `Cross-Origin-Opener-Policy: same-origin`,
  `Cross-Origin-Resource-Policy: same-origin`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`
  (uploaded bytes stay origin-hiding; EXCEPTION: server-generated
  auth forms — the built-in `null`-fallback unlock form — are served
  `Referrer-Policy: strict-origin` for the same Chromium form-POST
  reason as above),
  `Content-Security-Policy: frame-ancestors 'none'; base-uri 'none';
  form-action 'self'` (uploaded JS may run under its own origin, but it
  cannot frame anything or submit off-origin; no `sandbox` directive so
  plain static sites keep working — isolation comes from the separate
  origin, not CSP sandbox).
- Correct MIME via stdlib `mimetypes` (+ `text/html; charset=utf-8` for
  `.html`/`.htm`); unknown → `application/octet-stream`.
- No `Access-Control-Allow-Origin` on either origin by default.

### 5.6 Residual risks (explicit)

- COOP/COEP/CORP/`Origin-Agent-Cluster` are hardening hints, not the
  boundary. The boundary is: distinct origins + Host enforcement +
  Origin-checked state-changing endpoints + `__Host-` cookies.
- Parent-domain cookies from unrelated sibling apps: manure never sets
  a `Domain=` cookie and never trusts non-`__Host-` cookies, but it
  cannot stop another app on the shared parent from setting
  `Domain=artifacts.7mind.io` cookies, nor stop uploaded JS from
  reading/writing NON-`HttpOnly` parent-domain cookies (including ones
  scoped as high as `7mind.io`) — that is inherent to sharing a parent
  domain and is NOT fixed by distinct subdomains alone. State-changing
  dashboard/content endpoints therefore require `Origin` checks (§4,
  §5.7) in addition to cookies. Hosts running unrelated apps on the
  parent domain MUST deploy content on a SEPARATE registrable domain;
  the default `<id>.artifacts.7mind.io` is same-site-isolated but not
  separate-site. Tests assert no `Domain` attribute on any manure
  cookie; the separate-domain recommendation is documented, not assumed.

### 5.7 Host and Origin checks

- Every request validates `Host`: equals the API host or
  `<hex32>.<content_suffix>` (port ignored for loopback/ephemeral).
  Else 404/400 `bad-host`, no cookies set/read.
- Cookie-authenticated state changes (dashboard `/api/*` mutations,
  content `/__manure/*` POSTs) require `Origin` exactly equal to the
  owning origin (`api_origin` for dashboard mutations and
  `/__manure/grant`; own content origin for `/__manure/unlock|logout`).
  Missing/mismatched → `forbidden` (CSRF); `Origin: null` is never an
  exact match and is always rejected (the §5.5 `strict-origin` serving
  rule exists so first-party auth forms never emit it).
  `POST /api/v1/login` always
  requires exact `api_origin` (§4). Bearer-authed non-login API calls
  allow absent `Origin` but reject a mismatched one.
- TLS: `loopback_dev=false` requires `api_origin` starting `https:` and
  `Secure` cookies; acceptance of a request as secure is defined ONLY by
  §5.8. `loopback_dev=true` permits `http:` only for loopback hosts and
  uses dev cookie names. Fully functional default local HTTP mode uses
  `127.0.0.1` / `*.localhost` with Host dispatch; no extra hosts edits
  or network needed (§11).

### 5.8 Edge trust boundary (production)

- The backend is a plain-HTTP `ThreadingHTTPServer`. In production it
  MUST sit behind a TLS-terminating reverse proxy on a trusted network
  peer (loopback by default). Rule: a request counts as secure IFF its
  socket peer ∈ `trusted_proxies` AND `X-Forwarded-Proto: https`
  (exact, single value). Direct-plaintext requests (peer ∉ trusted, or
  header absent/≠https) with `loopback_dev=false` → 403 `tls-required`
  (no redirect; the edge owns redirects/HSTS).
- `X-Forwarded-Host` (and any `Forwarded:` header) is ALWAYS ignored;
  authority comes only from the request `Host`. `X-Forwarded-For` /
  client-IP headers are ignored for ALL auth/throttle decisions;
  unauthenticated throttling (login, unlock) keys on the socket peer IP
  only — never on spoofable headers. Authenticated throttling keys on
  the principal.
- The edge MUST forward the original Host intact, including any explicit port (`proxy_set_header Host $http_host`, or an identity-preserving map of it — never normalized `$host`, which drops the port; `or equivalent` means port-preserving only) and MUST NOT add `Access-Control-Allow-Origin`. These are
  asserted by N2 with hostile-header cases: spoofed `X-Forwarded-Proto`
  from an untrusted peer still yields `tls-required`; spoofed
  `X-Forwarded-Host` never routes.

## 6. Data model and storage

- Artifact: `{id (hex32), name, kind: file|dir, visibility:
  internal|external|public, created_by_user, created_by_token,
  created_at, expires_at|null, state: uploading|publishing|ready,
  total_bytes, file_count, external_password_hash|null, content_url}`.
  `created_by_token` is a label (rotation-safe ownership keys on
  `created_by_user`, §6.5). Timestamps RFC3339 UTC (`...Z`).
- Manifest (per artifact, immutable after init): ordered list of
  `{path, kind: file|dir, size (files only), sha256 (files only,
  lowercase hex)}`. Empty directories ARE retained as `kind: dir`
  entries (no size/sha); upload MUST include them and fetch MUST
  recreate them. `kind: dir` with zero entries = empty root site.
  Topology validation at init (all `invalid-manifest`/`invalid-path`):
  per-entry path rules (§5.3); no duplicate normalized paths; no FILE
  path that is a strict prefix-parent of another entry (file/descendant
  conflict, either direction incl. file-vs-dir same path); `kind: file`
  artifacts contain exactly 1 file entry and 0 dir entries; `kind: dir`
  contains 0..N entries.
- `total_bytes` = sum of file sizes (dirs excluded). Init validation:
  per-file ≤ `max_file_bytes`, total ≤ `max_artifact_bytes`, entries ≤
  `max_files_per_artifact`, TTL within bounds (§12), visibility valid.
  Quota is enforced by ATOMIC RESERVATION: init runs one `BEGIN
  IMMEDIATE` transaction that sums live `reserved_bytes`, rejects with
  `quota-exceeded` if `sum + total_bytes > storage_quota_bytes`
  (concurrent inits serialize; exactly the fitting subset succeeds),
  else inserts the artifact row with `reserved_bytes = total_bytes`.
  Session-count caps (`max_sessions_per_user/global`) are checked in the
  same transaction (`session-limit`). Manifests are immutable, so a
  reservation never grows. Delete/expire/sweep removes the row and frees
  the reservation. Disk-full mid-chunk → chunk PUT fails 503
  `unavailable`; the session stays resumable; no partial commit (ack
  only after DB commit, §8).

### 6.1 On-disk layout (metadata NEVER in the served tree)

```
data_dir/
  manure.db                      # sqlite, journal_mode=WAL, synchronous=FULL
  staging/<hex32>/tree/...       # user payload being assembled
  staging/<hex32>.json           # private session record (manifest copy, owner, activity)
  live/<hex32>/...               # published user bytes ONLY
```

Publish renames `staging/<id>/tree` → `live/<id>` (same filesystem);
the sidecar is deleted only after the `ready` commit (§6.3).

### 6.2 Durable chunk receipt ordering

Per chunk PUT: (1) write bytes at `offset` (`os.pwrite` semantics),
(2) `fsync` file + containing dir, (3) insert/update `receipts` row
`(artifact_id, path, offset, length, sha256)` in one transaction,
(4) advance `last_activity_at`, COMMIT, (5) ONLY THEN respond 200.
Receipt rows without matching bytes (crash between 2–3) and bytes
without rows (crash between 1–2) are both treated as MISSING at startup:
startup truncates each staging file to the max receipted end and drops
receipts not fully covered by bytes. Progress is acknowledged exactly
when durable.

### 6.3 Publish ordering and crash windows

Publish (owner-only): (P1) verify every per-file SHA-256 read-only;
(P2) `BEGIN IMMEDIATE`, assert state `uploading`, set `publishing`,
COMMIT (durable); (P3) fsync staging tree; (P4) `os.rename(
staging/<id>/tree → live/<id>)`; fsync `live/` + `data_dir`; (P5)
`BEGIN IMMEDIATE`, set `ready`, delete receipts, COMMIT; (P6) remove
`staging/<id>.json` + empty dir (idempotent; safe to repeat).
`rename` is NOT inside the DB transaction (they cannot be atomic);
instead startup reconciliation (runs before serving, single process
claim via sqlite lock) maps every crash window to exactly one outcome:

| Window | Observable state | Recovery |
|---|---|---|
| before P2 commit | `uploading`, tree partial/complete | resumable (§6.2 reconcile) |
| `publishing`, staging tree complete, `live/<id>` absent | interrupted publish | redo from P4 → `ready` |
| `publishing`, `live/<id>` present (complete per manifest sizes) | rename done, P5 lost | COMMIT `ready`, cleanup staging remnants |
| `publishing`, NEITHER tree complete/present | P2 committed, payload lost/unfinished | back to `uploading` + reconcile (resumable, never served) |
| `ready` + stray `staging/<id>*` remnants | P5 committed, P6 lost | delete remnants, stay `ready` |
| `live/<id>` with NO artifact row | operator/tamper case | delete tree, log (never served) |

Publish POST is idempotent: `ready` → 200 same `content_url`;
`publishing` → 409 `state-conflict` (client retries with backoff).
Partial trees are NEVER served: content/API byte routes require
`ready` + `live/<id>` present.

### 6.4 TTL

`expires_at` set at init (`expires_in_s`) and patchable
  (shorten/extend/clear within `max_ttl_s`; PATCH `expires_in_s: null`
  clears). Expiry is authorization-immediate: after `expires_at` every
  read/grant/unlock fails (`expired`: 410 for authenticated API reads,
  404 on content and for anonymous) even before the sweeper runs. The
  sweeper (every `sweep_interval_s`) physically deletes expired
  artifacts, idle `uploading` sessions (`now - last_activity_at >
  `incomplete_session_ttl_s`), orphan staging/sidecars, and expired
  grants. `last_activity_at` advances ONLY on: init, successful chunk
  PUT commit, completed publish request, PATCH. Reads/status never
  advance it.
### 6.5 Incomplete-session ownership (explicit decision)

The creating
  `user_id` owns mutation of an `uploading`/`publishing` artifact
  (chunk PUTs, publish, PATCH while not `ready`). Other user_ids get
  `session-not-owned` (403). Rationale: prevents concurrent
  interference while surviving token rotation within one identity.
  Reads (`info`, `upload-status`, `files` manifest), `grants` (when
  eligible), `rotate`, and `delete` (abort) are allowed to ANY
  authenticated user, consistent with "every user sees/deletes all
  artifacts" and letting anyone GC a stuck session. Rotation is
  explicitly NOT ownership-gated (§4).

### 6.6 Server-side containment (no-follow, normative)

Client-side symlink rules (§§8–9) are not the boundary. The server
MUST NOT create or follow symlinks anywhere under `data_dir`: chunk
writes, publish rename (§6.3), content/API byte serving (§7), startup
reconciliation (§§6.2–6.3), sweeps, deletes, and grant/cookie handling
resolve every payload path strictly inside `staging/<id>/tree` or
`live/<id>` and refuse any path with a symlink component or resolving
outside its artifact tree (writes: 400 `invalid-path`; reads: 404
`not-found`; recovery: treated as MISSING). Metadata (`manure.db`,
`staging/*.json` sidecars, receipt rows) is never addressable through
a served path (§6.1). Cleanup removes without traversing: unlink
files/symlinks themselves, never follow them. (Documentation
requirement; no runtime is implemented by this task.)

## 7. REST API v1 (API origin prefix `/api/v1` + content-host controls)

JSON bodies (cap `max_request_body_bytes`); errors
`{error: {code, message}}` with stable codes, no secrets/hashes beyond
the request, no grant values. Auth per §4. Timestamps RFC3339 UTC.

### 7.1 Schemas (exact; `...` never appears on the wire)

`ArtifactSummary`:
```json
{"artifact_id":"a3f9c1d2e4b5476890abcdef12345678","name":"site",
 "kind":"dir","visibility":"internal","state":"ready",
 "created_by_user":"w-agent","created_at":"2026-10-08T12:34:56Z",
 "expires_at":null,"total_bytes":1048576,"file_count":3,
 "content_url":"https://a3f9c1d2e4b5476890abcdef12345678.artifacts.7mind.io"}
```
`GET .../files` → `{"artifact_id":"...","state":"ready",
"files":[{"path":"index.html","kind":"file","size":1234,
"sha256":"e3b0..."},{"path":"assets","kind":"dir"}]}` — dir entries
carry ONLY `path`+`kind`. This is the ONLY listing carrying hashes.
`GET .../upload-status` → `{"artifact_id":"...","state":"uploading",
"chunk_bytes":1048576,"files":[{"path":"big.bin","size":5000000,
"received_bytes":3145728,"received_ranges":[[0,2097152],[2097152,3145728]]}]}`.
Ranges are `[start_inclusive, end_exclusive]`, sorted, non-overlapping.
`PUT .../chunks` → `{"path":"big.bin","offset":2097152,"length":1048576,
"received_bytes":3145728}` (per-file scope).
Paginated `GET /api/v1/artifacts` → `{"artifacts":[<summary>...],
"next_cursor":"ey...” | null}`. Order `created_at ASC, artifact_id
ASC`; `limit` default 50 clamped to `max_list_limit`; `cursor` opaque
(base64url of last `(created_at, artifact_id)`); absent/empty = start;
invalid → 400 `bad-envelope`; `next_cursor: null` ⇔ exhausted.
`expires_in_s`: int|null; present ⇒ `60 <= v <= max_ttl_s`, else 400
`invalid-ttl`; PATCH `null` clears (any authed user when ready, owner
when uploading).
`POST .../artifacts:init` request (JSON object; unknown top-level
fields → 400 `bad-envelope`):
`{"name"*: str (1..256 chars), "kind"*: "file"|"dir",
"visibility"*: "internal"|"external"|"public",
"expires_in_s"?: int|null (omitted ≡ null ≡ no expiry),
"files"*: [entries]}` (the artifact manifest). Each entry: `{"path"*: str (path rules
§5.3), "kind"*: "file"|"dir"}`; `kind: file` entries additionally
require `"size"*: int (`0 <= size <= max_file_bytes`) and
`"sha256"*: str (64 lowercase hex)`; `kind: dir` entries carry ONLY
`path`+`kind` (extra `size`/`sha256` → 400 `invalid-path`). Entry
topology validated per §6 (`invalid-manifest`/`invalid-path`).
`PATCH .../artifacts/<id>` request (JSON object): permitted fields
ONLY `{"name"?: str (1..256), "visibility"?:
"internal"|"external"|"public", "expires_in_s"?: int|null}`;
omitted fields are left unchanged, `expires_in_s: null` clears the
expiry. `kind`, `manifest`, `artifact_id`, or any other field present
→ 400 `bad-envelope` (manifests are immutable, §8).

### 7.2 API routes (summary of §0-table with state/permission rules)

- `POST /api/v1/login` — body `{token}` (JSON) or `token=...`
  (urlencoded form); exact-Origin required (§4). JSON success → 200
  flat `{user_id, type, token_id}` + session cookie; form success →
  303 to `/` + session cookie.
- `POST /api/v1/logout` — JSON → 200 `{"ok":true}` + cleared cookie;
  urlencoded form → 303 to `/` + cleared cookie;
  `GET /api/v1/whoami` → 200 `{user_id, type, token_id}`;
  `GET /api/v1/health` → 200 `{ok:true, version}` (unauthenticated).
- `GET /api/v1/artifacts?...` — any authed user; expired hidden unless
  `include_expired=true` (then shown with state, still unservable).
  Success → 200 paginated envelope (§7.1).
- `POST /api/v1/artifacts:init` — any authed user (within session caps);
  request per §7.1, manifest validated (§6). Success → 200
  `{artifact_id, chunk_bytes, content_url}` + `external_password`
  exactly once iff external.
- `GET /api/v1/artifacts/<id>` — any authed user (`ready` or
  `uploading`); expired → 410. Success → 200 `ArtifactSummary` (§7.1).
- `PATCH /api/v1/artifacts/<id>` — request per §7.1; owner-only while
  not `ready`, any authed user once `ready`. Success → 200
  `ArtifactSummary`. Switching TO external generates and returns
  `{external_password}` once (a generation event under §7.5);
  switching AWAY clears the hash and kills grants.
- `DELETE /api/v1/artifacts/<id>` — any authed user, any state (aborts
  uploads, frees reservation, kills grants). Success → 200 `{"ok":true}`.
- `POST /api/v1/artifacts/<id>/external-password:rotate` — any authed
  user, any state; artifact must be external else `invalid-visibility`.
  Success → 200 `{external_password}` (once);
  kills old password + grants.
- `GET /api/v1/artifacts/<id>/files` — manifest+hashes; internal: any
  authed; public: anon ok; external: authed ONLY (anonymous uses content
  `/__manure/manifest`). While `uploading`, hashes visible but byte
  reads below always 409.
- `GET /api/v1/artifacts/<id>/upload-status` — any authed user.
- `PUT /api/v1/artifacts/<id>/chunks?path=<urlenc>&offset=<n>` —
  owner-only, `uploading` only (`ready` → 409 `state-conflict`);
  `application/octet-stream`, header `X-Chunk-Sha256: <hex>`; alignment
  §8; unknown path → 404; hash/length mismatch → 400/409
  (`invalid-range` / `chunk-conflict`).
- `POST /api/v1/artifacts/<id>/publish` — owner-only; see §6.3
  idempotency. All-hashes-verified else 409 `hash-mismatch`.
  Success → 200 `{artifact_id, state, content_url}`.
- `GET /api/v1/artifacts/<id>/files/<p>/content` — internal: any
  authed; public: anon ok; external: authed ONLY; `uploading` bytes →
  409 `incomplete-upload` (never partial bytes). Served `attachment`.
  `Range: bytes=<s>-<e>` supported → 206 + `Content-Range`,
  unsatisfiable → 416, absent → 200. Always `Accept-Ranges: bytes`.
- `POST /api/v1/artifacts/<id>/grants` — any authed user; internal
  `ready` only (external/public → `invalid-visibility`); returns
  `{grant, expires_in_s}` one-time.

### 7.3 Content-host routes (`https://<id>.<suffix>`)

Path handling (frozen): split the RAW path on `/` (percent-encoded
`%2F` never becomes a separator), single-pass percent-decode each
segment (UTF-8 strict; `+` stays literal `+`), then apply manifest
validation (§5.3): a `/` inside a decoded segment (reachable only via
percent-encoding such as `%2F`, since the split precedes decoding),
empty segments (except one trailing slash), `.`, `..`, NUL, invalid
UTF-8, reserved top segment → 400 `invalid-path`
(directory traversal incl. encoded `..` rejected here). File lookup
uses the decoded path against the manifest (exact match).

- `GET /` — `kind: file` → serve the single file; `kind: dir` →
  `<dir>/index.html` then `<dir>/index.htm` else 404 (never a listing).
  Auth: public anon; internal/external need grant cookie (external
  without → password form 200; internal without → 401
  `grant-required` hint page, no secrets).
- `GET /<p>` — exact file → serve inline; `<p>` a dir without trailing
  slash → 303 to `<p>/`; `<p>/` → index lookup as `/`. Else 404.
- `GET /__manure/password` — HTML form (external `ready` only; else
  404). Field `password`. Served from `unlock_shell_dir` or built-in.
- `POST /__manure/unlock` — body EITHER `application/json`
  `{"password":"..."}` (machine clients) OR
  `application/x-www-form-urlencoded` `password=...` (browsers, incl.
  the built-in form). Other content types → 415. Exact own-Origin
  required. Success: urlencoded → `303` to `/` + grant cookie; JSON →
  `200 {"ok":true}` + grant cookie. Failure → 401 `password-invalid`
  (same shape class as request: HTML form with error / JSON envelope).
  Rate-limited (§3). No URL secrets anywhere.
- `POST /__manure/grant` — body `{"grant":"..."}` (JSON) or
  `grant=...` (urlencoded, the dashboard handoff form). Exact
  `Origin == api_origin` required (exempt from the §9 target-Origin
  rule; unlock/logout use their own content origin). Single-use:
  unknown/expired/used → 403 `grant-invalid`/`grant-expired`. Success: urlencoded → `303` to
  `/` + grant cookie; JSON → `200 {"ok":true}` + cookie. 303 (never
  302: 303 deterministically converts to GET).
- `POST /__manure/logout` — own-Origin; clears grant cookie
  (urlencoded → 303 `/`; JSON → 200 `{"ok":true}`).
- `GET /__manure/manifest` — grant-cookie authorized manifest WITH
  hashes + empty-dir entries (same shape as API `files`); public anon
  ok; enables token-free external download (§9/R6).
- `GET /__manure/files/<p>/content` — grant-authorized byte serving
  INLINE with `Range`/206/416 semantics identical to the API route
  (same `<p>` decoding). Public anon ok.
- Unknown `/__manure/*`, all `/api/*` → 404 `not-found` JSON.

### 7.4 Error codes (stable codes)

Error codes (stable; HTTP in parentheses): `bad-envelope` (400),
`invalid-path` (400), `invalid-manifest` (400), `invalid-range`
(400), `invalid-ttl` (400), `invalid-visibility` (400), `bad-host`
(400), `ambiguous-credentials` (400), `unauthorized` (401),
`password-required`/`password-invalid` (401), `grant-required` (401),
`grant-invalid`/`grant-expired` (403), `session-not-owned` (403),
`forbidden` = CSRF/origin (403), `tls-required` (403),
`not-found` (404), `dashboard-disabled` (404), `chunk-conflict`
(409), `state-conflict` (409), `hash-mismatch` (409),
`incomplete-upload` (409), `expired` (410 authed / 404 anon+content),
`too-large`/`quota-exceeded` (413), `session-limit` (429),
`rate-limited` (429), `unavailable` (503). 429/503 carry
`Retry-After`. No password/hash/token/grant values in faults or logs
(allowlisted logging: route label, request id, timing, status,
principal/token LABELS, artifact id, byte counts only).

### 7.5 Password/hash non-leak rule (normative)

Password PLAINTEXT appears ONLY in the response that generated it
(init-with-external, rotate, patch-to-external) and in the unlock POST
body. It NEVER appears in listings, info, manifest, publish, errors, or
logs. Hashes appear only in authorized manifest reads (API `files`,
content `/__manure/manifest`) and server-side. Retry-after-loss =
`rotate` (any authenticated user). Tests assert the negative.

## 8. Upload protocol (mandatory chunked, bounded, resumable)

Manifests are IMMUTABLE after init (quota reservation soundness, §6).

1. `init` with full manifest (`files` array, §7.1; including empty-dir entries, §6). Server
   returns `artifact_id`, authoritative `chunk_bytes`, `content_url`
   (+ one-time `external_password` iff external).
2. Client splits each file on deterministic `chunk_bytes` boundaries
   (all chunks except each file's tail MUST be exactly `chunk_bytes`;
   any chunk body > `chunk_bytes` → 413; misaligned → `invalid-range`).
   Chunk `PUT` carries raw bytes with `?path=&offset=` and
   `X-Chunk-Sha256`. Server verifies length/hash, persists per §6.2,
   appends idempotently: identical `(offset, bytes, sha)` re-PUT → 200
   no-op; same offset different bytes → 409 `chunk-conflict`.
3. Disconnects/restarts resume via `upload-status` (received ranges per
   file persisted in sqlite + staging bytes on disk). CLI/MCP MUST
   implement resume (skip received ranges), never restart from zero
   when status shows progress. 200 is sent ONLY after the receipt
   commit (§6.2), so unacked chunks are always safe to resend.
4. `publish` when every file is complete. Server re-verifies every
   per-file SHA-256 against the manifest, then follows §6.3. Hash
   mismatch → 409 `hash-mismatch`, stays `uploading`.
5. Fetch (`files`/`manifest` + per-file `content` GETs with `Range`)
   streams, writes temp + rename per file, verifies SHA-256, recreates
   empty dirs, never creates/follows symlinks, caps total bytes against
   quota/bounds before writing.

## 9. CLI (frozen)

Commands: `list [--limit N] [--cursor C] [--include-expired]
[--visibility V] [--state S] [--json]`, `info <id> [--json]`,
`upload <path> [--name N] --access internal|external|public
[--expires-in 3600|30m|7d|...] [--resume ID] [--fresh] [--json]`,
`fetch <id-or-url> <dest> [--password P] [--password-file F] [--json]`,
`delete <id>`, `rotate-password <id> [--json]`, `whoami [--json]`;
global `--cache-dir D` (overrides `MANURE_CACHE_DIR` over HM default).
`upload` of a directory walks regular files + empty dirs (never
symlinks), posts the manifest, streams chunk-resumable PUTs, publishes,
prints `{artifact_id, content_url, access, expires_at}` and — ONLY for
the generating call with `--access external` — `{external_password}`
once (resumed uploads that did not generate it print
`{external_password: null, password_note: "rotate-password to re-issue"}`).

Restart resumption (frozen): after EVERY successful init the CLI writes
`<cache_dir>/uploads/<artifact_id>.json` =
`{artifact_id, api_base, local_path, manifest_sha256, access}` — NEVER
bearer secrets, NEVER external passwords. Plain `upload <path>`
auto-resumes when exactly one cache record matches `(api_base,
local_path, manifest_sha256)`; `--resume ID` selects explicitly;
`--fresh` ignores cache and inits anew. Manifest mismatch on a selected
record → `source-changed` (exit 2), no clobber. Two processes racing
one record are safe (chunk idempotency; publish idempotent). Lost
external password across restart → resume prints null + note (above);
`rotate-password` re-issues.

Token-free external fetch: `fetch` against a content URL uses the §7.3
flow (unlock POST with `--password[-file]`, in-memory grant cookie,
`/__manure/manifest`, ranged `/__manure/files/...` streaming). No
registered token needed; no secrets in URLs.

Env precedence: for each SECRET pair (`MANURE_URL`/`MANURE_URL_FILE`,
`MANURE_TOKEN`/`MANURE_TOKEN_FILE`,
`MANURE_EXTERNAL_PASSWORD`/`MANURE_EXTERNAL_PASSWORD_FILE`): both
direct and file non-empty → stderr `ambiguous-credentials` + exit 2,
no network. Direct values are used exactly as given (no terminator
stripping, no surrounding trim); empty = unset. Token/password files
(`MANURE_TOKEN_FILE`, `MANURE_EXTERNAL_PASSWORD_FILE`) follow the §0
codec: at most one final LF is accepted and removed, and the remainder
MUST be the exact 43-char canonical form (CR, NUL, non-ASCII,
multiline, extra LF, or surrounding whitespace → rejected: stderr +
exit 2, no network). URL files hold one URL: strip one trailing LF
then surrounding whitespace; empty = unset (http only for loopback
hosts, else reject).
Credential isolation (normative for `ManureClient`/CLI/MCP): bearer and
dashboard-session values are sent ONLY to the configured API origin;
grant cookies ONLY to their exact content host (jar keyed by exact
host, never parent/sibling); machine clients send `Origin: <target
content origin>` on content POSTs — EXCEPT `/__manure/grant`, which
sends `Origin: <api_origin>` (§7.3) — and no `Origin` on content GETs;
redirects are followed at most 3× same-origin-with-credentials, and
credentials are ALWAYS dropped on cross-origin redirect. `fetch` of
public artifacts works without any token; other authed commands fail
`missing-credentials` (exit 2) before network.

## 10. MCP stdio (real JSON-RPC 2.0 + MCP, stdlib-only)

`python -m manure.mcp` speaks MCP over stdio exactly like the official
SDK servers (interop test, F10): newline-delimited JSON-RPC 2.0 objects
(UTF-8, one object per `\n`) on stdin/stdout; NO `Content-Length`
framing; stdout carries ONLY protocol messages — all logs/diagnostics
go to stderr (stdout-purity test).

- Version: `2025-11-25` (frozen set `{"2025-11-25"}`). `initialize`
  with a supported version → echoed; anything else → server answers
  `2025-11-25` as the offer and proceeds only after the client's
  `notifications/initialized` (client MAY disconnect instead).
- Lifecycle: `initialize` → `notifications/initialized` → `ping` ↔
  pong, `tools/list` → `{tools: [{name, description, inputSchema}]}`,
  `tools/call {name, arguments}` → `{content: [{type: "text", text:
  "<json result>"}]}` or `isError: true` with manure-code text for
  domain faults; malformed frames → JSON-RPC errors (`-32700`,
  `-32600`, `-32601`, `-32602`, `-32603`). No server→client
  notifications; no roots/sampling; no progress tokens.
- Normative reference: the Model Context Protocol specification,
  protocol version `2025-11-25` (JSON-RPC 2.0 over stdio as framed
  above). `initialize` request: `{protocolVersion, capabilities,
  clientInfo}`; result: `{protocolVersion: "2025-11-25",
  capabilities: {tools: {}}, serverInfo: {name: "manure", version:
  <__version__>}}` (negotiation per the version rule above).
- Tools (frozen names; every `inputSchema` is a JSON Schema object with
  `"type": "object"` and `"additionalProperties": false`):
  `whoami` `{}` (no properties); `list_artifacts` `{limit?: integer,
  cursor?: string, include_expired?: boolean}`; `get_artifact` /
  `get_manifest` `{artifact_id*: string}`; `upload_artifact`
  `{local_path*: string, access*: "internal"|"external"|"public",
  expires_in_s?: integer|null, name?: string}`; `fetch_artifact`
  `{artifact_id*: string, dest_dir*: string, password?:
  string|null}`; `delete_artifact` / `rotate_external_password`
  `{artifact_id*: string}`. `annotations`:
  read-only+idempotent for whoami/list/get/manifest; open-world
  (destructive/hint) for upload/fetch/delete/rotate. Uploads/fetches
  chunk-resume like the CLI (MCP wraps the same client code, no
  shell-outs). Auth from process env (§3.2 precedence; never argv);
  passwords live in `arguments` memory only.
- The skill at `manure/skill/SKILL.md` (client-agent owned) documents
  bearer setup, visibility choice, TTL syntax, resume behavior, and the
  external-password-once rule; it MUST NOT embed credentials.

## 11. Test fixtures, browser harness, asset resolution (frozen)

- Standalone server fixture (integration + browser tests alike):

  ```python
  from manure.server import create_server, ServerConfig
  config = ServerConfig(data_dir=str(tmp_path), api_origin=...,
                        content_suffix=..., loopback_dev=True, users=[...])
  server = create_server(config)          # ephemeral port when port=0
  try:
      api = server.api_url                # e.g. http://127.0.0.1:PORT
      origin = server.effective_api_origin # configured api_origin with the BOUND port substituted
      content = server.content_url(artifact_id)  # uses content_suffix + bound port + loopback scheme
      ...
  finally:
      server.close()
  # or: with create_server(config) as server: ...
  ```

  Test clients MUST build Host/Origin expectations from
  `effective_api_origin` (this is the port-0 rule). No subprocess
  servers except `test_cli_*` (which may exec `python -m manure.server
  --config ...` against tmp dirs). No module globals; parallel tests
  use separate `data_dir`s/ports.
- `ManureClient` import: `from manure.client import ManureClient`.
- Browser tests (`manure/tests/test_browser_*.py`, unittest-discoverable)
  drive the REAL Chromium via the installed `playwright-core` JS driver:
  Node ≥24 executes small `.mjs` helpers from the test via subprocess;
  Python asserts. Driver resolution: `MANURE_PLAYWRIGHT_CORE_PATH` MUST
  be an absolute directory containing `playwright-core`'s `package.json`
  (dev-only; e.g. the repo's `haystack/node_modules/playwright-core`
  or the Nix-provided driver). Chromium via `MANURE_CHROMIUM_BIN` else
  PATH/Nix chromium; TLS fixture via `MANURE_OPENSSL_BIN` else PATH/Nix
  openssl. Targeted dev runs `SkipTest` cleanly when driver/browser/node
  are absent; full/release acceptance requires them (missing or skipped
  mandatory case fails, never green). The Nix check provides all. No global installs, no private network:
  local runs use `artifacts.localhost`-style suffixes with Chromium
  `--host-resolver-rules="MAP *.artifacts.localhost 127.0.0.1"`. The
  suite runs the handoff/unlock/isolation cases against BOTH the
  default sibling suffix and a separate content domain.
- MCP interop: F10 includes the mandatory real-service SDK lifecycle
  driven by the official `@modelcontextprotocol/sdk` client (1.32.1 verified;
  fails without `MANURE_MCP_SDK_PATH` or node, never skips; Nix provides it;
  complementary FakeHTTP unit coverage in `test_mcp_protocol` never
  substitutes); the stdlib-only requirement applies to the
  shipped server, not the check.
- Offline: targeted non-browser suites run with stdlib only, no
  network, no playwright, no SDK. Full/release acceptance requires the
  live dependencies on Linux (official SDK + Node, Chromium + Playwright
  + openssl TLS, actual NixOS/HM runtimes); ordinary targeted server
  tests staying stdlib-only does not count as acceptance.
- Web assets, single resolution rule: sources live at
  `manure/web/{dashboard,unlock}/` (UI-owned). A Nix-owned pre-build
  staging step copies that tree into the Python package as
  `manure/manure/web/` (generated, gitignored, never hand-edited).
  `pyproject.toml` `package-data` ships only files already staged at
  build time and performs no copy; wheel/sdist asset guarantees hold
  only when the staging step ran (unstaged builds fall back to `null`
  semantics per shell, §3.1). At runtime the server resolves each shell
  dir as: explicit config value → package path
  `manure/manure/web/<name>` → repo fallback `manure/web/<name>`
  (source-checkout fixture) → `null` semantics (§3.1). M2 asserts the
  packaged service starts on defaults and serves both shells.

## 12. Defaults and limits (normative)

`chunk_bytes=1048576` (256 KiB–4 MiB); `max_file_bytes=512 MiB`;
`max_artifact_bytes=2 GiB`; `max_files_per_artifact=10000`;
`max_request_body_bytes=4 MiB`; path ≤1024 chars, depth ≤64;
`storage_quota_bytes=20 GiB` (reserved, §6);
`max_connections=128`, `request_timeout_s=30`;
`max_sessions_per_user=10`, `max_sessions_global=1000`;
`max_grants_per_artifact=10000` (evict oldest);
`rate_map_max_entries=4096` (LRU);
`rate_limit_per_min=600`, `unlock_rate_per_min=10` per artifact+IP,
`login_rate_per_min_per_ip=10`;
session cookie 180 d sliding; grant `grant_ttl_s=86400` (capped by TTL);
one-time grant 60 s single-use; `sweep_interval_s=300`;
`incomplete_session_ttl_s=86400`; TTL input
`<seconds>|<n>s|m|h|d`, `60 <= ttl <= max_ttl_s=31536000` (365 d);
server port `47329`; API prefix `/api/v1`. These are the ONLY tunable
bounds; anything else is an amendment.

## 13. Acceptance matrix

H = here (this skeleton: metadata/agreement only). S/C/U/N = later
server/client/UI+security/Nix agents. All non-H rows MUST pass before
release. M1 MUST NOT survive past the skeleton stage.

| # | Check | Owner | How |
|---|---|---|---|
| F1 | upload file + fetch round-trip (bytes+sha identical) | S/C | unittest offline |
| F2 | upload dir incl. EMPTY dirs recreated; `index.html` over `index.htm`; dir without index → 404, never listing; uploaded `manifest.json` served as plain user file | S/C/U | unittest + browser |
| F2b | topology: duplicate paths, file/descendant conflicts, reserved `__manure`/`api` prefixes rejected; empty-root dir artifact; single-file `/` and `/<name>` both serve; encoded `..`/`%2F`/NUL rejected | S | unittest |
| F3 | visibilities: internal (authed ok, anon denied), external (password unlock, no URL secret), public (anon ok) | S/C/U | unittest + browser |
| F4 | every user lists/inspects/deletes all artifacts; incomplete mutation owner-only (403 `session-not-owned` cross-user), delete/rotate-anyone | S | unittest |
| F5 | TTL: immediate auth cut-off (410 authed/404 anon+content) + sweeper physically removes; PATCH TTL/clear semantics | S | unittest (fake clock + sweep) |
| F6 | resume: kill mid-upload → `upload-status` → resume completes; duplicate chunk idempotent; conflicting chunk 409; unacked chunk resend safe; fault-injection across §6.2 orderings (bytes-without-row, row-without-bytes) reconciles to resumable | S/C | unittest + SIGKILL restart |
| F7 | publish windows (§6.3 table): each maps to complete-`ready` OR safely-resumable `uploading`; never stuck/publishing-served/partial; double-publish idempotent; `publishing` → 409 | S | state-construction + SIGKILL |
| F8 | list pagination (default 50, order, opaque cursor, invalid→400, stable full traversal); `files` carries hashes; list/info carry none | S | unittest |
| F8b | exact schemas: summary/`files`/`upload-status`/PUT-ack examples validate; Range 206/416; `hash-mismatch` on bad publish; uploading byte reads 409; PATCH/rotate permission matrix (§7.2) | S | protocol unittest |
| F9 | CLI env precedence: direct+file → exit 2 `ambiguous-credentials` no-network; exact-byte token files | C | unittest |
| F9b | bounds: oversized JSON body 413; concurrent inits overcommit → quota-respecting subset only; session caps 429 `session-limit`; login throttle 429; idle sessions swept; activity definition | S | unittest |
| F10 | MCP: initialize negotiation (supported + offered-downgrade), `tools/list` (8 tools+schemas), `tools/call` round-trip, JSON-RPC error shapes, stdout-purity, official-SDK-client lifecycle against the real service (1.32.1 verified; fail without SDK/node, never skip) | C | unittest + SDK (official `@modelcontextprotocol/sdk` + Node; `MANURE_MCP_SDK_PATH` required) |
| F10b | token-free external `fetch` (password→manifest→ranged files→verify incl. empty dirs); credential isolation: no bearer/session to content hosts, jar exact-host, cross-origin redirect drops credentials (canary asserts) | C | unittest |
| F9c | CLI resume: proc1 dies mid-upload → `upload --resume`/auto-resume completes; changed source → `source-changed`; cache holds no secrets/passwords; resumed external prints null+note | C | two-process unittest |
| B1 | dashboard login sets `__Host-`/`-dev` session, NO `Domain` attr; CSRF without `Origin` rejected; login REQUIRES exact Origin | U | browser + HTTP |
| B2 | internal view: dashboard form-POST handoff (urlencoded→303) sets `Lax` grant cookie; dashboard shell served `Referrer-Policy: strict-origin` so the handoff POST carries a real (non-`null`) `Origin`; uploaded JS cannot read dashboard token (assert via page JS); Sustained on sibling suffix AND separate domain | U | browser ×2 suffixes |
| B3 | external unlock: password POST (no URL secret), wrong password 401 + rate-limit, grant revocable via rotate | U | browser |
| B3b | built-in unlock form (`unlock_shell_dir=null`) completes the same flow; form served `Referrer-Policy: strict-origin` with a real (non-`null`) `Origin` on POST | U | browser |
| B4 | content isolation: artifact A JS cannot read artifact B (SOP); `/api/*` on content host 404s; framing blocked (`frame-ancestors 'none'`) | U | browser |
| B5 | API byte downloads are `attachment`, never execute under API origin | U | browser |
| B6 | reserved `__manure/*` + `api/*` never servable as user content | S/U | unittest + browser |
| B7 | hostile sibling: wrong-Origin login creates no session; wrong-Origin mutation with planted cookie leaves state unchanged (both suffix modes) | U | browser + HTTP |
| D1 | dashboard shell: list/open/delete/rotate flows work; artifact names/paths rendered escaped (XSS probe names) | U | browser |
| N1 | Nix eval: options shape, `LoadCredential` digests (no material), storage paths configurable, service starts, health ok | N | `nix flake check` |
| N2 | production edge: spoofed `X-Forwarded-Proto` from untrusted peer → `tls-required`; `X-Forwarded-Host` never routes; Host-intact proxy serves login+handoff end-to-end | N | `nix flake check` + browser |
| N3 | HM `cacheDir` reaches CLI default; `--cache-dir`/env precedence | N/C | eval + unittest |
| M1 | H, SUNSET: `pyproject.toml` parses stdlib-only, version triple-agrees, entrypoints frozen, no impl modules, no root/nix changes. MUST be deleted at first implementation commit; never a release gate. | H | `test_contract_*` |
| M2 | packaged service from staged assets (Nix, or wheel/sdist built after the §11 staging step) starts on default asset resolution and serves dashboard + unlock shells 200 | N/S | install + HTTP |

## 14. Versioning

Contract `0.2.0`. Amendment log: §0 records the disposition of every
review round per candidate. Any change to paths, envelopes, codes,
cookie names, env/config/Nix names, entrypoints, fixture signatures,
defaults, or the reserved namespace requires a version bump + a new
§0 entry.
Additive new tools/endpoints are minor; breaking/rename/removal is
major. Builders MUST NOT accept or emit anything outside this document.
