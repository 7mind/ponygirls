package ontology

import cats.effect.IO
import cats.effect.unsafe.IORuntime
import cats.syntax.all.*
import io.circe.Json
import munit.FunSuite
import ontology.api.*
import ontology.domain.Fault
import ontology.http.{CompiledToolSchemas, HttpApi, Mcp}
import org.http4s.*
import org.typelevel.ci.CIString
import java.nio.charset.StandardCharsets.UTF_8
import java.nio.file.Path
import java.time.Clock
import java.util.Base64

final class HttpApiSuite extends FunSuite {
  private val runtime = IORuntime.builder().build()
  override def afterAll(): Unit = runtime.shutdown()
  private def token(n: Int): String = Base64.getUrlEncoder.withoutPadding().encodeToString(Array.fill[Byte](32)(n.toByte))
  private val agentToken = token(1)
  private val humanToken = token(2)
  private val origin = "https://ontology.example"
  private val agent = CredentialConfig("agent", Actor("worker", ActorKind.Agent), Set("owned"), Set(Capability.Read, Capability.Mutate), Path.of("/fixture/agent"))
  private val human = CredentialConfig("human", Actor("viewer", ActorKind.Human), Set("owned"), Set(Capability.Read, Capability.Review), Path.of("/fixture/human"))
  private def authentication(): Auth = new Auth(AuthConfig(origin, false, List(agent, human), 60L, 10), new CredentialDigests {
    def read(config: CredentialConfig): String = Digests.text(if (config.id == "agent") agentToken else humanToken)
  }, new RandomSessionSecrets(new java.security.SecureRandom()), Clock.systemUTC())
  private final class Service extends OntologyService {
    var reads = 0
    private def unused[A]: IO[A] = IO.raiseError(Fault("test-unexpected", "unexpected test route"))
    var calls = List.empty[ServiceCall]
    var reviews = List.empty[ReviewCall]
    def read(p: ServiceCall, r: ReadRequest): IO[ReadResult] = IO { p.principal.require(r.scope, Capability.Read); calls = calls :+ p; reads += 1; ReadResult(r.scope, 0L, Nil, None) }
    def find(p: ServiceCall, r: FindRequest): IO[FindResult] = unused
    def scopes(p: ServiceCall): IO[ScopesResult] = IO.pure(ScopesResult(Nil))
    def sources(p: ServiceCall, r: SourceRequest): IO[SourceResult] = unused
    def status(p: ServiceCall, r: ScopeRequest): IO[CurationStatus] = unused
    def present(p: ReviewCall, r: PresentRequest): IO[Presentation] = IO { reviews = reviews :+ p } *> unused
    def judge(p: ReviewCall, r: JudgmentRequest): IO[Judgment] = unused
    def judgments(p: ServiceCall, r: ScopeRequest): IO[JudgmentsResult] = unused
    def apply(p: ServiceCall, r: ApplyRequest): IO[ApplyResult] = unused
    def ingest(p: ServiceCall, r: IngestRequest): IO[IngestResult] = unused
    def capsule(p: ServiceCall, r: CapsuleRequest): IO[Capsule] = unused
    def delivery(p: ServiceCall, r: DeliveryRequest): IO[DeliveryReceipt] = unused
  }
  private def application(service: Service): HttpApp[IO] = {
    val schemas = new CompiledToolSchemas
    new HttpApi(authentication(), service, new Mcp(service, schemas), None, logstage.IzLogger(), () => java.util.UUID.randomUUID()).routes.orNotFound
  }
  private def request(method: Method, path: String, body: Json, auth: List[String], media: String): Request[IO] = {
    val headers = List(Header.Raw(CIString("Host"), "ontology.example"), Header.Raw(CIString("Origin"), origin), Header.Raw(CIString("X-Ontology-Version"), "0.1.0"), Header.Raw(CIString("Content-Type"), media)) ++ auth.map(Header.Raw(CIString("Authorization"), _))
    Request[IO](method = method, uri = Uri.unsafeFromString(path), headers = Headers(headers)).withBodyStream(fs2.Stream.emits(body.noSpaces.getBytes(UTF_8)).covary[IO])
  }
  private def run[A](value: IO[A]): A = value.unsafeRunSync()(runtime)
  private def readPayload(scope: String): Json = Wire.encode(ReadRequest.codecJson, ReadRequest(scope, ReadView.Current, Nil, None, 10))

