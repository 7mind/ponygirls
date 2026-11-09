package rites

import java.nio.file.Files

final class PostgresCoordinatorTest extends munit.FunSuite {
  private val postgres = for { url <- sys.env.get("RITES_TEST_JDBC_URL"); user <- sys.env.get("RITES_TEST_DATABASE_USER"); password <- sys.env.get("RITES_TEST_DATABASE_PASSWORD") } yield (url, user, password)
  private def config = StoreFixture.config(Files.createTempDirectory("rites-coordinator"), postgres)
  private def start(store: RitesStore): Unit = store.acquireCoordinator()
  private def clean(): Unit = {
    val store = new PostgresStore(config); store.initialize()
    val connection = java.sql.DriverManager.getConnection(postgres.get._1, postgres.get._2, postgres.get._3)
    try scala.util.Using.resource(connection.createStatement())(_.execute("TRUNCATE rt_repositories,rt_credentials,rt_users,rt_runs,rt_rites,rt_sessions,rt_publication_predecessors CASCADE"))
    finally connection.close(); store.close()
  }
  test("a second coordinator for the same database is refused before job or token work") {
    assume(postgres.nonEmpty, "owned PostgreSQL required"); clean()
    val first = new PostgresStore(config); start(first)
    val second = new PostgresStore(config)
    try assertEquals(intercept[DomainError](start(second)).code, "coordinator-already-active") finally { second.close(); first.close() }
  }
  test("loss of the lease connection fails old service closed and permits a new owner") {
    assume(postgres.nonEmpty, "owned PostgreSQL required"); clean()
    val first = new PostgresStore(config); start(first); val backend = first.coordinatorBackendId.get
    val admin = java.sql.DriverManager.getConnection(postgres.get._1, postgres.get._2, postgres.get._3)
    try {
      val terminated = scala.util.Using.resource(admin.prepareStatement("SELECT pg_terminate_backend(?)")) { statement => statement.setInt(1, backend); scala.util.Using.resource(statement.executeQuery()) { result => result.next(); result.getBoolean(1) } }
      assert(terminated)
      val error = intercept[DomainError](first.credentials(Identity("owner", "owner", "invalid-session"))); assertEquals(error.code, "coordinator-lost")
      val second = new PostgresStore(config)
      try start(second) finally { second.close(); first.close() }
    } finally admin.close()
  }
  test("normal lifecycle close releases coordinator ownership") {
    assume(postgres.nonEmpty, "owned PostgreSQL required"); clean()
    val first = new PostgresStore(config); start(first); first.close()
    val second = new PostgresStore(config); try start(second) finally second.close()
  }
}
