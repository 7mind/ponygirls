package haystack.storage

import cats.effect.{IO, Resource}
import haystack.retrieval.{HaystackRetrieval, ProjectionPolicy}
import ponygirls.retrieval.{EmbeddingSpace, RetrievalProfile}
import ponygirls.retrieval.postgres.PostgresRetrieval
import ponygirls.runtime.{CredentialFile, JdbcDatabase}
import java.nio.charset.StandardCharsets.UTF_8
import java.nio.file.{Files, Path}
import java.sql.DriverManager
import java.util.{Properties, UUID}
import java.util.concurrent.{TimeUnit, TimeoutException}
import scala.concurrent.duration.*
import scala.jdk.CollectionConverters.*
import TestSupport.*

/** The retained post-deployment check haystack/scripts/check-legacy-free.sql, run exactly as the operator runs it
  * (psql -f), on copies of one fresh database of the current binary (its serving start-up with a configured retrieval
  * profile). Every copy first receives migration 0007 of the legacy data retirement plan
  * (docs/drafts/20261118-1100-legacy-data-retirement.md §6.6) as far as the check reads it, written here as idempotent
  * SQL until the binary applies it; then one legacy shape, seeded with plain SQL.
  */
class LegacyFreeCheckTest extends ContractSuite {
  // The forked test JVM runs in haystack/server.
  private val check = Path.of("..", "scripts", "check-legacy-free.sql")
  private val replayConstraint = "write_requests_current_digest_format_check CHECK (digest_format = 'haystack-op-scala-v1')"
  /** §6.6 0007: no Node-format column default, the current-format constraint, the marker (unless the binary did it). */
  private val cleanup = List(
    "ALTER TABLE write_requests ALTER COLUMN digest_format DROP DEFAULT",
    "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'write_requests'::regclass AND conname = 'write_requests_current_digest_format_check') THEN " +
      "ALTER TABLE write_requests ADD CONSTRAINT " + replayConstraint + "; END IF; END $$",
    "INSERT INTO schema_migrations(version) VALUES ('0007-node-replay-retired') ON CONFLICT DO NOTHING")
  /** Every counter line of a passing run (the database name, the migration list and the verdict are asserted apart). */
  private val clean = Map("LP.replay.other_digest_format" -> "0", "LP.retrieval.profiles" -> "1", "LP.retrieval.not_proven_v2" -> "0",
    "LF.replay.column_default_present" -> "0", "LF.replay.current_format_constraint" -> "1", "LF.schema.node_replay_retired_marker" -> "1")

  private def url(database: String): String = databaseConfig.jdbcUrl.take(databaseConfig.jdbcUrl.lastIndexOf('/') + 1) + database
  private val maintenance = databaseConfig.jdbcUrl.drop(databaseConfig.jdbcUrl.lastIndexOf('/') + 1)
  private def admin(database: String, statements: Seq[String]): IO[Unit] = IO.blocking {
    val config = databaseConfig; val properties = new Properties
    properties.setProperty("user", config.user); properties.setProperty("password", CredentialFile.read(config.passwordFile))
    val connection = DriverManager.getConnection(url(database), properties)
    try statements.foreach { sql => val statement = connection.createStatement(); try statement.execute(sql) finally statement.close() } finally connection.close()
  }
  private def opened(database: String): Resource[IO, JdbcDatabase] = JdbcDatabase.resource(databaseConfig.copy(jdbcUrl = url(database)))
  private def projection(db: JdbcDatabase): HaystackRetrieval = {
    val policy = ProjectionPolicy("synthetic-test-approved-fields", true, Vector("/public"), 4096)
    new HaystackRetrieval(db, policy, new PostgresRetrieval("haystack", Some(RetrievalProfile(EmbeddingSpace("synthetic-fixture", "v1", 3, true, "", "", "cosine"), policy.id))), None, 16)
  }
  /** One fresh database of the current binary (Main's serving start-up: migrations, then the projection), copied for every case. */
  private val fresh = new Fixture[String]("fresh database of the current binary") {
    private var name = Option.empty[String]
    def apply(): String = name.getOrElse(fail("fresh database was not created"))
    override def beforeAll(): Unit = run {
      val created = "haystack_legacy_free_" + UUID.randomUUID().toString.replace("-", "")
      admin(maintenance, List(s"CREATE DATABASE $created")) *> IO { name = Some(created) } *> opened(created).use { db =>
        Migrations.initialize(db, Activity) *> new PostgresItemRepository(db, Some(projection(db))).initializeProjection()
      }
    }
    override def afterAll(): Unit = name.foreach(created => run(admin(maintenance, List(s"DROP DATABASE $created WITH (FORCE)"))))
  }
  override def munitFixtures = List(fresh)

