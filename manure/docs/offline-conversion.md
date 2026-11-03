# Explicit offline SQLite → PostgreSQL conversion

This is migration tooling, **not a server-startup hook**. No deployment,
production migration, credential rotation, or deletion is authorized here.
Run it only against an explicitly quiesced, operator-owned source and a newly
provisioned, isolated disposable PostgreSQL database/filesystem destination.
Python's stdlib `sqlite3` is used only by the migration command and tests.

## Source/target contract

`manure/migration/schema.sql` is canonical. Package the backend resource as an
exact copy; reject drift with:

```sh
cmp manure/migration/schema.sql manure/backend/src/main/resources/manure-schema.sql
```

The original four tables and column names/order come from the **complete**
`manure/manure/storage.py` schema, not HTTP DTOs:

- `artifacts`: id, name, kind, visibility, created_by_user, created_by_token,
  created_at, created_at_s, expires_at, expires_at_s, state, total_bytes,
  file_count, reserved_bytes, ext_pwd_hash, last_activity_at, manifest_json.
- `receipts`: artifact_id, path, offset, length, sha256.
- `one_time_grants`: grant_hash, artifact_id, principal, expires_at, used,
  user_id, token_id, token_digest.
- `content_grants`: grant_hash, artifact_id, expires_at, created_at, user_id,
  token_id, token_digest, pwd_hash.

Every original TEXT column is `bytea`, holding its exact UTF-8 bytes, including
NUL, Unicode, whitespace, and hash spelling. No JSONB/text normalization,
casefolding, hash re-encoding, or owner rewriting occurs. `manifest_json` is
original bytes, not reserialized JSON. Original INTEGER columns become bigint;
`used` is not narrowed to boolean. Nullable fields stay nullable. Original REAL
columns are authoritative **8-byte big-endian IEEE754 binary64** bytea:

| Table | Original REAL columns | Double-precision query projections |
|---|---|---|
| artifacts | created_at_s, expires_at_s, last_activity_at | created_at_s_value, expires_at_s_value, last_activity_at_value |
| one_time_grants | expires_at | expires_at_value |
| content_grants | expires_at, created_at | expires_at_value, created_at_value |

Projections are decoded from the authoritative bits, never timestamp/RFC3339
strings. `float8send` readback verifies projection bits. SQLite's own existing
normalization (e.g. NaN stored as NULL, integer optimization of a REAL) cannot
be undone; the exported bit payload represents exactly what SQLite reads. The
original physical database/WAL bytes are separately retained too. There is no
float-through-JSON-number conversion. PostgreSQL bytea order is unsigned byte
lexical order, not Python Unicode casefold order or locale collation.

Primary keys are the original keys; child artifact IDs reference artifacts
with `ON DELETE CASCADE`. Unexpected schemas, dynamic SQLite storage classes
that the frozen PG schema cannot represent, orphan foreign-key rows, or nullable
SQLite PK anomalies are **not silently repaired/dropped**. Export preserves
raw source/type-tagged values; incompatible imports refuse transactionally.
Pre-binding grant schemas missing only nullable user/token/digest/password
binding columns are exported with NULL for those absent columns. Unknown
columns/tables/types fail closed rather than guessing a schema migration.

## Matched snapshot boundary

1. Stop admission and **all** source writers, sweeper, recovery, maintenance,
   backup mutators, and external filesystem writers. Wait for shutdown. Retain
   service credentials/config references separately under their existing
   protection. Record source code/config identities and the maintenance window.
2. Provide a protected effective JSON config file. Preserve canonical origin,
   alias origins/ports, content suffix/mode, all bounds, users/token labels and
   `hashFile` references. `api_origin` must have the effective port (not a
   port-0 template); `chunk_bytes` must be explicit and unchanged for in-flight
   sessions. Do not put plaintext credentials into this file. The tool copies
   the config bytes and references; it does not read/rotate credential files.
3. Invoke `snapshot --quiesced` below. This flag is the operator's explicit
   attestation, **not an online-consistency algorithm**. The command obtains
   the exact physical-root Linux abstract-socket claim used by the SQLite
   implementation, and refuses an active ArtifactStore. It rejects symlinks,
   hardlinks, special files, non-owned trees, alias parents, and unexpected root
   entries. Root entries must be manure.db, optional manure.db-wal/-shm, and
   staging/live. Move no source entries as part of an export.
4. The command inventories and copies the complete matched source: SQLite,
   committed WAL, SHM if present, every staging/live file, empty directory,
   sidecar, recovery remnant, and orphan tree. It verifies before/after hashes,
   sizes and nanosecond mtimes. Directory/file mtimes survive, including orphan
   sweep-age evidence. Destination permissions are private 0700/0600; POSIX
   owner IDs, mode bits, atime/ctime, xattrs and sparse allocation are not a
   portable application-state promise. Reading can update filesystem atimes.
   All source contents and application timestamps remain unchanged.
