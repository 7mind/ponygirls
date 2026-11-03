# Manure Scala backend (port in progress; not activated)

Main class `manure.Main`; executable CLI `manure-server serve CONFIG.json` or
`manure-server --config CONFIG.json`. No Python production storage/server fallback.
Payload root MUST already exist, with no symlink components; explicit JNI mode
`linked` for native static deployment, `shared` plus absolute `posix_library` for
JVM verification. Physical-root claim acquired BEFORE DB migrations or mutations.

Configuration retains existing snake_case domain/network/limits/users fields.
New REQUIRED `database` object:

```json
{
  "jdbcUrl": "jdbc:postgresql://127.0.0.1:15433/manure",
  "user": "manure",
  "passwordFile": "/run/credentials/manure/database-password",
  "limits": {
    "maxConnections": 4, "maxQueued": 16, "queueTimeoutMs": 5000,
    "connectTimeoutMs": 5000, "statementTimeoutMs": 30000,
    "lockTimeoutMs": 5000, "idleTransactionTimeoutMs": 30000,
    "socketTimeoutMs": 30000
  }
}
```

These are synthetic finite examples, not measured host sizing. Credential values
are NEVER in configuration or Nix store; existing user token `hashFile` paths and
credential directories are retained. `native_mode` defaults `linked`;
`posix_library` optional only for `shared` (absolute library path required).
`dashboard_dir` and `unlock_shell_dir`: explicit package asset directories, or
null to disable. Installed package should set both absolute paths (dashboard and
unlock subdirectories of its immutable web tree). Repository development defaults
are `manure/web/dashboard`, `manure/web/unlock` relative to launch cwd.

Example minimal synthetic server configuration:

```json
{
  "data_dir": "/var/lib/manure", "api_origin": "https://manure.example.test",
  "content_mode": "subdomain", "content_suffix": "artifacts.example.test",
  "users": [{"id":"operator","type":"human","tokens":[
    {"id":"primary","hashFile":"/run/credentials/manure/operator-token-sha256"}
  ]}],
  "dashboard_dir": "/opt/manure/share/manure/web/dashboard",
  "unlock_shell_dir": "/opt/manure/share/manure/web/unlock",
  "database": {
    "jdbcUrl":"jdbc:postgresql://127.0.0.1:15433/manure", "user":"manure",
    "passwordFile":"/run/credentials/manure/database-password",
    "limits":{"maxConnections":4,"maxQueued":16,"queueTimeoutMs":5000,
      "connectTimeoutMs":5000,"statementTimeoutMs":30000,"lockTimeoutMs":5000,
      "idleTransactionTimeoutMs":30000,"socketTimeoutMs":30000}
  }
}
```

Current generated API: `POST /api/current` and raw chunk/file routes documented in
`../docs/current-api.md`. Server startup migrates the empty/current PostgreSQL
schema only; NEVER imports SQLite. Offline conversion is a separately invoked
`python3 manure/migration/convert.py` tool (see migration README for finalized
arguments), with quiesced matched source snapshot and owned disposable destination.
Live conversion/activation/rotation/deletion is not authorized by these files.

Optional `embedding` object (absent/null means explicit lexical-only, no model
client or model worker; semantic/hybrid requests return typed unavailable):

```json
{
  "operationUrl":"http://127.0.0.1:8080/v1/embeddings",
  "model":"fixture-embedding", "revision":"immutable-revision-id",
  "dimensions":384, "sendDimensions":true,
  "documentPrefix":"passage: ", "queryPrefix":"query: ",
  "normalization":"cosine",
  "credentialFile":"/run/credentials/manure/embedding-token",
  "deadlineMs":30000, "maxResponseBytes":4194304,
  "maxBatch":8, "maxInputBytes":262144, "maxRequestBytes":4194304,
  "maxConcurrent":1, "maxQueued":4, "batchSize":8,
  "leaseSeconds":120, "pollIntervalMs":1000
}
```

