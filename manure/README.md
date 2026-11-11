# manure — human/agent file & directory hosting

Authenticated file and directory hosting behind `artifacts.7mind.io`.
Python ≥3.12, stdlib only, no runtime dependencies.
Service/storage supported runtime is Linux (exclusive `data_dir` claim
requires Linux abstract Unix sockets, fails closed elsewhere);
CLI/MCP client portability beyond Linux is unverified.
Normative spec: `CONTRACT.md` (v0.2.0 plus explicit path-mode amendment); this README is a handoff
summary, not a second contract. Where they disagree, `CONTRACT.md` wins.

> Docs state: commands/JSON ran against the server+UI and client/CLI/MCP
> snapshots on 2026-10-08. Nix modules were still under repair —
> re-validate Nix examples if they change. Not acceptance until the
> parent F/B/N gates (`CONTRACT.md` §13).

## What it does

- Upload a **file** or a **directory** (regular files plus **empty
  directories**, preserved in the manifest and recreated on fetch;
  symlinks rejected). **Chunked** (server-dictated, default 1 MiB),
  resumable, atomically published: readers never see partial artifacts.
- Dirs with `index.html` (preferred) or `index.htm` serve as static
  sites unchanged; without an index, browse immediate files/subdirectories
  (including empty directories), with a local Markdown preview of `README.md`.
- All **registered users** (human/agent `type` is attribution only)
  **share all artifacts**: anyone authenticated lists, inspects, and
  deletes anything (only in-progress-upload mutation is owner-checked).
  No per-artifact ACLs, no versioning (re-upload = new artifact).
- `internal` (authed reads) / `external` (password link, password
  returned at issuance and retrievable by every registered user; older
  hash-only passwords need one explicit rotation first) /
  `public` (anonymous reads); optional TTL on upload.

## Optional tags and provenance metadata

Uploads may explicitly attach tags, source hostname and project path:

```bash
manure upload ./report.md --access internal --tag release --tag report --hostname build-host --project-path /work/project
```

Python `init_upload` / `upload_path` and MCP `upload_artifact` accept optional
`tags` (string array), `hostname`, `project_path`, defaulting to `[]`, `None`,
`None` (JSON `null`). Hostname/cwd are never discovered automatically. Values
are preserved exactly: no trimming, host resolution or path normalization.
Up to 32 exact unique nonblank tags (128 Unicode scalars each); optional
nonblank hostname (253 scalars) and project path (4096 scalars). Invalid values
fail before network. Metadata is returned in artifact info/list/search and
upload results; it is immutable after init, so changing it requires a new upload.
These are searchable metadata, not secrets: they can reach the configured
embedding provider. Avoid sensitive hostnames/paths unless authorized.

Resume cache records include this metadata, not only the source manifest.
Auto-resume selects only an exact metadata match; `--resume ID` rejects a
mismatch before network and verifies actual server metadata before mutation or
success. Old records without metadata fields mean empty tags/no hostname/no
project path, not a wildcard. `--fresh` initializes a new artifact.

## Convenient file viewers

Opening a standalone Markdown, image (including SVG), PDF, Mermaid (`.mmd`,
`.mermaid`) or Graphviz (`.dot`, `.gv`) artifact in a browser opens a formatted
viewer with an original-file download. Markdown supports GFM and fenced
`mermaid`, `dot` and `graphviz` diagrams. Rendering uses bundled browser code;
there are no CDN or external rendering-service requests. External resources in
Markdown are not loaded automatically.

Non-HTML requests, range requests and existing attachment routes still return
original bytes. Directory paths with an index remain unchanged static sites. Without an index,
a directory page lists immediate children with parent/nested navigation, viewer
links for supported files and original-file downloads. An immediate `readme.md` file
(case-insensitive) renders below the listing through the same local Markdown viewer.
Preference is `README.md`, then `readme.md`, then lexicographic case-variant order.
With viewers explicitly disabled, listing and raw-file links remain available
without a README preview. An explicit
`<content-base>/__manure/view/<segment-encoded-file-path>` opens a supported
file in a viewer without changing its static asset URL. The inline raw route
is `<content-base>/__manure/raw/<segment-encoded-file-path>`; the attachment
route remains `<content-base>/__manure/files/<segment-encoded-file-path>/content`.
All routes retain artifact authorization, expiry and revocation checks.

