package rites

import java.nio.file.Files

final class PostgresStoreContract extends StoreContract {
  private val root = Files.createTempDirectory("rites-postgres-contract")
  private val selected = for {
    url <- sys.env.get("RITES_TEST_JDBC_URL"); user <- sys.env.get("RITES_TEST_DATABASE_USER"); password <- sys.env.get("RITES_TEST_DATABASE_PASSWORD")
  } yield (url, user, password)
  private val config = StoreFixture.config(root, selected)
  override def beforeEach(context: munit.BeforeEach): Unit = {
    assume(selected.nonEmpty, "RITES_TEST_JDBC_URL/RITES_TEST_DATABASE_USER/PASSWORD required for Good-Communication contract")
    val store = new PostgresStore(config); store.initialize()
    val connection = java.sql.DriverManager.getConnection(selected.get._1, selected.get._2, selected.get._3)
    try scala.util.Using.resource(connection.createStatement())(_.execute("TRUNCATE rt_repositories,rt_credentials,rt_users,rt_runs,rt_rites,rt_sessions,rt_publication_predecessors CASCADE"))
    finally connection.close()
    store.initialize(); store.close()
  }
  protected def newStore: RitesStore = {
    assume(selected.nonEmpty, "RITES_TEST_JDBC_URL/RITES_TEST_DATABASE_USER/PASSWORD required for Good-Communication contract")
    val store = new PostgresStore(config); store.initialize(); store
  }
}
