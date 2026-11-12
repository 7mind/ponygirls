package ontology

import cats.effect.{IO, Resource}
import cats.effect.unsafe.IORuntime
import cats.syntax.all.*
import io.circe.Json
import java.nio.charset.StandardCharsets.UTF_8
import java.util.UUID
import munit.FunSuite
import ontology.api.*
import ontology.domain.*
import org.http4s.*
import org.http4s.client.Client
import org.http4s.ember.client.EmberClientBuilder
import org.typelevel.ci.CIString
import scala.concurrent.duration.*

final class MainRuntimeSuite extends FunSuite {
  private val runtime = IORuntime.builder().build()
  override def afterAll(): Unit = runtime.shutdown()
  private def request(f: RuntimeFixture, method: Method, path: String, body: Option[Json], token: Option[String], cookie: Option[String]): Request[IO] = {
    val headers = List(Header.Raw(CIString("Origin"), f.config.auth.publicOrigin), Header.Raw(CIString("X-Ontology-Version"), Wire.versions.current)) ++
      token.toList.map(value => Header.Raw(CIString("Authorization"), "Bearer " + value)) ++
      cookie.toList.flatMap(value => List(Header.Raw(CIString("Cookie"), value), Header.Raw(CIString("X-Ontology-Actor"), "fixture-human")))
    val result = Request[IO](method, Uri.unsafeFromString(f.config.auth.publicOrigin + path), headers = Headers(headers))
    body.fold(result)(value => result.withEntity(value.noSpaces).putHeaders(Header.Raw(CIString("Content-Type"), "application/json")))
  }
  private def call(client: Client[IO], request: Request[IO]): IO[(Status, Json, Headers)] = client.run(request).use { response =>
    response.body.take(Wire.MaxBodyBytes.toLong + 1L).compile.to(Array).map(bytes => (response.status, Wire.parse(bytes), response.headers))
  }
  private def scopes(client: Client[IO], f: RuntimeFixture): IO[ScopesResult] =
    call(client, request(f, Method.GET, "/api/v1/scopes", None, Some(f.agentToken), None)).flatMap { case (status, json, _) =>
      IO { assertEquals(status, Status.Ok); Wire.decode(ScopesResult.codecJson, json) }
    }
  private def await[A](operation: IO[A])(ready: A => Boolean): IO[A] = IO.defer(operation.flatMap(value =>
    if (ready(value)) IO.pure(value) else IO.sleep(25.millis) *> await(operation)(ready)))
  private def exercise(client: Client[IO], f: RuntimeFixture): IO[ScopeSummary] = for {
    initial <- scopes(client, f)
    _ = assertEquals(initial.items.map(_.scope), List(f.scope))
    _ = assertEquals(initial.items.head.frontier, 0L)
    denied <- call(client, request(f, Method.POST, "/api/v1/status", Some(Wire.encode(ScopeRequest.codecJson, ScopeRequest(f.scope + "-private"))), Some(f.agentToken), None))
    _ = assertEquals(denied._1, Status.Forbidden)
    command = ApplyRequest(f.scope, UUID.randomUUID(), 0L, List(Operation.Create("claim", TestAuthoring.applicability(TestApplicability.unresolved), ContentInput.Statement("Controlled live runtime account", Modality.Assertion), Nil)), None)
    applied <- call(client, request(f, Method.POST, "/api/v1/apply", Some(Wire.encode(ApplyRequest.codecJson, command)), Some(f.agentToken), None))
    _ = assertEquals(applied._1, Status.Ok)
    result = Wire.decode(ApplyResult.codecJson, applied._2)
    _ = assertEquals(result.generation, 1L)
    rpc = Json.obj("jsonrpc" -> Json.fromString("2.0"), "id" -> Json.fromInt(1), "method" -> Json.fromString("tools/call"),
      "params" -> Json.obj("name" -> Json.fromString("graph_apply"), "arguments" -> Wire.encode(ApplyRequest.codecJson, command)))
    replay <- call(client, request(f, Method.POST, "/mcp", Some(rpc), Some(f.agentToken), None).putHeaders(Header.Raw(CIString("Accept"), "application/json, text/event-stream")))
    _ = assertEquals(replay._1, Status.Ok)
    repeated = Wire.decode(ApplyResult.codecJson, replay._2.hcursor.downField("result").downField("structuredContent").focus.get)
    _ = assertEquals(repeated, result.copy(replayed = true))
    first <- await(scopes(client, f))(value => value.items.head.coveredFrontier == 1L && value.items.head.rdfGeneration.contains(value.items.head.generation)).timeout(8.seconds)
    _ = assertEquals(first.items.head.generation, 2L)
    login <- call(client, request(f, Method.POST, "/api/v1/login", Some(Wire.encode(LoginRequest.codecJson, LoginRequest(f.humanToken))), None, None))
    _ = assertEquals(login._1, Status.Ok)
    cookie = login._3.headers.find(_.name == CIString("Set-Cookie")).get.value.takeWhile(_ != ';')
    offer <- call(client, request(f, Method.POST, "/api/v1/present", Some(Wire.encode(PresentRequest.codecJson, PresentRequest(f.scope, List(result.created.head.ref), 2L))), None, Some(cookie)))
    _ = assertEquals(offer._1, Status.Ok)
    presentation = Wire.decode(Presentation.codecJson, offer._2)
    judgment = JudgmentRequest(f.scope, UUID.randomUUID(), presentation.id, ReviewAction.Review(JudgmentKind.NeedEvidence), "Controlled runtime observation")
    judged <- call(client, request(f, Method.POST, "/api/v1/judge", Some(Wire.encode(JudgmentRequest.codecJson, judgment)), None, Some(cookie)))
    _ = assertEquals(judged._1, Status.Ok)
    _ = assertEquals(Wire.decode(Judgment.codecJson, judged._2).actor.kind, ActorKind.Human)
    finalScope <- await(scopes(client, f))(value => value.items.head.coveredFrontier == 2L && value.items.head.rdfGeneration.contains(value.items.head.generation)).timeout(8.seconds)
    capRequest = CapsuleRequest(f.scope, UUID.randomUUID(), "fixture-work", None, 2L, None)
    cap <- call(client, request(f, Method.POST, "/api/v1/capsule", Some(Wire.encode(CapsuleRequest.codecJson, capRequest)), Some(f.agentToken), None))
    _ = assertEquals(cap._1, Status.Ok)
    value = Wire.decode(Capsule.codecJson, cap._2)
    report = DeliveryRequest(f.scope, UUID.randomUUID(), value.id, value.payloadDigest, value.payload.workContext, None, DeliveryBoundary.ClientContext, None, None)
    delivered <- call(client, request(f, Method.POST, "/api/v1/delivery", Some(Wire.encode(DeliveryRequest.codecJson, report)), Some(f.agentToken), None))
    _ = assertEquals(delivered._1, Status.Ok)
    unchanged <- scopes(client, f)
    _ = assertEquals(unchanged.items.head.generation, finalScope.items.head.generation)
    requests <- f.requests.get
    _ = assertEquals(requests.size, 2)
  } yield finalScope.items.head
  test("occupied coordinator ownership starts no standby listener RDF or model dispatch") {
    RuntimeFixture.resource.use { f => RepositoryReproductionDatabase.resource.use { db =>
      val repo = new PostgresGraphRepository(db, new AdmissionEngine, new ReviewDomain(f.config.review), f.config.curation)
      repo.initialize *> Resource.make(repo.curation.acquire(UUID.randomUUID()))(lease => repo.curation.release(lease.fence)).use { lease =>
        EmberClientBuilder.default[IO].build.use { client => for {
          result <- Main.execute(List("serve", f.configFile.toString), IO.pure(f.environment), value => IO.println(value)).timeout(8.seconds)
          _ = assertEquals(result, cats.effect.ExitCode.Error)
          requests <- f.requests.get
          _ = assertEquals(requests, Nil)
          _ = assert(!java.nio.file.Files.exists(f.directory.resolve("rdf")))
          response <- scopes(client, f).attempt.timeout(5.seconds)
          _ = assert(response.isLeft)
          retained <- repo.curation.renew(lease.fence)
          _ = assertEquals(retained.fence, lease.fence)
        } yield () }
      }
    } }.unsafeRunSync()(using runtime)
  }

