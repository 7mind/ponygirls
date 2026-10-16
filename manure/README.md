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
  sites; without an index → 404, never an auto-index listing.
- All **registered users** (human/agent `type` is attribution only)
  **share all artifacts**: anyone authenticated lists, inspects, and
  deletes anything (only in-progress-upload mutation is owner-checked).
  No per-artifact ACLs, no versioning (re-upload = new artifact).
- `internal` (authed reads) / `external` (password link, password
  returned **once**, hash stored; lost it → `rotate-password`) /
  `public` (anonymous reads); optional TTL on upload.

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

## Quick local run (no secrets store, no Nix)

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

Those are the required keys (unknown keys fail startup; full set:
`CONTRACT.md` §3.1). Run from the `manure/` project dir holding
`pyproject.toml` — the repo root lacks it on `sys.path`:

```bash
cd manure   # <repo>/manure, not the repo root
python -m manure.server --config /tmp/manure-local/m.json  # or MANURE_CONFIG=...
```

Loopback HTTP needs no setup on `127.0.0.1` (one socket,
Host-routed). `*.localhost` content names depend on your resolver —
Python has no built-in wildcard — so fetch by artifact id when
content URLs do not resolve locally (id fetch uses the API origin).
**Production: `loopback_dev: false`, `https:` `api_origin`, proxy**
(see “Security & deployment”). Cleanup: stop the server, then
`rm -rf /tmp/manure-local` (token, hash, config, data).

## CLI

Entry points: `manure` (CLI), `manure-server`, `manure-mcp`
(`python -m manure.cli|server|mcp` are equivalent).

Secrets are fail-closed ambiguous — flags do **not** override env.
**URL/token pairs** (`MANURE_URL`/`_FILE`, `MANURE_TOKEN`/`_FILE`):
strip one trailing LF plus surrounding whitespace, empty = unset,
**both halves set → `ambiguous-credentials`, exit 2, no network**.
**Passwords** (`--password`/`--password-file` plus
`MANURE_EXTERNAL_PASSWORD`/`_FILE`): any two set across flags and
env → exit 2 (observed: flag + env is rejected, not overridden —
unset the env pair first). Secret files: exact-byte rule (43 chars +
optional LF). Flag-over-env holds **only** for the non-secret cache:
`--cache-dir` > `MANURE_CACHE_DIR` > Home Manager default >
`~/.cache/manure`. HTTP URLs: loopback hosts only, else rejected
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
`rotate-password` note (cache holds manifests only — never bearer
secrets or passwords). Token-free external fetch needs only the
content URL + `--password[-file]`; public fetch needs no token. No
secret ever goes in a URL, log, or error.

## Artifact workspace

The dashboard uses a responsive workspace layout with light/dark themes,
access-mode navigation, full-catalogue search and sortable columns. Newest
artifacts appear first. The table loads batches of 25 while scrolling;
**Load more** provides keyboard access and works without IntersectionObserver.
Search, filters and sort persist in the URL fragment, never in web storage.
Failed batches preserve loaded rows and offer an explicit retry.

Details show metadata and the file manifest, with same-origin attachment
Downloads. **Open** uses the configured content endpoint and one-time
internal grant handoff (isolated origin in default subdomain mode only); when content hosting is unavailable, no working link
is advertised. Uploads remain CLI-only. All configured users can manage all
artifacts; the sidebar is an access filter, not an ownership boundary.

Ready artifacts have an **Access mode** selector in details. Any configured
user can change Internal, External, or Public access; Public changes require
confirmation. Changes revoke existing content grants. Switching to External
generates a password shown once. Failed or ambiguous changes refresh metadata
without retrying the mutation; rotate the external password if it was lost.
Incomplete uploads cannot change access in the dashboard.

External passwords are shown once after switching to External or rotation. Dismissal, navigation and
logout clear the reveal. Login input is cleared after submission; the session
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
`tools/list` / `tools/call`; same env auth as the CLI. Eight tools:
`whoami`, `list_artifacts`, `get_artifact`, `get_manifest`,
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
  cacheDir = /home/alice/.cache/manure;    # upload-session cache, manifests only
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
  plaintext with `loopback_dev=false` → 403 `tls-required`.
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
