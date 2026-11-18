# Retiring legacy data: migration plan, one-off scripts, deletion inventory

Status: **preparation only**. Nothing here was run against a deployed database. The scripts were run only against
fixture databases on an owned throwaway PostgreSQL 18.6 (section 9).

Owner decision (2026-11-18): prepare one-off scripts, migrate the legacy data, then delete all legacy code.
Confirmed requirements (Q96): **A** a rehearsal on a clone of production data, on this host, run by the orchestrator
with these scripts unchanged; **B** the production run goes through the deployment repository's path after the owner's
explicit go; **C** Haystack Node-era replay rows are deleted; **D** the rollback database copies are dropped after
verification; **E** the evaluation v2 layer is deleted.

Evidence base: the read-only production check of 2026-11-18 (`.local/overhaul-20261117/reports/prod-legacy/` in the
main checkout: `REPORT.md`, `sql/`, `out/`). It is outside this repository; counts below marked *(report)* come from it.
Code references are to this worktree at `ab3e8a87`; each was re-read for this document.

Wording used below: **observed** = read in code or in the report's outputs; **inferred** = follows from observed
facts but was not itself checked; **proposed** = a decision of this plan.

Deliverables:

| What | Where |
|---|---|
| Scripts (POSIX sh + psql only) | `scripts/one-off/legacy-retirement/run.sh`, `sql/chronicle/`, `sql/haystack/`, `README.md` |
| Fixture tests of the scripts | `chronicle/server/src/test/scala/chronicle/LegacyRetirementScriptsTest.scala`, `haystack/server/src/test/scala/haystack/storage/LegacyRetirementScriptsTest.scala` |
| One command for the tests | `nix develop .#chronicle --command bash scripts/one-off/legacy-retirement/test.sh` |

## 1. Summary per item

| Item | Production *(report)* | Method | Model time | Script | Fixture-tested |
|---|---|---|---|---|---|
| C-1 Chronicle publication formats | 99 `ContiguousProblems` generations (12 published), 44 `LegacyAnnotations` (1 not retired, 0 published) | Product re-index of the 12 published sources, then SQL deletes the unpublished retired-format generations, the jobs and registry rows of the retired policies | **yes**, for 12 sources | `run.sh chronicle` (refuses while any is published) | yes |
| C-2 Chronicle model identity v1 | 6 profiles on the v1 space, 53 sources published on it (41 current format, 12 `ContiguousProblems`), 2 retained-read approvals, 1 relocation row, 3,014 namespace rows, 3,473 jobs | Transport-only relocation by SQL of the retained current-policy profile (the transformation the product CLI applies to an executable profile); then the proof, namespace and registry rows are removed | **no** | `run.sh chronicle` | yes |
| C-3 Chronicle pre-persistent sessions | 0 rows | Nothing to do; the script repeats migration 020's conversion if a deadline row appears | no | `run.sh chronicle` | yes |
| C-4 Chronicle opaque owner targets | 0 / 0 / 0; the `ch_profile` singleton itself names a v1 profile | Nothing to do for targets; the singleton is repointed | no | `run.sh chronicle` | yes |
| H-1 Haystack Node-era replay ledger | 185 rows `haystack-op-v1` | Delete (decision C) | no | `run.sh haystack` | yes |
| H-2 Haystack wide stored-read tolerance | 0 oversize, depth ≤ 6, 0 non-canonical links | Nothing to do; verify predicates guard the code deletion | no | `run.sh haystack verify` | yes (detection) |
| E-1 Evaluation v2 layer | files, not rows; none found | Delete the code (decision E) | no | none | not applicable |

Two things make "delete ALL legacy code" not fully achievable by these scripts alone; see section 11:
the 12 `ContiguousProblems` sources need a successful re-annotation, and three legacy surfaces are not database rows
(the public `PassageFormat` enum values, the evaluation V3 binder that still expects v1 descriptors, restores of old
copies).

## 2. Chronicle

### 2.1 Definitions (observed)

A Chronicle database holds legacy when any of the counters printed by `run.sh chronicle preflight` is non-zero.
The predicates are in `scripts/one-off/legacy-retirement/sql/chronicle/counts-cte.sql`; they restate the report's
`sql/10-chronicle-predicates.sql` and `11-chronicle-followup.sql` as one list.

| Counter (`LR.…`) | Predicate | Code that still depends on it |
|---|---|---|
| `spaces.v1` | `ch_embedding_spaces.descriptor->>0 IS DISTINCT FROM 'embedding-space-v2'` | v1 branch of `EmbeddingSpace.verified`, `shared/retrieval-core/src/main/scala/ponygirls/retrieval/Retrieval.scala:26-40`, reached from `IndexProfiles.registered` (`IndexProfiles.scala:74-77`) |
| `profiles.v1_space`, `generations.v1_space`, `jobs.v1_space`, `search_chunks.legacy_profile.exists`, `owner_targets.…`, `reindex_requests.legacy_target` | references to a profile registered on such a space | retained-read join in `IndexProfiles.readSpaceSql` (`IndexProfiles.scala:78-83`) |
| `retained_profile_reads` | rows of `ch_retained_profile_reads` (migration `019_retained_profile_reads.sql`) | same join; written only by `ModelIdentityMigration.approveRead` (`ModelIdentityMigration.scala:64-71`) |
| `model_identity_migrations`, `checkpoint_namespaces` | rows of the two tables of `018_model_identity.sql` | `PostgresArchive.checkpointNamespace` (`Database.scala:272-280`), `CheckpointNamespace` (`IndexCheckpoints.scala:12-15`), worker use at `Models.scala:158,176,188` |
| `reindex_requests.relocated_receipt` | `result->>'targetProfile' IS DISTINCT FROM target_profile` | none at run time; a v1 id kept inside a stored receipt |
| `generations.legacy_format_or_policy` | `passage_format IS DISTINCT FROM 'ContextAwareProblems'` or the profile's policy is not `ContextAwareProblemsV1` | `PassageStorage.format` and the `LegacyAnnotations` branch (`PassageStorage.scala:31-39`); `ReadableIndexPolicy` (`IndexProfiles.scala:8,75,79`); `ArchiveIndex.scala:153,225` (`published_format`) |
| `profiles.legacy_policy`, `jobs.legacy_policy` | `ch_index_profiles.policy <> 'ContextAwareProblemsV1'` and jobs on them | `ReadableIndexPolicy`; the worker refuses them (`Models.scala:205`) |
| `singleton.legacy_or_unregistered` | `ch_profile.active/target` is a legacy or unregistered profile | read only by the pre-007 seed, `Database.scala:27-28` |
| `sessions.deadline` | `ch_sessions.expires IS NOT NULL` | `020_persistent_sessions.sql:3-11`; no current code writes a deadline (`Auth.scala:67,141` insert without `expires`) |

Observed facts that decide the method:

1. **The v1 space is the same model as the v2 space.** v1 is `["embedding-space-v1", <sha256 of the endpoint>, model
   tuple…]`, v2 is `["embedding-space-v2", model tuple…]` (`Retrieval.scala:17,26-40`). The product lets a retained
   profile be searched only when `legacy.descriptor-0-0 = canonical.descriptor-0` (`IndexProfiles.scala:81`), and the
   CLI approves a retained read only when the verified v1 space equals the configured embedding
   (`ModelIdentityMigration.scala:67-68`). Stored vectors need no recomputation.