The packaged service installs viewer assets. Source development requires building
`manure/web/viewer` first; see its README. `viewer_dir` selects the asset
directory (development default `manure/web/viewer/dist`); explicit JSON `null`
disables viewers and preserves raw serving. Missing configured assets produce a
visible error, not a silent fallback. This feature does not remove path mode's
shared-origin trust limitation or authorize deploying a new server.

## Opt-in LOW-SECURITY path hosting (TRUSTED CONTENT ONLY)

The secure default remains `content_mode: "subdomain"`: each artifact has
its own origin. Opting into **`content_mode: "path"`** instead serves all
artifacts at **`https://<api-origin>/view/<artifact-id>`**, on the SAME origin
as the dashboard/API and every other artifact. **Uploaded JavaScript can
exercise a visiting browser's authenticated management permissions and read
other accessible artifacts. Do not host untrusted HTML/JavaScript here.**
HttpOnly, SameSite, cookie `Path`, CSP and exact Origin checks do NOT restore
origin isolation. Path mode is a deliberate security downgrade, not a
replacement security boundary.

Set JSON `"content_mode": "path"`; `content_suffix` may then be omitted
(no dummy suffix). In Nix set `smind.services.manure.contentMode = "path";`
and omit `contentSuffix`. Only the API hostname/certificate is needed; the
managed proxy creates no wildcard content vhost. The setting is explicit;
there is no automatic fallback from subdomain mode. A path-mode API hostname
must not start with a 32-lowercase-hex artifact-ID label: such ambiguous
configurations are rejected so existing subdomain URLs keep their meaning.

Directory entry URLs redirect to `/view/<id>/` (and nested directories to
trailing-slash URLs), so **relative** assets such as `assets/site.css` work.
Sites must be mount-point aware: root-relative `/assets/site.css` targets the
API origin's root, NOT the artifact. Uploaded HTML/CSS/JS is never rewritten.
The trusted password shell and dashboard handoff use the artifact prefix.
Content controls are `/view/<id>/__manure/{grant,unlock,logout,password,manifest}`
and `/view/<id>/__manure/files/<path>/content`; Origin is still the **bare
API origin**, never the path base.

Visibility gates, one-time handoffs, external password rotation, revocation,
TTL, ranged downloads and API attachment downloads are unchanged. Per-artifact
grant names/paths prevent ordinary cookie collisions but are not a boundary
against same-origin scripts. CLI/MCP fetch accepts the returned content URL
in either mode (public token-free; external with password); authenticated
fetch by ID still uses the API.

## Historical local fixture construction (not a server runtime)

The public Python server entrypoint is retired and refuses before startup
effects. Use the [Scala/native backend instructions](backend/README.md) for the
current server and its owned PostgreSQL provider. The small example below is
only a historical fixture/token-generation example, not a complete current
server configuration or an activation instruction.

Generate the token and its hash file entirely inside Python
(43-char base64url, haystack codec): an exclusively created 0700
directory (refuses a pre-existing path, symlink included), 0600
credential files, and the secret never passes through shell arguments,
redirection, or pipes — so tracing and symlinks cannot leak it:

```bash
umask 077
python3 - <<'EOF'
import base64, hashlib, json, os, secrets
from pathlib import Path
work = Path("/tmp/manure-local")
work.mkdir(mode=0o700)  # exclusive: FileExistsError if the path exists, symlink included
tok = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()
(work / "m.token").write_text(tok + "\n"); os.chmod(work / "m.token", 0o600)
h = hashlib.sha256(tok.encode()).hexdigest()
(work / "m.token.sha256").write_text(h + "\n"); os.chmod(work / "m.token.sha256", 0o600)
cfg = {"port": 47329, "data_dir": str(work / "data"), "api_origin": "http://127.0.0.1:47329",
       "content_suffix": "artifacts.localhost", "loopback_dev": True, "users": [{"id": "me",
       "type": "human", "tokens": [{"id": "t1", "hashFile": str(work / "m.token.sha256")}]}]}
(work / "m.json").write_text(json.dumps(cfg, indent=2))  # token itself is never echoed
EOF
```

The generated config is historical source-format fixture data. It must not
activate a Python backend: `python -m manure.server` now exits2 without reading
it. Current server configuration and launch use the backend instructions above.

