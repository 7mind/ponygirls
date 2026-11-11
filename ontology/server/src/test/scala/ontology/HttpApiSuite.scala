package ontology

import cats.effect.IO
import cats.effect.unsafe.IORuntime
import cats.syntax.all.*
import io.circe.Json
import munit.FunSuite
import ontology.api.*
import ontology.domain.Fault
import ontology.http.{HttpApi, Mcp, ToolSchemas}
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
    def read(p: Principal, r: ReadRequest): IO[ReadResult] = IO { p.require(r.scope, Capability.Read); reads += 1; ReadResult(r.scope, 0L, Nil, None) }
    def find(p: Principal, r: FindRequest): IO[FindResult] = unused
    def scopes(p: Principal): IO[ScopesResult] = IO.pure(ScopesResult(Nil))
    def sources(p: Principal, r: SourceRequest): IO[SourceResult] = unused
    def status(p: Principal, r: ScopeRequest): IO[CurationStatus] = unused
    def present(p: Principal, r: PresentRequest): IO[Presentation] = unused
    def judge(p: Principal, r: JudgmentRequest): IO[Judgment] = unused
    def judgments(p: Principal, r: ScopeRequest): IO[JudgmentsResult] = unused
    def apply(p: Principal, r: ApplyRequest): IO[ApplyResult] = unused
    def ingest(p: Principal, r: IngestRequest): IO[IngestResult] = unused
    def capsule(p: Principal, r: CapsuleRequest): IO[Capsule] = unused
    def delivery(p: Principal, r: DeliveryRequest): IO[DeliveryReceipt] = unused
  }
  private def application(service: Service): HttpApp[IO] = {
    val schemas = new ToolSchemas {
      def find: Json = Json.obj("type" -> Json.fromString("object"))
      def read: Json = Json.obj("type" -> Json.fromString("object"))
      def apply: Json = Json.obj("type" -> Json.fromString("object"))
    }
    new HttpApi(authentication(), service, new Mcp(service, schemas), None, logstage.IzLogger()).routes.orNotFound
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
  test("MCP rejects even unrelated cookies") {
    val body = Json.obj("jsonrpc" -> Json.fromString("2.0"), "id" -> Json.fromInt(1), "method" -> Json.fromString("tools/list"))
    val req = request(Method.POST, "/mcp", body, List("Bearer " + agentToken), "application/json").putHeaders(Header.Raw(CIString("Cookie"), "unrelated=value"), Header.Raw(CIString("Accept"), "application/json, text/event-stream"))
    assertEquals(run(application(new Service)(req)).status, Status.Unauthorized)
  }
}
