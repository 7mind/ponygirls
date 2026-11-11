package ontology

import cats.effect.{IO, Resource}
import cats.effect.unsafe.IORuntime
import munit.FunSuite
import ontology.api.*
import ontology.domain.*
import io.circe.Json
import java.util.UUID

abstract class BindingSelectionContract extends FunSuite {
  protected def repository: Resource[IO, GraphRepository]
  private val runtime = IORuntime.builder().build()
  override def afterAll(): Unit = runtime.shutdown()
  private val actor = Actor("fixture-author", ActorKind.Agent)
  private def json(value: String): Json = io.circe.parser.parse(value).toOption.get
  private def created(alias: String): Json = Wire.encode(Target.codecJson, Target.Created(alias))
  private def exact(ref: Ref): Json = Wire.encode(Target.codecJson, Target.Exact(ref))
  private def task(alias: String): Json = Wire.encode(Operation.codecJson, Operation.Create(alias, ApplicabilityInput.Unresolved("Fixture does not establish semantic applicability", Nil, Nil), ContentInput.Task("Work", AcceptanceInput(List("observable check"), None), Execution.Delegated), Nil))
  private def binding(alias: String, definition: Json, context: String): Json = json(s"""{"Bind":{"alias":"$alias","definition":$definition,"context":[],"workContext":"$context"}}""")
  private def selection(alias: String, binding: Json, selected: Boolean, basis: Json): Json = json(s"""{"SelectBinding":{"alias":"$alias","binding":$binding,"selected":$selected,"reason":"Explicit fixture selection","basis":[$basis]}}""")
  private def state(alias: String, binding: Json, phase: Phase, previous: Option[Ref]): Json = Wire.encode(Operation.codecJson, Operation.State(alias, Wire.decode(Target.codecJson, binding), previous, phase, if (phase == Phase.Completed) Some(Resolution.NotFulfilled) else None, Some("Reported fixture state"), Nil, "Not independently verified"))
  private def ref(result: ApplyResult, alias: String): Ref = result.created.find(_.alias == alias).get.ref

  private final class Fixture(val repository: GraphRepository) {
    val scope = "selection-fixture-" + UUID.randomUUID()
    val principal = Principal("fixture", actor, Set(scope), Set(Capability.Read, Capability.Mutate))
    val queries = new GraphQueries(repository, new CursorSigner(Array.fill[Byte](32)(1)), QueryLimits(100, 100, 1048576, 4096))
    def apply(operations: List[Json]): IO[ApplyResult] = repository.read(scope).flatMap { graph =>
      val id = UUID.randomUUID()
      val request = Wire.decode(ApplyRequest.codecJson, json(s"""{"scope":"$scope","requestId":"$id","expectedGeneration":"${graph.generation}","operations":${Json.arr(operations*)}}"""))
      repository.apply(request, Admission(actor, Actor("fixture-host", ActorKind.Service), id, "2026-11-11T00:00:00Z"))
    }
    def current: IO[ReadResult] = queries.read(principal, ReadRequest(scope, ReadView.Current, Nil, None, 100))
    def history: IO[ReadResult] = queries.read(principal, ReadRequest(scope, ReadView.History, Nil, None, 100))
  }
  private def check(run: Fixture => IO[Unit]): Unit = repository.use(value => run(new Fixture(value))).unsafeRunSync()(using runtime)
  private def contracts(result: ReadResult): Set[Ref] = result.records.collect { case GraphRecord.Contract(value) => value.ref }.toSet

  test("retaining a structurally valid binding does not select it") { check { f =>
    val unselected = Wire.encode(Operation.codecJson, Operation.Bind("b", Target.Created("t"), Nil, "fixture"))
    for {
      _ <- f.apply(List(task("t"), unselected))
      current <- f.current
      history <- f.history
      _ = assertEquals(contracts(current), Set.empty[Ref])
      _ = assertEquals(contracts(history).size, 1)
    } yield ()
  } }

  test("selection replacement and retirement are scoped and have no historical fallback") { check { f => for {
    made <- f.apply(List(task("t"), binding("a1", created("t"), "a"), binding("a2", created("t"), "a"), binding("b1", created("t"), "b"), selection("select-a", created("a1"), true, created("t")), selection("select-b", created("b1"), true, created("t"))))
    before <- f.current
    _ = assertEquals(contracts(before), Set(ref(made, "a1"), ref(made, "b1")))
    _ <- f.apply(List(selection("replace-a", exact(ref(made, "a2")), true, exact(ref(made, "t")))))
    replaced <- f.current
    _ = assertEquals(contracts(replaced), Set(ref(made, "a2"), ref(made, "b1")))
    wrong <- f.apply(List(selection("wrong-retirement", exact(ref(made, "a1")), false, exact(ref(made, "t"))))).attempt
    _ = assertEquals(wrong.left.toOption.collect { case fault: Fault => fault.code }, Some("selection"))
    _ <- f.apply(List(selection("retire-a", exact(ref(made, "a2")), false, exact(ref(made, "t")))))
    after <- f.current
    history <- f.history
    _ = assertEquals(contracts(after), Set(ref(made, "b1")))
    _ = assertEquals(contracts(history).size, 3)
  } yield () } }

