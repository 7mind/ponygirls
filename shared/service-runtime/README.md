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
strict UTF8 with one optional trailing newline. Operator-owned directories and
permissions remain part of the deployment boundary.

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
Application exceptions pass through for service-specific safe handling.

Migrations are append-only, namespace-scoped, ordered positive versions. The
per-database ledger `ponygirls_runtime_migrations` records name and SHA256 of exact
SQL bytes. A transaction advisory lock serializes ledger bootstrap and application;
applied prefixes must match exactly, including names. Unknown/modified/deleted
migrations fail closed. SQL and ledger inserts commit together; failure rolls back
both. Migration SQL is trusted service/library-owned input, never user SQL.
No application tables or domain auth policy belong here.