  private final case class Checked(exit: Int, lines: List[String], err: String) {
    def last: String = lines.lastOption.getOrElse("")
    def counters: Map[String, String] = lines.filter(line => line.startsWith("LP.") || line.startsWith("LF.")).map { line =>
      val separator = line.indexOf('|'); line.take(separator) -> line.drop(separator + 1)
    }.toMap -- List("LF.database", "LF.schema_migrations", "LF.result")
  }
  // IO.interruptible: a cancelled or timed-out test interrupts the wait, and the helper kills the child.
  private def checked(database: String): IO[Checked] = IO.interruptible {
    assert(Files.isRegularFile(check), s"missing retained check ${check.toAbsolutePath}")
    val psql = Path.of(sys.env.getOrElse("POSTGRES_HOME", throw new IllegalStateException("POSTGRES_HOME required (nix develop .#backend)")), "bin", "psql").toString
    val config = databaseConfig; val address = config.jdbcUrl.stripPrefix("jdbc:postgresql://").takeWhile(_ != '/')
    val connection = Map("PGHOST" -> address.takeWhile(_ != ':'), "PGPORT" -> address.dropWhile(_ != ':').drop(1), "PGUSER" -> config.user,
      "PGPASSWORD" -> CredentialFile.read(config.passwordFile), "PGDATABASE" -> database)
    val ran = CheckChild.run(List(psql, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", check.toString), sys.env, connection, CheckChild.limit)
    Checked(ran.exit, ran.out.linesIterator.toList, ran.err)
  }
  private val noProductWrites: String => IO[Unit] = _ => IO.unit
  /** A copy of the fresh database with `writes` (product code), the clean-up schema and the seed applied, in this order. */
  private def copy(writes: String => IO[Unit], seed: List[String]): IO[Checked] = {
    val name = "haystack_legacy_free_case_" + UUID.randomUUID().toString.replace("-", "")
    Resource.make(admin(maintenance, List(s"CREATE DATABASE $name TEMPLATE ${fresh()}")))(_ => admin(maintenance, List(s"DROP DATABASE $name WITH (FORCE)")))
      .use(_ => writes(name) *> admin(name, cleanup ++ seed) *> checked(name))
  }

  test("a fresh database of the current binary with the clean-up schema: last line LF.result|legacy-free, exit 0, every counter clean") {
    val ran = run(copy(noProductWrites, Nil))
    assertEquals((ran.exit, ran.last), (0, "LF.result|legacy-free"), ran.err)
    assertEquals(ran.counters, clean)
  }
  test("a write of the current binary (its replay row and retrieval projection) stays legacy-free") {
    val ran = run(copy(name => opened(name).use { db =>
      new PostgresItemRepository(db, Some(projection(db))).commit(op(key = "p:current", document = doc("current")), Bot, Later).map(written => assertEquals(written.revision, 1L))
    }, Nil))
    assertEquals((ran.exit, ran.last), (0, "LF.result|legacy-free"), ran.err)
    assertEquals(ran.counters, clean)
  }

  private final case class Seed(name: String, sql: List[String], changed: Map[String, String])
  private val descriptors = List(
    "a v1" -> s"""["embedding-space-v1","${"e" * 64}","embed","v1",3,false,"query: ","passage: ","cosine"]""",
    "an empty" -> "[]",
    "a [null]" -> "[null]",
    "a wrong-shape" -> """["embedding-space-v2","embed","v1","3",false,"query: ","passage: ","cosine"]""",
    "a non-JSON" -> "embedding-space-v2")
  private val seeds = descriptors.map { (kind, descriptor) =>
    Seed(s"$kind retrieval profile descriptor", List(s"INSERT INTO pony_retrieval_profiles VALUES ('seeded', 'seeded-profile', 'seeded-space', '$descriptor', convert_to('seeded-policy', 'UTF8'))"),
      Map("LP.retrieval.profiles" -> "2", "LP.retrieval.not_proven_v2" -> "1"))
  } ++ List(
    // The clean-up constraint forbids this row in a new write; it models a row older than the constraint (NOT VALID).
    Seed("a Node-format replay row", List("ALTER TABLE write_requests DROP CONSTRAINT write_requests_current_digest_format_check",
      "INSERT INTO write_requests(principal_user, token_id, request_id, digest_format, digest, outcome) " +
        "VALUES ('alice', 't1', '00000000-0000-4000-8000-000000000001', 'haystack-op-v1', repeat('f', 64), '{\"kind\":\"committed\",\"revision\":1}')",
      "ALTER TABLE write_requests ADD CONSTRAINT " + replayConstraint + " NOT VALID"), Map("LP.replay.other_digest_format" -> "1")),
    Seed("the Node-format column default", List("ALTER TABLE write_requests ALTER COLUMN digest_format SET DEFAULT 'haystack-op-v1'"), Map("LF.replay.column_default_present" -> "1")),
    Seed("no current-format constraint", List("ALTER TABLE write_requests DROP CONSTRAINT write_requests_current_digest_format_check"), Map("LF.replay.current_format_constraint" -> "0")),
    Seed("no 0007 marker", List("DELETE FROM schema_migrations WHERE version = '0007-node-replay-retired'"), Map("LF.schema.node_replay_retired_marker" -> "0")))
  seeds.foreach { seed =>
    test(s"seeded: ${seed.name} -> ${seed.changed.map(_ + "|" + _).mkString(", ")}, LF.result|legacy-present, exit 3") {
      val ran = run(copy(noProductWrites, seed.sql))
      assertEquals((ran.exit, ran.last), (3, "LF.result|legacy-present"), ran.err)
      assert(ran.err.contains("haystack legacy-free check failed"), ran.err)
      assertEquals(ran.counters, clean ++ seed.changed)
    }
  }
}

/** The check's psql child. Environment: an allow-list of tool locations and locale plus the fixture's connection, so no
  * inherited PGHOSTADDR, PGSERVICE or PGPASSFILE can redirect it. Wait: bounded; on timeout or interruption the child
  * and its descendants are killed and awaited, again bounded.
  */
private[storage] object CheckChild {
  val inherited: Set[String] = Set("PATH", "LANG", "LC_ALL", "TMPDIR")
  /** A run of the check on a fixture database takes well under a second; the bound only stops a hung child. */
  val limit: FiniteDuration = 20.seconds
  /** How long killed processes may take to be gone. */
  val reapLimit: FiniteDuration = 5.seconds
  final case class Result(exit: Int, out: String, err: String)
  def run(command: List[String], parent: Map[String, String], fixture: Map[String, String], limit: FiniteDuration): Result = {
    val builder = new ProcessBuilder(command.asJava)
    val env = builder.environment(); env.clear(); env.putAll((parent.filter(entry => inherited.contains(entry._1)) ++ fixture).asJava)
    val out = Files.createTempFile("legacy-free-check-", ".out"); val err = Files.createTempFile("legacy-free-check-", ".err")
    builder.redirectOutput(out.toFile).redirectError(err.toFile)
    try {
      val process = builder.start()
      val finished = try process.waitFor(limit.toMillis, TimeUnit.MILLISECONDS) catch { case interrupted: InterruptedException => destroy(process); throw interrupted }
      if (!finished) { destroy(process); throw new TimeoutException(s"${command.head} did not finish within $limit") }
      Result(process.exitValue(), Files.readString(out, UTF_8), Files.readString(err, UTF_8))
    } finally { Files.delete(out); Files.delete(err) }
  }
  /** Kills the descendants and the child, then waits until each is gone, within `reapLimit` in total. */
  private def destroy(process: Process): Unit = {
    val family = process.descendants().iterator().asScala.toList :+ process.toHandle
    family.foreach(_.destroyForcibly())
    val deadline = System.nanoTime() + reapLimit.toNanos
    family.foreach { handle =>
      try handle.onExit().get(math.max(0L, deadline - System.nanoTime()), TimeUnit.NANOSECONDS)
      catch { case _: TimeoutException => throw new IllegalStateException(s"process ${handle.pid()} still runs $reapLimit after it was killed") }
    }
  }
}
