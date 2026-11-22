# Chronicle collector

Independent, opt-in Node 24 user daemon. No producer SDK or runtime npm dependencies. Uses the sole current generated Baboon1.9.0 codecs in `../generated/typescript/` for ingestion, part uploads, progress and acknowledgements. It never starts a harness, opens an attachment, executes a transcript command, or contacts a transcript URL.

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
| `uploadProtocol` | `"parts"`: the part-upload API ([Part uploads](#part-uploads)); `"whole"`: one `/api/ingest` request per revision, as earlier releases — the rollback switch and the setting for a server without the part-upload API |
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
| `maxScanBytes`, `maxFileBytes` | `134217728`, `4194304`; bytes read per scan and per file, `maxFileBytes` ≤ `maxScanBytes` |
| `maxPayloadBytes`, `maxMessages` | `8388608`, `10000`; `maxPayloadBytes` applies to `whole` only |
| `maxRecordBytes` | `33554432`; the longest JSONL record (line) of a `parts` upload, 1048576..134217728 |
| `partialLineQuarantineMs` | `86400000` |
| `uploadTimeoutMs`, `maxAttempts` | `15000`, `8` |
| `backoffBaseMs`, `backoffCapMs` | `1000`, `300000` |

Unknown keys, invalid types/bounds, an `uploadProtocol` other than `parts`/`whole`, `maxRecordBytes` outside its range, `maxFileBytes` above `maxScanBytes`, duplicate explicit root `(id,format)` pairs, relative paths and empty redaction patterns fail configuration validation. `quietMs:0` is an explicit immediate-snapshot policy. Other duration/size bounds must be positive integers. Configure sufficient file limits for the desired coverage: hitting `maxFiles` or `maxDepth` is visible quarantine and may leave later entries unscanned until the bound is raised. `maxScanBytes` only paces reading: files beyond it are deferred to later scans (see [Re-reading, scan budget and size limits](#re-reading-scan-budget-and-size-limits)). There is no silent truncation or promise of complete coverage after a limited scan. Size keys are JSON numbers up to 2^53 − 1; sizes and offsets of files are 64-bit internally. With `whole` a file is held in memory whole, so keep `maxFileBytes` within memory there; with `parts` it is a session bound only (deployment value 8589934592 with `maxScanBytes` at least as large and `maxMessages` 2000000, matching the server).

## Command line

`chronicle-collector --help` (or `-h`, anywhere on the command line) prints this to stdout and exits 0 without reading the configuration or opening state:

```text
chronicle-collector — uploads local Claude, Codex and Pi session histories to Chronicle

Usage: chronicle-collector [--config PATH] [COMMAND] [--json]

Commands:
  (none)              run as a daemon, scanning every poll interval
  --once              scan and upload once, then exit (1 on failure or leftovers)
  --status            show the last scan, the queue and diagnostics
  --pause             stop collecting; queued uploads are kept
  --resume            continue collecting
  --exclude PATH      stop collecting from a directory
  --unexclude PATH    collect from it again
  --exclusions        list excluded directories
  --retry REQUEST_ID  retry a stopped upload on the next scan
  --drop REQUEST_ID   discard a queued upload; its source is not collected again
  --clear-policy-tombstones [--apply]
                      list the sources that a privacy or destination change
                      stopped collecting; with --apply, collect them again

--once, --retry and --drop need the daemon stopped.

Options:
  --config PATH       absolute path of the configuration
                      (default: $XDG_CONFIG_HOME/chronicle/collector.json)
  --json              machine-readable output instead of text (not for --once
                      or the daemon, which always print JSON)
  -h, --help          show this help
```

Output and exit status:

- The daemon and `--once` print one JSON result line per scan; the journal consumes them. They do not take `--json`. Its `paused` names a state that holds every upload back without counting a failure — `server-upload-unsupported` (see [Part uploads](#part-uploads)) or `collection-paused` (`--pause`) — and is null otherwise. Such a state is also told on stderr, in text: one line when it begins (`chronicle-collector: <code>: <the --status or --pause sentence>`), again at most once an hour while it lasts (`<code> since <time>: …`), and one when it ends (`Uploads are no longer paused: <code> ended (since <time>).`). The lines name the server endpoint, never a path, token or session.
- Every other command answers in text. `--json` selects the machine-readable form instead: the status snapshot for `--status`, `--retry` and `--drop`, the control state `{"paused":…,"exclusions":[…]}` for `--pause`, `--resume`, `--exclude`, `--unexclude` and `--exclusions`, and the tombstone report for `--clear-policy-tombstones` (see [Durability and operations](#durability-and-operations)).
- With a disabled configuration `--status`, `--exclusions`, `--retry`, `--drop` and `--clear-policy-tombstones` print `Chronicle collector: disabled`, or `{"enabled":false}` with `--json`; the daemon and `--once` always print `{"enabled":false}`; `--pause`, `--resume`, `--exclude`, `--unexclude` and `--clear-policy-tombstones --apply` fail with `collector-disabled`.
- A usage error (unknown argument, missing or malformed value, relative `--config`, two commands, `--json` with the daemon or `--once`, `--apply` without `--clear-policy-tombstones`) exits 2 before the configuration is read. Stderr names the argument, then points at the help:

  ```text
  chronicle-collector: --retry needs a request id as --status prints it, got 'nonsense'
  Try 'chronicle-collector --help'.
  ```

- A runtime failure exits 1 with `{"code":"…"}` on stderr, for example `{"code":"config-read-failed"}` or `{"code":"collector-already-running"}`.

## Discovery and identity

Every cycle discovers newly created named yolo profiles and hashes the contents of every source it reads; a file is read only once its stat has stayed the same for `quietMs`, and a file whose stat is unchanged since a settled read is not read again (see [Re-reading, scan budget and size limits](#re-reading-scan-budget-and-size-limits)). Native roots are:

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

Pending/stopped/conflict counters remain literal durable-state counts, including held requests. Local `--status` adds a current-policy held count/reason using existing diagnostic fields; `--status --json` retains the existing queue fields and adds control/held-request fields. Current hold diagnostics are recomputed rather than leaving stale holds after re-admission/ACK/drop; saved scan counters remain historical evidence. This status overlay does not scan transcripts, read credentials, upload or mutate queue/provenance. The existing spool constructor can still initialize an absent state directory; this is not a new strictly filesystem-read-only mode.

A held-only pass reports `Idle` with no collector error: no admitted work is active, but the queue is **not drained**. Held stopped/conflict rows retain their counts/errors without manufacturing a current admitted failure. Actual admitted/scan/privacy/report failures still report `Failed`. The frozen remote progress protocol cannot distinguish admission holds from pending backoff; inspect local status for reasons. `--once` keeps its existing exit-1 contract for any undrained pending/stopped/conflict queue, including intentional holds; that does not increment failure counters or turn an intentional hold into a Failed progress report.

## Durable live controls

```bash
chronicle-collector --pause               # Collection paused. Queued uploads are kept; --resume continues.
chronicle-collector --resume              # Collection resumed.
chronicle-collector --exclude .           # invoking shell's cwd, recursively: Excluded /absolute/project.
chronicle-collector --exclusions          # durable list, one path per line, or: No excluded directories.
chronicle-collector --unexclude /absolute/project   # No longer excluded: /absolute/project.
chronicle-collector --status              # controls + historical scan + held count
```

These operations share the configured private spool; they survive CLI/daemon restarts
and do not require restarting a running daemon. Control mutations and status bypass
the daemon lock; retry/drop still require it. Concurrent mutations use SQLite
transactions, not a read/overwrite file. Disabled configuration rejects mutations
with `collector-disabled`; existing disabled once/status behavior is unchanged.
Each control command answers with one sentence naming the stored, normalised
path; `--json` prints the control state `{"paused":…,"exclusions":[…]}` instead.
`--unexclude` answers `Still excluded: PATH is under OTHER.` when a remaining
exclusion above the path, or above what it links to, still covers it.

Pause is an admission hold, not process termination or a liveness assertion. A
paused cycle does not read credentials, discover/read transcripts, query git or
send network reports/uploads, and preserves the historical saved report and queue.
Controls are checked at cycle start, after awaited reporting before further reads
or git work, after awaited git work, and immediately before every upload (after
its awaited progress report). An already-started scan/read/git operation or upload
can finish; an upload can already have committed remotely. Resume does not start a
stopped daemon, bypass backoff or retry stopped/conflict requests. Existing `--once`
exit-1 behavior for an undrained queue remains.

A dynamic exclusion recursively matches **source paths and every producer-recorded
cwd** from the same pre-redaction snapshot, not just its final displayed workdir.
It does not match prose references, tool command strings, original launch profiles
or arbitrary files linked from a transcript. Relative operator paths are resolved
against the invoking CLI cwd. Lexical paths and existing symlink aliases (including
an existing ancestor of a deleted path) are retained; `--unexclude` can remove a
nonexistent original path. Removing a deleted alias removes that owned entry,
not an independently added canonical-path exclusion. Removing an existing canonical
path can select all entries observing that alias. Removing an ancestor entry does
not remove separately added descendant entries. Source-side symlink rejection is unchanged. Path aliases
are observations, not stable inode/mount identities: later symlink retargets,
hardlinks, bind mounts or copies can move data outside an exclusion. Re-add an
entry after changing its alias mapping.

New requests atomically save a private local `pending-evidence` sidecar bound to
request ID, payload digest and source key. It retains original absolute paths/cwds
separately from redacted payloads and source identity, aggregating equivalent
copies of a source observed in that scan. This is intentionally sensitive local
admission evidence (state directory 0700/database 0600), never sent to the server
or exposed in status/diagnostics/progress. Status lists operator exclusions only.
Queue, origin and evidence status reads share one SQLite read snapshot, so a
concurrent daemon ACK cannot remove a row between those reads.
ACK/drop removes evidence; retry/failure preserves it. Missing legacy evidence is
not reconstructed from redacted payloads or upgraded by rescanning. Relative
recorded cwd or unavailable canonical alias resolution marks evidence uncertain;
it does not quarantine otherwise valid unrestricted collection. Unknown/uncertain
evidence is conservatively held whenever any dynamic exclusion is active, and
becomes eligible after all are removed. Malformed/mismatched present evidence or
controls fail closed, never silently falling back to unrestricted admission.

Controls preserve exact queued bytes/IDs, attempts, schedules, heads, tombstones
and existing server archives. They never drop requests or enter `policyDigest`.
Configuration exclusions/profile restrictions remain an immutable lower bound;
`--unexclude` cannot relax them. **Existing configuration/privacy/destination
changes can still destructively invalidate pending requests under the existing
policy** (once resumed); dynamic controls do not exempt them. There is no remote
archive deletion, historical content erasure, new remote pause protocol or daemon
health signal. Local JSON status adds `controls` and `heldRequests`; saved scan
counters remain historical, while held IDs are recomputed from current controls.

## Fidelity, privacy and metadata

JSONL order, permitted unknown fields, original Pi branches/compaction records and tree parents are retained. Unredacted lines retain their exact UTF-8 bytes (including spacing/CRLF). A redacted line is reserialized as JSON, flagged by `redacted=true`. Normalized messages retain record indexes, role, text, tool-call arguments/output, original IDs/parents and available timestamps. Unicode is not reduced to ASCII. Pi user/assistant/system/custom/bash/branch/compaction messages are handled; all original branches survive. Claude tool_use/tool_result and summaries are searchable. Codex response items are preferred to exact mirrored event text; legacy events and current paginated `item_completed` user/assistant/reasoning/command/MCP/dynamic-tool/plan/hook items are normalized. Unknown records remain in raw archives, not invented text.

Privacy is applied before payload creation, durable spooling and uploads:

- Root/profile/session exclusions are literal identities (excluding a Pi root session also excludes its subordinate transcript directory); project/path exclusions are literal path prefixes with path-component boundaries. Producer workdir/session metadata is checked before redaction can obscure an exclusion.
- Configured field names match recursively, case-insensitively; configured text patterns are nonempty literal substrings, not regular expressions. JSON encoded inside strings is also inspected for these field rules.
- Built-in credential fields (`authorization`, `apiKey`/`api_key`, `access_token`, `refresh_token`, `password`, `secret`, `credential`) are removed.
- `redactions.secretFiles` supplies **known credential literals from runtime files**, plus the collector's own Ingest bearer file automatically. Each cycle resolves these files before discovery or ingestion, and again immediately before every upload: if the resolved policy changed meanwhile (a secret rotated while an earlier upload awaited its response), the queued uploads of the old policy are discarded unsent and their sources collected again at the next scan; if it cannot be resolved, the cycle sends nothing more and keeps the queue. Literal values and JSON-escaped variants use the existing literal replacement policy in both raw records and normalized messages; no regex interpolation. Keep credential values out of Nix `textPatterns`, configuration, argv and logs.
- String `data` fields, base64/bytes/blob/file_data, encrypted content/arguments, opaque signature fields, image-generation results, data-URI base64 payloads and contiguous opaque base64-like runs of at least 256 characters are replaced. This intentionally conservative policy can redact nonbinary long identifiers and ordinary string `data`; object-valued extension `data` and unknown nonbinary fields remain. Attachments/referenced files are never dereferenced.
- Git remote credentials, query parameters and fragments are stripped. Diagnostics contain only stable codes/root identifiers and hashed paths, never record excerpts, tokens, URLs or exception strings.

Built-in field rules **cannot detect unknown secrets printed as ordinary tool stdout**. Configure relevant runtime credential files and verify redacted payloads before enabling collection. This is not a universal secret detector: historical/rotated values require retained private literal files if they must still be removed. A configured file represents one UTF-8 literal; only a single terminal LF/CRLF is removed (the transport bearer additionally trims surrounding whitespace). Files must be nonempty, private (no group/world permissions), regular, at most 8192 bytes and resolve outside `/nix/store/`. Runtime age symlinks are supported. Missing/unreadable/invalid UTF-8/empty/oversized files fail closed with `privacy-secret-unavailable`: no discovery or ingestion, including already pending entries. Disabled runs and `--status` do not read credentials.

The exported `resolveRuntimePrivacy(config, secretReader)` in `src/runtime-privacy.ts` returns `{policy,identity}` and is the common runtime/preflight boundary. Pass `new FileSecretReader()` for real files and the returned `.policy` to `parseTranscript`; never log the policy's closure or secret contents. Resolved-pattern identity enters the durable privacy-policy digest. Changing any resolved secret (including the Ingest bearer), or upgrading from a policy without this identity, discards older pending payloads, which are never sent afterwards; their sources are read again and queued under the new policy (see [Durability and operations](#durability-and-operations)). It does not rewrite or retry the discarded payloads. A failed resolution leaves pending bytes untouched but will not upload them; restoring the identical policy permits normal retry. Rotating a credential is not automatic historical archive cleanup.

Authoritative producer-recorded metadata takes precedence. Project is the producer workdir path, not an inferred project name. Missing metadata stays absent. If a remote is missing and a workdir is available, the injected git port runs only `git config --local --no-includes --get remote.origin.url`, with no shell/network, a minimal environment, a 1-second timeout and 64KiB stdout bound. Results are cached per workdir per scan and pass the same redaction policy. This is a **collector observation of the current checkout**, not historical session metadata: its tag is `collector-observed-current-git-remote`. No current branch/commit is substituted for missing historical values. Gone/non-git workdirs leave the remote absent; diagnostic codes are informational, not session quarantine.

Pi subagent metadata is classified only by the canonical path-derived subagent ID, not a `parentSession` reference or a task-looking message. Future Pi snapshots from that source get the stable `subagent` tag, alongside any existing git-observation tag. An explicit `session_info.name` still wins. Otherwise one exact leading `[subagent <matching-agent> task <run>]` line is skipped only for deriving the fallback title; leading blank task formatting is ignored and an empty task body uses `pi session`. Fallback previews retain their 160 UTF-16-unit bound without splitting Unicode scalar values. Original permitted JSONL, normalized messages, records and source identity keep the harness header unchanged.

This is a future-snapshot projection, not an archive backfill: unchanged acknowledged raw digests do not resend, and already-spooled requests retain their original exact metadata/payload/request ID. Changing metadata under an existing ID violates receipt binding; changing the privacy-policy digest to force a refresh discards pending payloads. Existing title/tag repair needs a separately authorized metadata-revision or migration workflow, not a spool reset or re-ingestion campaign.

**Unicode normalization (version 2).** A producer can cut a surrogate pair: the raw line then holds a JSON escape such as `\ud83e` — valid UTF-8 and valid JSON — that decodes to a lone UTF-16 code unit, which the server refuses in derived strings (`invalid`, "unpaired Unicode surrogate"; CONTRACT.md). Both protocols therefore replace every unpaired surrogate with U+FFFD in the normalized, redacted message text and in the readable metadata (title, project, workdir, git remote/branch/commit, model), in one function (`src/unicode.ts`). The raw JSONL is never altered — it keeps the escape — so the raw digest stays the file's. `--status` lists each source whose latest upload had replacements, with its revision and the number of code units (`unicodeRepairs` in `--status --json`). Identifiers are never rewritten: a lone surrogate in a session or subagent id, a message id, a parent id or a role refuses the file locally with `invalid-identifier-unicode`, reported once (one diagnostic, one failed progress report) and listed by `--status` until the file or the privacy policy changes. Message chain v1 (see [Part uploads](#part-uploads)) covers the normalized text, so this normalization is versioned: a later change needs a new version, or every affected append becomes a replacement.

No format supplies authoritative whole-session completion here. End-of-turn/task_complete, archived location, process absence and assistant stop reasons do **not** prove session closure. Every upload is `Quiescent`, with `endedAt=null`. The quiet window starts when the collector first observes a stat (device, inode, size, mtime and ctime in nanoseconds) that it then sees unchanged, and nothing is read before it has lasted `quietMs`: a session being written is not read at all. Any write changes ctime, so resumed, truncated, rotated or same-size/same-mtime rewritten sources are reconciled again. A partial final line is never imported as a complete snapshot; it waits and becomes visible `partial-line-expired` quarantine only after the configured unchanged interval. JSON syntax/UTF-8/identity/version/size failures have distinct safe diagnostics. Quarantine stores diagnostics, not a second copy of rejected contents.

The frozen v1 server stores `Quiescent` but has no field for the measured observation duration or absolute canonical source path. Observation checkpoints stay in the local spool; server revision creation time is not proof of the source's quiet duration. Codex `history_base`/Pi `parentSession` references are preserved but **never followed**; a paginated history prefix residing in a different source file is not materialized into this snapshot.

## Re-reading, scan budget and size limits

A file is not read again while its identity and stat (device, inode, size, and mtime and ctime in nanoseconds) equal those recorded at its last read and the content of that read is still settled: it is the source's acknowledged head (same digest and revision) or the content of the source's queued pending, stopped or conflicting upload, under the same privacy/destination policy digest and the same dynamic exclusions. Such a file counts as `unchanged` (`waiting` while its upload is queued), consumes no scan budget and leaves its quiet-period observation alone. A changed file is not read either while its source has a part upload that cannot be sent in this cycle — the probe gave no limits (`server-upload-unsupported` or a failed probe), or the upload is backing off; both end by themselves — and it is still the file of that read, grown (same device and inode, not shorter): it counts as `waiting`, and when the upload is sent the changed file aborts it (`source-changed`) and the next scan plans it again from the current file. A replaced or shortened file is read as usual, so another session written to its path is identified and uploaded; an in-place rewrite that does not shorten the file (or a new file that reuses the inode) is identified when the pause or the backoff ends. A stopped or conflicting upload waits for the operator (`--retry`, `--drop`), so its changed file is read every cycle as before. A paused collector therefore reads only files without a queued upload, and replaced or shortened ones. Any difference reads the file as before: a changed stat field, policy digest or dynamic exclusion list, a moved head digest or revision, a tombstone, a missing record. Records are spool rows of their own (`source-read`), written only after a complete read whose content was unchanged against the head, was enqueued, or equals the source's queued upload; a completed scan removes the records of files it did not discover. File times advance in coarse ticks (the kernel's timer tick, a few milliseconds; whole seconds on some filesystems, 2 s on FAT), so a rewrite in place within the tick of the last change can keep size, mtime and ctime. A read is therefore **racy** when its stat was taken less than 3 s (`RACY_STAT_WINDOW_MS`) after the file's ctime, or the ctime is in the future (git's racy-clean rule on ctime; mtime can be set freely and adds nothing). A racy record — `source-read`, `identifier-refusal`, or `record-over-limit` from a scan or from the server's refusal of a record — does not vouch for the content for good: it stands until 3 s of **monotonic** time (which no wall-clock step moves) have passed since its read, then the file is read once more. A rewrite that keeps the stat happens within one tick of the change that set it, so that read, finding the same stat, confirms the content whatever the ctime says (a ctime in the future, a clock set back or forward); a record of the same stat without a mark vouches for it, and a newer read or refusal keeps an existing mark rather than renewing it: one extra read per racy stat. After a restart, marks of the earlier process wait 3 s of the new process's monotonic time. The wall clock is only compared with ctime. With a `quietMs` of at least the window (the default 60 s) a file is read only long after its last change and no read is racy, unless its ctime is in the future. Records of earlier releases carry no racy mark.

The quiet period is decided by stat as well, **before** anything is read: every cycle a changed file's stat is compared with the one observed before, and the file is read only when its stat has stayed the same for `quietMs` (`waiting` until then, no bytes read, no scan budget spent). A file that changes between that stat and the read starts its quiet period again. A rewrite in place that keeps the stat (see above) does not restart it: its quiet period starts at most one tick early, and the racy rule reads it again; an append always changes the size. A spool of an earlier release, whose observations were signed with the content digest, makes each changed file wait one quiet period once.

`maxScanBytes` bounds the bytes read in one scan. A file that does not fit what is left of it is **deferred**, not quarantined: it counts as `deferred` (`Deferred by scan budget` in `--status`, per root too) and the scan continues with the files that still fit. Deferred files are read first in the following scans, oldest deferral first, so files that keep changing cannot starve them; because `maxFileBytes` ≤ `maxScanBytes`, a file within `maxFileBytes` always fits an unspent budget. Deferral is not a failed collection (the progress phase stays `Idle`; the frozen progress protocol has no deferred counter), but `--once` exits 1 when files were deferred, as for other leftovers.

A session that cannot be uploaded as it is gets its own code. `--status` names the root and hashed path (the source key for a queued upload) with the measured size or count and the limit; in `--status --json` a diagnostic carries them as `measured` and `limit`, a queued upload its `payloadBytes`:

| Code | Meaning |
| --- | --- |
| `snapshot-too-large` | the file is larger than `maxFileBytes`; it is not read |
| `message-limit` | the transcript has more normalized messages than `maxMessages` |
| `payload-too-large` | the encoded request is larger than `maxPayloadBytes`; nothing is queued |
| `server-payload-too-large` | the server refused the request with HTTP 413; shown as refused by the server as too large, with the payload size. The server's limit is not known to the collector |
| `record-over-limit` | (`parts`) a record is longer than the record limit; see [Part uploads](#part-uploads) |
| `admission-evidence-limit` | (`parts`) the file's `cwd` values exceed the admission-evidence bound: more than 1,024 distinct paths, more than 1 MiB counting each value and its aliases, or one path over 4,096 bytes; nothing is sent |
| `invalid-identifier-unicode` | an identifier holds an unpaired UTF-16 surrogate (see [Fidelity](#fidelity-privacy-and-metadata)) |
| `upload-too-large` | (`parts`) the server refused the declared raw bytes or messages (HTTP 413 `too-large` at open); shown with the size and the server's limit. A 413 without that code is retried as `http-413` |
| `upload-content-mismatch` | (`parts`) a replacement's content differed from its declaration at commit (a collector bug or a file that keeps changing); stopped |
| `source-prefix-changed` | (`parts`) not a failure: the file no longer begins with the bytes of its acknowledged head (an in-place edit, a rewrite); pass 1 read the whole file and the change is uploaded as a replacement. Shown in the scan that found it |

The first three are quarantine diagnostics, recomputed every scan; a file over `maxMessages` or `maxPayloadBytes` is therefore read again every scan. A `server-payload-too-large` upload is stopped after one attempt, is not retried automatically and blocks its source until `--retry` or `--drop`, like other stopped uploads. Other 4xx responses remain `protocol-rejected`. `record-over-limit`, `admission-evidence-limit` and `invalid-identifier-unicode` are not recomputed every scan where noted: see their sections.

## Part uploads

With `uploadProtocol: "parts"` (the default) a changed session is uploaded through the part-upload API of `chronicle.api` 1.9.0 (append-only ingest spec §4–§6): open with the complete declaration of the revision, parts of whole records, commit. An append sends only the records after the acknowledged head.

- **Pass 1, preflight**, before anything is sent. The file is read to its size at open with a 1 MiB buffer and a capped line reader: a record longer than the record limit stops the pass before it is parsed. Per record it runs everything a whole read does — admission evidence and exclusions on the unredacted record, redaction, Claude identity consistency, metadata, normalization, the Unicode normalization — and computes the SHA-256 of the redacted raw, message chain v1 (spec §5, golden vectors in `chronicle/tests/message-chain-v1.json`), counts and, at the head's record count, the same values for the prefix and its file offset. Codex files are read twice: first the multiset of response-item messages (32-byte digests) for the file-wide event duplicate rule. Outcomes and their order equal a whole read's; exclusion and identity failures send nothing. Admission evidence is capped while reading (`admission-evidence-limit`). Memory: the buffer, one record, at most 1 MiB of evidence and the Codex multiset (≤ `maxMessages` × ≈ 80 bytes).
- **Incremental pass 1** (ingest-limits spec §2). Pass 1 ends with its state at the end of the file — file offset and the SHA-256 of the bytes before it, device and inode, record and message counts, the redacted raw's byte count and resumable SHA-256 state, the message chain, the identity and metadata state (the first user message only as the title it yields), the exclusion flags and the distinct `cwd` values. That state is stored with the upload that declares it and becomes the file's **append checkpoint** when the upload is acknowledged, so it always describes the committed head. When the file grew past the checkpoint, its source's head is still the checkpoint's revision and digest with nothing queued, and device, inode, privacy/destination policy and limits (both record limits, `maxMessages`, normalization version, format) are unchanged, pass 1 hashes the bytes before the checkpoint natively (≈ 1 s per GB), compares the digest with the checkpoint's and then parses **only the addition** with the code above, seeded from the checkpoint; evidence aliases are resolved again. The prefix hash leaves no residual window: an in-place edit of an old line, of any length, is found at the next upload. Any check that fails — no or another checkpoint version, the head moved (another writer, a downgraded collector, `whole`), a queued upload, a changed policy or limit, a new inode, a file that did not grow, a prefix that hashes differently (`source-prefix-changed`) — takes the full pass, which then appends when the head's prefix is intact and replaces otherwise. Cost of an append: the prefix hash plus both passes over the addition; a full pass costs ≈ 3–7 % more than in earlier releases (the resumable hash). **Codex files always take the full pass** (`codex-full-pass`) and keep no checkpoint: an event message is dropped when a response item anywhere in the file duplicates it, so an addition can change earlier messages; a Codex append still reads and parses the whole file in both passes, as in earlier releases (a remaining Codex-only limit). `--status` shows the latest pass per file (`Pass 1, latest per file: … incremental · … full (reasons)`); `--status --json` lists it under `sources`, each with `sourceKey`, `rootId`, `pathId` and `lastPass` `{kind: "incremental"|"full", reason, parsedBytes, hashedBytes, at}` (`reason` null for an incremental pass; byte counts decimal; `hashedBytes` is what the prefix check read).
- **Append or replacement.** The head written at the last acknowledgement (in `whole` mode too) records raw bytes, records, messages and chain. When the file still begins with exactly that prefix, the upload declares it as its base and sends the records after it; otherwise (no recorded base, a Pi v2→v3 rewrite, a Codex duplicate that changes earlier messages, a redaction change, a rewritten history) it is a **replacement**: the whole file in parts, a new server epoch. A `base-mismatch` at open or a `content-mismatch` at commit re-plans an append as a replacement under a new request ID. `replacements` counts them.
- **Pass 2, upload.** Parts are regenerated from the file (the spool holds no content): records are packed greedily up to the server's `maxPartBytes`, measured on the encoded part; a record whose part alone is larger travels alone in a large part (up to `maxLargePartBytes`, Content-Length announced, a longer timeout covering the server's 30 s admission wait). Each acknowledged part is recorded before the next is sent. The file's stat must stay equal to pass 1's until the commit; a changed file aborts the attempt and is planned again at the next scan. Live controls, admission and the privacy policy are re-checked before every open (also the one that replaces an expired attempt), each part and the commit.
- **Recovery.** The entry, with its declaration (the `UploadOpen` JSON), is spooled before the open is sent. After a restart, timeout or 5xx the outcome is recovered first without the file: the status of the attempt, or, when the server no longer knows it or it ended, the open replayed with the stored declaration — a committed intent answers with its receipt, so a lost commit acknowledgement is recovered even when the file changed since. Only then are the parts regenerated: the part before the first missing one must hash to the server's `lastPartSha256`, and sending continues from there. An expired attempt is replaced by a new one for the same intent, which receives every part again; `upload-busy` backs off. An intent is given up (file changed, regeneration differs, policy changed) only through an abort of its live attempt: an abort answering `Committed` — the delayed commit won — is acknowledged instead, and an abort that cannot be confirmed keeps the entry for the next cycle.
- **Record limit.** The limit is the smaller of `maxRecordBytes` and the server's `maxRecordBytes`. A longer record puts the file in the state `record-over-limit`: no attempt, no retry, no request for it; one diagnostic and one failed progress report when it is entered, and `--status` shows until it clears: `pi session <pathId>: record <index> is <N> bytes, above the record limit of <M> bytes (collector maxRecordBytes). This session is not uploaded. Raise maxRecordBytes on the collector and on the server (both, at most 134,217,728) and it is uploaded at the next scan.` It clears when the file's stat or either limit changes. The server refuses a record over its own cap with HTTP 413 and the `Failure` code `record-too-large`: for a part of one record that is the same state with the server's limit; for a part of several the upload is planned again and the next scan applies the server's refreshed limit. Any other 413 on a part (a proxy, another body limit) is an ordinary failure, retried with back-off and shown as `http-413`.
- **Probe.** Every cycle starts with `GET /api/ingest/uploads`, which answers the server's current limits. A server without the part-upload API answers 404 without a `Failure` body: then no part upload is attempted, entries keep their status and attempts, changed files of their sources are not read, and the first line of `--status` and a line in the journal (see Output and exit status) read `Uploads are paused: the Chronicle server at <endpoint> has no part-upload API (it predates S2). Nothing is lost — changed sessions are uploaded once this is fixed. Fix: upgrade the server, or set uploadProtocol = "whole" in the collector configuration (Home Manager chronicle.collector.uploadProtocol) to upload through /api/ingest.` There is no automatic fallback; the next cycle probes again. Queued whole payloads of earlier releases still drain through `/api/ingest` first: no part upload is planned for their source until they are acknowledged or dropped.
- **Status and spool.** `--status` shows the upload protocol and the probe, then each part upload (`append` or `replacement`, new and total raw bytes, parts acknowledged, attempts, error; `uploads` in `--status --json`), the records over the limit (`recordsOverLimit`) and the counter `Replacements`. Additions live in new spool buckets (`upload` with index `source-upload`, `record-over-limit`, `identifier-refusal`, `unicode-repair`, `upload-server`; for incremental passes `upload-checkpoint`, `append-checkpoint` and `last-pass`) and in optional fields of `head`, `pending` and `upload` rows, so a spool of an earlier release opens unchanged — without checkpoints, each file takes one full pass and is incremental from its next acknowledged upload on — and a downgraded collector ignores them (its heads lose the base fields: the next part upload is a replacement; any upload it commits moves the head, so the next run of this release takes the full pass once). Checkpoints and pass records of files no scan discovers any more are removed with their `source-read` records. `whole` ignores part-upload entries, as a downgraded collector does.

**Deployment note.** Deploy the server with the part-upload API before collectors with `uploadProtocol = "parts"`. A collector activated in front of an older server pauses uploads, with the line above, and loses nothing; set `uploadProtocol = "whole"` (Home Manager `chronicle.collector.uploadProtocol`) to keep uploading through `/api/ingest` until the server is upgraded. Rolling the collector back: set `whole` or install the previous collector; the server expires live attempts.

**Unpaired surrogates on S0/S1 deployments.** Collectors before the Unicode normalization (all S0- and S1-only deployments) still send a lone surrogate unchanged and the server refuses the whole revision: 1 of 5,284 files on the owner's host (request `22ab74a1-b7c9-46fc-8464-b9727dec9107`, `stopped` with `protocol-rejected`). With this release installed, rebuild that request from its file (the daemon must be stopped):

```bash
systemctl --user stop chronicle-collector
chronicle-collector --retry 22ab74a1-b7c9-46fc-8464-b9727dec9107
systemctl --user start chronicle-collector
```

The rebuilt revision is uploaded by the next scan — through `/api/ingest` with `uploadProtocol = "whole"`, or as a part upload once the server has the part-upload API. Do not `--drop` it: that tombstones the source.

## Durability and operations

The private state directory is mode 0700, SQLite databases mode 0600. SQLite FULL synchronous transactions persist namespace, observations, source heads, exact pending encoded payload/digest, expected revision, request UUID and retry state before uploading. A separate SQLite exclusive daemon lock is automatically released on process death; there are no stale PID files. `--status` is read-only with respect to collection and does not need the daemon lock.

SIGTERM and SIGINT use normal OS termination without waiting for an active scan, progress report or upload. Durable pending work and the daemon lock recover on restart; an upload interrupted before its local ACK is retried with the same request ID and bytes, even if the server already committed it. Shutdown does not increment retry attempts or claim that the cycle completed. No final network report is attempted; saved counters and remote progress may remain incomplete or stale.

Lost acknowledgements retry the **same bytes and request ID**, including after restart. Only a valid matching generated receipt with exactly the expected next revision advances the local head. CAS conflicts stay visible and never silently adjust expected revision. Retryable network/408/429/5xx failures use capped exponential full jitter and finite attempts. Auth/protocol/invalid-receipt failures and HTTP 413 (`server-payload-too-large`) stop immediately; redirects are never followed. Uploads have a total request/body-read timeout and bounded acknowledgement size.

```bash
node dist/collector/src/cli.js --config /absolute/collector.json --retry REQUEST_UUID
node dist/collector/src/cli.js --config /absolute/collector.json --drop REQUEST_UUID
```

Both print the resulting status, as `--status` does: text by default, the snapshot with `--json`. Both take the daemon lock, so stop the daemon first; otherwise they fail with `collector-already-running`. Retry resets the finite attempt budget but retains the payload, request ID and expected revision. It does not resolve an actual CAS conflict. One exception: a queued whole payload built by a release before the Unicode normalization (version 2) that holds an unpaired surrogate — the server refuses it every time and never committed it — is removed instead (reason `retry-rebuild`, the source **not** tombstoned), and the next scan rebuilds it from the file; `--retry` then prints `Rebuilding <id> from its file at the next scan: …` before the status. A `parts` upload entry keeps no payload: `--retry` resets its attempts, and the next cycle recovers its server state and regenerates its parts. Drop deletes local pending bytes and creates a persistent **local source tombstone**, preventing automatic requeue; it does not delete the server's archive. A changed privacy/discovery/destination policy discards all older pending payloads, which are never sent afterwards, but does not tombstone their sources: the scan of the same cycle reads them again under the new policy and queues new requests from their acknowledged heads. If a discarded upload had already committed despite a lost acknowledgement, the new request conflicts and stays visible as a conflict until `--drop`. Status lists every dropped or discarded request with its reason (`operator-drop`, `privacy-or-destination-changed`). There is no automatic tombstone removal, remote purge, stale-head merge or receipt reconstruction after discarding bytes; resolve those cases explicitly with the server operator rather than editing a CAS expectation blindly. `secure_delete` is enabled, but this is not a forensic-erasure guarantee for filesystem backups or old storage blocks.

Earlier releases also tombstoned the sources of the payloads a policy change discarded. `--clear-policy-tombstones` lists those tombstones without changing anything; with `--apply` it clears them, and the next scan reads, redacts and uploads those sources under the current policy, from their last acknowledged revision:

```bash
chronicle-collector --clear-policy-tombstones          # dry run: what --apply would clear
chronicle-collector --clear-policy-tombstones --apply  # clear them
```

The spool records the reason with each dropped request, not with the tombstone. A tombstone is cleared only when every drop recorded for its source has the reason `privacy-or-destination-changed`; a tombstone of `--drop` (`operator-drop`), of mixed reasons, or without any recorded drop is never cleared. The answer counts those under `Other tombstones, not cleared` and names the source keys without a recorded drop, whose reason is unknown. Exclusions, controls, queued uploads and the dropped-request history are not touched. `--apply` lifts the tombstones in one SQLite transaction, keeping each acknowledged revision and digest; a second `--apply` clears nothing and says so. As after a policy change, a source whose discarded upload had in fact committed gets a conflict, visible until `--drop`.

The spool stores no path for a tombstoned source, only its source key. The dry run therefore reads the discovered files as a scan does (with the runtime credentials, ignoring `maxScanBytes`) to find each source's files, and lists the source key, the last acknowledged revision (or `never acknowledged`) and the path and size of each file; it counts the files it cannot identify (over `maxFileBytes`, unreadable, or with an incomplete last line). The dry run opens the spool read-only: it creates, initialises and chmods nothing, and without an initialised spool answers `No collector state yet: nothing to clear.` (`{"initialized":false}` with `--json`). `--apply` reads no files. Like the controls, the command does not take the daemon lock and is safe while the daemon runs: the daemon reads source heads at every scan, so it collects cleared sources at its next scan without a restart. `--json` prints `{applied, policyChanged:[{sourceKey,revision,acknowledged,files}], unidentifiedFiles, otherReasons:[{sourceKey,reasons}], unattributed:[…]}`, where `files` (`[{path,bytes}]`) and `unidentifiedFiles` appear only in the dry run.

`--once` reconciles and attempts due queue entries, emits JSON counters, and exits nonzero for upload/quarantine/deferred/pending/stopped/conflict or progress-reporting failures. Waiting for first observed quiet evidence is not an error. Daemon mode prints the same counters each cycle. `--status` defaults to a human-readable summary of the saved scan, byte totals, per-root coverage, queue, diagnostics, dropped requests and reporting acknowledgements. It does not infer that the daemon is running or server indexing is complete. `--status --json` retains the machine-readable `{namespace,queue,diagnostics,dropped,lastRun,reporting}` snapshot, with `uploadProtocol`, `server` (endpoint and latest probe), `uploads`, `recordsOverLimit`, `identifierRefusals`, `unicodeRepairs` and `sources` (the latest pass 1 per file, see [Part uploads](#part-uploads)) added; `lastRun` includes its scan-start timestamp, counters and hashed per-root coverage, queue entries their encoded `payloadBytes`, and limit diagnostics their `measured` value and `limit`. Scans saved before this release have no `deferred` counts. Counters describe the last local scan, not a claim that every possible session was discovered or server annotation finished. Missing native roots are informational. Diagnostic status and pending/stopped queues survive restart. Successful raw ingestion does not mean annotation/search publication completed.

## Collection progress (protocol 1.2)

Every enabled CLI cycle reports `Discovering`, `Scanning`, `Uploading`, then `Idle` or `Failed` to `POST /api/collector/progress`. The collector ID is the persisted spool namespace. Each cycle has a new run UUID and start time; SQLite transactionally allocates a durable, monotonically increasing sequence **before** sending. Gaps after crashes/lost acknowledgements are valid. Do not delete/reset the spool to retry reporting: that creates a new identity and loses ingestion durability. Servers bound identities per owner (100), so obsolete collector identities require explicit operator handling.

Snapshots contain counters, no transcript excerpts or source paths. For part uploads `totalUploadBytes` is the new raw bytes of the due uploads, `uploadedBytes` the raw bytes of acknowledged parts, and a cycle against a server without the part-upload API ends `Failed` with error `server-upload-unsupported`; the progress wire is unchanged. `scannedBytes` measures raw bytes read. `totalUploadBytes` is the encoded UTF-8 payload size of this cycle's due pending upload attempts (including retries from previous cycles). `uploadedBytes` increases only after a valid matching receipt **and successful local spool ACK**. A lost ACK never counts as committed locally; a retry may subsequently be acknowledged idempotently. Consequently `uploaded` can exceed `enqueued` when old pending entries succeed. `currentUploadTotalBytes` is the current payload size, **not bytes sent**. Failed/stopped/conflicting/quarantined and future-pending work remains visible through counters and diagnostics; these bytes are not invented as completed uploads.

Reporting uses the same strict destination/bearer policy, a separate 64 KiB body/ACK bound, and the configured total HTTP timeout. A failed report, rejected (`accepted=false`) sequence, or mismatched ACK never advances local accepted freshness, never changes ingestion retry/CAS state, and emits `report-failed` with a bounded cause class — never response bodies, tokens or paths: `timeout:<ms>`, `connection-reset` (the connection closed before an answer), `connection-refused`, `network:<CODE>`, `http:<status>`, `ack-too-large`, `invalid-ack`, `not-accepted`, `request-too-large`, `token-unavailable` (`cause` of the diagnostic and of `reporting` in `--status --json`; `--status` prints it, e.g. `Error: report-failed · timed out after 15,000 ms`). Every request of the collector — progress reports, part uploads and `/api/ingest` — travels on a connection of its own, closed after the answer (`Connection: close`): with pooled keep-alive connections a server closing an idle connection just as the next request leaves on it drops that request (fetch never resends a POST), which after a long synchronous scan made a cycle whose uploads all succeeded end with `report-failed`. A connection that drops anyway stays an ordinary failure with its cause: a report is sent again in the next cycle's reports, an upload request is recovered and resumed by its entry. `reporting` status persists the allocated/accepted sequences, last accepted local timestamp and latest failure. Accepted reports alone clear that failure; diagnostics retain any failure in the current cycle. A reporting failure makes `--once` fail even when ingestion itself succeeds. The server independently timestamps accepted reports and marks them stale after 120 seconds without an accepted update; local timestamps are not server freshness evidence.

Scanning checkpoints publish at most once per five seconds between files/candidates; upload boundaries publish before and after attempts. There is no synthetic timer heartbeat. During a long synchronous directory walk, snapshot read or parse, the event loop may be blocked and the last server snapshot can become stale. That is intentional, not proof of process failure or successful completion. `Idle` describes the collector between cycles, not session closure or server indexing completion; indexing is tracked separately by the backend.

## Fixture provenance and verification scope

All `test/fixtures/*.jsonl` are manually constructed synthetic examples, not captured production sessions. Their field shapes were checked against:

- Installed Pi `@earendil-works/pi-coding-agent` **1.4.0**, complete `docs/session-format.md`, `sessions.md`, `message-types.md`, `sdk.md`, and exported `dist/core/{session-manager,messages}.d.ts`.
- Public Anthropic Claude Agent SDK Python `src/claude_agent_sdk/_internal/sessions.py`, commit **0e89b298e771259378a6cd3734e00d323dff5703**: `sessionId`, `uuid`, `parentUuid`, nested `subagents/**/agent-*.jsonl`, message/tool contents. Claude Code's implementation itself is closed; this is authoritative SDK reader evidence, not an exhaustive native schema claim.
- Public OpenAI Codex commit **970111f6cb62cc02fe36a82ea7d71b37a2889c97**: `codex-rs/protocol/src/{protocol,models,items,user_input}.rs`, `codex-rs/history/src/rollout_payload.rs`, `codex-rs/rollout/src/policy.rs`. These establish SessionMeta, ResponseItem, legacy EventMsg and paginated PascalCase TurnItem persistence.

Tests cover parser/privacy blackbox behavior; shared memory/real SQLite spool contracts; real temporary filesystem/discovery and git-port contracts; loopback HTTP timeouts/errors/receipts; CLI disabled/status/exit policies and process-kill lock recovery. No real user sessions/authentication stores were inspected. This package's loopback server tests are not proof of compatibility with the actual Scala service; that integrated workflow is a separate repository acceptance gate.
