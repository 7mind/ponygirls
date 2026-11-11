package ontology

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import io.circe.Json
import java.nio.charset.StandardCharsets.UTF_8
import java.nio.file.Path
import java.time.{Clock, Instant, ZoneOffset}
import java.util.{Base64, UUID}
import java.util.concurrent.atomic.AtomicInteger
import ontology.api.*
import ontology.domain.*
import ontology.http.{CompiledToolSchemas, HttpApi, Mcp}
import org.http4s.*
import org.typelevel.ci.CIString

abstract class OntologyServiceContract extends CurationRepositorySupport {
  private val origin = "https://ontology.example"
  private val worker = Actor("worker", ActorKind.Agent)
  private val human = Actor("reviewer", ActorKind.Human)
  private val recorder = Actor("ontology-service", ActorKind.Service)
  private def token(value: Byte): String = Base64.getUrlEncoder.withoutPadding().encodeToString(Array.fill[Byte](32)(value))
  private val workerToken = token(1)
  private val humanToken = token(2)
  private final case class Fixture(service: DefaultOntologyService, app: HttpApp[IO], rdf: RdfProjection, principal: Principal, allocated: AtomicInteger)
  private def fixture(repo: GraphRepository, scope: String): Resource[IO, Fixture] = RdfProjection.resource(RdfStorage.Memory, 10).map { rdf =>
    val agentCredential = CredentialConfig("worker", worker, Set(scope), Set(Capability.Read, Capability.Mutate, Capability.Capture), Path.of("/fixture/worker"))
    val humanCredential = CredentialConfig("human", human, Set(scope), Set(Capability.Read, Capability.Review), Path.of("/fixture/human"))
    val auth = new Auth(AuthConfig(origin, false, List(agentCredential, humanCredential), 60L, 10), new CredentialDigests {
      def read(value: CredentialConfig): String = Digests.text(if (value.id == "worker") workerToken else humanToken)
    }, new RandomSessionSecrets(new java.security.SecureRandom()), Clock.systemUTC())
    val principal = Principal("worker", worker, Set(scope), agentCredential.capabilities)
    val allocated = new AtomicInteger(0)
    val ids = IO { allocated.incrementAndGet(); UUID.randomUUID() }
    val catalog = new ScopeCatalog { def scopes(value: Principal): IO[List[String]] = IO.pure(List(scope)) }
    val service = new DefaultOntologyService(repo, new CursorSigner(Array.fill[Byte](32)(3)), QueryLimits(100, 64, 1048576, 2048),
      CapsuleStoreSettings(CapsuleSettings(Set(WorkContextKey(scope, "work")), CapsuleLimits(256, 1048576)), 4, 8), catalog,
      new LocalExactRdfReadiness(rdf), recorder, Clock.fixed(Instant.parse("2026-11-11T00:00:00Z"), ZoneOffset.UTC), ids)
    val app = new HttpApi(auth, service, new Mcp(service, new CompiledToolSchemas), None, logstage.IzLogger(), () => UUID.randomUUID()).routes.orNotFound
    Fixture(service, app, rdf, principal, allocated)
  }
  private def command(scope: String, generation: Long): ApplyRequest = ApplyRequest(scope, UUID.randomUUID(), generation, List(
    Operation.Create("claim", TestAuthoring.applicability(TestApplicability.unresolved), ContentInput.Statement("Actual service contribution", Modality.Assertion), Nil)), None)
  private def call(f: Fixture): ServiceCall = ServiceCall.internal(f.principal, "controlled-service", UUID.randomUUID())
  private def http(path: String, body: Json, bearer: Option[String]): Request[IO] = {
    val headers = List(Header.Raw(CIString("Host"), "ontology.example"), Header.Raw(CIString("Origin"), origin),
      Header.Raw(CIString("X-Ontology-Version"), "0.1.0"), Header.Raw(CIString("Content-Type"), "application/json")) ++ bearer.toList.map(value => Header.Raw(CIString("Authorization"), "Bearer " + value))
    Request[IO](method = Method.POST, uri = Uri.unsafeFromString(path), headers = Headers(headers))
      .withBodyStream(fs2.Stream.emits(body.noSpaces.getBytes(UTF_8)).covary[IO])
  }
  private def json(response: Response[IO]): IO[Json] = response.body.compile.to(Array).map(Wire.parse)

