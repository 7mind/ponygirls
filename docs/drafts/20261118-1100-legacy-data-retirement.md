# Retiring legacy data: migration plan, one-off scripts, deletion inventory

Status: **preparation only**. Nothing here was run against a deployed database. The scripts were run only against
fixture databases on an owned throwaway PostgreSQL 18.6 (section 9). Revision 2 (after the advisory review, findings
R1–R5, and owner decisions Q96 and Q98).

Evidence base: the read-only production check of 2026-11-18 (`.local/overhaul-20261117/reports/prod-legacy/` in the
main checkout: `REPORT.md`, `sql/`, `out/`). It is outside this repository; counts marked *(report)* come from it.
Code references are to this worktree at `ab3e8a87`; each was re-read for this document.

Wording: **observed** = read in code, in the report's outputs or in a test run; **inferred** = follows from observed
facts but was not itself checked; **proposed** = a choice of this plan; **decided** = an owner decision.

## 0. Decisions in force

| Decision | Content |
|---|---|
| Direction (2026-11-18) | Prepare one-off scripts, migrate the legacy data, then delete all legacy code. |
| Q96 A | A rehearsal on a clone of the production databases on this host, run by the orchestrator with these scripts unchanged; the clone is deleted afterwards. |
| Q96 B | The production run goes through the deployment repository's path, only after the owner's explicit go at that moment. |
| Q96 C | Haystack Node-era replay rows are deleted. |
| Q96 D, Q98 (2) | **All four** rollback database copies (two Chronicle, one Haystack, one Manure) are dropped after the migration is verified. The drop step takes the explicit list of four names from its own preflight. |
| Q96 E | The evaluation v2 layer is deleted; the V3 binder that still expects v1 descriptors is corrected in the same unit. |
| Q98 (1) | Old-format generations **are retired with tombstones**: a pinned reference to a `ContiguousProblems` or `LegacyAnnotations` generation must answer the product's "retired" outcome. `--retire-history` is the chosen path for the formats item; the default refusal and the separate typed confirmation stay as safety mechanics; the item stays skippable as a whole. The 12 published old-format sources are re-indexed by the product first. |
| Review decisions | (1) a source whose re-annotation keeps failing, or whose owner is disabled: the scripts keep refusing, the runbook says stop and report; nothing unpublishes automatically. (2) The 41 current-format sources are relocated by SQL. (3) Accepted checkpoints of unfinished v1 runs are discarded. (4) A backup is a hard precondition of apply. (7) The clone export procedure is written now and not run. |

Deliverables:

| What | Where |
|---|---|
| Migration driver (POSIX sh + psql) | `scripts/one-off/legacy-retirement/run.sh`, `sql/chronicle/`, `sql/haystack/`, `sql/manure/` |
| Stored-document codec check (needs a JVM) | `scripts/one-off/legacy-retirement/check-stored-documents.sh`, `haystack/server/src/test/scala/haystack/storage/LegacyStoredDocumentCheck.scala` |
| Rollback-copy drop (separate step) | `scripts/one-off/legacy-retirement/drop-databases.sh` |
| Rehearsal clone | `scripts/one-off/legacy-retirement/rehearsal/clone.sh` |
| Proposed clean-up schema (for validation) | `scripts/one-off/legacy-retirement/sql/chronicle/proposed-cleanup-{identity,formats}.sql`, `sql/haystack/proposed-cleanup.sql` |
| **Retained** post-deployment checks | `chronicle/scripts/check-legacy-free.sql`, `haystack/scripts/check-legacy-free.sql` |
| Fixture tests | `chronicle/server/src/test/scala/chronicle/LegacyRetirementScriptsTest.scala`, `haystack/server/src/test/scala/haystack/storage/LegacyRetirementScriptsTest.scala` |
| One command for the tests | `nix develop .#chronicle --command bash scripts/one-off/legacy-retirement/test.sh` |

## 1. Summary per item

The items are independent: each has its own counters, its own verify result and its own deletion unit.

