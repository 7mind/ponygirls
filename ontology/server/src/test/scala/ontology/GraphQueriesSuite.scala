package ontology

import cats.effect.IO
import cats.effect.unsafe.IORuntime
import ontology.api.*
import ontology.domain.*
import java.util.UUID
import java.nio.charset.StandardCharsets.UTF_8
import munit.FunSuite

final class GraphQueriesSuite extends FunSuite {
  private val runtime = IORuntime.builder().build()
  override def afterAll(): Unit = runtime.shutdown()
  private val reader = Principal("reader", Actor("r", ActorKind.Agent), Set("a", "b"), Set(Capability.Read))
  private def service(repo: GraphRepository, bytes: Int): GraphQueries = new GraphQueries(repo, new CursorSigner(Array.fill[Byte](32)(7)), QueryLimits(100, 64, bytes, 2048))
  private def change(repo: GraphRepository, generation: Long, operations: List[Operation]): IO[ApplyResult] = {
    val id = UUID.randomUUID()
    repo.apply(ApplyRequest("a", id, generation, operations), Admission(Actor("writer", ActorKind.Agent), Actor("host", ActorKind.Service), id, "now"))
  }
  private def node(alias: String, text: String): Operation = Operation.Create(alias, ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), ontology.TestAuthoring.content(Content.Statement(text, Modality.Assertion)), Nil)
  private def check(io: IO[Unit]): Unit = io.unsafeRunSync()(using runtime)
  test("history pagination preserves every exact reference without duplicates") {
    val repo = new MemoryGraphRepository(new AdmissionEngine); val queries = service(repo, 16384)
    val request = ReadRequest("a", ReadView.History, Nil, None, 1)
    def all(cursor: Option[String], accumulated: List[GraphRecord]): IO[List[GraphRecord]] = queries.read(reader, request.copy(cursor = cursor)).flatMap { page =>
      assertEquals(page.generation, 1L)
      page.cursor match { case None => IO.pure(accumulated ++ page.records); case more => all(more, accumulated ++ page.records) }
    }
    check(for {
      _ <- change(repo, 0L, List(node("a", "A"), node("b", "B"), node("c", "C")))
      records <- all(None, Nil)
      snapshot <- repo.read("a")
      _ = assertEquals(records.map(Graph.recordRef).toSet, Graph.records(snapshot).map(Graph.recordRef).toSet)
      _ = assertEquals(records.distinct.size, records.size)
    } yield ())
  }
  test("cursors reject changed arguments, forgery and stale generations") {
    val repo = new MemoryGraphRepository(new AdmissionEngine); val queries = service(repo, 16384)
    val request = ReadRequest("a", ReadView.History, Nil, None, 1)
    check(for {
      _ <- change(repo, 0L, List(node("a", "A"), node("b", "B")))
      first <- queries.read(reader, request)
      cursor = first.cursor.get
      changed <- queries.read(reader, request.copy(cursor = Some(cursor), limit = 2)).attempt
      forged <- queries.read(reader, request.copy(cursor = Some("x" + cursor))).attempt
      otherScope <- queries.read(reader, request.copy(scope = "b", cursor = Some(cursor))).attempt
      _ = assert(List(changed, forged, otherScope).forall(_.left.toOption.exists { case f: Fault => f.code == "cursor"; case _ => false }))
      _ <- change(repo, 1L, List(node("c", "C")))
      stale <- queries.read(reader, request.copy(cursor = Some(cursor))).attempt
      _ = assertEquals(stale.left.toOption.collect { case f: Fault => f.code }, Some("stale-cursor"))
    } yield ())
  }
  test("scope authorization precedes discovery") {
    val repo = new MemoryGraphRepository(new AdmissionEngine); val queries = service(repo, 16384)
    check(queries.find(reader, FindRequest("not-granted", None, "", None, 1)).attempt.map(result => assertEquals(result.left.toOption.collect { case f: Fault => f.code }, Some("forbidden"))))
  }
  test("find is literal text, not a hidden expression language") {
    val repo = new MemoryGraphRepository(new AdmissionEngine); val queries = service(repo, 16384)
    check(for {
      _ <- change(repo, 0L, List(node("a", "A OR B"), node("b", "AB")))
      found <- queries.find(reader, FindRequest("a", Some(DefinitionKind.Statement), " OR ", None, 10))
      _ = assertEquals(found.items.map(_.text), List("A OR B"))
    } yield ())
  }
  test("current view excludes progress against a superseded definition") {
    val repo = new MemoryGraphRepository(new AdmissionEngine); val queries = service(repo, 16384)
    val task = Content.Task("Original", Acceptance(List("accepted behavior"), None), Execution.Delegated)
    check(for {
      initial <- change(repo, 0L, List(Operation.Create("t", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), ontology.TestAuthoring.content(task), Nil), Operation.Bind("b", Target.Created("t"), Nil), Operation.State("e", Target.Created("b"), None, Phase.Active, None, None, Nil, "")))
      original = initial.created.find(_.alias == "t").get.ref
      before <- queries.read(reader, ReadRequest("a", ReadView.Current, Nil, None, 100))
      _ = assertEquals(before.records.collect { case GraphRecord.Progress(v) => v }.size, 1)
      _ <- change(repo, 1L, List(Operation.Revise("v2", original, ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), ontology.TestAuthoring.content(task.copy(text = "Changed")), Standing.Active, List(Target.Exact(original)), "Changed contract")))
      current <- queries.read(reader, ReadRequest("a", ReadView.Current, Nil, None, 100))
      _ = assertEquals(current.records.collect { case GraphRecord.Progress(v) => v }.size, 0)
      historical <- queries.read(reader, ReadRequest("a", ReadView.History, Nil, None, 100))
      _ = assertEquals(historical.records.collect { case GraphRecord.Progress(v) => v }.size, 1)
    } yield ())
  }
  test("current progress requires current governing context as well as current definition") {
    val repo = new MemoryGraphRepository(new AdmissionEngine); val queries = service(repo, 16384)
    val task = Content.Task("Work", Acceptance(List("deliver"), None), Execution.Delegated)
    check(for {
      initial <- change(repo, 0L, List(Operation.Create("t", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), ontology.TestAuthoring.content(task), Nil), Operation.Create("o", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), ontology.TestAuthoring.content(Content.Outcome("Output", Acceptance(List("matches"), None), Force.Required)), Nil), Operation.Relate("r", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), RelationKind.PlannedOutput, List(Target.Created("t")), List(Target.Created("o")), ontology.TestAuthoring.detail(RelationDetail.Empty()), "Expected output"), Operation.Bind("b", Target.Created("t"), List(Target.Created("r"))), Operation.State("e", Target.Created("b"), None, Phase.Active, None, None, Nil, "")))
      graph <- repo.read("a")
      relation = graph.relations.head
      before <- queries.read(reader, ReadRequest("a", ReadView.Current, Nil, None, 100))
      _ = assertEquals(before.records.collect { case GraphRecord.Progress(v) => v }.size, 1)
      _ <- change(repo, 1L, List(Operation.ReviseRelation("withdraw", relation.ref, ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), relation.sources.map(Target.Exact(_)), relation.targets.map(Target.Exact(_)), ontology.TestAuthoring.detail(relation.detail), "Old plan no longer selected", Standing.Withdrawn)))
      current <- queries.read(reader, ReadRequest("a", ReadView.Current, Nil, None, 100))
      _ = assertEquals(current.records.collect { case GraphRecord.Progress(v) => v }.size, 0)
      history <- queries.read(reader, ReadRequest("a", ReadView.History, Nil, None, 100))
      _ = assertEquals(history.records.collect { case GraphRecord.Progress(v) => v }.size, 1)
    } yield ())
  }
  test("unknown definition kind is rejected instead of looking like an empty catalog") {
    val json = io.circe.Json.obj("scope" -> io.circe.Json.fromString("a"), "kind" -> io.circe.Json.fromString("typo-kind"), "query" -> io.circe.Json.fromString(""), "cursor" -> io.circe.Json.Null, "limit" -> io.circe.Json.fromInt(1))
    assertEquals(intercept[Fault](Wire.decode(FindRequest.codecJson, json)).code, "bad-envelope")
  }
  test("page bytes are bounded and oversized records are not silently truncated") {
    val repo = new MemoryGraphRepository(new AdmissionEngine); val queries = service(repo, 4096)
    check(for {
      _ <- change(repo, 0L, (0 until 10).toList.map(i => node("n" + i, "x" * 600)))
      page <- queries.read(reader, ReadRequest("a", ReadView.History, Nil, None, 100))
      _ = assert(Wire.encode(ReadResult.codecJson, page).noSpaces.getBytes(UTF_8).length <= 4096)
      _ = assert(page.cursor.nonEmpty)
      _ <- change(repo, 1L, List(node("large", "large" + ("x" * 5000))))
      tooLarge <- queries.find(reader, FindRequest("a", None, "large", None, 100)).attempt
      _ = assertEquals(tooLarge.left.toOption.collect { case f: Fault => f.code }, Some("record-too-large"))
    } yield ())
  }
}
