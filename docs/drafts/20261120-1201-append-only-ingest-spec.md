# Chronicle append-only ingest (plan B) — implementation spec for S1 and S2

Base `0aedcfa8` (`agent/ingest-b`); S1 starts from the S0 tip (S0-COL collector stat-skip/budget/codes, S0-I1 running
jobs survive newer revisions). Tags: **[o F:L]** observed in code at the base, **[o Vn]** observed by check n of
section 0 (evidence in `.local/overhaul-20261117/reports/ingest-b/SPEC/evidence/`), **[i]** inferred, **[u]** not
verified. Design study: `reports/chronicle-ingest-design/DESIGN.md` (§6 B, §7, §8). Out of scope: S3 (legacy
conversion), S4 (retiring `/api/ingest`), S5 (index reuse).

## Summary
- **S1** stores every new epoch-safe single-file revision in an *epoch* (a linear history of one source: messages by
  position, raw by byte offset, fragments by position); a revision is a row `(epoch, message_count, raw_bytes, …)`.
  `/api/ingest` is unchanged on the wire; the server detects "append to the head's epoch" (raw prefix digest + message
  chain) and writes only the delta. Requests the epoch layout cannot represent exactly (several files, raw not ending in
  `\n`) keep today's legacy layout, so every request accepted today is still accepted. Legacy revisions stay as they are.
  Readers change their queries through one helper (`RevisionContent`); views were measured and rejected (O(session) sorts).
  The epoch writer ships behind a layout seam whose production default flips to epochs only in the unit that completes
  the readers.
- **S2** adds an upload API in `chronicle.api` 1.9.0 (additive, precedent 3961370f): open (with the complete declaration)
  → parts (≤ 8 MiB) → commit, with status/resume/abort, per-ordinal part receipts, request intents separate from upload
  attempts, staging owned by one attempt, incremental validation and a base proof; parts are written straight into epoch
  rows past the head's count, so the commit is O(1). Sessions up to the configured raw bound (deployment ≥ 1 GiB, so the
  owner's 556 MB session uploads). Nothing materializes such a revision whole on the server — guards shipped with S1 so
  that any rollback binary has them: `GetRaw` refuses above a raw bound (`too-large`), and an indexing job whose
  estimated retained heap (messages, one vector of the configured dimensions and one chunk per fragment) exceeds a budget
  ends `Failed index-budget-exceeded` before it allocates, with a runtime cap behind the estimate — the session stays
  readable. The collector preflights the whole file (admission, identity, exclusions, declaration) in a pass whose line
  reader and evidence set are capped, before any upload, then sends the delta or the whole content, and resumes.
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
CREATE TABLE IF NOT EXISTS ch_epoch_records(                                  -- raw record ids for parentId resolution (S2)
  epoch uuid NOT NULL REFERENCES ch_epochs(id) ON DELETE CASCADE,
  record_index integer NOT NULL,
  record_key bytea NOT NULL CHECK(octet_length(record_key)=32),               -- SHA-256 of the `id`/`uuid` string (§3)
  PRIMARY KEY(epoch,record_index,record_key));
CREATE INDEX IF NOT EXISTS ch_epoch_records_key ON ch_epoch_records(epoch,record_key);
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
  ADD COLUMN IF NOT EXISTS message_bytes bigint,    -- Σ UTF-8 bytes of the written message values (Wire.encode(Message).noSpaces)
  ADD COLUMN IF NOT EXISTS fragment_count bigint,   -- Σ ceil(text bytes / 2,045) over non-empty texts (indexing budget, §3.1)
  ADD COLUMN IF NOT EXISTS raw_state bytea,         -- SHA-256 midstate after raw_bytes (40..103 B, §5)
  ADD COLUMN IF NOT EXISTS message_chain bytea,     -- chain v1 after message_count messages (32 B, §5)
  ADD COLUMN IF NOT EXISTS message_time text;       -- latest parsed message timestamp (Instant.toString) or NULL
-- added NOT VALID (guarded by a pg_constraint lookup), then VALIDATE (SHARE UPDATE EXCLUSIVE; reads the 648 kB heap only [o V9])
ALTER TABLE ch_revisions ADD CONSTRAINT ch_revisions_layout CHECK(
  (epoch IS NULL AND snapshot IS NOT NULL AND envelope IS NULL AND message_count IS NULL AND record_count IS NULL
     AND raw_bytes IS NULL AND message_bytes IS NULL AND fragment_count IS NULL AND raw_state IS NULL AND message_chain IS NULL
     AND message_time IS NULL)
  OR (epoch IS NOT NULL AND snapshot IS NULL AND envelope IS NOT NULL AND message_count>=0 AND record_count>=0
     AND raw_bytes>=0 AND message_bytes>=0 AND fragment_count>=0 AND raw_state IS NOT NULL AND octet_length(message_chain)=32)) NOT VALID;
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
  `ch_revisions WHERE epoch=OLD.epoch`, index `ch_revisions_epoch`). Rows become deletable only when no revision
  references them (staging, or after purge deleted the revisions).
- `ch_epochs`: `id`, `session_id`, `raw_path` immutable (same function pattern).
`ch_archive_fragments` keeps one role for epoch revisions: their **metadata** fragments (≈ 4–12 rows per revision),
keyed `(session_id, revision, ordinal)` as today; the 017 trigger keeps flipping them [o 017:64-80]. `ch_revision_info`
is unchanged (one row per revision for every layout); `ch_messages` is never written for epoch revisions. S2's migration
025 adds `ch_epochs.tail_upload` (§4.5).

### 1.2 Down-script `chronicle/scripts/down-024-epoch-layout.sql`
Lives outside `chronicle/migrations/` (that directory is a classpath resource root [o build.sbt:147,172,191,278]); the
runner applies only its explicit list, so the script is never applied by a binary. Precedent:
`chronicle/scripts/check-legacy-free.sql`, listed in `tests` of `nix/pkg/chronicle/source.nix:36-39` and exercised by
`LegacyFreeCheckTest`; the down-script is listed there too. Run by an operator with the server stopped, with
`statement_timeout=0`, after the S2 down-script (§9) if S2 was deployed. Steps:
1. **Representability preflight — a read-only phase over every epoch revision, finished before the first mutation.**
   The rebuilt snapshot consists of exactly: the envelope (every request field except messages and files), the messages,
   and one file object with `path` = `raw_path`, `sha256` = the digest (64 characters) and `content` = the raw. Its upper
   bound is `octet_length(envelope::text) + octet_length(raw_path) + 64 + raw_bytes + message_bytes + 128 × message_count
   + 4,096`. `raw_path` is not length-bounded by `SnapshotValidation` (only structured, relative, no `..`
   [o Core.scala:279-280]), so it is counted explicitly [review B4]. Strings are stored unescaped in jsonb, so their text
   forms (envelope text, `message_bytes`, path) are never smaller; 128 B per message cover jsonb's per-node JEntries,
   alignment and numeric widening of a 6-key object [i; U4 proves it with worst-case shapes: many tiny messages with
   nulls and large `recordIndex`], 4 KiB the snapshot, file and array containers. Bound ≤ 268,435,442 (the one-key object
   limit, V1) → representable. Otherwise the phase builds that snapshot exactly (read-only `SELECT` of the E6 expression)
   and records whether PostgreSQL accepts it. Any non-representable revision → the script stops with the list of
   session/revision/bound/exact result before it changes anything.
2. Per source (one transaction each, resumable: a revision with `epoch IS NULL` is done), with
   `ch_immutable_revision` disabled inside the transaction: for every epoch revision write
   `snapshot = envelope || {"messages": [values < message_count by position], "files": [{"path": raw_path,
   "sha256": envelope->>'digest', "content": string_agg(raw segments < raw_bytes by offset)}]}` (the E6 query), set the
   epoch columns NULL, insert `ch_messages` rows (positions < count) and the message fragments
   (`ch_epoch_fragments` positions < count) into `ch_archive_fragments` with `ordinal = metadata count + row_number()`
   and `head_candidate = (revision = ch_sources.revision)`.
3. One final transaction: drop the epoch triggers/functions, constraint, index and columns, `ALTER COLUMN snapshot SET
   NOT NULL`, drop the four row tables and `ch_epochs`, re-create the 013 body of `ch_immutable_revision()`.