  test("actual REST and MCP command paths share primary accounting and exact replay") { check { (repo, _, scope) => fixture(repo, scope).use { f => for {
    r = command(scope, 0L)
    first <- f.app(http("/api/v1/apply", Wire.encode(ApplyRequest.codecJson, r), Some(workerToken)))
    _ = assertEquals(first.status, Status.Ok)
    body <- json(first)
    result = Wire.decode(ApplyResult.codecJson, body)
    rpc = Json.obj("jsonrpc" -> Json.fromString("2.0"), "id" -> Json.fromInt(1), "method" -> Json.fromString("tools/call"),
      "params" -> Json.obj("name" -> Json.fromString("graph_apply"), "arguments" -> Wire.encode(ApplyRequest.codecJson, r)))
    replay <- f.app(http("/mcp", rpc, Some(workerToken)).putHeaders(Header.Raw(CIString("Accept"), "application/json, text/event-stream")))
    replayBody <- json(replay)
    repeated = Wire.decode(ApplyResult.codecJson, replayBody.hcursor.downField("result").downField("structuredContent").focus.get)
    _ = assertEquals(repeated, result.copy(replayed = true))
    graph <- repo.read(scope)
    sources <- f.service.sources(call(f), SourceRequest(scope, 0L, 10))
    _ = assertEquals((graph.generation, graph.sourceFrontier), (1L, 1L))
    _ = assertEquals(sources.events.size, 1)
    _ = assertEquals(sources.events.head.origin, EventOrigin.GraphCommand)
    receipt <- repo.input(scope, Ref(sources.events.head.provenance.input, 1))
    _ = assertEquals(receipt.ingress.transport, RequestTransport.Bearer)
    _ = assertEquals(receipt.ingress.operation, "/api/v1/apply")
    _ = assertEquals(receipt.recorder, recorder)
    read <- f.service.read(call(f), ReadRequest(scope, ReadView.History, List(receipt.ref), None, 10))
    _ = assertEquals(read.records, List(GraphRecord.Input(receipt)))
    found <- f.service.find(call(f), FindRequest(scope, Some(DefinitionKind.Statement), "Actual service", None, 10))
    _ = assertEquals(found.items.map(_.ref), result.created.map(_.ref))
  } yield () } } }

  test("service capability and review-scope rejection precede ID allocation and mutations") { check { (repo, _, scope) => fixture(repo, scope).use { f => for {
    readOnly = ServiceCall.internal(f.principal.copy(capabilities = Set(Capability.Read)), "denied-apply", UUID.randomUUID())
    denied <- f.service.apply(readOnly, command(scope, 0L)).attempt
    _ = fault(denied, "forbidden")
    noRead = ServiceCall.internal(f.principal.copy(capabilities = Set(Capability.Mutate)), "denied-capsule", UUID.randomUUID())
    capsule <- f.service.capsule(noRead, CapsuleRequest(scope, UUID.randomUUID(), "work", None, 0L, None)).attempt
    _ = fault(capsule, "forbidden")
    reviewPrincipal = Principal("reviewer", human, Set(scope, scope + "-other"), Set(Capability.Read, Capability.Review))
    review = ReviewCall.from(ServiceCall.authenticated(Authenticated(reviewPrincipal, true, "fixture", Some("fixture")), "review", UUID.randomUUID()), scope)
    wrongScope <- f.service.present(review, PresentRequest(scope + "-other", Nil, 0L)).attempt
    _ = fault(wrongScope, "forbidden")
    _ = assertEquals(f.allocated.get(), 0)
    graph <- repo.read(scope)
    _ = assertEquals(graph, Graph.empty(scope))
  } yield () } } }

  test("scope summaries use an exact local RDF probe rather than global acknowledgment") { check { (repo, _, scope) => fixture(repo, scope).use { f => for {
    empty <- f.service.scopes(call(f))
    _ = assertEquals(empty.items.map(_.rdfGeneration), List(None))
    _ <- f.service.apply(call(f), command(scope, 0L))
    graph <- repo.read(scope)
    _ <- repo.acknowledgeProjection(scope, graph.generation)
    absent <- f.service.scopes(call(f))
    _ = assertEquals(absent.items.head.rdfGeneration, None)
    _ = assertEquals(absent.items.head.generation, graph.generation)
    _ <- f.rdf.publish(graph)
    exact <- f.service.scopes(call(f))
    _ = assertEquals(exact.items.head.rdfGeneration, Some(graph.generation))
    _ = assertEquals((exact.items.head.frontier, exact.items.head.coveredFrontier), (graph.sourceFrontier, graph.coveredFrontier))
    after <- repo.read(scope)
    _ = assertEquals(after, graph)
  } yield () } } }

