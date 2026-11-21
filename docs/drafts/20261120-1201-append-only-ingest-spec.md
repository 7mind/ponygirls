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
  rows past the head's count, so the commit is O(1). Sessions up to the configured raw bound (64-bit throughout;
  deployment 8 GiB against the owner's 556 MB session growing ≈ 85 MB/day); records up to a configured cap (≥ 32 MiB),
  larger records travelling alone in a large part through the existing admission permit. Nothing materializes such a revision whole on the server — guards shipped with S1 so
  that any rollback binary has them: `GetRaw` refuses above a raw bound (`too-large`), and an indexing job whose
  estimated retained heap (messages, one vector of the configured dimensions and one chunk per fragment) exceeds a budget
  ends `Failed index-budget-exceeded` before it allocates, with a runtime cap behind the estimate — the session stays
  readable and literal-searchable (two-phase Find). §10.1 lists every remaining whole-session path; §10.2 shows that no
  step re-indexes existing sessions. The collector preflights the whole file (admission, identity, exclusions, declaration) in a pass whose line
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
`LegacyFreeCheckTest`; the down-script is listed there too. Run by an operator with the server stopped, after the S2
down-script (§9) if S2 was deployed, as `psql -v mode=… -f down-024-epoch-layout.sql` with `statement_timeout=0`.
**Irreversible-script rules** (the repository's convention, from the legacy-retirement procedure
[o docs/drafts/20261118-1100-legacy-data-retirement.md:262-263,316,607-608]): a read-only `preflight` prints the plan
token and every count; a `dry-run` runs everything in one transaction that ends in `ROLLBACK`; `apply` requires
`apply_irreversible=yes`, `confirm_database=<name>`, `expect_plan=<token from the preflight>` and
`backup_reference=<ref>`, plus every destructive option typed with the count the preflight printed; any mismatch is a
refusal before the first change; result lines are machine-readable (`DOWN024.result|…`); a cut run is resumed by a new
preflight (new token) — committed batches are not repeated.
1. **`preflight` (read-only): representability of every epoch revision.** The rebuilt snapshot consists of exactly: the
   envelope (every request field except messages and files), the messages, and one file object with `path` = `raw_path`,
   `sha256` = the digest (64 characters) and `content` = the raw. Its upper bound is `octet_length(envelope::text) +
   octet_length(raw_path) + 64 + raw_bytes + message_bytes + 128 × message_count + 4,096`. `raw_path` is not
   length-bounded by `SnapshotValidation` (only structured, relative, no `..` [o Core.scala:279-280]), so it is counted
   explicitly [review B4]. Strings are stored unescaped in jsonb, so their text forms (envelope text, `message_bytes`,
   path) are never smaller; 128 B per message cover jsonb's per-node JEntries, alignment and numeric widening of a 6-key
   object [i; U4 proves it with worst-case shapes: many tiny messages with nulls and large `recordIndex`], 4 KiB the
   snapshot, file and array containers. Bound ≤ 268,435,442 (the one-key object limit, V1) → representable; otherwise the
   preflight builds that snapshot exactly (read-only `SELECT` of the E6 expression) and records whether PostgreSQL accepts
   it. Output: one `DOWN024.non_downgradable|<session>|<revision>|<bound>|<exact result>` line per non-representable
   revision (ids and sizes only), the counts `DOWN024.epoch_revisions|N`, `DOWN024.non_downgradable|R|sources=S`, the
   disk/WAL estimate, `DOWN024.plan|<token>` (digest of the sorted list of epoch revisions with their counts and sizes),
   `DOWN024.result|preflight-complete`.
2. **Operator choice when R > 0 (12:50Z item 6: refuse before any change, list, explicit choice; no silent skip, no
   partial state).** `apply` (and `dry-run`) refuse with `DOWN024.result|refused-non-downgradable|R|sources=S` unless
   the operator chose one of exactly two outcomes: **(a) stay on S1** — do not run `apply` (the default; nothing
   changes); **(b) purge the S sources** that hold a non-downgradable revision — `purge_non_downgradable=yes
   confirm_purge_sources=S` plus a `backup_reference`: those sources are purged as the owner's `Purge` does (tombstone,
   revisions, jobs, generations; irreversible for that source [o chronicle/README.md:156, Auth.scala:339-342]) in the first
   transaction of `apply`, then the conversion runs. There is no per-revision skip: a source keeps all its revisions or
   is purged whole. Purging another owner's sessions needs that owner's consent; the script prints the owners' ids
   (counts per owner) in the preflight.
3. **`apply` conversion**, per source (one transaction each): with `ch_immutable_revision` disabled inside the
   transaction, for every epoch revision write `snapshot = envelope || {"messages": [values < message_count by position],
   "files": [{"path": raw_path, "sha256": envelope->>'digest', "content": string_agg(raw segments < raw_bytes by
   offset)}]}` (the E6 query), set the epoch columns NULL, insert `ch_messages` rows (positions < count) and the message
   fragments (`ch_epoch_fragments` positions < count) into `ch_archive_fragments` with `ordinal = metadata count +
   row_number()` and `head_candidate = (revision = ch_sources.revision)`. Each committed batch leaves a database the S1
   binary reads (mixed layouts are a valid S1 state); the S0 binary may start only after step 4.
4. **One final transaction**, only when zero epoch revisions remain: drop the epoch triggers/functions, constraint, index
   and columns, `ALTER COLUMN snapshot SET NOT NULL`, drop the four row tables and `ch_epochs`, re-create the 013 body of
   `ch_immutable_revision()`; `DOWN024.result|applied`. A cut run (`DOWN024.result|incomplete|remaining=N`) is resumed by
   a new preflight and `apply` with the new token.
Limits: (a) the jsonb cap. **S1 itself can create a non-representable revision**: a whole request up to `maxBodyBytes`
(≤ 512 MiB [o Core.scala:95]) is stored in an epoch although its snapshot might exceed the cap — today such a request
fails at the snapshot INSERT (a jsonb error, HTTP 500). With production `maxBodyBytes` 256 MiB the largest real revision
rebuilds to 226.6 MB [o V6]; bodies of 256 MiB with unusually many small messages could exceed it. Decided (12:50Z item
6): S1 stores them; the preflight lists them and step 2 applies. S2 sessions above 256 MiB are never representable.
(b) disk and WAL: every epoch revision becomes a full legacy copy again (the preflight prints `Σ raw_bytes +
message_bytes` over epoch revisions, ×≈ 2 for fragments/TOAST/WAL); (c) S2 objects first. Fragment ordinals differ from
what a legacy ingest would have produced (the legacy writer has no ORDER BY [o ArchiveProjection.scala:73]); no reader
uses ordinals [o ArchiveIndex.scala:169-171].

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
  retained and exact but not returned by `GetRaw`) [o CONTRACT.md:100-102]. New optional config key `maxRawReadBytes`
  (`Long`), default = `maxBodyBytes` (so nothing that `/api/ingest` can store becomes unreadable), validated
  1..536,870,912 (`string_agg` cannot build ≥ 1 GiB [o V1]; the JSON response doubles it). Decided (12:50Z item 3); the
  optional, not started U9 adds a ranged read and a streaming download (§11).
- **Message pages** (`GetMessages` over WebSocket/CLI, `get_messages` over MCP): ≤ 100 messages [o Core.scala:17-18], each
  bounded by its request (`maxBodyBytes`) or record cap (`maxRecordBytes`). MCP reads are already byte-admitted
  (`ReadMaterialization`); unrestricted (browser/CLI) reads get a page byte bound of 64 MiB measured with
  `ReadSources.bytes` before fetching [o Database.scala:217-225, ReadSources.scala:8-11]: the page is cut to the longest
  prefix within the bound, at least one message. The dashboard already continues at `offset + messages.length`
  [o web/src/Conversation.tsx:442]; CONTRACT states that a page may hold fewer than `limit` messages.
