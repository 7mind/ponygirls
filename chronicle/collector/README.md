# Chronicle collector

Independent, opt-in Node 24 user daemon. No producer SDK or runtime npm dependencies. Uses the generated Baboon v1 codecs in `../generated/typescript/` for ingestion and acknowledgements. It never starts a harness, opens an attachment, executes a transcript command, or contacts a transcript URL.

## Build and run

```bash
cd chronicle/collector
npm ci --ignore-scripts
npm test
npm run typecheck
npm run build
node dist/collector/src/cli.js --config /absolute/collector.json --once
node dist/collector/src/cli.js --config /absolute/collector.json --status
node dist/collector/src/cli.js --config /absolute/collector.json
```

The build emits generated codecs under `dist/generated/` alongside the collector under `dist/collector/`. Keep this layout and a parent `package.json` with `"type":"module"` when packaging. `git` must be available on a trusted PATH (the Nix wrapper supplies it). Tests use synthetic temporary homes, repositories, transcripts and loopback HTTP only; no default home is scanned.

Minimal configuration (all paths absolute; create the token file outside the Nix store with mode 0600/0400):

```json
{
  "enabled": true,
  "endpoint": "https://chronicle.example.invalid",
  "tokenFile": "/run/user/1000/chronicle-token",
  "stateDir": "/home/example/.local/state/chronicle"
}
```

`enabled` defaults to false. Disabled runs do not discover roots, open the spool, query git, read credentials or upload anything. HTTPS is required except `http://localhost`, `http://127.0.0.1` and `http://[::1]`; other HTTP destinations require explicit `"trustedHTTP":true`. HTTP does not encrypt the bearer token or transcript. Endpoint URL credentials, queries, fragments and redirects are rejected. Endpoint path must be `/` or `/api/ingest`. The bearer token is read from its file for every attempt; it is never accepted in argv/URL/environment. Group/world-readable token files are rejected.

Additional keys, with defaults:

| Key | Default / meaning |
| --- | --- |
| `discoverNative`, `discoverYolo` | `true`, `true` once enabled |
| `homeDir` | OS home; synthetic override for tests |
| `yoloDir` | `<homeDir>/.config/yolo` |
| `roots` | `[]`; explicit transcript directory roots `{id,format,path}`; format `pi`, `claude`, `codex` |
| `exclusions` | `{roots:[],profiles:[],projects:[],sessions:[],paths:[]}` |
| `redactions` | `{fieldNames:[],textPatterns:[]}` |
| `quietMs`, `pollMs` | `60000`, `30000` |
| `maxDepth`, `maxFiles` | `16`, `10000`; files limit counts traversed entries, including directories |
| `maxScanBytes`, `maxFileBytes` | `134217728`, `4194304` |
| `maxPayloadBytes`, `maxMessages` | `8388608`, `10000` |
| `partialLineQuarantineMs` | `86400000` |
| `uploadTimeoutMs`, `maxAttempts` | `15000`, `8` |
| `backoffBaseMs`, `backoffCapMs` | `1000`, `300000` |

Unknown keys, invalid types/bounds, duplicate explicit root `(id,format)` pairs, relative paths and empty redaction patterns fail configuration validation. `quietMs:0` is an explicit immediate-snapshot policy. Other duration/size bounds must be positive integers. Configure sufficient file/scan limits for the desired coverage: hitting a limit is visible quarantine and may leave later entries unscanned until the bound is raised. There is no silent truncation or promise of complete coverage after a limited scan.

## Discovery and identity

Every cycle discovers newly created named yolo profiles and hashes source contents, not just mtimes. Native roots are:

- Claude: `~/.claude/projects/`, main JSONL plus `<session>/subagents/**/agent-*.jsonl` (including workflow nesting).
- Codex: both `~/.codex/sessions/` and `~/.codex/archived_sessions/`.
- Pi: `~/.pi/agent/sessions/<project>/*.jsonl` and only `~/.pi/agent/subagents/<root>/sessions/<agent>/*.jsonl` beneath subagents. Journals/event logs there are not transcripts.