  test("current typed read carries authenticated identity and scope") {
    val service = new Service
    val response = run(application(service)(request(Method.POST, "/api/v1/read", readPayload("owned"), List("Bearer " + agentToken), "application/json")))
    assertEquals(response.status, Status.Ok)
    assertEquals(service.reads, 1)
    val result = Wire.decode(ReadResult.codecJson, Wire.parse(run(response.body.compile.to(Array))))
    assertEquals(result.scope, "owned")
  }
  test("UTF8 JSON charset is accepted") {
    val service = new Service
    val response = run(application(service)(request(Method.POST, "/api/v1/read", readPayload("owned"), List("Bearer " + agentToken), "application/json; charset=utf-8")))
    assertEquals(response.status, Status.Ok)
    assertEquals(service.reads, 1)
  }
  test("wrong scope and caller-supplied identity cannot reach a successful read") {
    val service = new Service; val app = application(service)
    val denied = run(app(request(Method.POST, "/api/v1/read", readPayload("other"), List("Bearer " + agentToken), "application/json")))
    assertEquals(denied.status, Status.Forbidden)
    val extra = readPayload("owned").mapObject(_.add("actor", Json.fromString("viewer")))
    val malformed = run(app(request(Method.POST, "/api/v1/read", extra, List("Bearer " + agentToken), "application/json")))
    assertEquals(malformed.status, Status.BadRequest)
    assertEquals(service.reads, 0)
  }
  test("future, absent and duplicate domain-version headers are rejected") {
    val service = new Service; val app = application(service)
    val base = request(Method.POST, "/api/v1/read", readPayload("owned"), List("Bearer " + agentToken), "application/json")
    val without = base.headers.headers.filterNot(_.name == CIString("X-Ontology-Version"))
    List(List.empty[String], List("9.0.0"), List("0.1.0", "0.1.0")).foreach { versions =>
      val headers = Headers(without ++ versions.map(Header.Raw(CIString("X-Ontology-Version"), _)))
      assertEquals(run(app(base.withHeaders(headers))).status, Status.BadRequest)
    }
    assertEquals(service.reads, 0)
  }
  test("Human bearer is not a browser presentation request") {
    val body = Wire.encode(PresentRequest.codecJson, PresentRequest("owned", Nil, 0L))
    val response = run(application(new Service)(request(Method.POST, "/api/v1/present", body, List("Bearer " + humanToken), "application/json")))
    assertEquals(response.status, Status.Forbidden)
  }
  test("REST ingress creates server request identities rather than adopting client headers") {
    val service = new Service; val app = application(service)
    val supplied = java.util.UUID.randomUUID()
    val input = request(Method.POST, "/api/v1/read", readPayload("owned"), List("Bearer " + agentToken), "application/json")
      .putHeaders(Header.Raw(CIString("X-Request-ID"), supplied.toString))
    assertEquals(run(app(input)).status, Status.Ok)
    assertEquals(run(app(input)).status, Status.Ok)
    assertEquals(service.calls.size, 2)
    assert(service.calls.map(_.ingress.hostRequestId).distinct.size == 2)
    service.calls.foreach { call =>
      assert(call.ingress.hostRequestId != supplied)
      assertEquals(call.ingress.transport, RequestTransport.Bearer)
      assertEquals(call.ingress.operation, "/api/v1/read")
      assertEquals(call.principal.actor, agent.actor)
    }
  }
  test("MCP tool service calls retain revalidated bearer ingress") {
    val service = new Service
    val body = Json.obj("jsonrpc" -> Json.fromString("2.0"), "id" -> Json.fromInt(1), "method" -> Json.fromString("tools/call"),
      "params" -> Json.obj("name" -> Json.fromString("graph_read"), "arguments" -> readPayload("owned")))
    val req = request(Method.POST, "/mcp", body, List("Bearer " + agentToken), "application/json")
      .putHeaders(Header.Raw(CIString("Accept"), "application/json, text/event-stream"))
    assertEquals(run(application(service)(req)).status, Status.Ok)
    assertEquals(service.calls.size, 1)
    assertEquals(service.calls.head.ingress.transport, RequestTransport.Bearer)
    assertEquals(service.calls.head.ingress.operation, "/mcp")
  }
  test("logged-in Human presentation passes a typed cookie review call to the service") {
    val service = new Service; val app = application(service)
    val login = request(Method.POST, "/api/v1/login", Wire.encode(LoginRequest.codecJson, LoginRequest(humanToken)), Nil, "application/json")
    val session = run(app(login))
    assertEquals(session.status, Status.Ok)
    val cookie = session.headers.headers.find(_.name == CIString("Set-Cookie")).get.value.takeWhile(_ != ';')
    val present = request(Method.POST, "/api/v1/present", Wire.encode(PresentRequest.codecJson, PresentRequest("owned", Nil, 0L)), Nil, "application/json")
      .putHeaders(Header.Raw(CIString("Cookie"), cookie), Header.Raw(CIString("X-Ontology-Actor"), human.actor.id))
    val missingActor = present.withHeaders(Headers(present.headers.headers.filterNot(_.name == CIString("X-Ontology-Actor"))))
    assertEquals(run(app(missingActor)).status, Status.Forbidden)
    assertEquals(service.reviews.size, 0)
    assertEquals(run(app(present)).status, Status.BadRequest)
    assertEquals(service.reviews.size, 1)
    assertEquals(service.reviews.head.ingress.transport, RequestTransport.Cookie)
    assertEquals(service.reviews.head.principal.actor, human.actor)
    assertEquals(service.reviews.head.scope, "owned")
  }
  test("MCP rejects even unrelated cookies") {
    val body = Json.obj("jsonrpc" -> Json.fromString("2.0"), "id" -> Json.fromInt(1), "method" -> Json.fromString("tools/list"))
    val req = request(Method.POST, "/mcp", body, List("Bearer " + agentToken), "application/json").putHeaders(Header.Raw(CIString("Cookie"), "unrelated=value"), Header.Raw(CIString("Accept"), "application/json, text/event-stream"))
    assertEquals(run(application(new Service)(req)).status, Status.Unauthorized)
  }
}