  test("disabled source sharing remains enforced through actual Main wiring") {
    RuntimeFixture.resource.use { f => EmberClientBuilder.default[IO].build.use { client => for {
      _ <- IO.blocking {
        val json = Wire.parse(java.nio.file.Files.readAllBytes(f.configFile))
        val changed = json.mapObject(o => o.add("curator", o("curator").get.mapObject(_.add("allowSourceSharing", Json.False))))
        java.nio.file.Files.writeString(f.configFile, changed.noSpaces)
      }
      _ <- Resource.make(Main.execute(List("serve", f.configFile.toString), IO.pure(f.environment), value => IO.println(value)).start)(_.cancel).use { fiber =>
        def ready: IO[Unit] = IO.defer(scopes(client, f).attempt.flatMap {
          case Right(_) => IO.unit
          case Left(value: Fault) => IO.raiseError(value)
          case Left(value: AssertionError) => IO.raiseError(value)
          case Left(_) => IO.sleep(25.millis) *> ready
        })
        IO.race(ready.timeout(8.seconds), fiber.join).flatMap {
          case Right(_) => IO.raiseError(new AssertionError("Main terminated before HTTP readiness"))
          case Left(_) => for {
            command = ApplyRequest(f.scope, UUID.randomUUID(), 0L, List(Operation.Create("claim", TestAuthoring.applicability(TestApplicability.unresolved), ContentInput.Statement("Must not leave this owned service", Modality.Assertion), Nil)), None)
            result <- call(client, request(f, Method.POST, "/api/v1/apply", Some(Wire.encode(ApplyRequest.codecJson, command)), Some(f.agentToken), None))
            _ = assertEquals(result._1, Status.Ok)
            failed <- await(scopes(client, f))(_.items.head.curation == CurationState.Failed).timeout(8.seconds)
            _ = assertEquals((failed.items.head.frontier, failed.items.head.coveredFrontier), (1L, 0L))
            requests <- f.requests.get
            _ = assertEquals(requests, Nil)
          } yield ()
        }
      }
    } yield () } }.unsafeRunSync()(using runtime)
  }

