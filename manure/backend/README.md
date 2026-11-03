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
