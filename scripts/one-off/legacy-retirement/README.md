# One-off: retirement of legacy data (Chronicle, Haystack)

Temporary tooling. It migrates the last legacy rows of a Chronicle or Haystack database so that the legacy code can
be deleted afterwards. Plan, justification, runbook and deletion inventory:
`docs/drafts/20261118-1100-legacy-data-retirement.md`.

**Delete this directory and the two `LegacyRetirementScriptsTest` suites together with the legacy code**, after the
production migration is verified. Tag the last commit that still contains them: a restore of an older database copy
needs that binary and these scripts.

## What is here

| File | Purpose |
|---|---|
| `run.sh` | Driver: POSIX sh + `awk` + `grep` locally, `psql` at the database. Composes one psql session and writes it to psql's standard input. |
| `sql/chronicle/counts-cte.sql`, `sql/haystack/counts-cte.sql` | The legacy counters (what "legacy exists" means), shared by every mode. |
| `sql/*/preflight.sql`, `verify.sql` | Read-only sessions. |
| `sql/chronicle/10-guards.sql`, `20-`, `21-`, `22-batch-*.sql`, `30-identity.sql` | The Chronicle migration: refusals, three batched deletions, one final transaction. |
| `sql/haystack/10-guards.sql`, `20-batch-replay.sql`, `30-finish.sql` | The Haystack migration. |
| `test.sh` | Runs the fixture tests on an owned throwaway PostgreSQL. |

No host, credential or deployment name is in these files. The operator supplies the connection: standard `PG*`
environment variables, or a complete psql command line in `PSQL` (for example an exec into a database pod).
Inside a pod nothing but `psql` is required.

## Use

```sh
RUN='sh scripts/one-off/legacy-retirement/run.sh'
$RUN chronicle preflight                 # read-only: counters, re-index worklist, plan token (LR.plan)
$RUN chronicle dry-run                   # whole migration in one transaction, rolled back
$RUN chronicle apply --apply-irreversible --confirm-database NAME --expect-plan TOKEN
$RUN chronicle verify                    # read-only: exits 3 unless every legacy counter is zero
$RUN haystack  preflight | dry-run | apply … | verify
$RUN chronicle dry-run --emit > session.sql   # print the psql session instead of running it
```

Options are listed at the top of `run.sh`. Output is `LR.<key>|<value>` lines: counts and states only, never row
contents. Exit status: 0 success, 2 usage, 3 refusal / failed precondition / non-zero verify.

Behaviour that matters:

- `apply` needs three things: `--apply-irreversible`, the typed database name (compared with `current_database()` in
  the session) and the plan token of a preflight taken just before (the legacy counts must be exactly those).
- It refuses on: an unexpected schema version; a published generation in a retired output format (Chronicle: re-index
  those sources with the product first — the script never converts or unpublishes them); an owner target or generation
  on an unregistered profile; a live indexing lease; another client connected to the database (unless
  `--allow-active-connections`); a v1 identity that does not verify against its descriptor; a Node-format replay row
  newer than the Scala cut-over (Haystack).
- `lock_timeout` 5 s, `statement_timeout` 900 s by default; deletions run in batches (`--batch-size`, default 50
  rows per transaction, `--max-batches` 200 per kind). A longer backlog ends with `legacy-retirement incomplete`:
  run preflight and apply again.
- Idempotent: a second apply finds nothing to do. A failed or interrupted apply leaves a database the current binary
  reads; committed batches stay.

## Tests

```sh
nix develop .#chronicle --command bash scripts/one-off/legacy-retirement/test.sh            # both
nix develop .#chronicle --command bash scripts/one-off/legacy-retirement/test.sh chronicle  # or haystack
```

The suites (`chronicle.LegacyRetirementScriptsTest`, `haystack.storage.LegacyRetirementScriptsTest`) build databases
holding every legacy shape with the repository's existing fixtures and the product's own relocation and rebuild code,
then drive `run.sh`: preflight reports the seeded rows; dry-run changes nothing; apply refuses on each failed
precondition; apply migrates; verify returns zero; a second apply is a no-op; the current product code then starts on
and reads the migrated database. In the Chronicle suite the annotator and embedder are scripted; claim, publication,
rebuild and retirement are the product's code.

They live in the services' test trees because they need the test fixtures, but they register their case only when
`LEGACY_RETIREMENT_SCRIPTS=1` is set, which `test.sh` does. The permanent full-suite runs (and the Nix checks, whose
filtered sources do not contain `scripts/one-off`) compile them and run nothing from them. `test.sh` fails when a
suite did not run exactly one passing case. They are not meant to stay: they go with the legacy code.