Loopback HTTP needs no setup on `127.0.0.1` (one socket,
Host-routed). `*.localhost` content names depend on your resolver —
Python has no built-in wildcard — so fetch by artifact id when
content URLs do not resolve locally (id fetch uses the API origin).
### Private-overlay HTTP (explicit opt-in)

HTTPS remains the default. For an encrypted private overlay whose hostname has
no TLS endpoint, set server `allow_insecure_http: true` (not `loopback_dev`).
The operator must restrict network access: the application cannot verify overlay
encryption. Tokens, passwords and content otherwise travel in cleartext.

To retain an existing HTTPS endpoint alongside HTTP, use path mode, for example:

```json
{
  "api_origin": "https://existing-tailnet.example:8446",
  "content_mode": "path",
  "content_suffix": "",
  "allow_insecure_http": true,
  "allowed_api_origins": ["http://private-overlay.example:8086"]
}
```

These are additional keys in a complete server config (users/data directory still
required). Aliases require distinct hostnames and are initially path-mode only;
no wildcard origins, CORS relaxation, or forwarded-host/proto spoofing is used.
Each endpoint requires its exact configured Host/port and same-origin browser
mutations. HTTPS still requires a trusted TLS edge and retains Secure cookies;
HTTP uses separate host-only `manure-http` / `mgrant-http-<id>` cookies.
Path-mode content URLs returned over HTTP stay on HTTP, so handoff/unlock works
without reaching Tailscale. `RunningServer.content_url()` remains canonical HTTPS.
Sessions are separate per hostname; sign in independently. Path mode's existing
shared-origin trusted-content limitation still applies.

Clients must opt in independently: Python `ManureClient(...,
allow_insecure_http=True)`, CLI `manure --allow-insecure-http upload ...`, or
`MANURE_ALLOW_INSECURE_HTTP=1` for CLI **and stdio MCP**. Unset/empty/`0` keeps
rejection; other environment values fail closed. Public HTTP content URL fetch
also needs this opt-in, even without credentials. This does not relax redirect,
bearer-origin or artifact-grant scoping. Browsers need no flag: the dashboard
uses same-origin fetch/forms and no secure-context-only crypto APIs. File uploads use bounded incremental SHA-256 without requiring HTTPS-only
Web Crypto APIs; Python hashing/RNG are unchanged.

**Production: `loopback_dev: false`, `https:` `api_origin`, proxy**
(see “Security & deployment”). Cleanup: stop the server, then
`rm -rf /tmp/manure-local` (token, hash, config, data).

## CLI

Portable Python entrypoints: `manure` (CLI) and `manure-mcp`
(`python -m manure.cli` / `python -m manure.mcp`). `manure-server` is the built
Scala/native service, not a Python console script; `python -m manure.server`
is deliberately fail-closed.

Secrets are fail-closed ambiguous — flags do **not** override env.
**URL/token pairs** (`MANURE_URL`/`_FILE`, `MANURE_TOKEN`/`_FILE`):
URL values strip one trailing LF plus surrounding whitespace; direct tokens
are exact canonical43-character values (no trimming). Empty = unset;
**both halves set → `ambiguous-credentials`, exit 2, before file I/O/network**.
File references must resolve to regular files; trusted managed/agenix symlinks
remain supported, but FIFOs/process substitution and other special files do not.
Token/password files are bounded to44 bytes (45-byte maximum actual read);
URL files to65,536 raw bytes with an explicit oversize error, not truncation.
See [client file-boundary policy and regression evidence](docs/client-secret-files.md).
**Passwords** (`--password`/`--password-file` plus
`MANURE_EXTERNAL_PASSWORD`/`_FILE`): any two set across flags and
env → exit 2 (observed: flag + env is rejected, not overridden —
unset the env pair first). Secret files: exact-byte rule (43 chars +
optional LF). Flag-over-env holds **only** for the non-secret cache:
`--cache-dir` > `MANURE_CACHE_DIR` > Home Manager default >
`~/.cache/manure`. HTTP URLs: loopback hosts only by default, else rejected
pre-network.

```bash
export MANURE_URL=http://127.0.0.1:47329 MANURE_TOKEN_FILE=/tmp/manure-local/m.token
manure whoami --json
# {"token_id": "t1", "type": "human", "user_id": "me"}
manure upload ./site --access external --expires-in 7d --json
# {"access": "external", "artifact_id": "<hex32>",
#  "content_url": "http://<hex32>.artifacts.localhost:47329",
#  "expires_at": "<timestamp, 7d out>", "external_password": "<returned ONCE>"}
manure upload ./big --access internal --resume <id>   # or --fresh
manure list --visibility external --json              # + --limit/--cursor/--state/--include-expired
manure fetch <hex32-or-content-url> ./out --password-file /tmp/pw
manure delete <hex32>
manure rotate-password <hex32> --json                 # re-issues, revokes old password + grants
```