Limits: (a) the jsonb cap (step 1). **S1 itself can create a non-representable revision**: a whole request up to
`maxBodyBytes` (≤ 512 MiB [o Core.scala:95]) is stored in an epoch although its snapshot might exceed the cap — today
such a request fails at the snapshot INSERT (a jsonb error, HTTP 500). With production `maxBodyBytes` 256 MiB the largest
real revision rebuilds to 226.6 MB [o V6]; bodies of 256 MiB with unusually many small messages could exceed it.
Decision (D6): S1 does not prevent them (it stores strictly more than today); the preflight lists them and the operator
purges them or stays on S1. S2 sessions above 256 MiB are never representable. (b) disk and WAL: every epoch revision
becomes a full legacy copy again (estimate before running: `Σ raw_bytes + message_bytes` over epoch revisions, ×≈ 2 for
fragments/TOAST/WAL); (c) S2 objects first. Fragment ordinals differ from what a legacy ingest would have produced (the
legacy writer has no ORDER BY [o ArchiveProjection.scala:73]); no reader uses ordinals [o ArchiveIndex.scala:169-171].

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
3. **Line boundaries (epoch revisions only):** `raw_bytes` is 0 or follows a `\n`; every raw segment holds whole lines;
   segments are contiguous (`byte_offset(k+1) = byte_offset(k) + octet_length(content(k))`) and every committed
   revision's `raw_bytes` is a segment boundary (writers start a segment at each revision/part start), so a revision's raw
   is the concatenation of its segments — never a cut. A request that would violate this is stored in the legacy layout
   (§3, L4), where today's representation applies unchanged.
4. **Digests:** `envelope.digest = hex(SHA-256(raw[0..raw_bytes)))` = the file's `sha256`; `raw_state` is that hash's
   midstate; `message_chain` = chain v1 over its messages (§5). The S1 writer re-derives the final digest from the stored
   midstate and checks it against the validated request digest (self-check of the stored state).
5. **Immutability:** committed revision rows never change (trigger); epoch rows covered by any committed revision are
   never updated (except `head_candidate`) or deleted (DELETE guard).
6. **Head:** `ch_sources.revision` names the head; when a switch moves the head to another epoch, the old head's epoch
   becomes `candidates='prune'` in the switching transaction (then `pruned` by the background prune).
7. **Visibility:** readers reach epoch rows only through a committed `ch_revisions` row and `RevisionContent` filters;
   rows beyond every committed count and epochs without a revision are unreachable.
8. **Uniqueness:** message ids are unique per epoch (`UNIQUE(epoch,message_id)`), including staged rows.
9. **Staging ownership (S2):** rows of an epoch beyond its committed maximum belong to exactly one upload attempt,
   `ch_epochs.tail_upload`; an epoch that no revision references belongs to the attempt recorded in its
   `tail_upload`. Only the owner writes there; cleanup of a terminal attempt deletes rows only while it is still the
   owner and happens once (`cleaned`), all under the source's advisory lock (§4.6).

## 3. S1 ingest path (`/api/ingest`, wire unchanged)
Order inside `PostgresArchive.ingest` [o Database.scala:125-161] stays: validation outside the transaction
(`SnapshotValidation.validate`, unchanged, whole body [o Core.scala:265-298]); transaction: owner target, receipt digest
over the canonical request, advisory lock `ingest:owner:key`, receipt replay/409, CAS read of the head without a row lock,
then **layout decision and writes** (new), then `FOR NO KEY UPDATE` re-check, switch, job statements as S0-I1 leaves
them, receipt [o Database.scala:130-157]. HTTP admission unchanged: bodies > 8 MiB still take the one
`SnapshotAdmission` permit before the body is read [o Http.scala:193-196, SnapshotAdmission.scala:14-18]; statement (30 s)
and idle (30 s) timeouts unchanged — every S1 statement is bounded by a batch (128 rows) or a segment (≤ 1 MiB).