| Item | Production *(report)* | Method | Model time | Tool | Fixture-tested |
|---|---|---|---|---|---|
| **C-I** Chronicle model identity v1 (with pre-persistent sessions, the `ch_profile` singleton, opaque targets) | 6 profiles on the v1 space; 53 sources published on it; 2 retained-read approvals; 1 relocation row; 3,014 namespace rows; 0 deadline sessions; 0 opaque targets | SQL: transport-only relocation of the retained current-policy profile; retired-policy registry rows re-homed onto the v2 space; accepted work of unfinished v1 runs reset; proof, mapping and namespace rows removed. **No generation, job or receipt is deleted.** | no | `run.sh chronicle [--skip-formats]` | yes |
| **C-F** Chronicle publication formats (skippable) | 99 `ContiguousProblems` generations (12 published), 44 `LegacyAnnotations` (1 not retired, 0 published) | Product re-index of the 12 published sources (their old generations are retired by the product or by the next step); then `--retire-history` retires the remaining non-retired old-format generations as the product does: tombstone stays, derived rows go | **yes**, 12 sources | dashboard, then `run.sh chronicle --retire-history --confirm-retire-history N` | yes |
| **H-1** Haystack Node-era replay ledger | 185 rows `haystack-op-v1` | Delete | no | `run.sh haystack` | yes |
| **H-2** Haystack wide stored-read tolerance | 0 oversize, depth ≤ 6 *(report's SQL approximations)* | Nothing to migrate; decided by the real codec over every stored text | no | `check-stored-documents.sh` (JVM) | yes |
| **R** shared retrieval registry (Haystack, Manure) | **not measured** | Nothing expected; verify predicate | no | `run.sh haystack|manure preflight|verify` | predicate smoke-tested |
| **E-1** evaluation v2 layer and the V3 binder | files, not rows | Code change only | no | none | not applicable |

What still stands between this plan and "all legacy code deleted" is listed in section 11.

## 2. Chronicle

### 2.1 Definitions (observed)

`run.sh chronicle preflight` prints the counters of `sql/chronicle/counts-cte.sql`; each belongs to one item.

| Counter (`LR.…`) | Item | Predicate | Code that depends on it |
|---|---|---|---|
| `spaces.v1` | C-I | `ch_embedding_spaces.descriptor->>0 IS DISTINCT FROM 'embedding-space-v2'` | v1 branch of `EmbeddingSpace.verified`, `shared/retrieval-core/src/main/scala/ponygirls/retrieval/Retrieval.scala:26-40`, reached from `IndexProfiles.registered` (`IndexProfiles.scala:74-77`) |
| `profiles.v1_space`, `generations.v1_space`, `jobs.v1_space`, `owner_targets.v1_space`, `search_chunks.v1_space.exists`, `reindex_requests.v1_target` | C-I | references to a profile registered on such a space | retained-read join in `IndexProfiles.readSpaceSql` (`IndexProfiles.scala:78-83`) |
| `retained_profile_reads` | C-I | rows of `ch_retained_profile_reads` (`019_retained_profile_reads.sql`) | same join; written only by `ModelIdentityMigration.approveRead` (`ModelIdentityMigration.scala:64-71`) |
| `model_identity_migrations`, `checkpoint_namespaces` | C-I | rows of the two tables of `018_model_identity.sql` | `PostgresArchive.checkpointNamespace` (`Database.scala:272-280`), `CheckpointNamespace` (`IndexCheckpoints.scala:12-15`), worker use at `Models.scala:158,176,188` |
| `unfinished_runs.identity_changes` | C-I | a job that is not Complete and either has a namespace row for its run, or is on a v1-space profile and has an accepted checkpoint or an annotation attempt of its current epoch | `IndexCheckpoints.read` (`IndexCheckpoints.scala:30-32`), `AnnotationAttempts.reserve` (`AnnotationAttempts.scala:26-33`) |
| `reindex_requests.relocated_receipt` | C-I | `result->>'targetProfile' IS DISTINCT FROM target_profile` | none at run time; a v1 id inside a stored receipt |
| `singleton.legacy_or_unregistered` | C-I | `ch_profile.active/target` is not a registered current-policy profile, or is on a v1 space | read only by the pre-007 seed, `Database.scala:27-28` |
| `owner_targets.not_executable_policy_or_unregistered`, `generations.unregistered_profile` | C-I | opaque references | `OwnerTargets.eligible` / `IndexProfiles.registered` |
| `sessions.deadline` | C-I | `ch_sessions.expires IS NOT NULL` | `020_persistent_sessions.sql:3-11`; no current code writes a deadline (`Auth.scala:67,141`) |
| `generations.old_format.published`, `generations.old_format.history` | C-F | a generation that is **not retired** and whose `passage_format` is not `ContextAwareProblems` or whose profile's policy is not `ContextAwareProblemsV1`; published or not | `PassageStorage.format` and its `LegacyAnnotations` branch (`PassageStorage.scala:31-39`); `ReadableIndexPolicy` (`IndexProfiles.scala:8,75,79`); `ArchiveIndex.scala:153,225` |
| `info.generations.old_format.retired_tombstones`, `info.profiles.retired_policy`, `info.jobs.retired_policy` | — | retired generations in an old format; registry rows and jobs of retired policies | none (section 2.3) |

Facts that decide the methods (observed):

1. **The v1 space is the same model as the v2 space.** v1 is `["embedding-space-v1", <sha256 of the endpoint>, model
   tuple…]`, v2 is `["embedding-space-v2", model tuple…]` (`Retrieval.scala:17,26-40`). A retained profile is
   searchable only when `legacy.descriptor-0-0 = canonical.descriptor-0` (`IndexProfiles.scala:81`); the CLI approves
   a retained read only when the verified v1 space equals the configured embedding
   (`ModelIdentityMigration.scala:67-68`). Stored vectors need no recomputation.
2. **The product CLI relocates only a profile equal to the configured one** (`ModelIdentityMigration.scala:85-91`).
3. **A profile on the configured space needs no approval to be read**: `readSpaceSql` falls through to
   `compatible.embedding_space` (`IndexProfiles.scala:82`).
4. **The identity of a non-configured profile is opaque at run time**: only the configured profile is recomputed
   (`IndexProfiles.register`, `IndexProfiles.scala:64-69`).
5. **A pinned read asks the generation row only for `retired`.** `Database.selectView` reads
   `SELECT retired FROM ch_generations WHERE id=? AND session_id=? AND revision=?`; absent → `not-found`, retired →
   `indexed-view-retired` (`Database.scala:149-152`). Every other reader of `ch_generations` in
   `chronicle/server/src/main` goes through `ch_sources.published` (`Search.scala:57,93`, `ArchiveIndex.scala:157`,
   `Activity.scala:32`, `IndexProfiles.scala:88-90`, `ReindexCohort.scala:28`) or through `selectView` first
   (`PassageStorage.format`, called from `Database.scala:357-364`). A retired generation is never the published one.
6. **How the product retires a generation** (`ReindexCohort.published`, `ReindexCohort.scala:89-92`): `DELETE` from
   `ch_chunks`, `ch_problem_spans`, `ch_problem_passages`, `ch_context_spans`, `ch_generation_tags` for that
   generation, in that order, then `UPDATE ch_generations SET retired=true`. Search rows and pieces go by the
   cascade from `ch_chunks`. The row, its id, format and profile labels stay. An ordinary (non-rebuild) publication
   retires nothing: superseded generations stay readable as pinned views (`CONTRACT.md:253-262`).
7. **Formats.** `ContiguousProblems` uses the passage, span and piece tables of the current format without context
   spans; `LegacyAnnotations` has chunks only. The only current writer stores `ContextAwareProblems`
   (`Database.scala:304-306,315`). The dashboard already refuses to render the two old formats
   (`chronicle/web/src/passages.ts:8`).
8. **Rebuild is per owner and covers every head** (`ReindexCohort.scala:44-71`). "Retry failed" re-queues every
   Failed head job on the owner's target (`RetryFailedJobs.scala:13-14,84-86`). One job is retried by
   `Operation.RetryJob` (`Auth.scala:336`, `Jobs.retry` at `Database.scala:82-89`; dashboard: Activity, "Retry
   indexing job", `chronicle/web/src/Activity.tsx:68`).
9. **Accepted work is bound to the identity of its run.** Checkpoint keys hash `claim.profile` and, for embeddings,
   the embedding-space id (`IndexCheckpoints.scala:26-28`, `Models.scala:158`); a retry of a job that is not Complete
   keeps `run_id` (`Database.scala:88`). A changed identity meets the old row and fails with `checkpoint identity
   mismatch` or `annotation attempt input identity mismatch`, both `internal`, which escape the worker
   (`Models.scala:212`). **Reproduced**: before the fix of R2 the new fixture failed at `IndexCheckpoints.scala:32`
   inside `Worker.once`.

### 2.2 C-I: model identity v1 (decided: relocate by SQL, no model)

`sql/chronicle/21-batch-unfinished-runs.sql` (batched) and `30-identity.sql` (one transaction):

1. **Unfinished runs** (fact 9; review R2). For every job counted by `unfinished_runs.identity_changes` — with or
   without a namespace row — the accepted checkpoints of its current run are deleted, its namespace row removed, and
   `annotation_retry_epoch` and `fence` incremented. State, `run_id` and rebuild membership stay. Preflight prints the
   number of runs (`LR.unfinished_runs|<state>|n`) and of checkpoint rows to discard
   (`LR.info.unfinished_runs.accepted_checkpoints_to_discard`). In production both numbers are **unknown** until
   preflight.
2. **Sessions**: migration 020's conversion, for a database that acquired deadline rows afterwards.
3. **Singleton**: `ch_profile` is repointed to the single owner target when it does not name a registered
   current-policy profile (refuses when owner targets differ).
4. **Every profile still registered on a v1 space and still referenced** (by any generation including tombstones,
   job, owner target, rebuild request, the singleton or a search row):
   - *current policy*: verified exactly as `ModelIdentityMigration.scala:56-63,85-89` verifies (v1 space hashes to its
     id, has exactly one v2 counterpart with the identical model tuple; the profile id equals
     `sha256(["context-aware-problems-profile-v1", space, descriptor])`), then re-keyed to
     `sha256(["context-aware-problems-profile-v2", v2 space, v2 descriptor])` — the construction of
     `IndexProfileCatalog.contextAware` (`IndexProfiles.scala:31-32`) — and the seven references the CLI rewrites
     (`ModelIdentityMigration.scala:48-52,97`) are rewritten. The fixture asserts that the id computed in SQL equals
     `IndexProfileCatalog.current(olderConfig).preferred.profile`.
   - *retired policy* (`LegacyV4`, `ContiguousPassagesV1`): no canonical id can be derived (the writers are gone) and
     the id is opaque (fact 4). The registry row is **re-homed**: `embedding_space` becomes the canonical v2 space;
     id and descriptor unchanged. Its generations (published, historical or tombstones), jobs and receipts keep
     resolving to a registered profile, and a still-published old-format generation stays readable by fact 3. This is
     what makes C-I independent of C-F.
   - a profile the product CLI already relocated and that is referenced again, or a current-policy v1 profile that
     does not verify: **refuse**.
5. Stored rebuild receipts whose `targetProfile` differs from the control column are brought to the canonical id.
6. All `ch_checkpoint_namespaces`, `ch_retained_profile_reads`, `ch_model_identity_migrations` rows are deleted; then
   the unreferenced v1 registry rows and the v1 space row.
7. All counters are recomputed inside the transaction; a non-zero counter of a selected item aborts it.

Safety of the removals (observed):

| Removed | Foreign keys | Expectation in code |
|---|---|---|
| retained-read approvals | reference profiles and spaces; nothing references them | The earlier design note says to keep proof rows (`docs/drafts/20261105-2142-model-identity-migration.md:106-108`). They prove a v1→v2 equivalence that no longer applies once no profile is on v1. Superseded by the owner decision. |
| relocation mapping rows | reference profiles and spaces | read only by `checkpointNamespace` |
| namespace rows | `job_id` → `ch_jobs` | fact 9; handled per run in step 1 |
| v1 registry rows, v1 space row | no table has a foreign key to `ch_index_profiles.profile` except the two proof tables | unreferenced after step 4; checked, including one scan of `ch_search_chunks` |
| accepted checkpoints of unfinished v1 runs | — | cached model output; recomputed on retry (decided) |

Nothing else is removed. In particular the 3,473 jobs on v1 profiles *(report)* are relabelled or left as they are.

### 2.3 C-F: publication formats (decided: re-index the published ones, retire the rest with tombstones)

**Why not convert by SQL.** `LegacyAnnotations` has no passages to convert. `ContiguousProblems` is structurally
close, but a conversion would relabel output of the contiguous policy as output of the context-aware policy, and
nothing validates a stored generation against the current publication invariants
(`ProblemsPublication.validate`, `ProblemsPublication.scala:10-80`, runs only on a new publication).

**Step 1 — product re-index of the published old-format sources (12 *(report)*).** For each line of
`LR.reindex_worklist`:

| Worklist state | Operator action (as the owning account) | Cost |
|---|---|---|
| `Failed` head job on the target | Activity → "Retry indexing job" for that job (fact 8) | one job |
| `Queued` / `Running` | wait | — |
| `no-target-job`, or `stale-revision` without a job | only "Rebuild archive index" can queue it, and that queues **every head of the owner** (2,829 sources exist *(report)*): **stop and report to the owner** | — |
| job fails again; `owner-disabled` | **stop and report to the owner** (decision 1). The script keeps refusing; nothing unpublishes automatically. | — |

Do not use the owner-wide "Retry failed" for this: it re-queues every Failed head job of the owner
(`LR.info.jobs.failed_at_head_on_target` says how many).

Cost model: per source `W` annotation windows; one accepted chat-completion call per window plus at most 5 rejected
outputs and 10 reservations per window and retry epoch (`AnnotationAttempts.scala:10-12`);
`ceil(pieces / embeddingBatchSize)` embedding calls per window (`Models.scala:156-162`). Providers: the deployed
`annotation.endpoint` (OpenAI-compatible chat completions, strict JSON schema) and `embedding.endpoint`
(`config.example.json`). The deployed values were not read. Why the 12 are still on the old format is **unknown**;
the worklist prints the head-job states and error codes.

A job retried this way publishes as an ordinary publication: it does **not** retire the old generation (fact 6). The
old generation becomes unpublished, non-retired history and is handled by step 2.

**Step 2 — explicit retirement of non-retired old-format history (`--retire-history`).**

- By **default** the script refuses while any non-retired old-format generation exists and prints the counts by
  format and state, for example `LegacyAnnotations/history=1`.
- `--retire-history --confirm-retire-history N` (N typed from preflight's `LR.generations.old_format.history`; a
  wrong N refuses) runs `sql/chronicle/20-batch-retire-history.sql`: the five `DELETE`s of fact 6 in the product's
  order, then `retired = true`. Nothing else: the generation row, its id, revision, format and profile labels stay.
  No security-epoch change (the trigger fires on delete of a generation row only, `009_transient_security_epoch.sql:47-49`).
- A published generation is never retired by the script (the product never retires the published generation):
  with one present it refuses and points to step 1.
- Already-retired old-format generations (87 + 43 *(report)*) are not touched at all.

Effect on pinned reads (asserted in the fixture, before → after):

| Generation | Before | After the product re-index | After `--retire-history` |
|---|---|---|---|
| published, old format | chunks | `indexed-view-retired` (rebuild) or chunks (single-job retry) | `indexed-view-retired` |
| unpublished, not retired, old format | chunks | chunks | `indexed-view-retired` |
| already retired, old format | `indexed-view-retired` | same | same; row byte-identical |

The raw revision of every source stays readable (`ch_revisions` is not touched; asserted).

**What a tombstone must carry — answer to the review question.** Only `id`, `session_id`, `revision` and
`retired = true` (fact 5). Its `passage_format` and `profile` are historical labels that no code path reads: the
fixture sets a tombstone's format to NULL and its profile to an unregistered string, and the pinned read, the
passages read and the semantic guard of its owner still answer as before. Therefore:

- The format column of a tombstone need **not** remain parseable, and tombstones are **not** normalised: the script
  reproduces the product's retirement exactly and leaves the labels as history.
- The two old `PassageFormat` values are **not** needed in the wire model for tombstones. Once C-F is done no
  response can carry them (`PassagesResult.format` and `ArchiveRow.publishedFormat` are produced only for
  non-retired generations). Whether they leave the wire model is then purely an API question: the model is the
  single version `1.9.0` (`chronicle/models/chronicle.baboon:1-2,334`, `CONTRACT.md:1-3`), so removing enum members
  changes the contract. Proposed, in line with the stated preference: **keep both values as dead values, no API
  version bump; delete every code path that produces or reads content in those formats** (inventory 6.2); drop the
  values at the next version bump that happens for another reason.
- In the database the two strings remain legal for retired rows only: the proposed constraint is
  `CHECK (retired OR passage_format = 'ContextAwareProblems')` (6.6).

**Skipping the item.** `--skip-formats` on dry-run, apply and verify leaves every old-format generation alone: no
formats guard, no retirement, the formats counters do not decide the result (`verify-zero-formats-skipped`,
`applied-formats-skipped`). C-I is complete without it (asserted in the fixture: both old formats are still served
after the identity apply). C-F can run later, or never; then inventory 6.2 stays.

### 2.4 Preconditions and order

| Question | Answer |
|---|---|
| Binary during the migration | The **current** integration binary (`ab3e8a87` line). It must have started once against the database (migrations 018–020 present; the configured v2 space registered). The script is bound to `ch_schema_migrations` = `2,3,6,8,9,14,17,20`. |
| Quiescence | Step 1 of C-F needs the service running with workers. The SQL needs the workers stopped and no live lease; it refuses on a live lease and, by default, on any other client connection. Proposed: stop the service for the SQL. |
| Can it run while the service is up? | Not recommended for Chronicle: part 3 holds `SHARE ROW EXCLUSIVE` on `ch_jobs` and `ch_owner_targets` (as the CLI does, `ModelIdentityMigration.scala:77`), so ingests and claims block. `--allow-active-connections` exists for `serve-standby` and tests. |
| Idempotency | Every statement selects by the legacy predicate; a second run finds nothing. Asserted (database content identical after a second apply, for both items). |
| Transaction boundaries | `apply`: each batch is one transaction; part 3 is one transaction. `dry-run`: everything in one transaction, rolled back. A refusal or error ends the psql session; the server rolls the open transaction back. Committed batches leave a database the current binary reads. |
| Partial failure | Run `preflight` again (new plan token) and `apply` again. |
| Locks | Batches: row locks on the selected generations/jobs and on the derived rows. Part 3: advisory lock `model-identity-migration-v2`, `SHARE ROW EXCLUSIVE` on two small tables, row locks on relabelled rows. `lock_timeout` 5 s, `statement_timeout` 900 s. |
| Database size | The live `chronicle` database is 168 GB *(report)*. The migration adds no significant size. |

**Duration and the temporary-index question.** Revision 1 deleted generation rows; each such delete scanned
`ch_search_chunks` through its unindexed foreign key on `generation`. That is gone: no generation row is deleted.
Retirement deletes chunks through the existing index `ch_chunks_order(generation, ordinal)` and reaches search rows
and pieces by primary key. What remains are sequential scans of `ch_search_chunks` (913,328 rows, 8.0 GB with TOAST
*(report)*) by `profile`, which has no index: one for the `UPDATE … SET profile` of the re-keyed profile (about
14,000 rows rewritten, inferred from 41 of 2,610 published sources), one for the final registry check, and one per
counter evaluation while v1 profiles exist (preflight, before, after). About four scans per apply. Everything else
touches at most a few thousand small rows.

A temporary index on `ch_search_chunks(profile)` is **not** recommended: building it costs one scan plus a sort,
it saves about three scans, every rewritten row would pay one more index entry, and it is DDL on the largest search
table. The duration is **not measured**; the rehearsal on the full clone measures it (section 8), and runbook step 4
measures one scan read-only on production. Decision rule: if one scan takes longer than about 5 minutes, raise
`--statement-timeout`; only if it takes longer than about 30 minutes reconsider the index.

### 2.5 Verification

1. `run.sh chronicle verify` (or `--skip-formats`): exit 0, `LR.result|verify-zero`. It prints one line per format
   and space version of the published generations; after both items the only line is
   `LR.published_by_format|ContextAwareProblems|embedding-space-v2|N` (N = 2,610 *(report)* unless ingestion moved it).
2. The report's predicates (`sql/10-…`, `11-…`) re-run read-only: one space (`embedding-space-v2`); `C2b.*` = 0 except
   that retired-policy profiles now show under `embedding-space-v2`; `C3.relocation | 0 | 0 | 0 | 0`;
   `C4.retained | 0`; `C5.formats`: old formats only with `retired = t`; `C7.opaque | 0 | 0 | 0`.
3. Product checks with the current binary restarted: one semantic search per owner returns hits and not
   `unavailable` (the guard `IndexProfiles.semantic`, `IndexProfiles.scala:84-92`, fails the whole request if any
   visible publication is unreadable); the passages panel of a relocated source and of a re-annotated source renders;
   a pinned link to a retired old-format generation shows the "retired" outcome; a new ingest is indexed.

### 2.6 Irreversibility, backup, abort

Cannot be undone without a backup: the derived rows of retired old-format history (chunks, passages, spans, tags of
superseded revisions); the accepted checkpoints of unfinished v1 runs; the proof, mapping and namespace rows; the v1
ids (the relocation is many-to-one in principle; do not reverse it by SQL). Raw archive content, every published
generation and every generation row survive.

**Backup is a hard precondition of apply** (decision 4). `apply` requires `--backup-reference REF` and prints it;
the script cannot verify the backup itself. There is no backup job in the production namespace and SRE backups are
not configured *(report)*. Acceptable mechanisms, chosen with the owner at go time:

| Mechanism | Space it needs | How to measure |
|---|---|---|
| Storage-level snapshot of the PostgreSQL volume | by the platform; at most the volume size | `LR.size.database_bytes` of every database on the volume |
| `pg_dump --format=custom` to a named location, service stopped | at most `LR.size.table_data_bytes` before compression; with `--exclude-table-data=ch_index_checkpoints` at most `LR.size.table_data_without_checkpoints_bytes` (a restore then recomputes accepted work on retries) | preflight prints both; free space at the destination with `df` |
| Same-cluster template copy: `CREATE DATABASE <copy> TEMPLATE chronicle` (no connections to the source) | `LR.size.database_bytes` again on the same volume | `df -h` on the data directory inside the pod |

The existing rollback copies are not such a backup: they are from 2026-11-05/06. For Haystack: `pg_dump` (33 MB
*(report)*).

Abort: end the psql session. Before part 3 commits, the database is in a state the current binary reads. After it
commits, rollback means restoring the backup.

## 3. Haystack

### 3.1 H-1: Node-era replay ledger (decided: delete)

Definition (observed): `write_requests.digest_format = 'haystack-op-v1'`, the column default
(`haystack/migrations/0001-initial.sql:57`); the Scala service always writes `haystack-op-scala-v1`
(`OperationEnvelope.scala:15`, insert at `PostgresItemRepository.scala:112`). Production: 185 rows, all created
before the cut-over marker *(report)*.

What the ledger guarantees (`PostgresItemRepository.scala:95-115`): a write is keyed by `(principal_user, token_id,
request_id)`; the same key with the same digest and format returns the recorded outcome; with another digest or
format, `replay-conflict`. A Node-era row can never match, so its only effect is `replay-conflict` for a retry of a
Node-era request id; its `outcome` is never decoded. Retention horizon in code: **none**
(no `DELETE FROM write_requests` in `haystack/server/src/main`; migration 0004 records "retain historical replay
rows").

Consequence of deleting the rows (asserted in the fixture): a retry of a Node-era request id is evaluated as a new
operation: `conflict` when its expected revision is stale — which it is whenever the original write was committed,
because that write advanced the revision (`ItemRepository.scala:33-36`) — or a new write when it names the current
revision. No acknowledged document, revision or link changes.

Method: `run.sh haystack apply` deletes the rows in batches. It refuses when the schema is not exactly 0001–0006,
the cut-over marker is absent, a `haystack-op-v1` row is newer than the marker, or an unknown format exists. Safe
while the service is up (inferred: point deletes, no table lock): `--allow-active-connections`. Sub-second.

### 3.2 H-2: wide stored-read tolerance (review R3: decided by the real codec, not by SQL)

Definition (observed): a stored document that `DocumentCodec.decodeStored` accepts only because it parses with
`StoredLimits` and skips the link-key check (`DocumentCodec.scala:24,39-43,77-80`).

Revision 1 verified this with SQL patterns. That was wrong in both directions: `p:%FF` and `p:%00` pass the pattern,
but `QualifiedId.decodeKey` rejects invalid UTF-8 and a decoded NUL (`QualifiedId.scala:40-67`); and a document
without `links` was flagged although the codec accepts omission (`DocumentCodec.scala:71-72`). SQL cannot reproduce
`decodeKey` (strict UTF-8 decoding, canonical re-encoding, UTF-16 length) or the JSON envelope exactly, so **no SQL
predicate authorises this item any more**. The counters are gone from `verify`; `preflight` and `verify` print a
note that says so.

The check is `check-stored-documents.sh`:

1. `run.sh haystack export-stored-documents` — one read-only psql session — prints every `document_text` of `items`
   and `item_revisions` (the column the repository decodes, `PostgresItemRepository.scala:41-45`) as hex, with a
   closing line of row counts.
2. `haystack.storage.LegacyStoredDocumentCheck` (test scope of the Haystack server module) classifies each text with
   the real codec: `decodeStored` (today's path); `LosslessJson.parse(text, DocumentCodec.Limits)`; and
   `QualifiedId.decodeKey` on every link target. Those three together are exactly the decode path that remains when
   the tolerance is removed (`decodeStored` with `Limits` and with the link-key check); no new-write admission is
   applied, as stored reads never apply it. Output: counts of `strict_ok`, `needs_wide_envelope`,
   `needs_relaxed_links`, `unreadable_today`; exit 0 only when every text is `strict_ok` and the export is complete.

It needs **a JVM** (sbt in `nix develop .#chronicle`) on the operator's host. It does not need a database connection
of its own: the documents reach it through the same psql path as everything else, so the pod still needs only psql.
The export is real document content: the script writes it to a 0600 file in a 0700 temporary directory and removes
it on exit. Production: 250 items and 359 revisions, at most 59 KB each *(report)*, so at most about 36 MB.

Fixtures (asserted): invalid historical percent-encoded targets `p:%FF` and `p:%00` are readable by the current
service and counted `needs_relaxed_links` (they block the deletion); a Node-validator oversize document is counted
`needs_wide_envelope`; a document that omits `links` passes; a truncated export never passes.

When the deletion unit rewrites `decodeStored`, it should point `LegacyStoredDocumentCheck.classify` at the new
function and run the check once more before merging.

The control-character identities (report item H4) are current behaviour, not legacy; not part of this plan.

### 3.3 R: shared retrieval registry — measured by the scripts, not yet in production

`PostgresRetrieval.migrateModelIdentities` (`shared/retrieval-postgres/…/PostgresRetrieval.scala:48-72`) has no
caller in any service. Whether `haystack` or `manure` hold a v1 descriptor in `pony_retrieval_profiles` was **not
checked** by the report (its `H7` counts the schema-version table). `run.sh haystack preflight|verify` and
`run.sh manure preflight|verify` print `LR.retrieval.v1_profiles`; verify fails when a non-v2 descriptor exists.
Expected 0 (inferred: the table has no statistics in the report). The rehearsal answers it for both databases
(section 8); if it is non-zero, inventory rows marked "guard R" stay until a caller is written.

## 4. Evaluation v2 and the V3 binder (E-1)

Not database rows; the inventory is in 6.5. The **current** V3 workflow binds a run to the server's model catalog
in the *v1* descriptor shape (`chronicle/eval/relevance/workflow_v3.py:436-452`, `run_real.py:92-100`), while the
current server registers v2 descriptors at start-up (`IndexProfiles.scala:25-32`). Inferred, not run: a V3 run
against a current isolated server fails at `bound-embedding-space-mismatch`. Its correction is part of the
evaluation-v2 unit (6.5), with the commands that verify it.

## 5. What is not covered

| Deployment / copy | State *(report)* | What it needs |
|---|---|---|
| Four rollback copies in the production cluster | the Chronicle copies hold legacy data and lack migration 020 | Dropped after verification (decided): runbook step 17. Until then they must not be restored under a legacy-free binary. |
| MAN prototype cluster | scaled to 0; volumes recorded as empty test state, not queried | Before any restart under a legacy-free binary: `preflight` on its databases, or delete its volumes. |
| Personal VM deployments | declared with the services disabled; actual state not observed | Same. |
| Old compute host leftovers | not running, contents not inspected | Delete, or treat as needing the compatibility binary. |
| Backups / off-cluster archives | none configured; a 2026-11-06 Chronicle source archive was not located | A restore of a pre-migration copy needs the last binary that contains the legacy code (tagged at step 14) and these scripts from that tag. |
| Developer and test instances elsewhere | unknown | `run.sh … preflight` is read-only and safe to run anywhere. |

## 6. Deletion inventory

Each block becomes deletable when its guard is zero **in production** and the copies of section 5 are gone or
accepted. Line numbers are at `ab3e8a87`; symbols are given so the deletion units can re-locate them.
`…/chronicle/` = `chronicle/server/src/main/scala/chronicle/`, `…/test/` = `chronicle/server/src/test/scala/chronicle/`.

### 6.1 Chronicle model identity v1 — guard: `run.sh chronicle verify --skip-formats` zero

| Path | Lines / symbol | Why legacy |
|---|---|---|
| `…/chronicle/ModelIdentityMigration.scala` | whole file | one-off relocation CLI |
| `…/chronicle/Main.scala` | 20–25 (`migrate-model-identities`), usage text at 45 | CLI entry |
| `…/chronicle/IndexProfiles.scala` | 78–83 `readSpaceSql`: the `ch_retained_profile_reads` join and `sameModel`; reduces to `compatible.embedding_space` | retained-read approvals |
| `…/chronicle/Database.scala` | 272–280 `checkpointNamespace` | v1 checkpoint namespaces |
| `…/chronicle/IndexCheckpoints.scala` | 12–15 `CheckpointNamespace`, 17 trait method | same |
| `…/chronicle/Models.scala` | 120 (`Windows` parameter), 158, 176, 188 | same |
| `…/chronicle/Database.scala` | 25 (`ch_profile` insert), 27–28 (seed from the singleton); keep 50 | pre-007 archives |
| `chronicle/migrations/020_persistent_sessions.sql` | 3–11 (conversion block); keep 1 and the trigger | pre-020 rows |
| `shared/retrieval-core/src/main/scala/ponygirls/retrieval/Retrieval.scala` | 26–40: the `legacy` branch of `EmbeddingSpace.verified` | parses v1 descriptors — **guard R as well** |
| `shared/retrieval-core/README.md` | 6 | documents v1 verification |
| `shared/retrieval-postgres/…/PostgresRetrieval.scala` | 48–72 `migrateModelIdentities` | no caller — **guard R** (`LR.retrieval.v1_profiles` = 0 in haystack and manure) |
| `docs/drafts/20261105-2142-model-identity-migration.md` | whole | procedure of the retired CLI; mark superseded |
| `…/test/ModelIdentityMigrationTest.scala` | whole file | tests of the above |
| `…/test/ArchiveContract.scala` 93–95; `…/test/PassageWorkerTest.scala` 21, 249; `…/test/ContextWorkerRecoveryTest.scala` 31 | `checkpointNamespace` implementations | follow the trait |
| `…/test/IndexProfilesTest.scala` | 40–63 | tests the singleton seed |
| `…/test/PersistentBrowserSessionTest.scala` | 61–85 | tests the 020 conversion |
| `…/test/RetryFailedJobsTest.scala` 37, 55, 101; `…/test/ActivityTest.scala` 446, 457; the `UPDATE ch_profile` lines of about 25 suites | fixture upkeep of the singleton | table dropped (6.6) |
| `shared/retrieval-core/src/test/…/RetrievalCoreTest.scala` 13–21; `shared/retrieval-postgres/src/test/…/RetrievalContractTest.scala` 171–189 | v1 cases | test the v1 branch |
| `…/test/LegacyRetirementScriptsTest.scala`, `scripts/one-off/legacy-retirement/` | whole | this one-off (reachable from the tag of step 14) |

Keep: `Database.scala:49` and `liveSession` in `Auth.scala:102` (deadline semantics of the `expires` column).

### 6.2 Chronicle publication formats — guard: `run.sh chronicle verify` zero (skipped if C-F is skipped)

Rule (decided): **both old `PassageFormat` values stay in the wire model as dead values, without an API version
bump; every code path that produces or reads content in those formats is deleted.**

| Path | Lines / symbol | What happens |
|---|---|---|
| `chronicle/models/chronicle.baboon` 334; `chronicle/generated/**/PassageFormat.*`; `chronicle/cli/src/schema-data.ts` 2610–2611 | `LegacyAnnotations`, `ContiguousProblems` | **stay** (dead values); add a comment that no response carries them |
| `…/chronicle/PassageStorage.scala` | 39: the `LegacyAnnotations` branch; 32: accept only `ContextAwareProblems`, anything else `unavailable` | delete / narrow |
| `…/chronicle/IndexProfiles.scala` | 8 `ReadableIndexPolicy` (`LegacyV4`, `ContiguousPassagesV1`); literal lists at 75 and 79 | delete; registry rows of the retired policies stay in the database as inert labels of tombstones and old jobs |
| `…/chronicle/Models.scala` | 205: "index policy is retired" check, unreachable with one policy | delete |
| `chronicle/web/src/passages.ts` | 8 (refusal message for old formats) | becomes a generic "unknown format" guard |
| `chronicle/CONTRACT.md` | 253–262 | rewrite: old formats exist only as retired tombstones |
| `…/test/StoredPublicationFixtures.scala` | whole file | writes `LegacyV4` / `LegacyAnnotations`. It is also the generic "publish something" helper of about 35 test files (`TagSearchTest`, `ReadSourceFixture`, `McpSourceBoundaryTest`, `DashboardOperationsTest`, `PassagePostgresBoundaryTest`, `PostgresBehaviorTest`, `RetryFailedActionsTest`, `StaticTokenTest`, `TokenVisibilityTest`, …): those callers move to `TestPublications` first |
| `…/test/DashboardOperationsTest.scala` 46–56; `…/test/PassagePostgresBoundaryTest.scala` 23–43, 77–97; `…/test/ReindexCohortTest.scala` 65–66, 163; `…/test/ArchivePublishedFormatTest.scala` (old-format cases); `…/test/Fixtures.scala` 3–8 | old-format cases and aliases | delete; keep one case that a tombstone with an old-format label answers `indexed-view-retired` |
| `chronicle/web/tests-browser/{rebuild,history-fixture,goal50-fixture,archive,fixture}.mjs`, `web/ui-capture/seed.mjs`, `web/tests/goal50.test.ts` | cases that seed or expect readable old formats | delete or convert to the tombstone case |

### 6.3 Haystack replay ledger — guard: `run.sh haystack verify` zero

| Path | Lines / symbol | Why legacy |
|---|---|---|
| `haystack/server/src/main/scala/haystack/storage/PostgresItemRepository.scala` | 103: the `format != op.digest.format` half of the comparison | one format remains |
| `haystack/server/src/test/scala/haystack/storage/MigrationsTest.scala` | 139–171 (cut-over case): the old-replay rows and assertions at 151–152, 158–159, 168–169 | same |
| `…/storage/HistoricalIdentityTest.scala` | the H1 cases (39, 44, 49–50 per the report; re-check) | same |
| `…/storage/LegacyRetirementScriptsTest.scala` | whole | this one-off |

### 6.4 Haystack wide stored-read tolerance — guard: `check-stored-documents.sh` exits 0 (`LR.result|stored-documents-strict-ok`)

| Path | Lines / symbol | Why legacy |
|---|---|---|
| `haystack/server/src/main/scala/haystack/domain/DocumentCodec.scala` | 24 `StoredLimits`; 40–42 (parse with `Limits`; keep the `unavailable` mapping and keep it distinct from `parse`); 52, 77–80 `validateLinkKeys` | wide stored read |
| `…/domain/HistoricalAdmissionTest.scala` | 38–47, 66–77, 81–83 (report; re-check); `HistoricalFixture.text` uses `StoredLimits` at 12 | same |
| `…/storage/HistoricalStoredReadTest.scala` | 13–64, 81–end; keep 66–79 as a current regression (report; re-check) | same |
| `haystack/server/src/test/resources/haystack/historical/unicode-{bmp,astral}-over-new-byte-envelope.json.gz` and their manifest entries | fixtures | same |
| `…/domain/DocumentCodecTest.scala` | 134 | uses `StoredLimits` |
| `…/storage/LegacyStoredDocumentCheck.scala`, `check-stored-documents.sh` | whole | this one-off; before deleting, run it once against the rewritten `decodeStored` (3.2) |

The Haystack test line ranges marked "report" were only spot-checked; the deletion unit must re-read them.

### 6.5 Evaluation v2 and the V3 binder — guard: decision E

`chronicle/eval/relevance/`: `reparse.mjs` + `tests/reparse.test.mjs`; `assess_batch.py` + `tests/test_assess_batch.py`;
`proposition_support.py` + `tests/test_proposition_support.py`; `source_observations_v3.py:283-350`
(`legacy_read_view`, `legacy_page`) + `tests/test_source_observations_v3.py:189-240`;
`tests/test_runner_integration_v3.py:136,193`; `tests/test_workflow_v3.py:266-272`; the v2 sections of `README.md`
(238–262), `BATCH_ASSESSMENT.md`, `PROPOSITION_SUPPORT.md`. `RESULTS.md` keeps its numbers as history. (List from the
report; not re-verified line by line.)

**Correction in the same unit** (not a deletion): `workflow_v3.py:436-452` (`models`) and `run_real.py:92-100`
(`verify_model_catalog`) must expect what the current server registers — the space
`["embedding-space-v2", model, revision, dimensions, sendDimensions, queryPrefix, documentPrefix, "cosine"]`, the
descriptor `["index-profile-descriptor-v2", [model, revision, requestPolicy identity, maxResponseBytes], kernel]` and
the profile id `sha256(["context-aware-problems-profile-v2", space id, descriptor])` (`IndexProfiles.scala:21-32`,
`Retrieval.scala:17-18`) — and the fixtures in `tests/workflow_cases_v3.py:41-44` with them. Verify with:

```sh
python3 -m unittest discover -s chronicle/eval/relevance/tests -v
```

and the controlled real-server acceptance leg of `chronicle/eval/relevance/README.md` (the repository rule for a
changed runner/transport), which is the only check that binds against a real current server.

### 6.6 Schema clean-up migrations (proposed; validated on the fixture databases)

| Migration | File used for validation | Worth doing? |
|---|---|---|
| Chronicle: drop `ch_retained_profile_reads`, `ch_checkpoint_namespaces`, `ch_model_identity_migrations`, `ch_profile`; marker 21; remove `018`/`019` from the start-up list (`Database.scala:22`) | `sql/chronicle/proposed-cleanup-identity.sql` | **Yes** |
| Chronicle: `ch_generations_current_format_check CHECK (retired OR (passage_format IS NOT NULL AND passage_format = 'ContextAwareProblems'))`; marker 22 | `sql/chronicle/proposed-cleanup-formats.sql` | **Yes**, if C-F was carried out. It replaces both "tighten the format check" and "NOT NULL" of revision 1: tombstones keep their label. `011_context_coverage.sql:1-4` re-creates the wide check at every start-up and can stay. |
| Chronicle: tighten `ch_index_profiles_policy_check` | — | **No**: retired-policy registry rows stay as labels of tombstones and old jobs. |
| Chronicle: index on `ch_search_chunks(generation)` or `(profile)` | — | Not legacy; purge has the per-generation scan (`Auth.scala:341`). Separate question. |
| Chronicle: drop `ch_sessions.expires` | — | **No**: deadline semantics are current. |
| Haystack `0007`: drop the `digest_format` default, `CHECK (digest_format = 'haystack-op-scala-v1')`, a cut-over row recording the retirement | `sql/haystack/proposed-cleanup.sql` | **Yes**: the default silently stamps the Node format on any insert that omits the column (the fixture relies on exactly that before the clean-up and shows the insert refused after it). **After 0007 the current binary no longer starts** (`Migrations.scala:17`, "unknown database migration"; asserted): there is no rollback of the deployment past it. |

Observed on the fixture: after the two Chronicle clean-up files, the current binary's start-up re-creates the four
tables and serves again, so a deployment rollback is possible there; the retained check then reports
`LF.legacy_tables_present|4`.

## 7. Runbook

Conventions. `RUN` = `sh scripts/one-off/legacy-retirement/run.sh`. Every invocation composes **one psql session**
locally and writes it to psql's standard input. The operator is an agent working through an exec into the database
pod; the psql command is supplied in `PSQL`:

```sh
PSQL='kubectl <context/namespace flags> exec -i <database pod> -c <container> -- psql -h <socket dir> -U <role> -d <database>' RUN chronicle preflight
# or review first, then pipe the reviewed file
RUN chronicle dry-run --emit > session.sql ;  kubectl … exec -i … -- psql -X -q -v ON_ERROR_STOP=1 -d <database> -f - < session.sql
```

Context, namespace, pod, socket directory and role are in the deployment repository and in the report's
`run_sql.sh`; they are deliberately not written here.

**What the operator must have at each stage**

| Stage | Inside the database pod | On the operator's host | Elsewhere |
|---|---|---|---|
| preflight, dry-run, apply, verify (`run.sh`), `drop-databases.sh`, retained checks | `psql` only | the repository, POSIX `sh`, `awk`, `grep` | — |
| C-F step 1 (re-index) | — | a browser session as each owning account | the running service **with workers** and both **model endpoints** |
| H-2 codec check | `psql` only | the repository inside `nix develop .#chronicle` (**JVM**, sbt) | — |
| Backup | by mechanism (2.6) | — | destination with the measured space |
| Rehearsal clone | `pg_dump` (inferred to be in the PostgreSQL image; **not verified**) | `nix develop .#chronicle` (PostgreSQL 18 + pgvector), bash, the private directory under `/mnt/dev-data` | model endpoints or a local stub (section 8) |

Stop condition for every step unless stated: an exit status other than 0, or an `ERROR:` line. A message that
starts with `legacy-retirement refused:` is read and reported, never worked around.

| # | Step | Command | Expected | Stop when |
|---|---|---|---|---|
| 1 | Current overhaul binary deployed; credential preflight of the deployment repository | — | services healthy | — |
| 2 | Chronicle preflight | `RUN chronicle preflight` | `LR.schema_migrations|2,3,6,8,9,14,17,20`; counters near section 1; `LR.old_format|…` lines; `LR.reindex_worklist|…` (12 sources); `LR.unfinished_runs|…`; `LR.size.*` | schema differs; counters far from the report |
| 3 | Haystack and Manure preflight; Haystack codec check | `RUN haystack preflight`; `RUN manure preflight`; `sh scripts/one-off/legacy-retirement/check-stored-documents.sh` (JVM) | `LR.replay.node_format|185` or fewer; `LR.retrieval.v1_profiles|0` twice; `LR.result|stored-documents-strict-ok` | a retrieval counter is non-zero (guard R code stays); the codec check fails (inventory 6.4 stays) — report, continue with the other items |
| 4 | Measure one scan of `ch_search_chunks` (read-only) | `EXPLAIN (ANALYZE, BUFFERS) SELECT count(*) FROM ch_search_chunks WHERE profile = repeat('0', 64);` under `SET statement_timeout = '300s'` | one sequential scan; note its time | above about 5 min: plan `--statement-timeout` accordingly (2.4) |
| 5 | C-F step 1: re-index the worklist, service running | per-job "Retry indexing job" as in 2.3 | jobs Complete; `RUN chronicle preflight`: `LR.generations.old_format.published|0` | a job fails again, a source has no target job, or an owner is disabled: **stop and report to the owner**; C-I can still proceed with `--skip-formats` |
| 6 | Owner's explicit go for the irreversible part, and the choice of the backup mechanism | — | explicit | no go |
| 7 | Stop Chronicle (workers and API); wait for leases | deployment repository | `RUN chronicle preflight`: `LR.info.jobs.running_live_lease|0`, `LR.other_client_backends|0` | either is non-zero |
| 8 | **Backup** (2.6), sized from `LR.size.*` and `df` | deployment repository | a restorable artefact; its identifier becomes `REF` | no restorable backup |
| 9 | Chronicle dry-run | `RUN chronicle dry-run --retire-history --confirm-retire-history <LR.generations.old_format.history> --batch-size 10` | `LR.result|dry-run-rolled-back`; `LR.after.*` all 0; `LR.step.history_generations_retired` sums to the confirmed number | refusal |
| 10 | Chronicle apply | `RUN chronicle preflight` (take `LR.plan`), then `RUN chronicle apply --apply-irreversible --confirm-database <name> --expect-plan <LR.plan> --backup-reference <REF> --retire-history --confirm-retire-history <n> --batch-size 10` | `LR.backup_reference|<REF>`; `LR.result|applied` | refusal; `legacy-retirement incomplete` → preflight and apply again |
| 11 | Chronicle verify; start the service (same binary); product checks (2.5) | `RUN chronicle verify` | `LR.result|verify-zero`; searches return hits; a pinned old-format link shows "retired" | non-zero: restore decision with the owner |
| 12 | Haystack: backup (`pg_dump`), dry-run, apply, verify; service may stay up | `RUN haystack dry-run --allow-active-connections`; `RUN haystack preflight`; `RUN haystack apply --apply-irreversible --confirm-database <name> --expect-plan <LR.plan> --backup-reference <REF> --allow-active-connections`; `RUN haystack verify` | `LR.step.node_replay_rows_deleted` sums to the preflight count; `verify-zero` | refusal |
| 13 | **Pre-removal verification** — the last use of the one-off scripts against production | `RUN chronicle verify`; `RUN haystack verify`; `RUN manure verify`; `check-stored-documents.sh` | three times `verify-zero`; `stored-documents-strict-ok`. Record the outputs: they are the guards of section 6 | any guard not met: its inventory block is not deleted |
| 14 | Tag the last commit that contains the legacy code and these scripts | `git tag` (name chosen by the owner) | tag exists | — |
| 15 | Repository work: delete the legacy code per section 6 for every guard met; add the clean-up migrations (6.6); full suites. `scripts/one-off/legacy-retirement` is removed here; the two `check-legacy-free.sql` files stay | — | suites green | — |
| 16 | Deploy the legacy-free binaries (their start-up applies 6.6), then the **post-deployment check** with the retained files | `psql -X -q -v ON_ERROR_STOP=1 -f - < chronicle/scripts/check-legacy-free.sql` (through the same exec path; add `-v require_formats=f` if C-F was skipped); the same with `haystack/scripts/check-legacy-free.sql` | Chronicle: `LF.legacy_tables_present|0`, `LF.embedding_spaces.not_v2|0`, `LF.owner_targets.not_executable|0`, `LF.published.retired_or_unregistered|0`, `LF.sessions.deadline|0`, `LF.generations.not_retired_old_format|0`, `LF.generations.current_format_constraint|1`, `LF.result|legacy-free`. Haystack: `LF.replay.other_digest_format|0`, `LF.replay.column_default_present|0`, `LF.replay.current_format_constraint|1`, `LF.schema.node_replay_retired_marker|1`, `LF.result|legacy-free` | `LF.result|legacy-present`. Chronicle can be rolled back to the tag of step 14 (6.6); Haystack cannot once 0007 is applied — restore from the backup of step 12 instead |
| 17 | **Separately confirmed:** drop the four rollback copies | `PGDATABASE=postgres sh scripts/one-off/legacy-retirement/drop-databases.sh preflight <name1> <name2> <name3> <name4>` (from the tag of step 14; names from the report's `out/00-inventory.txt`), then **for each name, after the owner confirms that name**: `… drop-databases.sh drop <name> --confirm-database <name> --expect-oid <OID from preflight>` | preflight: four `DB.named|<name>|present|<oid>|<bytes>|0|f` lines and the `DB.stays|…` lines for `chronicle`, `haystack`, `manure`, `postgres`. Each drop: `DB.remaining|0`, `DB.result|dropped` | a named database is absent, has connections, or appears under `DB.stays`; a live database appears among the names |

Order note for steps 13–16: `run.sh … verify` reads the tables that the clean-up drops and is bound to the
pre-clean-up schema, and it is deleted in step 15. It is therefore the **pre-removal** check (step 13) only. After
the deployment the check is the retained SQL (step 16). Validated on the fixture databases: before the clean-up the
retained check fails (`legacy-present`); after it, it passes and `run.sh chronicle verify` fails with "relation …
does not exist" while `run.sh haystack dry-run` refuses with "unexpected schema_migrations".

## 8. Rehearsal (requirement A; review R4)

**Recommendation: a full clone**, on `/mnt/dev-data` (LVM, about 4 TB free), never on the root disk.

Why not the subset of revision 1: it copied every source and job row but omitted the revisions of non-cohort
sources; a worker then claims a queued job whose revision row is absent and `PostgresArchive.claim` throws
`stale-claim` (`Database.scala:228-231`), which escapes the worker. A subset that is closed under everything the
workers and the prescribed actions can touch is the whole database. A full clone also makes the timings
transferable (2.4) and answers the three unmeasured items below with production's own data.

| | Size | Duration (estimates, **not measured**; `clone.sh` records the real seconds in `MANIFEST`) |
|---|---|---|
| Source databases | `chronicle` 168 GB, `haystack` 33 MB, `manure` 36 MB *(report)* | — |
| Dumps (`pg_dump --format=custom --compress=1`) | 40–80 GB | 1–2 h, bounded by one pg_dump process and the exec stream |
| Restored cluster | about 170 GB plus up to 16 GB WAL | 2–4 h with `--jobs 8`: data load about 1 h, then the trigram index over 29.5 GB of fragments and the HNSW index over 913,328 vectors |
| **Budget on `/mnt/dev-data`** | **300 GB** | **half a day end to end** |

The dump is read-only at the source: pg_dump runs in one `REPEATABLE READ, READ ONLY` transaction with `ACCESS
SHARE` locks. Its snapshot stays open for the duration, which holds back vacuum on the live database for 1–2 hours
(inferred to be acceptable at the report's write rates; say so at go time). No sanitisation: **the clone holds real
session content**.

Procedure (written now, **not run**). `L=scripts/one-off/legacy-retirement`; `D=/mnt/dev-data/<private name>`:

```sh
# 1. export — read-only at the source; creates D with mode 0700 and refuses any other directory
SOURCE_PG_DUMP='kubectl <flags> exec -i <database pod> -c <container> -- pg_dump -h <socket dir> -U <role>' \
  bash $L/rehearsal/clone.sh export --dir "$D" chronicle haystack manure
# 2. scratch cluster in D: unix socket for psql; loopback TCP with a generated password for the service binary
bash $L/rehearsal/clone.sh init-cluster --dir "$D"
bash $L/rehearsal/clone.sh restore --dir "$D" --jobs 8 chronicle haystack manure
eval "$(bash $L/rehearsal/clone.sh env --dir "$D")"      # PGHOST, PGPORT, PGUSER for run.sh
# 3. rehearse the runbook steps 2–13 and 15–17 against the clone (section 7), with PGDATABASE=<database>
# 4. delete — the exact deletion step
bash $L/rehearsal/clone.sh stop-cluster --dir "$D"
bash $L/rehearsal/clone.sh delete --dir "$D" --confirm "$D"      # rm -rf of D; refuses while the cluster runs
ls -d "$D"                                                       # must answer: No such file or directory
```

Everything the rehearsal writes (binary configuration, logs, backups it practises) goes under `D`, so step 4 removes
it. The mechanics of `clone.sh` were exercised on this host with a small local source cluster (export, mode 0700,
restore including the `vector` extension, `run.sh` against the clone, the loopback listener refusing a wrong
password, refusal to delete while running, refusal for a foreign directory, deletion).
The report notes that `/mnt/dev-data` was slow to list and holds another user's home: confirm the path and that
`D` is created by the rehearsing user.

What the rehearsal needs beyond PostgreSQL:

- The **current** binary and a configuration equal to production's in every field of the model identity: embedding
  `model`, `revision`, `dimensions`, `sendDimensions`, `queryPrefix`, `documentPrefix`; annotation `model`,
  `revision`, `requestPolicy`, `maxResponseBytes` (`IndexProfiles.scala:10-13,21-32`). Endpoints and credentials do
  not enter the v2 identity. Check after start-up that `ch_owner_targets.profile` equals the profile the binary
  registered; otherwise the rehearsal proves nothing.
- Model endpoints for C-F step 1 — `annotation.endpoint` (chat completions) and `embedding.endpoint`:
  - *local stub on loopback* (schema-valid annotations, unit vectors): proves the queue → claim → publish mechanics on
    real rows, every guard, the SQL, the relocation hashes on the real descriptors, idempotency, the clean-up schema
    and the reads of the current binary. It does **not** prove that the real annotator succeeds on the 12 sources and
    makes semantic ranking of the re-indexed sources meaningless.
  - *the real providers*, if the owner allows clone content to be sent to them from this host: additionally proves
    the 12 re-annotations and gives the real cost.
- Isolation. The scratch cluster has two entrances, both private: its unix socket inside `D` (mode 0700, used by
  `run.sh` through `clone.sh env`) and `127.0.0.1:${CLONE_PORT:-54329}` with a generated password in `D/password`
  (scram-sha-256) for the service binary's JDBC driver. Service configuration: `listenHost` 127.0.0.1, a loopback
  `allowedOrigin`, `jdbcUrl` `jdbc:postgresql://127.0.0.1:<port>/chronicle`, `databasePasswordFile` `D/password`,
  `accounts` disabled, throwaway static tokens and operator password. No collector reaches it: collectors are
  clients and only know the production URL. The only outbound connections of the server are the two model
  endpoints (inferred from `Main.scala:32-40`: the single HTTP client is `ModelHttp.client`). Use `serve-standby`
  for every phase except the re-index.
- With `serve`, the workers are **unrestricted** (`ClaimScope.AllOwners`, `Models.scala:224`): they claim every
  claimable job of the clone, not only the retried ones. `LR.info.jobs.queued` says how many are waiting at dump
  time. On a full clone that is safe (every revision exists) and equals what production's workers would do; with
  real providers it costs their model calls. The rehearsal retries the worklist **per job** (2.3) and uses no
  owner-wide action.

What the rehearsal must answer (the three unmeasured items):

| Item | Where it appears |
|---|---|
| v1 descriptors in the retrieval registry of Haystack and Manure | `LR.retrieval.v1_profiles` of `run.sh haystack preflight` and `run.sh manure preflight` on the clone |
| number of unfinished v1 runs and of checkpoints to discard | `LR.unfinished_runs|<state>|n`, `LR.info.unfinished_runs.accepted_checkpoints_to_discard` |
| duration of the scans on `ch_search_chunks`, and the index question | wall time of `run.sh chronicle apply` on the clone, and step 4's `EXPLAIN ANALYZE`; apply the decision rule of 2.4 |

Pass criteria: preflight counters on the clone equal production's preflight of the same day; dry-run leaves the
database unchanged; apply exits 0 for both items; `verify-zero` for chronicle, haystack and manure; the codec check
passes; a second apply reports 0 for every step; the current binary starts; one semantic search per owner returns
hits without `unavailable`; a relocated source, a re-annotated source and a control source show chunks and passages;
a pinned old-format link answers "retired"; a new ingest is indexed; the Haystack service reads a pre-cut-over item
and its history; the proposed clean-up files apply and the retained checks print `legacy-free`;
`drop-databases.sh` is practised on scratch copies created in the clone; `D` is gone at the end.

## 9. Tests of the scripts

```sh
nix develop .#chronicle --command bash scripts/one-off/legacy-retirement/test.sh
```

One owned PostgreSQL 18.6 cluster under a private `/tmp` directory; `chronicle.LegacyRetirementScriptsTest` (2 cases)
and `haystack.storage.LegacyRetirementScriptsTest` (3 cases); each case creates its own database and drives the
scripts as subprocesses. Last run: 2 of 2 and 3 of 3 passed.

| Claim | Evidence in the fixture |
|---|---|
| Fixtures come from existing code | `Fixtures`; the v1 identities of `ModelIdentityMigrationTest`; `ModelIdentityMigration.apply` itself (relocation, namespaces, two approvals); `StoredPublicationFixtures`; a product rebuild that leaves a tombstone; the cut-over rows of `MigrationsTest`; a Node-validator oversize document |
| Preflight reports the seeded rows | 13 counters, `LR.old_format` by format and state, both worklists, unfinished runs, sizes |
| Dry-run changes nothing | hash of every row of every `ch_*` table / every Haystack table |
| Apply refuses | published old format; **non-retired history by default (R1)**; wrong retirement count; missing acknowledgement; missing backup reference; wrong database name; stale plan; another connection; live lease; Node-format row after the cut-over |
| **R1** pinned reads | published, unpublished non-retired and already-retired old-format generations: before and after (table in 2.3); tombstones byte-identical; generation and job counts unchanged; a tombstone with a NULL format and an unregistered profile still answers `indexed-view-retired` |
| C-F skippable | identity apply with `--skip-formats`: `verify --skip-formats` zero, plain verify non-zero, both old formats still served, retired-policy profile re-homed |
| Product action | "Rebuild archive index" through `PostgresOwnerReindex`, claim and publication through `PostgresArchive`; **scripted**: annotator and embedder |
| **R2** unfinished runs | a Failed v1 run with a namespace row, and a second database with a Failed, **unrelocated** v1 job holding an accepted checkpoint and an attempt: after apply the product's `Worker.once`, with a scripted annotator and embedder, resumes and publishes. Reproduced first: with the revision-1 scripts the same case fails at `IndexCheckpoints.scala:32` |
| **R3** codec check | `p:%FF`, `p:%00` block (2 texts `needs_relaxed_links`); oversize blocks (`needs_wide_envelope`); omitted links pass; truncated export fails. `check-stored-documents.sh` itself was run by hand against a scratch database (exit 0, then exit 3 with an invalid target; no export left behind) |
| **R5** clean-up schema | retained check fails before and passes after the proposed clean-up; `run.sh verify` cannot run afterwards; the constraint refuses a non-retired old-format generation; Chronicle's current binary starts again on the cleaned schema; Haystack's does not |
| Idempotence | second apply of each item: all rows identical |
| Current code reads the migrated data | start-up; `IndexProfiles.semantic` for three owners; semantic search; chunks and passages; rebuild status; retry of the Failed run; new ingest → claim → publish. Haystack: start-up, current/revision/history of the Node-era item, stale Node retry → `conflict`, current-format replay still replays |

Not covered by fixtures: production volumes and timings; real descriptors; the real annotator; `drop-databases.sh`
and `clone.sh` have no automated case (run by hand on a scratch cluster: refusals for a wrong OID, a connected
database, the connected database itself; a successful drop; the clone cycle).

The suites sit in the services' test trees (they need the fixtures) but register their cases only when
`LEGACY_RETIREMENT_SCRIPTS=1` is set, which `test.sh` does: the permanent full suites and the Nix checks (whose
filtered sources, `nix/pkg/chronicle/source.nix`, do not contain `scripts/one-off`) compile them and run nothing
from them. `test.sh` fails unless each suite ran its expected number of passing cases. The full permanent suites
were not run for this change (new files only).

## 10. Remaining open questions

| # | Question | Recommendation |
|---|---|---|
| Q1 | Which backup mechanism at go time (2.6)? | Volume snapshot if the platform offers one; otherwise `pg_dump` without `ch_index_checkpoints` data to a destination with the measured space. |
| Q2 | Rehearsal with a local model stub or the real providers? | Real providers for the 12 sources, if clone content may be sent to them from this host; otherwise the stub and an explicit note that the re-annotation is unproven. |
| Q3 | The two old `PassageFormat` values: the data does not need them once C-F is done. Keep as dead values (proposed, no version bump) or remove with an API version? | Keep as dead values now. |
| Q4 | Haystack migration 0007 makes the previous binary refuse to start. Ship it with the code deletion, or one deployment later? | One deployment later, so the first legacy-free deployment can still be rolled back. |
| Q5 | Is `pg_dump` available in the database pod, and may its 1–2 h snapshot be held on the live database? | Check with a version call before the export; otherwise dump from a host that can reach the socket. |
| Q6 | The path and ownership of the private clone directory on `/mnt/dev-data`. | A directory created by the rehearsing user; `clone.sh` enforces mode 0700 and ownership. |

## 11. What keeps "delete all legacy code" from being fully achievable now

1. **C-F depends on the model** for the 12 published sources. Until they are re-annotated the script refuses the
   formats item, and inventory 6.2 stays; C-I, H-1, H-2, R and E-1 are unaffected (`--skip-formats`). Smallest
   product change that would make it cheaper: a per-source "queue an index job on the current target" action; today
   a source without a job on the target can only be queued by a rebuild of all heads of its owner.
2. **Two `PassageFormat` enum values stay** in the wire model as dead values (decided preference; Q3).
3. **Retired-policy registry rows and tombstone labels stay in the database** by design: they are identity, not
   code paths.
4. **Restores** of any pre-migration copy need the tagged legacy binary plus these scripts.
5. **Guards not yet measured in production**: the retrieval registry of Haystack and Manure (guard R), the codec
   check of stored documents (6.4), the number of unfinished v1 runs, the head-job states of the 12 sources, the scan
   duration. Each has a read-only measurement in runbook steps 2–4 and in the rehearsal.
