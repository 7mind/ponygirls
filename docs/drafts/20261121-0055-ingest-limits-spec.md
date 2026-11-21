# Chronicle ingest limits (ingest-c) — implementation spec for L1–L6

Base `66fce48e` (`agent/ingest-b-land`: S0 + S1 + S2 of the append-only ingest; this document sits on `agent/ingest-c`
`482b5757` = base + L4); "ingest-b spec" = `docs/drafts/20261120-1201-append-only-ingest-spec.md` (its §16 wins over its
earlier text). Tags: **[o F:L]** observed in code at the base, **[o Mn]** measured by this unit (§0; evidence in
`.local/overhaul-20261117/reports/ingest-c/SPEC/evidence/`), **[m INV]**/**[m L5]** measured by the INV/SPEC-L5 units
(evidence in their bundles), **[r X]** reported by another unit, **[i]** inferred, **[u]** not verified. Synthetic data
only. Out of scope: S3 (legacy conversion), S4 (retiring `/api/ingest`), any back-fill or re-index of archived sessions
(owner Q122). Added 2026-11-21: §5.6 (the I3 design of unit SPEC-L5E as reviewed; its E1 default was changed afterwards
to exact final metadata, §13.2 E1X), §5.7 (ANN detection as built) and §13 (the implemented behaviour where it differs
from the text, the orchestrator's later decisions, user-visible changes, REL's outcome; §13 wins over the earlier
sections).

## Summary
- **L1 ranged raw read.** New cookie-authenticated HTTP endpoints `GET /api/raw/{session}[/{revision}]` (a JSON manifest:
  files, sizes, SHA-256) and `GET /api/raw/{session}/{revision}/{file}` (the bytes, `Range` supported, streamed from
  PostgreSQL in 4 MiB windows, one short transaction per window). Server memory per download is one window; a ≥ 4 GiB
  revision downloads byte-exact. The CLI gains `raw --output FILE|-` (64 MiB range requests, SHA-256 verified, atomic
  no-clobber rename); the dashboard gains a plain download link (the browser streams to disk; nothing in JS memory).
  `GetRaw` is unchanged. Additive in 1.9.0.
- **L2 collector append cost.** Read nothing while a file is active (quiet by stat) and parse only the addition from a
  spool checkpoint at the committed head. Decision D1: **(A, recommended)** also hash the file's prefix natively per upload
  (0.9 s/GB, ≈ 2 % of today's 40.6 s/GB) — no residual window; **(B)** tail window + rolling verification — proportional,
  bounded residual window (§2.4). +50 MB on 1 GB: 49 s of collector CPU today, ≈ 5 s with (A) [i from M3].
- **L3 archive literal search.** The cost is the per-row witness scanning the whole head epoch (14.9 s at 4.4 GB);
  the page query already holds the matching fragment positions — pass them to the witness (W2): 9–12 ms at every size,
  identical results, no migration (§3). Frequent literals stay O(matching fragments) (D17).
- **L4** (built, integrated): CLI read bounds derived from the server's 64 MiB page bound; server failure text shown (§4).
- **L5 streamed indexing.** Claim without messages, per-window keyset reads, per-window results kept only as today's
  checkpoints, publication replayed from them into a staged generation (migration 026) switched in one short
  transaction; memory per lane independent of the session (the default 8 GiB container suffices); same profile, ids and
  rows → no existing session re-indexed. Time stays O(session): A ≈ 1.8 h, B ≈ 7.7 h (zero-delay stub, 4 writers). Window
  reuse across revisions (I2, migration 027) right after; incremental publication (I3) deferred (§5).
- **L6 WAL.** 69–76 % of the upload WAL is the trigram GIN's pending list written twice; merging it in 32 MiB batches
  cuts replacement WAL by 35 % (−43 % with checkpoint spacing), no migration (§6).
- **Defects:** U8 finding 1 is verified by running B′ direct; harness fixes in ACC; the rest done or accepted (§7).
- **Plan:** ten units + acceptance, landing L4 → L1 → L3 → L6 → L2 → L5 → ACC (§10). **Decisions:** §11 (D1 first).

## 0. Measurements (this unit)
| # | what | method | result |
|---|---|---|---|
| M1 | epoch raw window reads | PostgreSQL 18.7 (`postgresql-and-plugins-18.7` of the service fixture tools), migrations 001–025 + 017 applied with psql; one epoch of 1,048,185,105 B in 1,000 segments of ≈ 1 MiB (whole ≈ 5 KB lines of pseudo-random hex) + one 20,971,545 B one-line segment; relation 1,038 MB (pglz does not compress hex); `shared_buffers` 512 MB | window `[a, a+4 MiB)` (5 segments, each cut in SQL): **11.9 ms cold** (650 buffers read), **1.8 ms warm** as an ordered PK index scan (`enable_sort` off as `RevisionContent.keyOrdered` sets [o RevisionContent.scala:29-32]); with default planner settings and production `work_mem` 4 MB the same query sorts the 4 MiB of slices **on disk** (external merge 4,112 kB, 17.0 ms) → window reads must run key-ordered; 64 MiB windows 69–179 ms; the 20 MiB segment cut into 4 MiB slices: 18–24 ms per slice (each detoasts the segment); the whole epoch streamed in offset order 2.77 s (`COPY`); today's `string_agg` (GetRaw) 0.68 s for 256 MiB, 2.07 s for 1.05 GB in PostgreSQL alone |
| M2 | legacy raw byte range | one 210,560,940 B file in a jsonb snapshot (`pg_column_size` 210,561,044) | any range `substring(convert_to(snapshot->'files'->0->>'content','UTF8') …)`: **0.61–0.66 s** whatever its length (4 MiB or 64 MiB): every read detoasts the snapshot; the size alone (`octet_length`) 1.36 s |
| M3 | collector pass-1 cost by stage | synthetic Pi v3 session, 536,872,770 B, 125,734 lines (≈ 4.3 KB/line), collector `/nix/store/h41a1bb6…-chronicle-collector-0.1.0` (node 24.22.2) modules called in-process, page cache warm, host load 12–16 | per GB: read 0.24 s; read + native SHA-256 **0.90 s**; read + resumable JS SHA-256 (M4) **6.81 s**; `readLines` 0.31 s; + `JSON.parse` 1.19 s; + `recordOf` (redaction) + `messageOf` + chain **38.9 s**; `preflight` as today **40.6 s**; linear (26.8 MB file: 40.6 s/GB). The redaction walk dominates; hashing is ≈ 2 % |
| M4 | resumable SHA-256 in JS | 60-line prototype (`evidence/sha256-resumable.mjs`), state = the server's `raw_state` format (8 × u32 BE, u64 BE length, pending bytes; 40–103 B) [o ingest-b spec §5] | equal to `node:crypto` on 2,000 random inputs (0–4,095 B) with 0–3 export/resume splits each; 148 MB/s (M3) |
| M5 | ANN scan budget and HNSW vacuum (review round 2) | PostgreSQL 18.7 + pgvector, autovacuum off; 300,000 768-d vectors: 200,000 uniform (2,000 sessions) + one session of 100,000 clustered around a centroid; Chronicle's index expression and scan settings (strict iterative, `ef_search` 200, LIMIT 1,000, `max_scan_tuples` 200,000), authorization as a per-tuple `OFFSET 0` subquery; query = centroid + noise (`evidence/round2/`) | cluster visible: 68–98 ms; cluster committed but unpublished: 0.74–0.84 s, 1,000 rows; same with `max_scan_tuples` 50,000: **0 rows**; cluster deleted, before VACUUM: 0.56–0.59 s, 1,000 rows / 50,000: **0 rows**; VACUUM after deleting the cluster 37.8 s, 830 MB WAL (HNSW 586 MB); deleting 100,000 scattered rows: VACUUM still in its HNSW phase after 22 min (stopped) |

## 1. L1 — ranged raw read
### 1.1 Today
`GetRaw` (browser protocol, cookie session, `Read` + `Raw` scope [o Application.scala:35]) computes the raw size first
(epoch: `raw_bytes`; legacy: `octet_length` over `snapshot->'files'`) and answers `too-large` above `maxRawReadBytes`
(default `maxBodyBytes`, at most 512 MiB) [o Database.scala:281-295, Core.scala:86,216]; below it builds the whole raw
(`string_agg` of the epoch segments [o RevisionContent.scala:48]) into one `RawResult` JSON frame. The CLI `raw` sends
`GetRaw` [o cli/src/commands.ts:78] and receives at most 8 MiB per frame [o cli/src/transport.ts:99] (L4 changes that
bound). The dashboard has no raw read or download at all (no `GetRaw`, `Blob`, `download` in `web/src`; grep). MCP has no
raw tool by design [o CONTRACT.md:12]. U8: the 1.05 GB and 4.44 GB revisions answer `too-large` [r U8 ACCEPTANCE A6, B].
**Legacy raw above 256 MiB cannot exist:** a legacy revision's raw is a string inside the jsonb `snapshot`, and a jsonb
container holds at most 268,435,455 B (a top-level string at most 268,435,447 B) [r ingest-b spec V1]; it also came in
one `/api/ingest` body ≤ `maxBodyBytes`, so it is within `GetRaw`'s default bound (`maxRawReadBytes` = `maxBodyBytes`;
268,435,456 deployed, 8 MiB module default [o nix/nixos/chronicle.nix:123]) unless that bound was lowered since. Only
epoch revisions written by S2 parts (up to `maxFileBytes`, 8 GiB deployed) exceed it in practice.

### 1.2 API (additive in `chronicle.api` 1.9.0)
Why HTTP and not a WebSocket operation: a browser download must not be assembled in JS memory, and only an HTTP response
reaches the browser's download manager; JSON text frames cannot carry an arbitrary byte range (a cut UTF-8 sequence; base64
+33 %); WS operations share one socket's queue and heartbeat [o Http.scala:236-400]. The cookie authenticates both.
```
GET /api/raw/{sessionId}                    → 200 RawManifest of the head at the time of the request
GET /api/raw/{sessionId}/{revision}         → 200 RawManifest of that revision (revision ≥ 1)
GET /api/raw/{sessionId}/{revision}/{file}  → 200 / 206 the bytes of file `file` (0-based) of that revision
```
Baboon (`models/chronicle.baboon`, new root type; JSON on HTTP like `UploadState`):
`data RawFileInfo { index: i32 path: str sha256: str bytes: i64 }`,
`root data RawManifest { sessionId: uid revision: i32 files: lst[RawFileInfo] }`. An epoch revision has one file
(`raw_path`, `envelope.digest`, `raw_bytes`); a legacy one 1..`maxFiles` files (`RawFile.path`, `RawFile.sha256` — checked
equal to the content's SHA-256 at ingest [o Core.scala:286] — and the UTF-8 length).
**Bytes response:** `Content-Type: application/octet-stream`, `Content-Length`, `Content-Disposition: attachment;
filename="chronicle-<sessionId>-r<revision>-f<file>.jsonl"` (no client path in a header), `ETag: "sha256:<hex>"` (strong:
a session id and revision never name other bytes — revisions are immutable [o migrations/024:103-117] and a purged
source never takes revisions again [i from Auth purge + tombstone]), `Repr-Digest: sha-256=:<base64>:` (RFC 9530),
`Accept-Ranges: bytes`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`.
**Range:** exactly one range `bytes=a-b`, `bytes=a-` or `bytes=-n` → 206 with `Content-Range: bytes a-b/total`
(`b` clipped to `total−1`); `a ≥ total` → 416 `range-not-satisfiable` (new failure code, explicit status) with
`Content-Range: bytes */total`; several ranges or any other syntax → 400 `invalid`; `If-Range` not equal to the ETag →
the range is ignored, 200 with the whole file (RFC 9110).
**Errors before the body:** the usual `Failure` JSON [o Http.scala:33-37]: 400 `invalid` (query string, revision < 1,
range syntax), 401/403, 404 `not-found` (session, revision or file absent or not visible — indistinguishable as everywhere),
416, 503 `unavailable` with `Retry-After: 5` when all download permits are taken. **After the first byte** a failure (purge,
lost access, database error) stops the response and closes the connection: the client receives fewer bytes than
`Content-Length` and fails; it never receives wrong bytes.

### 1.3 Authentication
Cookie session only, exactly the rules `GetRaw` has today: `Read` and `Raw` scope (a browser session holds every scope
[o Auth.scala:164-165]); no query string (`noUrlSecrets` [o Http.scala:25]); an `Authorization` header is refused
(transports separate [o Http.scala:24]); at most one `Origin`/`Cookie`/`chronicle_session` and the `Host` check of the
account boundary [o Http.scala:38-51]; `Origin` optional but equal to `allowedOrigin` when present (`origin(r,false)`
[o Http.scala:22]) because a same-origin download navigation sends none [i: Fetch spec, GET navigation]. CSRF: the cookie is
`SameSite=Strict` [o Http.scala:32], so a cross-site page cannot make the browser send it; the response is not readable
cross-origin (no CORS headers). Bearer tokens with `Raw` scope are **not** accepted (no new credential path; §11 D3).

### 1.4 Server (`RawStream.scala`, new; route in `Http.scala`)
- **Credential and visibility, in every transaction** (manifest and each window): the cookie's session is still live —
  not logged out, not expired, its user enabled and the same (`Auth.currentBrowser` [o Auth.scala:164-179]) — and the
  source is visible to that user (`authorized` [o Database.scala:199]). Visibility alone would let a download outlive a
  logout (review S1).
- **Manifest** in one REPEATABLE READ transaction: the checks above, head or the named revision,
  `RevisionContent.resolve` [o RevisionContent.scala:33-36], per file path/digest/size (epoch from columns; legacy one
  `jsonb_array_elements(snapshot->'files') WITH ORDINALITY` with `octet_length`, ≈ 1.4 s for a 210 MB snapshot [o M2]).
- **Bytes:** the manifest transaction fixes `(revision, file, size, sha256)` and the served range; then an `fs2` stream
  reads **windows** of `RawStream.windowBytes` = 4 MiB (epoch) / `legacyWindowBytes` = 16 MiB (legacy), each in its own
  short REPEATABLE READ transaction that repeats the credential and visibility checks, the revision's existence, and
  reads only that window;
  the next window is read only when the previous one was written to the socket (fs2 back-pressure). No transaction spans
  a window, so a slow client never holds a connection or runs into the 60 s idle-in-transaction timeout
  [o nix/nixos/chronicle.nix:113]. At the end the bytes sent must equal the range length (else the stream fails).
- **Epoch window** `[a, b)`, `b ≤ raw_bytes`, under `RevisionContent.keyOrdered` [o M1: otherwise a disk sort]:
  `SELECT byte_offset, substring(convert_to(content,'UTF8') FROM (greatest(a-byte_offset,0)+1)::int FOR
  (least(b,byte_offset+octet_length(content))-greatest(a,byte_offset))::int) FROM ch_epoch_raw WHERE epoch=? AND
  byte_offset<b AND byte_offset>=(SELECT byte_offset FROM ch_epoch_raw WHERE epoch=? AND byte_offset<=a ORDER BY
  byte_offset DESC LIMIT 1) ORDER BY byte_offset` — a PK range scan; segments are contiguous whole lines below the
  revision's `raw_bytes` [r ingest-b spec §2 inv. 3], so the slices concatenate to the window. The SQL cut keeps the server's
  share at one window whatever a segment's size (segments are ≤ 1 MiB unless one line is longer [o EpochWriter.scala:30-31];
  lines reach `maxRecordBytes` via parts, `maxBodyBytes` via `/api/ingest`). Cost [o M1]: 1.8 ms warm / 11.9 ms cold
  per 4 MiB window → 0.5–3 s of database time per GB; a segment larger than the window is detoasted once per slice
  (18–24 ms per 4 MiB slice of a 20 MiB line).
- **Legacy window:** `substring(convert_to(f->>'content','UTF8') FROM a+1 FOR len)` of the file's element; every window
  detoasts the whole snapshot [o M2: 0.6 s per window of a 210 MB snapshot] → 16 MiB windows: ≤ 17 windows and ≈ 10 s for
  the largest possible legacy raw (268 MB) [i]. Legacy revisions are within `GetRaw`'s default bound anyway (§1.1).
- **Memory per download:** one window plus its JDBC decode (≤ 3 × window [u: bytea text decoding]) → ≤ 12 MiB epoch,
  ≤ 48 MiB legacy; **admission** `RawStream.maxStreams` = 4 concurrent downloads (a semaphore taken before the
  manifest transaction, released when the response ends or the client disconnects; full → 503 before any byte) → ≤ 192 MiB
  in the worst case, nothing that grows with the session. No `SnapshotAdmission` permit (claims use it [o
  SnapshotAdmission.scala:19]; a download must not wait behind indexing).
- **Head moves / purge:** the URL pins the revision; appends and replacements never change a committed revision's rows
  (UPDATE trigger, DELETE guard below every committed count [o migrations/024:103-139]), so successive window transactions
  read one byte sequence. Purge deletes the revision rows at its commit [o CONTRACT.md:61]: the next window finds no
  revision (or no visibility) → the stream stops (§1.2). Logout, session expiry, account disabling and group-sharing
  removal stop it the same way at the next window.
- **Ingress:** the NixOS module's nginx streams (`proxy_buffering off`, `proxy_read_timeout 90s` between reads [o
  nix/nixos/chronicle.nix:214-215]); Ember writes with back-pressure [u: no write timeout below a slow client's pace].
  The production ingress (paddock) is not readable here [u]: a total-response deadline (the code mentions "the
  gateway's response deadline" [o SnapshotAdmission.scala:16]) would cut long browser downloads — §11 D4.

### 1.5 CLI
`chronicle raw SESSION [--revision N] [--file I] --output PATH|-` (session auth, like `GetRaw`). Without `--output` the
command is unchanged (`GetRaw`, JSON); its `too-large` answer gains the hint `use --output FILE`, and `raw ID` without
`--revision` works again (today refused locally: the wire check rejects the optional revision's `null` [o
cli/src/wire.ts:65; r L4]).
- GET the manifest (pins the revision: `--revision` or the head); `--file` is required when the revision has several
  files (usage error listing them), default 0.
- Sequential range requests of `RAW_RANGE_BYTES` = 64 MiB (each well inside a 60 s gateway deadline at ≥ 2 MB/s); each
  must answer 206 with exactly the requested `Content-Range` and the manifest's ETag, else `protocol-error`. The body is
  written as it arrives (no accumulation; memory ≈ one fetch chunk and the write queue [i]); SHA-256 runs incrementally.
- **To a file:** `PATH` must not exist (`state` error, nothing written). Bytes go to `<dir>/.<name>.<uuid>.partial`
  (O_EXCL, 0600, same directory); at the end size and SHA-256 must equal the manifest (else `protocol-error`, partial
  removed); fsync, then `link(partial, PATH)` (EEXIST → `state`, nothing replaced), unlink the partial, fsync the
  directory. Any failure removes the partial and names the bytes received. No resume (§11 D5).
- **To stdout (`-`):** the same ranges written with back-pressure; the digest is checked after the last byte; a mismatch
  exits 6 after the bytes were written (documented: consumers must check the exit status).
- Result (file mode): `{sessionId, revision, file, path, bytes, sha256}`. `--timeout-ms` bounds each range request, not
  the whole download (the whole-command deadline rule [o cli/README.md:234-236, main.ts:94] gets this documented
  exception; §11 D6).
- **Old server:** the manifest answers 404 without a `Failure` body (no route; Ember `orNotFound` [o Main.scala:58]) →
  exit 6 with "The server at ORIGIN has no raw download API (it predates it): upgrade the server; `chronicle raw` without
  --output still returns revisions up to the server's raw read bound." Nothing is written. No fallback.

### 1.6 Dashboard
The session view's metadata list ("Viewing: source rN" [o web/src/Conversation.tsx:304]) gains "Raw: Download (size)":
the dashboard fetches the manifest of the viewed revision (small JSON, cookie, `connect-src 'self'` [o Http.scala:276])
and renders one `<a href="/api/raw/{id}/{rev}/{i}" download>` per file. The browser streams the response to disk; no
JS code touches the body, so a ≥ 4 GiB file is never in JS memory [i]. Range/ETag let the browser resume an interrupted
download [u: Chromium resumes with `If-Range` when the server sends a strong ETag and `Accept-Ranges`]. No Service Worker
and no File System Access API (only needed if the ingress cannot stream, §11 D4).

### 1.7 Tests (lean; failing first)
Server (`RawStreamTest`, one owned database): (1) windows of an injected odd size (7 B) over an epoch revision with
segments of mixed sizes incl. one longer than the window, and over a two-file legacy revision, concatenate to the `GetRaw`
bytes; 206/`Content-Range`, ETag/`Repr-Digest`, `If-Range` mismatch → 200, `a ≥ total` → 416, two ranges → 400;
production window sizes asserted. (2) Auth: no cookie 401, bearer → 403, query → 400, foreign `Origin` → 403, another
owner → 404. (3) After the first window: an append leaves the bytes unchanged; a purge, and separately a logout of the
downloading session, end the body short of `Content-Length` (the logout case fails against a visibility-only check). (4) Admission with an injected permit count of 1: a second download → 503; a client that disconnects
after one window releases the permit. Codec fixtures for `RawManifest`. CLI: download to a file (no clobber, partial
removed on a digest mismatch from a fake server), to stdout, old-server message. Dashboard: one Chromium case downloads a
small revision through the link and compares its SHA-256. Real-server leg and compatibility: §8.

## 2. L2 — collector append cost
### 2.1 Today
Every cycle (`pollMs` 30 s [o collector/src/config.ts:19]) a changed file is read whole by pass 1 (`preflight` [o
passes.ts:88-157]) **before** the quiet check, because the quiet signature is the file digest it computes [o
collector.ts:278-294]: an active session is re-read every cycle until it is quiet for `quietMs` (60 s). Pass 1 per line:
UTF-8 decode, `JSON.parse`, evidence/exclusions, record cap, `recordOf` (depth check, redaction), `TranscriptState`
(identity, last-wins metadata, title), `messageOf` (Codex dedup, normalization), chain v1, SHA-256 of the file and of the
redacted raw [o passes.ts:100-148]; Codex first runs a whole-file duplicate pass [o passes.ts:53-64]; pass 2 starts at
the base offset except for Codex, which re-reads from 0 [o passes.ts:209]. Cost 40.6 s/GB, 96 % of it redaction +
messages + chain [o M3]; U8: +50 MB on 1.0 GB 75.9 s wall / 49 s collector CPU, +44 MB on 4.4 GB 217 s / 194 s [r U8
finding 3]. The owner's 556 MB session costs ≈ 22 s CPU per 30-s cycle while it is written [i from M3].

### 2.2 Design
1. **Quiet by stat, read once.** The observation signature becomes the stat (`dev:ino:size:mtimeNs:ctimeNs`, `statSource`
   without opening [o discovery.ts:135-142]) and the quiet check runs **before** any read; a file is read only after its
   stat has been unchanged for `quietMs`. Any write changes `ctime` [i: POSIX], so this is at least as sensitive as the
   digest signature. Effect: zero reads while a session is active. Applies to `parts` and `whole`.
2. **Append checkpoint** (spool bucket `append-checkpoint`, key `fileId`), the state of a full or incremental pass 1 at
   the end of the file it read, stored with the upload entry (bucket `upload-checkpoint`, key requestId, written in the
   `planUpload` transaction) and promoted in the `ackUpload` transaction [o spool.ts:366-373] — so it always describes
   the committed head. Fields: `version`, `sourceKey`, `headRevision`, `headDigest`; `policyDigest`; `limitsDigest`
   (collector and server `maxRecordBytes`, `maxMessages`, `MAX_RECORD_INDEX`, normalization version, format); `dev`,
   `ino`; `fileOffset` C; `filePrefixSha256` = SHA-256 of the file bytes `[0,C)` (native, `Hash.copy()`); `recordCount`,
   `rawBytes`, `rawState` (M4 midstate of the redacted raw after `rawBytes` — the format of the server's `raw_state`),
   `messageCount`, `messageChain`, `redacted`; the `TranscriptState` fields [o parsers.ts:146-210] with the first user
   message reduced to the title it yields (fixed once set); the exclusion flags (`excluded`, still-open); the distinct
   `cwd` values (≤ 1,024 values / 1 MiB — the evidence caps [o passes.ts:15]) without their aliases; replaced-surrogate
   count. Codex: bucket `codex-dedup`, key `fileId ‖ keyDigest`, value `{credits, kept}` (below), written as deltas.
3. **Incremental pass 1** when a checkpoint exists for the file, the spool head equals `(headRevision, headDigest)` with
   no queued entry for the source, `dev`/`ino`, `policyDigest`, `limitsDigest` and `version` are equal and `size > C`:
   (a) **prefix verification** (decision §11 D1; (A): hash `[0,C)` natively and compare with `filePrefixSha256`);
   (b) lines `[C,size)` through exactly today's per-line code, seeded from the checkpoint: evidence (stored values with
   freshly resolved `pathAliases`, so a symlink made since is seen as today), exclusion flags, record cap, record index,
   redaction, `TranscriptState`, `messageOf`, chain from `messageChain`, the JS SHA-256 resumed from `rawState` over the
   redacted delta lines, counts; (c) `verifyUnchanged` as today. The result has today's `Preflight` shape with the
   checkpoint as the append base (`appendable` [o collector.ts:50-55] then holds by construction) and the end state as
   the next pending checkpoint. A check that fails, a size `≤ C`, or a mismatch in (a) → the **full pass** (today's
   pass 1 plus the JS midstate, +6.8 s/GB [o M3]); a prefix mismatch is reported once per file as diagnostic
   `source-prefix-changed` and becomes a replacement (as any non-prefix change today).
4. **Codex incremental dedup.** Today an `event_msg` message is dropped if a `response_item` with the same role and text
   exists anywhere in the file (consumed in order) [o parsers.ts:108-130]. Per key k the checkpoint keeps
   `credits_k` (response items not yet consumed) and `kept_k` (prefix `event_msg` messages of key k not dropped). A delta
   adds `r_k` response items and `e_k` event messages: if `kept_k > 0` and `r_k > 0`, an earlier message would now be
   dropped → the prefix's messages change → full pass (replacement, as today); else the first `min(credits_k + r_k, e_k)`
   delta event messages of key k are dropped (a counting pass over the delta, then the consuming pass) and
   `credits_k`/`kept_k` updated. Rows with both 0 are deleted. Pass 2 for a Codex append starts at the base offset with
   this state instead of re-reading from 0. Memory O(delta keys); spool writes O(delta).
5. **Pass 2** is unchanged for Pi/Claude (already from the base offset). It re-reads the delta once more (≈ 40 s/GB of
   delta) — proportional, not removed.
6. **Observability:** `--status --json` per source gains `lastPass: {kind: "incremental"|"full", reason, parsedBytes,
   hashedBytes}` (the acceptance asserts on it; no wire change: the progress report is unchanged).

| check (pass 1) | whole-file today [o passes.ts] | incremental | invalidates the checkpoint |
|---|---|---|---|
| size bounds, scan budget | `checkSize(size)` | unchanged (charged at file size) | — |
| record cap (collector, server) | per line | per delta line | either limit changed |
| record index ≤ 2^31−1, `maxMessages` | per line / at the end | stored counts + delta | `maxMessages` changed |
| UTF-8, partial last line, JSON, depth | per line | per delta line (C ends a line) | — |
| redaction / privacy policy | per line | per delta line | `policyDigest` changed |
| exclusions (config projects/sessions) | per line until an unparsable line | stored flags + delta | `policyDigest` |
| live controls (pause, excluded paths) | evidence vs controls | stored `cwd` values re-resolved + delta values | — (re-checked each cycle) |
| admission evidence caps | per value | stored values count toward the caps | — |
| Claude session/agent identity, Pi header, Codex `session_meta` | `TranscriptState` | stored state + delta | — |
| last-wins metadata, title | `TranscriptState` | stored + delta | — |
| Codex file-wide dedup | whole-file pass | `codex-dedup` rows (item 4) | a kept prefix event matched |
| raw digest, chain, counts | whole file | midstate / chain resumed | — |
| prefix unchanged | implicit (whole read) | (A) native prefix SHA-256; (B) window + rolling | mismatch → full pass |

### 2.3 Cost
(A) per upload: native hash of `[0,C)` 0.9 s/GB (page cache; from disk at its read rate [u]) + 2 × 40 s/GB of the delta
(pass 1 + pass 2) + 6.8 s/GB of the delta (JS hash) [i from M3]: +50 MB on 1 GB ≈ 5 s CPU (today 49 s); +44 MB on
4.4 GB ≈ 8 s (today 194 s); at the 8 GiB deployment bound the prefix hash is ≈ 7.7 s. The end-to-end append time is then
dominated by the server's part writes (A2: 12 parts at p50 2.35 s [r U8]) — L6's subject. (B): replace the prefix hash by
1 MiB + the rolling budget R. Full pass (first upload, replacement, any invalidation): today's cost + 17 %.

### 2.4 Residual window (decision D1)
No user-space reader learns which bytes of a file changed without reading them (POSIX reports no write offsets;
inotify/fanotify report only that a write happened) [i], so "cost proportional to the addition" and "no residual window"
exclude each other: (A) keeps the second at a native hash of the prefix, (B) and (C) the first with a window.
- **(A) prefix hash per upload — no residual window.** An incremental upload is planned only after `[0,C)` hashed equal
  to the digest recorded when those bytes were read; every derived check is a function of the prefix lines, the policy
  and the limits (keyed) or is recomputed (aliases, live controls). What stays trusted is what S0 already trusts: an
  unchanged stat means unchanged content (stat-skip [o collector.ts:222-255]), and the spool's own integrity.
- **(B) window W = min(C, 1 MiB) + rolling budget R per cycle (default 512 MiB).** The checkpoint also stores SHA-256 of
  every 1 MiB block of `[0,C)` (32 B per MiB; 256 KiB at 8 GiB), a rotation cursor, the sequence number `u` of the latest
  incremental upload and `wrapStart` = the value of `u` when the cursor last left block 0. Each cycle verifies the window
  and then up to R bytes of blocks in cursor order, wrapping at C−W, for every file with `lastCompleteWrap < u`, also when
  the file is otherwise unchanged; a wrap that completes sets `lastCompleteWrap = wrapStart`. **Watermark rule (review
  S2):** only a wrap that *started* after the latest incremental upload retires the file, so a block checked before an
  upload is checked again after it — a rotation in progress at an upload never ends the audit. **Undetected:** a change to bytes in `[0, C−W)` of a file whose dev/ino
  stay the same, made while the file grows (size at the next observation > C) and leaving `[C−W, C)` intact — e.g. an
  in-place edit of an old line (an editor that writes in place, a tool that redacts a secret) while the agent appends.
  **For how long:** an edit is followed either by a full pass (size ≤ C) or by an incremental upload u′, after which a
  complete wrap starting after u′ is required: at most 2⌈(C−W)/R⌉ cycles after u′ (the wrap in progress, then one whole
  wrap; 4.4 GB at R = 512 MiB: 18 cycles ≈ 9 min at `pollMs` 30 s; files ≤ R + W: zero, fully verified each cycle). **What the archive holds
  meanwhile:** revisions whose prefix is the bytes as last read (before the edit) plus the appended lines — exactly
  what the file was before the edit, extended; the edited bytes (e.g. a removed secret) stay in the archive's head.
  **On detection:** full pass, replacement upload (a new epoch; older revisions keep the old bytes until purge), diagnostic
  `source-prefix-changed`. Writers' behaviour: Pi, Claude Code and Codex append JSONL records [i: their formats are
  append-only logs; collector fixtures]; Pi's format migration rewrites every line (caught by the window or by a smaller
  size); Historian rewrites its one-message file (size or window); `sed -i`/editors that rename change the inode
  (caught). An edit that does not grow the file (size = C, new mtime) always takes the full pass. **Test (B only):** wrap
  starts after upload 1; the cursor passes block 3; same-length edit of block 3 and an append keeping the window (upload
  2); no further writes; cycles run until no audit work remains → `source-prefix-changed` and a replacement within
  2⌈(C−W)/R⌉ cycles (injected R and block size); fails with a rule that retires the file when any wrap completes.
- **(C) window + periodic full audit (24 h or 25 % growth):** as (B) with "at most 24 h" — not recommended.
Recommendation: **(A)** — "the archive equals the file" stays exact at ≈ 2 % of today's per-GB cost; (B) only if O(file)
I/O per upload must go (e.g. files beyond page cache). (B) can be added later without a spool-format break (new fields).

### 2.5 Spool format and compatibility
New buckets only (`append-checkpoint`, `upload-checkpoint`, `codex-dedup`) in the existing `kv` table [o spool.ts:167];
the `observation` signature string changes format. **Old spool opens:** no checkpoint → full pass → a checkpoint from the
first acknowledged upload; observations of the old format differ once → each changed file waits one quiet period.
**Downgrade:** an older collector ignores the buckets; if it uploads, the head moves and the checkpoint no longer equals
the head → the next new collector run takes the full pass. A checkpoint is deleted with its file's `source-read`
(`saveScan` [o spool.ts:203-211]). No wire change: gate O is unaffected; the new collector against the base server uses
the S2 protocol unchanged.

### 2.6 Tests (lean; failing first)
(1) **Differential:** for a fixture set (Pi; Claude with identity in late records; Codex with event/response interplay;
redacted lines; `cwd` evidence; title rules) the incremental pass over `prefix ‖ delta` gives the same `Preflight` as the
full pass, and pass 1 parses only the delta (an instrumented reader counts parsed bytes) — failing first because the
incremental pass does not exist. (2) A same-length edit at byte 10 plus an append → full pass, replacement, one
`source-prefix-changed` (A). (3) A file whose stat changes every cycle is not read until quiet (reader count 0) — failing
first today (pass 1 runs each cycle). (4) Invalidation: policy change, `maxRecordBytes` change, head moved by another
writer, new inode → full pass. (5) A spool written by the base release opens; first cycle full, second incremental.
(6) Codex: a delta response item matching a kept prefix event → replacement; otherwise an append equal to the full pass.
(7) Resumable SHA-256 = `node:crypto` on random inputs with export/resume.

## 3. L3 — archive literal search time (from unit INV)
Source: `reports/ingest-c/INV/section.md` and `INV/evidence/l3/` (per case `sql-*/measure.json`, summary `l3-summary.md`).
### 3.1 Setup [m INV]
Owned PostgreSQL 18.7 with the repository policy and the fixture's role settings (statement timeout 30 s, `work_mem`
4 MB); native server and collector of the base; 2,800 background sessions (713 MB raw); 250 MB and 1 GB sessions uploaded
through S2 with rare needles at the start, middle and end; a 4.4 GB session generated in SQL from the 1 GB epoch's rows,
shown equivalent (stored fragments reproduced for 3,189 sampled messages, 0 differences; same plan shapes). Statements
from the server log; `EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS)` in the search's own transaction settings.
### 3.2 Mechanism [m INV]
`ArchiveSearch` (CLI `archive`, MCP; `sourceSearch` [o ArchiveIndex.scala:238-256]) runs (1) the page query (`compile`):
`e$i` = head-candidate fragments matching the literal through `ch_epoch_fragments_lower_trgm`, `l$i` = matched heads —
28–43 ms for a rare literal at every size; then (2) one witness per page row (`ArchiveSearchWitnesses.literalSelection`
[o ArchiveSearch.scala:79-104]): the head's messages `WHERE strpos(lower(value->>'text'), needle) > 0 ORDER BY operand,
position LIMIT 2`. **The operator that grows with the session is the witness's `Index Scan using ch_epoch_messages_pkey`
over the whole head epoch with the `strpos(lower(…))` filter** — 4.4 GB: `Rows Removed by Filter: 855,042`, 4.26 M
buffer accesses (every value detoasted), 14.9 s. `LIMIT 2` cannot stop it: with one occurrence the scan must reach the
end to know there is no second (start/middle/end cost the same). The dashboard's `Archive` (`browse`) runs the page query
without witnesses: 0.12 s. Find avoids it by bounding the scan at 1 s and then reading the epoch's trigram candidates
[o SessionMessageSearch.scala:88-100]. At ≈ 3.5 s/GB a ≈ 8 GiB session's witness would pass the 30 s statement
deadline and the search would fail with `deadline` [i].

| case (literal, matched sessions) | CLI ArchiveSearch s | page query ms today / W2 | witness ms today / **W2** / W1 |
|---|---|---|---|
| 250 MB rare, early / mid / end (1) | 1.45 / 1.29 / 1.40 | 27–38 / 30–33 | 960 / **9.8** / 12.1 · 866 / **8.9** / 11.3 · 868 / **9.0** / 11.0 |
| 1 GB rare (1) | 3.89 / 3.94 / 4.16 | 28 / 31–33 | 3,677 / **9.5** / 12.5 · 3,465 / **9.1** / 11.3 · 3,571 / **10.2** / 11.7 |
| 4.4 GB rare (1) | 16.68 / 16.42 / 15.29 | 29–37 / 29–43 | 17,072 / **9.8** / 12.7 · 18,784 / **12.1** / 12.7 · 15,093 / **9.1** / 12.1 |
| common, 1 in 101 messages (1,202) | 0.78 | 249 / 262 | 70 / **46** / 865 (10 rows) |
| common word, ≈ 1 in 3 messages (2,803) | 5.50 | **5,066** / 5,565 | 74 / **69** / 6,415 (10 rows) |
| no hit (0) | 0.44 (the CLI floor) | 12 / 18 | — |

U8's 3.84–4.08 s (1 GB) and 15.28–15.76 s (4.4 GB) are reproduced (4.1 s, 15.3 s). Results identical in every case
(page rows and every witness statement's JSON, today vs W2 vs W1).
**A second scaling, not changed here:** for a frequent literal the page query rechecks and materializes every matching
fragment of the archive (`hedepira`: 376,689 fragments, 4.8–5.2 s, ≈ 13 µs each), the dashboard too — the exact-count
design of the global trigram path (ingest-b V5: `%error%` 4.7 s on the clone); §3.5.
### 3.3 Design W2 — witness positions from the page query
1. `corpus` gains `rv.epoch AS head_epoch, rv.message_count AS head_count` (`LEFT JOIN ch_revisions rv ON
   rv.session_id=s.id AND rv.revision=s.revision`, the join ingest-b §1.3 specified; NULL for legacy heads).
2. Only for `sourceSearch` (witnesses) and lexical, for each positive operand `i` on the trigram path (`e$i` exists) the
   page SELECT adds `literal_positions_$i` = `CASE WHEN EXISTS(SELECT 1 FROM ch_epochs WHERE id=page.head_epoch AND
   candidates='current') AND char_length(lower(? COLLATE pg_unicode_fast)) <= ArchiveProjection.overlapScalars THEN
   (SELECT coalesce(jsonb_agg(position ORDER BY position),'[]') FROM (SELECT DISTINCT f.position FROM e$i f WHERE
   f.epoch=page.head_epoch AND f.position<page.head_count ORDER BY f.position LIMIT maximumMatches) x) END` (NULL = no
   candidate set: legacy head, superseded epoch, operand longer than the overlap). `browse` is unchanged.
3. `PageRow` carries `literalPositions: Map[Int, List[Int]]`; `ArchiveSearchWitnesses.read` passes it on.
4. `literalSelection(content, operands, maximum, candidates)`: one `UNION ALL` branch per operand, each `ORDER BY
   position LIMIT maximum`; with candidates `${stored.sql} m WHERE m.position = ANY(?::int[]) AND strpos(…) > 0` (pushed
   into the PK's index condition: 5.5 ms on 4.4 GB [m INV]; an empty list reads nothing); without, today's scan. The outer
   `ORDER BY operand, position LIMIT maximum` and the span CTEs are unchanged.
**Identical results.** Session set, count, ranking, sort keys and cursor come from the untouched `l$i`/`matched`.
Completeness: every message of a current head epoch below `head_count` has its fragments, all head candidates
[o EpochWriter.scala:165-181; the prune touches superseded epochs only]; fragments of a folded text overlap by 512
scalars [o ArchiveProjection.scala:17-37], so an occurrence of ≤ 512 folded scalars lies inside one fragment. Soundness:
a fragment is a substring of the folded text and `LIKE` under the deterministic `pg_unicode_fast` collation is the
substring test the witness's `strpos(lower(…))` makes. So the first k distinct `e$i` positions of the head epoch below
its count are its first k matching messages; the witness still evaluates `strpos` and computes spans. Each operand
keeps its first `maximum` hits, so the global `(operand, position)` top-`maximum` holds. Rejected **W1** (the witness
queries the epoch's trigram index itself, like Find's phase 2): equal for rare literals but it rebuilds the global bitmap
per page row (`hedepira` 6.4 s of witnesses vs 74 ms). Migration: none. Protocol: none. Rollback: nothing stored.
### 3.4 Targets and acceptance
Rare literal over a 4.4 GB session: **witness ≤ 50 ms, CLI ArchiveSearch ≤ 1.0 s, flat in session size** (prototype:
witness 9–12 ms at 0.25/1/4.4 GB, page query 28–43 ms, CLI floor 0.44 s). Common literals: witness not slower than today,
page query within +10 %. Acceptance (§9): CLI `archive '"<rare>" mode:lexical'` at 1 GB and 4.4 GB within 0.2 s of each
other and ≤ 1.0 s; the evidence JSON equal to the base binary's for the same queries.
### 3.5 Not addressed: frequent literals (D17)
The page query is O(matching fragments) for a frequent literal (5 s for a word in a third of a 4.4 GB session's
messages); the total needs every matching head. Options (unmeasured): (a) a per-head early exit over a composite
`btree_gin` `(epoch, value gin_trgm_ops)` index chosen by bitmap size (new index on the fragment table, contrib
extension, two strategies); (b) keep and state it. Recommendation (b) now.

## 4. L4 — CLI reads of any page size (built and integrated: `agent/ingest-c` `cf77f7b5` + `482b5757`, CLI only)
Source: `reports/ingest-c/L4/report.md` incl. round 2 [r L4]; files `chronicle/cli/src/{transport,errors,mcp,main,output}.ts`,
`cli/test/cli.test.ts`, `cli/README.md`, one `CONTRACT.md` sentence; no server change.
- **Bound arithmetic.** A message page keeps ≤ P = 64 MiB measured as `octet_length(jsonb_build_object('value',v)::text)`
  (≥ 1 message) [o Database.scala:124,261]. Per character the answer is at most 6 × the measure on the WebSocket (circe
  escapes U+007F–U+009F as `\u00XX`, 6 B for a 1-B jsonb character) and 7 × through MCP (the result re-escaped as a JSON
  string). Client bounds: WS answer ≤ 6P + 1 MiB = **403,701,760 B**, MCP response ≤ 7P + 1 MiB = **470,810,624 B**, other
  HTTP responses 8 MiB, requests unchanged; both below V8's string limit; Node's native WS `maxPayloadSize` (128 MiB) is
  raised through a dispatcher. They cover every page of ≥ 2 messages and every one-message page whose message measures
  ≤ 64 MiB — every message of a record under the default 32 MiB `maxRecordBytes`.
- **Above the bound** (only a one-message page measuring > 64 MiB: `maxRecordBytes` configured above 64 MiB, or an
  `/api/ingest` message larger than its record): WS refuses the frame from its header (reported as "connection lost or
  answer above the CLI bound", exit 6), MCP `too-large` from `Content-Length`; measured 7.0 / 12.2 s at 79 MiB RSS.
- **Cost:** ordinary 20–31 MiB records 1.3–3.5 s, 205–332 MiB CLI RSS; worst case (384 MiB of escaped U+007F) 2.0 GB, 13.5 s.
  Server MCP: no 8 MiB-like bound; the opt-in text format and `read_message_context` keep their deliberate 128 KiB caps.
- **Server failure text** (U8 F4b) follows the CLI's own text, every request secret masked as `[credential]`, escaped,
  ≤ 512 characters; exit codes unchanged. Gates [r L4]: CLI 150/150; `nix build .#chronicle-cli` 150 + smoke 5/5.
