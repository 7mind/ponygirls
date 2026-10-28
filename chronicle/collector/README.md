# Chronicle collector

Independent, opt-in Node 24 user daemon. No producer SDK or runtime npm dependencies. Uses the generated Baboon 1.5 codecs in `../generated/typescript/` for ingestion, progress and acknowledgements. It never starts a harness, opens an attachment, executes a transcript command, or contacts a transcript URL.

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

`--config` is optional: the CLI reads `$XDG_CONFIG_HOME/chronicle/collector.json`, or `~/.config/chronicle/collector.json` when `XDG_CONFIG_HOME` is unset, empty or relative. An explicit `--config /absolute/path.json` overrides that location. A missing or invalid selected file fails; the CLI never searches the working directory or falls back to another config after an error.

Home Manager installs the exact generated daemon configuration at this default location when `collector.enable` is enabled, so the packaged CLI can be used directly:

```bash
chronicle-collector --status
chronicle-collector --status --json # machine-readable snapshot
```

The daemon retains its explicit generated configuration path. These files contain credential **paths**, never credential values; `--status` still does not read credentials, scan transcripts or upload.

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

`enabled` defaults to false. Disabled runs do not discover roots, open the spool, query git, read credentials or upload anything. HTTPS is required except `http://localhost`, `http://127.0.0.1` and `http://[::1]`; other HTTP destinations require explicit `"trustedHTTP":true`. HTTP does not encrypt the bearer token or transcript. Endpoint URL credentials, queries, fragments and redirects are rejected. Endpoint path must be `/` or `/api/ingest`. The bearer token is read from its file for every attempt; it is never accepted in argv/URL/environment. Group/world-readable token files and credentials resolving into `/nix/store/` are rejected. The Ingest bearer is also used for progress reporting; no Read or Raw scope is required. Home Manager's `chronicle.collector.tokenFile` is independent of the MCP/agent `chronicle.tokenFile`, defaulting to it only for compatibility.

Additional keys, with defaults:

| Key | Default / meaning |
| --- | --- |
| `discoverNative`, `discoverYolo` | `true`, `true` once enabled |
| `excludeDefaultProfile` | `false`; reversible exclusion of shared native/default-yolo storage |
| `excludedYoloProfiles` | `[]`; exact case-sensitive named-profile exclusion set, sorted/deduplicated |
| `homeDir` | OS home; synthetic override for tests |
| `yoloDir` | `<homeDir>/.config/yolo` |
| `roots` | `[]`; explicit transcript directory roots `{id,format,path}`; format `pi`, `claude`, `codex` |
| `exclusions` | `{roots:[],profiles:[],projects:[],sessions:[],paths:[]}` |
| `redactions` | `{fieldNames:[],textPatterns:[],secretFiles:[]}`; secretFiles are absolute runtime file paths, never values |
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
- Pi: `~/.pi/agent/sessions/<project>/*.jsonl` and only `~/.pi/agent/subagents/<root>/sessions/<agent>/*.jsonl` beneath subagents. Journals/event logs there are not transcripts. Unrelated subagent worktrees, dependencies and attachments are not traversed or counted against the transcript-entry budget, and their symlinks do not generate diagnostics. Symlinks in supported transcript paths remain rejected.

Linux yolo profile stores are `<yoloDir>/<profile>/claude/home/projects`, `codex/home/{sessions,archived_sessions}`, and `pi/home/agent/{sessions,subagents}`. Darwin uses `claude/projects`, `codex/{sessions,archived_sessions}` and `pi/{sessions,subagents}` directly under the profile. Other layouts can use explicit roots. Explicit Pi roots point at the sessions directory, not the agent directory. Memory, file-history, configuration and `.git` directories are excluded from transcript traversal. Only regular JSONL files are read. Symlinked files, roots and ancestor directories are rejected; inode/stat consistency and ancestor checks run around bounded snapshot reads.

