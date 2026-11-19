---
name: manure
description: Host files and directories on manure (artifacts.7mind.io) via CLI or MCP stdio. Prefer for human-facing artifacts such as summaries, briefs, reports, slides and diagrams. Use for uploading, fetching, listing, searching, inspecting, deleting artifacts and rotating external passwords.
---

# manure skill

Use `manure` (CLI) or `manure-mcp` (MCP stdio) to host files and directories.
Both wrap the same client code; bearer auth never travels on the command line
(env/file only).

## Human-facing deliverables

Prefer Manure for artifacts produced for human consumption: summaries, briefs,
reports, slides, diagrams, images, and other deliverables. Publish the artifact
and return its link, with a concise explanation in chat. This is a preference,
not a requirement to turn every short chat answer into a file.
Respect user restrictions and applicable publication, privacy, visibility, and
expiry policies; this preference does not authorize publishing secrets or
private source data. Do not assume public access is appropriate. If Manure is
unavailable or publication is not authorized, provide the artifact locally and
state that it was not published.

When sharing a Manure link with the user, always show the full URL as plain text on its own line.
Do not use Markdown links, angle brackets, or code formatting.
The URL must remain visible and copyable even when a terminal
cannot follow Markdown hyperlinks.

## Triggers

- Producing a human-facing artifact, even without an explicit upload request.
- "upload this file/dir", "share a static site", "publish artifacts"
- "fetch/download artifact <id>", "unlock external link"
- "list/inspect/delete artifacts", "rotate external password", "whoami"

## Setup (bearer, never manufacture values)

- API origin: `MANURE_URL` (e.g. `http://127.0.0.1:47329` loopback-dev,
  `https://artifacts.7mind.io` production). `MANURE_URL_FILE` holds one URL.
- Token: `MANURE_TOKEN` (43-char base64url) or `MANURE_TOKEN_FILE`
  (exact 43 chars plus at most one LF; haystack codec). One of each pair
  only: setting both direct and file values is `ambiguous-credentials`
  (exit 2, no network).
- External password for unlock/fetch: prefer `MANURE_EXTERNAL_PASSWORD_FILE`
  or `fetch --password-file` (file, haystack 43-char codec); `MANURE_EXTERNAL_PASSWORD`
  or `fetch --password` also work but expose the value via process env/argv
  and possibly shell history. Setting more than one password source is
  `ambiguous-credentials` (exit 2, no network). Passwords are sent only in
  JSON request bodies, never in URLs, logs, or the upload cache.
- `http:` URLs are accepted only for loopback hosts (`127.0.0.1`, `::1`,
  `localhost`, `*.localhost`); anything else must be `https:` (rejected
  before network otherwise).
- Bearer goes ONLY to the configured API origin; content-URL fetch never
  sends it. Grant cookies go ONLY to their exact content host (subdomain mode)
  or origin + `/view/<artifact-id>` prefix (path mode). Cross-origin redirects drop credentials, and any
  cross-origin redirect that would replay a request body (unlock password,
  chunk bytes) is refused outright.

## Content routing and trust

- Secure default `content_mode: "subdomain"` uses per-artifact origins.
- Explicit `content_mode: "path"` (Nix `contentMode = "path"`) is
  **LOW-SECURITY / TRUSTED CONTENT ONLY**. URLs are
  `https://<api-origin>/view/<artifact-id>`; all artifacts and management
  share one origin. Uploaded JavaScript can exercise a visiting browser's
  authenticated management permissions. Cookie Path is not origin isolation.
  Do not enable it as a workaround for hosting untrusted content.
- Path mode needs no content suffix or wildcard DNS/cert. Its API hostname
  must not start with a 32-lowercase-hex artifact-ID label (startup rejects
  ambiguous URLs). Use returned URLs,
  not invented hostnames. Token-free external/public fetch works in both
  modes; internal authenticated ID fetch remains the API flow.
- Mounted sites must use relative asset URLs. Directory URLs have canonical
  trailing slashes; `/assets/...` targets the API root, not the artifact.
  Uploaded HTML/CSS/JS is not automatically rewritten.

## File viewers (agent publishing)

Upload the source file directly; do not build an HTML wrapper just to make it
readable. With viewer assets enabled, opening a standalone file's returned
content URL in a browser shows:

- `.md` / `.markdown`: formatted Markdown, including tables and fenced
  `mermaid`, `dot` or `graphviz` diagrams.
- Common images, including `.svg`: an image viewer.
- `.pdf`: a paginated PDF viewer.
- `.mmd` / `.mermaid`: Mermaid diagrams; `.dot` / `.gv`: Graphviz diagrams.