5. SQLite is opened **only in a separate disposable copy** of the archived
   DB/WAL/SHM. Even read-only WAL access can create/update SHM, so neither the
   original nor archived raw set is ever opened by SQLite. Integrity checking
   and complete table export see committed WAL rows. No reconcile/sweep runs
   on the source or archive. Inconsistent receipts/crash windows are retained,
   identified in the audit, not fixed during conversion.

The namespace must be exclusively controlled by the operator; pathname-based
recursive copying is **not** an adversarial concurrent-namespace containment
primitive. Root claim + repeated inventory is additional drift detection, not
a claim that arbitrary running filesystem copies are consistent. For sources
with a different OS owner, execute under that authorized owner; this tool does
not chown or weaken permission checks. Abstract-root claims require the same
Linux network namespace as the stopped service; they are not a cross-host/NFS
locking protocol.

## Commands (explicit operator invocation)

From the repository root, using absolute paths for real runs:

```sh
python3 manure/migration/offline.py snapshot \
  --source /owned/quiesced-old-state --bundle /owned/new-snapshot \
  --config /protected/effective-manure.json --quiesced
# stdout: source identity = SHA256(manifest.json); record it out-of-band

python3 manure/migration/offline.py verify-snapshot \
  --bundle /owned/new-snapshot --expected-source RECORDED_SHA256
```

The snapshot contains protected `OWNER.json`, `manifest.json`, `COMPLETE`, and
`raw/`. The manifest is versioned `manure-offline-1`, binds source canonical
path/device/inode, effective config hash/bytes/reference, PG schema digest,
SQLite schema/user_version, every row's source rowid and typed values, complete
file hashes/sizes/mtimes, all counts/state counts/reservations, receipt
ranges/hash verification locations, exact content URLs including aliases, and
credential-file references. `COMPLETE` is written last, atomically and durably,
only after the entire source set/export is present. Hashes are integrity/binding
checks, **not signatures**: retain the expected digest out-of-band.

An interrupted snapshot has no valid completion marker. Reinvocation rebuilds
only its previously owned incomplete raw copy, and only if physical source,
config, and full source inventory still match the original binding. A changed
source requires a new snapshot path. Never turn a partial archive into a
completed snapshot by hand. Failure before initial ownership/provisioning
completed requires operator inspection and a fresh owned destination; no tool
adopts arbitrary preexisting trees.

Provision a **new isolated database yourself**, owned by the migration role,
with no user relations. Configure a protected libpq service reference (e.g.
`rehearsal`) in `PGSERVICEFILE`/the standard libpq service file. Authentication
uses that reference and protected password/passfile settings, never secrets in
argv or generated SQL. Do not point it at `postgres`, templates, or a live
application database. SQL/server diagnostics may contain private row data;
the CLI suppresses them and prints only a safe refusal. The psql subprocess
has a finite 120s deadline; SQL import also uses finite lock/statement bounds.
Large datasets may require a separately reviewed timeout/resource adjustment.
The current manifest/export materializes metadata rows in memory (payload
copy/hashing streams); provision memory and disk headroom for a complete export
and separate raw/SQLite working copies.

```sh
python3 manure/migration/offline.py prepare-destination \
  --destination /owned/disposable-target --pg-service rehearsal --owned-disposable
python3 manure/migration/offline.py import \
  --destination /owned/disposable-target --pg-service rehearsal \
  --bundle /owned/new-snapshot --expected-source RECORDED_SHA256
python3 manure/migration/offline.py verify-destination \
  --destination /owned/disposable-target --pg-service rehearsal \
  --bundle /owned/new-snapshot --expected-source RECORDED_SHA256
```

`prepare-destination` refuses an existing filesystem root or nonempty DB. It
creates the canonical schema plus a destination-specific control row in
`manure_offline.destination(id,root,source,writes_started)`. Preparation does
not create databases, wipe tables, or adopt a running backend's schema. On a
preparation failure the filesystem marker is left for inspection; it is not
a completion receipt and no arbitrary DB cleanup runs.

Import binds the canonical target path/device/inode, random owner ID and libpq
service name to that DB marker. It copies staging/live into private incoming,
fsyncs every file/directory, and verifies exact contents/mtimes. Before renaming
incoming to `data/` or writing PG rows, it durably writes `COPY.json`:

```json
{"format":"manure-copy-1","source":"SNAPSHOT_SHA256","destination":"CONTROL_ID","device":123,"inode":456}
```

