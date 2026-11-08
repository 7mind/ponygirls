package rites

import java.nio.file.Files
import java.time.Instant
import java.util.UUID
import java.util.concurrent.{Callable, CountDownLatch, Executors, TimeUnit}
import rites.api.*

final class PostgresAdmissionTest extends munit.FunSuite {
  test("cross-user manual admissions share the same bounded queue serialization") {
    val selected = for { url <- sys.env.get("RITES_TEST_JDBC_URL"); user <- sys.env.get("RITES_TEST_DATABASE_USER"); password <- sys.env.get("RITES_TEST_DATABASE_PASSWORD") } yield (url, user, password)
    assume(selected.nonEmpty, "owned PostgreSQL required")
    val root = Files.createTempDirectory("rites-pg-admission")
    val config = StoreFixture.config(root, selected).copy(scheduler = SchedulerConfig(100, 1, 2, 30))
    val seed = new PostgresStore(config); seed.initialize()
    val admin = java.sql.DriverManager.getConnection(selected.get._1, selected.get._2, selected.get._3)
    try {
      scala.util.Using.resource(admin.createStatement())(_.execute("TRUNCATE rt_repositories,rt_credentials,rt_users,rt_runs,rt_rites,rt_sessions,rt_publication_predecessors CASCADE")); seed.initialize()
      def configuredStore(user: String, repositoryId: String): (RitesStore, Identity, ManualRunRequest) = {
        val store = new PostgresStore(config); val identity = store.login(user, StoreFixture.plaintext, 3600)._1
        val request = SaveCredentialRequest(None, "fixture", ForgeKind.Gitlab, "git.example.invalid", "fixture-secret", 0, CredentialMode.Token, None, None, None)
        val credential = store.saveCredential(identity, request, (owner, id, kind, host, _) => EncryptedPair(StoreFixture.vault.encrypt(owner, id, kind.toString, host, request.secret), None))
        store.saveRepository(identity, SaveRepositoryRequest(repositoryId, ForgeKind.Gitlab, "git.example.invalid", "group/project", "main", credential.id, 0))
        store.saveRite(identity, SaveRiteRequest(repositoryId, "site", "* * * * *", "prompt.md", "model", true, 0), _ == "model")
        (store, identity, ManualRunRequest(repositoryId, "site", UUID.randomUUID()))
      }
      val first = configuredStore("owner", "queue-first"); val second = configuredStore("editor", "queue-second")
      admin.setAutoCommit(false); scala.util.Using.resource(admin.createStatement())(_.execute("LOCK TABLE rt_runs IN SHARE MODE"))
      val ready = new CountDownLatch(2); val pool = Executors.newFixedThreadPool(2)
      def admission(store: RitesStore, identity: Identity, request: ManualRunRequest): Callable[Either[DomainError, RunAdmission]] = new Callable[Either[DomainError, RunAdmission]] {
        def call(): Either[DomainError, RunAdmission] = { ready.countDown(); try Right(store.manualRun(identity, request)) catch { case error: DomainError => Left(error) } }
      }
      val futureOne = pool.submit(admission(first._1, first._2, first._3)); val futureTwo = pool.submit(admission(second._1, second._2, second._3)); assert(ready.await(10, TimeUnit.SECONDS))
      Thread.sleep(500); assert(!futureOne.isDone && !futureTwo.isDone); admin.commit()
      val results = List(futureOne.get(30, TimeUnit.SECONDS), futureTwo.get(30, TimeUnit.SECONDS)); pool.shutdownNow(); first._1.close(); second._1.close()
      assertEquals(results.count(_.exists(_.admitted)), 1); assert(results.exists(_.left.exists(_.code == "unavailable")))
      val active = scala.util.Using.resource(admin.prepareStatement("SELECT count(*) FROM rt_runs WHERE state IN('Queued','Running')")) { statement => scala.util.Using.resource(statement.executeQuery()) { result => result.next(); result.getInt(1) } }
      assertEquals(active, 1)
    } finally { if (!admin.getAutoCommit) admin.rollback(); admin.close(); seed.close() }
  }
}