Renderers are bundled locally; source is not sent to a rendering service.
Viewers provide original-file download links. CLI/MCP fetch remains byte-exact;
non-HTML requests and byte ranges are not replaced with viewer HTML.
Directory paths with `index.html` (preferred) or `index.htm` serve static sites
unchanged. Without an index, browse immediate children and empty/nested directories;
An immediate regular `readme.md` (case-insensitive) renders below the listing
using the local Markdown viewer when enabled. Preference: `README.md`, then
`readme.md`, then lexicographic order for other case variants.
To view a supported file
inside a directory, append `/__manure/view/<segment-encoded-file-path>` to its
content base (e.g. `/__manure/view/reports/summary.md`). Use relative paths for
Markdown resources; automatic external resource loading is blocked. A viewer
is not an authorization change: internal/external/public and expiry still apply.
Do not present the existence of these source changes as proof that a particular
server has been upgraded; verify the deployed instance when that matters.

## Visibility / access

- `--access internal|external|public` is required on `upload` (and
  `access` on MCP `upload_artifact`).
- `internal`: authenticated reads only (API bearer or grant handoff).
- `external`: password-protected link. The generating call
  (`upload --access external`, `rotate-password`, patch-to-external)
  returns `external_password`. Every registered user can retrieve the current
  password with the dashboard's **Copy current password** or management
  `GetExternalPassword`. It never appears in listings, info, manifests, search,
  payload sidecars, errors or logs. Historical hash-only passwords require one
  explicit `rotate-password` before retrieval is available. Retrieval itself
  does not rotate or revoke grants. Passwords and database backups are secret-bearing.
- `public`: anonymous reads allowed.

## TTL

- `--expires-in 3600|30m|2h|7d|...` (also `expires_in_s` seconds in MCP).
  Range `60..31536000` (365d); invalid values fail before network.
  Expiry cuts authorization immediately (410 authed / 404 anon+content);
  the sweeper deletes physically later.

## Optional upload metadata

Attach metadata only when explicitly supplied: CLI repeatable `--tag`,
`--hostname`, `--project-path`; MCP/Python `tags` (string array), `hostname`,
`project_path`. Defaults are `[]`, `null`, `null`. Hostname/current directory
are never inferred. Metadata is visible to authorized management/search users
and included in the search-provider corpus; do not put secrets or sensitive
local paths in it. Metadata cannot be patched; upload a new artifact to change it.

Values are preserved exactly, without trimming or normalization. Up to 32 unique
case-sensitive nonblank tags (128 Unicode scalars each), optional nonblank
hostname (253) and project path (4096). Invalid values fail before network.

## CLI

```bash
manure whoami [--json]
manure list [--limit N] [--cursor C] [--include-expired] [--visibility V] [--state S] [--json]
manure search 'QUERY' [--limit N] [--cursor C] [--json]
manure info <artifact-id> [--json]
manure upload <path> --access internal|external|public [--name N] [--tag T ...] [--hostname H] [--project-path P] [--expires-in 7d] [--resume ID] [--fresh] [--json]
manure fetch <artifact-id-or-content-url> <dest-dir> [--password P] [--password-file F] [--json]
manure delete <artifact-id> [--json]
manure rotate-password <artifact-id> [--json]
manure --cache-dir <dir> <subcommand>...
manure <subcommand>... --color auto|always|never
```

All global options (`--json`, `--color`, `--cache-dir`, `--allow-insecure-http`)
work before or after the command. `--color auto` is the default: style human
terminal streams only, keeping pipes plain. Nonempty `NO_COLOR` or `TERM=dumb`
disables automatic color; explicit `always`/`never` overrides the environment.
`--json` always disables ANSI, including help and diagnostics. Use `--help` on
any command for operands, limits and safety notes; it never reads credentials.
`--access` remains required on every upload, including resume, and missing
required arguments fail before credential-file reads. Parser errors omit argv
values to avoid disclosing misplaced passwords. Spell long options in full;
implicit abbreviations are not accepted.

Output is human-readable by default, even when piped: artifact tables, labeled
metadata and upload/download/mutation receipts. For automation, pass `--json`
before or after any command (including `delete`); JSON success shapes are
unchanged. Errors remain sanitized text on stderr with empty stdout and the
same exit codes (0 success, 2 usage/validation, 1 other failure). Human output
escapes terminal controls, does not abbreviate IDs/URLs/passwords, and displays
pagination cursors explicitly; continue with `--cursor` and the same list options.
Generated external passwords appear on stdout in either format: do not log them.

- `upload` walks regular files plus empty dirs; symlinks are rejected
  before network. Manifest topology (`__manure`/`api` reserved, no `..`,
  depth/length bounds, file/descendant conflicts) is validated client-side.