2. **The product CLI relocates only a profile equal to the configured one** (`ModelIdentityMigration.scala:85-91`).
   A profile with the same embedding model but an older annotation descriptor can only be *approved for reading*; its
   rows keep the v1 identity. That is the production state: 1 relocated profile, 2 approvals *(report)*.
3. **A profile on the configured space needs no approval to be read.** `readSpaceSql` falls through to
   `compatible.embedding_space` when no approval row exists (`IndexProfiles.scala:82`). A generation published under
   an older annotation policy on the v2 space is ordinary, current data: the same state arises whenever the
   annotation configuration changes.
4. **The identity of a non-configured profile is opaque at run time.** Only the configured profile is recomputed and
   compared (`IndexProfiles.register`, `IndexProfiles.scala:64-69`); other rows are looked up by id.
5. **Formats.** `ContiguousProblems` uses the passage, span and piece tables of the current format and has no
   `ch_context_spans` rows (migration `011_context_coverage.sql` added them; the writer before commit `cc073634`
   persisted passages, spans and pieces only). `LegacyAnnotations` has chunks only (`StoredPublicationFixtures.scala`,
   `PassageStorage.scala:39`). The only current writer stores `ContextAwareProblems` (`Database.scala:304-306,315`).
   The dashboard already refuses to render the two old formats (`chronicle/web/src/passages.ts:8`), and the contract
   says an explicitly legacy publication stays legacy until a replacement is published (`CONTRACT.md:257-262`).
6. **Rebuild is per owner and covers every head** (`ReindexCohort.apply`, `ReindexCohort.scala:44-71`); publication of
   a rebuild member retires the source's other generations by deleting their content and setting `retired`
   (`ReindexCohort.scala:83-94`). "Retry failed" re-queues the Failed head jobs on the owner's target
   (`RetryFailedJobs.scala:13-14,84-86`); a single job is retried by `Jobs.retry` (`Database.scala:82-89`). An ordinary
   publication does not retire earlier generations.
7. **Purge is the product's precedent for deleting generations and jobs** (`Auth.scala:340-341`). Generation rows have
   `ON DELETE CASCADE` children for chunks, search rows, passages, spans, pieces, context spans and tags
   (`001.sql`, `002.sql`, `006…`, `008…`, `011…`); job rows cascade to checkpoints, attempts and namespaces
   (`010…`, `015…`, `018…`).
8. **An unfinished run under a v1 namespace cannot simply lose its namespace row.** Checkpoint and attempt hashes of
   that run were computed from the v1 ids; with the canonical namespace the worker would hit `checkpoint identity
   mismatch` (`IndexCheckpoints.scala:32`) or `annotation attempt input identity mismatch` (`AnnotationAttempts.scala:33`),
   both `internal`, which stop the worker (`Models.scala:212`). A Complete job never resumes its run: a retry of a
   Complete job and a rebuild both rotate `run_id` (`Database.scala:88`, `ReindexCohort.scala:64`).

### 2.2 Method — C-1 publication formats (proposed)

**Decision: re-annotate the published sources with the product; do not convert by SQL.**

- `LegacyAnnotations` cannot be converted: it has no passages or spans to convert (fact 5).
- `ContiguousProblems` is *structurally* convertible (same tables; the difference is the absence of context spans),
  but the conversion would relabel output of the contiguous policy as output of the context-aware policy, which
  classifies context separately. Nothing in the code validates a stored generation against the current publication
  invariants (`ProblemsPublication.validate`, `ProblemsPublication.scala:10-80`, runs only on a new publication with
  its claim), so a SQL conversion would also be unverified. The product's stated position is that such a publication
  stays legacy until replaced (fact 5). Rejected.

