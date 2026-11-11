package ontology

import cats.effect.{IO, Resource}
import cats.effect.unsafe.IORuntime
import ontology.api.*
import ontology.domain.*
import ponygirls.runtime.{JdbcConfig, JdbcDatabase, JdbcLimits}
import java.nio.file.Path
import java.util.UUID
import scala.concurrent.duration.*
import scala.util.Using
import munit.FunSuite

object RepositoryReproductionDatabase {
  def resource: Resource[IO, JdbcDatabase] = {
    def required(key: String): String = sys.env.getOrElse(key, throw new IllegalStateException("Run ontology/scripts/test-postgres.sh"))
    JdbcDatabase.resource(JdbcConfig(required("ONTOLOGY_TEST_JDBC_URL"), "postgres", Path.of(required("ONTOLOGY_TEST_PASSWORD_FILE")), JdbcLimits(4, 16, 10.seconds, 10.seconds, 30.seconds, 35.seconds, 60.seconds, 35.seconds)))
  }
  def store(db: JdbcDatabase): IO[GraphRepository] = {
    val repo = new PostgresGraphRepository(db, new AdmissionEngine)
    repo.initialize.as(repo: GraphRepository)
  }
}
final class RepositoryReproductionSuite extends FunSuite {
  private val runtime = IORuntime.builder().build()
  override def afterAll(): Unit = runtime.shutdown()
  private def request(scope: String, generation: Long): ApplyRequest = ApplyRequest(scope, UUID.randomUUID(), generation, List(Operation.Create("node", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), ontology.TestAuthoring.content(Content.Statement("Bound subject", Modality.Assertion)), Nil)), None)
  private def admission(r: ApplyRequest): Admission = Admission(ontology.TestContexts.principal(r.scope, Actor("a", ActorKind.Agent)), Actor("h", ActorKind.Service), r.requestId, "now", ontology.TestContexts.trace("fixture-apply"))
  private def scope(): String = "repro-" + UUID.randomUUID()
  private def expectedFault[A](value: Either[Throwable, A], code: String): Unit = assertEquals(value.left.toOption.collect { case f: Fault => f.code }, Some(code))
  private def adapters: List[(String, Resource[IO, GraphRepository])] = List(
    "memory" -> Resource.eval(IO(new MemoryGraphRepository(new AdmissionEngine): GraphRepository)),
    "postgres" -> RepositoryReproductionDatabase.resource.evalMap(RepositoryReproductionDatabase.store)
  )
  adapters.foreach { case (name, factory) =>
    test(s"$name replay still checks the host admission/request association") {
      factory.use { repo =>
        val r = request(scope(), 0L)
        repo.apply(r, admission(r)) *> repo.apply(r, admission(r).copy(requestId = UUID.randomUUID())).attempt.map(result => expectedFault(result, "request"))
      }.unsafeRunSync()(using runtime)
    }
    test(s"$name cannot acknowledge retained but never-enqueued generation zero") {
      factory.use { repo =>
        val r = request(scope(), 0L)
        repo.apply(r, admission(r)) *> repo.acknowledgeProjection(r.scope, 0L).attempt.map(result => expectedFault(result, "not-found"))
      }.unsafeRunSync()(using runtime)
    }
  }
  List("head", "history", "outbox").foreach { boundary =>
    test(s"canonical stored snapshot must match its $boundary row identity") {
      RepositoryReproductionDatabase.resource.use { db =>
        RepositoryReproductionDatabase.store(db).flatMap { repo =>
          val a = request(scope(), 0L); val b = request(scope(), 0L)
          for {
            _ <- repo.apply(a, admission(a))
            _ <- repo.apply(b, admission(b))
            foreign <- repo.read(b.scope)
            original <- repo.read(a.scope)
            _ <- db.transaction { c =>
              val sql = if (boundary == "head") "UPDATE ontology_scopes SET snapshot = ? WHERE scope = ?" else "UPDATE ontology_revisions SET snapshot = ? WHERE scope = ? AND generation = 1"
              Using.resource(c.prepareStatement(sql)) { statement =>
                statement.setString(1, StoredJson.encode(GraphSnapshot.codecJson, foreign)); statement.setString(2, a.scope)
                assertEquals(statement.executeUpdate(), 1)
              }
            }
            result <- (boundary match {
              case "head" => repo.read(a.scope).void
              case "history" => repo.history(a.scope, 1L).void
              case "outbox" => repo.pendingProjections(100000).void
              case _ => IO.raiseError(new AssertionError("unknown test boundary"))
            }).attempt.guarantee(db.transaction { c =>
              val sql = if (boundary == "head") "UPDATE ontology_scopes SET snapshot = ? WHERE scope = ?" else "UPDATE ontology_revisions SET snapshot = ? WHERE scope = ? AND generation = 1"
              Using.resource(c.prepareStatement(sql)) { statement =>
                statement.setString(1, StoredJson.encode(GraphSnapshot.codecJson, original)); statement.setString(2, a.scope)
                assertEquals(statement.executeUpdate(), 1)
              }
            })
            _ = expectedFault(result, "corrupt")
          } yield ()
        }
      }.unsafeRunSync()(using runtime)
    }
  }
}