`device`/`inode` identify the **copied payload directory**, not the outer
receipt/control directory (`OWNER.json` continues to bind that outer root).
The rename retains this inode. COPY is an interrupted-import identity fence,
**not** startup authorization. A retry must match this exact data identity even
when PG committed but the final payload receipt does not yet exist. It cannot
adopt a replacement `data/` with identical bytes/mtimes or regenerate proof
for whichever tree happens to be there now. An interruption after COPY but
before rename can resume only the same completely copied incoming inode.
A partial incoming copy with no COPY binding can be rebuilt before adoption.

Only then does import start one PG transaction for **all four tables and the
source completion marker**. The tool never overwrites nonempty metadata. It
writes a protected executable `import.sql` receipt with source/destination/write-
boundary guards. Execute through the tool, not by bypassing filesystem checks.

After PG COMMIT, **complete exact PG readback and snapshot/filesystem verification
must succeed** before import durably creates the versioned `PAYLOAD.json`:

```json
{"format":"manure-payload-1","source":"SNAPSHOT_SHA256","destination":"CONTROL_ID","device":123,"inode":456,"entries":[{"path":"","kind":"dir"},{"path":"6c697665","kind":"dir"},{"path":"6c6976652f66696c65","kind":"file","size":7,"sha256":"EXACT_FILE_SHA256"}]}
```

The example is abbreviated, not a valid fixture inventory. Actual `entries`
contains **every directory including the root** (`path: ""`), every sidecar,
recovery remnant, empty directory, and every regular file. Paths are lowercase
hex of raw relative filesystem-name bytes, with `/` separators, not percent-
encoded/normalized Unicode. Entries use the existing root-first, raw-byte-
sorted-sibling recursive traversal. A file entry has exact integer `size` and
lowercase SHA256; a directory entry has only `path` and `kind`. Target receipt
entries deliberately **omit mtimes**. The independent source snapshot retains
nanosecond mtimes, and `verify-destination` still compares to that exact source
snapshot; target adoption and `mark-writable` compare only names/topology/bytes.

`PAYLOAD.json` is canonical ASCII JSON (sorted object keys, no insignificant
whitespace), private and atomically fsynced. COMPLETE is written **last**, only
after this record and the actual copied directory's identity/content agree:

```json
{"source":"SNAPSHOT_SHA256","destination":"CONTROL_ID","payloadManifestSha256":"SHA256_OF_EXACT_PAYLOAD_JSON_BYTES"}
```

The digest binds exact `PAYLOAD.json` bytes, not its parsed/re-serialized value.
Neither existing final receipt is overwritten/rehashed on retry. Malformed,
missing, inconsistent or substituted final proof refuses instead of blessing
current invalid bytes. As elsewhere, these hashes are integrity bindings, not
signatures against a malicious owner who can rewrite all protected state.

Before COMMIT: SQL faults/connection death roll back every row and marker;
durable files remain under their original COPY identity for verified retry.
After COMMIT but before PAYLOAD/COMPLETE: retry checks COPY identity, every actual
PG row (hashes, grant bindings, float bits/projections) and all original files
before completing the receipts. After PAYLOAD but before COMPLETE: retry checks
and reuses the existing immutable record. Same-size wrong bytes, extra/missing
entries, a new data inode, invalid receipt/hash, or PG readback mismatch refuse
without setting `writes_started`, repairing files, refreshing receipts, or
altering metadata. No fake completion, no unequal-row `ON CONFLICT` swallowing,
no destructive re-import. Physical-root claims exclude competing converters
and an active destination filesystem owner during verification and marking.

**No in-place receipt upgrade:** output made by the earlier converter without
COPY/PAYLOAD or with the old source-only COMPLETE is not sufficient proof of
what was copied. Do not manufacture receipts over that directory. Keep the
untouched snapshot and explicitly reenact conversion into a **new owned
isolated disposable destination** under the preparation policy above.

## Reconciliation, cutover and rollback

Before starting any destination process, compare the complete import while
still quiesced. Preserve the old state/archive read-only. Configure the new
backend's payload root as `/owned/disposable-target/data` and the provisioned
DB/role, keeping effective public URL/content/chunk settings and credential
references unchanged. Do **not** change plaintext tokens, hash algorithms,
external passwords, one-time grant consumption, password/token-bound content
grants, or TTLs. Reconciliation runs only after all metadata+files are present.
Reconciliation itself changes the destination; do it on a disposable rehearsal
copy after the comparison/write boundary, not on the archive.

```sh
# Explicit irreversible operational boundary, BEFORE target reconciliation or
# admission of any new write. This does not start a service or permit activation.
python3 manure/migration/offline.py mark-writable \
  --destination /owned/disposable-target --pg-service rehearsal \
  --expected-source RECORDED_SHA256
python3 manure/migration/offline.py rollback-policy \
  --destination /owned/disposable-target --pg-service rehearsal
```