  test("retirement is not cancellation and another binding inherits no completion") { check { f => for {
    made <- f.apply(List(task("t"), binding("a1", created("t"), "a"), binding("a2", created("t"), "a"), selection("select", created("a1"), true, created("t")), state("done", created("a1"), Phase.Completed, None)))
    _ <- f.apply(List(selection("replace", exact(ref(made, "a2")), true, exact(ref(made, "t")))))
    current <- f.current
    history <- f.history
    _ = assertEquals(current.records.collect { case GraphRecord.Progress(value) => value }, Nil)
    _ = assertEquals(history.records.collect { case GraphRecord.Progress(value) => value.phase }, List(Phase.Completed))
    late <- f.apply(List(state("late", exact(ref(made, "a1")), Phase.Active, Some(ref(made, "done"))))).attempt
    _ = assertEquals(late.left.toOption.collect { case fault: Fault => fault.code }, Some("unselected-context"))
  } yield () } }

  test("final transaction validation rejects retirement after an active report") { check { f => for {
    rejected <- f.apply(List(task("t"), binding("b", created("t"), "work"), selection("select", created("b"), true, created("t")), state("active", created("b"), Phase.Active, None), selection("retire", created("b"), false, created("t")))).attempt
    _ = assertEquals(rejected.left.toOption.collect { case fault: Fault => fault.code }, Some("unselected-context"))
    graph <- f.repository.read(f.scope)
    _ = assertEquals(graph, Graph.empty(f.scope))
  } yield () } }

  test("binding context inspection exposes both its selection history and replacement") { check { f => for {
    made <- f.apply(List(task("t"), binding("old", created("t"), "work"), binding("new", created("t"), "work"), selection("select-old", created("old"), true, created("t"))))
    replacement <- f.apply(List(selection("select-new", exact(ref(made, "new")), true, exact(ref(made, "t")))))
    context <- f.queries.read(f.principal, ReadRequest(f.scope, ReadView.BindingContext, List(ref(made, "old")), None, 100))
    _ = assert(context.records.exists(record => Graph.recordRef(record) == ref(made, "select-old")))
    _ = assert(context.records.exists(record => Graph.recordRef(record) == ref(replacement, "select-new")))
    _ = assert(contracts(context).contains(ref(made, "new")))
  } yield () } }

  test("unselected contracts cannot report active work but remain available as plans") { check { f => for {
    made <- f.apply(List(task("t"), binding("b", created("t"), "work")))
    rejected <- f.apply(List(state("active", exact(ref(made, "b")), Phase.Active, None))).attempt
    _ = assertEquals(rejected.left.toOption.collect { case fault: Fault => fault.code }, Some("unselected-context"))
    _ <- f.apply(List(selection("select", exact(ref(made, "b")), true, exact(ref(made, "t"))), state("planned", exact(ref(made, "b")), Phase.Planned, None)))
    current <- f.current
    _ = assertEquals(contracts(current), Set(ref(made, "b")))
    _ = assertEquals(current.records.collect { case GraphRecord.Progress(value) => value.phase }, List(Phase.Planned))
  } yield () } }
}
final class MemoryBindingSelectionSuite extends BindingSelectionContract {
  protected def repository: Resource[IO, GraphRepository] = Resource.eval(IO(new MemoryGraphRepository(new AdmissionEngine)))
}
final class PostgresBindingSelectionSuite extends BindingSelectionContract {
  protected def repository: Resource[IO, GraphRepository] = {
    import ponygirls.runtime.{JdbcConfig, JdbcDatabase, JdbcLimits}
    import java.nio.file.Path
    import scala.concurrent.duration.*
    def required(name: String): String = sys.env.getOrElse(name, throw new IllegalStateException(s"$name required: run ontology/scripts/test-postgres.sh"))
    val config = JdbcConfig(required("ONTOLOGY_TEST_JDBC_URL"), "postgres", Path.of(required("ONTOLOGY_TEST_PASSWORD_FILE")),
      JdbcLimits(4, 16, 10.seconds, 10.seconds, 30.seconds, 35.seconds, 60.seconds, 35.seconds))
    JdbcDatabase.resource(config).evalMap { db =>
      val store = new PostgresGraphRepository(db, new AdmissionEngine)
      store.initialize.as(store: GraphRepository)
    }
  }
}