- **Per-session literal search (Find)** is O(session) in database *time*, not memory: no hit means a scan of every
  message under the 5 s statement deadline [o SessionMessageSearch.scala:24,72] (305 ms for 28,515 messages [o V4]; ≈ 5 s at
  ≈ 1.3 GB of message values [i], which the owner's session reaches in weeks at 85 MB/day). For epoch revisions whose epoch
  is `current` Find runs two phases with unchanged results, order and cursors: (1) the scan with a 1 s statement limit —
  common literals find their page early; (2) if it times out and the literal is ≤ 512 scalars with ≥ 2 trigram keys (the
  `globalLiteralCandidates` rule [o ArchiveIndex.scala:73-74]), candidate positions from `ch_epoch_fragments` (head
  candidates, epoch filter, `position` after the cursor and below the count) through the existing trigram index, each
  verified with the same `strpos(lower(…))` predicate in position order. Fragments hold `lower(text)` in 4,096-byte pieces
  with a 512-scalar overlap [o ArchiveProjection.scala:10-11,17-38], so every occurrence of a literal of ≤ 512 scalars lies
  inside one fragment. Otherwise (longer literal, superseded epoch, legacy revision) the scan alone runs; above its deadline
  the answer is `deadline` (visible, as today). No schema change.
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
- **Default** `maxIndexingBudgetBytes` = 2,147,483,647 (new optional config key, `Long`, 1..2^63 − 1). Calibration:
  `36763d39` (n = 28,515, M ≈ 80 MB [o V6, V2], F ≈ 58,000 = 911 windows of ≤ 64 fragments [r ch-fix2 §3.1]) gives
  `E` ≈ 1.30 GB at 768 dimensions, against ch-fix2's measured whole-process peak of 1,525 MB live heap while the five
  largest jobs ran one at a time [r ch-fix2 §3.1] — the estimate is in range and conservative for the job alone. The
  default leaves ≥ 4.4 GB of the 6,554 MB heap bound (80 % of 8 GiB) for the server, small jobs (≤ 100 windows each, the
  other lanes [o Core.scala:58]) and one admitted large decode. Examples: 400,000 short messages at 4,000 dimensions
  → `E` ≥ 18.1 GB → refused before allocation although `M` is ≈ 40 MB [review B3]; the owner's 556 MB session
  (73,715 lines (12:50Z), M ≈ 305 MB, F ≈ 150,000–220,000 [i: the clone's ratios]) → `E` ≈ 4–5 GB → stored, readable and
  literal-searchable, visibly `index-budget-exceeded` at the default (owner decision A, 12:50Z).
- **Heap sizing (Q122, 13:02Z).** Per raw MB the clone's largest session gives `E` ≈ 8.9 MB (M ≈ 0.55 MB, n ≈ 196,
  F ≈ 398 at 768 dimensions [i: V2/V6 ratios]); ch-fix2's whole-process peak, 1,525 MB for 145.8 MB of raw [r], is
  10.5 MB per raw MB — the same order. Provisional table (U8 replaces it with measured values; "else" = what the heap
  must keep for the server, small jobs on the other lanes and one admitted large decode, taken from today's default
  margin, 6,554 − 2,147 MB ≈ 4.4 GB [r ch-fix2 §3.1]):

  | heap bound (80 % of container) | budget = heap − 4.4 GB | largest raw that indexes [i] | days of the owner's growth past 556 MB |
  |---|---|---|---|
  | 6.4 GiB (8 GiB container, today) | 2.1 GB (default) | ≈ 240 MB | already above |
  | 12.8 GiB (16 GiB) | 9.3 GB | ≈ 1.05 GB | ≈ 6 |
  | 25.6 GiB (32 GiB) | 23 GB | ≈ 2.6 GB | ≈ 24 |
  | 51.2 GiB (64 GiB) | 50 GB | ≈ 5.6 GB | ≈ 60 |

  At ≈ 8.9 MB of heap per raw MB, a session growing 85 MB/day needs ≈ 0.75 GB more heap per day: raising the heap buys
  days to weeks, not a steady state. The steady-state answer is streamed indexing (appendix B: estimate only).
- The session stays readable above both bounds: pages, locate, context, per-session literal search and Archive lexical
  search are SQL over epoch rows (§1.3) and never decode the session. §10.1 lists every remaining whole-session path. Other paths stay bounded: `/api/ingest` by
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
data UploadLimits { maxPartBytes: i64 maxLargePartBytes: i64 maxRecordBytes: i64 maxRawBytes: i64 maxMessages: i32 }
root data UploadState { uploadId: uid requestId: uid phase: UploadPhase append: bit receivedParts: i32
  receivedRawBytes: i64 receivedMessages: i32 lastPartSha256: opt[str] expiresInSeconds: i32 limits: UploadLimits
  receipt: opt[IngestReceipt] failure: opt[str] }
```
`UploadOpen` carries the **complete declaration** of the resulting revision (final digest, raw bytes, message count,
chain, completion, redaction flag, metadata): the collector knows it after its preflight pass (§6), and binding it at
open makes the request intent replayable without the file (R5). `IngestRequest`, `IngestReceipt`, `Message`, `Metadata`
unchanged. Every byte size and offset is `i64` (decimal strings on JSON [o CONTRACT.md:132]); counts and positions stay
`i32` (`messageCount`, ordinals, and `Message.recordIndex` of the unchanged `Message` type).
### 4.2 Endpoints (bearer, Ingest scope, no query, Origin rule as `/api/ingest` [o Http.scala:193-196])
Every body bound is checked against `Content-Length` before reading and enforced while reading (`boundedBytes`
[o Http.scala:27-30]). Only a *large part* (below) takes the `SnapshotAdmission` permit, before its body is read, exactly
like a large `/api/ingest` body [o SnapshotAdmission.scala:14-18].

| endpoint | body → result | body bound |
|---|---|---|
| `POST /api/ingest/uploads` | `UploadOpen` → `UploadState` | 64 KiB (`UploadPolicy.maxOpenBytes`) |
| `GET /api/ingest/uploads/{id}` | → `UploadState` | none accepted (0) |
| `POST /api/ingest/uploads/{id}/parts` | `UploadPart` → `UploadState` | 8 MiB (`maxPartBytes`); a part of exactly one record up to `maxLargePartBytes` (announced length required) |
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
purge); `too-large` 413 (any body over its bound; a record over `maxRecordBytes` — the message names the record index, its
size and the limit; declared raw > `maxFileBytes`; declared messages > `maxMessages`; parts > `maxParts`); `unavailable`
503 (a large part not admitted within 30 s, as large ingests).
### 4.4 Limits and lease
`UploadPolicy`: `maxPartBytes` = 8 MiB = `SnapshotAdmission.largeBodyBytes` (ordinary parts never take the permit);
`maxParts` = ceil(`maxFileBytes` / 1 MiB) + 1,024 (bounds rows from tiny parts; the collector packs ≈ 8 MiB parts).
**Per-record cap — decided "part size follows" (12:50Z item 7):** config `maxRecordBytes` (server and collector, `Long`,
default 33,554,432 = 32 MiB, validated 1,048,576..134,217,728 so a message text derived from one record stays far below
the jsonb string cap [o V1]). A part always carries whole records. A record whose encoded part exceeds `maxPartBytes`
travels alone in a *large part* of at most `maxLargePartBytes` = 4 × `maxRecordBytes` + 1 MiB (the raw line JSON-escaped,
≤ 2×, plus its messages, whose text derives from the line [i: ≤ 2× more]); it must announce its length, is admitted
through the one `SnapshotAdmission` permit before its body is read (bounded wait 30 s → 503, the collector retries) and is
validated by the same per-part code. Why not records spanning parts: per-part validation parses whole JSONL records
(record ids, message derivation, `parentId` resolution); a spanning record would need server-side staging of partial
lines and a second validation path at line completion. Large parts reuse the mechanism that already serializes large
decodes (ch-fix2 §2-B) and stay below today's admitted request bound (129 MiB at the default vs `maxBodyBytes` 256 MiB).
Memory: server one large part at a time (body + one record's decode); collector one record ≤ `maxRecordBytes` plus its
encoded part. `/api/ingest` keeps having no per-record bound (a line is bounded only by `maxFileBytes`/`maxBodyBytes`
on the server and `maxFileBytes`/`maxPayloadBytes` on the collector [o Core.scala:85,280, config.ts:17]).
**Where 2,031,616 B came from:** it was this spec's round-2 derivation (8 MiB part ÷ 4 − 64 KiB, assuming a record's
encoded part ≤ 4 × its line), not an existing frame bound; nothing in today's code bounds a record (the only 8 MiB server
value is the admission *threshold*, not a limit [o SnapshotAdmission.scala:27]) and it never applied to `/api/ingest`.
It is withdrawn: the host's line maxima reach 1,966,007 B (12:50Z item 7), 3 % below it.
**64-bit sizes (12:50Z item 4i):** no format limit below 2^63 B. Schema: every byte size/offset is `bigint` (`raw_bytes`,
`byte_offset`, `message_bytes`, `fragment_count`, upload counters, part receipts). Wire: all byte sizes `i64` (§4.1).
Server config becoming `Long`: `maxFileBytes` (was `Int` [o Core.scala:60]), `maxRawReadBytes`, `maxIndexingBudgetBytes`,
`maxRecordBytes`; `maxBodyBytes` stays `Int` (it bounds one request held in memory, ≤ 512 MiB [o Core.scala:95]) and
`maxMessages` stays `Int` (a count). Collector state: raw sizes and offsets are `bigint` in memory (`fstat` with
`bigint: true`, as `readSnapshot` already does [o discovery.ts:132]) and decimal strings in the spool; collector size
keys are JSON numbers validated ≤ 2^53 − 1 (9 PiB, a configuration bound, not a stored-format limit).
**Deployment values** (12:50Z item 4: limits are config; the owner's largest session is 556 MB and grows ≈ 85 MB/day, so
1 GiB would be reached in ≈ 6 days): server `maxFileBytes` = 8,589,934,592 (8 GiB, ≈ 95 days of growth), `maxMessages` =
2,000,000 (5.1 KB of raw per message on the clone's largest session, 145.8 MB / 28,515 [o V2]: 8 GiB ≈ 1.7 M messages
[i]), `maxRecordBytes` 32 MiB; `maxBodyBytes` stays 268,435,456 (it bounds only `/api/ingest` and is the default of
`maxRawReadBytes`); `maxIndexingBudgetBytes` default (§3.1); collector `maxFileBytes` = 8,589,934,592, `maxMessages` =
2,000,000, `maxRecordBytes` 32 MiB, `maxScanBytes` ≥ `maxFileBytes`; `maxPayloadBytes` unchanged (whole mode only).
Re-evaluate before the session reaches 8 GiB. Lease: TTL 3,600 s sliding, `expires_at = clock_timestamp() + ttl` set at
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
- **Part:** a large part (one record, body > `maxPartBytes`) has taken the admission permit in the route before its
  body was read; a record over `maxRecordBytes` → 413 `too-large` naming it. Attempt `Open`, lease valid (else
  `upload-expired`), source not tombstoned (else `gone`); ordinal `< parts`:
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
- **Collector normalization v2 (orchestrator 14:53Z, DIAG-22AB; U7):** what the chain covers is what the collector
  sends, and the collector normalizes derived strings before chaining and sending, in one function for `parts` and
  `whole` (`collector/src/unicode.ts`, `NORMALIZATION_VERSION = 2`; 1 = earlier releases, no replacement): every unpaired
  UTF-16 surrogate (a code unit U+D800..U+DFFF without its partner, as `JSON.parse` yields from an escape such as
  `\ud83e` that a producer cut out of a pair) becomes U+FFFD (`String.prototype.toWellFormed`) in (a) the normalized,
  redacted message **text** and (b) the readable metadata strings: title, project, workdir, gitRemote, gitBranch,
  gitCommit, model. Identifiers are never rewritten: a lone surrogate in a session or subagent id, message id, parentId
  or role refuses the file locally (`invalid-identifier-unicode`, reported once until the file or the policy changes).
  The raw JSONL is never altered (it holds the escape, valid UTF-8), so the raw digest stays the file's. The server
  stores what is sent, so its chain and the collector's agree; the server's rule (unpaired surrogates → `invalid`) is
  unchanged. Changing what is replaced, where or with what changes the chain of every affected prefix: it needs a new
  normalization version (and chain v2 if the chained value changes), else each affected append is re-planned as a
  replacement (the collector's recomputed prefix chain no longer equals the head's).
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
  [o nix/hm/chronicle.nix:128-132]). New limit key `maxRecordBytes` (default 33,554,432; §4.4). Deployment limits: §4.4.
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
  (shared by every pass) enforces the record cap **while reading**: min(collector `maxRecordBytes`, the server's
  `UploadLimits.maxRecordBytes` from the last probe/open; 32 MiB by default, 12:50Z item 7). A line that reaches it stops
  the pass before `JSON.parse` and before any network call; the reader never holds more than the cap. The source enters
  the state `record-over-limit` (below). Host line maxima reach 1,966,007 B (12:50Z item 7), clone 1,344,233 B [o V2].
  Per line: `JSON.parse`, depth check, redaction, redacted raw line, the `excludedTranscript` project/session checks and the
  `evidenceFor` cwd paths [o collector.ts:22-37, controls.ts:28-43], Claude session/agent identity consistency
  [o parsers.ts:124-133], record id, metadata last-wins and title rule [o parsers.ts:149-158,181-188], normalization,
  SHA-256 (Node) of the redacted raw, chain v1 over the normalized messages (§5, normalization v2), counts, message bytes; at record `head.recordCount` it records
  `hash.copy().digest()`, the chain, raw bytes, message count and the file offset (base check). **Codex** first runs a
  multiset pass for the file-wide `event_msg` dedup, keeping `SHA-256(role ‖ 0x00 ‖ text)` per `response_item` message
  (32 B instead of the text [o parsers.ts:159-173]). At the end the whole file has passed admission, exclusion, identity
  and limits exactly as today, and the complete declaration is known. Any exclusion or identity failure → the existing
  outcome, nothing sent. The admission evidence is a set of distinct `cwd` values, each resolved once with
  `pathAliases`; it is capped per file at 1,024 distinct values AND 1 MiB of evidence in total (UTF-8 bytes of every
  retained value, its aliases and lexical fallback included; a single `cwd` longer than 4,096 B — `PATH_MAX` — counts as a
  violation by itself). Both caps are checked before a value is retained or spooled; the first value that would exceed
  either stops the pass with the quarantine code `admission-evidence-limit` (nothing sent; status line with count and
  bytes) [review B2, r3]. Memory: 1 MiB buffer + ≤ `maxRecordBytes` line + ≤ 1 MiB evidence + Codex multiset
  (≤ `maxMessages` × ≈ 80 B, ≤ 160 MB at 2,000,000) + metadata.
- **Append vs replacement:** base fields known and all equal (raw bytes, prefix digest, message count, chain) → append
  with `base`, pass 2 seeks to `baseFileOffset`; otherwise replacement, pass 2 reads from the start.
- **Live controls** (pause, exclusions, admission origin) are re-checked with the stored evidence before the open, each
  part and the commit, as the current upload loop does for queued payloads [o collector.ts:221-228]; a held entry waits
  (nothing aborted).
- **Pass 2 — upload:** greedy packing of whole records (raw line + its messages) up to the server's `maxPartBytes` minus
  envelope margin, measured on the encoded part; a record whose encoded part alone exceeds it travels alone in a large
  part (≤ `maxLargePartBytes`, announced length; §4.4). Memory: one part, or one record and its large part. Sequential: send, then persist `partsAcked`/`lastPartSha256`. The file's stat must stay equal to pass 1's until
  the commit; otherwise abort the attempt and re-plan next cycle.
- **Resume** (restart, timeout, 5xx): first recover the outcome without the file — `GET` the attempt; on 404 or a
  terminal phase replay the open with the stored declaration (a committed intent returns its receipt; an uncommitted one
  gets a new attempt). Only then regenerate: re-run the passes, check that the recomputed declaration equals the stored
  one and that part `receivedParts-1` hashes to `lastPartSha256`, and continue from `receivedParts`; any difference →
  abort the attempt, drop the intent and re-plan with a new requestId. `upload-expired` → open replay (new attempt);
  `upload-busy` → back-off.
- **Commit:** after the last part and the stat check; on the receipt store the new head with the base fields.
- **Record over the cap — `record-over-limit`** (12:50Z item 7): a per-source state, not a stopped upload entry: no
  attempts, no retries, no server call for that source. It is recorded with the file identity/stat and the measured size
  and reported **once** (one diagnostic and one progress-report error on entering the state; `--status` shows it until it
  clears). Status text: "`<format>` session `<pathId>`: record `<index>` is `<N>` bytes, above the record limit of `<M>`
  bytes (`<collector maxRecordBytes | server maxRecordBytes>`). This session is not uploaded. Raise `maxRecordBytes` on
  the collector and on the server (both, at most 134,217,728) and it is uploaded at the next scan." It clears when the
  file's stat or either limit changes (the source is then read again). A server `413 too-large` naming a record maps to
  the same state with the server's limit.
- **Server without the upload API** (L2; 12:50Z item 2): before the first upload of a cycle the collector probes `GET
  /api/ingest/uploads/00000000-0000-0000-0000-000000000000` — an S2 server answers `404 {"code":"not-found",…}`, an older
  one `404` without a `Failure` JSON body [i from Http.scala routes: no `/api` GET route matches]. On the latter the
  cycle uploads no parts, entries keep their status and attempts (no per-entry stop), and `--status` (first line) and the
  progress report carry one collector-level line `server-upload-unsupported` with the text: "Uploads are paused: the
  Chronicle server at `<endpoint>` has no part-upload API (it predates S2). Nothing is lost — changed sessions are
  uploaded once this is fixed. Fix: upgrade the server, or set `uploadProtocol = "whole"` in the collector configuration
  (Home Manager `chronicle.collector.uploadProtocol`) to upload through /api/ingest." The next cycle probes again, so the
  condition clears itself after the server upgrade. No automatic fallback to `whole`; queued old-format entries still
  drain (they are whole payloads already). **Deployment note** (CONTRACT/README, U7): deploy the S2 server before
  collectors with `uploadProtocol = "parts"`; a new collector in front of an old server pauses uploads (no loss) until
  the server is upgraded or the switch is set.
- **S0-COL codes:** `snapshot-too-large` (file > `maxFileBytes`), `message-limit`, `scan-budget-deferred` unchanged;
  `payload-too-large` and `server-payload-too-large` apply to `whole` mode and old-format drains only; new: the
  collector-level `server-upload-unsupported`; per source `record-over-limit`, `admission-evidence-limit`; per entry
  `upload-too-large` (413 for the declared raw/messages, with size and the server limit), `upload-content-mismatch`;
  per file, in both protocols, `invalid-identifier-unicode` (§5 normalization v2; reported once, with the per-source count
  of replaced code units shown by `--status`); `--retry` of a queued whole payload of normalization 1 that the server
  refuses as non-scalar removes it without a tombstone and the next scan rebuilds it from the file;
  counters gain `replacements`. The progress report wire is unchanged
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
in-place precedent 3961370f (enum value, `lock.json` unchanged) [o git]. **S2 is additive in 1.9.0** (decided 12:50Z, on the
condition that gate O proves a collector built from today's main keeps uploading through `/api/ingest` unchanged; §11) —
new root types and endpoints only; `IngestRequest`/`IngestReceipt` codecs and their golden fixtures unchanged; `ApiVersionCompatibilityTest`
unchanged; new golden fixtures for `UploadOpen`, `UploadPart`, `UploadState` in `scripts/codec-fixtures.mjs`/
`CodecFixtureTest`. [u] whether the pinned Baboon re-generation accepts the changed 1.9.0 signature without a `lock.json`
update; if it refuses, update the lock entry in the same commit (it locks only 1.9.0). Contract changes (CONTRACT.md):
with S1 (U4) `GetRaw` → `too-large` above `maxRawReadBytes`, the job error `index-budget-exceeded`, the optional config
keys `maxRawReadBytes` and `maxIndexingBudgetBytes` and `maxFileBytes` as a 64-bit value, message pages that may hold
fewer than `limit` messages (64 MiB byte bound), purge's physical deletion by the sweep; with S2 (U6) the upload endpoints,
`maxRecordBytes`, large parts and the deployment note (new collector before server → uploads pause, no loss).

| | server ≤ S1 (no upload API) | server S2 |
|---|---|---|
| collector ≤ S0-COL | `/api/ingest`; S1 stores deltas; > `maxBodyBytes` → 413 → `server-payload-too-large` (stopped) | same; a source with a live upload attempt (only with two writers) → 409 → `cas-conflict` |
| collector S2, `parts` | probe 404 without JSON → collector-level `server-upload-unsupported` line saying what to do (§6), no parts sent, entries keep status, re-probed every cycle; old-format entries drain; no loss | parts; append/replacement; sessions up to the server's `maxFileBytes`; `--status` shows parts acked and replacements |
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
- **Disk:** staging ≤ live attempts × `maxFileBytes` (≤ 8 per owner: 64 GiB at the 8 GiB deployment value, in practice
  one upload per active session); an append costs its delta (V7); a replacement a full epoch (old epoch retained:
  revisions are immutable until purge). WAL per full part ≈ 40 MB steady, 118 MB after a checkpoint (GIN fragment index
  dominates); today's 233 MB ingest writes 2.2 GB [o V7, V8]; a 1 GiB replacement ≈ 128 parts ≈ 2.5 min of server time
  and ≈ 5 GB WAL, a 4.4 GB one ≈ 10 min and ≈ 22 GB WAL [i from V7].
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
- **Statement/idle timeouts:** every statement bounded by 128 rows, one 1 MiB segment (or one record), one part or
  10,000 cleanup rows; the commit and the switch are O(metadata). Only large parts take the admission permit.
- **Large sessions:** `GetRaw` refuses above `maxRawReadBytes`; jobs whose estimated retained heap exceeds
  `maxIndexingBudgetBytes` end `index-budget-exceeded` before allocating, and a runtime cap stops a job whose pieces
  outgrow the estimate; pages, locate, context, Find (two-phase) and Archive search stay available. Remaining
  O(session) *time* (not memory): the first S1 touch of a legacy source, replacements, candidate pruning after a
  replacement (batched, background), Find's scan phase on superseded epochs and legacy revisions (5 s deadline), the
  down-script. Memory paths: §10.1.

### 10.1 Every remaining whole-session memory path at the head (12:50Z item 4ii)
Checked in the code at the base; "bounded" means by a configured or constant size independent of the session.

| path (who calls it) | what it holds today | guard after S1/S2 | visible refusal | unit |
|---|---|---|---|---|
| indexing claim + job (worker; also an older running job under S0-I1) [o Database.scala:272-283, Models.scala:122,165,187,213] | all messages, one vector and chunk per piece until publication | pre-allocation budget + runtime cap (§3.1) | job `Failed index-budget-exceeded` (Activity, `IngestStatus`, dashboard job state, MCP `ingest_status`) | U4 |
| `GetRaw` (WebSocket; CLI `raw`; no dashboard or MCP caller) and `content`/`headSnapshot` [o Database.scala:169-170,204-208,231-236, Application.scala:35, cli/src/commands.ts:78] | the whole raw | `maxRawReadBytes`, sized before building (§3.1); full reads via optional U9 | `too-large` (WebSocket result error; CLI exit with the code) | U4 (U9 optional) |
| `headSnapshot` [o Database.scala:204] | whole snapshot | no production caller (tests only, grep): removed from `PostgresArchive`, tests read through `messages`/`raw` | — | U4 |
| `/api/ingest` request: decode, `SnapshotValidation`, legacy writer, S1 epoch writer [o Http.scala:193-196, Core.scala:265-298, Database.scala:125-161] | the whole request | `maxBodyBytes` + one admission permit above 8 MiB (unchanged) | 413 `too-large`, 503 `unavailable` | — (exists) |
| Historian extension uploads [o chronicle-upload.ts:18,72] | one 1-message request | client cap 8 MiB, then `/api/ingest` | `payload-too-large` (client), 413 | — |
| CLI `ingest --file`, relevance eval [o cli/src/main.ts:13-21, workflow_v3.py:278] | the request file, client side | CLI input bound `MAX_BYTES`, then `/api/ingest` | CLI `usage`/413 | — |
| message pages: `GetMessages` (dashboard, CLI), MCP `get_messages` [o Database.scala:217-225, Mcp.scala:145] | ≤ 100 messages | MCP byte admission (exists); 64 MiB page byte bound for unrestricted reads (§3.1) | MCP `read-budget`; browser/CLI get a shorter page | U4 |
| chunks/passages/spans pages, `GetSession` (100 chunks), Archive/Activity/Search/Related/Facets/tags, `LocateMessage`, context [o Core.scala:16-18, MessageContext.scala:16-19,40] | pages of derived rows, byte-bounded context | page and byte bounds (exist) | `invalid`/`read-budget` | — |
| per-session Find [o SessionMessageSearch.scala:24,72,76] | bounded locators; O(session) **time** | two-phase Find + 5 s deadline (§3.1) | `deadline` | U3 |
| S2 parts [§4.4] | one part (8 MiB) or one large part (≤ 4 × `maxRecordBytes` + 1 MiB) under the admission permit | body bounds before reading | 413, 503 | U6 |
| export | none exists (no export/dump operation or route; grep) | — | — | — |
| `ReindexCohort`, owner rebuild, retry [o ReindexCohort.scala:28, OwnerReindex.scala] | rows per source, not content | O(sources) | — | — |
| backfill [o ArchiveProjection.scala:92-124] | one message at a time (32 per fetch) | legacy revisions only; epoch revisions excluded (§3) | start-up `migration-required` on a lexical-version mismatch | U2 |
| sweep, prune, purge [§3, §4.6] | SQL in ≤ 10,000-row statements | — | — | U2, U6 |
| down-script [§1.2] | one snapshot ≤ the jsonb cap in PostgreSQL | representability preflight | `DOWN024.result|refused-…` | U4 |
| collector `whole` mode and old-format drains [o discovery.ts:124-149, parsers.ts:88-110, collector.ts:211-215] | the whole file and payload | collector `maxFileBytes`/`maxPayloadBytes` (S0-COL) | `snapshot-too-large`, `payload-too-large`, `server-payload-too-large` | S0-COL |
| collector `parts` mode passes [§6] | 1 MiB buffer, one record, one part, ≤ 1 MiB evidence, Codex multiset ≤ `maxMessages` × 80 B | caps checked while reading | `record-over-limit`, `admission-evidence-limit`, `message-limit` | U7 |

### 10.2 Re-indexing caused by S1, S2 and S0-I1 (Q122, 13:02Z item 2) — none beyond a new upload
Verified in the code; no step re-queues, rebuilds or invalidates indexing of existing sessions:
- **What decides re-indexing today:** a job row — inserted only by `ingest` [o Database.scala:156] and the owner rebuild
  [o ReindexCohort.scala:64] (grep `INSERT INTO ch_jobs`), re-queued only by `Jobs.retry` [o Database.scala:106-113] and
  the owner's retry actions; the target profile
  (`IndexProfileCatalog.current`: annotation model fields, embedding descriptor, `ProblemPassages.identity`
  [o IndexProfiles.scala:20-31]); checkpoint keys (run, profile, revision binding id, digest, algorithm, input
  [o IndexCheckpoints.scala:25-27]); the lexical version (`ArchiveProjection.lexicalVersion` [o ArchiveProjection.scala:12],
  backfill [:92-124]); the start-up reconciliation of `001.sql`, which terminalizes unfinished older jobs at every start,
  unchanged by every unit here [o migrations/001.sql:19-20].
- **Migration 024 and 025:** DDL only (new tables, nullable columns, constraint, triggers, indexes); no `INSERT`/`UPDATE`
  of `ch_jobs`, `ch_generations`, `ch_revisions` rows, `binding_id` or `ch_revision_info.lexical_version`. Existing
  revisions stay legacy with their bindings, so their checkpoints and generations stay valid.
- **The flip to epochs (U3):** changes how the *next* revision of a source is stored; the first one after a legacy head is
  a new epoch written by that upload, which queues its job exactly as any upload does today. The claim value of an epoch
  revision equals the legacy one (U3's differential test), so no input or key changes for equal content.
- **Guards (U4):** the budget can end a job `index-budget-exceeded` that would otherwise run; it creates no work.
  New config keys are not part of the profile descriptor, so no target changes.
- **S2:** a committed upload is an ordinary new revision (one job, as `/api/ingest`); nothing else inserts jobs.
- **S0-I1:** no migration, no requeue of older jobs (its report: "No migration", "no requeue of older jobs",
  start-up reconciliation unchanged) [r reports/ingest-b/S0-I1/report.md:3,56,61].
- **Rules for the units:** do not change `ProblemPassages.identity`, the profile descriptor, `IndexCheckpoints.identity` or
  `ArchiveProjection.lexicalVersion`; do not insert jobs in migrations. U4's rehearsal asserts it: on a TEMPLATE copy,
  `count(*)`/md5 of `ch_jobs`, `ch_generations`, `ch_index_checkpoints` keys and `ch_owner_targets` are unchanged by
  starting the S1 binary and by migration 025.

## 11. Work units
Gates (from the worktree root; report counts and wall time): **B** = `T=$(mktemp -d /tmp/u.XXXXXX); nix develop
.#chronicle --command bash -c "export TMPDIR=$T; bash chronicle/scripts/test-postgres.sh"`; **P** = `nix develop
.#chronicle --command bash -c 'cd chronicle/web && npm ci --offline && cd .. && TSC="$PWD/web/node_modules/.bin/tsc"
./scripts/test-codecs.sh'`; **C** = `nix develop .#chronicle --command bash -c 'cd chronicle/collector && npm ci --offline &&
npm run typecheck && npm test'`; after committing **BF** = `nix build --no-link -L .#checks.x86_64-linux.chronicle-backend-full`,
**CF** = `… .#checks.x86_64-linux.chronicle-collector`; integration (orchestrator) `scripts/verify chronicle`.
**O** (old-client check, 12:50Z item 1) — the collector **built from today's main** (`0aedcfa8`, the commit the stages
branch from) uploads through `/api/ingest` to a server built from the unit's tree, on an owned database, using the
repository's real-server pattern [o chronicle/cli/README.md:272-283]:
```
CHRONICLE_SERVER="$(nix build --no-link --print-out-paths .#chronicle.nativeArtifact)/libexec/chronicle-server" \
MAIN_COLLECTOR="$(nix build --no-link --print-out-paths "git+file://$PWD?rev=0aedcfa8bcdbfd93610ba63b3836384240538b83#chronicle-collector")/bin/chronicle-collector" \
"$(nix build --no-link --print-out-paths .#service-test-fixture-tools)/bin/with-service-postgres" \
  bash chronicle/scripts/test-main-collector.sh
```
The script (owned by U3) runs the unmodified old collector (`--once`, synthetic home, synthetic Pi sessions) through:
a new session; appended lines (an append revision); a rewrite (a new epoch); a session above a small `maxBodyBytes` (413 →
the old collector's own `protocol-rejected`, unchanged behaviour); and asserts receipts and revisions, the old
collector's `--status --json` (uploaded counts, no errors), and that reads through the tree's CLI (`messages`, `raw
--revision`, Find) return the synthetic content exactly. With an S2 server it also checks the documented 409 while an
upload attempt of the same source is live. Every unit passes its gates on its own: until U3 the production layout is
`Legacy`, so no epoch revision exists outside tests.
**Ordering and stage tips (12:50Z):** U1 and U5 start together on the S0 tip; U2 → U3 → U4 complete S1; U7 starts after
U5 is approved and runs alongside U2–U4; U6 needs the S1 tip and U5; U8 needs U6 and U7. The **S1 tip** contains only
S0 + U1–U4 (no U5/U7 commits); **S2** = S1 tip + U5–U8. U9 is optional and not started.
**Edit ownership across units:** `Database.scala` — U1 (initialize list), U2 (`ingest`, `Jobs.switched`), U3 (reader
methods, `claimedSnapshot`, the seam default, Find), U4 (`claim` budget, `raw`/`content` bound, `failAt` terminal code,
page byte bound, `headSnapshot` removal), U6 (`ingest`'s upload check) — sequential. `Core.scala`: U4 (config keys,
`Long`), then U6 (validation helpers). `CONTRACT.md`: U4 (guards, pages, purge), then U6 (Ingestion, uploads,
deployment note). `SessionMessageSearch.scala`: U3. `Models.scala`: U4.

| unit | goal | owns | depends | tests added (lean) | gates | h |
|---|---|---|---|---|---|---|
| U1 S1 schema + digests | 024 migration, triggers, `ResumableSha256`, `MessageChain` v1 | `migrations/024_epoch_layout.sql`; `Database.scala` initialize list; new `ResumableSha256.scala`, `MessageChain.scala`; `chronicle/tests/message-chain-v1.json`; new `EpochSchemaTest`, `ResumableSha256Test` | S0 tip | resumable SHA-256 = JDK on random inputs/splits incl. export/resume; chain golden vectors; immutability (update of a committed epoch row / revision column refused; delete below a committed count refused; delete after the revisions are gone passes); migration idempotent on restart (013 then 024); no job/generation/binding row changed by the migration (§10.2) | B, BF | 6–9 |
| U2 S1 writer behind the seam | layout decision (legacy for multi-file / no final newline), epoch writer, hashed record keys, `message_bytes`/`fragment_count`, switch, backfill guard, `EpochMaintenance` (prune, tombstoned epochs) | `Database.scala` (`ingest`, `Jobs.switched`); `ArchiveProjection.scala`; new `EpochWriter.scala`, `EpochMaintenance.scala`; `plugins/ChroniclePlugin.scala` (one `make` line, as `McpTestRuns` [o ChroniclePlugin.scala:49]); new `EpochIngestTest`; legacy pinning in `ArchiveHeadCandidateTest`, `ArchiveProjectionTest` | U1 | with `Epochs`, asserted on tables: Pi append writes only the delta, equal revision writes no rows, Codex dedup fixture / redaction change / Pi v2→v3 rewrite / Historian → new epoch, multi-file and no-final-newline → legacy, unreferenced record id with an escaped NUL accepted; midstate self-check; receipt replay/409/CAS; prune and tombstoned-epoch deletion with an injected interval + production default asserted; production layout still `Legacy` asserted | B, BF | 10–14 |
| U3 S1 readers, differential, enable | `RevisionContent`, every reader, archive search, two-phase Find, flip the production layout to `Epochs`; owns the old-client script | `Database.scala` reader methods (`selectView`, `messages`, `locateMessage`, `content`/`raw`, `claimedSnapshot`) and the seam default; `MessageContext.scala`; `SessionMessageSearch.scala`; `ArchiveSearch.scala`; `ArchiveIndex.scala`; new `RevisionContent.scala`; new `EpochReadDifferentialTest`; `ArchiveContentBoundaryTest` epoch seek plan; `OwnerLeaseBoundaryTest` (1 case); new `chronicle/scripts/test-main-collector.sh` (named in `chronicle/README.md`) | U2 | one revision sequence (append, append, non-prefix, append, no-final-newline, NUL record id) ingested by `Legacy` and `Epochs` archives under two owners: identical GetMessages pages, LocateMessage, MessageContext, Find, ArchiveSearch (global + per-session), GetRaw bytes, claim snapshots for every revision incl. pinned old ones; Find phase 2 (scan limit forced low) returns the same hits/cursors as the scan; ingest parked at an epoch fragment insert: readers see the old head, after commit the new; production default `Epochs` asserted | B, BF, **O** | 12–16 |
| U4 S1 guards, down-script, rehearsal | §3.1 guards (raw bound, indexing budget + runtime cap, page byte bound, `Long` config keys, contract); down-script with preflight, operator choice and irreversible-script flags; clone rehearsal incl. the no-re-index check | `Database.scala` (`claim`, `raw`/`content`, `failAt`, `messages` page bound, `headSnapshot` removal); `Models.scala` (`Windows` cap); `Core.scala` (config keys, `maxFileBytes` → `Long`); `CONTRACT.md` (GetRaw, job error, config, pages, purge); `chronicle/scripts/down-024-epoch-layout.sql`; `nix/pkg/chronicle/source.nix` tests list; new `OversizeGuardTest`, `EpochDownScriptTest`; rehearsal report | U3 | `GetRaw` above a small bound → `too-large` without building the raw; 20,000 one-word messages at 4,000 dimensions → `Failed index-budget-exceeded` before `claimedSnapshot`, attempts unchanged, session still pages/locates/searches (B3); annotator stub splitting fragments into many pieces → runtime cap, terminal; a page of large messages is cut at the byte bound (≥ 1 message); config keys parse values above 2^31 (`Long`); defaults asserted. Down-script: reads equal before/after, snapshots equal a `Legacy` ingest; worst-case shapes stay under the bound; a long `raw_path` / over-cap revision → `refused-non-downgradable` with the list and nothing changed; `apply` without the flags or with a stale plan token → refusal, nothing changed; `purge_non_downgradable` with the right count purges exactly those sources then converts; a cut run resumes from a new preflight. Rehearsal on a TEMPLATE copy: S1 binary, next revisions of the 5 largest sessions as appends (time, WAL, lock probe, `/api/versions` probe as ch-fix2 §3), §10.2 job/generation/checkpoint invariance, down-script preflight/dry-run/apply, reads | B, BF | 13–17 |
| U5 S2 wire | types §4.1 (all byte sizes `i64`; `UploadLimits` with `maxPartBytes`, `maxLargePartBytes`, `maxRecordBytes`, `maxRawBytes`), generated code, golden fixtures | `models/chronicle.baboon`, `models/lock.json` if needed, `generated/**`, `scripts/codec-fixtures.mjs`, `server/src/test/fixtures/upload-*.json`, `CodecFixtureTest.scala` | S0 tip (alongside U1) | golden fixtures (open with/without base, part, state with receipt/failure, i64 values above 2^53 as strings); `IngestRequest` fixtures byte-identical | P, BF | 3–4 |
| U6 S2 server | intents/attempts, parts with receipts, large parts via the admission permit, staging ownership, commit, sweep, purge abort, `/api/ingest` busy check | migration `025_uploads.sql`; new `Uploads.scala`, `UploadValidation.scala` (factored from `SnapshotValidation`, which then calls it); `Core.scala` (validation helpers, `maxRecordBytes`); `Http.scala` (routes, bounds, failure codes); `Database.scala` (`ingest` check); `Auth.scala` (purge first statement); `EpochMaintenance.scala` (sweep); `chronicle/scripts/down-025-uploads.sql`; `CONTRACT.md` Ingestion + deployment note; `README.md` server paragraph; new `UploadProtocolTest`, `UploadBoundaryTest` | S1 tip, U5 | append and replacement happy paths; idempotency: replay of the last and of an older ordinal (same/different sha), out-of-order 409, commit replay, open replay after commit and after expiry (new attempt), CAS 409; `base-mismatch`; `content-mismatch` (Codex fixture sent as if prefix); forward `parentId` resolved later / unresolved at commit; abort-A/open-B/stage-B/sweep-A/commit-B → B complete (R1); purge racing a part and a commit → `gone`, no deadlock (R2); a 9 MiB single record goes as a large part through the permit, a record over `maxRecordBytes` → 413 naming it; every body bound refused before reading; TTL expiry + sweep with injected TTL/interval, defaults asserted; atomic visibility (extends `OwnerLeaseBoundaryTest`) | B, P, BF, **O** | 15–19 |
| U7 S2 collector | preflight + upload passes with capped line reader and evidence, large parts, `record-over-limit` state, parts client, resume, probe with the actionable status line, `bigint` sizes in state, spool, status | `chronicle/collector/src/**`, `chronicle/collector/test/**`, `chronicle/collector/README.md` (incl. the deployment note), collector paragraph of `chronicle/README.md`, `nix/hm/chronicle.nix` option | U5 approved (alongside U2–U4; against a fake server) | chain golden vectors; append vs replacement (Codex dedup fixture, redaction change, Pi v2→v3 rewrite); an excluded cwd / a mixed Claude identity in the last record → nothing sent (R3); lost commit ACK with the file changed → receipt recovered from the stored declaration (R5); expiry → new attempt, parts resent; probe 404 without JSON → the status line text, entries unchanged, next cycle uploads once the fake server supports it (L2); old-format entry drains first; spool from the current release opens; bounded memory: an instrumented reader never above its bound on a 64 MiB synthetic file; a 2.5 MiB record goes as one part, a 9 MiB record as a large part; a record above `maxRecordBytes` → `record-over-limit` reported once across three cycles, cleared by raising the limit; 1,025 distinct short `cwd` values and a few ~1 MiB `cwd` values → `admission-evidence-limit`, nothing sent (B2); offsets above 2^32 handled as `bigint` (sparse synthetic file) | C, CF | 16–20 |
| U8 S2 acceptance, heap sizing, rehearsal | §11.1 runs A–F | `chronicle/scripts/test-upload-bounds.sh`, `chronicle/scripts/measure-index-heap.sh` (on-demand, named in `chronicle/README.md`); reports; deployment notes with the measured heap table | U6, U7 | §11.1 | the scripts; **O**; `scripts/verify chronicle` | 12–16 |
| U9 (optional, **not started** — owner decision) ranged/paged raw read | `GetRawRange{sessionId, revision, offset: i64, maxBytes: i32}` → `RawRangeResult{revision, path, sha256, totalBytes: i64, offset: i64, content, nextOffset: opt[i64]}` (pages end at segment/line boundaries; legacy revisions by byte range at UTF-8 boundaries), streaming `GET /api/raw/{session}/{revision}` (Read + Raw; memory = one segment; `Content-Length`, digest header), CLI `raw --revision N --output FILE` streaming with sha256 verification, dashboard "Download raw" link | models/generated, `Database.scala` (raw range), `Http.scala` (stream route), `Application.scala`, `cli/src/**`, `web/src/**`, `CONTRACT.md` | S2 tip | range pages concatenate to the exact raw (epoch and legacy); a 4 GiB raw downloads with bounded server/CLI memory and the right digest; auth/scope; fixtures | B, P, BF, CLI real-server leg, dashboard browser case | 12–16 |

S1 total 41–56 h, S2 total 46–59 h (U9 optional 12–16 h). Parallel: U1 ∥ U5; U7 ∥ U2–U4; U6 ∥ U7's tail.

### 11.1 S2 acceptance runs (U8; on-demand, AGENTS.md "On-demand checks")
Common: native server (`.#chronicle.nativeArtifact`) in **`serve`** with normal workers (4 lanes) and the stub model
server (as ch-fix2, delay 0 unless stated), owned PostgreSQL via `with-service-postgres` in a private directory on
`/mnt/dev-data` (not `/tmp`); collector from the tree; `/api/versions` probe every 100 ms (1 s timeout) throughout;
`-XX:+PrintGC`; synthetic Pi transcripts only. Each run reports wall time, WAL, disk, peak live heap (after a full
collection) and every assertion.
- **A — 1 GiB (B5):** production limits of §4.4 except `maxFileBytes` = 1,073,741,824 on both sides (so the refusal is
  checked at its boundary); fixture 1,000,000,000 raw bytes (≈ 196,000 messages) uploaded as a replacement, then +5 % as
  an append; an open declaring 1,073,741,825 → 413. Server `-XX:MaxHeapSize=768m`, budget scaled to that heap (production
  defaults asserted by U4); collector `--max-old-space-size=256`. Asserts: complete upload; job `Failed
  index-budget-exceeded`; `GetRaw` `too-large`; pages at offsets 0/middle/last, locate, context, Find (common, rare,
  no-hit) and Archive lexical search answer; a 16 MiB session on the same server indexes and publishes; no OOM; probe
  answers < 1 s. Rollback leg (B1): `down-025-uploads.sql`, S1 binary with workers: the same verdicts, no OOM. Budget
  ≤ 30 min, ≤ 25 GB disk.
- **B — ≥ 4 GiB (12:50Z item 4iii):** limits `maxFileBytes` 8,589,934,592, `maxMessages` 2,000,000, `maxRecordBytes`
  32 MiB on both sides; fixture 4,400,000,000 raw bytes (≈ 860,000 messages, a few records of 9–20 MiB to exercise large
  parts) uploaded as a replacement (≈ 600 parts) then appended to; server `-XX:MaxHeapSize=1g`, collector
  `--max-old-space-size=256`. Asserts: store (commit, head counts = fixture counts, `raw_bytes` > 2^32 stored and
  reported exactly); paged read (GetMessages first/middle/last pages, LocateMessage of the last message, context); literal
  search (Find common/rare/no-hit within the deadline via the two-phase path; Archive lexical search returns the session);
  `GetRaw` `too-large` (U9, if built, downloads it with the right digest); job `index-budget-exceeded` with workers running
  other jobs normally; no OOM; probe < 1 s. Budget ≤ 90 min, ≤ 60 GB disk (fixture 4.4 GB, database ≈ 3–4 × raw with
  fragments and indexes, WAL recycled at `max_wal_size` 1 GB).
- **C — heap sizing (Q122 item 1):** sessions of ≈ 25 MB, ≈ 145 MB and ≈ 556 MB raw with **73,715 lines** (the owner's
  session shape; message text sizes drawn from the clone's distribution [o V2: p99.9 77 KB, max 0.6 MB]) and, if the
  heap allows, ≈ 1 GB; each indexed alone at 768 dimensions (plus the 556 MB one at 4,000) with the stub models, normal
  workers, budget disabled (`maxIndexingBudgetBytes` = 2^63 − 1) and a large heap (e.g. 24 GiB). Record per session:
  messages, raw MB, `M`, `F`, pieces, windows, `d`, estimate `E`, measured peak live heap of the process during the job,
  and the baseline before the claim. Output: the fit of `E` against the measured job heap (constants of §3.1 corrected if
  the estimate under-predicts; it must stay an upper bound), and the table "heap bound → budget → largest session that
  still indexes" with the margin for everything else from ch-fix2's measurements (§3.1), for the deployment notes. Budget
  ≤ 2 h, ≤ 20 GB disk.
- **D — growth while indexing (Q122 item 3):** one session starts at 2 MB and grows by appends over ≥ 6 revisions
  (+20–40 % each) while its jobs run (stub annotator delay chosen so that each job spans ≥ 1 later revision; S0-I1:
  the running job continues, the head job waits). Asserts: it ends with a published generation at its head revision;
  report jobs created/superseded/completed, windows completed per job and in total vs the head's windows; and from run C's
  fit the raw size at which the session would hit the budget under the production heap (6.4 GiB bound). Budget ≤ 30 min.
- **E — old client (O):** the gate O script against the S2 server.
- **F — clone rehearsal:** on a TEMPLATE copy, parts uploads of the largest sessions (replacement of a legacy head, then
  appends), WAL/time/lock, the probe; no clone content in any output.


## 12. Decisions (all decided; orchestrator 12:50Z and 13:02Z, owner Q122/Q123)
- **D1 `GetRaw` above `maxRawReadBytes`:** DECIDED — explicit `too-large` in S1 (12:50Z item 3); optional U9 adds a
  ranged read and a streaming download, not started (owner decision).
- **D2 Indexing of very large sessions:** DECIDED — owner A: build (a): visible `index-budget-exceeded`, session stored,
  readable and literal-searchable, budget as config (12:50Z). Q122: the heap may be raised; U8 run C provides the measured
  table; streamed indexing is an estimate only (appendix B).
- **D3 Superseded epochs' fragments:** DECIDED — prune in the background (12:50Z item 5).
- **D4 Version policy:** DECIDED — additive in 1.9.0, on condition that a collector built from today's main keeps
  uploading through `/api/ingest` unchanged (12:50Z item 1): gate O in U3, U6, U8.
- **D5 Staging bound:** DECIDED — 8 live attempts per owner, TTL 1 h sliding (12:50Z item 5).
- **D6 S1 revisions that cannot be downgraded:** DECIDED — store them; the down-script refuses before any change, lists
  them and offers exactly the explicit choices of §1.2 (12:50Z item 6).
- **D7 Purge's physical deletion of epochs:** DECIDED — by the sweep (12:50Z item 5).
- **D8 Limits:** DECIDED — limits are config; no format limit below 2^63 B (12:50Z item 4); deployment values §4.4
  (8 GiB raw, 2,000,000 messages, 32 MiB records), re-evaluated against the owner's growth (≈ 85 MB/day).
- **D9 Collector caps:** DECIDED — no 2,031,616 B record cap; `maxRecordBytes` ≥ 32 MiB as config, "part size follows"
  (§4.4); evidence caps (1,024 values, 1 MiB, 4,096 B each) stay (12:50Z item 7, round-3 lead commit).
- **D10 Fallback against an old server:** DECIDED — none; actionable status line and deployment note (12:50Z item 2).
- **Re-indexing:** none beyond what a new upload causes (§10.2; Q122 item 2) — nothing to stop for.

## 13. S0 note — the "restore policy for 157 tombstones" (decided: (b)+(c), unit S0-TOMB)
When the collector's privacy/destination policy digest changes, every queued entry built under the old policy is dropped
and its source is **tombstoned** [o collector.ts:102-107, spool.ts:222-229]: `head.tombstone=true` makes every later scan
skip the source forever (`counters.excluded`) [o collector.ts:193]. On the owner's host 157 sources are tombstoned this
way (study §1). Restoring them is a policy choice — re-uploading sessions that were dropped because they had been
prepared under an older privacy/destination policy (they would now be uploaded under the current one) — not a bug fix.
Options: (a) keep (nothing is re-sent); (b) one-shot operator command clearing tombstones whose audit reason is
`privacy-or-destination-changed` (the next scan re-reads, re-redacts with the current policy and uploads; `--drop`
tombstones stay); (c) change the rule: a policy change discards queued payloads without tombstoning (future changes
only). **Decided: (b) + (c), unit S0-TOMB** (owner Q123, orchestrator 12:58Z); not part of S1/S2.

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

Superseded after round 2 by the orchestrator's 12:50Z decisions (§15): the 2,031,616 B record cap (item 7), the 1 GiB
deployment values (item 4) and U8's run set (items 4iii, Q122).

## 15. Orchestrator decisions 12:50Z (and Q122, 13:02Z)
| item | decision | where in this spec |
|---|---|---|
| 1 additive 1.9.0, condition | yes, if a collector built from today's main keeps uploading via `/api/ingest` unchanged | §8, §11 gate O (script by U3; run in U3, U6, U8 run E), §12 D4 |
| 2 no automatic fallback | yes; the status line says what to do; deployment notes warn | §6 (status text, deployment note), §8 matrix, U7, §12 D10 |
| 3 `GetRaw` `too-large` in S1 | accepted; optional U9 ranged/paged raw read, not started | §3.1, §10.1, §11 U9, appendix B (estimate) |
| 4i no format limit below 2^63 B | byte sizes/offsets 64-bit in schema, wire, collector state; config keys `maxFileBytes`, `maxRawReadBytes`, `maxIndexingBudgetBytes`, `maxRecordBytes` become `Long`; positions/counts stay `i32` | §4.1, §4.4, §6, U4, U5, U7 |
| 4ii every O(session) path at head | named with guard, refusal code and unit | §10.1 |
| 4iii acceptance at 1 GiB and ≥ 4 GiB | runs A and B (fixtures, limits, heaps, assertions, time/disk) | §11.1 |
| 5 staging 8/owner 1 h; prune in background; purge via sweep | yes | §4.4, §3, §12 D3/D5/D7 |
| 6 store non-downgradable S1 revisions; down-script refuses first | yes: preflight list, two explicit outcomes, irreversible-script flags, no skip, no partial S0 state | §1.2, U4, §12 D6 |
| 7 record cap ≥ 32 MiB as config | "part size follows" with large parts through the admission permit; `record-over-limit` reported once with an actionable text; origin of 2,031,616 B explained (this spec's derivation, never an existing bound, not applied to `/api/ingest`) | §4.4, §6, U6, U7, §12 D9 |
| Owner A | build (a): visible `index-budget-exceeded`, budget config | §3.1, §12 D2 |
| parallelism | U5 alongside U1; U7 after U5's approval alongside U2–U4; S1 tip without S2 commits | §11 ordering |
| Q122-1 heap sizing evidence | formula and provisional table now; measured peak heap for ≥ 3 sizes incl. ≈ 556 MB / 73,715 lines | §3.1 (heap sizing), §11.1 run C |
| Q122-2 no re-indexing | verified: none beyond a new upload; invariance asserted in U1 and U4's rehearsal | §10.2 |
| Q122-3 growth while indexing | a growing session ends indexed at its head; jobs/windows spent; budget-hit size at the production heap | §11.1 run D |
| Q122-4 streamed indexing estimate | estimate only | appendix B |
| Q123 tombstones | (b) + (c), unit S0-TOMB | §13 |

## Appendix A — findings against the design study
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

Review round 3 (focused, 12:45Z): B1, B3, B4, B5 confirmed resolved; B2 residue (evidence count bounded but not its bytes) fixed by
the lead in §6/U7/D9: aggregate 1 MiB evidence cap incl. aliases and a 4,096 B per-value cap, checked before retention/spooling.

## Appendix B — estimates for SUMMARY.md (not units of S1/S2)
**U9 ranged/paged raw read (optional, not started).** `GetRawRange{sessionId, revision, offset: i64, maxBytes: i32}` →
`RawRangeResult{revision, path, sha256, totalBytes: i64, offset: i64, content, nextOffset: opt[i64]}` with pages on
segment/line boundaries (legacy revisions by byte range at UTF-8 boundaries); a streaming `GET
/api/raw/{session}/{revision}` (Read + Raw) whose memory is one raw segment; CLI `raw --revision N --output FILE`
streaming with digest verification; a dashboard "Download raw" link; contract, fixtures, real-server CLI leg and a
browser case. **12–16 h**, medium confidence. Risks: legacy revisions page by detoasting their snapshot per page
(bounded by the old request bound); long downloads vs the gateway's 60 s response deadline (streamed responses must be
allowed through, or the CLI pages with `GetRawRange` instead).

**Streamed indexing (claim, windows/carry, publication) — estimate only (Q122 item 4).** Today a job holds every message,
every accepted vector and every chunk until one publication [o Database.scala:272-283, Models.scala:122,165,187,213,
ProblemsPublication.scala:83-87]; ≈ 8.9 MB of heap per raw MB (§3.1), so a session growing 85 MB/day needs ≈ 0.75 GB more
heap per day. Changes:
1. **Claim → cursor:** `ProblemPassages.Source` reads messages through a position cursor (paged SQL over epoch rows)
   instead of a `Vector[Message]`; windows are built from ≤ 64 fragments plus the carry (≤ 4 KiB, 16 fragments
   [o ProblemPassages.scala:22-24]), which is already bounded. The window count needed for progress and the large-job
   deferral comes from a counting pass over the cursor or from stored `fragment_count` (§3.1) instead of decoding.
2. **Vectors and chunks out of the heap:** accepted embeddings are already durable per window (embedding checkpoints
   [o Models.scala:158-172, IndexCheckpoints.scala]); publication would read them back in batches instead of holding a
   `VectorArena` and the builder's chunk lists.
3. **Incremental publication:** write the generation's chunks, passages, spans and search rows per window into a staged
   generation (bounded statements already exist, ch-fix2 §2-C/D) and switch at the end in O(1), like an epoch commit;
   `ProblemsPublication.validate`'s whole-publication coverage check (exact once-only Problem/Context union, passage
   continuity [o ProblemsPublication.scala:9-76]) becomes per-window with a carried frontier.
4. **API/contract:** `JobInfo.totalWindows` from the counting pass; no wire change otherwise; checkpoint keys unchanged
   (reuse across runs as today).
Hours **30–45** (low–medium confidence): cursor source 6–8, out-of-heap vectors/chunks 8–12, incremental publication and
validation 10–15, tests/rehearsal with the run-C fixtures 6–10. Risks: the coverage validation is the correctness core
(a per-window version must accept exactly what the whole check accepts — prove with a differential test over recorded
publications); publication remains O(session) database work and time (≈ 4 min for 44k chunks today, 87 % HNSW
[r ch-fix2 §2-D]) — memory becomes bounded, time does not; a staged generation needs its own cleanup (like upload
staging); interaction with S0-I1 (a running job's staged generation vs a newer head) and with the large-job admission.
Combined with I2 (reuse of window decisions across revisions, study §7, 15–25 h) only the appended windows would be
re-annotated per revision.


## 16. Implementation amendments (lead, 2026-11-20; the implemented behaviour, where it differs from the text above)
- **Indexing budget** (U4): claim-time estimate `2·M + 256·n + 13,312·F + VectorArena.heldBytes(d, F)` (arena blocks of
  ≈ 2 MiB counted whole); at run time each window is admitted before anything of it is retained (pieces 13,312 B each,
  Context coverage spans 256 B each, vectors by arena blocks); over budget → `Failed index-budget-exceeded`, terminal, no
  attempt consumed. Config `maxIndexingBudgetBytes` (Long, default 2,147,483,647); `maxRawReadBytes` (default
  `maxBodyBytes`, ≤ 512 MiB); `maxFileBytes` is Long. CONTRACT.md is authoritative.
- **Small-job budget** (U4B, U8H HEAP.md recommendation): lanes without the large-job permit hold a job to
  `maxSmallJobBudgetBytes` (Long; default the estimate of 100 windows of 64 full fragments at the configured dimensions,
  0.15 GB at 768, 0.32 GB at 4,000): above it at the claim the job waits for the permit (no attempt, no failure), above it
  at run time it is deferred as a large job is (Queued, attempt not counted, window count recorded) and continues on the
  large lane from its checkpoints; that lane keeps `maxIndexingBudgetBytes` and the terminal `index-budget-exceeded`.
  Worst case budget + (lanes − 1) × small budget: 2.61 GB at the defaults (3.10 GB at 4,000 d), i.e. HEAP.md's reading A
  enforced: 5.24 GB (5.74 GB) of an 8 GiB container's 6.87 GB heap bound with the ingest decode and young generation.
- **Message pages** (U4/U4W): a page holds ≥ 1 message while `offset < total`; fewer than `limit` before the end only when
  the 64 MiB byte bound cuts it; clients continue at `offset + messages.length` (the dashboard keeps one contiguous range).
  Epoch page/claim reads run with `enable_sort`/`enable_incremental_sort` off for their own transaction (planner risk at
  default costs, U4 rehearsal).
- **Head-candidate trigger** (U4T): partial index `ch_archive_fragments_session_candidates ON ch_archive_fragments(session_id)
  WHERE head_candidate`, created at the end of migration 017 (024 runs before 017's column exists on a fresh database),
  dropped by down-024. On a table > 1 GiB a missing or INVALID index refuses the start with `migration-required` and the
  operator command (pre-build `CREATE INDEX CONCURRENTLY` while the previous release serves; chronicle/docs/operations.md).
- **S2 probe** (U6/U7): `GET /api/ingest/uploads` → 200 `UploadLimits`; an old server answers 404 without a JSON body.
- **Record cap refusal** (U6/U7): HTTP 413 `Failure{code:"record-too-large"}` (size and limit in the message); other limits
  `too-large`. Records are logical JSONL records split at LF, CRLF or bare CR (one rule for /api/ingest and parts).
- **Unicode** (U7, orchestrator 14:53Z): the collector replaces lone surrogates in message text and readable metadata with
  U+FFFD before hashing and sending (part of message-chain v1's normalization); ids with lone surrogates are refused
  locally (`invalid-identifier-unicode`); raw bytes are never altered.
- **Small-lane budget** (U4B): jobs without the large-job permit are held to `maxSmallJobBudgetBytes` (default: estimate of
  100 windows × 64 fragments); over it → passed by / deferred to the large lane, never failed. Worst case
  `budget + (lanes − 1) × small budget` (2.61 GB at defaults). Evidence: reports/ingest-b/U8H/HEAP.md.
- **Older jobs** (U4J): a switch and the per-start reconciliation supersede only unfinished older jobs (Queued, or Running
  without a valid lease at the switch); terminal verdicts are kept; the switch writes O(1) job rows.
- **Collector transport** (U7 follow-up): every collector request uses a fresh connection (`Connection: close`); a failed
  progress report records a bounded cause code.
