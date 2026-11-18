# One-off: retirement of legacy data (Chronicle, Haystack, shared retrieval)

Temporary tooling. It migrates the last legacy rows so that the legacy code can be deleted afterwards. Plan,
justification, runbook, rehearsal and deletion inventory: `docs/drafts/20261118-1100-legacy-data-retirement.md`.

**Delete this directory, the two `LegacyRetirementScriptsTest` suites and `LegacyStoredDocumentCheck` together with
the legacy code**, after the production migration is verified. Tag the last commit that still contains them: a
restore of an older database copy needs that binary and these scripts. Two files are meant to **stay**:
`chronicle/scripts/check-legacy-free.sql` and `haystack/scripts/check-legacy-free.sql` (post-deployment checks).

## What is here

| File | Needs | Purpose |
|---|---|---|
| `run.sh` | POSIX sh, `awk`, `grep` locally; `psql` at the database | Composes one psql session per invocation and writes it to psql's standard input. Targets `chronicle`, `haystack`, `manure`. |
| `sql/*/counts-cte.sql` | — | The legacy counters (what "legacy exists" means), shared by every mode. |
| `sql/chronicle/10-guards.sql`, `20-batch-retire-history.sql`, `21-batch-unfinished-runs.sql`, `30-identity.sql` | — | The Chronicle migration: refusals, two batched steps, one final transaction. |
| `sql/haystack/10-guards.sql`, `20-batch-replay.sql`, `30-finish.sql`, `export-stored-documents.sql` | — | The Haystack migration and the document export. |
| `check-stored-documents.sh` | the above **and a JVM** (`nix develop .#chronicle`) | Decides with the real Haystack codec whether stored documents still need the wide stored-read tolerance. |
| `drop-databases.sh` | as `run.sh` | Separately confirmed drop of rollback copies, one named database at a time. |
| `rehearsal/clone.sh` | bash, PostgreSQL 18 + pgvector locally; `pg_dump` at the source | Export, restore and deletion of the rehearsal clone (real content; private 0700 directory). |
| `sql/*/proposed-cleanup*.sql` | — | The schema clean-up the legacy-free binaries are proposed to apply; used to validate the runbook. Not applied by `run.sh`. |
| `op.sh` (mode 755) | bash, `kubectl`, `python3`; `LR_*` settings incl. `LR_SYSTEM_IDENTIFIER` | **The operator wrapper for production** (plan 7): every remote command through one fail-closed gateway (own success marker as the last line, exit 0 alone is not success); before/after probes (pod identity, restart counts, system identifier, `FENCED since` banner); `identify`, `ready`, run.sh modes per target database, `drop` (strict ConfigMap parsing), `backup-haystack` (complete decode), `codec-check`, `check-legacy-free`. |
| `sql/chronicle/worklist.sql`, `fence*.sql`, `unfence.sql` | — | `run.sh chronicle worklist` (job ids to retry); the database-side fence of the Chronicle role (plan 7.2). |
| `test.sh` | `nix develop .#chronicle` | Inner loop for the fixture tests (section Tests): the two Scala suites, `test-drop-databases.sh`, `test-scripts.sh` (runs the real `op.sh` against a fake `kubectl`), each on an owned throwaway PostgreSQL cluster. |

No host, credential or deployment name is in these files. The operator supplies the connection: standard `PG*`
environment variables, or a complete psql command line in `PSQL` (for example an exec into a database pod).

## Use

```sh
RUN='sh scripts/one-off/legacy-retirement/run.sh'
$RUN chronicle preflight                 # read-only: counters, worklists, sizes, plan token (LR.plan)
$RUN chronicle dry-run [flags]           # whole migration in one transaction, rolled back
$RUN chronicle apply --apply-irreversible --confirm-database NAME --expect-plan TOKEN --backup-reference REF [flags]
$RUN chronicle verify [--skip-formats]   # read-only: exits 3 unless every legacy counter of the selected items is zero
$RUN haystack  preflight | dry-run | apply … | verify
$RUN manure    preflight | verify        # retrieval registry only
sh scripts/one-off/legacy-retirement/check-stored-documents.sh     # Haystack stored documents, real codec
$RUN chronicle dry-run --emit > session.sql   # print the psql session instead of running it
```