Linux yolo profile stores are `<yoloDir>/<profile>/claude/home/projects`, `codex/home/{sessions,archived_sessions}`, and `pi/home/agent/{sessions,subagents}`. Darwin uses `claude/projects`, `codex/{sessions,archived_sessions}` and `pi/{sessions,subagents}` directly under the profile. Other layouts can use explicit roots. Explicit Pi roots point at the sessions directory, not the agent directory. Memory, file-history, configuration and `.git` directories are excluded from transcript traversal. Only regular JSONL files are read. Symlinked files, roots and ancestor directories are rejected; inode/stat consistency and ancestor checks run around bounded snapshot reads.

Source identity is the persisted collector namespace, stable root ID, producer format, producer session ID and nullable subagent ID. Default root IDs are `native` and `yolo:<profile>`. Keep explicit root IDs stable when moving storage. Claude child transcripts may repeat the parent's session ID: `agentId`/agent filename is a separate discriminator. Pi subagent directory agent IDs are also explicit discriminators. Copied IDs in different profiles cannot overwrite each other's heads. Divergent copies with the same identity *within* a root are quarantined rather than choosing a winner. Source paths do not establish identity; uploaded file paths are logical paths relative to the discovery root, not absolute host paths.

## Fidelity, privacy and metadata

JSONL order, permitted unknown fields, original Pi branches/compaction records and tree parents are retained. Unredacted lines retain their exact UTF-8 bytes (including spacing/CRLF). A redacted line is reserialized as JSON, flagged by `redacted=true`. Normalized messages retain record indexes, role, text, tool-call arguments/output, original IDs/parents and available timestamps. Unicode is not reduced to ASCII. Pi user/assistant/system/custom/bash/branch/compaction messages are handled; all original branches survive. Claude tool_use/tool_result and summaries are searchable. Codex response items are preferred to exact mirrored event text; legacy events and current paginated `item_completed` user/assistant/reasoning/command/MCP/dynamic-tool/plan/hook items are normalized. Unknown records remain in raw archives, not invented text.

Privacy is applied before payload creation, durable spooling and uploads:

- Root/profile/session exclusions are literal identities (excluding a Pi root session also excludes its subordinate transcript directory); project/path exclusions are literal path prefixes with path-component boundaries. Producer workdir/session metadata is checked before redaction can obscure an exclusion.
- Configured field names match recursively, case-insensitively; configured text patterns are nonempty literal substrings, not regular expressions. JSON encoded inside strings is also inspected for these field rules.
- Built-in credential fields (`authorization`, `apiKey`/`api_key`, `access_token`, `refresh_token`, `password`, `secret`, `credential`) are removed.
- String `data` fields, base64/bytes/blob/file_data, encrypted content/arguments, opaque signature fields, image-generation results, data-URI base64 payloads and contiguous opaque base64-like runs of at least 256 characters are replaced. This intentionally conservative policy can redact nonbinary long identifiers and ordinary string `data`; object-valued extension `data` and unknown nonbinary fields remain. Attachments/referenced files are never dereferenced.
- Git remote credentials, query parameters and fragments are stripped. Diagnostics contain only stable codes/root identifiers and hashed paths, never record excerpts, tokens, URLs or exception strings.

Authoritative producer-recorded metadata takes precedence. Project is the producer workdir path, not an inferred project name. Missing metadata stays absent. If a remote is missing and a workdir is available, the injected git port runs only `git config --local --no-includes --get remote.origin.url`, with no shell/network, a minimal environment, a 1-second timeout and 64KiB stdout bound. Results are cached per workdir per scan and pass the same redaction policy. This is a **collector observation of the current checkout**, not historical session metadata: its tag is `collector-observed-current-git-remote`. No current branch/commit is substituted for missing historical values. Gone/non-git workdirs leave the remote absent; diagnostic codes are informational, not session quarantine.

No format supplies authoritative whole-session completion here. End-of-turn/task_complete, archived location, process absence and assistant stop reasons do **not** prove session closure. Every upload is `Quiescent`, with `endedAt=null`. The quiet window starts when the collector first observes unchanged content digest **and** mtime; resumed, truncated, rotated or same-size/same-mtime rewritten sources are reconciled again. A partial final line is never imported as a complete snapshot; it waits and becomes visible `partial-line-expired` quarantine only after the configured unchanged interval. JSON syntax/UTF-8/identity/version/size failures have distinct safe diagnostics. Quarantine stores diagnostics, not a second copy of rejected contents.

