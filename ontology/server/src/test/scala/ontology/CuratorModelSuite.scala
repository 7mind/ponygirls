package ontology

import cats.effect.{IO, Ref as IORef, Resource}
import cats.effect.unsafe.IORuntime
import cats.syntax.all.*
import com.comcast.ip4s.*
import io.circe.Json
import java.nio.file.Files
import ontology.api.*
import ontology.curation.*
import ontology.domain.Fault
import org.http4s.{HttpApp, Response, Status}
import org.http4s.ember.server.EmberServerBuilder
import scala.concurrent.duration.*

final class CuratorModelSuite extends munit.FunSuite {
  override val munitTimeout = 30.seconds
  private val runtime = IORuntime.builder().build()
  override def afterAll(): Unit = runtime.shutdown()
  private def run[A](value: IO[A]): A = value.unsafeRunSync()(using runtime)
  private val input = CurationInput("fixture", 7L, 3L, Nil, Nil)
  private val proposal = CurationProposal(7L, 3L, Nil)
  private val schemas = new CurationSchemas {
    def find: Json = Json.obj("type" -> Json.fromString("object"))
    def read: Json = Json.obj("type" -> Json.fromString("object"))
    def proposal: Json = Json.obj("type" -> Json.fromString("object"))
  }
  private def finalReply(value: CurationProposal): String = Json.obj("choices" -> Json.arr(Json.obj(
    "index" -> Json.fromInt(0), "finish_reason" -> Json.fromString("stop"),
    "message" -> Json.obj("role" -> Json.fromString("assistant"), "content" -> Json.fromString(Wire.encode(CurationProposal.codecJson, value).noSpaces))
  ))).noSpaces
  private def toolReply(scope: String): String = Json.obj("choices" -> Json.arr(Json.obj(
    "finish_reason" -> Json.fromString("tool_calls"), "message" -> Json.obj("role" -> Json.fromString("assistant"), "content" -> Json.Null,
      "tool_calls" -> Json.arr(Json.obj("id" -> Json.fromString("read-1"), "type" -> Json.fromString("function"), "function" -> Json.obj(
        "name" -> Json.fromString("graph_read"), "arguments" -> Json.fromString(Wire.encode(ReadRequest.codecJson, ReadRequest(scope, ReadView.Current, Nil, None, 10)).noSpaces))))))
  )).noSpaces
  private final class Audit(requests: IORef[IO, List[Json]], responses: IORef[IO, List[Json]], delay: FiniteDuration) extends CurationAudit {
    def request(ordinal: Int, payload: Json): IO[Unit] = requests.update(_ :+ payload)
    def response(ordinal: Int, value: Json): IO[Unit] = IO.sleep(delay) *> responses.update(_ :+ value)
  }
  private def reader(reads: IORef[IO, Int], generation: Long): CurationReader = new CurationReader {
    def read(request: ReadRequest): IO[ReadResult] = reads.update(_ + 1).as(ReadResult(request.scope, generation, Nil, None))
    def find(request: FindRequest): IO[FindResult] = IO.raiseError(new AssertionError("Unexpected find"))
  }
  private def fixture(app: HttpApp[IO]): Resource[IO, CuratorConfig] = for {
    credential <- Resource.make(IO.blocking(Files.createTempFile("ontology-curator-fixture-", ".txt")))(path => IO.blocking(Files.deleteIfExists(path)).void)
    server <- EmberServerBuilder.default[IO].withHost(Host.fromString("127.0.0.1").get).withPort(Port.fromInt(0).get).withHttpApp(app).build
  } yield CuratorConfig(s"http://127.0.0.1:${server.address.getPort}/model", "controlled-model", credential.toString, 3.seconds, 1048576, 1048576, 1024, Some("max"), true, CuratorOutputTokenField.MaxCompletionTokens, CuratorResponseFormat.JsonObject)
  private def response(body: String, status: Status): HttpApp[IO] = cats.data.Kleisli(_ => IO.pure(Response[IO](status).withEntity(body)))

  test("source sharing is denied before credentials, requests or model dispatch") { run(for {
    calls <- IORef.of[IO, Int](0)
    requests <- IORef.of[IO, List[Json]](Nil)
    responses <- IORef.of[IO, List[Json]](Nil)
    reads <- IORef.of[IO, Int](0)
    app: HttpApp[IO] = cats.data.Kleisli(_ => calls.update(_ + 1).as(Response[IO](Status.Ok).withEntity(finalReply(proposal))))
    _ <- fixture(app).use(cfg => CuratorModel.resource(cfg.copy(allowSourceSharing = false, credentialFile = cfg.credentialFile + "-absent"), schemas).use { model =>
      model.propose(input, reader(reads, 7L), new Audit(requests, responses, Duration.Zero)).attempt.flatMap { result =>
        IO(assertEquals(result.left.toOption.collect { case f: Fault => f.code }, Some("curator-sharing")))
      }
    })
    count <- calls.get; recorded <- requests.get
    _ = assertEquals(count, 0)
    _ = assertEquals(recorded, Nil)
  } yield ()) }