`--expires-in`: seconds or `<n>s|m|h|d`, within 60..31536000.
Resumed external uploads print `external_password: null` + a
`rotate-password` note (cache holds source/manifest/metadata references only — never bearer
secrets or passwords). Token-free external fetch needs only the
content URL + `--password[-file]`; public fetch needs no token. No
secret ever goes in a URL, log, or error.

## Artifact workspace

The dashboard uses a responsive workspace layout with light/dark themes,
access-mode navigation, full-catalogue search and sortable columns. The slate/blue
palette follows Chronicle. Catalogue rows wrap into labeled metadata cards on
narrower screens; every field, sort and action remains available without
horizontal scrolling. Manifest paths and metadata wrap within their columns. Newest
artifacts appear first. The table loads batches of 25 while scrolling;
**Load more** provides keyboard access and works without IntersectionObserver.
Search, filters and sort persist in the URL fragment, never in web storage.
Failed batches preserve loaded rows and offer an explicit retry.

One query field holds search text, mode and filters, with caret-aware completion
and an in-field clear button. The same expression is accepted by the MCP `search`
tool. Catalogue (literal name/ID/tag/hostname/project substring, nine sorts, state/expiry filters and
keyset pages) is the default. `mode:lexical`, `mode:semantic` and `mode:hybrid`
select retrieval through the current typed Search API over artifact metadata and
manifest **paths only**, not uploaded file bytes. For example:

```text
report access:internal state:ready
mode:lexical kind:dir text:"release notes"
mode:hybrid access:public owner:alice text:"deployment guide"
```

`tag:release tag:report hostname:build-host project:"/work/project"` works in
all search modes; tags conjoin (AND), and all three values are exact and
case-sensitive. Python structured `list_artifacts` / `search` accept `tags`,
`hostname`, `project_path` keyword filters. Duplicate tags and duplicate
hostname/project fields are rejected. Expressions allow up to 131072 UTF-16
units, independently of the 4096 UTF-16-unit compiled search-text limit.

Metadata filters are conjunctive, not Boolean expressions; retrieval text keeps
its existing search-engine semantics. Use `text:"..."` for literal colons or
arbitrary retrieval syntax. Unknown, duplicate (except distinct tags) and incompatible fields are
reported rather than ignored. See [the query contract](docs/query.md). Retrieval is
explicit-submit only; no model call occurs on typing, filter changes or ordinary
navigation. Availability comes from GetCapabilities: without a provider, lexical
remains usable but semantic/hybrid remain visibly unavailable, never silently
falling back. Lexical/hybrid text search uses English full-text words/stems,
quoted phrases, OR and -negation, not catalogue substring matching. Retrieval
supports access, kind and creator filters and returns only ready, unexpired
artifacts, in relevance order with a single bounded page (at most 25 or the
advertised max list limit, whichever is smaller). Exact matches count matching
artifacts; candidate-window counts are bounded ranked candidates, **not** the
whole corpus. Results show representative inert name/path evidence from a pinned
source snapshot; opening details makes a fresh GetArtifact request. Catalogue
sorts, state/expiry toggles and pagination do not apply to retrieval.

The draft is marked distinct from the URL-applied query; Search applies it.
The fragment carries search mode and filters through reload, detail and back,
but retrieval results on a fresh deep link require Search. Ctrl/Meta+K focuses
the input when the workspace list is visible. Arrow keys select suggestions,
Enter inserts one without submitting, and Escape dismisses suggestions before
clearing the draft. Completion is local and provider-free. No browser storage is used. Confirmed logout
or loss of an authenticated session removes the prior identity's URL query and
creator filter. Incoming unauthenticated shared links survive login but do not
auto-submit retrieval.

Details show metadata and the file manifest, with same-origin attachment
Downloads. **Open** uses the configured content endpoint and one-time
internal grant handoff (isolated origin in default subdomain mode only); when content hosting is unavailable, no working link
is advertised. All configured users can manage all
artifacts; the sidebar is an access filter, not an ownership boundary.