The frozen v1 server stores `Quiescent` but has no field for the measured observation duration or absolute canonical source path. Observation checkpoints stay in the local spool; server revision creation time is not proof of the source's quiet duration. Codex `history_base`/Pi `parentSession` references are preserved but **never followed**; a paginated history prefix residing in a different source file is not materialized into this snapshot.

## Durability and operations

The private state directory is mode 0700, SQLite databases mode 0600. SQLite FULL synchronous transactions persist namespace, observations, source heads, exact pending encoded payload/digest, expected revision, request UUID and retry state before uploading. A separate SQLite exclusive daemon lock is automatically released on process death; there are no stale PID files. `--status` is read-only with respect to collection and does not need the daemon lock.

Lost acknowledgements retry the **same bytes and request ID**, including after restart. Only a valid matching generated receipt with exactly the expected next revision advances the local head. CAS conflicts stay visible and never silently adjust expected revision. Retryable network/408/429/5xx failures use capped exponential full jitter and finite attempts. Auth/protocol/invalid-receipt failures stop immediately; redirects are never followed. Uploads have a total request/body-read timeout and bounded acknowledgement size.

```bash
node dist/collector/src/cli.js --config /absolute/collector.json --retry REQUEST_UUID
node dist/collector/src/cli.js --config /absolute/collector.json --drop REQUEST_UUID
```

Retry resets the finite attempt budget but retains the payload, request ID and expected revision. It does not resolve an actual CAS conflict. Drop deletes local pending bytes and creates a persistent **local source tombstone**, preventing automatic requeue; it does not delete the server's archive. A changed privacy/discovery/destination policy conservatively discards all older pending payloads and tombstones those sources, because an earlier upload may already have committed despite a lost acknowledgement. These tombstones and their reason are visible in status. There is no automatic tombstone removal, remote purge, stale-head merge or receipt reconstruction after discarding bytes; resolve those cases explicitly with the server operator rather than editing a CAS expectation blindly. `secure_delete` is enabled, but this is not a forensic-erasure guarantee for filesystem backups or old storage blocks.

`--once` reconciles and attempts due queue entries, emits JSON counters, and exits nonzero for upload/quarantine/pending/stopped/conflict failures. Waiting for first observed quiet evidence is not an error. Daemon mode prints the same counters each cycle. `--status` emits `{namespace,queue,diagnostics,dropped,lastRun}`; `lastRun` includes timestamp, counters and hashed per-root coverage. Counters describe the last local scan, not a claim that every possible session was discovered or server annotation finished. Missing native roots are informational. Diagnostic status and pending/stopped queues survive restart. Successful raw ingestion does not mean annotation/search publication completed.

## Fixture provenance and verification scope

All `test/fixtures/*.jsonl` are manually constructed synthetic examples, not captured production sessions. Their field shapes were checked against:

- Installed Pi `@earendil-works/pi-coding-agent` **1.4.0**, complete `docs/session-format.md`, `sessions.md`, `message-types.md`, `sdk.md`, and exported `dist/core/{session-manager,messages}.d.ts`.
- Public Anthropic Claude Agent SDK Python `src/claude_agent_sdk/_internal/sessions.py`, commit **0e89b298e771259378a6cd3734e00d323dff5703**: `sessionId`, `uuid`, `parentUuid`, nested `subagents/**/agent-*.jsonl`, message/tool contents. Claude Code's implementation itself is closed; this is authoritative SDK reader evidence, not an exhaustive native schema claim.
- Public OpenAI Codex commit **970111f6cb62cc02fe36a82ea7d71b37a2889c97**: `codex-rs/protocol/src/{protocol,models,items,user_input}.rs`, `codex-rs/history/src/rollout_payload.rs`, `codex-rs/rollout/src/policy.rs`. These establish SessionMeta, ResponseItem, legacy EventMsg and paginated PascalCase TurnItem persistence.

Tests cover parser/privacy blackbox behavior; shared memory/real SQLite spool contracts; real temporary filesystem/discovery and git-port contracts; loopback HTTP timeouts/errors/receipts; CLI disabled/status/exit policies and process-kill lock recovery. No real user sessions/authentication stores were inspected. This package's loopback server tests are not proof of compatibility with the actual Scala service; that integrated workflow is a separate repository acceptance gate.
