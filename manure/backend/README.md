# Manure Scala backend (port in progress; not activated)

Main class `manure.Main`; executable CLI `manure-server serve CONFIG.json` or
`manure-server --config CONFIG.json`. No Python production storage/server fallback.
The portable Python package registers only `manure` and `manure-mcp`, never a
server command; the retired Python server was deleted after every deployment
migrated off SQLite.
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

These are synthetic finite examples, not measured host sizing. Optional `limits.startWaitMs` (default 120000,
1000..3600000) bounds how long `serve` and `migrate` wait, after the physical-root claim, for PostgreSQL to accept
queries: one `manure database-wait code=jdbc-<SQLSTATE>` line when the wait begins, `manure database-wait ready
seconds=<n>` when it ends, `manure failure stage=database-wait … message="database-wait-timeout"` (exit 1) at the bound;
a refused login or missing credential fails at once. Optional `limits.requestConnections` and
`limits.backgroundConnections` (set together or omitted) size the process's one connection pool
(`shared/service-runtime/README.md`): omitted, `maxConnections` − 2 halved from 8 connections up (8 → 3 + 3), below 8 one
shared admission of `maxConnections`; set, request ≥ 1 and both together ≤ `maxConnections` − 2. Requests use the request
connections; the search worker and the sweeper the background ones (8 → a pool of 6 kept open; `migrate` opens one on
use); a request that gets no connection answers 503 `Unavailable` with `Retry-After: 5`. Credential values
are NEVER in configuration or Nix store; existing user token `hashFile` paths and
credential directories are retained. `native_mode` defaults `linked`;
`posix_library` optional only for `shared` (absolute library path required).
`dashboard_dir` and `unlock_shell_dir`: explicit package asset directories, or
null to disable. Installed package should set both absolute paths (dashboard and
unlock subdirectories of its immutable web tree). Repository development defaults
are `manure/web/dashboard`, `manure/web/unlock` relative to launch cwd.
`viewer_dir` likewise selects the bundled viewer tree; installed packages set
`/opt/manure/share/manure/web/viewer`, source development defaults to
`manure/web/viewer/dist` (build first, see that directory's README). Explicit
`null` disables formatted viewers without disabling raw content. `serve` refuses to start when a
configured directory, default or explicit, does not exist (`manure failure stage=assets
code=dashboard-dir-missing error=DomainError message="dashboard-dir-missing"`, `unlock-shell-dir-missing` or
`viewer-dir-missing`); `check-config` does not look.
Renderer assets
and raw bytes use the same artifact authorization checks; no render service is
contacted. The generic Manure icon at `/__manure/viewer/favicon.svg` (prefixed by
the artifact mount in path mode) is served without artifact credentials, including
on locked access pages. It contains no artifact data and does not require an
enabled viewer or dashboard asset directory.

Example minimal synthetic server configuration:

```json
{
  "data_dir": "/var/lib/manure", "api_origin": "https://manure.example.test",
  "content_mode": "subdomain", "content_suffix": "artifacts.example.test",
  "users": [{"id":"operator","type":"human","enabled":true,"login":"operator",
    "passwordHashFile":"/run/credentials/manure/operator-password-pbkdf2","tokens":[
    {"id":"primary","hashFile":"/run/credentials/manure/operator-token-sha256"}
  ]}],
  "dashboard_dir": "/opt/manure/share/manure/web/dashboard",
  "unlock_shell_dir": "/opt/manure/share/manure/web/unlock",
  "viewer_dir": "/opt/manure/share/manure/web/viewer",
  "database": {
    "jdbcUrl":"jdbc:postgresql://127.0.0.1:15433/manure", "user":"manure",
    "passwordFile":"/run/credentials/manure/database-password",
    "limits":{"maxConnections":4,"maxQueued":16,"queueTimeoutMs":5000,
      "connectTimeoutMs":5000,"statementTimeoutMs":30000,"lockTimeoutMs":5000,
      "idleTransactionTimeoutMs":30000,"socketTimeoutMs":30000}
  }
}
```

The optional `indexing` object controls [whose artifacts enter indexed retrieval](../../docs/indexing-preferences.md).
It does not change catalogue access, downloads or sharing.

### OCI image configuration and upgrade requirement

The image (`.#oci-manure`, spec in `nix/pkg/oci/default.nix`) runs `/bin/manure-server serve /config/server.json`
as uid/gid 10001 with working directory `/data`, carries no configuration, and contains the package's web assets at
`/share/manure/web/{dashboard,unlock,viewer}` (observed in the built image: `/share/manure/web/viewer/index.html`,
`viewer.js`, … as links into the package). The mounted configuration must therefore name all three directories.
A complete synthetic example (paths of secrets, database and payload root are the deployment's choice; the payload
root must already exist on the mounted `/data` and, as everywhere, have no symlink components):

```json
{
  "data_dir": "/data/payload", "api_origin": "https://manure.example.test",
  "listen_address": "0.0.0.0", "port": 47329,
  "content_mode": "subdomain", "content_suffix": "artifacts.example.test",
  "users": [{"id":"operator","type":"human","enabled":true,"login":"operator",
    "passwordHashFile":"/run/secrets/manure/operator-password-pbkdf2","tokens":[
    {"id":"primary","hashFile":"/run/secrets/manure/operator-token-sha256"}
  ]}],
  "dashboard_dir": "/share/manure/web/dashboard",
  "unlock_shell_dir": "/share/manure/web/unlock",
  "viewer_dir": "/share/manure/web/viewer",
  "database": {
    "jdbcUrl":"jdbc:postgresql://postgres.example.test:5432/manure", "user":"manure",
    "passwordFile":"/run/secrets/manure/database-password",
    "limits":{"maxConnections":4,"maxQueued":16,"queueTimeoutMs":5000,
      "connectTimeoutMs":5000,"statementTimeoutMs":30000,"lockTimeoutMs":5000,
      "idleTransactionTimeoutMs":30000,"socketTimeoutMs":30000}
  }
}
```

`"viewer_dir": null` disables formatted viewers on purpose (raw bytes are still served); `dashboard_dir` and
`unlock_shell_dir` accept `null` as described above.

**Startup-breaking upgrade requirement.** An image configuration written against the earlier OCI contract names only
`dashboard_dir` and `unlock_shell_dir`. Its `viewer_dir` was unset, so it defaulted to the relative
`manure/web/viewer/dist` (`/data/manure/web/viewer/dist` in the image), which does not exist; the service started and
every viewable file opened in a browser answered 404 `not-found`. `serve` now checks the configured directories
before it acquires any resource and exits with `manure failure stage=assets code=viewer-dir-missing error=DomainError
message="viewer-dir-missing"` (likewise
`dashboard-dir-missing`, `unlock-shell-dir-missing`). Such a configuration must gain the `viewer_dir` line above (or
`null`) **before** a server built from this tree replaces the old one. `check-config` (and therefore a deployment's
configuration check) does not look at the directories; start `serve` once against the mounted configuration to see
the result.

Browser accounts use the independently versioned `/api/account/v1` protocol in
[`../docs/account-auth.md`](../docs/account-auth.md): human password login,
independent durable no-expiry browser sessions, settings and one-time-issued API
tokens. `enabled` defaults true; `login`/`passwordHashFile` are paired/human-only.
A password-only human may omit `tokens` or use an empty list. Configured tokens
remain bearer-only and immutable from settings; their IDs/hashes and machine
access are preserved. Session cookies never accept a bearer token. Legacy
`Command.Login(token)` and `/api/current/login` reject without setting cookies.
Account mutations require `X-Account-Actor` from the displayed `user.actor`,
checked against the cookie owner in the same transaction; domain logout retains
its existing Origin contract. Logout invalidates the server session and its
content grants, not API tokens. Missing/malformed password references fail
closed; `check-config` still does not open referenced files.

Current generated artifact API: `POST /api/current` and raw chunk/file routes are
in `../docs/current-api.md`. Server startup migrates the empty/current PostgreSQL
schema only; NEVER imports SQLite. Live activation/rotation/deletion is not
authorized by these files.

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
to transmit existing/private data. `leaseSeconds` is explicitly bounded to 3..3600; the shared worker renews fenced leases during provider IO, so a finite provider deadline may exceed one lease.
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

## Plain-host root binding policy

Optional `"root_binding":{"mode":"strict"}` defaults to `strict` when absent.
Explicit null, unknown fields/modes and malformed objects refuse configuration.

- `strict`: persistent physical binding requires the same device and inode.
- `inode-anchored`: explicitly tolerate device renumbering for a plain root with
  the same inode. Retain the existing binding bytes; no automatic rebinding.
  Another filesystem can have the same inode: this is an operator-selected weaker
  continuity assumption, **not** portable volume or clone authority.
- `unsafe-off`: disposable deployments only. Do not enforce or create persistent
  physical ownership; leave any existing physical binding row untouched. A wrong
  payload root may attach existing metadata. Do not use this as production recovery.

Nix deployments expose the same enum through
`smind.services.manure.rootBindingMode` (NixOS) and
`smind.hm.services.agentic.manure.rootBindingMode` (Home Manager). Both default to
`"strict"` and omit the default JSON field; no deployment is automatically opted in.

Non-strict modes print `manure warning root-binding-mode=MODE` to stderr whenever
runtime resources are acquired (serve or schema-only migrate). They do not disable
physical process claims, locks, leases, no-follow confinement or exact within-process
root revalidation. `check-config` validates policy without acquiring resources.

Non-strict modes refuse configured root authority/import control paths and persisted
imported destinations, portable bindings or migration receipts. They cannot bypass
portable markers, pending preparation, imported OWNER/COMPLETE/PAYLOAD tuple/hash
checks, SQLite refusal or first-adoption inventory verification. They are not an
alternative authority adapter for imported or portable deployments.

The no-empty-catalogue adoption gate remains. In `unsafe-off`, even an existing
physical binding cannot authorize cleanup of unknown nonempty staging/live data
when the catalogue is empty. This deliberately also refuses orphan recovery after
last-row deletion if payload cleanup was interrupted. Switching back to strict can
refuse a drifted historical binding; switching from unsafe-off does not establish
historical ownership. `migrate` remains schema-only and never adopts a root.

See `../../docs/drafts/20261115-0020-manure-root-binding-policy.md` for the design
and acceptance boundaries. Selecting a mode is not authorization to edit database
state, migrate a binding or deploy/restart a live service.

## Actual target acceptance runner

`manure/scripts/test-target.sh jvm` builds the current JVM artifact and runs the
full target suite; `manure/scripts/test-target.sh native /absolute/ELF` runs it
against a native executable. Full runs require pinned Node/Chromium, `MANURE_PLAYWRIGHT_CORE_PATH`,
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