  test("Main serve owns actual HTTP model curation RDF and review capsule paths") {
    RuntimeFixture.resource.use { f => EmberClientBuilder.default[IO].build.use { client => for {
      finalScope <- Resource.make(Main.execute(List("serve", f.configFile.toString), IO.pure(f.environment), value => IO.println(value)).start)(_.cancel).use { fiber =>
        def ready: IO[Unit] = IO.defer(scopes(client, f).attempt.flatMap {
          case Right(_) => IO.unit
          case Left(value: Fault) => IO.raiseError(value)
          case Left(value: AssertionError) => IO.raiseError(value)
          case Left(_) => IO.sleep(25.millis) *> ready
        })
        IO.race(ready.timeout(8.seconds), fiber.join).flatMap {
          case Left(_) => exercise(client, f).flatTap(_ => fiber.cancel)
          case Right(_) => IO.raiseError(new AssertionError("Main terminated before HTTP readiness"))
        }
      }
      gone <- call(client, request(f, Method.GET, "/api/v1/scopes", None, Some(f.agentToken), None)).attempt.timeout(5.seconds)
      _ = assert(gone.isLeft)
      retained <- RdfProjection.resource(f.config.projection.storage, f.config.projection.settings.targetId, 5,
        IO.raiseError(new AssertionError("native identity should already exist"))).use(_.observe(f.scope).map(_.get))
      _ = assertEquals(retained.snapshot.generation, finalScope.generation)
      _ = assertEquals((retained.snapshot.sourceFrontier, retained.snapshot.coveredFrontier), (2L, 2L))
      _ <- RepositoryReproductionDatabase.resource.use { db =>
        val repo = new PostgresGraphRepository(db, new AdmissionEngine, new ReviewDomain(f.config.review), f.config.curation)
        repo.read(f.scope).flatMap(graph => IO(assertEquals(graph, retained.snapshot))) *>
          repo.curation.acquire(UUID.randomUUID()).flatMap(lease => repo.curation.release(lease.fence))
      }
    } yield () } }.unsafeRunSync()(using runtime)
  }
}