- **Follow-ups:** `chronicle raw ID` without `--revision` is refused locally (`decodeOperation` rejects `revision: null`
  [r L4: cli/src/wire.ts:65]) → fixed in R2 (§10); counting the wire escaping in the server's page measure would shrink
  worst-case answers ≈ 6× (`Database.scala`) → §11 D9; the base CLI hung once at exit after an error (not reproduced).

## 5. L5 — streamed, bounded-memory indexing (from unit SPEC-L5)
Source: `reports/ingest-c/SPEC-L5/section.md`, `report.md`, `evidence/` (runs 1–3; [m L5]). Code paths are under
`chronicle/server/src/main/scala/chronicle/` unless named. Acceptance sessions: A = 1 GiB head (1.05 GB, 204,064
messages, E 13.80 GB), B = 4.4 GB head (4.444 GB, 849,822 messages, E 58.28 GB) [r U8]; from E: F ≈ 0.60 M (A) and
2.53 M (B) fragments, ≈ 9.5 k and ≈ 40 k windows at ≈ 63 fragments per window [i, run C ratio 63.2 r U8H]. Units:
§10 (L5a, L5b, L5d; L5c folded into ACC); decisions: §11 D10–D16.

### 5.1 Today's pipeline and what it holds
n messages, M stored message bytes, F fragments, P pieces (≈ F: one per fragment slice of a Problem part), d dimensions.

| structure | where | size | needed for |
|---|---|---|---|
| decoded messages `claim.snapshot.messages` (List) | streamed and decoded inside the claim transaction [o Database.scala:364,388-396; RevisionContent.scala:52-63,75-78]; the source row stays `FOR UPDATE` meanwhile [o Database.scala:346] | 2M + 256n (UTF-16, objects) | whole job (a `Claim` field [o Core.scala:232]) |
| `Source.messages` (Vector of the same objects) + distinct-id set | [o ProblemPassages.scala:79,123-130] | 8n + set of n ids (transient) | whole job |
| second `Source` in validation | [o ProblemsPublication.scala:11] | 8n | publication |
| `VectorArena` | [o Models.scala:151; VectorArena.scala:7-30] | 8d per piece, whole 2 MiB blocks | whole job |
| publication `Builder`: pieces + indexed chunks, passage map, span map, Context spans | [o ProblemsPublication.scala:81-89; Models.scala:252,267] | ≈ 2.7 KB per piece measured, 13,312 B reserved; 256 B per span [r U8H] | whole job |
| `result`: chunks re-copied with final passage summary/tags, passages, spans, links | [o ProblemsPublication.scala:90-102] | a second list of P chunks | publication |
| window, decision, `Delta`, one embedding part (≤ 16) | [o ProblemPassages.scala:14-24,62-118,153-189; Models.scala:200-224] | ≤ 64 fragments, ≤ 128 KiB source JSON; decision ≤ `annotation.maxResponseBytes` | one window |
| carry (`State.open`: summaries, tags, tail ≤ 16 excerpts, 4 KiB, 16 KiB JSON) | [o ProblemPassages.scala:22-24,134-146] | bounded | between windows |
| count pass (`total`) | [o Models.scala:226-235] | nothing retained; ≈ 0.22 ms CPU per fragment [m L5] | progress, `LargeJobs` |
| publication | ONE transaction [o Database.scala:473-505]: generation row, one INSERT per chunk (:482), `PassageStorage.persist` row by row [o PassageStorage.scala:16-30], tags = distinct over all chunks, search rows 500 per INSERT…SELECT (:486-488), delete the session's other search rows (:493), switch (:494) | DB time O(P); 369 pieces/s at a small index [m L5] | end of job |

E = `2·M + 256·n + 13,312·F + VectorArena.heldBytes(d,F)` [o Models.scala:48-49] is the job-wide sum of the whole-job rows.
- **Guards.** Claim: E > `maxIndexingBudgetBytes` → `Failed index-budget-exceeded`, no attempt [o Database.scala:357-359];
  without the large-job permit E > `maxSmallJobBudgetBytes` → passed by, remembered in `aboveSmallJobBudget` [o :321,360-362].
  Runtime: `Windows.within` before each window is retained [o Models.scala:158-162,204-207]; over the small budget a
  permit-less job is deferred (`deferLarge`, Queued, attempt not counted, total recorded) [o Models.scala:240-249;
  Database.scala:454-463]. `LargeJobs`: one permit, jobs of > 100 windows deferred to it [o Core.scala:240-249;
  Models.scala:306-308; Database.scala:342-346]. Defaults 2,147,483,647 and E(100 windows of 64 full fragments) [o Core.scala:101-108].
