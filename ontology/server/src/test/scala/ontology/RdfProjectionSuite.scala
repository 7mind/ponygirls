package ontology

import cats.effect.{IO, Resource}
import cats.effect.unsafe.IORuntime
import ontology.api.*
import ontology.domain.*
import java.util.UUID
import java.nio.file.{Files, Path}
import munit.FunSuite
import scala.jdk.CollectionConverters.*

abstract class RdfProjectionContract extends FunSuite {
  protected def projection: Resource[IO, RdfProjection]
  private val runtime = IORuntime.builder().build()
  override def afterAll(): Unit = runtime.shutdown()
  private def check(f: RdfProjection => IO[Unit]): Unit = projection.use(f).unsafeRunSync()(using runtime)
  protected def sample(scope: String): GraphSnapshot = {
    val id = UUID.randomUUID()
    new AdmissionEngine().apply(Graph.empty(scope), ApplyRequest(scope, id, 0L, List(
      Operation.Create("a", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), ontology.TestAuthoring.content(Content.Statement("α\r\n引用 and \"quotes\"", Modality.Assertion)), Nil),
      Operation.Create("b", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), ontology.TestAuthoring.content(Content.Hypothesis("Competing proposition", "Discriminating prediction")), Nil),
      Operation.Relate("r", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), RelationKind.Challenges, List(Target.Created("a")), List(Target.Created("b")), ontology.TestAuthoring.detail(RelationDetail.Empty()), "Not a truth verdict")
    )), Admission(Actor("agent", ActorKind.Agent), Actor("host", ActorKind.Service), id, "now")).snapshot
  }
  test("empty and populated snapshots roundtrip with exact identities and literals") { check { rdf =>
    val graph = sample("s")
    for {
      _ <- rdf.publish(Graph.empty("s"))
      empty <- rdf.snapshot("s", 0L)
      _ = assertEquals(empty, Graph.empty("s"))
      _ <- rdf.publish(graph)
      restored <- rdf.snapshot("s", 1L)
      _ = assertEquals(restored, graph)
    } yield ()
  } }
  test("same revision is idempotent, changed bytes conflict, old revisions cannot regress head") { check { rdf =>
    val first = sample("s"); val next = first.copy(generation = 2L)
    for {
      _ <- rdf.publish(first)
      same <- rdf.publish(first)
      _ = assertEquals(same, 1L)
      bad <- rdf.publish(first.copy(coveredFrontier = 9L)).attempt
      _ = assertEquals(bad.left.toOption.collect { case f: Fault => f.code }, Some("projection-conflict"))
      _ <- rdf.publish(next)
      older <- rdf.publish(first)
      _ = assertEquals(older, 2L)
      current <- rdf.snapshot("s", 2L)
      _ = assertEquals(current, next)
      stale <- rdf.snapshot("s", 1L).attempt
      _ = assertEquals(stale.left.toOption.collect { case f: Fault => f.code }, Some("projection-lag"))
    } yield ()
  } }
  test("fixed RDF traversal is scope-bound and query failures are explicit") { check { rdf =>
    val graph = sample("s")
    val target = graph.relations.head.targets.head
    for {
      _ <- rdf.publish(graph)
      refs <- rdf.subjects("s", 1L, "target", target)
      _ = assertEquals(refs, List(graph.relations.head.ref))
      missing <- rdf.subjects("other", 1L, "target", target).attempt
      _ = assertEquals(missing.left.toOption.collect { case f: Fault => f.code }, Some("projection-lag"))
      invalid <- rdf.subjects("s", 1L, "SERVICE remote", target).attempt
      _ = assertEquals(invalid.left.toOption.collect { case f: Fault => f.code }, Some("query"))
    } yield ()
  } }
  test("a projected record cannot claim a different scope from its containing graph") { check { rdf =>
    val graph = sample("s")
    val foreign = graph.copy(definitions = graph.definitions.map(_.copy(scope = "other")))
    rdf.publish(foreign).attempt.map { result =>
      assertEquals(result.left.toOption.collect { case f: Fault => f.code }, Some("scope"))
    }
  } }
  test("failed projection transaction retains prior dataset and checkpoint") { check { rdf =>
    val first = sample("s")
    val bad = first.copy(generation = 2L, relations = first.relations.map(_.copy(targets = List(Ref(UUID.randomUUID(), 1)))))
    for {
      _ <- rdf.publish(first)
      failed <- rdf.publish(bad).attempt
      _ = assertEquals(failed.left.toOption.collect { case f: Fault => f.code }, Some("reference"))
      current <- rdf.snapshot("s", 1L)
      _ = assertEquals(current, first)
    } yield ()
  } }
}
final class MemoryRdfProjectionSuite extends RdfProjectionContract {
  protected def projection: Resource[IO, RdfProjection] = RdfProjection.resource(RdfStorage.Memory, 10)
}
object RdfTestDirectory {
  def resource: Resource[IO, Path] = Resource.make(IO.blocking(Files.createTempDirectory("ontology-rdf-")))(path => IO.blocking {
    val walk = Files.walk(path)
    try walk.iterator().asScala.toList.reverse.foreach(Files.delete) finally walk.close()
  })
}
final class NativeRdfProjectionSuite extends RdfProjectionContract {
  protected def projection: Resource[IO, RdfProjection] = RdfTestDirectory.resource.flatMap(path => RdfProjection.resource(RdfStorage.Native(path), 10))
}
final class NativeRdfRestartSuite extends FunSuite {
  private val runtime = IORuntime.builder().build()
  override def afterAll(): Unit = runtime.shutdown()
  test("native projection survives close and reopen") {
    RdfTestDirectory.resource.use { path =>
      RdfProjection.resource(RdfStorage.Native(path), 10).use(_.publish(Graph.empty("persisted"))) *>
        RdfProjection.resource(RdfStorage.Native(path), 10).use(_.snapshot("persisted", 0L)).map(value => assertEquals(value, Graph.empty("persisted")))
    }.unsafeRunSync()(using runtime)
  }
}