Source identity is the persisted collector namespace, stable root ID, producer format, producer session ID and nullable subagent ID. Default root IDs are `native` and `yolo:<profile>`. Keep explicit root IDs stable when moving storage. Claude child transcripts may repeat the parent's session ID: `agentId`/agent filename is a separate discriminator. Pi subagent directory agent IDs are also explicit discriminators. Copied IDs in different profiles cannot overwrite each other's heads. Divergent copies with the same identity *within* a root are quarantined rather than choosing a winner. Pi restoration files named exactly `restored-<8 lowercase hex>-<8 lowercase hex>.jsonl` retain the original producer session ID and actual subagent ID but use the stable child collector namespace `<spool namespace>/pi-restored/<SHA-256 of filename stem>`. Each restoration is a separate episode, including divergent histories; none is merged or selected as the authoritative longest/latest history. Editing a restoration advances that episode's CAS revision; copying/moving the same basename within the same root/producer/agent scope deduplicates it, while another restoration basename or agent remains distinct. Ordinary Pi filenames and all Claude/Codex files retain their existing identity and keys. Renaming a restoration basename creates a new episode, so preserve these names during storage moves. Paths otherwise do not establish identity; uploaded file paths are logical paths relative to the discovery root, not absolute host paths.

The exported `sourceIdentity(namespace, rootId, format, transcript, sourcePath)` requires the source path so runtime and preflight callers apply the same episode rule. Only its basename is used for restoration scoping; absolute paths are not hashed into identity. This rule does not change the privacy-policy digest, discard pending entries, or reset acknowledged source heads. Progress reporting continues to use the persisted spool namespace, not episode child namespaces. Upgrade preflight must check whether restoration files were already imported or queued under the old namespace: those existing archives/pending requests are preserved, and a new child episode can therefore duplicate previously imported history. Do not clear pending requests or reset the spool to hide that situation; resolve it explicitly with the operator. Restoration files that were only quarantined for identity collisions have no acknowledged history to migrate.

The server/dashboard can display and filter a **Recorded yolo profile** from an exact launcher-valid `yolo:<name>` discovery-root ID already stored in source identity. No new metadata tag, payload field, raw digest, source key, revision or receipt is introduced. This is a recorded root claim, not proof of auto-discovery or the original launch profile: explicit roots may use such IDs and sessions can be copied between storage profiles. Native/default storage does not distinguish bare native launches from the default yolo launch. This read-side attribute does not itself admit or exclude uploads.

## Reversible profile admission

`excludeDefaultProfile: true` excludes ordinary native **and default-yolo** sessions: both use the same `~/.claude`, `~/.codex` and `~/.pi/agent` stores, including archived/child transcripts. Only built-in discovery of valid named-yolo storage remains admissible. `excludedYoloProfiles: ["personal", "private"]` excludes those exact names; `Foo` and `foo` differ. Names must match the launchers' nonempty `[A-Za-z0-9._-]+` grammar, excluding `.` and `..`; null/non-list/non-string/invalid values are rejected. Duplicate names are removed and names sorted deterministically. A named folder literally called `default` is a named profile, not shared native/default storage.

**Any active restriction also holds ALL explicit/custom roots and legacy/unknown queue origins**, even if their IDs claim `yolo:allowed` or their paths point into an actual named store. Explicit roots do not carry the built-in discovery observation required to prove eligibility. No restriction (both defaults) preserves old discovery/replay behavior, including unknown legacy origins. A nonempty named exclusion set alone does not exclude known native storage; use `excludeDefaultProfile` for that. Existing `discoverNative`, `discoverYolo` and `exclusions` are independent and are never remapped to these controls. Home Manager exposes the same names under `smind.hm.dev.llm.chronicle.collector`. The daemon snapshots configuration at startup: restart it after changing configuration; no hot reload is provided.

Admission is checked before transcript traversal and immediately before every snapshot upload, including retries. It uses collector-owned storage observations, never recorded root-ID claims, path resemblance, tags or transcript prose. Copying sessions/hardlinks, custom mounts and environment overrides can move bytes between stores: this is a **storage-root policy**, not an unbypassable guarantee about the original launch profile or authenticated host identity.

