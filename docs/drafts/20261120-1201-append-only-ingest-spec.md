# Chronicle append-only ingest (plan B) — implementation spec for S1 and S2

Base `0aedcfa8` (`agent/ingest-b`); S1 starts from the S0 tip (S0-COL collector stat-skip/budget/codes, S0-I1 running
jobs survive newer revisions). Tags: **[o F:L]** observed in code at the base, **[o Vn]** observed by check n of
section 0 (evidence in `.local/overhaul-20261117/reports/ingest-b/SPEC/evidence/`), **[i]** inferred, **[u]** not
verified. Design study: `reports/chronicle-ingest-design/DESIGN.md` (§6 B, §7, §8). Out of scope: S3 (legacy
conversion), S4 (retiring `/api/ingest`), S5 (index reuse).

## Summary
- **S1** stores every new single-file revision in an *epoch* (a linear history of one source: messages by position,
  raw by byte offset, fragments by position); a revision is a row `(epoch, message_count, raw_bytes, …)`. `/api/ingest`
  is unchanged on the wire; the server detects "append to the head's epoch" (raw prefix digest + message chain) and
  writes only the delta. Legacy revisions stay as they are. Readers change their queries through one helper
  (`RevisionContent`); views were measured and rejected (O(session) sorts).
- **S2** adds an upload API in `chronicle.api` 1.9.0 (additive, precedent 3961370f): open → parts (≤ 8 MiB) → commit,
  with status/resume/abort, incremental validation and a base proof; parts are written straight into epoch rows past
  the head's count, so the commit is O(1). The collector streams (bounded memory), appends or replaces, and resumes.
- Measured on a TEMPLATE copy of the clone: for the largest session the current ingest takes 65 s and 2.2 GB WAL; the
  S1 database work for its next real revision is 18 ms and 1.3 MB WAL (the unchanged whole-request decode/validate is
  11.3 s); a full new epoch is 21.6 s / 1.1 GB WAL. 44 revisions rebuilt from the epoch layout are md5-identical to their
  legacy snapshots, so the S1 down-script is exact.

