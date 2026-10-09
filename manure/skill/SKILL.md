---
name: manure
description: Host files and directories on manure (artifacts.7mind.io) via CLI or MCP stdio. Use for uploading, fetching, listing, inspecting, deleting artifacts and rotating external passwords.
---

# manure skill

Use `manure` (CLI) or `manure-mcp` (MCP stdio) to host files and directories.
Both wrap the same client code; bearer auth never travels on the command line
(env/file only).

## Triggers

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
- Bearer goes ONLY to the configured API origin; grant cookies go ONLY to
  their exact content host. Cross-origin redirects drop credentials, and any
  cross-origin redirect that would replay a request body (unlock password,
  chunk bytes) is refused outright.

## Visibility / access

- `--access internal|external|public` is required on `upload` (and
  `access` on MCP `upload_artifact`).
- `internal`: authenticated reads only (API bearer or grant handoff).
- `external`: password-protected link. The generating call
  (`upload --access external`, `rotate-password`, patch-to-external)
  returns `external_password` exactly once; it never appears in listings,
  info, manifests, errors, or logs. Lost it? Run `rotate-password`.
- `public`: anonymous reads allowed.

## TTL

- `--expires-in 3600|30m|2h|7d|...` (also `expires_in_s` seconds in MCP).
  Range `60..31536000` (365d); invalid values fail before network.
  Expiry cuts authorization immediately (410 authed / 404 anon+content);
  the sweeper deletes physically later.

## CLI

```bash
manure whoami [--json]
manure list [--limit N] [--cursor C] [--include-expired] [--visibility V] [--state S] [--json]
manure info <artifact-id> [--json]
manure upload <path> --access internal|external|public [--name N] [--expires-in 7d] [--resume ID] [--fresh] [--json]
manure fetch <artifact-id-or-content-url> <dest-dir> [--password P] [--password-file F] [--json]
manure delete <artifact-id>
manure rotate-password <artifact-id> [--json]
manure --cache-dir <dir> <subcommand>...
```

- `upload` walks regular files plus empty dirs; symlinks are rejected
  before network. Manifest topology (`__manure`/`api` reserved, no `..`,
  depth/length bounds, file/descendant conflicts) is validated client-side.
- Uploads are chunked, resumable, and published atomically. After every
  successful init the CLI writes `<cache>/uploads/<id>.json`
  (`artifact_id`, `api_base`, `local_path`, `manifest_sha256`, `access`;
  never secrets). Plain `upload <path>` auto-resumes when exactly one
  record matches; `--resume ID` selects; `--fresh` inits anew.
  Changed sources fail `source-changed` (exit 2). A resumed external
  upload prints `external_password: null` plus
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
- Tools: `whoami`, `list_artifacts`, `get_artifact`, `get_manifest`,
  `upload_artifact`, `fetch_artifact`, `delete_artifact`,
  `rotate_external_password`. Read tools are read-only+idempotent;
  upload/fetch/delete/rotate are open-world. Auth comes from process env
  with the same precedence/ambiguity rules as the CLI.

## Safety

- Do not paste tokens, passwords, or grant values into chat, URLs, or logs.
- Do not overwrite or follow symlinks in fetch destinations.
- Public links are world-readable; external links need the password;
  internal links need the API token or a grant handoff.