Every field required when configured; synthetic local example, not authorization
to transmit existing/private data. `leaseSeconds >= ceil(deadlineMs/1000)+5`.
Only authenticated management search over ready/unexpired names+manifest paths is
indexed; never credentials/grants/password hashes or payload/file bytes. Writes
atomically enqueue source jobs using caller Connection; model calls happen only
in explicit query/index worker paths, outside transactions. Profile identity pins
endpoint/model/revision/dimensions/prefixes/normalization; rebuild never mixes spaces.

Process readiness: stdout `MANURE_READY {"apiOrigin":"...","port":12345,"pid":123}`
after migration/reconciliation/bind. No credential or request data in diagnostics.

Imported destinations use `data_dir = /owned/disposable-target/data` and explicit
`migration_receipt_dir = /owned/disposable-target`. The backend claims BOTH
physical directories for its full lifecycle, verifies OWNER/COMPLETE source and
PG destination/write-boundary bindings before recovery. An old SQLite root or
nonempty payload tree with empty/unimported PG metadata fails `migration-required`;
there is no empty-catalogue adoption. `migrate CONFIG.json` runs schema/retrieval
bootstrap only under physical-root claims: no HTTP, recovery, sweeper, model call
or async indexing. It does not import SQLite or authorize subsequent activation.

`check-config CONFIG.json` parses the same current `Config` and prints
`MANURE_CONFIG_OK` on success. It reads only the explicit config file (bounded
1 MiB, strict UTF-8), never referenced credentials/native libraries/payload roots,
and does not construct JDBC/model clients. Duplicate primary/alias hosts and
invalid typed settings fail without exposing values.

First imported adoption additionally requires the converter's immutable
`PAYLOAD.json` and exact `COMPLETE.payloadManifestSha256`. Both control and copied
payload dev/inode identities must match. Before the first `root_owner` insert,
the backend compares **every raw directory/file path, exact length and hash**
through the descriptor API, outside an open JDBC transaction. `migrate` validates
a completed import too but never inserts a root-owner binding; an early schema
migration cannot bypass the first-serve check. Original snapshot bytes are not
re-compared after acknowledged new writes; the persisted physical binding remains.
`migration_manifest_max_bytes` defaults 67108864 (maximum 536870912), and
`migration_manifest_max_entries` defaults 1000000. Oversized inventories refuse
explicitly without adoption; plan higher finite migration capacity before importing
large source sets. Payload hashing's aggregate byte bound is the exact receipt sum.

## Actual target acceptance runner

`manure/scripts/test-target.sh jvm full` builds the current JVM artifact;
`manure/scripts/test-target.sh native /absolute/ELF /absolute/build-source.sha256 full`
requires byte-identical compiled-input manifests from
`python3 manure/scripts/artifact-source.py` on the actual artifact source snapshot.
Full runs require pinned Node/Chromium, `MANURE_PLAYWRIGHT_CORE_PATH`,
`MANURE_CHROMIUM_BIN`, `MANURE_MCP_SDK_PATH`, `POSTGRES_HOME`, and a paired executable
`MANURE_TEST_PROVISION_COMMAND`. The helper accepts `[generatedDatabaseName]` and
returns exactly `{jdbcUrl,user,passwordFile}`; `[--drop,generatedDatabaseName]`
returns `{}` only for its owned registry. It runs inside the independently owned
provider wrapper with `PONYGIRLS_OWNED_FIXTURE_ROOT`,
`PONYGIRLS_TEST_PROVISION_SERVICE=manure`, and explicit `PG_PROVIDER` code path.
The HTTP runtime has neither superuser/CREATEDB/CREATEROLE nor database-wide CREATE;
only CONNECT and USAGE/CREATE on the administrator-preprovisioned public/manure
namespaces. Each fixture verifies these effective privileges. Offline import
uses the **separate owned fixture administrator**, then transfers imported table
ownership to the runtime role and grants only SELECT on migration control state.
Helper failures never fall back to administrator-as-runtime or reset an arbitrary DB.
`core`/`focused` scopes are iterative diagnostics, not release acceptance.
