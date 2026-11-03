# Shared service runtime

Current API (all configuration fields required; no constructor defaults):

```scala
import ponygirls.runtime.*
JdbcConfig(jdbcUrl: String, user: String, passwordFile: java.nio.file.Path, limits: JdbcLimits)
JdbcLimits(maxConnections: Int, maxQueued: Int, queueTimeout: FiniteDuration,
  connectTimeout: FiniteDuration, statementTimeout: FiniteDuration,
  lockTimeout: FiniteDuration, idleTransactionTimeout: FiniteDuration,
  socketTimeout: FiniteDuration)
JdbcDatabase.resource(config): Resource[IO, JdbcDatabase]
db.transaction[A](f: java.sql.Connection => A): IO[A]
db.migrate(namespace: String, migrations: List[Migration]): IO[Unit]
Migration(version: Int, name: String, sql: String)
Admission.resource(AdmissionConfig(maxActive: Int, maxQueued: Int, queueTimeout: FiniteDuration))
gate.run[A](work: IO[A]): IO[A]
```

Service config/Nix must supply the complete capacity/deadline policy. Credentials
are read only from an explicit absolute file on each connection; no environment,
plaintext config field or credential-bearing JDBC URL fallback. Files are bounded
strict UTF8 with one optional trailing newline. Operator-managed symlink references
(e.g. agenix) are resolved with `toRealPath` per read, the resolved leaf must be a
regular file before opening, and the final open is NOFOLLOW. The configured path,
all containing/resolved directories, replacement policy and permissions are trusted
operator inputs. Operators must not race a special-file replacement; this boundary
is not an adversarial payload-path confinement API. Ordinary FIFOs are rejected
before opening. Systemd LoadCredential copies are also supported.

This is bounded DriverManager-per-transaction, **not** a connection pool. JDBC is
on `IO.blocking`; connections/statements are not shared between requests. Admission
bounds active connections plus queued callers, rejects overflow, times out waiting
and releases reservations on cancellation. Closing rejects new calls and drains
admitted calls. PostgreSQL receives finite connect/login/socket, statement, lock
and idle-in-transaction timeouts. Driver second-resolution timeouts round up.

Callbacks are narrow **trusted synchronous JDBC code**. They must terminate, close
statements/results, not escape a connection, not commit/rollback/close it, and not
weaken database limits. They can call a retrieval projection on the **same**
connection for atomic source+projection/outbox writes. Remote calls must happen
outside the transaction. A callback is intentionally uncancelable while running:
no permit or connection is released while blocking JDBC is still live. Cancellation
and shutdown await completion/rollback/close. There is no claim of forcibly killing
arbitrary callback CPU code, nor that client disconnect means a write rolled back.
Domains need idempotency/replay identity for uncertain commit outcomes.

`JdbcFailure(code, sqlState)` sanitizes JDBC errors (no cause/SQL/URL/credential or
server detail). `RuntimeFailure(code)` reports admission/lifecycle/migration errors.
Application exceptions pass through for service-specific safe handling. Rollback/
close failures are retained only as sanitized suppressed `JdbcFailure` values with
codes `database-rollback-failed` / `database-close-failed` (no raw cause). A failure
during commit is an uncertain outcome, not proof of rollback or a retry invitation.

Migrations are append-only, namespace-scoped, ordered positive versions. The
per-database ledger `ponygirls_runtime_migrations` records name and SHA256 of exact
SQL bytes. A transaction advisory lock serializes ledger bootstrap and application;
applied prefixes must match exactly, including names. Unknown/modified/deleted
migrations fail closed. SQL and ledger inserts commit together; failure rolls back
both. Migration SQL is trusted service/library-owned input, never user SQL.
No application tables or domain auth policy belong here.

## distage / pinned Cats IO

`CatsIOInjector.apply(): izumi.distage.model.Injector[IO]` is the shared distage
entrypoint (`CatsIOInjector().produceGet[Graph](module).use(...)`). It preserves
Chronicle's pinned Scala2.13 Cats / Scala3 Izumi erased-ABI workaround unchanged.
Use ordinary typed/`@Id` graph bindings and Lifecycle-managed resources; the helper
does not scan plugins or install service bindings. ChronicleInjector delegates
here, so apps must not copy their own QuasiIO/QuasiAsync adapter implementation.

## Synchronous domain adoption

`new BlockingJdbcDatabase(config)` is a bounded, owned `AutoCloseable` synchronous
facade for existing synchronous JDBC APIs. Call only on blocking threads; close
rejects new calls and drains admitted work without any cats runtime or unsafe IO
bridge. It and async `JdbcDatabase` delegate to the **same** physical transaction
engine. The blocking gate uses finite fair semaphore admission; queued interruption
frees the reservation and restores the interrupt flag. Running callbacks are not
claimed interruptible/cancelable or rolled back merely because callers disconnect.
`BlockingJdbcDatabase.withConnectionFactory(config, JdbcConnectionFactory)` is an
explicit trusted real-driver probe seam; ordinary production construction always
uses DriverManager and the same strict config and connection properties.

`JdbcFailure` is now a sanitized `SQLException` subtype so synchronous SQLState
matching remains valid, with the existing `(code, sqlState: Option[String])` API.
There is no raw driver diagnostic or cause. Safe secondary failure semantics are
unchanged. `BoundedSecretFile.read(path,maxBytes)` is the common strict UTF8 raw
reader, allowing empty optional auth; DB `CredentialFile` still requires nonempty.
It resolves trusted operator references, verifies regular type before opening and
bounds **actual bytes read** (`readNBytes(maxBytes+1)`), never size-then-readString.

## Chronicle adoption

Chronicle's existing synchronous `Database.transaction` now delegates to the
owned blocking facade, and its distage graph owns `DatabaseResource` cleanup.
The domain migration SQL, advisory-lock/order, profile/security reconciliation,
ArchiveProjection backfill and post-backfill migration remain Chronicle-owned and
unchanged. They are **not** blindly registered in the generic runtime ledger.
`chronicle-server migrate CONFIG.json` initializes only this database/profile
configuration, without constructing HTTP, model clients or workers.

Chronicle config keeps `jdbcUrl`, `databaseUser`, `databasePasswordFile` and requires
all eight fields under **`databaseLimits`**: `maxConnections`, `maxQueued`,
`queueTimeoutMs`, `connectTimeoutMs`, `statementTimeoutMs`, `lockTimeoutMs`,
`idleTransactionTimeoutMs`, `socketTimeoutMs`. No omitted-field fallback. Effective
PostgreSQL statement/lock/idle timeouts are the minimum of required policy and any
stricter existing role/database setting, applied by one fully consumed bound
`pg_settings` setup query before the caller transaction. This fixed setup is
explicitly accounted in SQL-observation tests; domain query work/isolation and
admission/cursor/deadline contracts are not silently filtered or relaxed.

Chronicle's explicit example/acceptance baseline uses statement30s, lock35s,
idle-transaction60s and socket35s: the introduced infrastructure limits must not
preempt the already-specified six-second archive wait, thirty-second observable
archive statement deadline or renewal serialized past a five-second expiry.
This changes no public query deadline. Chronicle's provider role must use the
same lock/idle baseline, because stricter role settings are deliberately retained.
Haystack/Manure and explicit operator reductions keep their own finite policies.