`mark-writable` claims both the outer destination and `data/`, checks the PG
pre-write control fence, validates COPY's data identity, verifies COMPLETE's
exact payload-record digest and bindings, and hashes the actual entire payload
against PAYLOAD **before** toggling `writes_started`. Hashing is outside the
short PG control transactions. A failure leaves the flag false and all original
receipts, current payload bytes, PG rows, source snapshot and credentials intact;
it is not a repair or automatic activation operation.

The backend independently requires valid COMPLETE/PAYLOAD bindings and actual
data identity on **all imported-state startups** (including migration-only
startup). Before FIRST `root_owner` adoption it must additionally verify the
entire confined/raw-path inventory and exact file hashes against PAYLOAD,
outside a long PG transaction. This closes replacement/corruption between
marking and first serving. Once the same data inode has an established PG root
owner, legitimate recovery/new writes change its inventory; subsequent startup
checks still require the immutable receipt/digest/source/destination and data
identity, but do not compare new bytes to the old snapshot inventory. COPY is
not a backend authorization requirement; COMPLETE/PAYLOAD are.

Before this boundary, rollback is restarting the **untouched old state** under
its original config/credentials, not pointing SQLite at the PG destination.
After it, choose **fix-forward**. Restarting old SQLite could lose acknowledged
new files/receipts/grants/metadata. No reverse converter or zero-RPO rollback
is claimed. The tool's flag is an operational fence, not an SQL privilege
system: the operator must mark it **before** target writes; it cannot detect
writes made by unrelated tools that deliberately bypass this protocol. Once
marked, re-import, repeat marking, and exact snapshot-comparison retries refuse
at the PG fence **before target inventory hashing**, leaving new writes and the
old immutable receipt untouched. A package rollback is not a data rollback. Production
activation, final RPO/window approval and old-state deletion remain gated.

## Rehearsal coverage and limits

Run the complete new suite with pinned installed PostgreSQL binaries:

```sh
MANURE_TEST_PG_BIN=/absolute/pinned/postgresql/bin \
PYTHONPATH="$PWD/manure" python3 -m unittest discover \
  -s "$PWD/manure/tests" -p test_offline_conversion.py -v
```

The suite starts/stops its **own** PostgreSQL cluster (Unix socket, no TCP),
creates a fresh database per case, and requires the real adapter; missing PG
is an error, never a silent skip. It exercises real storage-created upload,
publication and grant states, real process death leaving uncheckpointed WAL,
NUL/Unicode owners/names/paths, nextafter timestamp precision, all-row PG
readback, payload/manifest/marker corruption, source/destination binding,
refusal of active source/unsafe topology/nonempty targets, interruption before
and after COMMIT, termination of a real PostgreSQL import connection inside
the transaction, and retry without duplicates. Pre-write and post-new-write
rollback policies are checked without mutating the original snapshot.

The PG-to-decoded-SQLite test oracle is **test-only**, not a reverse-migration
product: it reconstructs every PG field in a new disposable source adapter,
then executes actual recovery of pre-rename/post-rename/missing-tree/P6-remnant
windows, interrupted upload resume/publication, old passwords/grants,
single-use replay rejection, expiry/sweep and deletion. This demonstrates
state/representation preservation, not acceptance of the replacement Scala
HTTP/native service. After integration, the same imported PG/filesystem state
must also be exercised by that actual backend plus updated client/MCP,
JVM/native and browser suites. No browser/native/live activation acceptance
is claimed by this migration-only suite.


### Payload-adoption regression evidence (2026-11-03)

The focused suite now additionally covers version/field/complete-digest binding,
all raw paths/directories, target mtime independence, same-size corruption with
restored mtime, identical-byte replaced data inodes, extra/missing topology,
malformed/missing/old receipts, COPY-before-rename and PAYLOAD-before-COMPLETE
interruption, PG-commit/pre-receipt replacement and corruption, failed PG readback
before receipt creation, active-root exclusion and no rehash after new writes.
Pre-write adoption negatives verify `writes_started` remains false and prove
actual PG, receipt, corrupted filesystem and source/archive preservation, not
fake success. Post-write refusals retain the true flag and new bytes unchanged.
The actual target lifecycle counterpart is `manure/tests/test_target_migration.py`;
converter-only results do not establish its JVM/native acceptance. Backend
first-adoption enforcement and its real target regression are separate work.

Fresh converter-only validation after this receipt change: 30 cases (22 real
owned-PG cases + 8 snapshot/representation cases), 0 failures/errors/skips,
24.601s, using Python 3.14.8 and PostgreSQL 18.6 binaries at
`/nix/store/vq4kynp3jwqh97z58bqbz0hyamhqayyp-postgresql-18.6/bin` with the
command above. Ruff, `py_compile`, whitespace checks and exact canonical
schema/backend-resource `cmp` also passed. The newer canonical namespace
DO-guard was retained unchanged; only converter/tests/this document changed.