**Quick upload:** after logging in, paste a screenshot (Ctrl+V), drop files
onto the upload panel, or choose files (including PDFs). These actions only
stage files; **Upload** explicitly publishes each file as a separate artifact.
The compact upload row contains the file picker, three adjacent access choices,
and Upload/Dismiss buttons. Choose access before clicking Upload: **Internal**
(default) requires authenticated readers, including remote agents; **External**
requires its password; **Public** permits anonymous reads by anyone
who can reach the link. The access choice applies to files that have not started
initialization; retrying an existing
artifact preserves its original access. Directories and cross-session resume
remain CLI features. Server limits apply; hashing reads bounded slices and
uploads use the server's chunk size.

Ready uploads show selectable content links and a Copy button (manual copy works
on HTTP where clipboard permission is unavailable). External passwords remain
transient, never in links or web storage; dismiss the password or sign out to
clear it. Dismissing uploads does not delete server reservations. Retry resumes
the same known artifact, including uncertain finalization. If initialization
could not be confirmed, check the catalogue before starting a new upload:
request correlation is not write deduplication and a reservation may exist.

In low-security **path mode**, opening an Internal artifact root, deep link or
viewer bookmark uses an existing human dashboard session to obtain an
artifact-scoped grant. Links from another site first display a trusted inert
continuation page, then retry once locally so the unchanged `SameSite=Strict`
management cookie can be sent. An expired/revoked content cookie does not block
that exchange. Without a dashboard session the retry shows a sign-in link to
the artifact details, not a loop. Raw/download and content API requests still
require their own content authorization; External links still ask for a password.
Subdomain hosting does not share the management session.

Ready artifacts have an **Access mode** selector in details. Any configured
user can change Internal, External, or Public access; Public changes require
confirmation. Changes revoke existing content grants. Switching to External
generates a password. Failed or ambiguous changes refresh metadata
without retrying the mutation; use **Copy current password** to retrieve it.
Incomplete uploads cannot change access in the dashboard.

External artifacts offer **Copy current password**, which explicitly retrieves
and copies the password without rotating it or revoking grants. Clipboard denial
leaves a transient reveal with a manual Copy button. Older hash-only artifacts
require one explicit rotation first; the dashboard never rotates automatically.
All registered users can retrieve these passwords. The separate PostgreSQL
secret table and its backups require credential-grade protection; passwords
are stored recoverably without a separate encryption key, never in artifact
metadata, search or payload sidecars. Dismissal, navigation and logout clear
the reveal. Login input is cleared after submission; the session
uses the existing host-only HttpOnly cookie. Tokens, passwords and grants
never enter URLs or web storage. A connection failure is distinguished from
an expired session, with an explicit recovery action.

## Dashboard catalogue API

`GET /api/v1/artifacts?q=report&sort_by=created_at&direction=desc&limit=50`
searches the full catalogue, not just the current page. Search is a literal
Unicode case-insensitive substring of name or artifact ID (`%` / `_` are
not wildcards). Sort fields: `name`, `created_at`,
`expires_at`, `total_bytes`, `file_count`, `visibility`, `state`, `kind`,
`created_by_user`; direction: `asc` / `desc`. Never-expiring artifacts sort
last either way; text uses SQLite binary ordering. Existing visibility,
state, and expiry filters combine with search.

The presence of `q`, `sort_by`, or `direction` selects catalogue mode
(default `created_at desc`). Continue with `next_cursor` and the same
filters, search, sort, direction, and limit; restart on changes. Keyset pages
materialize at most `limit + 1` rows in Python; search/sort may scan or order
more data inside SQLite. This is not a snapshot. Requests omitting all three
new arguments, including existing CLI/Python/MCP calls, retain their
oldest-first order and legacy cursors. See `CONTRACT.md` §7 for details.

## MCP (stdio) + agent skill

Real JSON-RPC 2.0 over stdio, one object per line, protocol
`2025-11-25`: `initialize` → `notifications/initialized` → `ping` /
`tools/list` / `tools/call`; same env auth as the CLI. Nine tools:
`whoami`, `list_artifacts`, `search`, `get_artifact`, `get_manifest`,
`upload_artifact`, `fetch_artifact`, `delete_artifact`,
`rotate_external_password` (`tools/list`-verified). Host entries use
file-backed credentials only — never `MANURE_TOKEN` beside
`MANURE_TOKEN_FILE`:

```json
{"mcpServers": {"manure": {
  "command": "/nix/store/<hash>-manure/bin/manure-mcp",
  "env": {"MANURE_URL": "http://127.0.0.1:47329",
          "MANURE_TOKEN_FILE": "/run/keys/manure-token",
          "MANURE_CACHE_DIR": "/home/alice/.cache/manure"}}}}
```

(`command` is the built wrapper; HM wires it automatically.) Skill:
`manure/skill/SKILL.md` (installed as `$out/share/manure/SKILL.md`).

## Nix

Package `.#manure` = stdlib wheel **plus the web shells**,
`bin/manure{,-server,-mcp}`. `mainProgram` is **`manure-server`**:

- `nix run .#manure -- --config /run/manure.json` → the **server**.
- CLI/MCP need the other wrappers: `nix shell .#manure -c manure
  list`, or `$(nix build --print-out-paths .#manure)/bin/manure
  whoami` (same for `/bin/manure-mcp`).

NixOS service, loopback-dev flavor (production flips `loopbackDev`
to `false`, sets an `https:` `apiOrigin`, and needs `proxy.acmeHost`
with a DNS-01 wildcard cert in subdomain mode — see “Security & deployment”):

```nix
smind.services.manure = {
  enable = true;
  apiOrigin = "http://127.0.0.1:47329";
  contentSuffix = "artifacts.localhost";
  loopbackDev = true;               # development only
  dataDir = "/var/lib/manure-dev";  # custom storage, created 0700 manure:manure
  # Quoted runtime path outside the store (via LoadCredential, never store bytes).
  users.alice = { type = "human"; tokens.t1.tokenHashFile = "/run/keys/manure-alice-t1"; };
  proxy.enable = false;             # no nginx for loopback-dev
};
```

Home Manager client (same machine or another):

```nix
smind.hm.dev.llm.manure = {
  enable = true;
  url = "http://127.0.0.1:47329";
  tokenFile = /run/keys/manure-token;      # raw 43-char bearer, file-backed
  cacheDir = /home/alice/.cache/manure;    # upload-session cache, source/manifest/metadata references only
};
```

This sets `MANURE_URL` / `MANURE_TOKEN_FILE` / `MANURE_CACHE_DIR`
session defaults, wires `programs.mcp.servers.manure` →
`…/bin/manure-mcp`, and ships the CLI. Other tunables mirror the
§3.1 closed set — nothing outside it without amendment.

**Asset staging rule (release-critical):** UI sources live at
`manure/web/{dashboard,unlock}/`; the package `preBuild` copies them
into `manure/manure/web/` and *fails the build* if they are absent.
`pyproject.toml` `package-data` ships only staged files, no copy —
so a **standalone wheel/sdist must copy `web/*` into
`manure/manure/web/` before building**, else the server silently
falls back to `null` semantics (API-only dashboard, minimal unlock
form). No automatic staging outside the Nix build.

## Tests (what runs where — and what does not count)

- Full suite from the repo root (no external network; server/client
  tests still use loopback sockets, so “offline” means no outside
  traffic, not no sockets):

```bash
MANURE_PLAYWRIGHT_CORE_PATH=/path/to/playwright-core \
MANURE_CHROMIUM_BIN=/path/to/chromium \
MANURE_MCP_SDK_PATH=/path/to/node_modules/@modelcontextprotocol/sdk \
python3 -m unittest discover -s manure/tests -p "test_*.py"
```

- Driver: absolute dir with `playwright-core`'s `package.json`;
  browser: `MANURE_CHROMIUM_BIN` else PATH/Nix; SDK:
  `MANURE_MCP_SDK_PATH` = the `@modelcontextprotocol/sdk` **package
directory** (resolved absolutely, first existing hit wins). Browser
  helpers + SDK interop need **Node ≥24** (official SDK 1.32.1 verified,
  protocol `2025-11-25`; pins unchanged). Targeted server suites stay
  stdlib-only; full/release acceptance requires the live dependencies
  on Linux: official SDK + Node, Chromium + Playwright + openssl TLS,
  and actual NixOS/HM runtimes. The real-service SDK stdio regression
  (`test_client_realserver.py`) is mandatory — without
  `MANURE_MCP_SDK_PATH` it fails, not skips — so a missing
  driver/browser/SDK/node/openssl or a skipped mandatory case is a
  failed acceptance, never a green run.