  test("configured profile, supplied input and final proposal are audited") { run(for {
    requests <- IORef.of[IO, List[Json]](Nil); responses <- IORef.of[IO, List[Json]](Nil); reads <- IORef.of[IO, Int](0)
    result <- fixture(response(finalReply(proposal), Status.Ok)).use(cfg => CuratorModel.resource(cfg, schemas).use(_.propose(input, reader(reads, 7L), new Audit(requests, responses, Duration.Zero))))
    _ = assertEquals(result, proposal)
    sent <- requests.get; received <- responses.get
    _ = assertEquals(sent.size, 1)
    _ = assertEquals(received.size, 1)
    _ = assertEquals(sent.head.hcursor.get[String]("model").toOption, Some("controlled-model"))
    _ = assertEquals(sent.head.hcursor.get[Int]("max_completion_tokens").toOption, Some(1024))
    _ = assert(!sent.head.hcursor.downField("max_tokens").succeeded)
    _ = assertEquals(sent.head.hcursor.get[String]("reasoning_effort").toOption, Some("max"))
  } yield ()) }

  test("valid frozen tool continuation is not a retry and preserves audit order") { run(for {
    calls <- IORef.of[IO, Int](0); requests <- IORef.of[IO, List[Json]](Nil); responses <- IORef.of[IO, List[Json]](Nil); reads <- IORef.of[IO, Int](0)
    app: HttpApp[IO] = cats.data.Kleisli(_ => calls.updateAndGet(_ + 1).map(n => Response[IO](Status.Ok).withEntity(if (n == 1) toolReply("fixture") else finalReply(proposal))))
    result <- fixture(app).use(cfg => CuratorModel.resource(cfg, schemas).use(_.propose(input, reader(reads, 7L), new Audit(requests, responses, Duration.Zero))))
    _ = assertEquals(result, proposal)
    count <- calls.get; readCount <- reads.get; sent <- requests.get; received <- responses.get
    _ = assertEquals((count, readCount, sent.size, received.size), (2, 1, 2, 2))
    _ = assertEquals(sent.last.hcursor.downField("messages").focus.get.asArray.get.last.hcursor.get[String]("tool_call_id").toOption, Some("read-1"))
  } yield ()) }

  List("foreign tool scope" -> toolReply("foreign"), "foreign proposal generation" -> finalReply(proposal.copy(expectedGeneration = 8L)), "foreign proposal frontier" -> finalReply(proposal.copy(frontier = 4L))).foreach { (name, body) =>
    test(s"$name is rejected without follow-up dispatch") { run(for {
      calls <- IORef.of[IO, Int](0); requests <- IORef.of[IO, List[Json]](Nil); responses <- IORef.of[IO, List[Json]](Nil); reads <- IORef.of[IO, Int](0)
      app: HttpApp[IO] = cats.data.Kleisli(_ => calls.update(_ + 1).as(Response[IO](Status.Ok).withEntity(body)))
      result <- fixture(app).use(cfg => CuratorModel.resource(cfg, schemas).use(_.propose(input, reader(reads, 7L), new Audit(requests, responses, Duration.Zero)).attempt))
      _ = assertEquals(result.left.toOption.collect { case f: Fault => f.code }, Some("curator-snapshot"))
      count <- calls.get; readCount <- reads.get
      _ = assertEquals((count, readCount), (1, 0))
    } yield ()) }
  }

  List(Status.TooManyRequests -> "private fixture error", Status.Ok -> "not JSON").foreach { (status, body) =>
    test(s"$status / malformed outer response stays failed without fabricated response audit") { run(for {
      requests <- IORef.of[IO, List[Json]](Nil); responses <- IORef.of[IO, List[Json]](Nil); reads <- IORef.of[IO, Int](0)
      result <- fixture(response(body, status)).use(cfg => CuratorModel.resource(cfg, schemas).use(_.propose(input, reader(reads, 7L), new Audit(requests, responses, Duration.Zero)).attempt))
      _ = assert(result.isLeft)
      received <- responses.get
      _ = assertEquals(received, Nil)
      _ = assert(!result.left.toOption.get.toString.contains("private fixture error"))
    } yield ()) }
  }

  test("total deadline remains effective while the response audit waits") { run(for {
    requests <- IORef.of[IO, List[Json]](Nil); responses <- IORef.of[IO, List[Json]](Nil); reads <- IORef.of[IO, Int](0)
    entered <- IORef.of[IO, Boolean](false)
    waitingAudit = new CurationAudit {
      def request(ordinal: Int, payload: Json): IO[Unit] = requests.update(_ :+ payload)
      def response(ordinal: Int, value: Json): IO[Unit] = entered.set(true) *> IO.sleep(1.second) *> responses.update(_ :+ value)
    }
    _ <- fixture(response(finalReply(proposal), Status.Ok)).use { cfg =>
      CuratorModel.resource(cfg.copy(deadline = 300.millis), schemas).use { model => for {
        start <- IO.monotonic
        result <- model.propose(input, reader(reads, 7L), waitingAudit).attempt
        elapsed <- IO.monotonic.map(_ - start)
        started <- entered.get
        _ = assert(started, "Fixture did not reach the response audit")
        _ = assert(result.isLeft)
        _ = assert(elapsed < 700.millis, s"300ms total deadline returned after $elapsed")
      } yield () }
    }
  } yield ()) }
}