**Decision** (head = current revision row; r = request; S = `SnapshotProjection(r)` [o Core.scala:240-246]):
- **Legacy layout** (today's writer, kept) when the request is not epoch-safe: `r.files.size != 1`, or the single file's
  content is non-empty and does not end with `\n` (`SnapshotValidation` accepts a last record without a newline: it splits
  with `linesIterator` [o Core.scala:281]). Neither occurs in the archive (all 7,804 revisions are single-file and
  newline-terminated [o V2]); the Historian extension, the CLI and the relevance eval can send them. Nothing else in an
  accepted request is epoch-unsafe: raw text never contains U+0000 (every non-empty line must parse as JSON), message
  values and ids are stored exactly as in `ch_messages`, and raw record ids are stored as SHA-256 keys (below), so an
  unreferenced record id with an escaped NUL or of any length is representable.
- **Append** when the head is an epoch revision, `r.files(0).path == epoch.raw_path`, `utf8(content).length >=
  head.raw_bytes`, `content[0..raw_bytes)` hashes (JDK digest) to `head.envelope.digest`, `r.messages.size >=
  head.message_count`, and chain v1 of `S.messages[0..message_count)` equals `head.message_chain`.
- **New epoch** otherwise (no head, legacy head, Historian replacement, Codex non-prefix, redaction change, Pi v1/v2 → v3
  rewrite): full write (for a legacy head the one-time first-touch cost, 21.6 s DB for the largest [o V7]).
**Writes (append):** insert `ch_revisions` (epoch, envelope = S without messages/files, counts, `raw_state` =
resume(head.raw_state) + delta bytes, `message_chain` extended over the delta, `record_count`, `message_bytes` and
`fragment_count` = head + delta, `message_time` = max(head.message_time, delta)), `ch_epoch_messages` (delta, batches of 128),
`ch_epoch_raw` (delta from `head.raw_bytes`, ≤ 1 MiB line-aligned segments), `ch_epoch_records` (`SHA-256(id)` of each
delta record's `id`/`uuid` string, as `SnapshotValidation` collects them [o Core.scala:283-284]), fragments: delta
messages via `lower(value->>'text' COLLATE pg_unicode_fast)` read back from `ch_epoch_messages` →
`ArchiveProjection.fragments` → `ch_epoch_fragments(epoch, position, part)` (no cross-message overlap exists:
fragmentation is per field [o ArchiveProjection.scala:56,71-77], so the previous tail is never rewritten); metadata
fragments → `ch_archive_fragments(session, revision, ordinal)`; `ch_revision_info` with `message_count` and
`last_timestamp` = `message_time` orElse `endedAt` orElse `startedAt` (the rule of `ArchiveProjection.latest`
[o ArchiveProjection.scala:41-45], O(delta)). Records are counted with the validation's own line rule applied to the
delta; the count composes because the prefix ends with `\n`. **New epoch:** the same with the whole content into a new
`ch_epochs` row; in the switch transaction the previous head's epoch (if any) becomes `prune`. **Switch** unchanged: one
`UPDATE ch_sources SET revision` under `FOR NO KEY UPDATE`; the 017 trigger now flips only metadata rows of epoch
revisions (for a legacy previous head it prunes that head's fragments once, as today). Measured: append 18 ms / 1.3 MB WAL
/ row lock 2 ms; today 65 s / 2.2 GB [o V7, V8]. With S2 deployed, the append path first applies §4.6's tail rule
(live attempt → 409 `upload-busy`; terminal owner → its tail is deleted once).
- **Receipts/idempotency/CAS** unchanged (digest over the canonical request; same requestId+digest → stored receipt;
  different → 409; `expectedRevision == head`).
- **S0-I1 jobs:** the switch calls S0-I1's job statements unchanged (extract them into `Jobs.switched(c,id,next,profile)`
  so S2's commit reuses them). A running older job reads its own revision's rows, which appends never change.
- **Claim:** `claimedSnapshot` reads `envelope` and streams `ch_epoch_messages … ORDER BY position` (64 per fetch,
  unchanged API); `Claim.snapshot` equals the legacy claim value (no raw files). Worker heap stays O(session) — S1 does
  not change it (study §5); the epoch claim avoids the 0.6 s envelope detoast and the 80 MB sort [o V4]. The indexing
  budget of §3.1 bounds it.
- **`GetRaw`** of an epoch revision: `RawResult(List(RawFile(raw_path, digest, string_agg(segments))), revision)` —
  exact bytes, one response as today (V4: 448 ms for 145.8 MB); bounded by §3.1.
- **Purge** [o Auth.scala:339-342] keeps its statements; epochs are not deleted inline (a writer's revision insert holds
  `KEY SHARE` on its epoch, and purge already holds the source row, so an inline `DELETE FROM ch_epochs` could deadlock
  with a writer waiting for the source [review R2]). `EpochMaintenance` deletes the rows and epochs of tombstoned sources
  in statements of ≤ 10,000 rows (allowed by the DELETE guard because purge removed every revision); content is
  unreachable from the purge's commit on and physically gone within one sweep (decision D7).
- **Backfill** [o ArchiveProjection.scala:92-124]: selects legacy revisions only (`r.epoch IS NULL`); if an epoch
  revision has `lexical_version <> ArchiveProjection.lexicalVersion` it fails start-up with `migration-required`
  (an epoch fragment rebuild is a separate task when the version is next bumped).
- **`EpochMaintenance`** (graph resource like `McpTestRuns`' loop [o McpTestRuns.scala:73-81], interval 60 s, injectable
  for tests): prunes candidates of `prune` epochs (`UPDATE … SET head_candidate=false` on ≤ 10,000 rows per statement,
  `FOR UPDATE SKIP LOCKED`, then `pruned`; 114 ms / 44.6 MB WAL per 10,000 rows [o V7], only after a new epoch) and deletes
  tombstoned sources' epochs. Search correctness never depends on it (join on epoch and count).
- **Layout seam:** `PostgresArchive(db, config, layout: RevisionLayoutPolicy)`, with `RevisionLayoutPolicy.production`
  = `Legacy` until U3 completes the readers and flips it to `Epochs` (§11); `Legacy` also serves the differential tests
  and the existing tests that assert legacy-table behaviour (`ArchiveHeadCandidateTest`, `ArchiveProjectionTest`,
  `ArchiveContentBoundaryTest`'s plan assertion).

### 3.1 Oversize guards (S1, unit U4; every later binary and any S2 → S1 rollback binary carries them)
S1 already stores revisions up to `maxBodyBytes` (≤ 512 MiB [o Core.scala:85,95]) in epochs, and an S2 → S1 rollback
keeps S2's larger ones, so the guards belong to S1. No server path materializes a revision above them.
- **`GetRaw`** (and `content`/`headSnapshot`): the raw size is known before anything is built (epoch: `raw_bytes`;
  legacy: `sum(octet_length(f->>'content'))` over `snapshot->'files'` in SQL). Above `maxRawReadBytes` the read returns
  `too-large` — a documented contract change ("a positive revision pins bytes" stays true; above the bound the bytes are
  retained and exact but not returned by `GetRaw`) [o CONTRACT.md:100-102]. New optional config key `maxRawReadBytes`,
  default = `maxBodyBytes` (so nothing that `/api/ingest` can store becomes unreadable), validated 1..536,870,912
  (`string_agg` cannot build ≥ 1 GiB [o V1]; the JSON response doubles it). Recommended (D1); option: a paged
  `GetRawPage{revision, offset, maxBytes}` over segment boundaries (new operation, dashboard/CLI work).
- **Indexing budget, checked before allocation.** What a job retains until publication: every decoded message
  (`claim.snapshot.messages`, held by `ProblemPassages.Source` for the whole job [o Database.scala:272-283,
  Models.scala:187]); one embedding vector per Problem piece in a `VectorArena` of 8-byte doubles in 2 MiB blocks
  [o VectorArena.scala:7-23, Models.scala:122,165]; each piece's `Chunk` (source slice ≤ 2,048 UTF-8 bytes, summary ≤ 1,000
  scalars, ≤ 16 tags × 64 scalars) in the publication builder [o Models.scala:213, ProblemsPublication.scala:83-87,
  ProblemPassages.scala:14,19-21]. Window fragments are transient (≤ 64 per window, rebuilt per window
  [o ProblemPassages.scala:80-110]). Pieces never join messages and are cut from fragments, and ch-fix2's 698-window job
  had 44,432 chunks against ≤ 44,672 fragments [r ch-fix2 §2-D], so the estimate counts one piece per fragment. With
  `n` messages, `M` message bytes (Σ UTF-8 of the stored values), `F = Σ ceil(text_bytes / 2,045)` over non-empty texts
  (a fragment ends at the last scalar fitting 2,048 B, so all but the last hold ≥ 2,045 B [o ProblemPassages.scala:94])
  and `d = config.embedding.dimensions` (1..4,000):
  `E = 2·M + 256·n + F·(8·d + 13,312)` — decoded strings ≤ 2 B per UTF-8 byte; ≈ 256 B of objects per message; per piece
  the vector and ≤ 13 KiB of chunk text (≤ 4,096 B as UTF-16), summary (≤ 4,000 B), tags (≤ 4,096 B) and objects.
  Inside the claim transaction, after choosing `(source, revision)` and before `claimedSnapshot` runs, `E` is computed
  from stored columns (`message_count`, `message_bytes`, `fragment_count`, written by the epoch writer in O(delta)) or,
  for a legacy revision, from one SQL scan of its `ch_messages` rows (bounded by the old request bound). `E >
  maxIndexingBudgetBytes` → the job becomes `Failed` with error `index-budget-exceeded` (fence + 1, no attempt consumed,
  visible in Activity/`IngestStatus`; `RetryJob` reaches the same verdict until the bound or the dimensions change).
- **Runtime cap** (pieces beyond one per fragment, e.g. an annotation alternating Problem/Context inside fragments):
  `Windows` starts from `2·M + 256·n` and, before `vectors.add` [o Models.scala:165], checks that the retained pieces
  plus the batch stay within the budget at `8·d + 13,312` bytes each; otherwise it raises `index-budget-exceeded`,
  which `failAt` treats as terminal like the annotation-exhaustion codes [o Database.scala:388,
  AnnotationAttempts.scala:15] — so the bound holds whatever the annotator returns.
- **Default** `maxIndexingBudgetBytes` = 2,147,483,647 (new optional config key, `Int`, 1..2,147,483,647). Calibration:
  `36763d39` (n = 28,515, M ≈ 80 MB [o V6, V2], F ≈ 58,000 = 911 windows of ≤ 64 fragments [r ch-fix2 §3.1]) gives
  `E` ≈ 1.30 GB at 768 dimensions, against ch-fix2's measured whole-process peak of 1,525 MB live heap while the five
  largest jobs ran one at a time [r ch-fix2 §3.1] — the estimate is in range and conservative for the job alone. The
  default leaves ≥ 4.4 GB of the 6,554 MB heap bound (80 % of 8 GiB) for the server, small jobs (≤ 100 windows each, the
  other lanes [o Core.scala:58]) and one admitted large decode. Examples: 400,000 short messages at 4,000 dimensions
  → `E` ≥ 18.1 GB → refused before allocation although `M` is ≈ 40 MB [review B3]; the owner's 556 MB session
  (n ≈ 109,000, M ≈ 305 MB, F ≈ 220,000 [i: the clone's ratios]) → `E` ≈ 4.9 GB → stored and readable, not indexed at the
  default (D2).
- The session stays readable above both bounds: pages, locate, context, per-session literal search and Archive lexical
  search are SQL over epoch rows (§1.3) and never decode the session. Other paths stay bounded: `/api/ingest` by
  `maxBodyBytes` and the admission permit; pages, context and literal search by their page/byte/deadline bounds
  [o MessageContext.scala:16-19, SessionMessageSearch.scala:24]; the sweep and the down-script in SQL.

## 4. S2 protocol (additive in `chronicle.api` 1.9.0)
### 4.1 Types (`chronicle/models/chronicle.baboon`)
```
enum UploadPhase { Open Committed Aborted Expired Failed }
data UploadBase { digest: str rawBytes: i64 messageCount: i32 messageChain: str }
root data UploadOpen { requestId: uid source: SourceIdentity expectedRevision: i32 rawPath: str base: opt[UploadBase]
  digest: str rawBytes: i64 messageCount: i32 messageChain: str completion: Completion redacted: bit metadata: Metadata }
root data UploadPart { ordinal: i32 sha256: str raw: str messages: lst[Message] }
data UploadLimits { maxPartBytes: i32 maxRawBytes: i64 maxMessages: i32 }
root data UploadState { uploadId: uid requestId: uid phase: UploadPhase append: bit receivedParts: i32
  receivedRawBytes: i64 receivedMessages: i32 lastPartSha256: opt[str] expiresInSeconds: i32 limits: UploadLimits
  receipt: opt[IngestReceipt] failure: opt[str] }
```
`UploadOpen` carries the **complete declaration** of the resulting revision (final digest, raw bytes, message count,
chain, completion, redaction flag, metadata): the collector knows it after its preflight pass (§6), and binding it at
open makes the request intent replayable without the file (R5). `IngestRequest`, `IngestReceipt`, `Message`, `Metadata`
unchanged. i64 travel as decimal strings [o CONTRACT.md:132].
### 4.2 Endpoints (bearer, Ingest scope, no query, Origin rule as `/api/ingest` [o Http.scala:193-196])
Every body bound is checked against `Content-Length` before reading and enforced while reading (`boundedBytes`
[o Http.scala:27-30]); none of these routes takes the `SnapshotAdmission` permit.

| endpoint | body → result | body bound |
|---|---|---|
| `POST /api/ingest/uploads` | `UploadOpen` → `UploadState` | 64 KiB (`UploadPolicy.maxOpenBytes`) |
| `GET /api/ingest/uploads/{id}` | → `UploadState` | none accepted (0) |
| `POST /api/ingest/uploads/{id}/parts` | `UploadPart` → `UploadState` | 8 MiB (`maxPartBytes`) |
| `POST /api/ingest/uploads/{id}/commit` | empty → `IngestReceipt` | 0 |
| `POST /api/ingest/uploads/{id}/abort` | empty → `UploadState` | 0 |

Inside the open bound every metadata string (title, project, workdir, gitRemote, gitBranch, gitCommit, producer, model,
startedAt, endedAt) is at most 4,096 UTF-8 bytes and `rawPath` at most 4,096 (else `invalid`); tags keep today's 32 × 128
rule [o Core.scala:296]; source fields keep `Check.text(_,256)` [o Core.scala:267-268].
### 4.3 Errors (`Failure{code,message}`; new codes get explicit statuses in `Http.failure` [o Http.scala:33-34], which maps unknown codes to 400)
`invalid` 400 (any per-part validation, part sha mismatch, not line-aligned, field bounds); `unauthorized`/`forbidden`
401/403; `not-found` 404 (unknown or other owner's upload); `conflict` 409 (CAS; requestId bound to another declaration;
an accepted ordinal replayed with another sha256; ordinal ahead of the next expected — the message names it);
`base-mismatch` 409 (open: base ≠ head); `upload-busy` 409 (another live attempt on the source; > 8 live attempts of the
owner; `/api/ingest` while an attempt is live); `content-mismatch` 409 (commit: computed ≠ declared; the attempt becomes
`Failed`); `upload-expired` 409 (part/commit after expiry); `gone` 410 (purged source, also for an attempt aborted by
purge); `too-large` 413 (any body over its bound; declared raw > `maxFileBytes`; declared messages > `maxMessages`; parts
> 1,024); `unavailable` 503.
### 4.4 Limits and lease
`UploadPolicy`: `maxPartBytes` = 8 MiB = `SnapshotAdmission.largeBodyBytes`; per-record cap = one record and its
messages must fit in one part (data: longest line 1.34 MB, largest message 0.6 MB [o V2]); `maxParts` 1,024; raw cap =
config `maxFileBytes`, messages cap = `maxMessages` (both `Int`; positions and `recordIndex` i32, raw offsets i64/bigint).
**Deployment values for S2** (L1: the owner's 556 MB session and a ≥ 600 MB synthetic one must upload): server
`maxFileBytes` = 1,073,741,824 and `maxMessages` = 400,000 (the clone's largest session has 5.1 KB of raw per message,
145.8 MB / 28,515 [o V2]: 1 GiB ≈ 210,000 messages [i]); `maxBodyBytes` stays 268,435,456 (it bounds only `/api/ingest`
and is the default of `maxRawReadBytes`); `maxIndexingBudgetBytes` default (§3.1);
collector `maxFileBytes` = 1,073,741,824, `maxMessages` = 400,000, `maxScanBytes` ≥ `maxFileBytes` (host today 4 GiB);
`maxPayloadBytes` unchanged (whole mode only). Lease: TTL 3,600 s sliding, `expires_at = clock_timestamp() + ttl` set at
open and on every accepted part (DB clock only; the client receives `expiresInSeconds`). At most one live attempt per
source, at most 8 per owner.
### 4.5 Server state (migration `025_uploads.sql`)
- **Intent** = `(owner, source_key, request_id)` bound to `declaration_digest = Wire.hash(Wire.canonical(UploadOpen))`;
  its committed result is the row in `ch_ingest_receipts` [o migrations/001.sql:11] (shared with `/api/ingest`, kept
  forever as today).
- **Attempt** `ch_uploads(id uuid PK, owner, source_key, request_id, attempt int, session_id uuid, declaration jsonb,
  declaration_digest text, epoch uuid, append boolean, base_count int, base_raw_bytes bigint, base_records int,
  base_message_bytes bigint, base_fragment_count bigint, parts int, messages int, raw_bytes bigint, records int,
  message_bytes bigint, fragment_count bigint, raw_state bytea,
  message_chain bytea, max_record_index int, message_time text, phase text, cleaned boolean NOT NULL DEFAULT false,
  receipt jsonb, failure text, expires_at timestamptz, terminal_at timestamptz, UNIQUE(owner,source_key,request_id,attempt))`;
  partial unique indexes `(owner,source_key,request_id) WHERE phase IN('Open','Committed')` (one live-or-committed
  attempt per intent) and `(owner,source_key) WHERE phase='Open'` (one live attempt per source). Phases: `Open →
  Committed | Aborted | Expired | Failed`; terminal phases never change; `cleaned` turns true once. Committed attempts are
  kept (one small row per S2 revision, like receipts); other terminal attempts are deleted 7 days after `cleaned`.
- **Part receipts** `ch_upload_parts(upload uuid, ordinal int, sha256 text, messages_end int, raw_end bigint,
  records_end int, PRIMARY KEY(upload,ordinal))` — every accepted ordinal with its cumulative boundaries (R4).
- **Pending parents** `ch_upload_parents(upload uuid, parent_key bytea, PRIMARY KEY(upload,parent_key))` — forward
  `parentId` references not yet resolved (SHA-256 keys, as records).
- `ALTER TABLE ch_epochs ADD COLUMN tail_upload uuid` — the staging owner (invariant 9).
`session_id` is the head's id, or a reserved new UUID when `expectedRevision = 0`; the `ch_sources` row is created by the
commit, so no revision-0 source is ever visible [i: readers never saw such rows].
### 4.6 Operations (one transaction each, under the advisory lock `ingest:owner:key` [o Database.scala:130]; lock order: advisory → attempt row → source row)
- **Open:** body bound, declaration bounds (§4.2) and `SnapshotValidation`'s source/metadata/tag/timestamp rules
  [o Core.scala:265-275,296-297]; declared raw/messages within limits (413). Intent replay: a receipt for the
  requestId → same digest: `UploadState(Committed, receipt)` of the committed attempt; other digest: 409. A live attempt
  of the intent → same digest: its state; other: 409. Otherwise expire the source's live attempt if its lease passed;
  if another live attempt remains → `upload-busy`. Source tombstoned → `gone`; CAS `expectedRevision == head` (409).
  With `base`: head must be an epoch revision with `raw_path = rawPath` and `envelope.digest, raw_bytes, message_count,
  message_chain` equal to the base, else `base-mismatch` (no attempt created). **Tail rule** on the head epoch: owner
  `tail_upload` live → `upload-busy`; owner terminal and not `cleaned` → delete the tail (rows beyond the committed
  maximum), mark it `cleaned`; then `tail_upload` = the new attempt. Without `base`: a new `ch_epochs` row with
  `tail_upload` = the new attempt. Insert the attempt (`attempt` = previous + 1).
- **Part:** attempt `Open`, lease valid (else `upload-expired`), source not tombstoned (else `gone`); ordinal `< parts`:
  replay — equal `ch_upload_parts.sha256` → current state, different → 409; ordinal `> parts` → 409; `== parts`:
  recompute the part digest (§5) = `sha256` (else `invalid`); raw empty or ending `\n`, every non-empty line a JSON value
  (records counted with the shared `SnapshotValidation` line rule), scalar Unicode; every message checked as today
  [o Core.scala:292-294]; positions assigned by the server (contiguous from `base_count + messages`); `recordIndex <
  base_records + records + this part's records` or recorded in `max_record_index`; `parentId` resolved by
  `SHA-256(parentId)` against `ch_epoch_records` and by id against `ch_epoch_messages` of the epoch (committed + this
  attempt's staging), else inserted into `ch_upload_parents`; keys introduced by the part delete matching pending
  parents; duplicate id → unique violation → `invalid`; write messages, raw segment(s) at `base_raw_bytes + raw_bytes`,
  records, fragments (`head_candidate` true; unreachable until commit); insert the part receipt; extend `raw_state`
  (resumable SHA-256), `message_chain`, counters, `message_bytes`, `fragment_count`, `message_time`, `expires_at`. ≈ 1.1 s and ≈ 40 MB WAL
  per full part [o V7].
- **Commit:** attempt `Committed` → stored receipt (replay). `Open` and lease valid: computed digest, raw bytes, message
  count and chain equal the declaration, `ch_upload_parents` empty, `max_record_index < base_records + records` — else
  `content-mismatch`, phase `Failed`. Then source not tombstoned, CAS again, create `ch_sources` for a new source,
  `ch_revisions` (envelope from the declaration with `SnapshotProjection` applied to metadata, counts, `message_bytes`,
  `fragment_count`),
  `ch_revision_info`, metadata fragments, `tail_upload` NULL, epoch `current` (the previous head's epoch `prune` for a
  replacement), `FOR NO KEY UPDATE` switch, `Jobs.switched`, receipt in `ch_ingest_receipts(owner, source_key,
  request_id, declaration_digest)` and in the attempt, phase `Committed`. O(metadata), no staged-row update.
- **Status/abort:** `GET` returns the attempt's state (expiring it first if its lease passed). Abort: `Open` → `Aborted`;
  terminal → current state.
- **`/api/ingest` on the source** (S2 adds to §3): a live attempt → 409 `upload-busy` (an old collector shows
  `cas-conflict`; needs two writers for one source key [i]); a terminal, uncleaned tail owner → its tail is deleted and
  it is marked `cleaned` before the append.
- **Purge** (S2 adds to §3, first statement, before the source update): `UPDATE ch_uploads SET phase='Aborted',
  failure='purged' WHERE owner=? AND source_key=? AND phase='Open'` — it waits for an in-flight part or commit holding the
  attempt row, then both writers and purge take attempt → source in the same order (no cycle); a later part/commit sees
  the tombstone → `gone`.
- **Sweep** (`EpochMaintenance`): `Open` past `expires_at` → `Expired`; for each terminal attempt not `cleaned`, under
  `pg_try_advisory_xact_lock` of its source (skip when busy): if `epoch.tail_upload` = the attempt, delete its staging
  (append: rows beyond the committed maximum; replacement: the epoch's rows, then the epoch) in statements of ≤ 10,000
  rows and set `tail_upload` NULL; mark `cleaned` (also when another attempt already took the tail over). Deletes
  terminal attempts 7 days after `cleaned` (committed ones stay).
### 4.7 Memory
Server, per request: one part (≤ 8 MiB body, its decode and fragments), open ≤ 64 KiB, commit O(metadata). No request
materializes a session.
### 4.8 Oversize guards
Defined and shipped in S1 (§3.1, U4); S2 adds no materializing path. The `ch_uploads` counters `message_bytes` and the
part writer's `fragment_count` give a committed S2 revision the columns the budget reads.

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
  count, chain); during parts it extends its own midstate and chain from the head's stored state over the received bytes
  and messages (O(delta)); at commit the results equal the declaration bound at open. The server cannot see the
  collector's prefix; a wrong local prefix decision (bug, file changed between the collector's passes) yields
  `content-mismatch`, because the declaration covers the collector's full raw while the server computes head ‖ delta.
- **`base-mismatch`** (409 at open; no attempt) and **`content-mismatch`** (409 at commit; attempt `Failed`) make the
  collector re-plan as a **replacement** under a new requestId (the old intent never commits): open without `base` → new
  epoch, all content in parts. A replacement that ends in `content-mismatch` stops the entry with
  `upload-content-mismatch` (a collector bug or a file that keeps changing).

## 6. Collector (S2)
- **Config:** `uploadProtocol: "parts" | "whole"` (default `parts`; `whole` = today's `/api/ingest` path, the explicit
  rollback switch); Home Manager option `chronicle.collector.uploadProtocol` (string enum; `limits` takes integers only
  [o nix/hm/chronicle.nix:128-132]). Limits for the 1 GiB deployment: §4.4.
- **Spool** (existing spools open unchanged; new buckets only, so a downgraded collector ignores them):
  `head` rows gain optional `rawBytes, recordCount, messageCount, messageChain` (absent = unknown base → replacement;
  written after every acknowledgement, in `whole` mode too, because an S1 server stores the same digest and chain, so a
  later switch to `parts` appends); bucket `upload` keyed by requestId `{requestId, sourceKey, open (the complete
  UploadOpen JSON, ≤ 64 KiB), uploadId, append, baseFileOffset, file {dev, ino, size, mtimeNs, ctimeNs}, partBudget,
  partsAcked, lastPartSha256, policyDigest, evidence, origin, status, attempts, nextAt, error}` and index `source-upload`
  (not `source-pending`: an old collector would refuse that source with `source-already-pending` [o spool.ts:174]). No
  content is spooled: parts are regenerated from the file. The entry, with its declaration, is written **before** the
  open is sent (R5).
- **Draining:** a source with a queued old-format `pending` entry uploads it through `/api/ingest` first (as today); no
  upload is planned for it until that entry is acknowledged or dropped.
- **Pass 1 — preflight, before any network mutation** (R3; replaces `readSnapshot` + `parseTranscript` holding the
  file [o discovery.ts:124-149, parsers.ts:88-110]): open with the same identity/symlink/stat checks, read to the size
  observed at open (must end with `\n`, else the partial-line rule applies), a 1 MiB buffer splits lines. The line reader
  (shared by every pass) enforces `maxRecordBytes` = 2,031,616 (2 MiB − 64 KiB; one record's part carries its raw line
  JSON-escaped (≤ 2×) and its messages, whose encoded text derives from that line [i: ≤ 2× more], so a record under the
  cap fits an 8 MiB part) **while reading**: a line that reaches the cap stops the pass with the quarantine code
  `record-too-large` (size ≥ cap, cap) before `JSON.parse` and before any network call; the reader never holds more than
  the cap (largest observed line 1,344,233 B [o V2]; D9). Per line: `JSON.parse`, depth check, redaction, redacted raw line, the `excludedTranscript` project/session checks and the
  `evidenceFor` cwd paths [o collector.ts:22-37, controls.ts:28-43], Claude session/agent identity consistency
  [o parsers.ts:124-133], record id, metadata last-wins and title rule [o parsers.ts:149-158,181-188], normalization,
  SHA-256 (Node) of the redacted raw, chain v1, counts, message bytes; at record `head.recordCount` it records
  `hash.copy().digest()`, the chain, raw bytes, message count and the file offset (base check). **Codex** first runs a
  multiset pass for the file-wide `event_msg` dedup, keeping `SHA-256(role ‖ 0x00 ‖ text)` per `response_item` message
  (32 B instead of the text [o parsers.ts:159-173]). At the end the whole file has passed admission, exclusion, identity
  and limits exactly as today, and the complete declaration is known. Any exclusion or identity failure → the existing
  outcome, nothing sent. The admission evidence is a set of distinct `cwd` values, each resolved once with
  `pathAliases`; it is capped at 1,024 per file: the 1,025th distinct value stops the pass with the quarantine code
  `admission-evidence-limit` (nothing sent; status line with the count) [review B2]. Memory: 1 MiB buffer + ≤ 2 MiB
  line + ≤ 1,024 evidence paths + Codex multiset (≤ `maxMessages` × ≈ 80 B, ≤ 32 MB at 400,000) + metadata.
- **Append vs replacement:** base fields known and all equal (raw bytes, prefix digest, message count, chain) → append
  with `base`, pass 2 seeks to `baseFileOffset`; otherwise replacement, pass 2 reads from the start.
- **Live controls** (pause, exclusions, admission origin) are re-checked with the stored evidence before the open, each
  part and the commit, as the current upload loop does for queued payloads [o collector.ts:221-228]; a held entry waits
  (nothing aborted).
- **Pass 2 — upload:** greedy packing of whole records (raw line + its messages) up to the server's `maxPartBytes` minus
  envelope margin, measured on the encoded part; a record whose encoded part alone exceeds it → `record-too-large`
  (exact check behind the read cap). Sequential: send, then persist `partsAcked`/`lastPartSha256`. The file's stat must stay equal to pass 1's until
  the commit; otherwise abort the attempt and re-plan next cycle.
- **Resume** (restart, timeout, 5xx): first recover the outcome without the file — `GET` the attempt; on 404 or a
  terminal phase replay the open with the stored declaration (a committed intent returns its receipt; an uncommitted one
  gets a new attempt). Only then regenerate: re-run the passes, check that the recomputed declaration equals the stored
  one and that part `receivedParts-1` hashes to `lastPartSha256`, and continue from `receivedParts`; any difference →
  abort the attempt, drop the intent and re-plan with a new requestId. `upload-expired` → open replay (new attempt);
  `upload-busy` → back-off.
- **Commit:** after the last part and the stat check; on the receipt store the new head with the base fields.
- **Server without the upload API** (L2): before the first upload of a cycle the collector probes `GET
  /api/ingest/uploads/00000000-0000-0000-0000-000000000000` — an S2 server answers `404 {"code":"not-found",…}`, an older
  one `404` without a `Failure` JSON body [i from Http.scala routes: no `/api` GET route matches]. On the latter the
  cycle uploads no parts, entries keep their status and attempts (no per-entry stop), `--status` and the progress report
  carry one collector-level line `server-upload-unsupported` ("the server has no part-upload API; upgrade it or set
  uploadProtocol=whole"), and the next cycle probes again, so the condition clears itself after the server upgrade. No
  automatic fallback to `whole`; queued old-format entries still drain (they are whole payloads already).
- **S0-COL codes:** `snapshot-too-large` (file > `maxFileBytes`), `message-limit`, `scan-budget-deferred` unchanged;
  `payload-too-large` and `server-payload-too-large` apply to `whole` mode and old-format drains only; new: the
  collector-level `server-upload-unsupported`; per entry `upload-too-large` (413, with size and the server limit),
  `record-too-large`, `admission-evidence-limit`, `upload-content-mismatch`; counters gain `replacements`. The progress report wire is unchanged
  (`uploadedBytes` = acknowledged part bytes; `error` carries `server-upload-unsupported`).
- **Privacy/destination policy change** during an upload: the entry is aborted and dropped like a queued payload today
  [o collector.ts:102-107] (see §13).

## 7. Atomic visibility
- **S1:** one transaction as today (study/ch-fix2 §2-A): the revision row, its rows, switch, jobs and receipt become
  visible at commit; REPEATABLE READ readers see the old head or the new one, never part of it; the old revision's rows
  are unchanged by an append. Rollback discards everything.
- **S2 parts:** each part commits rows that are MVCC-visible but unreachable: beyond every committed count of the head's
  epoch (append) or in an epoch no revision references (replacement); head search filters `position <
  c.message_count` and joins on the head's epoch. **Commit** is the only transaction that makes the revision visible;
  readers before it see the previous head (and pinned revisions stay exact). **Failure/abort/expiry/purge:** nothing
  becomes visible; staging is deleted only by its owner's one-shot cleanup (invariant 9), never below a committed count
  (DELETE guard).
- Tests: §11 U3 (S1, ingest parked inside its transaction) and U6 (parts committed while a reader holds a pinned view
  and a REPEATABLE READ transaction; after commit the new revision appears whole), both extending
  `OwnerLeaseBoundaryTest`.

## 8. Compatibility and version policy
Rules: one Baboon schema edited in place, VersionInfo `1.9.0` [o CONTRACT.md:3,137-139]; explicit removed/future-version
rejection concerns the WebSocket/RPC negotiation [o VersionedWire.scala:8-15, ApiVersionCompatibilityTest]; additive
in-place precedent 3961370f (enum value, `lock.json` unchanged) [o git]. **S2 is additive in 1.9.0** — new root types and
endpoints only; `IngestRequest`/`IngestReceipt` codecs and their golden fixtures unchanged; `ApiVersionCompatibilityTest`
unchanged; new golden fixtures for `UploadOpen`, `UploadPart`, `UploadState` in `scripts/codec-fixtures.mjs`/
`CodecFixtureTest`. [u] whether the pinned Baboon re-generation accepts the changed 1.9.0 signature without a `lock.json`
update; if it refuses, update the lock entry in the same commit (it locks only 1.9.0). Contract changes (CONTRACT.md):
with S1 (U4) `GetRaw` → `too-large` above `maxRawReadBytes`, the job error `index-budget-exceeded`, the two optional config
keys `maxRawReadBytes` and `maxIndexingBudgetBytes`, purge's physical deletion by the sweep; with S2 (U6) the upload
endpoints.

| | server ≤ S1 (no upload API) | server S2 |
|---|---|---|
| collector ≤ S0-COL | `/api/ingest`; S1 stores deltas; > `maxBodyBytes` → 413 → `server-payload-too-large` (stopped) | same; a source with a live upload attempt (only with two writers) → 409 → `cas-conflict` |
| collector S2, `parts` | probe 404 without JSON → collector-level `server-upload-unsupported` line, no parts sent, entries keep status, re-probed every cycle; old-format entries drain | parts; append/replacement; sessions up to the server's `maxFileBytes`; `--status` shows parts acked and replacements |
| collector S2, `whole` | as an old collector (+ S0-COL codes) | as an old collector |

Other `/api/ingest` clients (Historian extension, 8 MiB cap [o chronicle-upload.ts:18,72]; CLI `ingest`
[o cli/src/main.ts:125-142]; relevance eval [o workflow_v3.py:278]) are unchanged; their revisions go through §3
(Historian: a new 1-message epoch per revision; a raw without a final newline: legacy layout). The CLI `raw` command
receives `too-large` above the raw bound. Rollout: server S1 → server S2 → collectors per host; S4 retires `/api/ingest`
later. Acceptance after rollout (not a test; live data): the owner's 556 MB session reaches `Committed` and appears as
the head with its message count.

## 9. Rollback
- **S1:** stop the server, run `down-024-epoch-layout.sql` (§1.2), deploy the S0 binary. A pre-S1 binary must not
  run against epoch revisions: it would read `ch_messages` (empty for them) and serve empty pages with non-zero totals
  [i from Database.scala:217-225]; the runbook orders down-script before binary. Not lossy (V6) for representable
  revisions; impossible for revisions above the jsonb cap — S2 sessions above 256 MiB and, rarely, S1 revisions near
  `maxBodyBytes` (§1.2, D6); costly in disk/WAL (full copies again).
- **S2 server:** stop, run `down-025-uploads.sql` (aborts live attempts, deletes their staging, drops `ch_uploads`,
  `ch_upload_parts`, `ch_upload_parents`, `ch_epochs.tail_upload`), deploy S1. Committed S2 revisions are ordinary epoch
  revisions, and the S1 binary carries both guards (§3.1), so the large ones stay readable and are refused by `GetRaw`
  and indexing exactly as under S2 (U8 runs this rollback with the large fixture). Collectors must be on `whole` first.
- **S2 collector:** set `uploadProtocol=whole` or install the previous collector; new spool buckets are ignored; heads
  written back by an old collector lose the base fields (next S2 upload is a replacement); live server attempts expire.
- **Lossy/impossible:** S1 down after a non-representable revision exists; S2 sessions larger than `maxBodyBytes` can no
  longer be updated by `whole` collectors (413).

## 10. Bounds and failure modes
- **Disk:** staging ≤ live attempts × `maxFileBytes` (≤ 8 per owner); an append costs its delta (V7); a replacement a full
  epoch (old epoch retained: revisions are immutable until purge). WAL per full part ≈ 40 MB steady, 118 MB after a
  checkpoint (GIN fragment index dominates); today's 233 MB ingest writes 2.2 GB [o V7, V8]; a 1 GiB replacement ≈ 128
  parts ≈ 2.5 min of server time and ≈ 5 GB WAL [i from V7].
- **Garbage:** terminal attempts cleaned once by their staging owner (sweep, next open, or `/api/ingest`); tombstoned
  sources' epochs deleted by the sweep; orphan replacement epochs deleted with their attempt.
- **Interrupted commit / crash:** single transaction; the attempt stays `Open`; the collector recovers by `GET`/open replay
  before regenerating anything.
- **Server restart mid-upload:** parts are durable with per-ordinal receipts; the lease runs 1 h after the last part.
- **Two collectors for one source:** `upload-busy` for the second; commit CAS; same-namespace copies of a spool are the
  only way to get there [i].
- **Purge during an upload:** purge aborts the live attempt first (lock order attempt → source, as writers); the
  in-flight part or commit finishes or sees `gone`; staging is cleaned by the sweep.
- **Clock skew:** TTL and expiry use `clock_timestamp()`; the client only receives `expiresInSeconds`.
- **Statement/idle timeouts:** every statement bounded by 128 rows, one 1 MiB segment, one 8 MiB part or 10,000 cleanup
  rows; the commit and the switch are O(metadata). The admission permit is untouched by uploads.
- **Large sessions:** `GetRaw` refuses above `maxRawReadBytes`; jobs whose estimated retained heap exceeds
  `maxIndexingBudgetBytes` end `index-budget-exceeded` before allocating, and a runtime cap stops a job whose pieces
  outgrow the estimate; pages, locate, context, literal and Archive search stay available. Remaining
  O(session) work: the first S1 touch of a legacy source, replacements, candidate pruning after a replacement (batched,
  background), the down-script.

## 11. Work units
Gates (from the worktree root; report counts and wall time): **B** = `T=$(mktemp -d /tmp/u.XXXXXX); nix develop
.#chronicle --command bash -c "export TMPDIR=$T; bash chronicle/scripts/test-postgres.sh"`; **P** = `nix develop
.#chronicle --command bash -c 'cd chronicle/web && npm ci --offline && cd .. && TSC="$PWD/web/node_modules/.bin/tsc"
./scripts/test-codecs.sh'`; **C** = `nix develop .#chronicle --command bash -c 'cd chronicle/collector && npm ci --offline &&
npm run typecheck && npm test'`; after committing **BF** = `nix build --no-link -L .#checks.x86_64-linux.chronicle-backend-full`,
**CF** = `… .#checks.x86_64-linux.chronicle-collector`; integration (orchestrator) `scripts/verify chronicle`. Every unit
passes its gates on its own: until U3 the production layout is `Legacy`, so no epoch revision exists outside tests.
`Database.scala` is edited by U1 (initialize list), U2 (`ingest`, `Jobs.switched`), U3 (reader methods,
`claimedSnapshot`, the seam default), U4 (`claim` budget, `raw`/`content` bound, `failAt` terminal code) and U6
(`ingest`'s upload check) — always sequentially. `Core.scala`: U4 (config keys), then U6 (validation helpers);
`CONTRACT.md`: U4 (guards), then U6 (Ingestion).

| unit | goal | owns | depends | tests added (lean) | gates | h |
|---|---|---|---|---|---|---|
| U1 S1 schema + digests | 024 migration, triggers, `ResumableSha256`, `MessageChain` v1 | `migrations/024_epoch_layout.sql`; `Database.scala` initialize list; new `ResumableSha256.scala`, `MessageChain.scala`; `chronicle/tests/message-chain-v1.json`; new `EpochSchemaTest`, `ResumableSha256Test` | S0 tip | resumable SHA-256 = JDK on random inputs/splits incl. export/resume; chain golden vectors; immutability (update of a committed epoch row / revision column refused; delete below a committed count refused; delete after the revisions are gone passes); migration idempotent on restart (013 then 024) | B, BF | 6–9 |
| U2 S1 writer behind the seam | layout decision (legacy for multi-file / no final newline), epoch writer, hashed record keys, `message_bytes`/`fragment_count`, switch, backfill guard, `EpochMaintenance` (prune, tombstoned epochs) | `Database.scala` (`ingest`, `Jobs.switched`); `ArchiveProjection.scala`; new `EpochWriter.scala`, `EpochMaintenance.scala`; `plugins/ChroniclePlugin.scala` (one `make` line, as `McpTestRuns` [o ChroniclePlugin.scala:49]); new `EpochIngestTest`; legacy pinning in `ArchiveHeadCandidateTest`, `ArchiveProjectionTest` | U1 | with `Epochs`, asserted on tables: Pi append writes only the delta, equal revision writes no rows, Codex dedup fixture / redaction change / Pi v2→v3 rewrite / Historian → new epoch, multi-file and no-final-newline → legacy, unreferenced record id with an escaped NUL accepted; midstate self-check; receipt replay/409/CAS; prune and tombstoned-epoch deletion with an injected interval + production default asserted; production layout still `Legacy` asserted | B, BF | 10–14 |
| U3 S1 readers, differential, enable | `RevisionContent`, every reader, archive search, flip the production layout to `Epochs` | `Database.scala` reader methods (`selectView`, `messages`, `locateMessage`, `content`/`raw`, `claimedSnapshot`) and the seam default; `MessageContext.scala`; `SessionMessageSearch.scala`; `ArchiveSearch.scala`; `ArchiveIndex.scala`; new `RevisionContent.scala`; new `EpochReadDifferentialTest`; `ArchiveContentBoundaryTest` epoch seek plan; `OwnerLeaseBoundaryTest` (1 case) | U2 | one revision sequence (append, append, non-prefix, append, no-final-newline, NUL record id) ingested by `Legacy` and `Epochs` archives under two owners: identical GetMessages pages, LocateMessage, MessageContext, Find, ArchiveSearch (global + per-session), GetRaw bytes, claim snapshots for every revision incl. pinned old ones; ingest parked at an epoch fragment insert: readers see the old head, after commit the new; production default `Epochs` asserted | B, BF | 9–12 |
| U4 S1 guards, down-script, rehearsal | §3.1 guards (raw bound, indexing budget + runtime cap, config keys, contract); exact rollback with a complete representability preflight; clone rehearsal | `Database.scala` (`claim`, `raw`/`content`, `failAt`); `Models.scala` (`Windows` cap); `Core.scala` (config keys); `CONTRACT.md` (GetRaw, job error, config, purge); `chronicle/scripts/down-024-epoch-layout.sql`; `nix/pkg/chronicle/source.nix` tests list; new `OversizeGuardTest`, `EpochDownScriptTest`; rehearsal report | U3 | `GetRaw` above a small configured bound → `too-large` without building the raw, below → bytes; 20,000 one-word messages at 4,000 dimensions with a budget the message bytes alone would pass → `Failed index-budget-exceeded` before `claimedSnapshot`, attempts unchanged, the session still pages/locates/searches (B3); an annotator stub splitting every fragment into many pieces → runtime cap ends the job `index-budget-exceeded`, terminal; defaults asserted. Down-script: U3's sequence reads equal before/after and snapshots equal a `Legacy` ingest; the bound holds for worst-case shapes; a revision with a long `raw_path` (low threshold parameter) is refused before any mutation (B4). Rehearsal on a TEMPLATE copy: S1 binary, next revisions of the 5 largest sessions as appends (time, WAL, lock probe, `/api/versions` probe as ch-fix2 §3), down-script, reads | B, BF | 12–16 |
| U5 S2 wire | types §4.1, generated code, golden fixtures | `models/chronicle.baboon`, `models/lock.json` if needed, `generated/**`, `scripts/codec-fixtures.mjs`, `server/src/test/fixtures/upload-*.json`, `CodecFixtureTest.scala` | S1 merged | golden fixtures (open with/without base, part, state with receipt/failure, i64 strings); `IngestRequest` fixtures byte-identical | P, BF | 3–4 |
| U6 S2 server | intents/attempts, parts with receipts, staging ownership, commit, sweep, purge abort, `/api/ingest` busy check | migration `025_uploads.sql`; new `Uploads.scala`, `UploadValidation.scala` (factored from `SnapshotValidation`, which then calls it); `Core.scala` (validation helpers); `Http.scala` (routes, bounds, failure codes); `Database.scala` (`ingest` check); `Auth.scala` (purge first statement); `EpochMaintenance.scala` (sweep); `chronicle/scripts/down-025-uploads.sql`; `CONTRACT.md` Ingestion; `README.md` server paragraph; new `UploadProtocolTest`, `UploadBoundaryTest` | U5 | append and replacement happy paths; idempotency: replay of the last and of an older ordinal (same/different sha), out-of-order 409, commit replay, open replay after commit and after expiry (new attempt), CAS 409; `base-mismatch`; `content-mismatch` (Codex fixture sent as if prefix); forward `parentId` resolved later / unresolved at commit; abort-A/open-B/stage-B/sweep-A/commit-B → B complete (R1); purge racing a part and a commit → `gone`, no deadlock (R2); every body bound refused before reading; TTL expiry + sweep with injected TTL/interval, defaults asserted; atomic visibility (extends `OwnerLeaseBoundaryTest`) | B, P, BF | 14–18 |
| U7 S2 collector | preflight + upload passes with a capped line reader and evidence set, parts client, resume, probe, spool, status | `chronicle/collector/src/**`, `chronicle/collector/test/**`, `chronicle/collector/README.md`, collector paragraph of `chronicle/README.md`, `nix/hm/chronicle.nix` option | U5 (parallel to U6; against a fake server) | chain golden vectors; append vs replacement (Codex dedup fixture, redaction change, Pi v2→v3 rewrite); an excluded cwd / a mixed Claude identity in the last record → nothing sent (R3); lost commit ACK with the file changed → receipt recovered from the stored declaration (R5); expiry → new attempt, parts resent; probe 404 without JSON → collector-level line, entries unchanged, next cycle uploads once the fake server supports it (L2); old-format entry drains first; spool from the current release opens; bounded memory: an instrumented reader proves no buffer/part above its bound on a 64 MiB synthetic file; a 3 MiB single line → `record-too-large`, the reader never above the cap, nothing sent; 1,025 distinct `cwd` values → `admission-evidence-limit`, nothing sent (B2) | C, CF | 15–19 |
| U8 S2 acceptance + rehearsal | on-demand large-session check with normal workers, S2 → S1 rollback leg; clone rehearsal | `chronicle/scripts/test-upload-bounds.sh` (on-demand, named in `chronicle/README.md`); reports | U6, U7 | on-demand (minutes of I/O; AGENTS.md "On-demand checks"): the test instance uses the production deployment limits of §4.4 (server and collector `maxFileBytes` 1,073,741,824, `maxMessages` 400,000; collector `maxScanBytes` 2 GiB) and a synthetic Pi session of 1,000,000,000 raw bytes (≈ 196,000 messages; ≥ 600 MB and within the limits) uploaded as a replacement and then appended to; an open declaring 1,073,741,825 bytes is refused 413 (B5). Native server in `serve` with workers and the stub model server, `-XX:MaxHeapSize=768m`, `maxIndexingBudgetBytes` scaled to that heap (production defaults asserted by U4); collector `--max-old-space-size=256`: the session uploads completely; its job ends `Failed index-budget-exceeded`; `GetRaw` returns `too-large`; pages/context/literal search answer; a 16 MiB session on the same server is indexed and published; no OOM; `/api/versions` probe < 1 s. Rollback leg (B1): stop, run `down-025-uploads.sql`, start the S1 binary with workers: the same verdicts, no OOM. Rehearsal on a TEMPLATE copy: parts uploads of the largest sessions, WAL/time/lock | the script; `scripts/verify chronicle` | 6–8 |

S1 total 37–51 h, S2 total 38–49 h. Parallel: U6 ∥ U7 only (disjoint files). U4 after U3; U5 before U6/U7.

## 12. Decisions needed (owner/orchestrator)
Settled by the lead in round 1: no automatic fallback to `whole` (collector-level probe, §6); S2 admits ≥ 1 GiB (§4.4).
- **D1 `GetRaw` above `maxRawReadBytes`:** (a) explicit `too-large`, documented contract change (recommended; the bytes
  stay exact and retained); (b) a paged raw read operation (dashboard/CLI work; the CLI `raw` command would page).
- **D2 Indexing of very large sessions:** (a) the §3.1 budget with `maxIndexingBudgetBytes` 2 GiB − 1 (recommended; the
  556 MB session is stored and readable but not indexed, `E` ≈ 4.9 GB [i]); (b) a larger pod heap with a proportional
  budget (that session needs a budget ≥ 4.9 GB, i.e. a heap of ≈ 10 GiB); (c) a follow-up that streams the claim and publishes in parts, outside S2's
  budget.
- **D3 Superseded epochs' fragments:** prune candidates in the background (recommended, 44.6 MB WAL per 10,000 rows, only
  after replacements) or keep them as candidates (no WAL, GIN grows with replaced epochs).
- **D4 Version policy:** additive in 1.9.0 (recommended; precedent 3961370f) or bump to 1.10.0 (every client and fixture
  moves; no compatibility gain).
- **D5 Staging bound:** 8 live attempts per owner, TTL 1 h sliding (recommended) or other values.
- **D6 S1 revisions that cannot be downgraded** (bodies near `maxBodyBytes` whose snapshot exceeds the jsonb cap): store
  them and let the down-script list them (recommended; today they fail with a 500) or reject them in S1 with
  `too-large`.
- **D7 Purge's physical deletion of epochs:** by the sweep within one interval (recommended; no wait, no deadlock) or
  inline under the source's advisory lock (purge waits for, or times out behind, a running ingest of up to tens of
  seconds).
- **D8 Deployment limits:** server `maxFileBytes` 1 GiB, `maxMessages` 400,000; collector the same (§4.4) — confirm.
- **D9 Collector caps in parts mode:** a record (raw line) cap of 2,031,616 B and 1,024 distinct `cwd` values per file
  (recommended; observed maxima 1,344,233 B and a handful) or larger single-record parts through the admission permit
  (more server work); a line above the cap quarantines the session in parts mode (`record-too-large`).

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

## 14. Review round 1 resolutions
| item | verdict | where |
|---|---|---|
| R1 stale cleanup deletes a newer attempt's staging | holds → fixed: staging owner `ch_epochs.tail_upload`, one-shot `cleaned`, the same tail rule at open, `/api/ingest` and sweep; regression abort-A/open-B/stage-B/sweep-A/commit-B | §2 inv. 9, §4.5, §4.6, §7, U6 |
| R2 purge vs writer lock cycle; purge leaves attempts | holds (a writer's revision insert takes `KEY SHARE` on the epoch, purge holds the source and would `DELETE` the epoch) → fixed: no inline epoch delete (sweep deletes tombstoned sources' epochs), purge aborts live attempts first with the writers' order attempt → source, parts/commit check the tombstone | §3 Purge, §4.6, §10, D7, U6 |
| R3 parts before whole-file admission | holds (today admission, exclusions and identity see the whole file [o collector.ts:144-217, parsers.ts:124-133]) → fixed: complete preflight pass before any network mutation, live controls re-checked before open/part/commit, stat stable until commit | §6, U7 |
| R4 replay of older ordinals | holds → fixed: per-ordinal receipts `ch_upload_parts` | §4.5, §4.6, U6 |
| R5 intent vs attempt, terminal replay, lost commit ACK | holds → fixed: intent = requestId + declaration digest (result in `ch_ingest_receipts`), attempts numbered under partial unique indexes, committed attempts kept; the declaration moves into `UploadOpen` and is spooled before the open; recovery by GET/open replay before regenerating | §4.1, §4.5, §4.6, §5, §6, U6, U7 |
| R6 limits and O(session) paths | holds → fixed with L1: ≥ 1 GiB deployment limits, `GetRaw` bound, claim guard (moved to S1 and made a budget in round 2), every body bounded, U8 with normal workers | §3.1, §4.2, §4.4, §10, U4, U8, D1, D2, D8 |
| R7 accepted inputs the epoch layout cannot hold | holds (`linesIterator` accepts a last record without `\n` [o Core.scala:281]; raw ids are unchecked strings [o Core.scala:284]) → fixed with L4: legacy layout for no final newline / several files; record ids stored as SHA-256 keys | §1.1, §2 inv. 3, §3, U2, U3 |
| R8 down-script preflight unsound; S1 can create over-cap revisions | holds → fixed: sound upper bound + exact savepoint attempt; S1-created non-representable revisions documented, not prevented (D6) | §1.2, §9, U4 |
| R9 units not independently gate-passing; ownership | holds → fixed with L3: production layout `Legacy` until U3 flips it, U4 after U3, `Database.scala` edits listed per unit, U6 owns the `/api/ingest` check | §3 seam, §11 |
| L1 ≥ 1 GiB uploads, nothing materialized whole, bounded bodies, U8 with workers | done | §3.1, §4.2, §4.4, §6, §8, §11 U4/U8, §12 |
| L2 no per-entry stop on a missing API | done: collector-level probe each cycle, prominent line, no fallback, `whole` stays the switch | §6, §8 |
| L3 independent gates | done | §3 seam, §11 |
| L4 epoch-unsafe requests → legacy | done: several files; non-empty raw without a final `\n`; nothing else is unsafe (record keys hashed) | §2, §3 |

### Review round 2 resolutions
| item | verdict | where |
|---|---|---|
| B1 S2 → S1 rollback binary without guards | holds (round 1 put the guards in U5, an S2 unit) → fixed: guards are S1 (§3.1, U4), so the S1 tip and any rollback binary carry them; U8 runs the S2 → S1 rollback with the large fixture and workers | §3.1, §9, U4, U8 |
| B2 collector preflight memory | holds (the record cap was checked only when packing; the evidence set was unbounded, as `evidenceFor` collects every `cwd` [o controls.ts:28-43]) → fixed: the shared line reader stops at 2,031,616 B before parsing (`record-too-large`), evidence capped at 1,024 distinct values (`admission-evidence-limit`), both quarantine with nothing sent | §6, U7, D9 |
| B3 message bytes do not bound the job heap | holds (vectors are retained until publication in the job's `VectorArena` and chunks in the publication builder [o Models.scala:122,165,213, VectorArena.scala:7-23, ProblemsPublication.scala:83-87]) → fixed: pre-allocation budget `E = 2M + 256n + F(8d + 13,312)` with `F` from fragments and `d` the configured dimensions, plus a runtime cap at `vectors.add`; test with many short messages at 4,000 dimensions | §3.1, U4, D2 |
| B4 down-script bound omits `raw_path` | holds (`raw_path` has no length bound [o Core.scala:279-280]) → fixed: the bound enumerates every rebuilt field incl. path and digest, exact read-only check otherwise, whole preflight before any mutation; long-path test | §1.2, U4 |
| B5 U8 fixture above the limits | holds → fixed: U8 uses the production limits (1 GiB / 400,000) and a 1,000,000,000-byte fixture, plus a 413 for a declared 1 GiB + 1 | U8 |

## Appendix — findings against the design study
1. "Reads go through views named like today's tables, readers change little" — measured: a UNION ALL view sorts the
   whole epoch branch for `ORDER BY position LIMIT` (52 ms vs 0.16 ms first page; locate 14 ms vs 0.02 ms on 28.5k
   messages, O(session)) → query changes through one helper instead.
2. "Head candidates flip only when the epoch changes, so the switch is O(1)" — true for appends; the first S1 ingest of a
   legacy head still prunes that head's fragments (once per source), and a superseded epoch's candidates must be pruned
   outside the switch (114 ms / 44.6 MB WAL per 10,000 rows).
3. The base proof cannot be verified on the server as described (the server never sees the collector's prefix): the
   server checks base = head, then computes head ‖ delta and compares it with the declaration bound at open
   (`content-mismatch`); the collector can declare at open because its preflight pass reads the whole file first.
4. The collector needs no SHA-256 midstate: Node `Hash.copy()` gives the prefix digest inside one pass; only the server
   stores midstates (JDK cannot export state, V3).
5. Not in the study: the legacy claim detoasts the whole snapshot for its envelope and sorts the message array
   on disk (80 MB) for the largest session (631 + 811 ms); epoch claims take 0.03 ms + 10.7 ms.
6. jsonb cap refined: container overhead counts (max top-level scalar 268,435,447 B; one-key object 268,435,442 B); the
   largest real head is 226.6 MB as jsonb (84 %), not 237 MB (the study measured the text form).
7. Scale of the S1 gain for the largest session's next revision: 1.3 MB vs 2.2 GB WAL and 18 ms vs 65 s of ingest
   (the whole-request decode/validate, 11.3 s, stays until S2) — far above the study's "≈ 34× less message data".
8. The `chronicle` dev shell now pins PostgreSQL 18.7; the clone and the checks used 18.6.