  test("actual cookie review routes retain generic Human action without inventing adoption") { check { (repo, _, scope) => fixture(repo, scope).use { f => for {
    input = command(scope, 0L).copy(operations = List(Operation.Create("question", TestAuthoring.applicability(TestApplicability.unresolved),
      ContentInput.Question("Which alternative?", List("A", "B"), None, Escalation.Unresolved), Nil)))
    created <- f.service.apply(call(f), input)
    before <- repo.read(scope)
    login <- f.app(http("/api/v1/login", Wire.encode(LoginRequest.codecJson, LoginRequest(humanToken)), None))
    _ = assertEquals(login.status, Status.Ok)
    cookie = login.headers.headers.find(_.name == CIString("Set-Cookie")).get.value.takeWhile(_ != ';')
    presentRequest = PresentRequest(scope, created.created.map(_.ref), before.generation)
    bearer <- f.app(http("/api/v1/present", Wire.encode(PresentRequest.codecJson, presentRequest), Some(humanToken)))
    _ = assertEquals(bearer.status, Status.Forbidden)
    presentationResponse <- f.app(http("/api/v1/present", Wire.encode(PresentRequest.codecJson, presentRequest), None)
      .putHeaders(Header.Raw(CIString("Cookie"), cookie), Header.Raw(CIString("X-Ontology-Actor"), human.id)))
    _ = assertEquals(presentationResponse.status, Status.Ok)
    presentationBody <- json(presentationResponse)
    presentation = Wire.decode(Presentation.codecJson, presentationBody)
    prepared <- repo.read(scope)
    _ = assertEquals(prepared, before)
    judgmentRequest = JudgmentRequest(scope, UUID.randomUUID(), presentation.id, ReviewAction.Review(JudgmentKind.Accept), "Controlled account action")
    judgmentResponse <- f.app(http("/api/v1/judge", Wire.encode(JudgmentRequest.codecJson, judgmentRequest), None)
      .putHeaders(Header.Raw(CIString("Cookie"), cookie), Header.Raw(CIString("X-Ontology-Actor"), human.id)))
    _ = assertEquals(judgmentResponse.status, Status.Ok)
    judgmentBody <- json(judgmentResponse)
    judgment = Wire.decode(Judgment.codecJson, judgmentBody)
    stored <- f.service.judgments(call(f), ScopeRequest(scope))
    _ = assertEquals(stored.items, List(judgment))
    graph <- repo.read(scope)
    _ = assertEquals(judgment.actor, human)
    _ = assertEquals(graph.sourceFrontier, before.sourceFrontier + 1L)
    _ = assertEquals(graph.relations, Nil)
    _ = assertEquals(graph.events, Nil)
  } yield () } } }

  test("actual capsule and delivery routes preserve a graph-free G0 ledger") { check { (repo, _, scope) => fixture(repo, scope).use { f => for {
    input = CapsuleRequest(scope, UUID.randomUUID(), "work", None, 0L, None)
    response <- f.app(http("/api/v1/capsule", Wire.encode(CapsuleRequest.codecJson, input), Some(workerToken)))
    _ = assertEquals(response.status, Status.Ok)
    body <- json(response)
    capsule = Wire.decode(Capsule.codecJson, body)
    report = DeliveryRequest(scope, UUID.randomUUID(), capsule.id, capsule.payloadDigest, "work", None, DeliveryBoundary.ClientContext, None, None)
    delivered <- f.app(http("/api/v1/delivery", Wire.encode(DeliveryRequest.codecJson, report), Some(workerToken)))
    _ = assertEquals(delivered.status, Status.Ok)
    deliveryBody <- json(delivered)
    receipt = Wire.decode(DeliveryReceipt.codecJson, deliveryBody)
    _ = assertEquals(receipt.owner, worker)
    _ = assertEquals(receipt.cutComparison, DeliveryCutComparison.SameGraphAndCoverage)
    graph <- repo.read(scope)
    _ = assertEquals(graph, Graph.empty(scope))
  } yield () } } }
}
final class MemoryOntologyServiceSuite extends OntologyServiceContract {
  protected def repository(settings: CurationStoreSettings): Resource[IO, GraphRepository] = Resource.eval(IO(new MemoryGraphRepository(new AdmissionEngine, TestReview.domain, settings, Clock.systemUTC())))
}
final class PostgresOntologyServiceSuite extends OntologyServiceContract {
  protected def repository(settings: CurationStoreSettings): Resource[IO, GraphRepository] = RepositoryReproductionDatabase.resource.evalMap { db =>
    val repo = new PostgresGraphRepository(db, new AdmissionEngine, TestReview.domain, settings)
    repo.initialize.as(repo: GraphRepository)
  }
}