- Uploads are chunked, resumable, and published atomically. After every
  successful init the CLI writes `<cache>/uploads/<id>.json`
  (`artifact_id`, `api_base`, `local_path`, `manifest_sha256`, `access`, `tags`, `hostname`, `project_path`;
  never secrets). Plain `upload <path>` auto-resumes when exactly one
  record matches, including exact metadata; `--resume ID` selects and rejects
  metadata mismatch; `--fresh` inits anew. Older cache records mean empty
  metadata only, not a wildcard. Resume verifies the actual server metadata
  before mutation or success; changed metadata never reuses the old artifact.
  Changed sources fail `source-changed` (exit 2). A resumed external
  upload explains the missing password with a `rotate-password to re-issue`
  note. With `--json` this remains `external_password: null` plus
  `password_note: "rotate-password to re-issue"`.
- `fetch` streams with `Range`, writes temp plus atomic rename, verifies
  SHA-256 per file, recreates empty dirs, and never creates, follows, or
  overwrites symlinks. Token-free external fetch uses the content URL:
  JSON unlock POST (with `Origin`), in-memory grant cookie,
  `/__manure/manifest`, ranged `/__manure/files/.../content`.

## MCP stdio (`python -m manure.mcp`)

- Real JSON-RPC 2.0 over stdio, one object per line, no `Content-Length`
  framing. Stdout carries only protocol messages; diagnostics go to stderr.
- Version `2025-11-25`. Lifecycle: `initialize` → `notifications/initialized`
  → `ping` / `tools/list` / `tools/call`.
- Tools: `whoami`, `list_artifacts`, `search`, `get_artifact`, `get_manifest`,
  `upload_artifact`, `fetch_artifact`, `delete_artifact`,
  `rotate_external_password`. Read tools are read-only+idempotent;
  upload/fetch/delete/rotate are open-world. Auth comes from process env
  with the same precedence/ambiguity rules as the CLI.

### Search expressions

CLI `manure search 'QUERY' [--limit N] [--cursor C] [--json]` and MCP `search`
(required `query`, optional `limit` / `cursor`) share the dashboard query dialect,
with no separate filtering arguments. CLI output is human-readable unless
`--json` is supplied; retrieval output includes evidence, provenance and count
scope. Bad expressions exit 2; an explicit unavailable mode is an error, never substituted:

```text
access:public state:ready sort:name direction:asc report
mode:lexical access:internal kind:dir owner:"Exact User" "quarterly report"
mode:semantic tag:release tag:report hostname:build-host project:"/work/project" text:"release notes"
```

Without `mode:`, search text runs `hybrid` when the server offers it, else
`lexical`; a hybrid search the server cannot run (`search-unavailable`) is
re-run once lexically. Each substitution prints `Hybrid search is not available
on this server: <reason>; showing lexical results` (CLI stderr; MCP `notice`).
The effective mode is shown (`Mode:` line; MCP `mode`). Semantic/hybrid pages
report `pending` items whose current version is not yet indexed (an older indexed
version may still match; CLI stderr note; MCP `pending_note`).
No text, a catalogue-only field or `--cursor` selects `mode:catalogue`, which
matches literal name/artifact-ID/tag/hostname/project substrings, hides
expired items and sorts `created_at desc`. Catalogue-only fields are `state`,
`expired`, `sort`, `direction`. Retrieval-only fields are `kind:file|dir` and
`owner:<exact creator>`. `access:internal|external|public`, repeatable
`tag:<exact tag>`, `hostname:<exact host>` and `project:<exact path>` work in all
modes. These metadata values are case-sensitive exact matches; repeated tags
require all of them (AND), with no duplicates.
Retrieval modes `lexical`, `semantic`, `hybrid` search artifact metadata/manifest
paths, not file bytes; retrieval requires nonblank text and rejects cursors.
Semantic/hybrid use the configured provider; only a defaulted hybrid falls back, visibly.
Fields conjoin; Boolean metadata expressions are unsupported. Only distinct
tags may repeat. Field names are case-insensitive, closed values lowercase. Quote values with JSON strings.
Bare quoted retrieval phrases preserve their quotes for the English search
engine. Use `text:<JSON string>` for exact text or literal colon/operator-shaped
data; do not combine it with bare terms. Expressions over 131072 UTF-16 units, compiled search text over 4096 UTF-16 units,
invalid fields/values/escapes and unsupported filter combinations fail explicitly.
See `docs/query.md` for all sort values and pagination semantics.

## Safety

- Do not paste tokens, passwords, or grant values into chat, URLs, or logs.
- Do not overwrite or follow symlinks in fetch destinations.
- Public links are world-readable; external links need the password;
  internal links need the API token or a grant handoff.