Operator actions (the product's own machinery), for each owner that `preflight` lists under `LR.reindex_worklist`:

| Worklist state | Action | Cost |
|---|---|---|
| `Failed` head job on the target | dashboard "Retry failed" for that owner (or the per-job retry) | the Failed head jobs of that owner |
| `Queued` / `Running` | wait | — |
| `no-target-job` or `stale-revision` with no job | dashboard "Rebuild archive index" for that owner | **every head of that owner** (2,829 sources exist in total *(report)*) |
| `owner-disabled` | no product path: a disabled owner is never claimed (`Database.scala:213`). Owner decision (section 11) | — |

Cost model for the expected case (12 sources, each through one job): per source `W` annotation windows; one accepted
chat-completion call per window plus at most 5 rejected outputs and 10 reservations per window and retry epoch
(`AnnotationAttempts.scala:10-12`); `ceil(pieces / embeddingBatchSize)` embedding calls per window
(`Models.scala:156-162`). Providers are the two endpoints of the deployed configuration:
`annotation.endpoint` (OpenAI-compatible chat completions, strict JSON schema) and `embedding.endpoint`
(`config.example.json`). The deployed values were not read.

Why these 12 are still on the old format is **unknown**: the report did not classify their head jobs. The likely cause
(inferred) is a Failed replacement job. `preflight` prints the classification (owner state, format, head or stale
revision, head-job state, error code) as counts.

What SQL removes afterwards (`run.sh chronicle`, part A):

- Every retired-format generation that no source publishes: the tombstones of earlier rebuilds (87 + 43 *(report)*)
  and superseded, still-readable history (the 1 `LegacyAnnotations` generation, and the 12 old generations when their
  replacement was published by a retry rather than a rebuild). Deleted as rows; children cascade (fact 7).
- Every job on a retired-policy profile, with its checkpoints and attempts (cascade).
- Rebuild requests whose target is a retired-policy profile, unless one is an owner's latest request (then refuse).
- The retained-read approvals and registry rows of the retired policies, once nothing references them.

Consequences (observed from the code paths, proposed as acceptable):

- A stored link to a deleted generation now answers `not-found` instead of `indexed-view-retired`
  (`Database.scala:150-151`). The fixture test asserts this.
- The derived index of a superseded revision in an old format is gone; the raw revision stays (`ch_revisions` is not
  touched; test asserts `raw(…, revision 1)` still reads).
- Each deleted generation advances the security epoch (`009_transient_security_epoch.sql:47-49`), which invalidates
  in-flight MCP test-run authorizations (`PostgresRunAuthorization.verify` in `RunAuthorization.scala`). Irrelevant with the service stopped.
- The job list and the "obsolete failed" counter of the dashboard lose the historical jobs of retired policies.

### 2.3 Method — C-2 model identity v1 (proposed)

**Decision: relocate by SQL, without the model; do not re-index the 41 current-format sources.**

Considered and rejected: re-index all 53 v1-published sources and then delete everything on v1 profiles. It costs
model time for 41 sources whose stored output is already in the current format, it depends on those jobs succeeding
(they are probably the ones that failed), and afterwards SQL would still have to delete 884 generations and 3,473
jobs. The earlier design note also says not to force a re-index of compatible vectors
(`docs/drafts/20261105-2142-model-identity-migration.md:19-20`). The owner can still choose it (section 11, Q2): run
the product re-index first; the script then finds less to relocate and is otherwise unchanged.

What the script does (`sql/chronicle/30-identity.sql`, one transaction), for every profile still registered on a v1
space and still referenced:

1. Verify the v1 space descriptor hashes to its id and has exactly one v2 counterpart with the identical model tuple
   (the equality of fact 1), whose descriptor also hashes to its id.
2. Verify the profile is a `ContextAwareProblemsV1` profile whose id equals
   `sha256(["context-aware-problems-profile-v1", v1 space, descriptor])` and whose descriptor has the v1 shape — the
   checks of `ModelIdentityMigration.scala:56-63,85-89`.
3. Register the canonical profile: descriptor `["index-profile-descriptor-v2", annotation tuple without its transport
   hash, passage kernel]`, id `sha256(["context-aware-problems-profile-v2", v2 space, descriptor])` — the construction
   of `ModelIdentityMigration.scala:62` and `IndexProfileCatalog.contextAware` (`IndexProfiles.scala:31-32`).
4. Rewrite the same seven references the CLI rewrites (`ModelIdentityMigration.scala:48-52,97`).

The only difference from the product CLI is that the canonical profile need not equal the configured one. That check
exists because the CLI also makes the profile *executable*; here the relocated profile stays non-executable
(`IndexProfileCatalog` holds only the configured profile, `IndexProfiles.scala:25-30`), and is readable by fact 3.
The fixture test asserts that the id computed in SQL equals the id the product derives for the same model and
annotation policy (`IndexProfileCatalog.current(olderConfig).preferred.profile`).

Then, in the same transaction:

- stored rebuild receipts whose `targetProfile` differs from the control column are brought to the canonical id;
- all `ch_checkpoint_namespaces`, `ch_retained_profile_reads` and `ch_model_identity_migrations` rows are deleted;
- registry rows on the v1 space and the v1 space row are deleted, after a check that nothing references them;
- the `ch_profile` singleton is repointed to the single owner target when it names a legacy profile;
- all counters are recomputed; a non-zero counter aborts the transaction.

Before that transaction, in batches (part A): for every **unfinished** run that has a v1 namespace row, the accepted
checkpoints of that run are deleted, `annotation_retry_epoch` and `fence` are incremented, and the namespace row is
removed (fact 8). The job keeps its state, `run_id` and its place in any rebuild. Cost: the accepted model outputs of
those partial runs are lost; a later retry recomputes them. How many such runs exist is **unknown** (the report counted
namespace rows, not job states); `preflight` prints `LR.checkpoint_namespaces.unfinished_run`.

Safety of each removal (observed):

| Removed | Foreign keys | Audit / retention expectation in code |
|---|---|---|
| `ch_retained_profile_reads` rows | references `ch_index_profiles`, `ch_embedding_spaces`; nothing references it | The design note says to retain proof rows (`…model-identity-migration.md:106-108`). They prove a v1→v2 equivalence that no longer applies once no profile is on v1. Superseded by the owner decision. |
| `ch_model_identity_migrations` rows | references profiles and spaces; read only by `checkpointNamespace` | none beyond the namespace check |
| `ch_checkpoint_namespaces` rows | `job_id` → `ch_jobs` cascade | fact 8; handled per run |
| v1 registry rows and space row | `ch_index_profiles.embedding_space` → spaces; no table has a foreign key to `ch_index_profiles.profile` except the two proof tables | the CLI keeps them as "retained registry records"; unreferenced after relocation |
| Failed historical jobs on v1 profiles | — | **not deleted**: jobs of the relocated profile are relabelled, like the CLI does. Only jobs of retired policies are deleted (2.2). |

No retention horizon exists in code for any of these tables (searched `DELETE FROM` in `chronicle/server/src/main`:
purge, session and token maintenance, retirement only).

### 2.4 C-3 sessions and C-4 opaque targets

Nothing to do in production: 0 deadline sessions, 0 opaque targets *(report)*. `verify` guards both
(`sessions.deadline`, `owner_targets.legacy_or_unregistered`, `generations.unregistered_profile`,
`singleton.legacy_or_unregistered`). The script converts a deadline row the way migration 020 does, and refuses when an
owner target or a generation references an unregistered profile: that shape has no mechanical migration.

### 2.5 Preconditions and order

| Question | Answer |
|---|---|
| Binary during the migration | The **current** integration binary (`ab3e8a87` line), i.e. the one that still understands every legacy shape. It must have started once against the database (migrations 018–020 present; the configured v2 space registered). The legacy-free binary is deployed only after `verify` is zero. |
| Quiescence | Product re-index (2.2) needs the service running with workers. The SQL needs the workers stopped and no live lease; the script refuses on a live lease and, by default, on any other client connection. Proposed: stop the service for the SQL. |
| Can it run while the service is up? | Not recommended for Chronicle. Part B holds `SHARE ROW EXCLUSIVE` on `ch_jobs` and `ch_owner_targets` (as the CLI does, `ModelIdentityMigration.scala:77`): ingests and claims block for its duration. `--allow-active-connections` exists for the rehearsal and for `serve-standby`. |
| Collectors | Need not be stopped separately; with the service down their ingests fail and are retried from their spool (inferred from the collector's spool design; not re-verified here). |
| Idempotency | Every statement selects by the legacy predicate; a second run finds nothing. Asserted in the fixture test (database content identical after a second apply). |
| Transaction boundaries | `apply`: each batch of part A is one transaction; part B is one transaction. `dry-run`: everything in one transaction, rolled back. Any refusal or error ends the psql session; the open transaction is rolled back by the server. Committed batches stay and leave a database the current binary reads. |
| Partial failure | Run `preflight` again (new plan token) and `apply` again. |
| Locks | Part A: row locks on the selected generations/jobs and on their cascaded children. Part B: advisory lock `model-identity-migration-v2`, `SHARE ROW EXCLUSIVE` on two small tables, row locks on the relabelled rows. `lock_timeout` 5 s, `statement_timeout` 900 s (options). |
| Duration (inferred, **not measured**) | Dominated by two sequential scans. (1) `ch_search_chunks.generation` has a cascading foreign key and **no index** (`002.sql`): every deleted generation row scans `ch_search_chunks` (913,328 rows, 8.0 GB with TOAST *(report)*). About 143 generation rows are expected. (2) Part B updates `ch_search_chunks.profile` for the relocated profile: one scan, about 14,000 rows rewritten (41 of 2,610 published sources, proportionally). Everything else touches at most a few thousand small rows. Expect minutes, not hours; the rehearsal on a subset cannot confirm this (section 8). Use `--batch-size 10` in production so one transaction holds at most 10 scans. |
| Database size | The live `chronicle` database is 168 GB *(report)*, not 50 GB (50 GB is the older rollback copy). The migration adds no significant size; deleted rows free space only after vacuum. |

### 2.6 Verification

1. `run.sh chronicle verify` exits 0 and prints `LR.result|verify-zero`: every counter of 2.1 is 0. It also prints
   published generations per format and space version (`LR.published_by_format|ContextAwareProblems|embedding-space-v2|N`
   must be the only line; expected N = 2,610 *(report)* unless ingestion moved it).
2. The report's own predicates (`sql/10-…`, `11-…`) re-run read-only must show: one space (`embedding-space-v2`),
   no `…-v1` profile rows, `C2b.*` = 0, `C3.relocation | 0 | 0 | 0 | 0`, `C4.retained | 0`, `C5.formats` only
   `ContextAwareProblems`, `C6.policy` only `ContextAwareProblemsV1`, `C7.opaque | 0 | 0 | 0`.
3. Product checks with the current binary restarted: semantic search by an account that sees the relocated sources
   returns hits and no `unavailable` (the guard `IndexProfiles.semantic`, `IndexProfiles.scala:84-92`, fails the whole
   request if any visible publication is unreadable — so one successful semantic search per owner is a strong check);
   the passages panel of one relocated source and of one re-annotated source renders; "Retry failed" preview still
   opens; one new ingest is indexed and published.

### 2.7 Irreversibility and rollback

Cannot be undone without a backup: deleted generations of retired formats (derived index of superseded revisions),
deleted jobs and their checkpoints, deleted accepted checkpoints of unfinished v1 runs, the proof and mapping rows,
the v1 ids themselves (the relocation is many-to-one in principle; do not try to reverse it by SQL).

Raw archive content (`ch_revisions`, `ch_messages`, `ch_archive_fragments`) and every published generation are not
touched.

Backup: there is **no backup job** in the production namespace and SRE backups are not configured *(report)*. The
runbook therefore requires, before `apply`, with the service stopped: a restorable copy of the `chronicle` database
taken by the deployment repository's sanctioned means — a storage-level snapshot of the PostgreSQL volume, or a
`pg_dump -Fc` (about 168 GB of source data; `--exclude-table-data=ch_index_checkpoints` removes 49 GB of accepted
model outputs that a restore can live without, at the cost of recomputation on retries). The existing rollback copies
are **not** such a backup: they are from 2026-11-05/06. Which mechanism is available is an owner/operator question
(Q4).

Abort midway: end the psql session. Before part B commits, the database is in a state the current binary reads
(fewer legacy rows, same published data). After part B commits, rollback means restoring the backup.

## 3. Haystack

### 3.1 H-1 Node-era replay ledger

Definition (observed): `write_requests.digest_format = 'haystack-op-v1'`. It is the column default
(`haystack/migrations/0001-initial.sql:57`); the Scala service always writes `haystack-op-scala-v1`
(`OperationEnvelope.scala:15`, insert at `PostgresItemRepository.scala:112`). Production: 185 rows, all created
before the cut-over marker *(report)*.

What the ledger guarantees (observed, `PostgresItemRepository.scala:95-115`): a write is keyed by
`(principal_user, token_id, request_id)`. A repeated request with the same digest and format returns the recorded
outcome (`replayed = true`); the same key with another digest or format returns `replay-conflict`. A Node-era row can
never match (format differs), so its only effect is `replay-conflict` for a retry of a Node-era request id; its
`outcome` JSON is never decoded.

Retention horizon in code: **none**. No statement deletes from `write_requests` (searched
`haystack/server/src/main`); migration 0004 records the policy "retain historical replay rows"
(`0004-scala-current.sql:1-12`).

Consequence of deleting the rows (observed in the fixture test): a client that retries a Node-era request id (same
principal and token, at least 14 days later) is no longer answered `replay-conflict`. The operation is evaluated as
new: `conflict` when its expected revision is stale — which it is whenever the original write was committed, because
that write advanced the revision (`ItemRepository.scala:33-36`) — or a new write when it names the current revision.
No acknowledged document, revision or link changes. Decision C accepts this.

Method: `run.sh haystack apply` deletes the rows in batches. It refuses when the schema is not exactly 0001–0006,
when the cut-over marker is absent, when a `haystack-op-v1` row is newer than the marker (something would still be
writing the default), or when an unknown format exists.

Preconditions: either binary works before and after (the Scala service never reads the Node rows' content). The
delete is safe while the service is up (inferred: 185 point deletes, no table lock); pass
`--allow-active-connections` for that. Duration: sub-second. Backup: `pg_dump` of `haystack` (33 MB *(report)*).
Irreversible without it: the 185 ledger rows.

### 3.2 H-2 wide stored-read tolerance

Definition (observed): a stored document outside what a current write accepts — over 1 MiB, container depth over 66,
or a non-canonical link target — read through `DocumentCodec.decodeStored` with `StoredLimits` and
`validateLinkKeys = false` (`DocumentCodec.scala:24,40-42,52,77`). Production: none *(report)*.

Migration: nothing to do. Such a document is authoritative content and cannot be shrunk by a script; if one existed,
the tolerance would have to stay. `run.sh haystack verify` prints `stored.items_over_1mib`,
`stored.revisions_over_1mib`, `stored.revisions_deeper_than_66`, `stored.links_not_array`,
`stored.link_targets_noncanonical` (the report's H2/H2b/H3 predicates) and fails when any is non-zero. The fixture
test seeds a Node-validator fixture (`unicode-bmp-over-new-byte-envelope`) and asserts that verify fails and that no
mode changes the document.

The control-character identities (report item H4) are current behaviour, not legacy; not part of this plan.

### 3.3 Not measured: shared retrieval model identity

`PostgresRetrieval.migrateModelIdentities` (`shared/retrieval-postgres/…/PostgresRetrieval.scala:48-72`) is the
shared-library twin of the Chronicle relocation, with no caller in any service (searched the repository). Whether the
`haystack` or `manure` databases hold a v1 descriptor in `pony_retrieval_profiles` was **not checked** by the report
(its `H7` counts the schema-version table). `run.sh haystack preflight` and `verify` print
`LR.retrieval.v1_profiles`; verify fails when it is non-zero. Expected 0 (inferred: `pony_retrieval_generations` and
`pony_retrieval_profiles` have no statistics in the report, consistent with an installation that never embedded).
If it is non-zero, that method must stay until a caller is written. Manure has the same table; run the one-line
predicate there by hand (runbook step 3).

## 4. Evaluation v2 (E-1)

Not database rows. Decision E deletes the layer; the inventory is in section 6. No script.

Observed while checking it: the **current** V3 workflow binds a run to the server's model catalog in the *v1*
descriptor shape (`chronicle/eval/relevance/workflow_v3.py:436-452`, `run_real.py:92-100`), while the current server
registers v2 descriptors at start-up (`IndexProfiles.scala:25-32`). Inferred, not run: a V3 run against a current
isolated server fails at `bound-embedding-space-mismatch`. This is a separate defect to fix or confirm (Q6); it is the
last place in the repository that produces v1 identities.

## 5. What is not covered

| Deployment / copy | State *(report)* | What it needs |
|---|---|---|
| Rollback copies in the production cluster (2 Chronicle, 1 Haystack, 1 Manure) | The Chronicle copies hold legacy data and lack migration 020 | Dropped after verification (decision D): runbook step 13. Until then they must not be restored under a legacy-free binary. |
| MAN prototype cluster | scaled to 0; volumes recorded as empty test state, not queried | Before any restart under a legacy-free binary: `preflight` on its databases, or delete its volumes. |
| Personal VM deployments | declared with the services disabled; actual state not observed | Same. |
| Old compute host leftovers (rehearsal clusters, a migration clone under the deployment repository's debug directory) | not running, contents not inspected | Delete, or treat as needing the compatibility binary. |
| Backups / off-cluster archives | none configured; a 2026-11-06 Chronicle source archive was not located | Any restore of a pre-migration copy needs: the last binary that contains the legacy code (tag it — runbook step 12), then these scripts. Keep `scripts/one-off/legacy-retirement` reachable from that tag. |
| Developer and test instances elsewhere | unknown | `run.sh … preflight` is read-only and safe to run anywhere. |

## 6. Deletion inventory

Each row becomes deletable when the named `verify` counters are zero **in production** and the copies of section 5
are gone or accepted. Line numbers are at `ab3e8a87`; symbols are given so that the deletion units can re-locate them.
Paths are relative to the repository root; `…/chronicle/` abbreviates `chronicle/server/src/main/scala/chronicle/`,
`…/test/` abbreviates `chronicle/server/src/test/scala/chronicle/`.

### 6.1 Chronicle — model identity v1 (guard: `spaces.v1`, `profiles.v1_space`, `retained_profile_reads`, `model_identity_migrations`, `checkpoint_namespaces` = 0)

| Path | Lines / symbol | Why legacy |
|---|---|---|
| `…/chronicle/ModelIdentityMigration.scala` | whole file (`RetainedReadApproval`, `ModelIdentityPlan`, `ModelIdentityMigration`) | one-off relocation CLI; done |
| `…/chronicle/Main.scala` | 20–25 (`migrate-model-identities` case), usage text at 45 | CLI entry |
| `…/chronicle/IndexProfiles.scala` | 78–83 `readSpaceSql`: the `ch_retained_profile_reads` join and `sameModel`; reduces to `compatible.embedding_space` | retained-read approvals |
| `…/chronicle/Database.scala` | 272–280 `checkpointNamespace`; `019`/`018` entries in the migration list at 22 stay until 6.6 | v1 checkpoint namespaces |
| `…/chronicle/IndexCheckpoints.scala` | 12–15 `CheckpointNamespace`, 17 trait method; keys are then built with `IndexCheckpoints.key` directly | same |
| `…/chronicle/Models.scala` | 120 (`Windows` parameter), 158, 176, 188 | same |
| `shared/retrieval-core/src/main/scala/ponygirls/retrieval/Retrieval.scala` | 26–40: the `legacy` branch of `EmbeddingSpace.verified` | parses v1 descriptors |
| `shared/retrieval-core/README.md` | 6 | documents v1 verification |
| `shared/retrieval-postgres/…/PostgresRetrieval.scala` | 48–72 `migrateModelIdentities` | no caller; **extra guard** `LR.retrieval.v1_profiles` = 0 in haystack and manure |
| `docs/drafts/20261105-2142-model-identity-migration.md` | whole | procedure for the retired CLI; keep as history or mark superseded |
| `…/test/ModelIdentityMigrationTest.scala` | whole file | tests of the above |
| `…/test/ArchiveContract.scala` | 93–95 (`DummyArchive.checkpointNamespace`) | follows the trait |
| `…/test/PassageWorkerTest.scala` 21, 249; `…/test/ContextWorkerRecoveryTest.scala` 31 | delegating overrides | follows the trait |
| `shared/retrieval-core/src/test/…/RetrievalCoreTest.scala` | 13–21 (v1 cases) | tests the v1 branch |
| `shared/retrieval-postgres/src/test/…/RetrievalContractTest.scala` | 171–189 | tests `migrateModelIdentities` |
| `…/test/LegacyRetirementScriptsTest.scala`, `scripts/one-off/legacy-retirement/` | whole | this one-off (keep reachable from the tag of step 12) |

### 6.2 Chronicle — publication formats and retired policies (guard: `generations.legacy_format_or_policy`, `profiles.legacy_policy`, `jobs.legacy_policy` = 0)

| Path | Lines / symbol | Why legacy |
|---|---|---|
| `…/chronicle/IndexProfiles.scala` | 8 `ReadableIndexPolicy` (`LegacyV4`, `ContiguousPassagesV1`); literal lists at 75 and 79 | retired policies |
| `…/chronicle/PassageStorage.scala` | 39: the `LegacyAnnotations` branch | chunk-only generations |
| `…/chronicle/Models.scala` | 205: "index policy is retired" check becomes unreachable with one policy | — |
| `chronicle/models/chronicle.baboon` | 334: `LegacyAnnotations`, `ContiguousProblems` of `PassageFormat` | **public API enum** — see section 11 |
| `chronicle/generated/**/PassageFormat.*`, `chronicle/cli/src/schema-data.ts` 2610–2611 | generated | follow the model |
| `chronicle/web/src/passages.ts` | 8 (refusal message for old formats) | unreachable afterwards |
| `chronicle/CONTRACT.md` | 253–262 | describes legacy formats |
| `…/test/StoredPublicationFixtures.scala` | whole file | writes `LegacyV4` / `LegacyAnnotations`. It is also the generic "publish something" helper of other suites: `TagSearchTest`, `ReadSourceFixture`, `McpSourceBoundaryTest`, `DashboardOperationsTest`, `PassagePostgresBoundaryTest`, `PostgresBehaviorTest`, `RetryFailedActionsTest`, `StaticTokenTest`, `TokenVisibilityTest` and others (about 35 test files mention a retired format, a retired policy or this helper). Those callers must move to `TestPublications` first. |
| `…/test/DashboardOperationsTest.scala` | 46–56 | LegacyAnnotations passages case |
| `…/test/PassagePostgresBoundaryTest.scala` | 23–43, 77–97 | same |
| `…/test/ReindexCohortTest.scala` | 65–66, 163 | relabels a generation to a retired format |
| `…/test/ArchivePublishedFormatTest.scala` | the retired-format cases | `publishedFormat` for old formats |
| `…/test/Fixtures.scala` | 3–8 (`legacyOnly`, `passages` aliases) | historical constructor names |
| `chronicle/web/tests-browser/{rebuild,history-fixture,goal50-fixture,archive,fixture}.mjs`, `web/ui-capture/seed.mjs`, `web/tests/goal50.test.ts` | the cases that seed or expect old formats | UI legacy cases |

### 6.3 Chronicle — sessions and opaque targets (guard: `sessions.deadline`, `singleton.…`, `owner_targets.…`, `generations.unregistered_profile` = 0)

| Path | Lines / symbol | Why legacy |
|---|---|---|
| `chronicle/migrations/020_persistent_sessions.sql` | 3–11 (conversion block); keep 1 and the trigger | pre-020 rows |
| `…/test/PersistentBrowserSessionTest.scala` | 61–85 (case "migration promotes only live legacy sessions…") | tests that block |
| `…/chronicle/Database.scala` | 25 (`ch_profile` insert), 27–28 (seed from the singleton); keep 50 | pre-007 archives |
| `…/test/IndexProfilesTest.scala` | 40–63 | tests that seed |
| `…/test/RetryFailedJobsTest.scala` 37, 55, 101; `…/test/ActivityTest.scala` 446, 457; `UPDATE ch_profile` lines of about 25 suites | fixture upkeep of the singleton | table is dropped (6.6) |
| `…/chronicle/Database.scala` 49 and `AccountStore.liveSession` in `Auth.scala` (`expires` handling) | **keep** unless the column is dropped (6.6) | — |

### 6.4 Haystack (guard: `replay.node_format` = 0; `stored.*` = 0)

| Path | Lines / symbol | Why legacy |
|---|---|---|
| `haystack/server/src/main/scala/haystack/storage/PostgresItemRepository.scala` | 103: the `format != op.digest.format` half of the comparison (one format remains) | Node replay rows |
| `haystack/server/src/test/scala/haystack/storage/MigrationsTest.scala` | 139–171 (cut-over case): the old-replay rows and assertions at 151–152, 158–159, 168–169 | same |
| `…/storage/HistoricalIdentityTest.scala` | the H1 cases (39, 44, 49–50 per the report; re-check) | same |
| `haystack/server/src/main/scala/haystack/domain/DocumentCodec.scala` | 24 `StoredLimits`; 40–42 (parse with `Limits`, keep the `unavailable` mapping and keep it distinct from `parse`); 52, 77–80 `validateLinkKeys` | wide stored read |
| `…/domain/HistoricalAdmissionTest.scala` | 38–47, 66–77, 81–83 (report; re-check) and `HistoricalFixture.text`'s use of `StoredLimits` at 12 | same |
| `…/storage/HistoricalStoredReadTest.scala` | 13–64, 81–end; keep 66–79 as a current regression (report; re-check) | same |
| `haystack/server/src/test/resources/haystack/historical/unicode-{bmp,astral}-over-new-byte-envelope.json.gz` and their manifest entries | fixtures | same |
| `…/domain/DocumentCodecTest.scala` | 134 | uses `StoredLimits` |
| `haystack/server/src/test/scala/haystack/storage/LegacyRetirementScriptsTest.scala` | whole | this one-off |

The Haystack test line ranges marked "report" were taken from the report and only spot-checked; the deletion unit
must re-read them.

### 6.5 Evaluation v2 (guard: decision E)

`chronicle/eval/relevance/`: `reparse.mjs` + `tests/reparse.test.mjs`; `assess_batch.py` + `tests/test_assess_batch.py`;
`proposition_support.py` + `tests/test_proposition_support.py`; `source_observations_v3.py:283-350`
(`legacy_read_view`, `legacy_page`) + `tests/test_source_observations_v3.py:189-240`;
`tests/test_runner_integration_v3.py:136,193`; `tests/test_workflow_v3.py:266-272`; the v2 sections of `README.md`
(238–262), `BATCH_ASSESSMENT.md`, `PROPOSITION_SUPPORT.md`. `RESULTS.md` keeps its numbers as history. (List from the
report; not re-verified line by line here.)

### 6.6 Schema clean-up migrations that become possible

| Migration | Worth doing? |
|---|---|
| Chronicle: `DROP TABLE ch_retained_profile_reads, ch_checkpoint_namespaces, ch_model_identity_migrations` and remove `018`/`019` from the start-up list (`Database.scala:22`) | **Yes** — otherwise empty tables and their DDL stay forever. Needs a schema marker so old binaries fail clearly. |
| Chronicle: `DROP TABLE ch_profile` | **Yes**, together with 6.3; about 25 test fixtures update it. |
| Chronicle: tighten `ch_generations_passage_format_check` to `('ContextAwareProblems')` and `ch_index_profiles_policy_check` to `('ContextAwareProblemsV1')` (set at `011_context_coverage.sql:1-4`) | **Yes** — turns the verified state into an invariant. Note `011` re-creates the wide constraint at every start-up; it has to be edited too. |
| Chronicle: `ALTER TABLE ch_generations ALTER COLUMN passage_format SET NOT NULL` | Yes (0 NULL rows *(report)*); removes the "unknown provenance" branch (`PassageStorage.scala:32`). |
| Chronicle: index on `ch_search_chunks(generation)` | Separate question, not legacy: purge has the same per-row scan (2.5). |
| Chronicle: drop `ch_sessions.expires` | **No** for now: `liveSession` in `Auth.scala` and the security-epoch trigger of 020 define deadline semantics; not a legacy-only column. |
| Chronicle: `ch_generations.run_id` NULL rows (143 *(report)*) | No consumer found; those rows are the retired-format generations and disappear with them. |
| Haystack: `0007`: `ALTER TABLE write_requests ALTER COLUMN digest_format DROP DEFAULT`, `ADD CHECK (digest_format = 'haystack-op-scala-v1')`, and a new `haystack_contract_cutovers` row recording the retirement | **Yes** — the default silently stamps the Node format on any insert that omits the column (the fixture test relies on exactly that); the stored policy text "retain historical replay rows" becomes false. |
| Shared retrieval: nothing | — |

## 7. Runbook

Conventions. `RUN` = `sh scripts/one-off/legacy-retirement/run.sh`. Every `run.sh` invocation is **one psql session**
composed locally and written to psql's standard input. **Nothing but `psql` is needed inside the database pod**;
`run.sh` itself (POSIX sh, `awk`, `grep`) runs where the repository is. The operator supplies the psql command:

```sh
# local or rehearsal: standard PG* variables
PGHOST=… PGPORT=… PGUSER=… PGDATABASE=… RUN chronicle preflight
# production: the sanctioned exec path of the deployment repository, as one command line
PSQL='kubectl <context/namespace flags> exec -i <database pod> -c <container> -- psql -h <socket dir> -U <role> -d <database>' RUN chronicle preflight
# or review first, then pipe the reviewed file
RUN chronicle dry-run --emit > session.sql ;  kubectl … exec -i … -- psql -X -q -v ON_ERROR_STOP=1 -d <database> -f - < session.sql
```

Context, namespace, pod, socket directory and role are in the deployment repository and in the report's
`run_sql.sh`; they are deliberately not written here. Stop condition for every step unless stated: any exit status
other than 0, or any `ERROR:` line.

Production (operator: the orchestrating agent, after the owner's explicit go for each irreversible step).

| # | Step | Command | Expected | Stop when |
|---|---|---|---|---|
| 1 | Current overhaul binary deployed; credentials valid per the deployment repository's preflight | — | services healthy | — |
| 2 | Chronicle preflight (read-only) | `RUN chronicle preflight` | `LR.schema_migrations|2,3,6,8,9,14,17,20`; counters near section 1; `LR.reindex_worklist` lines (12 sources expected) | schema differs; counters far from the report |
| 3 | Haystack preflight; Manure retrieval predicate | `RUN haystack preflight`; in `manure`: `SELECT count(*) FROM pony_retrieval_profiles WHERE descriptor LIKE '["embedding-space-v1"%'` | `LR.replay.node_format|185` (or fewer), `LR.retrieval.v1_profiles|0`; Manure 0 | a `stored.*` counter or a retrieval counter is non-zero (then that code stays; tell the owner) |
| 4 | Measure the generation-delete scan (read-only) | `EXPLAIN (ANALYZE, BUFFERS) SELECT count(*) FROM ch_search_chunks WHERE generation = '00000000-0000-0000-0000-000000000000'` under `SET statement_timeout='120s'` | one sequential scan; note its time `t` | `t` × batch size approaches `--statement-timeout` (lower `--batch-size`) |
| 5 | Product re-index of the worklist (2.2), service running | dashboard "Retry failed" / "Rebuild archive index" per the worklist table | jobs Complete; `RUN chronicle preflight` shows `LR.generations.legacy_format_or_policy.published|0` | a job fails again: stop, report the error codes; do **not** proceed to step 9 |
| 6 | Owner go for the irreversible part | — | explicit | no go |
| 7 | Stop Chronicle (workers and API); wait for leases | deployment repository | `RUN chronicle preflight`: `LR.info.jobs.running_live_lease|0`, `LR.other_client_backends|0` | either is non-zero |
| 8 | Backup (2.7): Chronicle by snapshot or `pg_dump`; Haystack by `pg_dump` | deployment repository | restorable artefact, size and checksum recorded | no restorable backup |
| 9 | Dry-run, then apply, Chronicle | `RUN chronicle dry-run --batch-size 10` then `RUN chronicle preflight` (take `LR.plan`) then `RUN chronicle apply --apply-irreversible --confirm-database <name> --expect-plan <LR.plan> --batch-size 10` | dry-run: `LR.result|dry-run-rolled-back`, `LR.after.*` all 0. apply: `LR.result|applied` | any refusal (`legacy-retirement refused: …`) — read it, do not work around it. `legacy-retirement incomplete` — run preflight and apply again |
| 10 | Verify Chronicle; start the service (same binary); product checks (2.6) | `RUN chronicle verify` | `LR.result|verify-zero`; searches return hits | non-zero: restore decision with the owner |
| 11 | Haystack: dry-run, apply, verify (service may stay up) | `RUN haystack dry-run --allow-active-connections`; `RUN haystack preflight`; `RUN haystack apply --apply-irreversible --confirm-database <name> --expect-plan <LR.plan> --allow-active-connections`; `RUN haystack verify` | `LR.step.node_replay_rows_deleted` sums to the preflight count; `verify-zero` | refusal |
| 12 | Tag the last commit that contains the legacy code and these scripts | `git tag` (name chosen by the owner) | tag exists | — |
| 13 | **Separately confirmed:** drop the rollback copies (decision D) | preflight, read-only, in database `postgres`: `SELECT datname, pg_database_size(oid), (SELECT count(*) FROM pg_stat_activity a WHERE a.datname = d.datname) FROM pg_database d WHERE NOT datistemplate ORDER BY 1;` — compare names and sizes with the report's `out/00-inventory.txt`; then, per copy and only after the owner confirms that exact name: `DROP DATABASE "<name>";` (no `FORCE`) | each listed copy has 0 connections; after the drop it is absent from the listing | a name not in the inventory; a connection count above 0; the owner has not confirmed the name. Not part of `run.sh`. The inventory lists **four** copies (two Chronicle, one Haystack, one Manure); the decision speaks of three — ask which (Q5). |
| 14 | Delete the legacy code (units briefed from section 6), add the clean-up migrations (6.6), run the full suites | repository work | suites green | — |
| 15 | Deploy the legacy-free binaries; `RUN … verify` once more | deployment repository | `verify-zero`; start-up applies 6.6 | start-up failure: redeploy the tag of step 12 (possible only while 6.6 has not dropped a table the old binary creates again — it re-creates them with `IF NOT EXISTS`, so this is safe; inferred) |

## 8. Rehearsal (requirement A)

**Disk: this host has about 98 GB free; the live `chronicle` database is 168 GB and the larger rollback copy 50 GB.
A full clone does not fit and must not be attempted. The rehearsal uses a bounded subset: budget 10 GB, expected
about 5 GB.**

What the clone must contain:

- Scratch PostgreSQL **18** with the `vector` (pgvector) and `pg_trgm` extensions and the `pg_unicode_fast`
  collation (built in since 17) — the `nix develop .#chronicle` shell provides it (`$POSTGRES_HOME`). One superuser
  role is enough: restore with `--no-owner --no-privileges` and point the binary's `databaseUser` at that role.
  Listen on a unix socket or 127.0.0.1 only.
- Database `haystack`: complete (33 MB).
- Database `chronicle`: complete **schema**; complete **data of every table except the six large content tables**
  (together 0.6 GB); and for the six large tables only the rows of a *cohort* of sources.

| Table | Size *(report)* | In the clone |
|---|---|---|
| `ch_index_checkpoints` | 49.0 GB | rows of jobs counted by `checkpoint_namespaces.unfinished_run` only |
| `ch_revisions` | 36.0 GB | cohort sources, head and published revisions |
| `ch_archive_fragments` | 29.5 GB | cohort |
| `ch_messages` | 21.9 GB | cohort |
| `ch_chunks` | 15.4 GB | generations of cohort sources, plus every non-retired retired-format generation |
| `ch_search_chunks` | 8.0 GB | cohort |
| all other tables | 0.6 GB | complete, except the children that must follow their parent's filter: `ch_problem_pieces`, `ch_problem_passages`, `ch_problem_spans`, `ch_context_spans`, `ch_generation_tags` (by generation) and `ch_revision_info` (by revision) |

Cohort: the 53 sources published on a v1 profile (this includes the 12 `ContiguousProblems` ones), the sources of
unfinished v1-namespace runs, and about 50 control sources published on the configured profile. Estimate: about
100 sources × roughly 30 MB of content each ≈ 3 GB, plus 0.6 GB of small tables and indexes. `ch_sources`,
`ch_jobs`, `ch_generations` are copied completely, so **every counter of `preflight` equals production's**.

Is the subset sound? For the scripts: yes — they read and write only the metadata tables (complete) and delete or
relabel content rows by generation/profile. For the product: only the cohort sources are readable; a non-cohort source
has no revision rows in the clone. So product checks are made on cohort sources only. Not transferable to production:
the duration of the two scans on `ch_search_chunks` (2.5) — hence runbook step 4 measures that scan read-only on
production. Extraction is a read-only export (`COPY (SELECT …) TO STDOUT` per table inside one `REPEATABLE READ READ
ONLY` transaction, through the sanctioned path); it copies session content of the cohort to this host, which
requirement A covers. The export statements are not written yet: they are a task for the rehearsal unit, to be
reviewed before they touch production (Q7).

Beyond PostgreSQL:

- The **current** binary and a configuration that equals production's in everything that enters the model identity:
  embedding `model`, `revision`, `dimensions`, `sendDimensions`, `queryPrefix`, `documentPrefix`; annotation `model`,
  `revision`, `requestPolicy`, `maxResponseBytes` (`IndexProfiles.scala:10-13,21-32`). Endpoints and credentials do
  not enter the v2 identity, so they can differ. If any identity field differs, the binary registers a different
  configured profile and the rehearsal proves nothing — check that `ch_owner_targets.profile` equals the profile the
  binary registers.
- Model endpoints the product would call for the re-index: `annotation.endpoint` (chat completions) and
  `embedding.endpoint` (embeddings). Two acceptable set-ups:
  - *Scripted/local provider on loopback* (returns schema-valid annotations and unit vectors). Proves: the queue →
    claim → publish → retire mechanics on real rows, the guards, the SQL, the relocation hashes on the real
    descriptors, idempotency, start-up and reads of the current binary on the migrated data. Does **not** prove that
    the real annotator succeeds on the 12 sources, and makes semantic ranking of the re-indexed sources meaningless
    (vectors are not from the real model).
  - *The real providers*, if the owner allows cohort content to be sent to them from this host: additionally proves
    the 12 re-annotations succeed, and gives a real cost figure.
- Isolation: `listenHost` 127.0.0.1 and a loopback `allowedOrigin`; `jdbcUrl` on the scratch cluster; `accounts`
  disabled; throwaway static tokens and operator password; no collector is configured to reach it (collectors are
  clients and only know the production URL). The only outbound connections of the server are the two model endpoints
  (inferred from `Main.scala:32-40`: the single HTTP client is `ModelHttp.client`). Use `serve-standby` for every
  phase except the re-index, so no worker claims anything.

Sequence: restore the subset → `preflight` (compare with production's) → start the binary (`serve`) → re-index the
worklist → stop → `dry-run` → `apply` → `verify` → start (`serve-standby`) → product checks → second `apply` (no-op) →
delete the cluster.

Pass criteria: preflight counters equal production's; dry-run leaves a byte-identical logical dump of the metadata
tables; apply exits 0; `verify-zero` for both databases; second apply reports 0 for every step; the current binary
starts; one semantic search per owner returns hits without `unavailable`; a relocated source, a re-annotated source
and a control source each show chunks and passages; a new ingest is indexed and published; the Haystack service reads
a pre-cut-over item and its history.

## 9. Tests of the scripts

One command (about one minute after compilation), from the repository root:

```sh
nix develop .#chronicle --command bash scripts/one-off/legacy-retirement/test.sh
```

It starts one owned PostgreSQL 18.6 cluster under a private `/tmp` directory, runs
`chronicle.LegacyRetirementScriptsTest` and `haystack.storage.LegacyRetirementScriptsTest`, and removes the cluster.
Each suite creates its own database and drives `run.sh` as a subprocess with `PG*` variables.

What is proved, and what builds the fixtures:

| Claim | Chronicle | Haystack |
|---|---|---|
| Fixture built by existing code | `Fixtures`, the v1 identities of `ModelIdentityMigrationTest`, `ModelIdentityMigration.apply` itself (relocation, namespaces, two retained approvals), `StoredPublicationFixtures` (LegacyV4 / LegacyAnnotations), a `ContiguousProblems` label on a v1-space profile, a pre-020 session row | the cut-over rows of `MigrationsTest` (two Node-era revisions, two `haystack-op-v1` rows, one through the column default), a Node-validator oversize document from `historical/` |
| Preflight reports the seeded legacy rows | yes (12 counters, both worklists) | yes |
| Dry-run changes nothing | yes (hash of every row of every `ch_*` table) | yes |
| Apply refuses on a failed precondition | published retired format; missing flag; wrong database name; stale plan; another connection; live lease | missing flag; wrong name; stale plan; another connection; Node-format row after the cut-over |
| Product action exercised | "Rebuild archive index" for one owner through `PostgresOwnerReindex`, claim and publication through `PostgresArchive`; **scripted**: the annotator and embedder (publication built by `TestPublications`) | none needed |
| Apply migrates, in batches of one | yes | yes |
| Verify returns zero | yes | yes; and non-zero for the oversize document |
| Second apply is a no-op | yes (all rows identical) | yes |
| Current code reads the migrated database | `Database.initialize`; `IndexProfiles.semantic` for both owners; semantic search; chunks and passages of the relocated source; the relocated id equals the product-derived id; rebuild status; retry of the Failed v1 run (canonical namespace, no stale checkpoint, annotation reservation accepted, publication); new ingest → claim → publish | `Migrations.initialize`; current, revision and history of the Node-era item; stale retry of a Node id → `conflict`; current-format replay still replays |

Not covered by the fixtures: production volumes and timings; real descriptors (the fixture's v1 descriptors are built
by the test, with the product's hash functions); the real annotator.

The two suites sit in the services' test trees (they need the test fixtures) but register their case only when
`LEGACY_RETIREMENT_SCRIPTS=1` is set, which `test.sh` does: the permanent full suites and the Nix checks (whose
filtered sources, `nix/pkg/chronicle/source.nix`, do not contain `scripts/one-off`) compile them and run nothing from
them. `test.sh` fails unless each suite ran exactly one passing case. They are to be deleted with the legacy code
(inventory 6.1, 6.4).

## 10. Open questions for the owner

| # | Question | Recommendation |
|---|---|---|
| Q1 | The 12 `ContiguousProblems` sources must be re-annotated; if a re-annotation keeps failing, or its owner is disabled, what then? | Decide per source after step 5: fix the annotator input, or explicitly unpublish (the source stays readable and literally searchable, loses passages and semantic hits). No script does the latter. Until then C-1 and the enum values stay. |
| Q2 | Relocate the 41 current-format sources by SQL (no model), or re-index them too? | Relocate. Their output is already in the current format; only the identity encoding is old. |
| Q3 | Accept that the accepted checkpoints of unfinished v1 runs are discarded? | Yes; see the count in preflight first. If it is large and those jobs are expected to be retried, let them finish or fail under the current binary before step 7. |
| Q4 | Which backup mechanism exists for step 8? | Volume snapshot if the platform offers one; otherwise `pg_dump -Fc --exclude-table-data=ch_index_checkpoints` to a volume with at least 120 GB. |
| Q5 | Decision D names three rollback copies; the inventory shows four (a Manure one too). | Drop all four after verification; confirm each name. |
| Q6 | The V3 evaluation binder expects v1 descriptors (section 4). | Fix it to v2 in the same unit that deletes the v2 evaluation layer; otherwise the v1 shape survives in the repository. |
| Q7 | The clone export touches production (read-only) and copies cohort content here. | Have the rehearsal unit write the export statements and review them like the report's SQL. |
| Q8 | Removing `LegacyAnnotations` / `ContiguousProblems` from the public `PassageFormat` enum is an API change. | Follow the model-evolution rules of the contract (new API version); or keep the two enum values as dead values and delete only the code paths. |

## 11. What keeps "delete all legacy code" from being fully achievable now

1. **C-1 depends on the model**: until the 12 sources are re-annotated (or the owner unpublishes them), the script
   refuses, and everything in 6.2 stays. Smallest product change that would make this cheaper: a per-source "queue an
   index job on the current target" action; today a source with no job on the target can only be queued by a rebuild
   of *all* heads of its owner.
2. **The public enum** (Q8) cannot be removed by a data migration.
3. **The evaluation V3 binder** still constructs v1 identities (Q6).
4. **Restores**: any pre-migration copy (rollback copies until step 13, the MAN prototype, off-cluster archives)
   needs the tagged legacy binary plus these scripts.
5. **Unmeasured**: `pony_retrieval_profiles` in Haystack and Manure (3.3), the head-job states of the 12 sources,
   the number of unfinished v1 runs, and the duration of the two scans. Preflight and runbook step 4 measure them
   read-only.
