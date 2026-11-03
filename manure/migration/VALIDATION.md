# Offline conversion validation receipt

Observed 2026-11-03T00:42:59Z, dedicated worktree
`/home/pavel/work/flakes/ponygirls/.worktrees/wt-ponygirls-manure-offline`.
Base `e9fda183db02898aa4b2110e47febb816b2e9ffe`;
schema commit `ea3bc5d8de9663d9b05206d47d3b4261f62beba6`;
implementation/tests/docs commit `21a135995f0f842b46733f6a5f81b6f70e575795`.

Exact tested inputs (SHA256):

```
6090fac06ab469b1f2d1acd7126a2b40c7b18307cf4b852c18ddc1dee223ada8  manure/migration/schema.sql
ef0e565dc3e281347f429b55ac272876bf81c838949acd8d8a7d16eb35cc6dd0  manure/migration/offline.py
935cfecf043d00d867a3d2352a0bdbfed4a1281c3859d384746995524722423d  manure/tests/test_offline_conversion.py
178e1caf35180d91ef020105d9a52464aad20dff900fa9ddd06affc7f044cd89  manure/docs/offline-conversion.md
```

Python 3.14.8; real pinned PostgreSQL 18.6 binaries at
`/nix/store/vq4kynp3jwqh97z58bqbz0hyamhqayyp-postgresql-18.6/bin`.
Tests start their own cluster with a private Unix socket, TCP disabled,
`fsync=on`; every test owns a fresh database. No live service/database used.

From the worktree root:

```sh
MANURE_TEST_PG_BIN=/nix/store/vq4kynp3jwqh97z58bqbz0hyamhqayyp-postgresql-18.6/bin \
PYTHONPATH="$PWD/manure" python3 -m unittest discover \
  -s "$PWD/manure/tests" -p test_offline_conversion.py -v
# 17 cases; 0 failures, 0 errors, 0 skips; 8.484s final run.

PYTHONPATH="$PWD/manure" python3 -m unittest discover \
  -s "$PWD/manure/tests" -p test_storage_durability.py -v
# 53 cases; 0 failures, 0 errors, 0 skips; 10.436s.
# Unchanged storage/tests at base; input-exact earlier run reused after
# migration-only edits (they do not import migration code).

/nix/store/h2ma8pnvaak721aady3pmvzybga9kzsf-ruff-0.17.2/bin/ruff check \
  manure/migration/offline.py manure/tests/test_offline_conversion.py
# All checks passed.
python3 -m py_compile manure/migration/offline.py manure/tests/test_offline_conversion.py
git diff --cached --check
# Passed before implementation commit.
```

Final migration suite inventory: 8 snapshot/representation cases; 9 owned-PG
cases. Real WAL-after-process-death, SQL connection termination during the
transaction, and process death after COMMIT execute, not skip. Metadata and
payload corruption, source/config/destination binding, active-source refusal,
restart idempotence, arbitrary NUL/Unicode and binary64 precision, grant and
reservation preservation, pre-write rollback and post-new-write fix-forward
are covered. The roundtrip oracle restores actual PG readback into a disposable
SQLite adapter and executes resume/publish crash windows/grants/TTL/delete.

**Not claimed:** replacement Scala/native HTTP/client/MCP/browser acceptance,
backend resource `cmp` before integration, live cutover, reverse migration, or
production restore/RPO approval. Those remain integration/activation gates;
see `manure/docs/offline-conversion.md`. No application credentials were read
or rotated and no automatic startup import was added.