New enqueues atomically retain a separate local `pending-origin` KV record bound to request ID, payload digest and source key alongside the original pending/reservation records. It does not alter encoded payloads, source identity, raw digests or server receipts. Missing legacy provenance remains unknown forever for that request; rescanning a matching named root does not backfill or upgrade it. Present malformed/mismatched provenance is `invalid-pending-origin`, not an unknown-origin fallback. Reads of pending rows and provenance share a SQLite read snapshot. ACK/drop atomically removes the sidecar; retry/fail preserves it.

Held requests retain their exact request ID, body/digests, expected revision, retry attempts/schedule/error, transport status, source reservation and head. They make **zero snapshot `/api/ingest` POSTs** while held; progress-report POSTs still occur. Removing restrictions resumes the same eligible request/body, respecting its existing due time and stopped/conflict state. Admission never calls drop, creates a tombstone, clears the queue or deletes an existing server archive. The new controls are absent from the existing privacy-policy digest. **Existing privacy/destination/discovery/exclusion policy invalidation remains destructive as documented below**, including while a request is held; admission is not an exemption from that policy.

Pending/stopped/conflict counters remain literal durable-state counts, including held requests. Local `--status` adds a current-policy held count/reason using existing diagnostic fields; `--status --json` retains its existing shape. Current hold diagnostics are recomputed rather than leaving stale holds after re-admission/ACK/drop; saved scan counters remain historical evidence. This status overlay does not scan transcripts, read credentials, upload or mutate queue/provenance. The existing spool constructor can still initialize an absent state directory; this is not a new strictly filesystem-read-only mode.

A held-only pass reports `Idle` with no collector error: no admitted work is active, but the queue is **not drained**. Held stopped/conflict rows retain their counts/errors without manufacturing a current admitted failure. Actual admitted/scan/privacy/report failures still report `Failed`. The frozen remote progress protocol cannot distinguish admission holds from pending backoff; inspect local status for reasons. `--once` keeps its existing exit-1 contract for any undrained pending/stopped/conflict queue, including intentional holds; that does not increment failure counters or turn an intentional hold into a Failed progress report.

## Fidelity, privacy and metadata

JSONL order, permitted unknown fields, original Pi branches/compaction records and tree parents are retained. Unredacted lines retain their exact UTF-8 bytes (including spacing/CRLF). A redacted line is reserialized as JSON, flagged by `redacted=true`. Normalized messages retain record indexes, role, text, tool-call arguments/output, original IDs/parents and available timestamps. Unicode is not reduced to ASCII. Pi user/assistant/system/custom/bash/branch/compaction messages are handled; all original branches survive. Claude tool_use/tool_result and summaries are searchable. Codex response items are preferred to exact mirrored event text; legacy events and current paginated `item_completed` user/assistant/reasoning/command/MCP/dynamic-tool/plan/hook items are normalized. Unknown records remain in raw archives, not invented text.

Privacy is applied before payload creation, durable spooling and uploads:

- Root/profile/session exclusions are literal identities (excluding a Pi root session also excludes its subordinate transcript directory); project/path exclusions are literal path prefixes with path-component boundaries. Producer workdir/session metadata is checked before redaction can obscure an exclusion.
- Configured field names match recursively, case-insensitively; configured text patterns are nonempty literal substrings, not regular expressions. JSON encoded inside strings is also inspected for these field rules.
- Built-in credential fields (`authorization`, `apiKey`/`api_key`, `access_token`, `refresh_token`, `password`, `secret`, `credential`) are removed.
- `redactions.secretFiles` supplies **known credential literals from runtime files**, plus the collector's own Ingest bearer file automatically. Each cycle resolves these files once before discovery or ingestion. Literal values and JSON-escaped variants use the existing literal replacement policy in both raw records and normalized messages; no regex interpolation. Keep credential values out of Nix `textPatterns`, configuration, argv and logs.
- String `data` fields, base64/bytes/blob/file_data, encrypted content/arguments, opaque signature fields, image-generation results, data-URI base64 payloads and contiguous opaque base64-like runs of at least 256 characters are replaced. This intentionally conservative policy can redact nonbinary long identifiers and ordinary string `data`; object-valued extension `data` and unknown nonbinary fields remain. Attachments/referenced files are never dereferenced.
- Git remote credentials, query parameters and fragments are stripped. Diagnostics contain only stable codes/root identifiers and hashed paths, never record excerpts, tokens, URLs or exception strings.