## 0. Verified assumptions
| # | assumption | method | result |
|---|---|---|---|
| V1 | jsonb caps (E1) | throwaway PG 18.6, synthetic | string > 268,435,455 B → `string too long to represent as jsonb string` (DETAIL `… cannot exceed 268435455 bytes`); container → `total size of jsonb array/object elements exceeds the maximum of 268435455 bytes`; container overhead counts: max top-level scalar string 268,435,447 B, max `{"a":s}` 268,435,442 B; snapshot shape 150 MiB raw + 120 MiB messages fails, 100+100 MiB stores; `text` column takes 512 MiB, 1 GiB fails (`requested length too large`; string buffer limit 1,073,741,823 B). Casting ~256 MB text to jsonb ≈ 3.3–3.8 s. |
| V2 | stored data allows append detection and multi-file handling (E2) | copy `chronicle_ingb_spec`, counts only | 7,804/7,804 revisions single-file; formats: Pi 2,838 sources/7,711 revisions, Historian 18/93 (1 message each), no Claude/Codex; every raw file newline-terminated, none empty; 0 path changes in 4,948 consecutive pairs; `digest == files[0].sha256` in all; largest raw 145.8 MB; head message text max 596,865 B (0 values > 1 MiB); longest raw line 1,344,233 B (3 heads > 1 MiB, none > 4 MiB); max `recordIndex` 37,854; 1,668 head messages contain the six-character text `\u0000` |
| V3 | resumable SHA-256 (E3) | scratch Java prototype vs JDK; Node API probe | JDK `MessageDigest` has no state export (public API: clone/digest/update/reset…; reflection on `sun.security.provider.DigestBase` → `InaccessibleObjectException`); `clone()` is in-process only. Prototype (42 lines of logic) equal to the JDK on 3,000 random inputs with 0–3 random splits, each split exported and resumed in a fresh instance; state 40–103 B; 256 MiB: JDK 154 ms, prototype 1,228 ms (≈ 4.8 ms/MiB, JIT). Node `Hash` has `copy()`, no export → the collector needs no midstate (§6). |
| V4 | reader plans on the epoch layout (E4) | copy; 814 live multi-revision sources' heads moved into epochs (482,086 messages, 2.0 GB raw, 690,292 fragments) + 20 older prefix revisions; largest session `36763d39` (28,515 messages) | see §1.3 table: epoch query change equal to legacy (0.02–0.16 ms keyed reads); UNION ALL view sorts the whole epoch branch (first page 52 ms, locate 14 ms, context 9 ms) → views rejected; same session legacy → epoch: claim envelope 631 ms → 0.03 ms, claim message stream 811 ms (80 MB disk sort) → 10.7 ms, raw 1,071 → 448 ms |
| V5 | archive search head candidates (E5) | `ArchiveIndex.compile` lexical SQL, legacy vs epoch-aware | identical match sets (2,733 / 0 / 587 sessions); `%error%` 4.36 → 4.70 s (legacy part 2.56 s + epoch part 1.81 s), no-hit 12.7 → 13.2 ms, per-session `%zq%` 4.95 → 4.97 s |
| V6 | exact reconstruction (down-script) (E6) | md5 before the move vs rebuilt | 44/44 revisions (heads, head-1, head-2 of the ten largest; 14 Historian heads): snapshot jsonb and message list md5-equal; largest rebuilt snapshot 226,647,840 B = 84.4 % of the cap |
| V7 | write cost S1/S2 (E7) | SQL simulation, CHECKPOINT first, autovacuum off | S1 append of the next real revision of `36763d39` (58 messages, 131,754 raw B): 18 ms, row lock 2 ms, WAL 1,328,736 B; S1 new epoch (28,515 messages, 145.8 MB raw): 21.6 s, row lock 1 ms, WAL 1.10 GB; candidate prune 10,000 rows: 114 ms, 44.6 MB WAL; one S2 part (4 MiB values + 4 MiB raw): 1.39 s / 118 MB WAL after a checkpoint, 1.07–1.11 s / 38.6–41.7 MB steady |
| V8 | ingest cost today (E8) | native server `lmn6py1c…` (its sources equal the base's: `git diff d17f0b24..0aedcfa8 -- chronicle/server/src/main chronicle/migrations chronicle/models shared/service-runtime` is empty), serve-standby, 4 CPUs, production limits | re-ingest of `36763d39` rev 144 (233.2 MB body, 27,609 messages) as a new source and as its next revision: 65.1 / 64.9 s, WAL 2.17 / 2.20 GB, row unavailable to `FOR NO KEY UPDATE` in 1 of 215 probes; decode + validation alone (wrong digest → 400): 11.3 s |
| V9 | migration DDL cost (E4.0) | prototype 024 on the full copy | all DDL ≈ 15 ms; `VALIDATE CONSTRAINT` 1 ms (`ch_revisions` heap 648 kB, TOAST 35 GB not read) |

## 1. Schema (S1)
### 1.1 Migration `chronicle/migrations/024_epoch_layout.sql`
Runs in `Database.initialize`'s first transaction after `022_passage_formats_retired.sql` (and after S0-I1's `023_*` if
it exists) [o Database.scala:36-43]: append `migrate(c,"024_epoch_layout.sql")`. Idempotent (`IF NOT EXISTS`, `CREATE OR
REPLACE`), because every startup re-runs the list and `013` re-creates `ch_immutable_revision()` with its old body first
[o migrations/013:53-63, Database.scala:39]; 024 must re-assert its body after it.
```sql
CREATE TABLE IF NOT EXISTS ch_epochs(
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL,            -- no FK: an S2 upload of a new source reserves the id before ch_sources has the row
  raw_path text NOT NULL,              -- RawFile.path of every revision in the epoch
  candidates text NOT NULL DEFAULT 'current' CHECK(candidates IN('current','prune','pruned')));
CREATE INDEX IF NOT EXISTS ch_epochs_session ON ch_epochs(session_id);
CREATE INDEX IF NOT EXISTS ch_epochs_prune ON ch_epochs(id) WHERE candidates='prune';
CREATE TABLE IF NOT EXISTS ch_epoch_messages(
  epoch uuid NOT NULL REFERENCES ch_epochs(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK(position>=0), message_id text NOT NULL, value jsonb NOT NULL,
  PRIMARY KEY(epoch,position), UNIQUE(epoch,message_id));
CREATE TABLE IF NOT EXISTS ch_epoch_raw(
  epoch uuid NOT NULL REFERENCES ch_epochs(id) ON DELETE CASCADE,
  byte_offset bigint NOT NULL CHECK(byte_offset>=0), content text NOT NULL,   -- whole lines, <= 1 MiB unless one line is longer
  PRIMARY KEY(epoch,byte_offset));
CREATE TABLE IF NOT EXISTS ch_epoch_records(                                  -- raw record ids (`id`/`uuid`) for parentId resolution
  epoch uuid NOT NULL REFERENCES ch_epochs(id) ON DELETE CASCADE,
  record_index integer NOT NULL, record_id text NOT NULL,
  PRIMARY KEY(epoch,record_index,record_id));
CREATE INDEX IF NOT EXISTS ch_epoch_records_id ON ch_epoch_records(epoch,record_id);
CREATE TABLE IF NOT EXISTS ch_epoch_fragments(
  epoch uuid NOT NULL REFERENCES ch_epochs(id) ON DELETE CASCADE,
  position integer NOT NULL, part integer NOT NULL,
  value text COLLATE "pg_unicode_fast" NOT NULL, head_candidate boolean NOT NULL DEFAULT true,
  PRIMARY KEY(epoch,position,part));
CREATE INDEX IF NOT EXISTS ch_epoch_fragments_lower_trgm ON ch_epoch_fragments USING gin(value gin_trgm_ops) WHERE head_candidate;
ALTER TABLE ch_revisions ALTER COLUMN snapshot DROP NOT NULL;
ALTER TABLE ch_revisions ADD COLUMN IF NOT EXISTS epoch uuid REFERENCES ch_epochs(id),
  ADD COLUMN IF NOT EXISTS envelope jsonb,          -- the IngestRequest without messages and files (= snapshot-'messages'-'files' of a legacy row)
  ADD COLUMN IF NOT EXISTS message_count integer, ADD COLUMN IF NOT EXISTS record_count integer,
  ADD COLUMN IF NOT EXISTS raw_bytes bigint,
  ADD COLUMN IF NOT EXISTS raw_state bytea,         -- SHA-256 midstate after raw_bytes (40..103 B, §5)
  ADD COLUMN IF NOT EXISTS message_chain bytea,     -- chain v1 after message_count messages (32 B, §5)
  ADD COLUMN IF NOT EXISTS message_time text;       -- latest parsed message timestamp (Instant.toString) or NULL
-- added NOT VALID, then VALIDATE (SHARE UPDATE EXCLUSIVE; reads the 648 kB heap only [o V9])
ALTER TABLE ch_revisions ADD CONSTRAINT ch_revisions_layout CHECK(
  (epoch IS NULL AND snapshot IS NOT NULL AND envelope IS NULL AND message_count IS NULL AND record_count IS NULL
     AND raw_bytes IS NULL AND raw_state IS NULL AND message_chain IS NULL AND message_time IS NULL)
  OR (epoch IS NOT NULL AND snapshot IS NULL AND envelope IS NOT NULL AND message_count>=0 AND record_count>=0
     AND raw_bytes>=0 AND raw_state IS NOT NULL AND octet_length(message_chain)=32)) NOT VALID;  -- guarded by pg_constraint lookup
CREATE INDEX IF NOT EXISTS ch_revisions_epoch ON ch_revisions(epoch,message_count) WHERE epoch IS NOT NULL;
```
The `ALTER TABLE ch_revisions` statements need ACCESS EXCLUSIVE for milliseconds [o V9] but wait for every running
transaction on the table (an old pod's ingest or claim): deploy with the old pod stopped, or accept that wait.
Triggers (all in 024):
- `ch_immutable_revision()` re-created with the new columns added to the `IS DISTINCT FROM` list [o 013:53-63].
- `ch_immutable_epoch_rows()` `BEFORE UPDATE` on `ch_epoch_messages`, `ch_epoch_raw`, `ch_epoch_records`: always raises
  `23514 immutable epoch row`; on `ch_epoch_fragments`: raises unless only `head_candidate` changes.
- `ch_epoch_rows_guard()` `BEFORE DELETE` on the four row tables: raises when the row is covered by a committed revision
  (`position < max(message_count)`, `byte_offset < max(raw_bytes)`, `record_index < max(record_count)` over
  `ch_revisions WHERE epoch=OLD.epoch`, index `ch_revisions_epoch`). Purge deletes revisions first, so it passes.
- `ch_epochs` has no update trigger except that `id`, `session_id`, `raw_path` are immutable (same function pattern).
`ch_archive_fragments` keeps one role for epoch revisions: their **metadata** fragments (≈ 4–12 rows per revision),
keyed `(session_id, revision, ordinal)` as today; the 017 trigger keeps flipping them [o 017:64-80]. `ch_revision_info`
is unchanged (one row per revision for every layout); `ch_messages` is never written for epoch revisions.

### 1.2 Down-script `chronicle/scripts/down-024-epoch-layout.sql`
Lives outside `chronicle/migrations/` (that directory is a classpath resource root [o build.sbt:147,172,191,278]); the
runner applies only its explicit list, so the script is never applied by a binary. Precedent:
`chronicle/scripts/check-legacy-free.sql`, listed in `tests` of `nix/pkg/chronicle/source.nix:36-39` and exercised by
`LegacyFreeCheckTest`; the down-script is listed there too. Run by an operator with the server stopped, with
`statement_timeout=0`, after the S2 down-script (§9) if S2 was deployed. Steps:
1. Refuse (raise, listing session/revision) if any epoch revision's estimated legacy snapshot
   (`raw_bytes + Σ octet_length(value::text)` of its messages + 4 KiB) exceeds 268,435,000 B — such a revision cannot be a
   jsonb value [o V1]; only S2 can create one (S1 bodies are bounded by `maxBodyBytes`; the largest real revision
   rebuilds to 226.6 MB [o V6]).
2. Per source (one transaction each, resumable: a revision with `epoch IS NULL` is done), with
   `ch_immutable_revision` disabled inside the transaction: for every epoch revision write
   `snapshot = envelope || {"messages": [values < message_count by position], "files": [{"path": raw_path,
   "sha256": envelope->>'digest', "content": string_agg(raw segments < raw_bytes by offset)}]}` (the E6 query), set the
   epoch columns NULL, insert `ch_messages` rows (positions < count) and the message fragments
   (`ch_epoch_fragments` positions < count) into `ch_archive_fragments` with `ordinal = metadata count + row_number()`
   and `head_candidate = (revision = ch_sources.revision)`.
3. One final transaction: drop the epoch triggers/functions, constraint, index and columns, `ALTER COLUMN snapshot SET
   NOT NULL`, drop the four row tables and `ch_epochs`, re-create the 013 body of `ch_immutable_revision()`.
Limits: (a) the jsonb cap (step 1); (b) disk and WAL: every epoch revision becomes a full legacy copy again (estimate
before running: `Σ raw_bytes + message bytes` over epoch revisions, ×≈ 2 for fragments/TOAST/WAL); (c) S2 objects first.
Fragment ordinals differ from what a legacy ingest would have produced (the legacy writer has no ORDER BY
[o ArchiveProjection.scala:73]); no reader uses ordinals [o ArchiveIndex.scala:169-171].

### 1.3 Readers: query changes, not views (decided by V4/V5)
| read (session `36763d39`, 28,515 messages) | legacy | epoch, query change | UNION ALL view |
|---|---|---|---|
| GetMessages page 100 @0 / @end | 0.140 / 0.147 ms | 0.159 / 0.131 ms | **52.1** / 0.175 ms (sorts all 28,515 epoch rows) |
| LocateMessage | 0.071 ms | 0.024 ms | **14.0** ms |
| MessageContext adjacent (4) | 0.041 ms | 0.022 ms | **9.2** ms |
| literal search, no hit (whole revision) | 367 ms | 305 ms | 306 ms |
| claim envelope / message stream | 631 ms / 811 ms (80 MB disk sort) | 0.027 ms / 10.7 ms | — |
| GetRaw | 1,071 ms | 448 ms | — |
The view's epoch branch is a nested loop whose output is not known to be ordered, so `ORDER BY position LIMIT` sorts the
whole branch (O(session)) [o E4 R1]. Therefore every reader resolves the layout once and queries the right relation.
New `RevisionContent.scala`:
- `layout(c,id,revision)`: `SELECT epoch,message_count,record_count,raw_bytes FROM ch_revisions WHERE session_id=? AND
  revision=?` — merged into `selectView`'s existing existence check [o Database.scala:186], so no extra round trip.
- `messages(layout)`: a `ReadSources.Query` relation `(SELECT position,message_id,value FROM ch_messages WHERE
  session_id=? AND revision=?)` or `(SELECT position,message_id,value FROM ch_epoch_messages WHERE epoch=? AND
  position<?)`. The `position < message_count` filter exists only here.
- `raw(layout)` → `List[RawFile]`; `envelope(layout)` and the claim stream.
Call sites: `messages` [o Database.scala:217-225], `locateMessage` [:226-230], `content`/`raw`/`headSnapshot`
[:169-170,204-208,231-236], `claimedSnapshot` [:272-283], MessageContext's four queries [o MessageContext.scala:54-99],
`PostgresMessageSearch` [o SessionMessageSearch.scala:75-77], `ArchiveSearchWitnesses.literalSelection`
[o ArchiveSearch.scala:79-104], `ArchiveIndex.compile` (below). Readers of `ch_revision_info` only (Activity,
ExpressionHints, Search, `infoQuery`) are unchanged.
`ArchiveIndex.compile` [o ArchiveIndex.scala:153-171]: `corpus` adds `rv.epoch` via `LEFT JOIN ch_revisions rv ON
rv.session_id=s.id AND rv.revision=s.revision` (3 ms for 2,856 heads [o E5]); global path: `g$i` unchanged plus
`e$i AS MATERIALIZED(SELECT epoch,position FROM ch_epoch_fragments WHERE head_candidate AND value LIKE …)` and
`l$i = (corpus ⋈ g$i on (id,revision)) UNION (corpus ⋈ e$i on epoch AND position < message_count)`; per-session path:
`EXISTS(legacy) OR EXISTS(SELECT 1 FROM ch_epoch_fragments WHERE head_candidate AND epoch=c.epoch AND
position<c.message_count AND value LIKE …)`. Same matches, same cost (V5).

## 2. Invariants
1. **Epoch** = one linear history of one source: rows at positions `0..n-1`, raw bytes `0..b-1`, records `0..k-1`.
   A revision R in epoch E sees exactly positions `< R.message_count`, offsets `< R.raw_bytes`, records
   `< R.record_count`. Positions equal legacy positions (an epoch starts at position 0).
2. **Prefix:** revisions of one epoch are totally ordered by revision number and each is a prefix of the next
   (`message_count`, `raw_bytes`, `record_count` non-decreasing). A non-prefix revision starts a new epoch.
3. **Line boundaries:** `raw_bytes` of every committed revision is 0 or follows a `\n`; every raw segment holds whole
   lines; segments are contiguous (`byte_offset(k+1) = byte_offset(k) + octet_length(content(k))`) and every committed
   revision's `raw_bytes` is a segment boundary (writers start a segment at each revision/part start), so a revision's raw
   is the concatenation of its segments — never a cut.
4. **Digests:** `envelope.digest = hex(SHA-256(raw[0..raw_bytes)))` = the file's `sha256`; `raw_state` is that hash's
   midstate; `message_chain` = chain v1 over its messages (§5). The S1 writer re-derives the final digest from the stored
   midstate and checks it against the validated request digest (self-check of the stored state).
5. **Immutability:** committed revision rows never change (trigger); epoch rows covered by any committed revision are
   never updated (except `head_candidate`) or deleted except by purge.
6. **Head:** `ch_sources.revision` names the head; when a switch moves the head to another epoch, the old head's epoch
   becomes `candidates='prune'` in the switching transaction (then `pruned` by the background prune). An epoch that no
   revision references is S2 staging: committed or swept, never read.
7. **Visibility:** readers reach epoch rows only through a committed `ch_revisions` row and `RevisionContent` filters;
   rows beyond every committed count (S2 staging, garbage) and epochs without a revision are unreachable.
8. **Uniqueness:** message ids are unique per epoch (`UNIQUE(epoch,message_id)`), including staged rows; garbage
   beyond the committed maximum is deleted before a writer appends to an epoch.

## 3. S1 ingest path (`/api/ingest`, wire unchanged)
Order inside `PostgresArchive.ingest` [o Database.scala:125-161] stays: validation outside the transaction
(`SnapshotValidation.validate`, unchanged, whole body [o Core.scala:265-298]); transaction: owner target, receipt digest
over the canonical request, advisory lock `ingest:owner:key`, receipt replay/409, CAS read of the head without a row lock,
then **layout decision and writes** (new), then `FOR NO KEY UPDATE` re-check, switch, job statements as S0-I1 leaves
them, receipt [o Database.scala:130-157]. HTTP admission unchanged: bodies > 8 MiB still take the one
`SnapshotAdmission` permit before the body is read [o Http.scala:193-196, SnapshotAdmission.scala:14-18]; statement (30 s)
and idle (30 s) timeouts unchanged — every S1 statement is bounded by a batch (128 rows) or a segment (≤ 1 MiB).

**Decision** (head = current revision row; r = request; S = `SnapshotProjection(r)` [o Core.scala:240-246]):
- `r.files.size != 1` → **legacy layout** (today's writer, kept). Never observed (0 of 7,804 [o V2]).
- head is an epoch revision, `r.files(0).path == epoch.raw_path`, `utf8(content).length >= head.raw_bytes`,
  `content[0..raw_bytes)` hashes (JDK digest) to `head.envelope.digest`, `r.messages.size >= head.message_count`, chain v1
  of `S.messages[0..message_count)` equals `head.message_chain` → **append**.
- otherwise (no head, legacy head, Historian replacement, Codex non-prefix, redaction change, Pi v1/v2 → v3 rewrite) →
  **new epoch** (full write; for a legacy head this is the one-time first-touch cost, 21.6 s DB for the largest [o V7]).
**Writes (append):** delete garbage beyond the epoch's committed maximum (S2 leftovers; none in S1-only deployments);
insert `ch_revisions` (epoch, envelope = S without messages/files, counts, `raw_state` = resume(head.raw_state) +
delta bytes, `message_chain` extended over the delta, `record_count`, `message_time` = max(head.message_time, delta)),
`ch_epoch_messages` (delta, batches of 128), `ch_epoch_raw` (delta from `head.raw_bytes`, ≤ 1 MiB line-aligned
segments), `ch_epoch_records` (delta records' `id`/`uuid`), fragments: delta messages via `lower(value->>'text' COLLATE
pg_unicode_fast)` read back from `ch_epoch_messages` → `ArchiveProjection.fragments` → `ch_epoch_fragments(epoch,
position, part)` (no cross-message overlap exists: fragmentation is per field [o ArchiveProjection.scala:56,71-77], so the
previous tail is never rewritten); metadata fragments → `ch_archive_fragments(session, revision, ordinal)`;
`ch_revision_info` with `message_count` and `last_timestamp` = `message_time` orElse `endedAt` orElse `startedAt`
(same rule as `ArchiveProjection.latest` [o ArchiveProjection.scala:41-45], O(delta)). **New epoch:** the same with the
whole content into a new `ch_epochs` row; in the switch transaction the previous head's epoch (if any) becomes
`prune`. **Switch** unchanged: one `UPDATE ch_sources SET revision` under `FOR NO KEY UPDATE`; the 017 trigger now flips
only metadata rows of epoch revisions (for a legacy previous head it prunes that head's fragments once, as today).
Measured: append 18 ms / 1.3 MB WAL / row lock 2 ms; today 65 s / 2.2 GB [o V7, V8].
- **Receipts/idempotency/CAS** unchanged (digest over the canonical request; same requestId+digest → stored receipt;
  different → 409; `expectedRevision == head`).
- **S0-I1 jobs:** the switch calls S0-I1's job statements unchanged (extract them into `Jobs.switched(c,id,next,profile)`
  so S2's commit reuses them). A running older job reads its own revision's rows, which appends never change.
- **Claim:** `claimedSnapshot` reads `envelope` and streams `ch_epoch_messages … ORDER BY position` (64 per fetch,
  unchanged API); `Claim.snapshot` equals the legacy claim value (no raw files). Worker heap stays O(session) — S1 does
  not change it (study §5); the epoch claim avoids the 0.6 s envelope detoast and the 80 MB sort [o V4].
- **`GetRaw`** of an epoch revision: `RawResult(List(RawFile(raw_path, digest, string_agg(segments))), revision)` —
  exact bytes, one response as today (V4: 448 ms for 145.8 MB).
- **Purge** [o Auth.scala:339-342]: after `DELETE FROM ch_revisions` add `DELETE FROM ch_epochs WHERE session_id=?`.
- **Backfill** [o ArchiveProjection.scala:92-124]: selects legacy revisions only (`r.epoch IS NULL`); if an epoch
  revision has `lexical_version <> ArchiveProjection.lexicalVersion` it fails start-up with `migration-required`
  (an epoch fragment rebuild is a separate task when the version is next bumped).
- **Candidate pruning:** `EpochMaintenance` (graph resource like `McpTestRuns`' loop [o McpTestRuns.scala:73-81], interval
  60 s, injectable for tests): for each `prune` epoch, `UPDATE … SET head_candidate=false` on ≤ 10,000 rows per
  statement (`FOR UPDATE SKIP LOCKED`), then `pruned`. Search correctness never depends on it (join on epoch and count);
  cost 114 ms / 44.6 MB WAL per 10,000 rows [o V7] — only after a new epoch, not on appends.
- **Layout seam for tests:** `PostgresArchive(db, config, layout: RevisionLayoutPolicy = RevisionLayoutPolicy.Epochs)`;
  `Legacy` forces the legacy writer (differential tests; the existing tests that assert legacy-table behaviour —
  `ArchiveHeadCandidateTest`, `ArchiveProjectionTest`, `ArchiveContentBoundaryTest`'s plan assertion — pin it).

## 4. S2 protocol (additive in `chronicle.api` 1.9.0)
### 4.1 Types (`chronicle/models/chronicle.baboon`)
```
enum UploadPhase { Open Committed Aborted Expired Failed }
data UploadBase { digest: str rawBytes: i64 messageCount: i32 messageChain: str }
root data UploadOpen { requestId: uid source: SourceIdentity expectedRevision: i32 rawPath: str base: opt[UploadBase] }
root data UploadPart { ordinal: i32 sha256: str raw: str messages: lst[Message] }
root data UploadCommit { digest: str rawBytes: i64 messageCount: i32 messageChain: str completion: Completion redacted: bit metadata: Metadata }
data UploadLimits { maxPartBytes: i32 maxRawBytes: i64 maxMessages: i32 }
root data UploadState { uploadId: uid requestId: uid phase: UploadPhase append: bit receivedParts: i32
  receivedRawBytes: i64 receivedMessages: i32 lastPartSha256: opt[str] expiresInSeconds: i32 limits: UploadLimits
  receipt: opt[IngestReceipt] failure: opt[str] }
```
`IngestRequest`, `IngestReceipt`, `Message`, `Metadata` unchanged. i64 travel as decimal strings [o CONTRACT.md:132].
### 4.2 Endpoints (bearer, Ingest scope, no query, Origin rule as `/api/ingest` [o Http.scala:193-196])
| endpoint | body → result | notes |
|---|---|---|
| `POST /api/ingest/uploads` | `UploadOpen` → `UploadState` | idempotent by requestId; a new upload or the existing one |
| `GET /api/ingest/uploads/{id}` | → `UploadState` | resume; other owners → 404 `not-found` |
| `POST /api/ingest/uploads/{id}/parts` | `UploadPart` → `UploadState` | body ≤ `maxPartBytes` (413 before reading, like `boundedBytes` [o Http.scala:27-30]) |
| `POST /api/ingest/uploads/{id}/commit` | `UploadCommit` → `IngestReceipt` | replay returns the stored receipt |
| `POST /api/ingest/uploads/{id}/abort` | empty → `UploadState` | frees the source; staged rows swept |
### 4.3 Errors (`Failure{code,message}`; new codes get explicit statuses in `Http.failure` [o Http.scala:33-34], which maps unknown codes to 400)
`invalid` 400 (any per-part validation, part sha mismatch, not line-aligned); `unauthorized`/`forbidden` 401/403;
`not-found` 404; `conflict` 409 (CAS, requestId bound to another declaration, part ordinal already accepted with another
sha256, part out of order — message names the expected ordinal); `base-mismatch` 409 (open: base ≠ head);
`upload-busy` 409 (another live upload on the source, or > 8 open uploads of the owner); `content-mismatch` 409 (commit:
declared ≠ computed; the upload becomes `Failed`); `upload-expired` 409 (part/commit after expiry); `gone` 410 (purged
source); `too-large` 413 (part body; cumulative raw > `maxFileBytes`; messages > `maxMessages`; parts > 1,024);
`unavailable` 503.
### 4.4 Limits and lease
`UploadPolicy`: `maxPartBytes` = 8 MiB = `SnapshotAdmission.largeBodyBytes` (parts never take the admission permit);
per-record cap = one record and its messages must fit in one part (data: longest line 1.34 MB, largest message
0.6 MB [o V2]); `maxParts` 1,024; raw cap = config `maxFileBytes` (an `Int`, ≤ 2 GiB−1; production 256 MiB — raising
it is decision D2); messages cap = `maxMessages`; positions and `recordIndex` i32, raw offsets i64/bigint. Lease: TTL
3,600 s sliding, `expires_at = clock_timestamp() + ttl` set at open and on every accepted part (DB clock only; the client
receives `expiresInSeconds`). At most one live upload per source (partial unique index on `(owner,source_key) WHERE
phase='Open'`; an expired `Open` row is expired in the same advisory-locked transaction before the check), at most 8 per
owner.
### 4.5 Server state (migration `025_uploads.sql`)
`ch_uploads(id uuid PK, owner, source_key, session_id uuid, request_id uuid, declaration jsonb, declaration_digest text, epoch uuid,
append boolean, base_count int, base_raw_bytes bigint, base_records int, parts int, messages int, raw_bytes bigint,
records int, raw_state bytea, message_chain bytea, max_record_index int, message_time text, last_part_sha256 text,
receipt jsonb, failure text, phase text, expires_at timestamptz, UNIQUE(owner,source_key,request_id))` and
`ch_upload_parents(upload uuid, parent_id text, PRIMARY KEY(upload,parent_id))` (unresolved forward references).
`session_id` is the head's id, or a reserved new UUID when `expectedRevision = 0` (the `ch_sources` row is created by
the commit, so no revision-0 source is ever visible [i: readers never saw such rows]).
### 4.6 Operations (each one transaction under the advisory lock `ingest:owner:key` [o Database.scala:130])
- **Open:** validate source/rawPath like `SnapshotValidation` [o Core.scala:265-275]; replay by requestId (same
  `declaration_digest` → current state; different → 409); CAS `expectedRevision == head` (409); with `base`: head must be an
  epoch revision with `raw_path = rawPath` and `envelope.digest, raw_bytes, message_count, message_chain` equal to the
  base, else `base-mismatch`; delete garbage beyond the epoch's committed maximum; `append=true`, epoch = head epoch.
  Without `base`: a new `ch_epochs` row, unreachable until the commit's revision references it.
- **Part:** phase `Open` and not expired; `ordinal == parts` (else replay: same ordinal and sha → current state;
  otherwise 409); recompute the part digest (§5) = `sha256`; raw empty or ending `\n`, every line a JSON value (records
  counted with the shared `SnapshotValidation` line rule), scalar Unicode; every message checked as today
  [o Core.scala:292-294]; positions assigned by the server from `messages` (contiguous); `recordIndex < records +
  this part's records` or recorded in `max_record_index`; `parentId` resolved against `ch_epoch_messages` and
  `ch_epoch_records` of the epoch (committed + staged), else inserted into `ch_upload_parents`; ids introduced by the
  part delete matching pending parents; duplicate id → unique violation → `invalid`; write messages, raw segment(s) at
  `base_raw_bytes + raw_bytes`, records, fragments (`head_candidate` true; unreachable until commit); extend `raw_state`
  (resumable SHA-256), `message_chain`, counters, `message_time`, `expires_at`. Measured ≈ 1.1 s and ≈ 40 MB WAL per full
  part [o V7].
- **Commit:** phase `Open` (replay of `Committed` with the same commit digest → stored receipt); computed digest, raw bytes,
  message count, chain equal the declaration, `ch_upload_parents` empty, `max_record_index < records`, metadata/tags/
  timestamps valid [o Core.scala:296-297] — else `content-mismatch`, phase `Failed` (staged rows swept). Then CAS again,
  create `ch_sources` for a new source, `ch_revisions` (envelope built from open + commit, `SnapshotProjection` applied to
  metadata), `ch_revision_info`, metadata fragments, epoch `current` (and the previous head's epoch `prune` for a
  replacement), `FOR NO KEY UPDATE` switch, `Jobs.switched`, receipt in `ch_ingest_receipts(owner, source_key,
  request_id, digest = hash(declaration_digest ‖ commit digest))`, phase `Committed`. O(metadata), no staged-row update.
- **Status/abort:** abort sets `Aborted`; the sweep deletes its staged rows.
- **`/api/ingest` on a source with a live upload** (S2 adds this check to §3): 409 `upload-busy` — an old collector
  shows it as `cas-conflict`; it needs two writers for one source key [i]. Expired uploads are expired inline first.
- **Sweep** (`EpochMaintenance`, S2 part): `Open` with `expires_at < clock_timestamp()` → `Expired`; for `Expired`,
  `Aborted`, `Failed`: delete staged rows (append: rows beyond the epoch's committed maximum; replacement: the epoch's rows
  then the epoch) in statements of ≤ 10,000 rows, taking the source's advisory lock with `pg_try_advisory_xact_lock` (skip
  when busy); terminal upload rows kept 7 days for replay, then deleted.
### 4.7 Memory
Server: one part (≤ 8 MiB body, its decode and fragments) per request; commit O(metadata); no admission permit.
Unchanged O(session): the worker claim and `GetRaw` (decision D3). Collector: §6.

## 5. Base proof
- **Raw digest:** `digest = hex(SHA-256(raw))` (unchanged meaning [o Core.scala:289]). Stored per epoch revision:
  `raw_state` = midstate after `raw_bytes`: 8 × u32 big-endian, u64 byte length, then the `length mod 64` pending bytes
  (40–103 B). Implementation: `ResumableSha256.scala` (≈ 80 lines Scala; the E3 prototype's logic, cross-checked by a
  property test against `MessageDigest`); used only where a state must survive a transaction (S1 append, S2 parts); the
  JDK digest stays for whole values.
- **Message chain v1** over the stored (NUL-projected) messages, computed identically by server and collector:
  `field(s) = u32be(len(utf8 s)) ‖ utf8 s`; `opt(None) = 0x00`, `opt(Some s) = 0x01 ‖ field(s)`;
  `m(x) = SHA-256("chronicle.message.v1" ‖ 0x00 ‖ field(id) ‖ opt(parentId) ‖ field(role) ‖ field(project(text)) ‖
  opt(timestamp) ‖ i32be(recordIndex))`; `chain₀ = SHA-256("chronicle.message-chain.v1")`, `chainₖ₊₁ = SHA-256(chainₖ ‖
  m(xₖ))`. `project` = `SnapshotProjection.text` (U+0000 → the six characters `\u0000`) [o Core.scala:241]; defined over
  stored values so S3 can compute chains from legacy rows; the projection is not injective (1,668 head messages already
  contain the text [o V2]), which only identifies values the archive cannot distinguish anyway. Golden vectors in
  `chronicle/tests/message-chain-v1.json`, read by the Scala and the collector tests.
- **Part digest:** `SHA-256("chronicle.upload-part.v1" ‖ 0x00 ‖ u64be(len raw) ‖ raw ‖ u32be(n) ‖ m(x₁) ‖ … ‖ m(xₙ))`, hex.
- **What the server verifies:** at open, `base` equals the head exactly (revision via CAS; digest, raw bytes, message
  count, chain); during parts, it extends its own midstate and chain from the head's stored state over received bytes and
  messages (O(delta)); at commit, the declared final digest/chain/counts equal its own. The server cannot see the
  collector's prefix; a wrong local prefix decision (bug, file changed) yields `content-mismatch` because the declared
  digest covers the collector's full raw while the server's covers head ‖ delta.
- **`base-mismatch`** (409, at open; no upload created) and **`content-mismatch`** (409, at commit; upload `Failed`) make
  the collector re-plan as a **replacement**: open without `base` → new epoch, all content in parts. A replacement that
  ends in `content-mismatch` is a collector bug: the entry stops with that code.

## 6. Collector (S2)
- **Config:** `uploadProtocol: "parts" | "whole"` (default `parts`; `whole` = today's `/api/ingest` path); Home Manager
  option `chronicle.collector.uploadProtocol` (string enum; `limits` takes integers only [o nix/hm/chronicle.nix:128-132]).
- **Spool** (existing spools open unchanged; new buckets only, so a downgraded collector ignores them):
  `head` rows gain optional `rawBytes, recordCount, messageCount, messageChain` (absent = unknown base →
  replacement; written after every acknowledgement, in `whole` mode too, because an S1 server stores the same digest and
  chain, so a later switch to `parts` appends); bucket `upload` keyed by requestId `{requestId, sourceKey, uploadId, append, base, file {dev, ino},
  plannedFileBytes, partBudget, partsAcked, lastPartSha256, policyDigest, status, attempts, nextAt, error}` and index
  `source-upload` (not `source-pending`: an old collector would refuse that source with `source-already-pending`
  [o spool.ts:174]). No content is spooled: parts are regenerated from the file.
- **Draining:** a source with a queued old-format `pending` entry uploads it through `/api/ingest` first (as today); no
  upload is opened for it until that entry is acknowledged or dropped.
- **Streaming pass** (replaces `readSnapshot` + `parseTranscript` holding the file [o discovery.ts:124-149,
  parsers.ts:88-110]): open with the same identity/symlink/stat checks; read to the size observed at open (must end with
  `\n`, else the partial-line rule applies); a 1 MiB buffer splits lines; per line: `JSON.parse`, depth check, redaction,
  redacted raw line, `excludedTranscript` and `evidenceFor` checks [o collector.ts:22-37, controls.ts:28-43], record id,
  metadata last-wins and title rule [o parsers.ts:149-158,181-188], normalization; SHA-256 (Node) of the redacted raw,
  chain v1 (state = 32 B, storable), counts. **Codex** needs a pre-pass: the file-wide `event_msg` dedup keeps a multiset
  of `SHA-256(role ‖ 0x00 ‖ text)` of `response_item` messages (32 B per entry instead of the text [o parsers.ts:159-173]);
  then the main pass decides drops from it.
- **Append vs replacement:** with a known base the pass checks, at record `head.recordCount`, raw bytes ==
  `head.rawBytes`, `hash.copy().digest()` == `head.digest`, messages == `head.messageCount`, chain == `head.messageChain`;
  all equal → open with `base` and continue the same pass emitting delta parts; otherwise open without base and re-read
  from the start (page cache warm). Pi/Claude appends therefore read the file once.
- **Parts:** greedy packing of whole records (raw line + its messages) up to the server's `maxPartBytes` minus envelope
  margin; a record that alone exceeds it → `record-too-large` (source quarantined, status line with size and limit).
  Sequential: send, then persist `partsAcked`/`lastPartSha256`.
- **Resume** (restart, timeout, 5xx): `GET` status; re-run the pass recomputing parts up to `receivedParts`; the
  recomputed sha of part `receivedParts-1` must equal `lastPartSha256` and the file identity must match, else abort and
  re-plan. `upload-expired` → reopen with the same requestId (the server creates a new upload id). `upload-busy` → back-off.
- **Commit:** at the end of the pass (stat unchanged since open): `UploadCommit` with digest, totals, chain, metadata
  (after git-remote observation [o collector.ts:196-208]); on success store the new head with the base fields.
- **Memory:** buffer + one part + Codex hash multiset (≈ 80 B/message) + metadata — independent of file size.
- **S0-COL codes:** `snapshot-too-large` (file > `maxFileBytes`), `message-limit`, `scan-budget-deferred` unchanged;
  `payload-too-large` and `server-payload-too-large` apply to `whole` mode and old-format drains only; new:
  `server-upload-unsupported` (404 without a `Failure` JSON body on `POST /api/ingest/uploads`; stopped, status names
  `uploadProtocol`), `upload-too-large` (413 at open/part, with size and the server limit),
  `record-too-large`, `upload-content-mismatch` (replacement mismatch; stopped); counters gain `replacements`. The
  progress report wire is unchanged (`uploadedBytes` = acknowledged part bytes).
- **Old server:** see §8; no automatic fallback.

## 7. Atomic visibility
- **S1:** one transaction as today (study/ch-fix2 §2-A): the revision row, its rows, switch, jobs and receipt become
  visible at commit; REPEATABLE READ readers see the old head or the new one, never part of it; the old revision's rows
  are unchanged by an append. Rollback discards everything.
- **S2 parts:** each part commits rows that are MVCC-visible but unreachable: beyond every committed count of the head's
  epoch (append) or in an epoch no revision references (replacement); head search filters `position <
  c.message_count` and joins on the head's epoch. **Commit** is the only transaction that makes the revision visible;
  readers before it see the previous head (and pinned revisions stay exact). **Failure/abort/expiry:** nothing becomes
  visible; the sweep deletes staged rows, never rows below a committed count (DELETE guard).
- Test: extend `OwnerLeaseBoundaryTest` (§11): parts committed while a reader holds a pinned view and a REPEATABLE READ
  transaction; both see the old content; after commit the new revision appears whole.

## 8. Compatibility and version policy
Rules: one Baboon schema edited in place, VersionInfo `1.9.0` [o CONTRACT.md:3,137-139]; explicit removed/future-version
rejection concerns the WebSocket/RPC negotiation [o VersionedWire.scala:8-15, ApiVersionCompatibilityTest]; additive
in-place precedent 3961370f (enum value, `lock.json` unchanged) [o git]. **Decision: S2 is additive in 1.9.0** — new root
types and endpoints only; `IngestRequest`/`IngestReceipt` codecs and their golden fixtures unchanged;
`ApiVersionCompatibilityTest` unchanged; new golden fixtures for the five new root types in
`scripts/codec-fixtures.mjs`/`CodecFixtureTest`. [u] whether the pinned Baboon re-generation accepts the changed 1.9.0
signature without a `lock.json` update; if it refuses, update the lock entry in the same commit (it locks only 1.9.0).
| | server ≤ S1 (no upload API) | server S2 |
|---|---|---|
| collector ≤ S0-COL | `/api/ingest`; S1 stores deltas; > `maxBodyBytes` → 413 → `server-payload-too-large` (stopped) | same; the upload API is unused |
| collector S2, `parts` | `POST /api/ingest/uploads` → 404 (http4s `orNotFound`, no JSON [i from Http.scala routes]) → `server-upload-unsupported`, stopped, status: "server lacks the part-upload API: upgrade it or set uploadProtocol=whole"; queued old-format entries still drain | parts; append/replacement; sessions up to the server's `maxFileBytes`; status shows parts acked, replacements |
| collector S2, `whole` | as an old collector (+ S0-COL codes) | as an old collector |
Other `/api/ingest` clients (Historian extension, 8 MiB cap [o chronicle-upload.ts:18,72]; CLI `ingest`
[o cli/src/main.ts:125-142]; relevance eval [o workflow_v3.py:278]) are unchanged; their revisions go through §3
(Historian: a new 1-message epoch per revision). Rollout: server S1 → server S2 → collectors per host; S4 retires
`/api/ingest` later.

## 9. Rollback
- **S1:** stop the server, run `down-024-epoch-layout.sql` (§1.2), deploy the S0 binary. A pre-S1 binary must not
  run against epoch revisions: it would read `ch_messages` (empty for them) and serve empty pages with non-zero totals
  [i from Database.scala:217-225]; the runbook orders down-script before binary. Not lossy (V6). Impossible for revisions
  above the jsonb cap (S2 only); costly in disk/WAL (full copies again).
- **S2 server:** stop, run `down-025-uploads.sql` (aborts and deletes staged rows, drops `ch_uploads`,
  `ch_upload_parents`), deploy S1. Committed S2 revisions are ordinary epoch revisions; S1 deletes leftover garbage
  beyond committed counts before appending (§3), so an S2 → S1 rollback is safe. Collectors must be on `whole` first.
- **S2 collector:** set `uploadProtocol=whole` or install the previous collector; new spool buckets are ignored; heads
  written back by an old collector lose the base fields (next S2 upload is a replacement); live server uploads expire.
- **Lossy/impossible:** S1 down after S2 created a revision above the cap; S2 sessions larger than the old path's
  `maxBodyBytes` can no longer be updated by `whole` collectors (413).

## 10. Bounds and failure modes
- **Disk:** staging ≤ live uploads × `maxFileBytes` (≤ 8 per owner); an append costs its delta (V7); a replacement a full
  epoch (old epoch retained: revisions are immutable until purge). WAL per full part ≈ 40 MB steady, 118 MB after a
  checkpoint (GIN fragment index dominates); today's 233 MB ingest writes 2.2 GB [o V7, V8].
- **Garbage:** expired/aborted/failed uploads swept by `EpochMaintenance`; S1 and S2 writers delete garbage beyond the
  committed maximum before appending; orphan replacement epochs (no revision) deleted with their upload.
- **Interrupted commit / crash:** single transaction; the upload stays `Open`; the collector retries commit (idempotent)
  or resumes parts.
- **Server restart mid-upload:** parts are durable; `GET` status resumes; the TTL keeps the lease 1 h after the last part.
- **Two collectors for one source:** `upload-busy` for the second; commit CAS; same-namespace copies of a spool are the
  only way to get there [i].
- **Clock skew:** TTL and expiry use `clock_timestamp()`; the client only receives `expiresInSeconds`.
- **Statement/idle timeouts:** every statement bounded by 128 rows, one 1 MiB segment or one 8 MiB part; the commit and
  the switch are O(metadata). The admission permit is untouched by parts.
- **Remaining O(session):** worker claim heap (one at a time via the admission), `GetRaw` heap, the first S1 touch of a
  legacy source, replacements, candidate pruning after a replacement (batched, background).

## 11. Work units
Gates (from the worktree root; report counts and wall time): **B** = `T=$(mktemp -d /tmp/u.XXXXXX); nix develop
.#chronicle --command bash -c "export TMPDIR=$T; bash chronicle/scripts/test-postgres.sh"`; **P** = `nix develop
.#chronicle --command bash -c 'cd chronicle/web && npm ci --offline && cd .. && TSC="$PWD/web/node_modules/.bin/tsc"
./scripts/test-codecs.sh'`; **C** = `nix develop .#chronicle --command bash -c 'cd chronicle/collector && npm ci --offline &&
npm run typecheck && npm test'`; after committing **BF** = `nix build --no-link -L .#checks.x86_64-linux.chronicle-backend-full`,
**CF** = `… .#checks.x86_64-linux.chronicle-collector`; integration (orchestrator) `scripts/verify chronicle`.
| unit | goal | owns | depends | tests added (lean) | gates | h |
|---|---|---|---|---|---|---|
| U1 S1 schema + digests | 024 migration, triggers, `ResumableSha256`, `MessageChain` v1 | `migrations/024_epoch_layout.sql`; `Database.scala` initialize list line; new `ResumableSha256.scala`, `MessageChain.scala`; `chronicle/tests/message-chain-v1.json`; new `EpochSchemaTest`, `ResumableSha256Test` | S0 tip | resumable SHA-256 = JDK on random inputs/splits incl. export/resume; chain golden vectors; immutability (update of committed epoch row / revision column refused; delete below committed count refused; purge passes); migration idempotent on restart (013 then 024) | B, BF | 6–9 |
| U2 S1 write path | append/new-epoch/legacy decision, epoch writer, switch, purge, backfill guard, `EpochMaintenance` prune | `Database.scala` (`ingest`, `Jobs.switched`); `ArchiveProjection.scala`; new `EpochWriter.scala`, `EpochMaintenance.scala`; `Auth.scala` purge line; `plugins/ChroniclePlugin.scala` (one `make` line, as `McpTestRuns` [o ChroniclePlugin.scala:49]); tests `EpochIngestTest` (new), `OwnerLeaseBoundaryTest` (1 case), legacy-pinning edits in `ArchiveHeadCandidateTest`, `ArchiveProjectionTest` | U1 | decision cases: Pi append (rows written = delta only), equal revision (0 rows), Codex dedup fixture (non-prefix → new epoch), redaction change, Pi v2→v3 rewrite, Historian, multi-file → legacy; midstate self-check; receipt replay/409/CAS unchanged; ingest parked at an epoch fragment insert: readers see the old head, after commit the new (extends `OwnerLeaseBoundaryTest`); prune with an injected interval + production default asserted | B, BF | 10–14 |
| U3 S1 read path + differential | `RevisionContent`, all readers, archive search | `Database.scala` reader methods (`selectView`, `messages`, `locateMessage`, `content`/`raw`, `claimedSnapshot`); `MessageContext.scala`; `SessionMessageSearch.scala`; `ArchiveSearch.scala`; `ArchiveIndex.scala`; new `RevisionContent.scala`; new `EpochReadDifferentialTest`; `ArchiveContentBoundaryTest` epoch seek plan | U2 (same file: sequential) | one revision sequence (append, append, non-prefix, append) ingested by `Legacy` and `Epochs` archives under two owners: identical GetMessages pages, LocateMessage, MessageContext, Find, ArchiveSearch (lexical global + per-session), GetRaw bytes, claim snapshots, for every revision incl. pinned old ones | B, BF | 8–11 |
| U4 S1 down-script + rehearsal | exact rollback; clone rehearsal | `chronicle/scripts/down-024-epoch-layout.sql`; `nix/pkg/chronicle/source.nix` tests list; new `EpochDownScriptTest`; rehearsal report | U2 (parallel to U3) | after U2's sequence: reads before = after the down-script; snapshots equal a `Legacy` ingest of the same sequence; refusal above the cap (synthetic cap check via a low threshold parameter + production value asserted). Rehearsal on a TEMPLATE copy: S1 binary, next revisions of the 5 largest sessions as appends (time, WAL, lock probe, `/api/versions` probe as ch-fix2 §3), down-script, `verify` reads | B, BF | 5–8 |
| U5 S2 wire | types §4.1, regenerated code, golden fixtures | `models/chronicle.baboon`, `models/lock.json` if needed, `generated/**`, `scripts/codec-fixtures.mjs`, `server/src/test/fixtures/upload-*.json`, `CodecFixtureTest.scala` | S1 merged | new golden fixtures (open with/without base, part, commit, state with receipt/failure, i64 strings); `IngestRequest` fixtures byte-identical | P, BF | 3–4 |
| U6 S2 server | uploads, validation per part, commit, sweep | migration `025_uploads.sql`; new `Uploads.scala`, `UploadValidation.scala` (factored from `SnapshotValidation`, which then calls it); `Core.scala` (validation helpers); `Http.scala` (routes + failure codes); `EpochMaintenance.scala` (sweep); `chronicle/scripts/down-025-uploads.sql`; `CONTRACT.md` Ingestion; `README.md` server paragraph; new `UploadProtocolTest`, `UploadBoundaryTest` | U5 | open/part/commit/status/abort happy path (append and replacement); idempotency: same part replay, changed part 409, out-of-order 409, commit replay, CAS 409; `base-mismatch` (legacy head, wrong chain); `content-mismatch` (Codex fixture appended as if prefix); forward parentId resolved later and unresolved at commit; TTL expiry + sweep with injected TTL/interval, production defaults asserted; atomic visibility (extends `OwnerLeaseBoundaryTest`); part body > limit refused before reading | B, P, BF | 12–16 |
| U7 S2 collector | streaming planner, parts client, resume, spool, status | `chronicle/collector/src/**`, `chronicle/collector/test/**`, `chronicle/collector/README.md`, collector paragraph of `chronicle/README.md`, `nix/hm/chronicle.nix` option | U5 (parallel to U6; against a fake server) | chain golden vectors; append vs replacement (Codex dedup fixture, redaction change, Pi v2→v3 rewrite); resume after restart from spool (parts not resent); `server-upload-unsupported` on a 404; old-format entry drains first; spool from the current release opens; bounded memory: an instrumented reader proves no buffer/part above its bound on a 64 MiB synthetic file | C, CF | 12–16 |
| U8 S2 rehearsal + bounds | on-demand 1 GiB check; clone rehearsal of uploads | `chronicle/scripts/test-upload-bounds.sh` (on-demand, named in `chronicle/README.md`); reports | U6, U7 | on-demand (minutes of I/O; AGENTS.md "On-demand checks"): native server in serve-standby with `-XX:MaxHeapSize=512m` and collector with `--max-old-space-size=256` upload a 1 GiB synthetic session (append + replacement) — both heaps far below the session size; rehearsal on a TEMPLATE copy: parts uploads of the largest sessions, WAL/time/lock, `/api/versions` probe | the script; `scripts/verify chronicle` | 4–6 |
S1 total 29–42 h, S2 total 31–42 h. Parallel: U3 ∥ U4; U6 ∥ U7. File ownership is disjoint between parallel units.

## 12. Decisions needed (owner/orchestrator)
- **D1 Fallback of an S2 collector against a server without the upload API.** (a) explicit `uploadProtocol` switch,
  `server-upload-unsupported` stops the entry (recommended: no silent fallback; rollback = flip the HM option);
  (b) automatic visible fallback to `/api/ingest` per cycle.
- **D2 S2 session limits.** Production `maxFileBytes` 256 MiB and `maxMessages` 100,000 (study §1) bound S2 sessions. Options:
  keep; raise to 512 MiB / 200,000 (recommended until the claim streams messages — D3); raise to 1–2 GiB.
- **D3 Remaining O(session) readers for sessions above 256 MiB.** Worker claim heap and `GetRaw` response.
  (a) accept with D2 ≤ 512 MiB (recommended); (b) add a `GetRaw` byte bound returning `too-large` (contract change);
  (c) follow-up: streamed claim windows and a paged raw read.
- **D4 Superseded epochs' fragments.** Prune candidates in the background (recommended, 44.6 MB WAL per 10,000 rows only
  after replacements) or keep them as candidates (no WAL, GIN grows with replaced epochs).
- **D5 Version policy.** Additive in 1.9.0 (recommended; precedent 3961370f) or bump to 1.10.0 (every client and fixture
  moves; no compatibility gain).
- **D6 Staging bound.** 8 live uploads per owner, TTL 1 h sliding (recommended) or other values.

## 13. S0 note — the "restore policy for 157 tombstones" (not implemented)
When the collector's privacy/destination policy digest changes, every queued entry built under the old policy is dropped
and its source is **tombstoned** [o collector.ts:102-107, spool.ts:222-229]: `head.tombstone=true` makes every later scan
skip the source forever (`counters.excluded`) [o collector.ts:193]. On the owner's host 157 sources are tombstoned this
way (study §1). Restoring them is a policy choice — re-uploading sessions that were dropped because they had been
prepared under an older privacy/destination policy (they would now be uploaded under the current one) — not a bug fix.
Options: (a) keep (nothing is re-sent); (b) one-shot operator command clearing tombstones whose audit reason is
`privacy-or-destination-changed` (the next scan re-reads, re-redacts with the current policy and uploads; `--drop`
tombstones stay); (c) change the rule: a policy change discards queued payloads without tombstoning (future changes
only). Recommendation: (b) plus (c), as an owner decision outside S1/S2.

## Appendix — findings against the design study
1. "Reads go through views named like today's tables, readers change little" — measured: a UNION ALL view sorts the
   whole epoch branch for `ORDER BY position LIMIT` (52 ms vs 0.16 ms first page; locate 14 ms vs 0.02 ms on 28.5k
   messages, O(session)) → query changes through one helper instead.
2. "Head candidates flip only when the epoch changes, so the switch is O(1)" — true for appends; the first S1 ingest of a
   legacy head still prunes that head's fragments (once per source), and a superseded epoch's candidates must be pruned
   outside the switch (114 ms / 44.6 MB WAL per 10,000 rows).
3. The base proof cannot be verified on the server as described (the server never sees the collector's prefix): the
   server checks base = head, then computes head ‖ delta and compares the declared final digest/chain
   (`content-mismatch`). The final declaration moves from open to commit so Pi/Claude appends need one read pass.
4. The collector needs no SHA-256 midstate: Node `Hash.copy()` gives the prefix digest inside one pass; only the server
   stores midstates (JDK cannot export state, V3).
5. Not in the study: the legacy claim detoasts the whole snapshot for its envelope and sorts the message array
   on disk (80 MB) for the largest session (631 + 811 ms); epoch claims take 0.03 ms + 10.7 ms.
6. jsonb cap refined: container overhead counts (max top-level scalar 268,435,447 B; one-key object 268,435,442 B); the
   largest real head is 226.6 MB as jsonb (84 %), not 237 MB (the study measured the text form).
7. Scale of the S1 gain for the largest session's next revision: 1.3 MB vs 2.2 GB WAL and 18 ms vs 65 s of ingest
   (the whole-request decode/validate, 11.3 s, stays until S2) — far above the study's "≈ 34× less message data".
8. The `chronicle` dev shell now pins PostgreSQL 18.7; the clone and the checks used 18.6.
