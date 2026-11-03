package haystack.storage

import cats.effect.{IO, Resource}
import cats.effect.unsafe.implicits.global
import haystack.domain.*
import java.nio.file.Path
import java.time.Instant
import java.util.concurrent.atomic.AtomicLong
import ponygirls.runtime.{CredentialFile, JdbcConfig, JdbcDatabase, JdbcLimits}
import java.sql.DriverManager
import java.util.{Properties, UUID}
import scala.concurrent.duration.*

/** Synthetic fixtures only. The PG leg deliberately fails, not silently skips,
  * without explicit test database credentials. Use test-postgres-scala.sh.
  */
object TestSupport {
  val Alice = Principal("alice", "human", "t1")
  val Bot = Principal("bot", "agent", "t2")
  val Now = Instant.parse("2026-10-07T18:00:00Z")
  val Later = Now.plusSeconds(3600)
  val Activity = "agent-activity"
  private val counter = new AtomicLong
  def requestId(): String = f"0193e8d5-6f5c-7a1b-8c2d-${counter.incrementAndGet()}%012x"
  def doc(title: String = "t", fields: String = "{}", extra: String = ""): String =
    s"""{"title":"$title","description":"d","fields":$fields,"type":"fact","status":"actual","importance":"low","human-attention":"cleared","links":[]$extra}"""
  def op(key: String = "p:a", revision: Long = 0L, document: String = doc(), id: String = requestId()): AcceptedOperation =
    OperationEnvelope.accept(key, document, revision, id)

  def databaseConfig: JdbcConfig = {
    def required(name: String): String = sys.env.getOrElse(name, throw new IllegalStateException(s"$name required: run haystack/scripts/test-postgres-scala.sh (production leg is mandatory)"))
    JdbcConfig(required("HAYSTACK_TEST_JDBC"), required("HAYSTACK_TEST_DB_USER"), Path.of(required("HAYSTACK_TEST_DB_PASSWORD_FILE")),
      JdbcLimits(16, 64, 10.seconds, 5.seconds, 15.seconds, 10.seconds, 15.seconds, 20.seconds))
  }
  def database: Resource[IO, JdbcDatabase] = JdbcDatabase.resource(databaseConfig)
  def wipe(db: JdbcDatabase): IO[Unit] = db.transaction { c =>
    Sql.update(c, "TRUNCATE items,item_revisions,item_links,item_search,item_tag_values,write_requests")
    if (Sql.rows(c, "SELECT to_regclass('item_index_jobs') IS NOT NULL")(_.getBoolean(1)).head)
      Sql.update(c, "TRUNCATE item_index_jobs")
    ()
  }
  def initializedDatabase: Resource[IO, JdbcDatabase] = database.evalTap(Migrations.initialize(_, Activity)).evalTap(wipe)

  /** Only fixture CREATE/DROP DATABASE uses an autocommit admin connection:
    * PostgreSQL forbids those statements in transactions. Every tested service,
    * repository and migration operation uses actual JdbcDatabase.resource.
    */
  def emptyDatabase: Resource[IO, JdbcDatabase] = {
    val name = "haystack_scala_test_" + UUID.randomUUID().toString.replace("-", "")
    def admin(sql: String): IO[Unit] = IO.blocking {
      val config = databaseConfig
      val props = new Properties
      props.setProperty("user", config.user)
      props.setProperty("password", CredentialFile.read(config.passwordFile))
      props.setProperty("connectTimeout", "5")
      props.setProperty("socketTimeout", "15")
      val c = DriverManager.getConnection(config.jdbcUrl, props)
      try {
        val s = c.createStatement()
        try s.execute(sql) finally s.close()
      } finally c.close()
      ()
    }
    Resource.make(admin("CREATE DATABASE " + name))(_ => admin("DROP DATABASE " + name + " WITH (FORCE)")).flatMap { _ =>
      val config = databaseConfig
      JdbcDatabase.resource(config.copy(jdbcUrl = config.jdbcUrl.take(config.jdbcUrl.lastIndexOf('/') + 1) + name))
    }
  }
}

trait RepositoryAdapter {
  def label: String
  def resource: Resource[IO, ItemRepository]
}
object MemoryAdapter extends RepositoryAdapter {
  val label = "memory"
  def resource: Resource[IO, ItemRepository] = Resource.eval(IO(new MemoryItemRepository))
}
object PostgresAdapter extends RepositoryAdapter {
  val label = "postgres"
  def resource: Resource[IO, ItemRepository] = TestSupport.initializedDatabase.map(new PostgresItemRepository(_))
}

abstract class ContractSuite extends munit.FunSuite {
  override val munitTimeout = 60.seconds
  def run[A](program: IO[A]): A = program.unsafeRunSync()
  def expectFault[A](program: IO[A], code: String, revision: Option[Long] = None): IO[Fault] = program.attempt.map {
    case Left(f: Fault) => assertEquals(f.code, code); assertEquals(f.currentRevision, revision); f
    case Left(other) => fail("expected typed " + code + ", got " + other.getClass.getName)
    case Right(_) => fail("expected typed " + code + ", operation succeeded")
  }
}