Built-in field rules **cannot detect unknown secrets printed as ordinary tool stdout**. Configure relevant runtime credential files and verify redacted payloads before enabling collection. This is not a universal secret detector: historical/rotated values require retained private literal files if they must still be removed. A configured file represents one UTF-8 literal; only a single terminal LF/CRLF is removed (the transport bearer additionally trims surrounding whitespace). Files must be nonempty, private (no group/world permissions), regular, at most 8192 bytes and resolve outside `/nix/store/`. Runtime age symlinks are supported. Missing/unreadable/invalid UTF-8/empty/oversized files fail closed with `privacy-secret-unavailable`: no discovery or ingestion, including already pending entries. Disabled runs and `--status` do not read credentials.

The exported `resolveRuntimePrivacy(config, secretReader)` in `src/runtime-privacy.ts` returns `{policy,identity}` and is the common runtime/preflight boundary. Pass `new FileSecretReader()` for real files and the returned `.policy` to `parseTranscript`; never log the policy's closure or secret contents. Resolved-pattern identity enters the durable privacy-policy digest. Changing any resolved secret (including the Ingest bearer), or upgrading from a policy without this identity, invalidates older pending payloads through the existing **explicit drop + source tombstone** policy. It does not silently rewrite/retry them. A failed resolution leaves pending bytes untouched but will not upload them; restoring the identical policy permits normal retry. Resolve tombstones explicitly with the operator; rotating a credential is not automatic historical archive cleanup.

Authoritative producer-recorded metadata takes precedence. Project is the producer workdir path, not an inferred project name. Missing metadata stays absent. If a remote is missing and a workdir is available, the injected git port runs only `git config --local --no-includes --get remote.origin.url`, with no shell/network, a minimal environment, a 1-second timeout and 64KiB stdout bound. Results are cached per workdir per scan and pass the same redaction policy. This is a **collector observation of the current checkout**, not historical session metadata: its tag is `collector-observed-current-git-remote`. No current branch/commit is substituted for missing historical values. Gone/non-git workdirs leave the remote absent; diagnostic codes are informational, not session quarantine.

Pi subagent metadata is classified only by the canonical path-derived subagent ID, not a `parentSession` reference or a task-looking message. Future Pi snapshots from that source get the stable `subagent` tag, alongside any existing git-observation tag. An explicit `session_info.name` still wins. Otherwise one exact leading `[subagent <matching-agent> task <run>]` line is skipped only for deriving the fallback title; leading blank task formatting is ignored and an empty task body uses `pi session`. Fallback previews retain their 160 UTF-16-unit bound without splitting Unicode scalar values. Original permitted JSONL, normalized messages, records and source identity keep the harness header unchanged.

This is a future-snapshot projection, not an archive backfill: unchanged acknowledged raw digests do not resend, and already-spooled requests retain their original exact metadata/payload/request ID. Changing metadata under an existing ID violates receipt binding; changing the privacy-policy digest to force refresh can tombstone pending sources. Existing title/tag repair needs a separately authorized metadata-revision or migration workflow, not a spool reset or re-ingestion campaign.

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

`--once` reconciles and attempts due queue entries, emits JSON counters, and exits nonzero for upload/quarantine/pending/stopped/conflict or progress-reporting failures. Waiting for first observed quiet evidence is not an error. Daemon mode prints the same counters each cycle. `--status` defaults to a human-readable summary of the saved scan, byte totals, per-root coverage, queue, diagnostics, dropped requests and reporting acknowledgements. It does not infer that the daemon is running or server indexing is complete. `--status --json` retains the machine-readable `{namespace,queue,diagnostics,dropped,lastRun,reporting}` snapshot; `lastRun` includes its scan-start timestamp, counters and hashed per-root coverage. Counters describe the last local scan, not a claim that every possible session was discovered or server annotation finished. Missing native roots are informational. Diagnostic status and pending/stopped queues survive restart. Successful raw ingestion does not mean annotation/search publication completed.