- **Lifecycle (S0-I1).** A switch supersedes older unfinished jobs except a Running one with a valid lease and queues the
  head job [o Database.scala:145-150]; the head job is not claimed while an older revision's job is Running (one job per
  source/profile) [o :344]; a Running job keeps authority over its older revision (`head` accepts `revision>=claim`)
  [o :397-401]; ended leases of older jobs are superseded in a short transaction [o :306-318]; every start supersedes
  older unfinished jobs [o migrations/001.sql:19-20].
- **Leases and fences.** Claim: attempts+1, fence+1, lease 300 s [o Database.scala:362-363; Models.scala:112]; renewal every
  30 s in a racing fiber [o Models.scala:278; Database.scala:464-469]; every checkpoint read/write re-checks head, job row
  lock, lease, fence and revision binding [o Database.scala:415-447]; the publication re-checks at its end [o :489].
- **Checkpoints.** `ch_index_checkpoints` keyed (job, run, stage, window, part) with an input hash over (identity, run,
  profile, binding id, envelope digest, algorithm, input) [o IndexCheckpoints.scala:22-49; migrations/010:6-16]: a run
  resumes its own accepted work; nothing is shared across runs or revisions. Embedding parts are JSON text of the doubles.

### 5.2 Design
#### 5.2.1 Claim without messages
`Claim.snapshot` becomes the envelope (`messages = []`, `files = []`; it carries `digest`), still the object
`RevisionBinding` captures, so binding checks and checkpoint keys are unchanged [o RevisionBinding.scala:11-12;
IndexCheckpoints.scala:26-27]; the claim adds the revision handle (`RevisionContent`: epoch + `message_count`, or legacy
session + revision + `ch_revision_info.message_count`). `claimedSnapshot` stops streaming messages, so the claim
transaction becomes O(1) and no longer holds the source row `FOR UPDATE` during a decode [i: it blocks that source's
switch today, `FOR NO KEY UPDATE` waits on `FOR UPDATE`]. `retainedEstimate` is not computed.

#### 5.2.2 Message cursor
- Each window reads its messages in a short read-only transaction: epoch `SELECT position,value FROM ch_epoch_messages
  WHERE epoch=? AND position>=? AND position<? ORDER BY position` with `keyOrdered` [o RevisionContent.scala:23,29-32];
  legacy `… FROM ch_messages WHERE session_id=? AND revision=? AND position>=? ORDER BY position` (primary key
  (session_id, revision, position) [o migrations/006:18-27]), read until the window is full. **Byte-bounded fetching
  (review S3):** today's fetch size 64 [o Database.scala:126] buffers 64 whole values (64 × 128 MiB at the record bound's
  maximum). Per batch the cursor first reads the next ≤ 64 positions with `octet_length(value::text)` (PostgreSQL
  detoasts; the JVM receives integers), applies the per-message guard of §5.2.7 before any value is fetched, then reads the
  values with fetch size 1 (the driver holds one row). A message above `largeMessageBytes` = 8 MiB of text
  (`SnapshotAdmission.largeBodyBytes`) is fetched and decoded under the `SnapshotAdmission` permit — one large decode in
  the process at a time, like claims and large ingests [o SnapshotAdmission.scala:14-23] — released after the decode,
  never held across windows. The count pass uses the same reader. Cost: each value is detoasted twice in PostgreSQL [i]. A 32-message read from a random position: 0.95 ms average, p99 1.56 ms on a 1.09 GB epoch (189,085 messages);
  0.34 ms, p99 0.44 ms (index scan, 7 buffers) on a 4.4 GB B-shape epoch (849,822 messages) [m L5]: O(log n) per window.
- `Source.next` keeps its algorithm [o ProblemPassages.scala:80-119] over a reader instead of a Vector, so windows are
  identical. The message the cursor stands inside (`utf16Offset > 0`) is kept decoded until it is consumed: a message
  longer than a window is decoded once, not once per window.
- `Source.apply`'s checks move to the read, per message, with the same codes [o ProblemPassages.scala:123-130]; distinct
  ids are guaranteed by `UNIQUE(epoch,message_id)` [o migrations/024:13-19] (a revision is a prefix of its epoch) and
  `UNIQUE(session_id,revision,message_id)` [o migrations/006:25]. Fewer rows than the count (purge) → `stale-claim`.
- Legacy revisions read `ch_messages` instead of the snapshot array: every legacy revision has those rows (start-up
  backfill [o ArchiveProjection.scala:104-141]) and they are `Wire.encode` of the same decoded messages [o :59-63,83-86].
  The count pass uses the same reader.

#### 5.2.3 Phase W (windows)
Today's loop [o Models.scala:250-275] without the publication builder, the arena and the decoded-message term: per window
read → decision (checkpoint or annotate, keys unchanged) → `accept` → embedding parts (checkpoint or call, keys unchanged;
vectors dropped once checkpointed) → progress. Retained between windows: `State` (cursor, ordinals, open passage with its
bounded carry) [o ProblemPassages.scala:141-146] and counters. Phase W writes nothing new.

#### 5.2.4 Phase P (publication from persisted results)
- **P0.** With checkpoint authority, find the staged generation G of (job, run) in `ch_staged_generations`, else insert
  `ch_generations(G, session, revision, profile, 'ContextAwareProblems', passage_count 0, run_id)` and its staging row
  (job, run, phase, resume point).
- **P1 replay** (decisions from checkpoints; a missing one is `internal`): a passage row when the passage first appears
  (span rows reference it [o migrations/008:22]) and its final `PassageInfo`/`span_count` by one upsert when it closes; a
  span row once final (every key except the open passage's last span, which the next window may extend
  [o ProblemPassages.scala:172-176]); Context spans with a running ordinal; the closed passage's tags. Batches ≤ 500 rows
  and ≤ 8 MiB, committed with the resume point; inserts `ON CONFLICT DO NOTHING` (rows are deterministic).
- **P2 replay**: each piece's chunk gets its passage's final summary/tags from P1's row (a passage's pieces are
  contiguous: one row cached), its vector from its embedding checkpoint (same key; a changed `embeddingBatchSize`
  re-embeds as today [o Models.scala:215-219]); chunk rows with today's statement and strings [o Database.scala:482] in
  JDBC batches, `ch_problem_pieces`.
- **P3 search rows, last** (review S4/S4′): today's 500-row INSERT…SELECT [o :486-488] + `ON CONFLICT DO NOTHING`, K
  writers over disjoint ordinal ranges (D15), each statement committed, then the switch at once — so the window in
  which committed rows of G sit unpublished in the HNSW index is the P3 duration only (§5.2.5).
- **Streamed validation.** `ProblemsPublication.validate`'s checks [o ProblemsPublication.scala:10-77] run per window with a
  carried frontier (position, chars, offset) and per-passage counters: windows cover consecutive disjoint source ranges,
  so per-window sorted coverage concatenates to the whole sort; spans are re-coalesced from the replayed pieces.
- **Switch** (one short transaction, today's tail [o Database.scala:489-503]): authority, monotonic check (a newer
  published revision → superseded), `passage_count`, delete the staging row, `published = G`, `ReindexCohort.published`,
  job `Complete`. **Retirement:** afterwards the worker deletes the session's search rows of other generations that are
  neither published nor staged, in ≤ 10,000-row statements (today one unqualified statement in the publication
  [o :493], which would also remove another profile's staged rows); the maintenance pass removes leftovers. Autovacuum
  reclaims them (§5.2.5).

#### 5.2.5 Atomic visibility, crash, lease loss, cleanup
- Readers reach generation rows only through `ch_sources.published` (search [o Search.scala:62,93]; Archive
  [o ArchiveIndex.scala:159-161,184]; Activity [o Activity.scala:32]; tags [o Search.scala:52,150,171;
  ExpressionHints.scala:124]) or an explicit `ContentView` validated in `select` [o Database.scala:214-228], which gains
  `NOT EXISTS (staging row)` → `not-found`.
- **ANN scan budget (review S4, round 2: option (a), D22).** The search authorization is a per-tuple filter inside the
  ordered HNSW scan [o Search.scala:62 `OFFSET 0`; ArchiveIndex.scala:184], strict iterative scan, `ef_search` 200,
  LIMIT `candidatesPerLeg` 1,000, `max_scan_tuples` 200,000 [o CandidateSql.scala:28-30, Retrieval.scala:69-77]: every
  index tuple the query may not see costs budget. Measured (M5): 100,000 such tuples nearest the query — committed but
  unpublished, or deleted and not yet vacuumed — cost 0.56–0.84 s per query (≈ 6–8 µs each; 68–98 ms without them) and the
  1,000 results still come; with the budget below their count (50,000 against 100,000, the production ratio for
  > 200,000) the ANN leg returns **0** rows. So a query starves only when more than ≈ 199,000 invisible tuples are closer
  than its 1,000th visible one. **Exposure with (a):** (1) staged rows during P3 only (A 11–40 min, B 45 min–2.8 h,
  §5.5); (2) the retired rows from retirement until vacuum. **Who can cause it:** a generation of > ≈ 200,000 pieces
  (≈ 0.6 GB of owner-shape raw; today's budget keeps every job below ≈ 100,000 [i from E], so today only extra latency
  is possible, never starvation); and only when its vectors are not near-duplicates of visible ones: the staged rows of an
  append-only re-publication sit next to their published twins and the retired rows next to the new ones, so a query
  near that session visits ≈ 2 × its results [i]; a first index or a content-changing replacement of a giant session can
  starve queries whose neighbourhood it dominates, for the windows above. **Vacuum:** migration 026 sets
  `ch_search_chunks` (`autovacuum_vacuum_scale_factor = 0`, `autovacuum_vacuum_threshold = 100000`), so 100,000 dead rows
  (half the budget) make it eligible within `autovacuum_naptime` (60 s) instead of at 20 % of the table (≈ 600,000 rows at
  B scale). Measured VACUUM (M5): 100,000 clustered rows out of 300,000 (586 MB HNSW) 37.8 s, 830 MB WAL; 100,000 scattered
  (uniform) rows > 22 min (stopped) — pgvector repairs the neighbours of every deleted element; a re-published session lies
  between [i], B scale [u] → measured in B′ and F′ (§9). This is today's autovacuum work after any re-publication,
  only larger. **Tests** (`StagedGenerationTest`): a publication stopped after its first P3 batch — a semantic search
  returns the previous generation's and other sessions' results and never a row of G; after the switch and retirement,
  before vacuum — the same search returns the new generation's results; migration 026's reloptions asserted.
- Fencing per batch: each P transaction starts with the job row `FOR SHARE` under `validJob` [o Database.scala:404], so a
  reclaim's fence update waits for an in-flight batch and a stale worker stops at its next batch; the switch re-checks
  everything as today.
- Crash or lease loss: G stays staged; the same job and run reclaimed later resumes it. Garbage: the maintenance pass
  [o EpochMaintenance.scala:18] deletes a staged G whose job is gone or not Queued/Running with G's run (superseded,
  failed, completed elsewhere), in bounded statements (chunks by ordinal range cascade to search rows and pieces
  [o migrations/002:4, 008:32]; then spans, passages, Context spans, tags, generation).

