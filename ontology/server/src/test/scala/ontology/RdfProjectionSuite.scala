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
  test("binding work context and full selection history survive projection and traversal") { check { rdf =>
    val base = sample("s")
    val id = UUID.randomUUID()
    val definition = base.definitions.head.ref
    val ops = List(
      Operation.Bind("binding", Target.Exact(definition), Nil, "declared-work-context"),
      Operation.SelectBinding("selected", Target.Created("binding"), true, "Selected context", List(Target.Exact(definition))),
      Operation.SelectBinding("retired", Target.Created("binding"), false, "Retired context, not cancelled work", List(Target.Exact(definition))))
    val graph = new AdmissionEngine().apply(base, ApplyRequest("s", id, base.generation, ops), Admission(Actor("agent", ActorKind.Agent), Actor("host", ActorKind.Service), id, "now")).snapshot
    for {
      _ <- rdf.publish(graph)
      restored <- rdf.snapshot("s", graph.generation)
      _ = assertEquals(restored, graph)
      linked <- rdf.subjects("s", graph.generation, "binding", graph.bindings.head.ref)
      _ = assertEquals(linked, graph.selections.map(_.ref))
      bad <- rdf.publish(graph.copy(generation = graph.generation + 1L, selections = graph.selections.map(_.copy(scope = "other")))).attempt
      _ = assertEquals(bad.left.toOption.collect { case f: Fault => f.code }, Some("scope"))
    } yield ()
  } }
  test("assessment use and immutable gate witnesses survive projection and exact traversal") { check { rdf =>
    val graph = AssessmentFixture.snapshot("s")
    val use = graph.relations.find(_.kind == RelationKind.UsesAssessment).get
    val requirement = use.detail.asInstanceOf[RelationDetail.AssessmentUse].requirement
    val event = graph.events.head
    for {
      _ <- rdf.publish(graph)
      restored <- rdf.snapshot("s", graph.generation)
      _ = assertEquals(restored, graph)
      requirements <- rdf.subjects("s", graph.generation, "requirement", requirement)
      _ = assertEquals(requirements, List(use.ref))
      gates <- rdf.subjects("s", graph.generation, "gateBasis", use.ref)
      _ = assertEquals(gates, List(event.ref))
      _ = assert(event.gateBasis.references.contains(use.ref))
    } yield ()
  } }
  test("captured frontier is projected separately from maintained coverage") { check { rdf =>
    val context = CaptureContext("synthetic-session", None, None, LineageStatus.Unknown, "synthetic-branch", UUID.randomUUID())
    val request = IngestRequest("s", UUID.randomUUID(), UUID.randomUUID(), context, EventOrigin.UserMessage, CaptureMetadata("synthetic-entry", None, None, SourceRepresentation.Text, Nil, Nil), "Synthetic source", Observation.None())
    val principal = Principal("fixture", Actor("fixture-account", ActorKind.Human), Set("s"), Set(Capability.Capture))
    val graph = new CaptureEngine().apply(Graph.empty("s"), Nil, 0L, request, principal, Actor("fixture-host", ActorKind.Service), "fixture").snapshot
    for {
      _ <- rdf.publish(graph)
      restored <- rdf.snapshot("s", graph.generation)
      _ = assertEquals(restored.sourceFrontier, 1L)
      _ = assertEquals(restored.coveredFrontier, 0L)
      _ = assertEquals(restored, graph)
      invalid <- rdf.publish(graph.copy(generation = graph.generation + 1L, coveredFrontier = 2L)).attempt
      _ = assertEquals(invalid.left.toOption.collect { case f: Fault => f.code }, Some("corrupt"))
    } yield ()
  } }
  test("same revision is idempotent, changed bytes conflict, old revisions cannot regress head") { check { rdf =>
    val first = sample("s"); val next = first.copy(generation = 2L)
    for {
      _ <- rdf.publish(first)
      same <- rdf.publish(first)
      _ = assertEquals(same, 1L)
      bad <- rdf.publish(first.copy(coveredFrontier = 9L, sourceFrontier = 9L)).attempt
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