Chronicle flags for the publication-formats item:

- none: refuses while any old-format generation is published (re-index those sources with the product first) or
  exists as non-retired history; the refusal lists the counts by format and state.
- `--retire-history --confirm-retire-history N`: retires the non-retired historical generations exactly as a product
  rebuild does (derived rows deleted, the generation row kept as a tombstone, so a pinned read answers
  `indexed-view-retired`). N is the count preflight prints as `LR.generations.old_format.history`.
- `--skip-formats`: leaves the formats item alone; the identity item is complete without it.

Output is `LR.<key>|<value>` lines: counts and states only, never row contents (the one exception is
`haystack export-stored-documents`, which `check-stored-documents.sh` keeps in a private temporary file).
Exit status: 0 success, 2 usage, 3 refusal / failed precondition / non-zero verify.

Behaviour that matters:

- **Nothing is deleted that carries identity**: no generation, job, rebuild receipt, revision or document. Removed
  are derived rows of explicitly retired history, accepted checkpoints of unfinished v1 runs, the v1 proof, mapping
  and namespace rows, unreferenced v1 registry rows, and Haystack's Node-era replay rows.
- `apply` needs: `--apply-irreversible`, the typed database name (compared with `current_database()`), the plan
  token of a preflight taken just before (the legacy counts must be exactly those) and `--backup-reference`.
- It refuses on: an unexpected schema version; an owner target or generation on an unregistered or retired-policy
  profile; a live indexing lease; another client connected to the database (unless `--allow-active-connections`); a
  v1 identity that does not verify against its descriptor; a Node-format replay row newer than the Scala cut-over.
- `lock_timeout` 5 s, `statement_timeout` 900 s by default; batches of `--batch-size` (default 50) rows per
  transaction, `--max-batches` 200 per kind. A longer backlog ends with `legacy-retirement incomplete`: run
  preflight and apply again.
- Idempotent: a second apply finds nothing to do. A failed or interrupted apply leaves a database the current
  binary reads; committed batches stay.
- After the clean-up schema is deployed these scripts no longer apply (they are bound to the pre-clean-up schema);
  the retained `check-legacy-free.sql` files are the check from then on.

## Tests

Where they run:

- `chronicle.LegacyRetirementScriptsTest` (2 cases) runs in Chronicle's full suite (`chronicle/scripts/test-postgres.sh`,
  Nix check `chronicle-backend-full`); `haystack.storage.LegacyRetirementScriptsTest` (3 cases) in Haystack's
  (`haystack/scripts/test-postgres-scala.sh`, Nix check `haystack-jvm`). Both checks' filtered sources include this
  directory and the retained `check-legacy-free.sql` they drive, so `scripts/verify chronicle | haystack | all` runs
  them. They build databases holding every legacy shape with the repository's existing fixtures and the product's
  own relocation and rebuild code, then drive the scripts. In the Chronicle suite the annotator and embedder are
  scripted; claim, publication, rebuild, retirement and the worker are the product's code.
- The shell fixture suites `test-drop-databases.sh` and `test-scripts.sh` (operator wrapper against a stand-in
  `kubectl`, drop guard, shared predicates, test isolation) need PostgreSQL and are one on-demand check, not part
  of verify: `nix build .#onDemand.legacy-retirement-scripts` (`nix/tests/legacy-retirement-scripts.nix`). Run it
  when this directory or a retained `check-legacy-free.sql` changes.

Inner loop (same suites outside the sandbox, one owned throwaway cluster each):

```sh
nix develop .#chronicle --command bash scripts/one-off/legacy-retirement/test.sh            # all four
nix develop .#chronicle --command bash scripts/one-off/legacy-retirement/test.sh chronicle  # or haystack | drop | scripts
```

`test.sh` fails when a Scala suite did not run its expected number of passing cases (sbt reports success for an
empty `testOnly`). Every shell suite sources `test-guard.sh` first, which refuses any inherited input the scripts
read (derived from the scripts by grep; every file and extraction stage is checked, a failure refuses).