#### 5.2.6 Resume after a restart
Phase W: windows with checkpoints are not recomputed (today's keys); `State` is rebuilt by replaying `accept` from window
0 (≈ one pass, §5.5). Phase P: from the staging row's phase and resume point (the replay up to it writes nothing).
Optional later: store `State` (≤ ~20 KB JSON) with each resume point to skip the replay.

#### 5.2.7 What replaces the E admission
- Removed: the claim-time E check and `retainedEstimate` [o Database.scala:357-362,376-387], `aboveSmallJobBudget` [o :321],
  the small-budget deferral [o Models.scala:242-245] and the job-wide sum in `within` [o :158-162].
- Kept as a **per-window guard**: one window's pieces × (8d + 13,312) + spans × 256 ≤ `maxIndexingBudgetBytes` else
  `index-budget-exceeded` (terminal, failure stage Embedding, as today's runtime cap). The key keeps its default; its
  meaning changes from per job to per window. A window's parts are bounded by `annotation.maxResponseBytes` anyway.
  The same key bounds one message before it is fetched: 7 × its text size T (§5.2.8) above it → `index-budget-exceeded`.
- `maxSmallJobBudgetBytes` is retired (parsed and validated, no effect; unknown keys are already ignored by the decoder
  [o Core.scala:118,194-220]). `LargeJobs` stays (> 100 windows → the one permit): it now shares lane time, not heap.
- Jobs already `Failed index-budget-exceeded` stay so (no automatic retry, Q122); `RetryJob` [o Database.scala:135-142]
  runs them streamed; the next upload of such a source queues an ordinary job, which now indexes.

#### 5.2.8 Memory bound
Per lane: one window (≤ 128 KiB source; ≲ 10 MiB of objects with its per-scalar offset vectors [i]), one decision (≤ `annotation.maxResponseBytes`, 64 KiB in
`config.example.json`), one embedding part (≤ 16 vectors), one statement batch (≤ 8 MiB), the carry (≤ 16 KiB JSON) and
one message's decode chain (corrected in review S3): the driver's row = its jsonb text, T bytes; the decoded string 2T; the
JSON tree and the decoded `Message` ≈ 2T each — ≈ 7T while decoding, ≈ 2T retained while the cursor stands inside it [i].
T ≤ the bound the message was stored under (`maxRecordBytes` for parts, `maxBodyBytes` for `/api/ingest`) for ordinary
text and up to 6 × that for control characters [r L4]. Process-wide: four lanes × 2T_max retained + one large decode 7T_max
(the permit), and the guard keeps 7T ≤ `maxIndexingBudgetBytes`. Defaults (32 MiB records, ordinary text): ≲ 0.3 GB of
windows + ≈ 0.5 GB of messages [i]; at the 2 GiB guard: ≤ 4.4 GB [i] beside one ingest decode (1.94 GB at 256 MiB [r U8H]),
so a deployment raising `maxRecordBytes` toward 128 MiB keeps the default guard or lowers it. **Test:** three consecutive
20 MiB messages (count pass and windows) under a counting reader: at most one value fetched at a time, the large ones
under the permit; a message with 7T above an injected guard → `index-budget-exceeded` before its value is fetched.

### 5.3 Compatibility: nothing existing is re-indexed
- **Profile.** `IndexProfileCatalog.current` hashes the embedding space and (`index-profile-descriptor-v2`, annotation model,
  revision, request policy, `maxResponseBytes`, `ProblemPassages.identity`) [o IndexProfiles.scala:20-31]; the identity
  hashes prompt, schema and the window/context/piece constants [o ProblemPassages.scala:284-290]. The design keeps
  `Source.next`'s algorithm and every constant; the reader is not part of any identity. Rule for the units (as ingest-b spec
  §10.2): do not change `ProblemPassages` constants or identity, the profile descriptor, `IndexCheckpoints.identity`/`key`,
  `ArchiveProjection.lexicalVersion`; no job rows in migrations.
- **Checkpoint keys** stay (run, profile, binding id, envelope digest, algorithm, input) [o IndexCheckpoints.scala:25-27]:
  a job Running at the deploy is reclaimed after its lease and resumes its accepted windows.
- **Rows.** Chunk id = name UUID of (identity, run, `piece`, ordinal) [o ProblemPassages.scala:330]; chunk JSON
  `Wire.encode(Chunk)` after the final-metadata copy [o ProblemsPublication.scala:99]; document string and vector text
  [o Database.scala:482]; passages as `PassageInfo` JSON [o PassageStorage.scala:21]; spans, pieces and Context spans with
  the same ordinals; tags = the union of the passages' final tags = today's distinct over chunks (each passage has ≥ 1
  piece) [i]; search rows by the same INSERT…SELECT [o Database.scala:487]; `ch_generations` columns equal after the
  switch. Differences before the switch only: G exists unpublished and staged; old search rows go after the switch.
- **Migration `026_staged_generations.sql`** (DDL only, idempotent, in `Database.initialize`'s list [o Database.scala:49-55]):
  `ch_staged_generations(generation uuid PRIMARY KEY REFERENCES ch_generations ON DELETE CASCADE, job_id uuid NOT NULL
  REFERENCES ch_jobs ON DELETE CASCADE, run_id uuid NOT NULL, phase text NOT NULL CHECK(phase IN('Passages','Pieces')),
  resume jsonb NOT NULL, UNIQUE(job_id,run_id))` and `ALTER TABLE ch_search_chunks SET (autovacuum_vacuum_scale_factor
  = 0, autovacuum_vacuum_threshold = 100000)`. Down-script `chronicle/scripts/down-026-staged-generations.sql`: preflight
  counts, then deletes staged generations in bounded statements (their search rows by cascade), resets the two
  reloptions and drops the table. Nothing published is half-built at any time, so a rollback needs no preparation.
- **Rollback to the ingest-c-less binary.** Its migrations are scripts run at every start, so 026's table is just ignored
  [o Database.scala:13-18,45-55]. Published new-path generations are ordinary rows to it. A staged generation (down-026
  not run) is never published or named by it; its search rows go at that binary's next publication of the source
  [o Database.scala:493], the rest stays unreferenced like any older generation. Queued large jobs meet its E check again
  and end `index-budget-exceeded`, as before the deploy.
- **Tests that show it.** (1) `StreamedPublicationDifferentialTest`: the old `ProblemsPublication.Builder`, `validate`,
  `PassageStorage.persist` and chunk loop move unchanged to test sources as the oracle; one ≈ 12-window session stored as
  an epoch and as a legacy revision; a scripted annotator covering carry over several windows, A→Context→A, A-B-A inside
  one message, a span extended across a window boundary, empty messages, a message longer than a window, a Context-only
  window, ≥ 2 embedding parts per window and tags changed in a later window; the streamed worker completes, the oracle
  builds the publication from the same claim and the job's checkpoints; every generation table compared as text
  (`value::text`, `document::text`, `embedding::text`, ordinals, ids) — identical; plus identical windows from the legacy
  snapshot and from `ch_messages`. (2) Ingest-b spec §10.2's TEMPLATE rehearsal: count/md5 of `ch_jobs`, `ch_generations`,
  checkpoint keys and `ch_owner_targets` unchanged by starting the new binary (026 applied).

### 5.4 Prefix reuse for append-only growth (I2, I3)
- **When window k of revision N+1 equals window k of N** (same `sourceJson`, same carry): (a) the messages below the
  window's end are the same — append-only content of one epoch shares positions below N's count and its rows are
  immutable [o migrations/024:114,138]; (b) N's window k did not end at N's end of messages (only N's last window can;
  it is the one that changes when messages are appended); (c) the carry is equal, which holds when windows 0..k−1 were
  reused (`accept` is deterministic); (d) same profile, and for vectors the same embedding space.
- **Key without run or revision.** Annotation: `hash("window-reuse-v1", profile, input)` with today's checkpoint input
  `[window.sourceJson, carry]` [o Models.scala:260-261] (it carries ids, positions, roles, text and line starts per
  fragment [o ProblemPassages.scala:58-60], so a match implies equal positions); embedding: `hash("embedding-reuse-v1",
  space, texts of the part)` (the embedder sees `documentPrefix + text` only [o Models.scala:98]). Scope: same source and
  profile. Storage: a nullable `content_hash` on `ch_index_checkpoints` + partial index (migration 027, DDL only). On a
  miss of (job, run, window, part) **phase W** — under the checkpoint authority — looks the hash up among the *own*
  checkpoints (never references) of the source's jobs of that profile, verifies the output hash and records a reference
  for its own coordinates (review S5, rounds 1–2): `ch_index_checkpoint_refs(job_id uuid REFERENCES ch_jobs ON DELETE
  CASCADE, run_id, stage, window_ordinal, part, source_job, source_run, source_stage, source_window, source_part,
  output_hash, PRIMARY KEY(job_id,run_id,stage,window_ordinal,part), FOREIGN KEY(source_job,source_run,source_stage,
  source_window,source_part) REFERENCES ch_index_checkpoints)` — the full source key, so a match at other coordinates
  (another window ordinal of an older run) replays exactly that row. A coordinate holds either an own checkpoint or a
  reference. **Phase P and resume read only the own row or the reference by its full key** (value hash = `output_hash`),
  never a fresh lookup, so they replay exactly what phase W accepted even when runs accepted different outputs for one
  input. **No copy** (≈ 5 KB of vector JSON per piece per revision, ≈ 12 GB for B). **Lifetimes:** the foreign key is
  `NO ACTION` (checked at the end of the statement), so purge's one `DELETE FROM ch_jobs WHERE session_id=?`
  [o Auth.scala:344] removes every job, checkpoint and reference of the source together (reuse never crosses sources);
  references die with their own job (cascade); `discard` [o IndexCheckpoints.scala:44-48] deletes only the running job's
  own rows and an older run never resumes (S0-I1, `RetryJob` of a superseded revision is `conflict`), so a referenced
  row is never discarded — if it were, the foreign key fails that statement (`internal`), never a dangling reference.
  No annotation attempt is reserved for a reused window. Older runs' checkpoints stay as today. A replacement (new
  epoch) matches only where content and positions are equal.
- **I3 (incremental publication)** would publish N+1 as N's rows for the unchanged prefix plus the tail; it changes from
  N's last window on and every chunk of a passage open at N's end. Chunk ids are per run [o ProblemPassages.scala:330] and
  `ch_chunks.id`/`ch_search_chunks.id` are global keys [o migrations/001.sql:14; 002.sql:4], so I3 needs lineage-scoped
  rows and reader predicates, a lineage sweep and a rollback that materializes whole generations for the old readers.
- **Numbers.** D: 236 windows annotated for a head of 86 [r U8 D]; with I2 18+13+7+31+21 = 90 (−62 %) annotation and
  embedding calls; replay and publication unchanged. B-shape 4.4 GB session (≈ 40 k windows, ≈ 9.1 windows/MB) growing
  85 MB/day (≈ 770 windows/day): annotation per revision without I2 = 40 k windows = 3.9 h at the zero-delay stub
  (0.355 s/window [m L5]); at a real L s/window [u: production L unmeasured; ch-fix2 used 10–30 s] 4.6–14 days. With I2:
  the tail + 1 window, 4.6 min (stub) or 2.1–6.4 h (L = 10–30 s) per day of growth. Without I2 such a session cannot stay
  indexed with a real model (S0-I1 lets each job finish its own revision, the next starts again at window 0). With I2
  alone every revision still costs ≈ 3 replay passes (0.5 h for B) and a whole publication (B: chunk rows 0.4 h + search
  rows ≥ 2.8–7 h, §5.5), and deletes the previous 2.5 M search rows (HNSW vacuum [u]): each revision's job of a growing
  B-size session takes ≈ 4–8 h, the index lags by one or two such jobs, and the database re-inserts 2.5 M HNSW rows per
  revision. I3 would make both proportional to the tail; a cheap alternative is a minimum interval between
  publications of one large source (D13).
- **Recommendation:** I2 as its own unit right after the streamed path (12–18 h, medium); I3 deferred (25–40 h [r DESIGN
  §7], low confidence, reader and rollback changes) (D13).

### 5.5 Feasibility measurements and acceptance time
Synthetic only; owned PostgreSQL 18.7 with the fixture's configuration (`shared_buffers` 128 MB, statement timeout 30 s);
shared host under load (load average 5–60). Details and commands: `report.md`, `evidence/`.

| quantity | value | source |
|---|---|---|
| phase W per window (zero-delay stub, 768 d, one job; owner shape, 63.1 fragments per window) | 355 ms (738 windows in 262 s); run C 342–406 ms | [m L5 run 1]; [r U8H evidence] |
| count / replay pass (JVM window building) | 10.3 s for 46,601 fragments: 0.22 ms per fragment (≈ 8 MB/s of message values) | [m L5 run 1] |
| one window's messages by keyset (32 rows from a random position) | 1.09 GB epoch: 0.95 ms avg, p99 1.56 ms; 4.4 GB B-shape epoch (849,822 messages): 0.34 ms avg, p99 0.44 ms (its first 200 reads 0.38 / 0.46 ms) | [m L5 run 1, run 3] |
| ordered whole stream, DB side | 133 MB/s (1.09 GB, loaded host); 285 MB/s (4.49 GB in 15.8 s) | [m L5] |
| checkpoint read for the replay, DB side | 212 MB/s (335 MB of embedding JSON) | [m L5 run 1] |
| today's publication (one transaction, 46 k-row index) | 126 s for 46,544 pieces: 369 pieces/s | [m L5 run 1] |
| chunk rows, SQL side (tsvector, jsonb, vector) | 1.5–3.0 k rows/s | [m L5 run 2] |
| search rows, today's 500-row statement, uniform random vectors (U8's stub) | 1 writer: 157 rows/s (0–100 k rows in the index), 98 rows/s (100–127 k); 4 writers: 292 → 286 → 245 rows/s aggregate (127–200 k, 200–300 k, 300–374 k); HNSW 2.05 KB per row | [m L5 run 2] |
| same, run C's stub vectors (1,024-vector pool) | 1 writer: 478 rows/s, flat from 0 to 287 k rows (1.03–1.10 s per statement); 4 writers: 990 rows/s aggregate (287–600 k; 1.6–2.2 s per statement each) | [m L5 run 2b] |
| storage per piece | checkpoints 3.65 KB (this stub's 6-decimal vectors: 7.2 KB of JSON per vector before TOAST), `ch_chunks` 6.76 KB, `ch_search_chunks` 8.30 KB incl. HNSW 2.05 KB and GIN 0.32 KB: 18.7 KB | [m L5 run 1] |
| WAL | 2.15 GB for run 1 (ingest of 145 MB + indexing 46,544 pieces) | [m L5 run 1] |

**Estimates with the new path** (zero-delay stub, 768 d; A: 0.60 M pieces, 9.5 k windows; B: 2.53 M, 40 k) [i from the rows above]:

| part | A | B |
|---|---|---|
| count pass + two replay passes (3 × 0.22 ms × F) | 7 min | 28 min |
| phase W (0.355 s × windows) | 56 min | 3.9 h |
| checkpoint reads in P2 (≈ 15 KB of JSON per vector at full precision, U8's stub) | 9 GB, ≈ 2 min | 38 GB, ≈ 5–10 min |
| chunk rows (≈ 2 k/s) | 5 min | 21 min |
| search rows, U8's uniform vectors: 4 writers ≈ 250 rows/s / 1 writer ≈ 100 rows/s (slower as the index grows) | 40 min / 1.7 h | ≥ 2.8 h / ≥ 7 h |
| search rows, run C's pool vectors: 4 writers ≈ 950 rows/s / 1 writer ≈ 480 rows/s | 11 / 21 min | 45 min / 1.5 h |
| **total indexing** (uniform; pool) | **≈ 1.8 / 2.8 h; 1.4 / 1.5 h** | **≈ 7.7 / ≥ 12 h; 5.6 / 6.4 h** |
| disk added (≈ 19–22 KB per piece) | 11–13 GB | 48–56 GB |

- The acceptance budget does **not** need I2/I3 (a first index reuses nothing) nor more lanes (one job's windows are
  sequential: each window's input carries the previous window's decision [o Models.scala:260-261]). It needs the time
  for HNSW insertion: parallel search-row writers inside phase P (D15), and a B run of ≈ 8–12 h plus its 47-min
  upload (long wrapper) with ≥ 90 GB free disk. The vector distribution moves HNSW insertion 3–5 × (uniform random
  vectors are the hard case; real embeddings lie between [u]).
- Stub delay: 0 for A and B (model time is not what they test); D keeps 1 s per window (running-job continuation).
- Production shape: per piece the same DB costs; per window the real annotation latency L (unknown) replaces the stub's
  ≈ 0.36 s; HNSW insertion into the production index (940 k rows on the clone in ch-fix2 [r]) at `shared_buffers` [u].

### 5.6 L5e — incremental publication (I3) (from unit SPEC-L5E; revised after advisory review rounds 1–2)
Source: `reports/ingest-c/SPEC-L5E/{section.md,report.md,evidence/}`. Builds on §5.2 (L5a/L5b: streamed claim, phase W,
phase P into a staged generation, migration 026) and §5.4 (L5d: window reuse, migration 027). Orchestrator 03:22Z: L5e is
the last L5 unit; L5a→L5b→L5d ship without it; binding acceptance: work and lag per revision ∝ the addition, results
identical to a full re-publication. Tags as in this spec; **[m E1–E7]** = this unit's synthetic measurements (§5.6.7).
Code paths under `chronicle/server/src/main/scala/chronicle/`. Review resolutions: §5.6.10.

#### 5.6.1 What a generation holds, and which part is prefix-stable
N = the published revision (generation P), N+1 appends messages to the same epoch; K = P's last window (the only window
of N that can end at N's end of messages, §5.4 (b)); B = the passage open when window K starts (may be none). Windows
0..K−1 of N+1 equal N's (same messages below N's count [o migrations/024:114,138], cursor, input, and the same accepted
decision when L5d reuses parent-first, §5.6.3), so `accept` [o ProblemPassages.scala:153-189] yields the same pieces,
spans and Context spans for them. B is the only passage that can still change; nothing limits a passage's length today
(it continues while the model answers `continuePrevious` [o ProblemPassages.scala:166-170]; no bound in the code; the
U8 stub keeps one passage for the whole session [o scripts/upload-bounds.py:347-348]).

| content | table / key [o] | depends on | after N+1 |
|---|---|---|---|
| pieces: text, spans, vector | `ch_chunks(id,generation,value,document,embedding,ordinal)` [o 001.sql:14,17-18]; ordinal = piece ordinal, dense [o Database.scala:482] | the window range (vector = `documentPrefix`+text [o Models.scala:98]) | stable below window K |
| pieces: `summary`/`tags` in `value` and in `document` = tsvector(text, summary, tags) | same; today the passage's **final** metadata [o ProblemsPublication.scala:97-100] | today: the whole passage | today: all of B's pieces change whenever B's final metadata changes → whole-session rewrite for a session-long passage; with the horizon rule (§5.6.2) only B's pieces of windows ≥ K−H |
| chunk id, passage id | `UUID(identity, runId, kind, ordinal)` [o ProblemPassages.scala:170,179,330; Models.scala:274] | the run | new run ⇒ new ids; ids are a ranking tie-break today (§5.6.2 "Ranking") |
| search rows | `ch_search_chunks` [o 002.sql:3-11], HNSW + GIN [o Database.scala:57; 002.sql:12] | as pieces | as pieces; `generation`/`revision` label the writer |
| piece links | `ch_problem_pieces` [o 008.sql:25-34] | window range | as pieces |
| passages | `ch_problem_passages(generation,id,ordinal,…,value=PassageInfo,span_count)` [o 008.sql:3-12] | closed: fixed; B: grows | stable below B's ordinal b; B's row rewritten (1 row) |
| spans | `ch_problem_spans(generation,passage_id,ordinal,…)` [o 008.sql:13-23] | window range; B's last span can be extended by a merge [o ProblemPassages.scala:172-176] | stable below (b, s_B−1) |
| Context spans | `ch_context_spans(generation,ordinal,…)` [o 011.sql:7-15] | window range | stable below the count at K |
| generation tags | `ch_generation_tags(generation,tag)` [o 006.sql:37-41] = distinct chunk tags [o Database.scala:484] | the whole session (a set) | per-lineage counted multiset, changed only by rewritten/superseded/new pieces (§5.6.2) |
| generation row, chunk count | `ch_generations` (`passage_count`, …); `count(*)` [o Database.scala:519] | whole (counts) | new row O(1); stored piece count |
| Related | summary of chunk 0 [o Application.scala:77] | passage 0's metadata | changes only if passage 0 is B (within the horizon) |
| checkpoints / refs / staging | [o IndexCheckpoints.scala:25-27]; 026, 027 | window | own rows for windows ≥ K only |
| session metadata, title, statistics | `ch_revision_info` (ingest side) | revision | not generation rows |

Old generations are kept forever today (pins): a publication deletes only other generations' *search* rows
[o Database.scala:493]; CONTRACT: a `ContentView` "identifies immutable … annotation generation", "ordinary append or
republication preserves old full pins" [o CONTRACT.md:131,413-414]; only an explicit rebuild retires them
[o ReindexCohort.scala:88-93], purge deletes them [o Auth.scala:343-344]. Each full re-publication of a B-size session
adds ≈ 17 GB of `ch_chunks` (2.53 M × 6.76 KB [m L5]) and re-inserts and later vacuums every HNSW row: VACUUM after
retiring 20,000 rows of a 640,000-row index took 21.5 min and 13.3 GB WAL [m E5].

#### 5.6.2 Design: shared immutable rows, versioned membership segments, metadata horizon
**Shape.** Rows stay labeled with the generation that wrote them (its **origin**) and are never rewritten. A **lineage**
starts at a full publication (a **root**: first index, replacement, every L5b-path publication) and continues with
incremental publications; published generations of a lineage get versions 0, 1, 2, … *at their switch*. Membership is
stored as **versioned segment rows** `(lineage, origin, since, until, ranges)`: generation (L, v) contains the rows of
`origin` inside `ranges` for every segment row with `since ≤ v < until` (until NULL = open). A switch changes O(H)
segment rows (§ below), never copies the parent's list — so there is **no chain-length cap and no compaction**: chain
length only adds a log factor to index probes. Options considered: lineage resolved recursively (depth grows per
revision, recursion inside the per-tuple ANN filter: no); per-generation copied segment lists (O(chain) per publication:
round-1 version, replaced); per-row membership (O(session) per revision: no); one "live" generation relabeled in place
(O(tail) non-HOT relabels = HNSW re-inserts, 0 % HOT and 74 rows/s [m E6]; breaks immutable pins: no).

**Metadata horizon (behaviour change for newly published content; decision E1).** Today every piece carries its
passage's *final* summary/tags. New rule in both paths: a piece produced in window k carries its passage's metadata
**after window min(k+H, last window of the passage)**, H = `ProblemsPublication.metadataHorizonWindows` = 16. Passages
of ≤ H windows (≈ 1,000 fragments, ≈ 1–2 MB of transcript) are published exactly as today; in longer passages a piece's
summary/tags are those the model held H windows after it (the passage row — GetPassages — keeps the final metadata).
Consequence: in revision N+1 only B's pieces of windows [K−H, K) can change (their horizon reaches the re-done windows);
all earlier pieces are fixed by windows < K. Rewrite bound in pieces: r ≤ Σ over windows k ∈ [K−H, K) of B's pieces
in k; a window's pieces = Σ over its Problem parts of the fragments each touches ≤ 64 fragments + (parts − 1), and a
decision holds ≤ 422 parts at `annotation.maxResponseBytes` = 64 KiB (a minimal Problem part is 155 B of JSON) [i from
the schema]: ≤ 485 pieces per window, **r ≤ 7,760 at H = 16 in the worst case**; the measured shape has 63.2 fragments
and ≈ 63 pieces per window [r U8H], r ≈ 1,000. Independent of session size. A piece of R whose recomputed metadata
equals that of its current member row is not rewritten (the stub: none); see "Membership of a partly unchanged R".
**No fingerprint change:** the profile hashes the embedding space, annotation config and `ProblemPassages.identity`
[o IndexProfiles.scala:20-31]; H lives in `ProblemsPublication`, not in the identity; checkpoints (decisions, vectors)
are unaffected; existing generations are untouched, nothing is re-indexed; a session re-published later uses the rule.
The existing worker test publishing final metadata (3 windows [o test PassageWorkerTest.scala:55-80]) stays valid.

**Ranking (round-1 B1).** Chunk ids enter ranking only as tie-breaks: the lexical leg `ORDER BY ts_rank_cd DESC, ch.id
LIMIT 1000` [o Search.scala:75], the rerank `row_number() OVER(ORDER BY lex DESC,id)` / `(ORDER BY distance,id)` and
`DISTINCT ON(session) … ORDER BY session, score DESC, id` [o shared/retrieval-core CandidateSql.scala:22-26], the
lexical mode [o Search.scala:68], `searchLegacy` [o Search.scala:93] and Archive witnesses `ORDER BY
distance,operand,id` [o ArchiveIndex.scala:219] (the `a$i` legs then also project `ordinal`). Retained prefix ids
(lineage) and fresh ids (root) would order exact ties differently. Fix in both paths: tie-break on the
generation-independent key `(session_id, ordinal NULLS LAST, id)` (search rows gain `ordinal`; rows of pre-028
generations have NULL and fall back to id as today). `CandidateSql.rerankCtes` gains a tie-break-columns parameter
(default `id`: Haystack's `PostgresRetrieval` [o shared/retrieval-postgres PostgresRetrieval.scala:249] unchanged).
Effect on today's results: only the order among exactly equal keys (equal `ts_rank_cd`, equal distance, equal fused
score) changes — which tied chunk/candidate is taken (today decided by random UUIDs). Lexical and semantic scores are
unchanged (`lex`, `1−distance`); a **hybrid** hit's RRF score can change, because tied candidates get other ranks
`lr`/`vr`, and with it the best chunk or order of a session — identically in both new paths; not part of any profile →
no re-index. The HNSW leg itself has no tie-break and is approximate (CONTRACT "candidate discovery remains
approximate"): its candidate set depends on the index's insertion history, so two full publications of the same content
can already differ there; identity is therefore defined and tested for equal candidate sets (§5.6.6).

**Migration `028_generation_lineage.sql`** (DDL + constraint redefinition; idempotent; no job rows):
- `ch_generations` + `lineage uuid`, `lineage_version int` (nullable; NULL = classic generation of an earlier release),
  `UNIQUE(lineage, lineage_version)` (a version is taken once: the lineage is linear).
- `ch_lineage_segments(lineage uuid REFERENCES ch_generations ON DELETE CASCADE, origin uuid REFERENCES ch_generations
  ON DELETE CASCADE, kind text CHECK(kind IN('piece','passage','span','context')), since int, until int, lo_major int,
  lo bigint, hi_major int, hi bigint, staged_by uuid)` + index `(lineage, origin, kind, since)`; half-open ranges;
  `*_major` is the passage ordinal for spans (ordered by (passage, span ordinal); only B's spans span origins), 0 else;
  `since` NULL = written by a staged generation (`staged_by`), invisible.
- `ch_generation_lineage(generation PRIMARY KEY REFERENCES ch_generations ON DELETE CASCADE, parent uuid, last_window
  int, cut jsonb, pieces bigint)`: `cut` = the `ProblemPassages.State` before the last window (cursor, ordinals, open
  passage with last span and ≤ 16 KiB tail [o ProblemPassages.scala:134-145]), Context-span count, validator frontier,
  piece-ordinal boundaries of the last H windows — ≲ 25 KB [i].
- `ch_lineage_tags(lineage REFERENCES ch_generations ON DELETE CASCADE, tag, pieces bigint CHECK(pieces>0), PRIMARY
  KEY(lineage, tag))`: the tag multiset of the lineage's current published version (tags are read only for published
  generations [o Search.scala:52,150,171; ArchiveIndex.scala:159; ExpressionHints.scala:124]); a staged root builds its
  own lineage's rows in phase P batches (invisible: readers follow `p.lineage` of the published generation).
  `ch_lineage_tag_deltas(generation, tag, delta)`: an incremental generation's staged tag changes.
  `ch_lineage_retirements(lineage)`: a superseded lineage whose tag rows are deleted after the switch.
- `ch_search_chunks` + `ordinal integer` (nullable, metadata-only); `ch_search_retirements(session_id, origin, piece_lo,
  piece_hi)`.
- Format discriminator: lineage generations (version ≥ 1, staged or published) are stored with `passage_format =
  'ContextAwareProblemsLineage'`; 028 redefines 022's `ch_generations_current_format_check` to admit it (only while its
  definition lacks it), and the release's `011_context_coverage.sql` list gains the value (011 re-creates its check at
  every start [o 011.sql:3-4]). The wire format stays `ContextAwareProblems` (new readers map the label). Roots keep
  `ContextAwareProblems`.

**Eligibility** (claim; re-checked at the switch): the published generation P has a lineage row and `lineage_version`,
the claim's profile, is not retired; P's revision and N+1 are epoch revisions of the same epoch with P's
`message_count` ≤ N+1's; no reindex retirement would fire at this publication (the predicate of
[o ReindexCohort.scala:88]); `indexing.incrementalPublication` (new key, default true; false = every publication a
root: the operator's off switch and the acceptance oracle's). Otherwise a root (L5b path).

**Job for N+1 with parent P** (one `Claim` as L5a; checkpoint keys unchanged):
1. Restore `State` from P's `cut` with `namespace` = this run (new passages/pieces get this run's ids; B keeps its
   stored id). Count pass and phase W start at window K's cursor (keyset reads [m L5]); window indexes and progress
   continue at K. Window K is re-annotated or reused by L5d; nothing below K is read or replayed.
