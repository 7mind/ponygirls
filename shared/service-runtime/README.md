# Shared service runtime

Current API (all configuration fields required; no constructor defaults):

```scala
import ponygirls.runtime.*
JdbcConfig(jdbcUrl: String, user: String, passwordFile: java.nio.file.Path, limits: JdbcLimits)
JdbcLimits(maxConnections: Int, maxQueued: Int, queueTimeout: FiniteDuration,
  connectTimeout: FiniteDuration, statementTimeout: FiniteDuration,
  lockTimeout: FiniteDuration, idleTransactionTimeout: FiniteDuration,
  socketTimeout: FiniteDuration)
JdbcDatabase.resource(config): Resource[IO, JdbcDatabase]                       // compatible pool
JdbcDatabase.resource(config, sizing: JdbcPoolSizing): Resource[IO, JdbcDatabase] // a pool of `sizing`
JdbcDatabase.service(config, sizing): Resource[IO, JdbcDatabase]                 // the process's one service pool
db.transaction[A](f: java.sql.Connection => A): IO[A]
db.background: JdbcDatabase                                                     // background admission
db.migrate(namespace: String, migrations: List[Migration]): IO[Unit]
JdbcPoolSizing.compatible(limits)
JdbcPoolSizing.partitioned(limits, request: Option[Int], background: Option[Int], minimumBackground: Int): Either[String, JdbcPoolSizing]
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

Each runtime owns one bounded pool (HikariCP, restart-robustness spec §5) of physical connections opened with the
production login (password file read for each new connection: a rotated file serves the next login, existing
connections stay authenticated until retired). JDBC is on `IO.blocking`; a connection serves one transaction at a time.
Admission bounds active transactions plus queued callers, rejects overflow, times out waiting and releases reservations
on cancellation. Closing rejects new calls in every admission, then drains them, then closes the pool (a blocking
closer's interrupt is restored after the pool has closed). PostgreSQL receives finite
connect/login/socket, statement, lock and idle-in-transaction timeouts. Driver second-resolution timeouts round up.

**Sizing.** `JdbcPoolSizing` divides one pool into the request admission's and the background admission's connections
(`request + background`, background 0: `background` is the request admission). `compatible(limits)` (the one-argument
constructors: rites, ontology, test fixtures) is one admission of `maxConnections` over a pool opened on first use whose
idle connections close after `idleTimeout` (10 min). `partitioned(limits, request, background, minimumBackground)` is the
services' sizing from their optional `requestConnections` and `backgroundConnections` keys (set together or omitted):
omitted, `maxConnections` − `headroom` (2) halved, background the smaller half (12 → 5 + 5, 8 → 3 + 3), below
`partitionedMinimum` (8) the compatible sizing; set, request ≥ 1, background ≥ `minimumBackground` and together ≤
`maxConnections` − 2. A partitioned pool opens all its connections at once and keeps them; Left names the invalid key.
Each admission keeps `maxQueued` and `queueTimeoutMs`. `new BlockingJdbcDatabase(config, sizing, reserve)` carves
`reserve` connections out of the background admission (out of the one admission without one) into a reserved admission of
their own over the same pool, its view `reserved` (Chronicle's lease renewals, spec §5 deviation A: 12 → background 4 +
reserved 1; compatible 8 → 7 + 1); none when that would leave the admission empty (one connection: one admission for
everything). Closing rejects new work in every admission before any drains.

**One service pool per process.** Each service's production wiring builds its pool with `JdbcDatabase.service(config,
sizing)` or `BlockingJdbcDatabase.service(config, sizing, reserve)`, which take a process-wide claim before the pool is
built and release it after the pool closed: another service pool in the same process meanwhile fails
`RuntimeFailure("pool-already-open")` without opening a connection (Chronicle `serve`/`migrate`, Haystack and Manure
`serve`/`migrate`; sequential in-process servers in tests work). The other constructors (rites, ontology, test fixtures,
which build many runtimes in one JVM) take no claim, so a pool built through them is not counted.

**Borrow.** After admission one monotonic deadline `now + A`, A = `connectTimeoutMs` in whole seconds rounded up (the
login bound as before; a `transactionWithin(D)` uses min(D, now + A)), bounds the acquisition: at most one try more than the
pool's connections, each a borrow that waits at most until the deadline, then the reset `DISCARD ALL; <configured
bounds>` in one execution under a network timeout and a watchdog that aborts the physical connection at min(deadline,
now + max(250 ms, A/4)) (the cap): a reset that ends after the cap is not accepted even when the watchdog's alarm comes
late. The pool never validates on borrow (its alive-bypass window, a JVM-global system property, is disabled only while
the engine builds a pool, under one lock, and restored afterwards; a Hikari pool built elsewhere in the process meanwhile
would lose its own validation — none is, and each service builds one pool): the reset is the liveness check, so no
validation runs past the deadline and every positive budget reaches the pool (a remainder below the pool's millisecond
borrows without waiting: an idle connection or none). Idle connections are validated in the background by the keepalive
with V = max(250 ms, min(1 s, A/4)). The reset owns the connection from the borrow to the handoff: the watchdog owns it
until the reset disarms it (exactly one of the two happens), and a reset that fails, is aborted, throws (an
interruption included) or ends after its cap evicts it, never hands it out. The
reset then installs the transaction's network timeout (socket timeout; extended timeout + socket timeout; the time left
to D) before the transaction's first statement, and the deadline is checked once more after it. A borrower that finds no connection by the deadline fails
`JdbcFailure("connection-unavailable", last SQLSTATE)` (e.g. 28000 for a role without LOGIN, none when the pool timed
out). The reset returns every session state (role, settings including `search_path`, temp tables, session advisory
locks, LISTEN, cursors, prepared statements, an `application_name` the driver set after login) to the login's; the pool
resets isolation, read-only, auto-commit and network timeout on return. A pooled connection lives 22.5 to 30 min
(`maximumLifetime`), an idle one is checked every 2 min (`keepaliveTime`; server `idle_session_timeout` must be 0 or at
least 3 min); failed logins are retried in the background with a back-off up to 5 s. The pool logs through SLF4J without
a provider: nothing (a provider added later must silence `com.zaxxer.hikari`).

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

`StartFailure.classify(error, known)` reduces a start or run failure to a code, the simple class name of the chosen
cause and a fixed message: breadth-first over causes and suppressed exceptions (distage wrappers; each queued once, at
most `MaxCauses` = 64), the first `BindException` (`address-in-use`, else `bind`), `JdbcFailure` (`jdbc-<SQLSTATE>`),
`RuntimeFailure`, connect failure or timeout, or a type of the service's `known` partial function; otherwise
`internal`. No exception message is printed. `StartFailure.line(service, stage, failure, port)` is the services' one
stderr line `<service> failure stage=… code=… error=… message="…"`, with ` port=…` only for a bind failure.

`DatabaseWait.await(config, bound, report)` holds a start until PostgreSQL accepts queries: a new connection through
the engine's own login (same properties, password file read per attempt) runs `SELECT 1`. One monotonic deadline
`start + bound` caps every phase. Each attempt (credential read, login, probe) runs on its own daemon thread; the caller
waits for it until the deadline, and at the deadline or when interrupted (a cancelled start) aborts its connection
(`Connection.abort` closes the socket whatever the driver is blocked in) and stops waiting; an answer that arrives after
the deadline does not count. A login starts only with `minimumAttempt` (100 ms) left after the credential read,
`loginTimeout` is that remaining time in milliseconds (at most `connectTimeout`), the whole-second connect/socket
timeouts round up to at least 1 s, the probe starts only with 1 ms left, and the pause between attempts (`interval`,
1 s) never passes the deadline. `JdbcTransient.connection(sqlState)` names the states waited out: class 08, 57P01, 57P02,
57P03, 53300.
Any other SQLSTATE or a credential-file failure throws at once (`JdbcFailure("database-unavailable", state)`,
`RuntimeFailure`); at the deadline it throws `JdbcFailure("database-wait-timeout", last waited state)`. `report` gets
`database-wait code=jdbc-<SQLSTATE>` for the first waited failure and `database-wait ready seconds=<n>` after a wait.
Each service runs it as its `database-wait` stage before it creates its database runtime and before any other start
step that uses the database (operator commands such as `check-config` do not wait). Its bound is the optional
`startWaitMs` beside the required limits (Chronicle `databaseLimits.startWaitMs`, Haystack and Manure
`database.limits.startWaitMs`): default `DatabaseWait.defaultBound` 120000, accepted 1000..3600000
(`DatabaseWait.startWait`), anything else is a configuration error. The optional `requestConnections` and
`backgroundConnections` beside them size the service's pool (`JdbcPoolSizing.partitioned`; Chronicle's background at
least 3); an invalid pair is a configuration error.

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

`new BlockingJdbcDatabase(config)` (compatible pool) or `new BlockingJdbcDatabase(config, sizing)` is a bounded, owned
`AutoCloseable` synchronous facade for existing synchronous JDBC APIs; `background` is its background view
(`BlockingJdbcTransactions`: `transaction`, `extendedTransaction`, `transactionWithin` through the background admission). Call only on blocking threads; close
rejects new calls and drains admitted work without any cats runtime or unsafe IO
bridge. It and async `JdbcDatabase` delegate to the **same** physical transaction
engine. The blocking gate uses finite fair semaphore admission; queued interruption
frees the reservation and restores the interrupt flag. Running callbacks are not
claimed interruptible/cancelable or rolled back merely because callers disconnect.
`BlockingJdbcDatabase.withConnectionFactory(config, JdbcConnectionFactory)` is an
explicit trusted real-driver probe seam; ordinary production construction always
uses DriverManager and the same strict config and connection properties.

`extendedTransaction(timeout)` (restart-robustness spec §4) is a blocking transaction whose statement timeout is
raised transaction-locally to `timeout` (also above a stricter role setting; Chronicle's publication batches), with the
network timeout at `timeout` plus `socketTimeoutMs`; lock and idle-in-transaction timeouts stay configured.
`transactionWithin(deadline)` (R-a2 M1, Chronicle's transient failure record) is one try by one monotonic deadline D,
converted once to the engine's clock. With less than `BlockingJdbcDatabase.minimumTry` (100 ms) left it is refused
`admission-timeout` before its admission; the admission waits at most min(`queueTimeoutMs`, D − now), read after the
reservation, right before the semaphore; the acquisition ends by min(D, its start + A) (a remainder below 1 ms makes
one borrow without waiting and no further borrow), each reset by min(that, its start + the cap). From the handoff a
transaction watch (the reset's watchdog, a second one-CAS watch) aborts the physical connection at D; D is checked before
the setup, the callback, every call of the callback that may reach the server, and COMMIT: past D, also with a late
watchdog, nothing more starts (a refusal aborts through the watch). The callback's connection is a `GuardedConnection`:
statement creation and execution, result-set cursor moves, savepoints, `setObject`/`setNull`, `getObject` and the
connection reads that query the server are guarded; every statement and result set it hands out is guarded the same way
and leads back only to the guarded connection (`getConnection`, `getStatement`). Calls that would hand out an unguarded
server-talking handle or change what the engine or the session owns are refused before anything is sent with
`JdbcFailure("deadline-unsupported")`: `getMetaData` (database, statement, parameter, result set), `unwrap` to the
driver's objects, `prepareCall`, large objects, arrays, refs and structs, `commit`/`rollback()`/`setAutoCommit`/`close`/
`abort`/`setNetworkTimeout`, session settings (read-only, isolation, schema, catalog, client info, holdability, type
map), an updatable or scrollable result set, a statement's query timeout and `cancel`. The setup tightens the statement and lock timeouts to the time
left. After D or the abort nothing more is sent (no ROLLBACK): the connection is evicted; it returns to the pool only
when the watch was disarmed and the transaction committed or rolled back before D. It fails
`JdbcFailure("deadline-expired", driver SQLSTATE)` exactly for a refusal at a boundary and for a connection error (class
08 or no SQLSTATE) caught after its watch aborted; a COMMIT cut that way has an unknown outcome. Every other error keeps
its SQLSTATE even when it arrives after D (a P0001 whose ROLLBACK the abort cut stays P0001); expiry in admission or
acquisition stays `admission-timeout` / `connection-unavailable`. `JdbcTransient.deadline(error)` names that failure
(`JdbcTransient.job` is unchanged). The server ends a cut backend's work only by its own timeouts set at the setup (a
backend waiting in a statement or COMMIT keeps its locks until then).
`JdbcTransient.job(error)` names a job's failures that a later attempt outlives: the `connection` states above, 57014
(a statement timeout), `admission-full`, `admission-timeout` and `connection-unavailable` with or without a SQLSTATE
(a pool wait can end before any login failed). `DatabaseWait` keeps its own start rules (`connection` states only).

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
`idleTransactionTimeoutMs`, `socketTimeoutMs`. No omitted-field fallback; the start wait `startWaitMs` beside them is
optional (see `DatabaseWait` above). Effective
PostgreSQL statement/lock/idle timeouts are the minimum of required policy and any
stricter existing role/database setting at login, applied by one fully consumed bound
setup query after `DISCARD ALL` (the reset) at each borrow, before the caller transaction. The query reads each
timeout's current value in the session as `current_setting(name)`, whose text (PostgreSQL prints the largest unit that
divides the milliseconds exactly: `0`, `1500ms`, `30s`, `1min`, `1h`, `2d`) it parses as an interval. It does not read
`pg_settings`: that view is the function `pg_show_all_settings()`, which materialises every setting for the three rows.
pgbench on production PostgreSQL 18.7 (2026-11-26; 1 client, extended protocol, local socket, 4 s per script) measured
per transaction `SELECT 1` 0.033 ms, `DISCARD ALL` + `SELECT 1` 0.061 ms, the reset reading `pg_settings` + `SELECT 1`
1.334-1.557 ms, the reset reading `current_setting` + `SELECT 1` 0.140 ms. This fixed setup is
explicitly accounted in SQL-observation tests; domain query work/isolation and
admission/cursor/deadline contracts are not silently filtered or relaxed.

Chronicle's explicit example/acceptance baseline uses statement30s, lock35s,
idle-transaction60s and socket35s: the introduced infrastructure limits must not
preempt the already-specified six-second archive wait, thirty-second observable
archive statement deadline or renewal serialized past a five-second expiry.
This changes no public query deadline. Chronicle's provider role must use the
same lock/idle baseline, because stricter role settings are deliberately retained.
Haystack/Manure and explicit operator reductions keep their own finite policies.