## Collection progress (protocol 1.2)

Every enabled CLI cycle reports `Discovering`, `Scanning`, `Uploading`, then `Idle` or `Failed` to `POST /api/collector/progress`. The collector ID is the persisted spool namespace. Each cycle has a new run UUID and start time; SQLite transactionally allocates a durable, monotonically increasing sequence **before** sending. Gaps after crashes/lost acknowledgements are valid. Do not delete/reset the spool to retry reporting: that creates a new identity and loses ingestion durability. Servers bound identities per owner (100), so obsolete collector identities require explicit operator handling.

Snapshots contain counters, no transcript excerpts or source paths. `scannedBytes` measures raw bytes read. `totalUploadBytes` is the encoded UTF-8 payload size of this cycle's due pending upload attempts (including retries from previous cycles). `uploadedBytes` increases only after a valid matching receipt **and successful local spool ACK**. A lost ACK never counts as committed locally; a retry may subsequently be acknowledged idempotently. Consequently `uploaded` can exceed `enqueued` when old pending entries succeed. `currentUploadTotalBytes` is the current payload size, **not bytes sent**. Failed/stopped/conflicting/quarantined and future-pending work remains visible through counters and diagnostics; these bytes are not invented as completed uploads.

Reporting uses the same strict destination/bearer policy, a separate 64 KiB body/ACK bound, and the configured total HTTP timeout. A failed report, rejected (`accepted=false`) sequence, or mismatched ACK never advances local accepted freshness, never changes ingestion retry/CAS state, and emits `report-failed`. `reporting` status persists the allocated/accepted sequences, last accepted local timestamp and latest failure. Accepted reports alone clear that failure; diagnostics retain any failure in the current cycle. A reporting failure makes `--once` fail even when ingestion itself succeeds. The server independently timestamps accepted reports and marks them stale after 120 seconds without an accepted update; local timestamps are not server freshness evidence.

Scanning checkpoints publish at most once per five seconds between files/candidates; upload boundaries publish before and after attempts. There is no synthetic timer heartbeat. During a long synchronous directory walk, snapshot read or parse, the event loop may be blocked and the last server snapshot can become stale. That is intentional, not proof of process failure or successful completion. `Idle` describes the collector between cycles, not session closure or server indexing completion; indexing is tracked separately by the backend.

## Fixture provenance and verification scope

All `test/fixtures/*.jsonl` are manually constructed synthetic examples, not captured production sessions. Their field shapes were checked against:

- Installed Pi `@earendil-works/pi-coding-agent` **1.4.0**, complete `docs/session-format.md`, `sessions.md`, `message-types.md`, `sdk.md`, and exported `dist/core/{session-manager,messages}.d.ts`.
- Public Anthropic Claude Agent SDK Python `src/claude_agent_sdk/_internal/sessions.py`, commit **0e89b298e771259378a6cd3734e00d323dff5703**: `sessionId`, `uuid`, `parentUuid`, nested `subagents/**/agent-*.jsonl`, message/tool contents. Claude Code's implementation itself is closed; this is authoritative SDK reader evidence, not an exhaustive native schema claim.
- Public OpenAI Codex commit **970111f6cb62cc02fe36a82ea7d71b37a2889c97**: `codex-rs/protocol/src/{protocol,models,items,user_input}.rs`, `codex-rs/history/src/rollout_payload.rs`, `codex-rs/rollout/src/policy.rs`. These establish SessionMeta, ResponseItem, legacy EventMsg and paginated PascalCase TurnItem persistence.

Tests cover parser/privacy blackbox behavior; shared memory/real SQLite spool contracts; real temporary filesystem/discovery and git-port contracts; loopback HTTP timeouts/errors/receipts; CLI disabled/status/exit policies and process-kill lock recovery. No real user sessions/authentication stores were inspected. This package's loopback server tests are not proof of compatibility with the actual Scala service; that integrated workflow is a separate repository acceptance gate.