2. Phase P (staged as §5.2.4): P0 writes G′ (label `…Lineage`, lineage = P's, version NULL), its lineage row and its own
   segment row (since NULL). Rewrite region R = pieces from max(first piece of window K−H, first piece of B) — B's
   pieces are a contiguous suffix before K, since a passage opened after B would have closed it — to the end. P1–P3
   write only G′'s rows: B's row, new passages, spans from (b, s_B−1), Context spans from K, chunks/links/search rows
   (with `ordinal`) for R ∪ new windows; R's text, spans and vectors are read from P's rows (not re-embedded), unchanged
   pieces of R are skipped. Tag changes (+ tags of written pieces, − tags of the member rows they replace) go to
   `ch_lineage_tag_deltas` in the same batches, committed with the resume point (so a replay applies each once). The
   streamed validator starts from the saved frontier with the horizon rule.
3. Switch (one short transaction): `s.published = P` (else `stale-claim`; the retry chooses again); version v′ = v_P+1;
   segment rows changed as in "Membership of a partly unchanged R" (≤ 2H+10); one `INSERT … ON CONFLICT DO UPDATE`
   applying the staged tag deltas (≤ 16 rows per passage the revision touches: B and the addition's new passages;
   ≈ 20 µs per row [i]) and deleting counts that reach 0; superseded search ranges → `ch_search_retirements`;
   `published = G′`; job `Complete` (measured 14 ms for 90 segment rows [m E5]). Delta rows are deleted afterwards.
4. Retirement after the switch: ids of each pending range via `ch_chunks (generation, ordinal)` [o 001.sql:18] →
   `DELETE … WHERE id IN` in ≤ 10,000-row statements; maintenance finishes leftovers. Content rows stay (pins).
**A root** prepares everything before its switch: its segment rows (since NULL), its `ch_lineage_tags` counts and its
`ch_generation_tags` (as L5b's P1 does today) are written in phase P batches committed with the resume point. Its switch
only sets `since = 0` on its ≤ 4 rows (one per kind), records the previous lineage in `ch_lineage_retirements` and sets
`published` (plus §5.2.4's tail) — O(1). Afterwards the previous lineage's tag rows are deleted in ≤ 10,000-row
statements; a sweep of an abandoned staged root deletes its tag rows in bounded statements before its generation row.

**Membership of a partly unchanged R** (round-2 advisory). Within R all pieces are B's, and all pieces of one window
share one horizon window, so "unchanged" is decided per window. Example: B's metadata after window K differs from what
the member rows of window K−H carry, after K+1 equals the member rows of K−H+1, after K+2 differs again → windows K−H
and K−H+2 are rewritten into G′, window K−H+1 keeps its current member rows **and their origin** (its ids, its rows).
The comparison is always against the current member row (a value that returns to an older origin's value is still
rewritten if the current member differs; rows are never re-admitted). Segment rows are one per (origin, kind, range);
piece ranges may split. Per switch: closed (`until = v′`) ≤ H+2 piece rows (≤ one per window of R, the one straddling
R's start, P's row covering window K) and ≤ 3 rows of the other kinds (B's passage, B's last span, Context from K);
inserted ≤ H+2 piece rows (kept runs: ≤ ⌈H/2⌉ inside R + the part before R; own runs: ≤ ⌈H/2⌉ + the tail from K) and
≤ 3 others — ≤ 2H+10 = 42 rows at H = 16.

**Readers** (one SQL helper `GenerationRows`; a classic generation reads as `(self, all)`):
- Pages are ordinal ranges (ordinals are dense): segment rows valid at v overlapping `[offset, offset+limit)`, then
  `ch_chunks (generation, ordinal)` ranges — 0.4–0.6 ms at any offset of a 500,000-piece, 100-origin generation vs
  282–686 ms for today's `OFFSET` at 150,000–302,000 [m E3]; count = `pieces`; passages likewise; a passage's spans via
  its passage row and the span ranges covering its ordinal [o PassageStorage.scala:41-47]; Related via the helper.
- Search authorization per tuple inside the HNSW scan [o Search.scala:61-62; ArchiveIndex.scala:184]:
  `(SELECT true FROM ch_sources s JOIN ch_generations p ON p.id=s.published JOIN ch_revision_info r ON r.session_id=s.id
  AND r.revision=p.revision WHERE s.id=ch.session_id AND (s.published=ch.generation OR (SELECT true FROM
  ch_lineage_segments m WHERE m.lineage=p.lineage AND m.origin=ch.generation AND m.since<=p.lineage_version AND
  (m.until IS NULL OR m.until>p.lineage_version) AND m.kind='piece' AND ch.ordinal>=m.lo AND ch.ordinal<m.hi LIMIT 1)) AND
  <visible> OFFSET 0)` — the metadata filter joins the **published** revision. **Scalar subquery, not `EXISTS`**:
  written as `EXISTS` inside the `OR`, PostgreSQL 18 once planned it as a hashed `ANY` probing by origin alone (skip
  scan) under sparse statistics: 0.72 ms per tuple, 1.18 s vs 0.51 s per query [m E7]. Cost of the scalar form (per-
  generation variant measured): 8–10 µs vs 4–7 µs per tuple; ANN queries 316 vs 299 ms avg [m E2]; the versioned form
  adds only range/validity filters on the same index probe [i].
- Hit views are mapped to `(s.published, p.revision)` in `pageStatement` [o Search.scala:96,123]; Archive witnesses take
  `page.generation`/`page.indexed_revision` [o ArchiveIndex.scala:217-219] and read the witness chunk by
  `(id, membership)` [o ArchiveSearch.scala:65]; `matched_generation` is already published [o ArchiveIndex.scala:212];
  `searchLegacy` joins through the segments [o Search.scala:93]. Tags: `ch_lineage_tags` of `p.lineage` when set, else
  `ch_generation_tags` (one helper for the five sites). `select` [o Database.scala:214-228], `requireCurrentPublications`
  [o PassageStorage.scala:33-35], `ArchiveIndex.row` [o ArchiveIndex.scala:231-232] and the start check
  [o Database.scala:31-35] accept both labels.

#### 5.6.3 What readers see; lifecycle
- **Atomic visibility:** G′'s rows are invisible until `published = G′` (its segment row has no `since`); P's superseded
  rows leave the membership at the same commit (validity) before they are deleted. Measured: queries near 20,000 staged
  twin rows, after the switch, after deletion and after VACUUM all return 1,000 rows [m E5].
- **Pins:** rows and segment rows are never changed except `until` on rows that a later version supersedes, which does
  not change what an earlier version reads; an old pin reads exactly what it read before (test). Prefix chunk ids
  persist across revisions (today every publication renames all) — no wire change.
- **D22** stays unit ANN's (detection and its acceptance); L5e only bounds the exposure: invisible HNSW tuples are G′'s
  own rows during P3 (addition + ≤ H+1 windows, the rewritten ones twins of visible rows) and the superseded ones until
  VACUUM.
- **Crash / lease loss:** as §5.2.5; State comes from P's `cut`. Sweep of an abandoned staged lineage generation deletes
  its rows and its `since`-NULL segment row; staged generations are never parents or origins.
- **Retention:** superseded content rows stay as pins (now only the tail and region R are written per revision);
  superseded search rows deleted from `ch_search_retirements`; VACUUM ≈ 65 ms and 660 KB WAL per deleted HNSW row at
  640 k rows [m E5] — ∝ retired rows ≤ (H+1) windows + nothing else.
- **Explicit rebuild / purge:** eligibility makes a cohort-retiring publication a root, so `ReindexCohort.published`'s
  payload delete [o ReindexCohort.scala:88-93] never removes a member of the published generation (asserted: `internal`
  otherwise); purge cascades (segments via `origin`, lineage rows via `generation`).
- **Replacement (new epoch), legacy revisions:** roots. **No re-index:** 028 is DDL; classic generations read as before;
  the first post-L5e publication of an existing session is the root its next upload triggers anyway; profile, identity,
  checkpoint keys, `lexicalVersion` unchanged.
- **Requirement on L5d:** when several runs hold outputs for one window input, take the published generation's run first.

#### 5.6.4 Rollback
- **Pre-028 binaries fail closed.** The L5d and base binaries re-run their own 011 at start, which re-creates
  `ch_generations_passage_format_check` with the three old values: with any `ContextAwareProblemsLineage` row present the
  `ADD CONSTRAINT` fails and **the binary does not start** ("violates check constraint"; `docs/operations.md` names it).
  Should one run anyway, its readers refuse lineage generations: `select` answers `unavailable` (not the current format)
  for every view, search hit, Related and witness of such a session; `requireCurrentPublications` refuses facets/tags;
  `ArchiveIndex.row` fails the listing — no partial content is served as complete. Roots stay readable by them.
- **`chronicle/scripts/down-028-generation-lineage.sql`** (server stopped; restartable): preflight counts; `DROP INDEX
  IF EXISTS ch_search_hnsw_d<d>`; composite FKs [o 008.sql:22,32-33] dropped `IF EXISTS`; then **one transaction per
  source** having lineage generations: if its published generation G is a lineage generation, relabel G's member rows
  (chunks, passages, spans, links, Context spans, search rows incl. `revision`) to G and write G's `ch_generation_tags`
  from `ch_lineage_tags`; retire every other lineage generation and origin of the source (pins → `indexed-view-retired`,
  as after an explicit rebuild) and delete their remaining payload; relabel every lineage generation of the source to
  `ContextAwareProblems`; delete its 028 rows. A source without lineage-labeled rows is skipped, so an interrupted run is
  resumed by running the script again. At the end: FKs re-added `NOT VALID` (`IF NOT EXISTS` by name), 022's constraint
  restored, 028's tables/columns dropped, HNSW index rebuilt (before the old binary's start would build it inside its
  start transaction [o Database.scala:57]; cf. 017 [o Database.scala:36-44]). Cost [m E6]: search-row relabel without
  the HNSW index 5,040 rows/s, 10 KB WAL/row (with it 74 rows/s, 0 HOT); chunk relabel ≈ 28,000 rows/s; HNSW build 157 s
  per 620,000 rows (8 workers, 8 GB).
  Roll-forward: flattened generations are classic; next publications root, then incremental.

#### 5.6.5 Cost per revision and acceptance
a = pieces of the addition; w = pieces of the re-done window K (≤ 485, ≈
63); r = rewritten pieces of R (≤ 7,760 at H = 16, ≈ 1,000 typical, 0 with constant metadata; §5.6.2). Per revision:
annotation/embedding calls for the addition's windows + 1; message reads of the addition; rows written a+w+r (chunks,
links, search rows; + B's row, new passages/spans/Context spans); segment rows ≤ 2H+10; tag delta rows ≤ 16 per touched
passage; HNSW inserts a+w+r; retirement and VACUUM share w+r. Nothing depends on the session's size or on the number of
earlier revisions except index depth (log). Roots remain O(session) by nature, once per event, never per append: a
replacement (new epoch), an explicit rebuild, a legacy revision, the key set false, and the first post-L5e publication
of an already indexed session. L5b+I2 instead: three O(session) replay passes, P rows, P HNSW inserts, P HNSW deletions.
Measured at a 600–640 k-row index (isotropic 768-d, the hard case; `shared_buffers` 128 MB, `max_wal_size` 1 GB) [m
E4–E5]:

| per revision | I3 | L5b+I2 (whole re-publication) |
|---|---|---|
| search rows (1 / 4 writers) | (a+w+r) at 65 / 195 rows/s | P at the same rates (lower as the index grows) |
| WAL of search rows | ≈ 120 KB each (≈ 21 of the run's 29 GB were full-page images) | same per row |
| deletes + VACUUM | (w+r) × ≈ 65 ms, 660 KB | P deletions: at least a whole-graph repair [i] |
| B-shape, +85 MB/day ≈ 48,500 pieces | ≈ 4 min of search rows (+ ≈ 5 s for a typical R, ≤ 40 s worst case), ≈ 6 GB WAL; lag = the tail's phase W (4.6 min stub; 2.1–6.4 h at L = 10–30 s [u]) + minutes | 2.53 M rows ≥ 3.6 h, ≈ 300 GB WAL, VACUUM of 2.5 M rows [u: hours], replay ≈ 28 min |
| A (1 GiB), +1 % ≈ 6,000 pieces | ≈ 30 s (+ R) | 0.6 M rows ≈ 51 min + VACUUM |

Twins (rewritten pieces, identical vectors) cost the same insert time (67/233 rows/s) and 86–91 KB WAL [m E4].
**Acceptance H** (ACC; ≤ 5 h, ≤ 60 GB; A′'s harness and settings; stub annotator as D14; D22 not asserted here): an
indexed 1 GiB session grows by 10 appends of 0.5–2 %; after each job: own rows per table, search rows inserted, HNSW size
delta, rows retired, segment and tag rows written, WAL, job wall, lag (commit → published). Assert own rows ≤
pieces(windows ≥ K) + B's pieces in windows [K−H, K), retired ≤ pieces of window K + B's pieces in [K−H, K) (counts
from the job's own window records), and job wall ≤ c₀ + c₁·addition with c₀, c₁ fitted on appends 1–5 and
holding for 6–10 (target ≤ 10 min per +1 %). A second leg repeats 5 appends with a scripted annotator that changes B's
summary at every window (a session-long passage): the same assertions must hold (R bounded by H). Then the final
revision is uploaded whole for a second owner and indexed as a root after a restart with
`indexing.incrementalPublication=false`; compared: hashes of all logical rows (ids mapped by ordinal), every chunk,
passage and span page, Related, lexical searches (exact: equal), Archive literal search; semantic/hybrid searches
reported as candidate overlap only (HNSW approximate in both arms; equality is the unit test's, §5.6.6).

#### 5.6.6 Proof of identical results — tests (failing first where marked)
1. **`IncrementalPublicationDifferentialTest`** (fails first on its cost assertion: today every revision writes all
   rows). One owner, three sources grown in parallel, plus a second owner's source (isolation); a deterministic scripted
   annotator and embedder (vectors by text) covering: B unchanged; B with new summary/tags every window over > H windows
   (session-long passage); B = passage 0 (Related); a passage closing in window K; B's last span extended across the cut;
   Context-only window at the cut; an empty message at the cut; a message longer than a window across the cut; ≥ 2
   embedding parts; **identical texts across and within the three sources** (exact `ts_rank_cd`, distance and fused-score
   ties). Arms on the **same sessions**: after each revision r = 2..5 published incrementally, capture every answer, then
   re-publish r as a root (`RetryJob` with the policy injected off) and capture again; the next revision grows from that
   root (lineage after a root covered). Compared up to ids (chunk/passage ids by ordinal, generations by revision): all
   logical rows (`value::text`, `document::text`, `embedding::text`, links, passages, spans, Context spans, tags, counts);
   GetSession, all GetChunks pages, GetPassages, all GetPassageSpans, Related, lexical/semantic/hybrid `Search` (hits,
   views, scores, totals, countScope, order), `Facets`, `search_tags`, Archive `ArchiveSearch` (rows, views, witnesses).
   The corpus stays below `candidatesPerLeg`, and each arm asserts the ANN leg returned every visible row (complete
   candidate sets), so ranking equality is decided by the tie-breaks alone. Pins of earlier revisions unchanged after
   each step; revision 6 a replacement (roots). Cost assertions: own rows ≤ windows ≥ K + R; R ≤ H windows of pieces in
   the session-long-passage source.
2. **`GenerationLineageTest`**: a stopped incremental publication is invisible (search, pins); after the switch and
   before retirement no superseded row is visible (fails with origin-only membership); retirement deletes exactly the
   pending ranges; an abandoned staged generation's sweep leaves the parent; purge; explicit rebuild → root, lineage
   retired; parent no longer published at the switch → `stale-claim`, retry → root; 200 incremental revisions with ≤
   2H+10 segment rows changed per switch (no cap needed); with an injected H = 4, B's metadata changed after window K,
   back to the member rows' value after K+1, changed after K+2: windows K−4 and K−2 rewritten, K−3 keeps its origin rows
   and chunk ids, closed/inserted segment rows counted, content equal to a root re-publication; a root's switch changes
   ≤ 6 rows and the previous lineage's tag rows are gone after the retirement step; `ch_lineage_tags` equals the
   distinct tags of member chunks after each step; **plan test** of the per-tuple probe (`Index Cond` on lineage and
   origin) both with a freshly analyzed near-empty segment table and with 10,000 analyzed rows.
3. **Rollback**: a database holding published, unpublished and staged lineage generations; the base release's `011`
   text fails on it (fail closed); `down-028` stopped after its first source, then run again (and a third time: no-op):
   afterwards the base `011` succeeds, today's reader SQL (`generation=?`, `s.published=ch.generation`) returns each
   published generation's full logical content, other lineage generations are retired.
4. Existing guards: §5.3's differential test with its oracle builder given the horizon rule; profile/identity tests
   unchanged; no codec change (no gate O).

#### 5.6.7 Measurements (this unit; synthetic; `evidence/`)
Own PostgreSQL 18.7 + pgvector 0.8.7 (fixture tools' build), fixture settings (`shared_buffers` 128 MB, `work_mem` 4 MB,
fsync on) + `max_wal_size` 1 GB, autovacuum off for `ch_search_chunks`; loaded host (load 13–19). Replica DDL of
001/002/008 + HNSW; S0 = 500,000 pieces published as a lineage generation over 100 origins (one of 302,000 rows, 99 of
2,000), 100 sessions × 1,000 pieces, 3,000 more sources, 6,500 generations, 50,100 segment rows (round-1 per-generation
layout); isotropic Gaussian 768-d vectors; 1.76 KB texts; HNSW bulk build of 600,000 rows 125 s (8 workers).
- **E2** per-tuple authorization 4–7 µs (today's form, flat labels of the same rows) vs 8–10 µs (segment probe, 2 µs on
  869 of 1,000 tuples); 60+60 alternating ANN queries near S0 299 vs 316 ms avg (p50 425/413), all 1,000 rows.
- **E3** pages as above. **E4** fresh inserts 64.7 rows/s (1 writer, 1.21 GB WAL per 10,000) / 195 rows/s (4 writers);
  twins 67.5 / 233 rows/s, 0.86 / 0.91 GB; HNSW +2.05 / +1.4 KB per row.
- **E5** switch 14 ms; deleting 20,000 search rows 0.66 s, 160 MB WAL; VACUUM ≈ 21.5 min, 13.26 GB WAL, 1.78 M FPIs.
- **E6** relabel 5,000 search rows with HNSW 67.9 s, 354 MB WAL, 0 HOT; 50,000 without it 9.9 s, 506 MB; HNSW rebuild of
  620,000 rows 157 s; 5,000 chunk rows 0.18 s. **E7** the `EXISTS`-in-`OR` plan (above).
Not measured: clustered embeddings (HNSW rates differ 3–5 × [m L5 run 2b]); a 2.5 M-row index; production
`shared_buffers`; the versioned-segment probe [i]; how often production passages exceed H windows and how often a
continuing part changes the summary (F′ can count both on the clone) [u].

#### 5.6.8 Units, ownership, estimate
| unit | goal | owns | depends | tests | gates | h |
|---|---|---|---|---|---|---|
| **L5e-1** lineage storage, readers, ranking | 028 (+ 011 list, 022 redefinition) and `down-028`; roots write lineage row, segment rows, lineage tags in phase P batches; `GenerationRows`; readers of §5.6.2 incl. tags, label mapping, published views; stable tie-breaks; retirement queue; ReindexCohort guard | `migrations/011_…` (one value), `migrations/028_…`, `scripts/down-028-…`, `Database.scala`, `PassageStorage.scala`, `Search.scala`, `ArchiveIndex.scala`, `ArchiveSearch.scala`, `ReindexCohort.scala`, `EpochMaintenance.scala`, `ExpressionHints.scala` (tags helper), new `GenerationRows.scala`, `shared/retrieval-core/…/CandidateSql.scala` (tie-break parameter, default unchanged), tests | L5d; unit ANN (Search/ArchiveIndex); L3-W | `GenerationLineageTest` on hand-built lineage generations: readers equal to a flat copy; visibility (fails with origin-only membership); plan test (sparse and populated statistics); a tie case whose order differs between two id assignments today (fails); rollback test 3 | B, BF, down-028 rehearsal, Haystack retrieval tests (shared file) | 14–18 |
| **L5e-2** incremental publication | eligibility, key, State restore, phase W/P from the cut, horizon rule in both paths, region R, versioned switch, tag deltas, retirement | `Models.scala`, `Core.scala` (key), `ProblemPassages.scala` (State codec/restore only; no constant or identity change), `ProblemsPublication.scala` (horizon, validator frontier), `Database.scala` (publication), `IndexCheckpoints.scala` (parent-first lookup), `CONTRACT.md` (horizon rule; shared prefix ids; tie-breaks), `docs/operations.md`, §5.3's oracle, tests | L5e-1 | `IncrementalPublicationDifferentialTest` (fails on its cost assertion); lifecycle cases of `GenerationLineageTest` | B, BF, acceptance H | 18–26 |
L5e runs strictly after L5d and unit ANN; nothing in parallel with them. Eval tooling that reads generation tables
directly (`eval/relevance/workflow_v3.py`, `run_real.py` [o]) sees only own rows of lineage generations: out of scope.
Total ≈ 32–44 h plus run H (≤ 5 h).

#### 5.6.9 Decisions for the orchestrator
| # | question | options | recommendation |
|---|---|---|---|
| E1 | the open passage's pieces when its metadata keeps changing | (a) metadata horizon H = 16 windows in both paths (identical results; rewrite ≤ H windows per revision; pieces deep inside a passage longer than H windows show the summary/tags of H windows later instead of the final ones; GetPassages unchanged; no profile change, no re-index); (b) keep final metadata and accept an exception: such revisions rewrite the whole passage (bound: the session; lag up to a full publication's HNSW time) | **(a)**; F′ counts passages > H windows on the clone |
| E2 | rollback | (a) fail-closed label + restartable `down-028` flattening (server stopped; retires older lineage pins; minutes per million rows + HNSW rebuild); (b) retire and unpublish lineage generations (sessions lose their index until re-published) | **(a)** |
| E3 | tie-breaks | `(session_id, ordinal, id)` in Chronicle's ranking (changes only the order among exact ties; Haystack unchanged); keep `id` and test only on tie-free data | **change** |
| E4 | delivery | L5e-1 then L5e-2 (L5e-1 ships alone: every publication a root, readers lineage-aware); one unit | **split** |
Finding for L5b/ACC (not a decision): each whole re-publication retires the previous generation's search rows; at
≈ 65 ms and 660 KB WAL of VACUUM per deleted row at 640 k rows [m E5], re-publications of A/B-size sessions (D′,
production growth until L5e) imply hours of VACUUM; every inserted search row cost ≈ 120 KB of WAL at `max_wal_size`
1 GB (A′ ≈ 72 GB, B′ ≈ 300 GB of WAL volume for their first index) — ACC should record both; D18's settings matter more.

#### 5.6.10 Review resolutions (advisory review, lead's reviewer)
Round 1:
| item | resolution | where |
|---|---|---|
| B1 retained chunk ids change tie order (lexical leg, rerank ranks, RRF, best chunk per session) | stable tie-break `(session_id, ordinal NULLS LAST, id)` in both paths (shared `rerankCtes` parameter; Haystack default unchanged); only exact ties change today, no profile change; ANN candidate sets stated as approximate in both arms, so the differential test asserts complete candidate sets and compares the same sessions re-published as roots, with exact ties across three sources | §5.6.2 Ranking, §5.6.6 (1), E3 |
| B2 (i) session-long passage ⇒ whole-passage rewrite per revision | passage length is unbounded in the code; metadata horizon H = 16 windows in both paths bounds the rewrite to ≤ H windows of pieces, independent of session size; exact behaviour change, no fingerprint/re-index stated; exception (b) offered | §5.6.1, §5.6.2, E1, run H leg 2 |
| B2 (ii) tags rebuilt per generation, O(passages) | per-lineage counted multiset `ch_lineage_tags`, updated in the switch by the written/superseded pieces' tags only | §5.6.2 |
| B2 (iii) 1,024-origin cap ⇒ periodic whole-session root | removed: versioned segment rows (`since`/`until`, versions assigned at the switch, linear because the switch requires `published = parent`); ≤ 2H+10 segment rows per switch, chain length only adds index depth | §5.6.2, test 2 |
| A: scalar-subquery plan regression | plan test under sparse and populated statistics | §5.6.6 (2) |
| A: pre-028 readers must fail closed | `passage_format = 'ContextAwareProblemsLineage'`: old 011 refuses the start; old readers answer `unavailable`/fail the listing; down-028 restartable per source, tested interrupted, repeated and as a no-op | §5.6.4, §5.6.6 (3) |
| A: D22 independent | detection and acceptance stay with unit ANN; run H does not assert D22 | §5.6.3, §5.6.5 |

Round 2 (B1/B2 resolved; one blocker, three advisories):

| item | resolution | where |
|---|---|---|
| blocker: a root's switch wrote the full tag sets and deleted the previous lineage's tag rows (unbounded, 30 s statement timeout, long locks) | a root builds its `ch_lineage_tags`, `ch_generation_tags` and segment rows in phase P batches with its resume point (invisible: readers follow the published generation's lineage); its switch sets `since = 0` on ≤ 4 rows and `published` (O(1)); the previous lineage's tag rows are queued in `ch_lineage_retirements` and deleted after the switch in ≤ 10,000-row statements; incremental tag changes are staged as deltas and applied by one statement (≤ 16 rows per touched passage); sweeps delete tag rows in bounded statements; test | §5.6.2 "A root", step 3, §5.6.6 (2) |
| partly unchanged R | per-window decision against the current member row; kept windows keep their origin rows, ids and segment rows (rows never re-admitted); segment rows per (origin, kind, range); ≤ H+2 + 3 rows closed and ≤ H+2 + 3 inserted per switch (≤ 42 at H = 16); test with metadata changed / returned / changed at K, K+1, K+2 counting closed and inserted rows | §5.6.2 "Membership of a partly unchanged R", §5.6.6 (2) |
| "no score changes" was wrong | lexical and semantic scores unchanged; hybrid RRF scores of tied candidates (and a session's best chunk or order) can change; both new paths agree | §5.6.2 "Ranking" |
| bound in actual pieces | pieces per window ≤ 64 fragments + (Problem parts − 1), parts ≤ 422 at 64 KiB `maxResponseBytes` → ≤ 485 per window, r ≤ 7,760 at H = 16 worst case, ≈ 1,000 typical (63 per window); run H asserts against the job's own per-window piece counts | §5.6.2, §5.6.5 |

### 5.7 ANN short-result detection and bounded second pass (D22; from unit ANN, built)
Source: `reports/ingest-c/ANN/{design.md,report.md,evidence/}`; **[m ANN]** = that unit's synthetic measurements (owned
PostgreSQL 18.7 + pgvector 0.8.7, production role settings: `work_mem` 4 MB, statement timeout 30 s). Orchestrator
03:22Z: D22 must not be silent — detection, plus a bounded second pass if it costs ≤ ≈ 8 h. Built at the head of the L5
group and shippable alone (§13.2 ANN). This section corrects the starvation threshold of §5.2.5/M5 and adds to D22 (a).
- **Where the leg stops [m ANN §2.2].** The binding limit is scan memory, not `max_scan_tuples`: `work_mem` 4 MB ×
  `scan_mem_multiplier` 4 = 16 MiB ends the strict iterative scan after ≈ 85,000 delivered index tuples (84,947 with
  590,000 invisible rows ahead; `max_scan_tuples` 1,000,000 at the same memory returns the same 84 rows). HNSW does not
  deliver every nearer invisible row, so the shortfall began between ≈ 85,000 (a dense cluster) and ≈ 450,000 (a spread
  set) invisible rows ahead; the robust statement is "more than ≈ 85,000 delivered invisible tuples before the 1,000th
  visible one". Uncommitted, rolled-back and unpublished rows cost the same (120,000 uncommitted nearest + 90,000 hidden:
  948 rows; rolled back: 948). 5.7–8.6 µs per delivered tuple.
- **The condition exists in production today [m ANN §2.3; r deploy4 evidence, read-only SELECTs at 00:31Z].** Without
  any publication, through structured filters: the leg applies them per index tuple inside the bounded scan, so a
  semantic or hybrid search whose filter keeps < ≈ 1 % of the index comes back short with no signal — on 1,000,112 rows a
  1,000-chunk project returned 215 of 1,000 leg rows and 6 of its 10 sessions; 100 chunks: 5 or 1 rows. Production holds
  ≈ 991,000 search rows, so any `project`/`gitBranch`/`tags`/`after`/`before` filter (MCP, CLI `search`) or Archive
  restriction keeping < ≈ 1 % is exposed. Today's largest under-budget publication (84,000 pieces nearer than every
  visible row) kept 1,000/1,000 rows at a leg latency of 59 → 660 ms [m ANN §2.1].
- **VACUUM [m ANN §2.1, §2.4].** 84,000 dead rows of 1.17 M: 712 s unthrottled, almost all in the HNSW pass. When the
  pages holding dead items are < 2 % of the heap, VACUUM bypasses index cleanup and the HNSW keeps the entries (120,000
  aborted rows in 1.49 % of the pages: "index scan bypassed", the leg still 948 rows); at production's ≈ 11 rows per page
  that is < ≈ 19,800 contiguous dead rows per pass [i]. Production's autovacuum (no reloptions before 026) starts at
  ≈ 198,000 dead rows [i]. L5b keeps 026's threshold and does not force index cleanup (§13.2 L5B).
- **Detection [o SemanticLeg.scala; r ANN].** Per leg (Search `ann`; Archive each operand's `a$i`) the page statement
  carries its row count n (`ann_rows`/`ann_rows_i`, semantic and hybrid plans only). n = 1,000 → complete as today, no
  extra work. Otherwise a probe in the same snapshot counts the leg's visible set V (visible sessions with ACL, filters or
  the Archive corpus and restrictions, their published generation, compatible profile), bounded at 20,001; V = n →
  complete; n < min(1,000, V) → short. No false positive: rows that exist and pass the filter were not returned. A full
  leg stays "approximate candidate discovery" as the contract says.
- **Second pass** (`SemanticLeg.complete`; `SemanticLegBudget.production` = 200,000 first-pass tuples, exact limit
  20,000 = `CandidatePolicy.exactScanChunks`, 1,000,000 second-pass tuples, scan memory multiplier 64, 5,000 ms) [r ANN]:
  V ≤ 20,000 → exact scan over the visible set from the source side (8.5 µs per visible chunk, ≤ ≈ 170 ms [m ANN §4.1]);
  else the same leg through the index with `max_scan_tuples` 1,000,000 and 256 MiB of scan memory, in a savepoint with
  `statement_timeout` = least(current, 5 s), the settings restored after; SQLSTATE 57014 → rollback to the savepoint.
  Still short → `Failure("unavailable", "semantic candidates incomplete: the vector index scan ended before it reached
  the nearest matching chunks (index entries being published or not yet vacuumed, or a narrow filter); retry later,
  narrow the filters or use lexical mode")`; hybrid fails as a whole (no silent lexical-only answer); no partial results
  in that residual case. Archive: the whole page comes from one execution, and every leg of the second execution below
  the window is checked again, also one that was full in the first (gate round 2).
- **No wire change [m ANN `compat-cli-decoder.txt`].** A new field or enum value would make the base CLIs (`66fce48e`,
  `361ba170`) reject every search answer (WS and MCP decoders check the exact key set); `unavailable` is the contract's
  code for semantic failures ("search modes never silently degrade"). Dashboard, both CLIs and MCP show the message with
  unchanged code; the MCP `search_sessions` description and CONTRACT.md's search section state it.
- **Measured on the native server** (on demand: `chronicle/scripts/test-ann-budget.sh`) [m ANN report]: 300,100 search
  rows; 220,000 rows nearer than every visible one held uncommitted by 8 transactions: the first pass alone 1 row
  (357 ms); MCP semantic 1.67 s, 50 sessions, top 20 = exact; hybrid 1.84 s; Archive search 2.03 s; the same rows rolled
  back: 1.68 s, top 20 = exact. Even the baseline's project filter (1,000 of 300,100 chunks) needs the second pass
  (0.93 s, exact).
- **Residual and cost.** A short leg's first pass is wasted (≈ 0.6–1.7 s before the second) [r ANN]; the extended pass
  completes up to ≈ 600,000–850,000 delivered tuples in 5 s [i ANN §4.2]; beyond that, e.g. near L5's B-scale P3
  (2.53 M staged rows), the neighbourhood answers `unavailable` while it lasts [i]; not run at that scale (one suite case
  at small scale). Second-pass memory ≤ 256 MiB per query, ≤ 3 GB with 12 connections [i ANN §4.2]. Not built (optional):
  sizing the first pass's scan memory to its own tuple cap (it would change the shared `CandidatePolicy` Haystack uses).

## 6. L6 — replacement WAL and database size (from unit INV)
Source: `reports/ingest-c/INV/section.md` and `INV/evidence/l6/` (per variant `l6-<variant>-{upload.json,walstats.txt,
wal-relations.txt,sizes.txt}`, table `l6-summary.md`).
### 6.1 Setup [m INV]
A second owned cluster with the repository policy (= PostgreSQL defaults: `max_wal_size` 1 GB, `checkpoint_timeout`
5 min, `wal_compression` off, checksums on; production's values not visible [u]). Per variant one 200,000,000-B session
uploaded by the real path as a replacement into a new epoch, then `pg_get_wal_stats`/`pg_get_wal_block_info` over its LSN
range and relation sizes. **words** (U8's filler, not compressible by pglz): 18.4 B/raw B (77 MB/part), database 4.6 ×
(U8 A1: 20.0 B/B); **repo** (texts sliced from this repository): 11.0 B/B (45 MB/part), 2.25 × — inside the clone's
10.9–16.2 B/B, so fixes are judged on it.
### 6.2 Where it goes [m INV]
| WAL | words MB (%) | repo MB (%) |
|---|---|---|
| GIN `ch_epoch_fragments_lower_trgm` | 2,547 (69) | 1,655 (76) |
| — pending list (`Gin/INSERT_LISTPAGE`: each fragment's trigram entries, uncompressed ≈ 12–20 B each) | 1,445 (39) | 584 (27) |
| — merges into the tree (`Gin/INSERT`, `SPLIT`, …; FPIs 427 / 152 incl.) | 1,102 (30) | 1,071 (49) |
| heap (TOAST chunks and tuples of raw, messages, fragments) | 652 (18) | 312 (14) |
| `XLOG/FPI_FOR_HINT` (first hint bit after a checkpoint with checksums; autovacuum of the TOAST tables) | 401 (11) | 158 (7) |
| B-trees | 56 (2) | 42 (2) |
| total (6 checkpoints, ≈ every 15 s) | 3,690 | 2,197 |

Database growth for 200 MB raw (words / repo MB): `ch_epoch_raw` 208 / 82, `ch_epoch_messages` 232 / 111,
`ch_epoch_fragments` 256 / 123 (folded text in 4,096-B fragments with 512-scalar overlap, ≈ 1.14 × text), the trigram
index 207 / 118, `ch_epoch_records` 10 / 13. The text is stored three times (raw, message JSON, fragments) plus its
trigram index; each copy has a reader. **Mechanism:** incremental GIN maintenance through the fast-update pending list
writes each fragment's entries twice — uncompressed into the pending list, then again when a merge (by the inserting
backend once the list exceeds `gin_pending_list_limit`, 4 MB; or vacuum) rewrites every touched page, and a merge
flushes each key after at most `work_mem` (4 MB) of entries, so a key's posting list is rewritten about once per 4 MB of
pending entries. A bulk build of the same index writes 0.22 / 0.17 GB instead of 2.55 / 1.66 GB and is smaller. Pruning
the replaced epoch: 68 MB WAL, 1.2 s per 200 MB (small).
### 6.3 Candidates, same fixture [m INV]
| candidate | words WAL | repo WAL | size | class |
|---|---|---|---|---|
| base | 3.69 / 3.64 GB | 2.19–2.20 GB | 917 / 450 MB | — |
| **pending-list merges in 16 / 32 / 64 MiB batches** (`gin_pending_list_limit` + `work_mem` of the writing transaction) | — | **1.56 (−29 %) / 1.43 (−35 %) / 1.36–1.37 (−38 %)** | index +13 / +26 / +57–88 MB | **cheap + safe: unit L6-G (32 MiB)** |
| only `work_mem` 64 MB / only the list limit 32 MB | — / 3.54 (−4 %) | 2.20 (0 %) / — | = / +33 MB | not worth it alone |
| checkpoint spacing (`max_wal_size` 16 GB, `checkpoint_timeout` 30 min) | 3.00 (−19 %) | 1.94 (−12 %) | = | deployment note |
| 32 MiB batches + checkpoint spacing | — | **1.25 (−43 %) = 6.3 B/B** | +26 MB | L6-G + deployment note |
| `wal_compression=lz4` | 3.59 (−3 %) | 2.14 (−2.5 %) | = | deployment note |
| TOAST `COMPRESSION lz4` | 3.61 (−2 %), size −12 % | 2.27 (+3 %), size +7 % | | not worth it |
| GIN `fastupdate=off` | ≈ 330 B/B; the upload failed its part budget | — | | not worth it |
| bulk GIN build per epoch | GIN 2.55 → 0.22 GB (total ≈ −63 %) | GIN 1.66 → 0.17 GB (≈ −68 %) | index −30 % | costly/risky (§6.5) |

Costs of the 32 MiB batches [m INV]: every probe of the fragment index scans the pending list (≈ 75 µs per page):
≈ 0.29 s added at a full 32 MiB list (0.15 s at 16 MiB) to the archive page query, Find's phase 2 and W2's positions
while the list is full; the part whose insert crosses the limit merges in its transaction — fragment inserts ≥ 500 ms
during a 200 MB upload: 0 (base), 4 with max 0.71 s (32 MiB), far inside the 30 s statement budget.
### 6.4 Design L6-G — batch the fragment index's merges
In `EpochWriter.append` (the only writer of `ch_epoch_fragments`: `/api/ingest` epoch revisions and every part
[o EpochWriter.scala:120-183, Uploads.scala:198]) `SET LOCAL gin_pending_list_limit` and `SET LOCAL work_mem` to one
named constant `fragmentIndexMergeBytes` = 32 MiB (the GUC applies: the index has no reloption; vacuum's merge uses
`maintenance_work_mem`). So that readers do not keep paying a full list between uploads, one `EpochMaintenance` step per
pass runs `SELECT gin_clean_pending_list('ch_epoch_fragments_lower_trgm')` (the service role owns the index; merges with
`maintenance_work_mem`, 64 MB by policy). **Its cost under concurrent uploads (review advisory):** L6-G logs each call's
duration and pages merged; ACC records them in A′ and at clone size in F′ with an upload running; requirement: each call
≤ 5 s and no part statement waiting on it ≥ 5 s (`log_lock_waits`) — the list it merges is bounded by the 32 MiB limit
plus one insert batch (an in-part merge of that size took ≤ 0.71 s [m INV]); above that the step runs only while no upload
attempt is open. No migration, no protocol change, no
re-indexing; rollback = the old binary. **Target:** replacement WAL ≤ 7.5 B/raw B on the repo shape (base 11.0) and
≤ 30 MB per full part (base 45); database within +5 %; search penalty ≤ 0.3 s while an upload fills the list and 0
one maintenance pass after it. With checkpoint spacing as well: 6.3 B/B measured [m INV `l6-r7-*`].
### 6.5 Not now (D18, D19)
Deployment settings (paddock, no code): `max_wal_size` 8–16 GB and `checkpoint_timeout` 15–30 min (−12…−19 % WAL; pg_wal
disk up to `max_wal_size`, longer crash recovery); `wal_compression=lz4` (−2.5 %). Bulk-built trigram index per
replacement epoch (−63…−68 % WAL, index −30 %) needs fragments written outside the indexed relation and indexed at commit
(the commit stops being O(metadata): ≈ 15–25 s per 200 MB) or a table per epoch (the global candidate scan then spans
thousands of indexes): not recommended now.

## 7. Other defects and known limits (U8 findings, ingest-b SUMMARY "Known limits", the units' findings)
| item | verdict | where |
|---|---|---|
| F1 `report-failed` on the direct collector → server path (B passed only through the logging proxy) | **verify**: U7's follow-up gives every request its own connection (`Connection: close` [o collector/src/requests.ts:11-16]) and records a bounded cause [o progress.ts:10-13]; B was never rerun direct. B′ runs direct and asserts `--once` exit 0 and no `report-failed`; a failure names its cause and becomes a defect unit | §9 |
| F2 WAL 11–20 B per raw byte, database ≈ 4.5 × raw | L6 (L6-G −35 % WAL; deployment notes) | §6 |
| F3 collector append O(file) | L2 | §2 |
| F4a CLI 8 MiB frame; F4b CLI prints its own text | **done** by L4 (integrated) | §4 |
| F5 archive literal search scales with the session | L3 (W2) | §3 |
| F6 every switch rewrote older non-Complete jobs | **done** (U4J: only unfinished jobs without a valid lease [o Database.scala:147]) | — |
| F7 windows spent under growth (2.7×) | L5d (I2: D's 236 → 90 windows [i L5]) | §5.4 |
| F8 idle browser socket closed with 1013 after 20 s | not a defect (heartbeat by design) | — |
| MCP `responseFormat: "text"` refuses a result above 128 KiB with `mcp-result-limit` / "JSON byte limit exceeded" and names no alternative [r L4 round 2: McpPresentation.scala:25,32-35, McpText.scala:86-90] | **small optional fix** (scoped out of L4 by the lead): the message names the default `json` format, a smaller `limit` and `read_message_context`; one text change and one backend case (≈ 1 h; the lead or any unit touching `Mcp*.scala`) | — |
| The server's message-page measure ignores wire escaping: a page of control characters answers ≈ 6× its 64 MiB measure (2 GB CLI RSS worst case) [r L4] | **limit** for now (only adversarial content; D9) | §4 |
| A claim holds the source row `FOR UPDATE` while it decodes the revision, so that source's switch waits [i L5: Database.scala:346] | **fixed by L5a** (the claim decodes nothing) | §5.2.1 |
| `publishGeneration` deletes every other search row of the session [o Database.scala:493] | must exclude staged generations — **L5b** | §5.2.4 |
| `upload-bounds.py` `Fixture.filled(start,size)` returns `size − 1` characters when the pieces end exactly at `size`, so `write()` fails its exact-size assertion for some sizes [r INV report] | **fix** in ACC | §9 |
| `test-upload-bounds.sh` header names S1 binary `4f4c941e`; the S1 tip is `7bc75834` (`4f4c941e` is its ancestor; git) | **fix** in ACC (header and A's rollback binary) | §9 |
| `with-service-postgres` stops its child after 3,600 s [o nix/tests/with-owned-postgres.py:18]; U8 B needed a 2-h copy, B′ with indexing needs ≈ 14 h | **fix** in ACC: an explicit, bounded child-timeout argument, refused above its maximum (one cheap interlock test) | §9, D8 |
| The collector's first `--once` over 2,800 new files left 90 "waiting/quarantined" and uploaded them in the next cycle [r INV report, not investigated] | **verify** in ACC (the background upload of A′ records the waiting reasons per file: `quietMs`, partial line, scan budget); a cause outside the documented rules becomes a defect unit | §9 |
| Failed jobs already rewritten to `superseded-revision` by earlier binaries keep that error | **limit** (the old verdict was overwritten) | — |
| Jobs recorded `index-budget-exceeded` (e.g. the owner's 556 MB session) | stay so; `RetryJob` or the next upload indexes them after L5b (no automatic retry, Q122) | D16 |
| Frequent literals: archive page query O(matching fragments) (5 s for a word in a third of a 4.4 GB session) | **limit** (D17) | §3.5 |

## 8. Compatibility and version policy
Wire changes are additive in 1.9.0 (D7 decided; precedent S2's upload API, ingest-b §8); explicit removed/future-version
rejection is unchanged. Regenerate codecs with `chronicle/scripts/generate.sh` and `cli/src/schema-data.ts` with
`cd chronicle/cli && node scripts/schema.mjs` in the same commit. Migrations: 026 (L5b), 027 (L5d), DDL only, each with
a down-script in `chronicle/scripts/` and a rollback to the base binary; L3-W and L6-G need none. No unit may change
`ProblemPassages` constants/identity, the profile descriptor, `IndexCheckpoints.identity`/`key` or
`ArchiveProjection.lexicalVersion`, or insert jobs in a migration (ingest-b §10.2 rule; §5.3).

| change | old client × new server | new client × old server | rollback to the base binary | proof |
|---|---|---|---|---|
| L1 `/api/raw`, `RawManifest`, code `range-not-satisfiable` 416 | base CLI/dashboard: `GetRaw` unchanged (exact below the bound, `too-large` above); the dashboard is served by its server | CLI `raw --output`: 404 without `Failure` → actionable message, exit 6, nothing written | nothing stored | `chronicle/scripts/test-raw-compat.sh` (R2): tree server × base CLI, base server × tree CLI, tree × tree byte-exact |
| L2 spool buckets, observation signature | no wire change | no wire change (S2 protocol) | older collector ignores the buckets; its uploads invalidate the checkpoint (head check) | gate O unchanged; base-spool test (§2.6 (5)) |
| L3 W2 | `ArchiveSearchResult` unchanged | — | nothing stored | identical-evidence tests (§10 L3-W) |
| L4 CLI bounds and failure text | CLI only | the tree CLI against the base server reads the same bounds | — | L4's gates |
| L5 streamed indexing, 026 `ch_staged_generations`, 027 `content_hash` | published rows are of today's kind (same profile, chunk ids, formats) → nothing re-indexed; readers unchanged | — | the base binary ignores 026/027 (its migration list); staged generations stay unpublished and their search rows go at its next publication of the source [o Database.scala:493]; queued large jobs meet its E check again; `down-026` removes staged generations and resets the reloptions; `down-027` drops the column, index and reference table | differential test (§5.3), F′ md5 rehearsal |
| L5 config: `maxIndexingBudgetBytes` per window, `maxSmallJobBudgetBytes` retired | config files keep starting (retired key accepted) | — | base binary reads both with today's meaning | backend config tests |
| L6-G `SET LOCAL`, maintenance step | — | — | nothing stored | L6-G tests |

## 9. Acceptance plan
One acceptance unit (ACC) owns the harness: `chronicle/scripts/test-upload-bounds.sh` + `upload-bounds.py` (U8's,
extended with L5c's indexing assertions), `measure-index-heap.sh`, and the wrapper's timeout argument; on demand.
Common: native server in `serve` with four lanes at the **default bounds** — heap `-XX:MaxHeapSize=6871947673` (the
8 GiB container's native default, 80 %), `maxIndexingBudgetBytes` default (2,147,483,647; per window after L5b),
`maxSmallJobBudgetBytes` retired — deployment limits (`maxFileBytes` 8 GiB, `maxMessages` 2,000,000, `maxRecordBytes`
32 MiB, `maxBodyBytes` 256 MiB, `maxRawReadBytes` default); stub models at 768 d, annotation delay 0 (D: 1 s), stub
vectors as D14 decides; the collector **direct** (no logging proxy; part counts from `ch_upload_parts`) with
`--max-old-space-size=256 --trace-gc`; the CLI under `/usr/bin/time -v`; `-XX:+PrintGC`; the 100 ms `/api/versions`
probe with U8's round-2/3 rules; disk sampler; owned PostgreSQL on `/mnt/dev-data`. Each run reports wall, WAL, disk,
peak live heaps of server, collector and CLI, and every assertion.
- **A′ (1 GiB):** replacement upload; +5 % append through L2 (`lastPass.kind = incremental`, `parsedBytes` = delta,
  collector CPU ≤ 10 s; U8: 49 s); `raw --output` byte-exact (SHA-256 = fixture), CLI peak RSS ≤ 128 MB; a Chromium
  download through the dashboard link, SHA-256 equal, renderer JS heap ≤ 64 MB; Archive lexical search of a rare literal
  ≤ 1.0 s (L3); the job `Complete`, published at the head, a semantic and a hybrid search find the session (L5, default
  heap, no OOM; indexing ≈ 1.8–2.8 h [i L5]); WAL per raw byte of the replacement reported against L6's target (words
  shape: base 20.0–20.4 B/B). Budget ≤ 4 h, ≤ 50 GB.
- **B′ (4.4 GB, records 9.5–20 MiB), overnight:** as A′ with the 4.4 GB fixture: download ≥ 4 GiB byte-exact, rare-literal
  Archive search ≤ 1.0 s and within 0.2 s of A′'s, indexed and found (≈ 7.7 h at K = 4 with uniform stub vectors [i L5]); finding 1: `--once` exit 0,
  no `report-failed`; semantic-search latency during P3 and after the switch until
  `ch_search_chunks`' autovacuum ends, and that vacuum's duration (D22). Budget ≤ 14 h, ≤ 110 GB (U8 B 25.4 GB + 48–56 GB of index rows + WAL margin).
- **Heap-bound run** (from L5c): owner-shape session indexed under `-XX:MaxHeapSize=256m` with E ≥ 8 × heap
  (`measure-index-heap.sh`): completes, no OOM. ≤ 1 h.
- **D′ growth while indexing:** U8 D with L5 (and L5d): ends indexed at its head; windows annotated ≈ head + boundary
  windows (D: 236 → ≈ 90). ≤ 30 min.
- **G (new) growth through the collector:** the 1 GiB session grows by 20 appends of +0.5 % (injected `quietMs`); every
  append incremental, collector CPU per append reported; then a same-length edit of a mid-file line plus an append → (A):
  the next upload is a replacement with `source-prefix-changed`; (B): detected within the stated cycles. ≤ 30 min.
- **E:** gate O (`test-main-collector.sh`) and `test-raw-compat.sh`. ≤ 15 min.
- **L6 record:** `INV/evidence/scripts/l6-run.sh` on the base and the tree binary (repo fixture, 200 MB): ≤ 7.5 B/B and
  ≤ 30 MB per full part. ≤ 1 h for both binaries.
- **F′ clone rehearsal** (TEMPLATE copy only, created and dropped; counts/timings only): md5 of `ch_jobs` (id, state,
  error, fence, revision), `ch_generations`, `ch_index_checkpoints` keys, `ch_owner_targets` before and after starting the
  new binary with 026/027 → equal (no re-index of existing sessions); the five largest heads downloaded through
  `/api/raw` with SHA-256 equal to their stored digests; Archive rare-literal search before/after (L3); one append per
  large session with WAL before/after L6-G. ≤ 2 h incl. the copy.
- Harness fixes: S1 rollback binary `7bc75834` in the header; `Fixture.filled` one character short (INV); the wrapper's
  child timeout argument (D8).

## 10. Unit plan
Ten units plus acceptance. Gates: **B** backend (`test-postgres.sh`), **BF** `.#checks.x86_64-linux.chronicle-backend-full`,
**C** codecs, **K** collector, **L** CLI, **W** web (+ browser), as COMMON.md names them; every unit reports counts and wall.

| unit | goal | owns | depends | tests (failing first unless marked) | gates | h |
|---|---|---|---|---|---|---|
| **R1** L1 wire + server — **started** 01:29Z | `RawManifest`, `/api/raw` routes, `RawStream` windows, admission, contract | `models/chronicle.baboon`, `generated/**`, `cli/src/schema-data.ts` (regenerated only), `scripts/codec-fixtures.mjs`, server fixture `raw-manifest*.json`, `CodecFixtureTest.scala`, new `RawStream.scala` (all window SQL; uses the public `RevisionContent.resolve`/`keyOrdered` and `authorized`), `Http.scala` (routes), `plugins/ChroniclePlugin.scala` (one line), `CONTRACT.md` "Raw downloads", new `RawStreamTest.scala` | base | §1.7 server (1)–(4), fixtures | B, C, BF | 10–14 |
| **R2** L1 CLI | `raw --output`, `raw` without `--revision`, compat script, real-server leg | `cli/src/**` except `schema-data.ts`, `cli/test/**`, `cli/scripts/test-server.*`, `cli/README.md`, new `chronicle/scripts/test-raw-compat.sh` | R1 | §1.7 CLI; `raw ID` without `--revision` (fails today) | L, real-server leg, compat script | 6–8 |
| **R3** L1 dashboard | download link | `web/src/Conversation.tsx`, new `web/src/raw-download.ts`, one browser case | R1 | §1.7 dashboard | W, browser | 3–5 |
| **C1** L2 collector | stat quiet, checkpoints, incremental pass 1, Codex dedup state, `lastPass` | `collector/src/**`, `collector/test/**`, `collector/README.md`, collector paragraph of `chronicle/README.md` | D1 (and D2) | §2.6 | K, `.#chronicle-collector` | 16–22 |
| **L3-W** witness positions — **started** 02:14Z | §3.3 | `ArchiveIndex.scala` (`compile`, `execute`, `PageRow`), `ArchiveSearch.scala` (`ArchiveSearchWitnesses`), `ArchiveSearchTest.scala` | base | (1) "a rare literal's witness reads only its candidate messages": first the seam with `candidates` ignored, then a plan assertion (≤ `maximum` rows, none removed by filter) on a 2,000-message epoch with the literal in the last message — fails with `Rows Removed by Filter: 1999`; (2) guard (passes before and after): evidence equals the scan path's for the late rare literal, a three-hit literal, two operands, a 513-scalar literal, a legacy session; `EpochReadDifferentialTest` unchanged | B, BF | 5–7 |
| **L6-G** batched fragment-index merges — **started** 02:14Z | §6.4 | `EpochWriter.scala`, `EpochMaintenance.scala`, their tests | base | (1) after `EpochWriter.append` inside a transaction both settings equal the constant and the connection's defaults are back after it (fails with 4 MB); (2) after a maintenance pass the test's own `gin_clean_pending_list('ch_epoch_fragments_lower_trgm')` returns 0 removed pages (fails: the list is still there) | B, BF | 3–4 |
| **L5a** streamed source and claim | §5.2.1–5.2.2 | `RevisionContent.scala`, `ProblemPassages.scala` (`Source`), `Database.scala` (claim path), `Core.scala` (`Claim`), `Models.scala` (count/passages call sites), tests | base (R1 stays out of `RevisionContent.scala`) | `StreamedSourceTest` windows from rows = windows from decoded messages, epoch and legacy, a message longer than three windows, runs of empty messages (refactor guard); "a claim decodes no message and the source's switch does not wait for it" (fails today); byte-bounded fetching (§5.2.8 test) | B, BF | 6–8 |
| **L5b** streamed publication and admission | §5.2.3–5.2.8, migration 026 | `Models.scala` (Worker), `ProblemsPublication.scala` (streamed validator; old builder → test oracle), `PassageStorage.scala`, `Database.scala` (publication, `select`, admission), `EpochMaintenance.scala` (sweep), `Core.scala` (config), `migrations/026_staged_generations.sql`, `scripts/down-026-staged-generations.sql`, `CONTRACT.md` "Oversize guards", `docs/operations.md`, tests | L5a, L6-G (`EpochMaintenance.scala`) | `StreamedPublicationDifferentialTest` (§5.3, oracle); `OversizeGuardTest` "a session whose estimate is 50 × `maxIndexingBudgetBytes` indexes, publishes and is found; `RetryJob` of an `index-budget-exceeded` job indexes it" (fails today); `StagedGenerationTest` (a stopped publication is invisible, resumes, a superseded job's staged generation is swept; search during a stopped P3 and after retirement before vacuum, reloptions, §5.2.5); `BoundedRetentionTest` "a 40-window job holds at most one message beyond its window and one statement batch" (fails today); budget tests adapted | B, BF, down-026 rehearsal | 18–26 |
| **L5d** I2 window reuse | §5.4, migration 027 | `IndexCheckpoints.scala`, `Models.scala`, `Database.scala`, `migrations/027_…sql` (+ `ch_index_checkpoint_refs`), `scripts/down-027-…sql` | L5b, D13 | "an append re-annotates only the windows after the previous run's last full window, and the publication equals a fresh run's" (stub call counts; fails today); "a replacement into a new epoch reuses nothing where positions moved"; "two earlier runs hold different valid outputs for one window input: run 3 reuses one, crashes, resumes and publishes exactly the referenced output" (fails with a lookup by content at publication); "a match at another window ordinal of an older run is replayed from its full source key"; "purge of a source whose run references an older run's checkpoints removes every job, checkpoint and reference" | B, BF, D′ | 12–18 |
| **ACC** acceptance | §9 (incl. L5c) | `chronicle/scripts/test-upload-bounds.sh`, `upload-bounds.py`, `measure-index-heap.sh`, `nix/tests/with-owned-postgres.py` (timeout argument + interlock test), reports | all | the runs | the runs, gate O, `nix flake check --no-build`, `scripts/verify chronicle` | 16–22 + runs (A′ ≤ 4 h, B′ ≤ 14 h overnight, F′ ≤ 2 h) |

**Ownership check against the started units** (R1: `RawStream.scala`, `Http.scala`, models/generated, codec fixtures,
`ChroniclePlugin.scala`, `CONTRACT.md` "Raw downloads"; L3-W: `ArchiveIndex.scala`, `ArchiveSearch.scala`,
`ArchiveSearchTest.scala`; L6-G: `EpochWriter.scala`, `EpochMaintenance.scala` and their tests): **L5a collides with none**
(`RevisionContent.scala`, `ProblemPassages.scala`, `Database.scala`, `Core.scala`, `Models.scala`; R1 was steered off
`RevisionContent.scala`/`Database.scala`). **L5b collides with L6-G on `EpochMaintenance.scala`** (L6-G adds the
`gin_clean_pending_list` step, L5b the staged-generation sweep): L5b starts after L6-G has landed. L5b and R1 both edit
`CONTRACT.md` in different sections ("Oversize guards" / "Raw downloads"): R1 lands first, L5b rebases. No L5 unit edits `EpochWriter.scala`, `ArchiveIndex.scala`, `ArchiveSearch.scala`, `Search.scala` or `Http.scala` (D22 option (a)). L5d edits only L5-owned files plus migration 027.
**Parallel:** R1 ∥ C1 ∥ L3-W ∥ L6-G ∥ L5a now (disjoint files); R2 ∥ R3 after R1; L5b after L5a and L6-G;
L5d after L5b; ACC's harness work can start once R1 and C1 have landed, its runs need everything. **Landing order**
(each limit's commits contiguous on `agent/ingest-c`, so any prefix ending at a limit ships): L4 (landed `cf77f7b5`,
`482b5757`) → **L1** R1, R2, R3 → **L3** L3-W → **L6** L6-G → **L2** C1 → **L5** L5a, L5b, L5d → ACC. Small and
independent first; L2 waits for D1; L5 last (largest, migration 026, its own rollback story). Total ≈ 95–135 h plus runs.

## 11. Decisions needed
| # | question | options | recommendation |
|---|---|---|---|
| **D1** | L2 residual window | (A) native prefix hash per upload: none; (B) 1 MiB window + rolling 512 MiB/cycle with the watermark rule: ≤ 2⌈(C−W)/R⌉ cycles after the upload that followed the edit; (C) window + 24 h audit | **A** (≈ 2 % of today's per-GB cost) |
| D2 | L2 Codex incremental dedup | build in C1; leave Codex O(file) (no Codex sessions in the archive [r ingest-b V2]) | build (pass 2 re-reads Codex from 0 today) |
| D3, D5–D7 | L1 bearer access; CLI resume; CLI deadline; version policy | — | **DECIDED** (lead 01:29Z): no bearer; no resume; per-range deadline; additive in 1.9.0 |
| D4 | L1 browser download through the production ingress | plain streamed link (needs an ingress without a total response deadline); + Service-Worker ranged download (+6–10 h) | plain link; the owner checks the paddock ingress before R3 lands |
| D8 | long acceptance runs | wrapper child-timeout argument (max 24 h); split runs | argument (B′ ≈ 14 h) |
| D9 | server page measure counts wire escaping (≈ 6× smaller worst-case answers) | now (`Database.scala`, a page-bound change); defer | defer (adversarial content only) |
| D10 | L5 approach | (a) W keeps checkpoints, P replays into a staged generation; (b) stage pieces/vectors during W, publish by SQL (+≈ 5 KB/piece, SQL must equal Scala's bytes); (c) keep the in-memory path for small jobs | **(a)** |
| D11 | L5 config keys | `maxIndexingBudgetBytes`: keep, meaning one window / retire; `maxSmallJobBudgetBytes`: retired (accepted, no effect) / removed | keep per window; retired |
| D12 | deployment heap | no raise needed after L5b (8 GiB container holds four lanes ≲ 0.3 GB beside one ingest decode); HEAP.md's indexing tables and "≥ 12 GiB for the 556 MB session" become obsolete | confirm |
| D13 | L5 prefix reuse | I2 (L5d) right after L5b / later; I3 defer / minimum interval between publications of one large source / build next | **I2 now; I3 deferred** (a B-size growing session is re-published whole per revision: ≥ 3 h HNSW, lag ≈ 4–8 h) |
| D14 | L5 acceptance budget | A-index in A′ (≈ 2 h) + heap-bound run, B-index overnight with the long wrapper; B-index at reduced scale only; stub vectors: U8's uniform or run C's pool (changes B's HNSW time) | A′ + heap-bound now, B′ overnight; U8's uniform stub vectors (the hard case: B ≈ 8 h of indexing at K = 4; run C's pool ≈ 5.6 h) |
| D15 | L5 publication writers | K = 4 parallel search-row writers (2–3 × one writer [m L5 runs 2, 2b]); K = 1 | K = 4 |
| D16 | after the deploy | large live sessions ended `index-budget-exceeded` get indexed at their next upload by an ordinary job (≈ 2,800 annotation calls for 556 MB, owner shape) — model cost; no back-fill | confirm (Q122 "new ones get indexed") |
| D17 | frequent literals (§3.5) | per-head early exit over a new `btree_gin` index; keep and state | keep and state |
| D18 | L6 deployment settings | `max_wal_size` 8–16 GB, `checkpoint_timeout` 15–30 min (with L6-G: 6.3 B/B, −43 %), `wal_compression=lz4` (paddock) | recommended; owner's call |
| D19 | L6 bulk-built trigram index per replacement epoch | now; not now | not now |
| D20 | indexing time after L5 (zero-delay stub; a real model adds its latency per window) | accept: 4.4 GB first index ≈ 7.7 h at K = 4, every later revision of such a session re-published whole (≥ 3 h of HNSW insertion plus the vacuum of the retired rows, M5; index lag ≈ 4–8 h) until I3; or plan I3 / a minimum publication interval now | accept; revisit I3 if large sessions are common |
| D21 | B′ budget | overnight on-demand run ≤ 14 h, ≤ 110 GB disk, 24 h wrapper; reduced-scale B only | overnight full B′ |
| D22 | ANN scan budget during a large publication (review S4; §5.2.5) | **(a)** staged search rows written last (P3) before an O(1) switch, retirement in bounded statements, autovacuum at 100,000 dead rows; **(b)** search rows after the switch with a fallback generation; **(c)** scan settings — see below | **(a)** |

**D22 options in numbers (round 2).** Pieces per generation vs the 200,000-tuple scan budget: owner's 556 MB session
≈ 180,000 (owner shape ≈ 320 per raw MB [r U8H]), A 600,000, B 2.53 M; today ≤ ≈ 100,000 (budget). Per invisible tuple
≈ 6–8 µs of query time; > ≈ 199,000 of them ahead of the 1,000th visible row → no ANN rows (M5).
- **(a) recommended** (§5.2.4–5.2.5): exposure = P3 (A 11–40 min, B 45 min–2.8 h) plus retirement-to-vacuum (100,000
  clustered rows of a 300,000-row index: 37.8 s; scattered: > 22 min; B scale measured in B′); starvation only for a
  generation > ≈ 200,000 pieces that is not a near-duplicate of visible rows (first index or content-changing replacement
  of a giant session), only for queries its vectors dominate. Lifecycle, readers and rollback as SPEC-L5 designed them.
- **(b)** search rows inserted after the switch, the previous generation kept searchable meanwhile: removes the P3 window,
  not the vacuum window (its retirement leaves the same dead rows). Needs a fill lifecycle of its own (fenced by
  generation, not by the Complete job; a GC that never takes the published generation as garbage; an older filler that
  cannot clear a newer fallback), readers in `Search.scala` and `ArchiveIndex.scala` that carry the generation that
  actually matched (the dashboard's matched view), and a rollback rule the base binary cannot enforce (it would see a
  half-filled generation). ≈ +10–15 h and a reader change in a file L3-W holds; not recommended.
- **(c)** settings: raising `max_scan_tuples` to the staged/dead count costs ≈ 7 µs × that count per affected query
  (≈ 17 s at B scale); `relaxed_order` visits the same tuples; a per-session cap on searchable vectors changes recall for
  large sessions. Not recommended.

## 12. Review resolutions (openai-codex/gpt-6.1-sol)
**Round 1** (advisory):

| item | resolution | where |
|---|---|---|
| S1 a download continued after logout (windows re-checked visibility only) | every manifest and window transaction re-validates the browser credential (`Auth.currentBrowser`: live session, expiry, enabled user, same owner) and visibility; logout-between-windows test (R1 already steered) | §1.4, §1.7 |
| S2 option B's rotation could retire a file without revisiting a block edited before the latest upload | watermark: only a wrap that started after the latest incremental upload retires the file; bound 2⌈(C−W)/R⌉ cycles after that upload; named test sequence. (A) stays recommended | §2.4, D1 |
| S3 fetch size 64 buffered 64 whole values; the one-message estimate was wrong | sizes first (`octet_length`, integers), guard before fetching, values with fetch size 1, large messages (> 8 MiB) decoded under the admission permit; corrected per-message chain ≈ 7T / 2T; test with consecutive 20 MiB messages incl. the count pass | §5.2.2, §5.2.7, §5.2.8 |
| S4 committed staged search rows would consume the live HNSW scan budget | round 1 proposed search rows after the switch; **replaced in round 2** (below) | §5.2.5, D22 |
| S5 I2 publication could replay a different output than phase W accepted | phase W records a per-run reference (`ch_index_checkpoint_refs`, FK `ON DELETE RESTRICT`, output hash); phase P and resume read only own rows or references; two-outputs test | §5.4, §10 L5d |
| advisory: L6-G maintenance clean under load | per-call duration and lock waits logged by L6-G, recorded by ACC in A′ and F′; ≤ 5 s each or the step waits for no open upload | §6.4 |
| decisions | D20 indexing time, D21 B′ budget, D22 ANN isolation added | §11 |

**Round 2** (focused):

| item | resolution | where |
|---|---|---|
| S4 (1)–(4): the fill-after-switch lifecycle had no valid authority, GC could take the published generation, deleted rows still starve the ANN until vacuum, the Archive's matched view and the rollback were wrong | design **(a)** recommended and specified: search rows written last (P3) under the job's authority, O(1) switch, retirement in bounded statements, autovacuum of `ch_search_chunks` at 100,000 dead rows (migration 026), readers and rollback unchanged (no fallback generation, nothing half-published); (b) and (c) laid out with numbers; the residual exposure measured and stated (M5): staged rows only during P3, retired rows until vacuum, starvation only above ≈ 200,000 non-duplicate invisible rows; tests: search during a stopped P3 and after retirement before vacuum | §5.2.4, §5.2.5, §5.3, §8, §10, D22, M5 |
| S5: references lacked the source coordinates; purge and cleanup ordering | full source key in `ch_index_checkpoint_refs`; lookup only among own checkpoints in phase W; P/resume by full key; FK `NO ACTION` so purge's one job delete removes everything together; references cascade with their job; `discard` cannot hit a referenced row; tests: two outputs for one input, cross-window reuse, purge after reuse | §5.4, §10 L5d |

## 13. Implementation amendments (lead, 2026-11-21; the implemented behaviour, where it differs from the text above)
`agent/ingest-c` at `e14f0792` (product code complete), rebuilt in landing order at 04:07Z, so the units' own hashes
(their bundles' `commits.txt`) and the hashes in §4 and §10 differ from the branch's. Ranges are inclusive
(`first…last`, commit count) on the branch, in landing order: this spec `f692ed72`; L4 + MCPX; L1 (R1, R2, R3); L3; L6;
L2; merge of `main` (`93ef248d`); ANN; L5A; L5B; L5D; L5E1; L5E2; then DIAG and E1X interleaved (`c094c1ca`, `1f52b9e0`
DIAG; `67a860de`, `cd2e8f4f` E1X; `c67dcf4b` DIAG; `90ff5cea`, `e14f0792` E1X). **[r U]**/**[m U]** = reported/measured
by unit U (bundle `.local/overhaul-20261117/reports/ingest-c/<U>/report.md` and `evidence/`); lead log
`reports/ingest-c/LOG.md`; orchestrator decisions `reports/ingest-c/ORCH-REPLY-0322Z.md`. This section wins over the
earlier ones; in particular §13.2 E1X changes §5.6's E1 default.

### 13.1 Orchestrator decisions after the spec (`ORCH-REPLY-0322Z.md`, all sections; binding)
- **03:22Z.** D1 = (A), with a test: an in-place edit of an old line is detected at the next upload → replacement. D10,
  D11 approved (`maxSmallJobBudgetBytes` accepted and ignored, CONTRACT/README, logged once at start when set). D12 "no
  heap raise needed" into the deployment notes with the measurement. **D13/D20: build I2 (L5d) and I3** as the last unit
  L5e (own spec section and advisory review before it starts; own acceptance: a growing ≥ 1 GiB session, work and lag
  per revision ∝ the addition, search results identical to a full re-publication by a differential test); L5a → L5b →
  L5d shippable without L5e. **D22 not silent:** a short ANN leg is detected and said explicitly (dashboard, CLI, MCP),
  tested at ≥ 200 k invisible vectors; a bounded second pass (iterative or exact over the visible set) built if ≤ ≈ 8 h,
  else numbers; plus bounded retirement and the autovacuum threshold; (b) not now; measure whether the condition exists
  in production today. D16 yes. D4: the plain link and CLI `--output` (gateway: no body limit, 60 s upstream
  response-header timeout, `reports/deploy4/PREP.md`), no Service Worker. D8/D21: B′ overnight with the harness timeout
  argument, not blocking — the prefix L4, L1, L3, L6, L2 integrated and verified first as its own contiguous prefix. D17
  keep and state in the limits with its number. D18 WAL settings as owner/paddock items; acceptance at production's
  settings (`max_wal_size` 1 GB). The MCP 128 KiB text refusal fixed (unit MCPX).
- **≈ 05:45Z (L5e).** E2, E3, E4 confirmed. E1 (16-window horizon) confirmed on condition that a controlled relevance
  comparison runs before L5e is done: baseline (final summary/tags on every chunk) vs horizon on one corpus and
  configuration, the repository's relevance workflow on isolated real servers, cases hitting passages > 16 windows plus
  held-out ones, metrics declared first, evaluator ground truth separate from the search agent's task, the provider
  stated; a regression beyond noise → stop and report, no tuning to development cases. Deployment notes: existing
  published generations keep final metadata until a session's next revision (no back-fill); both forms coexist. (E1's
  default superseded at ≈ 19:40Z.)
- **≈ 07:20Z.** REL's local model run approved for the controlled comparison only: one GPU with no other process and no
  allocated memory at start (`nvidia-smi` before and after), expected duration stated, cap 6 h, stop at any foreign
  process on it; models only from a local cache or an approved internal registry; no session or clone content leaves the
  host; no external model APIs; GPU freed and model servers removed at the end; the provider of every number stated.
- **16:16Z.** The IndexedSearchTest failure on `9440bb62` is not accepted as load-sensitive without a diagnosis: failing
  statement, cause and SQLSTATE from the kept log and what its 41.7 s consisted of; EXPLAIN (ANALYZE, BUFFERS) of the
  test's production statements on `9440bb62`, `0296ee28`, `4dfd4f48`, same data, side by side; the test alone 10× idle
  and 10× under stated comparable load per tree; only `9440bb62` degrading → regression, fix in L5E1/L5E2; `9440bb62`
  "verification failed (open)" until resolved; final verification only on a quiet host (→ unit DIAG).
- **≈ 18:55Z.** Conditions for the fix: (1) visibility equivalence, checked explicitly by the gate reviewer and by tests
  — no rows of staged generations, retired generations, outside the read version's membership interval or of unreadable
  sources, on the lexical, semantic (incl. the exact and the wider second pass) and literal paths; (2) a creep-back
  guard: a plan-shape pin of the authorization or a buffer bound against the base in the same run, no wall clock; (3)
  stage-file numbers on the final head: control, generic HNSW buffers, 10× under 1.7× load for `4dfd4f48`, `0296ee28`
  and the fixed head, 10× quiet after B′; the limits list says whether the control's ≈ 16 s of 30 s is a test-data or a
  product property.
- **≈ 19:40Z (E1 changed).** (1) Default = exact final metadata (`indexing.metadataHorizonWindows` = MAX); a finite
  horizon only as an explicit opt-in, the owner decides later with real numbers; spec, CONTRACT/README, DEPLOYMENT-L5
  and the L5E2 gate adjusted, L5e acceptance at the default (→ unit E1X). (2) Quantify the default's cost on a TEMPLATE
  clone copy (read-only): passage length in windows p50/p90/p99/max, how many > 16 windows and in how many sessions,
  per-append publication work in exact mode at p99 and max, the degenerate case (one passage = the whole session);
  limits list: "append cost follows the addition except within a passage longer than N windows" (→ unit CLONE). (3) REL
  real models approved with conditions: production's annotation and embedding models established from on-disk evidence
  first (if the manifests differ, say so and also run with production's embedder); only hash-listed downloads, verified
  against `chronicle/model-manifests` before loading, into scratch, no token, no upload; `trust_remote_code` only for
  the two verified files; offline loopback servers, minimal environment, the controlled corpus only; GPU conditions as
  before; weights and servers removed; the provider per number. (4) Report per case class (E2, C, natural questions,
  semantic control) baseline vs H = 16 with intervals, and the savings of item 2.
- **≈ 20:30Z (REL conditional).** A real-model comparison only if the clone measurement shows that the exact default
  costs materially (criterion stated with numbers); if passages > 16 windows are rare, the horizon is recorded as
  "opt-in, effect on real-model relevance not measured; scripted mechanism result only" in spec, CONTRACT and limits,
  and REL closes. Were it to run: Tokenfactory/DeepSeek + embeddinggemma-2 on the frozen synthetic corpus only, the
  credential only through a path the relevance workflow documents and already provisioned for this user on this host,
  never printed. The model-manifest finding goes into SUMMARY/DEPLOYMENT, no fix now (§13.4).
- **21:45Z.** The exact second pass's leftover read of `ch_generations` per visible session (≤ 20,000 rows, +22 %
  buffers): remove it with the same technique if contained and covered by the visibility tests, or list it with its
  measured absolute cost — not silently (→ removed, `c67dcf4b`). One note when B′ and the quiet runs are in.
- **22:30Z.** `IncrementalPublicationDifferentialTest:434` is a product question until shown otherwise: dump and diff
  incremental vs full for the failing case in that grouping, or prove isolation; a defect → fix and regression;
  isolation → fix the isolation without loosening equality; `agent/ingest-c` "verification failed (open)" until then (→
  E1X: a plan choice, results equal, `90ff5cea`). DEPLOYMENT-L5: B′'s write volume (385 GB of WAL for one 4.4 GB
  session) and peak disk (107.4 GB) as sizing facts next to production's WAL settings; the expected first-index time and
  WAL of a ≈ 0.6 GB session.

### 13.2 Per unit
- **L4** (`9e10f9b4`…`52475354`, 2; §4's `cf77f7b5`, `482b5757` before the rebuild): as §4 [r L4]. With P = 64 MiB (the
  server's page bound): WS answers ≤ 6P + 1 MiB = 403,701,760 B, MCP responses ≤ 7P + 1 MiB = 470,810,624 B, other HTTP
  responses 8 MiB, requests unchanged; above the bound WS refuses the frame from its header (reported as a lost
  connection or an answer above the bound, exit 6) and MCP answers `too-large` from `Content-Length`. Gate round 2 masks
  every secret the request carried, the login password included (`RequestOptions {responseBytes, secrets}`). The MCP
  text-format cap went to MCPX.
- **MCPX** (`808b3d53`, 1; landed with L4): §7's optional fix [r MCPX]. Code `mcp-result-limit` and the 131,072-B cap
  unchanged; the refusal names the cap, the tool and only that tool's working alternatives — the json/default format
  first, then per tool a smaller `limit` with `offset` (or `afterTag`), `get_chunks` for `get_session`,
  `read_message_context` byte windows for `get_messages` — from `Mcp.textAlternatives`; building `Mcp` fails
  (`mcp-catalog`) for a tool without an entry. CONTRACT.md unchanged (no sentence covers the refusal). Reason: not every
  tool takes `limit`/`offset`.
- **R1, L1 server** (`6f43ddba`…`6d3b1cb4`, 4) [r R1]: all raw SQL in `RawStream.scala` (`RevisionContent.scala`,
  `Database.scala` unchanged; lead's ownership change); `RawFileInfo.bytes` is a decimal string on JSON (i64), a bigint
  in TypeScript; every path under `/api/raw` answers a `Failure` (unknown sub-paths, other methods and HEAD: 404
  `not-found`); an applied range always answers 206, also when it covers the whole file; 416 also for `bytes=-0` and any
  range of an empty file (RFC 9110: no `Content-Range` for zero bytes); LAST < FIRST compared exactly at any number of
  digits → 400 (gate round 2: saturation first had made it 416); `Range` syntax is checked before `If-Range`, several
  `Range` or `If-Range` headers → 400; check order boundary → cookie → path → `Range` → permit (503) → pin (404) →
  `If-Range`/satisfiability (416); "bytes sent = range length" holds per window (exact length and contiguity); window
  memory ≈ 4 × the window transiently (§1.4 said ≤ 3 × [u]); the permit is returned by the body's finalizer, which Ember
  runs also for a client gone before the head. Measured: 1.1 GB byte-exact in 13.96 s; four concurrent downloads, live
  heap after a full collection ≤ 57.8 MB [m R1].
- **R2, L1 CLI** (`04615001`…`0c87fa03`, 4) [r R2]: result `path` = the absolute local destination; an old server → code
  `version-mismatch`, exit 6, §1.5's text verbatim; **bounded 503 retry** (lead's addition, gate round 2): a range
  answered 503 `unavailable` with a delta-seconds `Retry-After` is requested again after min(`Retry-After`, 30 s),
  announced on stderr, at most `RAW_RANGE_ATTEMPTS` = 5 requests per range, then the download fails as before (partial
  removed); a 503 without `Retry-After` fails at once; the manifest is not retried. `--timeout-ms` bounds the manifest
  request and, per range, the fetch, the body and every sink write (a stalled stdout consumer ends with `deadline`); the
  partial file is created synchronously after the SIGINT/SIGTERM/SIGHUP handlers are installed (both gate round 1);
  `--output -` is refused on a terminal; `Accept-Encoding: identity`; an empty file is saved without a range request; a
  minor V8 collection every 2 MiB (`--expose-gc` set at run time): peak RSS 166 MB without it, 106–110 MB with it
  (target 128 MB) [m R2]. Reason: the review (hang, signal window) and the lead (a 503 between ranges aborted a long
  download).
- **R3, L1 dashboard** (`8ad15d36`…`021d5d56`, 2) [r R3]: "Download (size)" for one file, "Download file i of n" with
  the path below it for several (unique accessible names); binary units with the exact bytes as tooltip; states as muted
  status text (checking, not available, the server predates raw downloads, unavailable with the server's message,
  invalid manifest); the manifest is read each time the Info pane is shown (never before, never cached). No real-server
  browser leg in the unit; ACC's prefix run downloaded 4.44 GB through the link byte-exact at 8.1 MB page JS heap [m ACC
  `ACCEPTANCE-prefix.md`].
- **L3W** (`f16eb9ba`…`26e18407`, 2) [r L3W]: the head's epoch and message count are looked up per page row
  (`ch_revisions` by primary key inside the page SELECT), not by a `LEFT JOIN` in `corpus` (`corpus`, `browse` and
  `page.*` unchanged); operands without candidates share one scan branch; positions are a constant `int[]` in the SQL
  text (a bound text-cast array made the planner scan the epoch: `Rows Removed by Filter: 1999`); the
  `literal_positions_<i>` columns are excluded from the page's 64 KiB read budget (gate round 2: pages that fit on the
  base failed `read-budget`) and bounded by construction (≤ 16 operands × 11 rows × 2). Operands with fewer than two
  trigrams, legacy heads and non-current epochs keep the scan (a short operand: 5.6 s at 1 GiB) [m L3W]. Measured: rare
  literal at 1 GiB, CLI 3.9–4.7 s → 0.40–0.44 s, witness ≈ 4 ms, results byte-identical for 11 queries [m L3W]; 0.42 s
  at 1 GiB and at 4.4 GB [m ACC prefix].
- **L6G** (`92e5e574`…`361ed9f8`, 3) [r L6G]: the 32 MiB `gin_pending_list_limit`/`work_mem` apply only while
  `pg_class.reltuples` of `ch_epoch_fragments` ≥ `EpochWriter.fragmentIndexMergeMinimumFragments` = 400,000; below it
  the writer keeps the base's 4 MB. Reason (lead, gate round 1): with a full 32 MiB list the planner switches lexical
  probes to a sequential scan on small fragment tables — switch between 120,000 and 160,000 fragments, dashboard Archive
  +0.83/+1.11 s (rare/common literal) at 120,000; 400,000 is 2.5 × the first size that kept the index [m L6G round 2].
  WAL at production's `max_wal_size` 1 GB with an 870 MB trigram index (1.36 M fragments): **−16…−18 %** (≈ 12.0–12.3 →
  10.0–10.1 B/B), not §6.4's −35 % and ≤ 7.5 B/B: full-page images of GIN pages dominate on a large index; below the
  threshold (a fresh database) as the base [m L6G]. One-time ≈ +30 MB of index size accepted (+0.8 % of a 3.7 GB
  database). The maintenance merge took 0.51–1.02 s while an upload wrote (at most 1.35 s), so no extra bound; a
  writer's own merge ≤ 1.19 s; the settings are set to the constant (not the greater of it and the role's value).
- **C1, L2** (`863a1e9f`…`c061b252`, 3) [r C1]: **Codex files always take the full pass** (`lastPass.reason =
  codex-full-pass`; no Codex checkpoint, no `codex-dedup` bucket, pass 2 re-reads Codex from 0 as the base did): D2's
  incremental dedup was built and withdrawn in gate round 2 (a lost acknowledgement plus cleanup promoted a delta-only
  checkpoint; event keys bypassed the dedup cap; checkpoint rows outlived the scan) — a documented Codex-only limit, no
  Codex sessions in the archive. Every fallback is the full pass, which plans a replacement only when the head's prefix
  is not intact, with a reason in `--status --json` `sources[].lastPass {kind, reason, parsedBytes, hashedBytes, at}`
  (`no-checkpoint`, `checkpoint-version`, `checkpoint-invalid`, `head-moved`, `upload-queued`, `policy-changed`,
  `limits-changed`, `file-replaced`, `not-grown`, `source-prefix-changed`); only `source-prefix-changed` is also a
  diagnostic. The full pass computes the raw digest with the resumable JS SHA-256 instead of the native one: +3–7 %
  (§2.3 estimated +17 %) [m C1]. +5 % on 1 GB: 6.59 s CPU, 28 s wall (base 45.7 s, 65.7 s) [m C1].
- **ANN, D22** (`19044542`…`4dfd4f48`, 4; head of the L5 group, no migration, shippable alone): §5.7. Against §5.2.5 and
  D22 (a): detection and the bounded second pass are added; the first pass's real limit is ≈ 85,000 delivered tuples
  (scan memory), not ≈ 199,000; the condition exists in production today through narrow filters (215 of 1,000 rows, 6 of
  10 sessions) [m ANN]. Out of ownership: one `ChroniclePlugin` binding, `McpSourceBoundaryTest`'s expected columns.
- **L5A** (`8627b4a5`…`01734dad`, 2) [r L5A]: values are fetched in runs of consecutive messages up to
  `StoredMessages.runBytes` = 1 MiB of text per statement (a longer message alone; sizes first, 64 per batch) instead of
  fetch size 1 (fewer round trips, the same one-row bound for large values); a message above 8 MiB waits for the
  `SnapshotAdmission` permit with **no transaction open** and is read in its own transaction once admitted (gate round
  1: the 60 s idle-in-transaction timeout); claims no longer take the permit (they decode nothing); `RevisionBinding`
  also binds the reader's identity. Transitional, removed by L5B: the claim-time `retainedEstimate` and a re-read
  validation before the publication transaction. Each pass reads and decodes at ≈ +45 s/GB [m L5A].
- **L5B** (`4f55f5a4`…`894f0933`, 6; migration 026) [r L5B]: (1) **rollback needs `down-026` before the previous
  release** (§5.3 and §8 said "no preparation"): that release publishes a job's run with plain inserts, and a staged
  generation of the same run holds those chunk ids → 23505 → `worker-fault` on every attempt until the source's next
  revision (rehearsed); order: stop the server, `down-026`, then `down-025`, `down-024` for older binaries; `down-026`
  runs in one transaction. (2) P transactions do not take the job row `FOR SHARE` (four writers' overlapping share locks
  would starve the lease renewal's `FOR UPDATE`): each checks `validJob` and locks the staged row (`FOR NO KEY UPDATE`
  for P1/P2 batches, `FOR SHARE` for P3 writers), and checks its claim after that lock is granted (pre-review 2). (3)
  026 also creates `ch_generation_retirements(generation, payload)`: the switch records the replaced generation; the
  worker after the switch and the maintenance pass delete its search rows by keyset over its chunk ids, 10,000 per
  statement (`payload`: an explicit rebuild's derived rows — `ReindexCohort.published` no longer deletes inside the
  switch). (4) The switch is all or nothing (a savepoint rolled back unless the job's completion updates one row). (5)
  Abandoned staged generations are marked (`run_id = generation`) under the job row's share lock, then deleted; P0
  deletes its job's abandoned generations first (a `RetryJob` keeps its run, so its chunk ids collide). (6) A changed
  `embeddingBatchSize` marks the staged generation `invalid`: P2 deletes and rewrites every staged chunk. (7) Validation
  runs over the replayed windows' fragments with a carried frontier (no extra read of the messages). (8) K = 4
  search-row writers per process (one semaphore; the pool has 8 connections), not per publication. (9) 026's autovacuum
  threshold kept, index cleanup not forced (§5.7 VACUUM). (10) `maxSmallJobBudgetBytes` parsed (> 0 when present), no
  effect, logged once at start; `VectorArena` deleted; `BoundedRetentionTest` folded into `OversizeGuardTest`. Measured:
  a 1 GiB session with E = 6.57 × the default budget (refused at the claim before) indexed at the default 6.4 GiB heap
  bound, peak live heap 34.8 MiB, 2.32 h (W 72 min, P1 ≈ 5, P2 33, P3 27 min); 026 ≈ 6 ms on 612,150 search rows [m
  L5B].
- **L5D, I2** (`7782fc82`…`0296ee28`, 4; migration 027) [r L5D]: (1) **a confirmed owner rebuild reuses nothing**
  (force-fresh, final round): a run that is a rebuild-cohort member (`ch_reindex_members`) calls the models for every
  window, also into an unchanged profile, and still resumes from its own checkpoints; **`RetryJob` of a Complete job is
  a cached republication** (every window reused, no model call); CONTRACT.md and the rebuild confirmation
  (`web/src/OwnerReindex.tsx`) say so. Reason: an operator must be able to replace accepted annotations. (2)
  `ch_index_checkpoint_refs` also stores `input_hash` (the reusing run's key input): a resume under another embedding
  grouping raises `CheckpointInputMismatch` and re-embeds. (3) The claiming run's own checkpoints are never candidates;
  `discard` also deletes the run's references at that window. (4) Embedding parts are reused wherever the texts are
  equal (positions may move), decisions only where source and positions are equal. (5) Lookup order: the published run's
  accepted work — its own rows or the rows its references name (pre-review) — then the newest revision's job, then key
  order. (6) Rollback is not DDL-only: `down-027` first copies the references of jobs that are not Complete into own
  checkpoints; order `down-027` → `down-026` → …. (7) Read and lookup in one transaction per key. Measured: U8 run D 236
  → 90 annotation calls; 1 GiB + 1 % append: 97 of 9,661 windows annotated, job 2.41 → 1.98 h (phase W −58 %,
  publication +27 %: every revision is still published whole until L5E2) [m L5D].
- **L5E1, I3 part 1** (`07008dac`…`9440bb62`, 2; migration 028): §5.6 unit "L5e-1" [r L5E1]. Roots write open-ended
  segment rows (`[0, ∞)` per kind) and a lineage row without `last_window`/`cut` (the `State` codec is L5e-2's; a root
  without a cut is no parent); pages are ordinal ranges for every generation; 028 re-adds 008's composite foreign keys
  `NOT VALID` when missing; tag counts are counted per chunk inserted in P2; retiring a replaced lineage also queues its
  generations' search rows; a generation staged by a release before 028 is published as staged (no lineage). Gate round
  2: a generation without a version reads as its own rows and tags, and a root that a release before 028 continued (no
  `lineageTags` mark in its resume point) is published without a lineage; index `ch_lineage_segments(origin, lineage,
  kind, since)` for purge's foreign-key checks. `down-028` beyond §5.6.4: restores 011's check, deletes staged lineage
  generations, commits per source and resumes, drops and rebuilds vector indexes and foreign keys only when a source
  needs flattening. Rollback: with roots only the L5d binary starts without `down-028` (rehearsed, also with a root it
  continued); once a lineage version exists it refuses to start until `down-028`. The plan test asserts a probe
  correlated on lineage and origin; the `EXISTS` form is not planned as a hashed ANY in this layout (the scalar form is
  kept). Tie-break `(session_id, ordinal, id)` (E3); Haystack's SQL byte-identical. Its per-row authorization raised
  search cost: DIAG below.
- **L5E2, I3 part 2** (`b6e9e243`…`e3cb0374`, 4; no migration of its own: three indexes added to 028) [r L5E2]: §5.6
  unit "L5e-2"; E1X changed its default afterwards (below). Eligibility (`PostgresArchive.publicationParent`, checked
  before the count pass, at P0 and at the switch): `indexing.incrementalPublication`; the published generation has a
  lineage, a version and a cut whose horizon equals the configured one, the claim's profile, not retired; both are epoch
  revisions of one epoch with non-decreasing message counts; the claim's run is not a confirmed rebuild's (a rebuild
  always publishes a root) and no rebuild retirement would fire; otherwise a root. Every lineage publication's last P1
  batch writes the cut (window K, the `State` before K, the Context-span count, the validator's snapshot, window
  boundaries; a few KB), so roots have one now (L5E1's cut-less roots, never deployed, are no parents). Deviations: (1)
  the incremental generation's own segment rows are written by its switch, not staged at P0 (which windows of R are
  rewritten is known only in P2); O(H) rows per switch, 4 closed / 6 inserted measured at H = 16. (2) P2 replays twice
  (H windows ahead) instead of buffering pieces: one window of memory for any H (since E1X only under a finite H). (3)
  The cut carries its horizon; a lineage continues only under the same H. (4) The reuse lookup (§13.2 L5D (5)) ranks
  first a candidate the published lineage accepted — its run a version of that lineage, or the lineage's root referenced
  it — by two index probes per candidate (pre-review B1; review round 3 replaced a ranking over every referrer, O(V)
  after V versions: 2,003 → ≤ 40 rows examined). (5) The tail reads (switch, region R's members, replaced tags) go
  through the new partial index `ch_lineage_segments_open(lineage,kind,hi_major,hi)`: ≤ 12 segment rows examined with
  16,000 history rows (the version-validity selection: 18,402) (B2); 028 also gains `ch_generations_run` and
  `ch_index_checkpoint_refs_referrer` (down-028 drops them). (6) A staged publication continues only under the parent
  and horizon it was staged with; otherwise it is abandoned and restarts (B3). (7) Staged tag deltas are applied and
  deleted inside the switch (≤ 16 rows per touched passage). (8) The keys are validated at start
  (`IndexingCapacity.validatePublication`) and logged once: `indexing publication incrementalPublication=…
  metadataHorizonWindows=…`. **Disclosed read limit:** page and pin readers select a version's segment rows by validity,
  O(H·V) rows for a lineage of V versions. Measured at H = 16 (the then default; 1 GiB + 10 appends of 0.5 %, a stub
  summary changing every window): root 9,972 s and 51.9 GB WAL; each append ≈ 4,050 chunks and search rows (R = 960),
  0.35–1.02 GB WAL, job 78.6–92.7 s, flat over 10 versions [m L5E2].
- **DIAG, IndexedSearchTest regression from L5E1** (`c094c1ca`, `1f52b9e0`, `c67dcf4b`, 3) [r DIAG]: the failure on
  `9440bb62` was a regression of L5E1's per-row search authorization, which joined `ch_generations` for every candidate
  tuple (and the page view for every ranked session). The test's index-disabled control `EXPLAIN (ANALYZE)` crossed the
  30 s statement timeout (SQLSTATE 57014, reported `database-unavailable`; 41.7 s = corpus ≈ 11 s + plans < 0.3 s +
  control cancelled at 30 s). Same 12,000 rows: control 15.8–16.4 s on `0296ee28`/`4dfd4f48` vs 22.0 s on `9440bb62`;
  generic HNSW page buffers 14,747 → 23,743; a broad lexical page at 48,000 rows +78 % buffers; under ≈ 1.7× load 0/10
  vs 10/10 [m DIAG]. **Fix** (product code, no test change): a row of the published generation itself is authorized
  through `ch_revision_info` at (session, the row's revision) as before 028; only a row of another origin joins
  `ch_generations` and runs the unchanged membership probe (`GenerationRows.publishedInfo`, a gated `UNION ALL`); the
  tag filter reads the published generation's tags; the page joins the view for its ≤ limit hits only; Archive's corpus
  carries `lineage, lineage_version`. Control 15.4 s, HNSW buffers 14,858, 10/10 under 1.7× load [m DIAG]. **Visibility
  equivalence** (≈ 18:55Z): argued row by row (the own-row branch is equal because a search row's revision is its
  generation's; the other-origin branch is the old join and probe verbatim) and tested in `GenerationLineageTest`: no
  lexical, semantic (index, wider and exact second pass), hybrid or Archive (semantic, hybrid, literal) path finds a
  staged, retired, superseded or unreadable row; it passes on `9440bb62` and on the fix, and five mutants fail it.
  **Plan guard** (no wall clock): per-relation execution counts from EXPLAIN ANALYZE — `ch_generations` ≤ legs ×
  other-origin rows + page limit, `ch_lineage_segments` ≤ legs × other-origin rows, Archive ≤ 2; `9440bb62` fails it
  (634 against 32). **Exact-pass leftover removed** (21:45Z, `c67dcf4b`): the exact second pass and the visible count
  read the published revision the same way; 124 ms / 141.7 k buffers, before 145 ms / 201.7 k, base 105 ms / 161.6 k
  (`LOG.md` 22:22Z); the guard covers the exact pass. The control's ≈ 16 s of 30 s is a test-data property (O(rows²)
  with index scans off: 3,000 rows 0.95 s … 24,000 rows 58.4 s); the production statements grow linearly (lexical page
  matching every row ≈ 8 µs per readable row) [m DIAG].
- **E1X, exact final metadata by default** (`67a860de`, `cd2e8f4f`, `90ff5cea`, `e14f0792`, 4) [r E1X]; amends §5.6.2
  and §5.6.9 E1 (≈ 19:40Z, ≈ 20:30Z): `indexing.metadataHorizonWindows` defaults to 2,147,483,647 — every piece carries
  its passage's final summary/tags, results identical to a full re-publication, as before ingest-c; any value
  1..2,147,483,647 is valid with incremental publication (L5E2's "≠ 16 requires `incrementalPublication=false`" is
  gone); a finite H is an operator **opt-in: "effect on real-model relevance not measured; scripted mechanism result
  only"** (CONTRACT.md, README.md, `docs/operations.md`). Every lineage publication writes a cut whose window boundaries
  cover max(K − H, the window the open passage B opened in)..K; region R = B's pieces in those windows, decided per
  window by one probe of its first member piece; under the default an append rewrites all of B's earlier pieces when B's
  final metadata changes, else none (texts, spans and vectors copied, not re-embedded). A changed H makes each session's
  next publication a root (staged publications restart). P2's second replay runs only under a finite H. **The
  open-passage limit (by design):** append publication work = the addition plus the passage still open at the cut;
  clone: p99 20 windows / 1,210 pieces, max 64 windows / 3,858 pieces [m CLONE `PASSAGES.md`]; nothing bounds a
  passage's length; the degenerate case (one passage = the whole session, its summary changing every window) rewrites
  the session at every append — at 1 GiB ≈ 612,000 pieces, about a root's publication (74 min, ≈ 52 GB WAL) [i E1X, from
  the root's measurement]; on the clone whole-session rewrites happen only in sessions ≤ 42 windows [m CLONE].
  Pre-review: fragmented open passages made the rewrite's membership reads quadratic → bounded range scans and point
  lookups (145 runs in 19 windows: 163 / 163 / 19 rows examined, the reviewed form 1,387 / 1,387 / 145). **Line-434
  failure** (22:30Z): `IncrementalPublicationDifferentialTest:434` failed deterministically in `test-postgres.sh`'s
  grouping ("first pieces 21" > 19 windows) — a plan choice, not a defect: a join order `unnest ⋈ ch_chunks` without
  Memoize repeated the per-ordinal segment lookup for another generation's chunk at the same ordinal; every compared row
  and reader answer dumped, incremental vs full, identical in 7 runs (1,511 = 1,511 rows, 40 = 40 answers); fix
  `90ff5cea`: the lookups sit in materialized CTEs (19 examined in every plan), the result equality is asserted before
  the bound, no comparison loosened. Measured at the default (1 GiB + 10 appends of 0.5 %, a stub summary changing every
  window): 3,095–4,428 chunks per append (1.20 × the added pieces), 0.32–0.99 GB WAL, job 50–89 s (151 and 202 s with
  gate runs on the host), nothing growing over versions; a 211-window passage whose metadata changes is rewritten whole
  at each append (13,440–14,016 pieces, 0.56–0.83 GB WAL), only the tail once it closed [m E1X].

### 13.3 User-visible changes (L5 group)
Wording of `reports/ingest-c/DEPLOYMENT.md` "User-visible changes (L5 group)" (its paths are relative to
`reports/ingest-c/`):
- **Ordering among results with exactly equal scores changes** (E3 tie-break: ties now order by session, ordinal, id instead of chunk
  id; existing rows have no ordinal, so they tie on session and id). On the production copy (clone) 2 of the top 10 differed for 1 of 4
  hybrid queries, another query reordered ranks 7–11 inside one exact-distance tie class, and one total went 487 → 488. Why a total can
  change: each leg keeps a fixed candidate window (LIMIT 1,000); for that query 680 lexical candidates had exactly equal scores across
  the cutoff and only 34 fit, so the new tie order swapped 3 of them, bringing in one more session. Verified, not assumed: for that
  query the semantic leg's candidate set and order were identical, and the lexical leg's set differed only by those 3 rows, all inside
  the tied class at the cutoff; lexical scores and distances of common rows were identical (`CLONE/HYBRID-DIFF.md`, `compare-q1..4.txt`).
- Large sessions (previously `index-budget-exceeded`) get indexed at their next upload or on retry; semantic/hybrid search may return
  `unavailable` (instead of silently short results) when invisible vectors crowd the candidates beyond the bounded second pass.
- Rebuild = fresh annotations; a retried Complete job = cached republication (no model calls).

Also: semantic and hybrid searches with a narrow structured filter (`project`, `gitBranch`, `tags`, `after`, `before`,
Archive restrictions), which before ANN could return fewer sessions without a signal (215 of 1,000 leg rows, 6 of 10
sessions measured), are completed by the second pass (§5.7). Chunk summaries and tags are those of a full publication by
default (§13.2 E1X); only an operator's finite `indexing.metadataHorizonWindows` changes them, for content published
after the change.

### 13.4 REL outcome and the model-manifest finding
- **Criterion (≈ 20:30Z) and clone numbers** (`reports/ingest-c/CLONE/PASSAGES.md`, a TEMPLATE copy of production's
  archive, read-only, derived from every published run's accepted decisions and checked against the stored rows: 939,242
  pieces, 0 mismatches): passage length in windows p50 2, p90 6, p99 16, max 66; **passages > 16 windows 58 of 6,592
  (0.88 %) in 44 of 2,626 sessions** (9.36 % of the pieces). Replaying the archive's 3,458 real appends in exact mode:
  rewrite region p99 20 windows / 1,210 pieces, max 64 / 3,858; appends whose rewrite exceeds 16 windows 56 (1.62 %, 17
  sessions); **H = 16 would save 27,267 pieces = 2.26 % of the exact append work** (3.75 % of the rewrite work) [m
  CLONE]. Passages > 16 windows are rare, so the real-model comparison was **not run**; the horizon is recorded as
  "opt-in, effect on real-model relevance not measured; scripted mechanism result only"; **REL is closed**.
- **Scripted result** (`reports/ingest-c/REL/RESULTS.md`; stub annotator replacing summaries at phase boundaries, 56
  held-out cases, session-cluster bootstrap 95 %): keyword queries needing a final-outcome term on an early chunk (class
  E2) lose under H = 16 — lexical Recall@5 1.00 → 0.00, hybrid MRR −0.29 [−0.54, −0.07]; the mirror class C (mid-problem
  term) gains — lexical 0.00 → 1.00, hybrid MRR +0.31 [+0.10, +0.52]; natural questions, detail/resolution/short-session
  keywords and the semantic control unchanged. This is construction, not semantic evidence: it shows the rule is
  implemented exactly (6,144 pieces differ, 0 violations) and the direction and upper size of the effect per query
  class, not its real-world rate [m REL].
- **Local real models** (≈ 07:20Z/≈ 19:40Z conditions held: one idle GPU, hash-verified downloads, offline loopback
  servers, GPU freed and weights removed): Qwen3-4B, the manifest's annotator, could not annotate the corpus — 72 of 80
  attempts rejected with the repository's request settings, 28 % accepted with production's, ≈ 0.2 % chance for a
  30-window session — so the run stopped before any comparison; no relevance number comes from a real model [m REL].
- **Model-manifest finding** (`reports/ingest-c/DEPLOYMENT.md` "Finding for the owner (no fix in this track)"):
  `chronicle/model-manifests` pins Qwen3-4B-Instruct-2507 (annotation) + llama-nemotron-embed-1b-v2 (embedding), while production
  runs DeepSeek-V4.1-Flash-1017 via Tokenfactory + google/embeddinggemma-2@914f7f89 (768 d) (rendered production config,
  `reports/deploy3/`, cited in `reports/ingest-c/REL/report.md` Phase 3). The repository's pinned-model evaluation path therefore does
  not represent production, and the pinned local annotator could not annotate the evaluation corpus at all (28 % of attempts accepted
  with production's request settings; ≈ 0.2 % chance per 30-window session) — `reports/ingest-c/REL/RESULTS.md`.