- Additional workspace UX checks: run
  `python3 -m unittest discover -s manure/tests -p test_browser_dashboard_ux.py`
  with the same driver/browser environment. `MANURE_FIREFOX_BIN` explicitly
  selects Firefox instead of Chromium; `MANURE_UX_ARTIFACTS` optionally writes
  screenshots to a scratch directory. A Firefox UX run does not replace the
  mandatory Chromium, TLS or NixOS/HM security gates.
- The UX module also runs `browser/dashboard-layout.mjs` against the actual
  dashboard modules and a controlled current-API boundary. Long unbroken names,
  owners and paths are checked at 320, 390, 570, 571, 800, 801, 1024, 1350, 1351 and 1440px in light/dark mode:
  no page/table/cell horizontal overflow, all metadata retained, nine keyboard
  sorts and focusable actions. This is frontend layout evidence, not native
  backend acceptance. `MANURE_UX_ARTIFACTS` saves catalogue/manifest screenshots.
- Absolute scratch paths from a developer run are not gates either;
  release acceptance is the parent-run F/B/N matrix (`CONTRACT.md` §13).
  Linux covers service/storage acceptance; CLI portability beyond Linux
  is unknown (not claimed).

## Security & deployment

No host/DNS/deployment change is implied here — operator configuration only.

- **In default subdomain mode**, `https://artifacts.7mind.io` is the **management/API origin only**.
  Uploaded HTML/JS serves **exclusively** from per-artifact content
  hostnames (`<hex32>.<content-suffix>`), **never** inline under the
  management origin (API byte downloads: `attachment` + `nosniff`).
- **Path mode has no origin isolation**; see the LOW-SECURITY warning above.
- The default `<id>.artifacts.7mind.io` subdomains are same-site, **not**
  separate-site: untrusted JS on one artifact host can read/write
  non-`HttpOnly` parent-domain cookies (including ones scoped as high
  as `7mind.io`), and a sibling app setting `Domain=.7mind.io`
  cookies breaks subdomain-only isolation. **Strong recommendation:
  serve content from a separate registrable domain you own**
  (placeholder only — `content-<yours>.example.net`, a name you
  control; claims no DNS). Shared-parent hosts must also audit every
  other app: host-only `__Host-` cookies, exact-`Origin` state-change
  checks, CSRF protection, no `document.domain` assumptions.
  `Origin-Agent-Cluster` is a performance hint, not a boundary.
- Edge contract (exact): the proxy terminates TLS and forwards **the
  original `Host` intact, including any explicit port** (`proxy_set_header Host $http_host`, or an identity-preserving map of it — never normalized `$host`, which drops the port) with
  `X-Forwarded-Proto`. Secure ⇔ socket peer ∈ `trusted_proxies`
  (default loopback) **and** `X-Forwarded-Proto: https`; direct
  plaintext on HTTPS endpoints with `loopback_dev=false` → 403 `tls-required` (unless the request targets an explicitly configured HTTP endpoint as described above).
  `X-Forwarded-Host`, `Forwarded:`, client-IP headers are always
  ignored; unknown `Host` rejected. In subdomain mode, wildcard content hosts cannot use
  ACME HTTP-01 — provision a DNS-01 cert for the API host plus
  `*.<content-suffix>` out of band, point `proxy.acmeHost` at it.
- Header nuance (reproduced against Chromium): `no-referrer` on a native
  form POST yields `Origin: null`, which exact-Origin checks always
  reject — so **trusted HTML only** (the dashboard shell and the
  server-generated unlock/password forms) is served
  `Referrer-Policy: strict-origin`, while API JSON/dynamic responses
  **and** uploaded untrusted bytes keep `no-referrer`. `Origin: null`
  is never accepted anywhere, and no secret ever travels in a URL.
- Sharing, plainly: every registered user sees and deletes every
  artifact; external passwords revoke by rotation (also kills grant
  cookies); TTL expiry cuts auth immediately, sweeper deletes later.
- Bounds: 512 MiB/file, 2 GiB/artifact, 10000 entries, 20 GiB quota
  (atomic reservation), 128 connections, 10 sessions/user (1000
  global), grant TTL 24 h capped by artifact TTL. One process owns
  `data_dir` (sqlite + staging + live); back up quiesced. Full table:
  `CONTRACT.md` §§6/12.
