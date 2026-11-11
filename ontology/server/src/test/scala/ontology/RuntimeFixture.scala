package ontology

import cats.effect.{IO, Ref as Cell, Resource}
import cats.syntax.all.*
import com.comcast.ip4s.*
import io.circe.Json
import java.nio.charset.StandardCharsets.UTF_8
import java.nio.file.{Files, Path}
import java.security.SecureRandom
import java.time.Clock
import java.util.{Base64, UUID}
import scala.util.Using
import ontology.api.*
import ontology.domain.*
import org.http4s.{HttpApp, Response, Status}
import org.http4s.ember.server.EmberServerBuilder
import logstage.IzLogger

final case class RuntimeFixture(config: Config, configFile: Path, directory: Path, scope: String, agentToken: String,
  humanToken: String, requests: Cell[IO, List[String]], environment: RuntimeEnvironment)
object RuntimeFixture {
  private def token(value: Byte): String = Base64.getUrlEncoder.withoutPadding().encodeToString(Array.fill[Byte](32)(value))
  private def replace(json: Json, path: List[String], value: Json): Json = path match {
    case Nil => value
    case key :: rest => json.mapObject(o => o.add(key, replace(o(key).get, rest, value)))
  }
  private def base: Json = Using.resource(Option(getClass.getResourceAsStream("/runtime-config.json")).getOrElse(throw new IllegalStateException("fixture missing")))(s => Wire.parse(s.readAllBytes()))
  private def provider(calls: Cell[IO, List[String]]): HttpApp[IO] = cats.data.Kleisli { request => for {
    body <- request.as[String]
    _ <- calls.update(_ :+ body)
    json = Wire.parse(body.getBytes(UTF_8))
    content = json.hcursor.downField("messages").focus.get.asArray.get.find(_.hcursor.get[String]("role").toOption.contains("user")).get.hcursor.get[String]("content").toOption.get
    input = Wire.parse(content.getBytes(UTF_8))
    proposal = CurationProposal(input.hcursor.get[String]("generation").toOption.get.toLong, input.hcursor.get[String]("frontier").toOption.get.toLong, Nil)
    result = Json.obj("choices" -> Json.arr(Json.obj("finish_reason" -> Json.fromString("stop"), "message" -> Json.obj("role" -> Json.fromString("assistant"), "content" -> Json.fromString(StoredJson.encode(CurationProposal.codecJson, proposal))))))
  } yield Response[IO](Status.Ok).withEntity(result.noSpaces) }
  def resource: Resource[IO, RuntimeFixture] = for {
    directory <- RdfTestDirectory.resource
    calls <- Resource.eval(Cell.of[IO, List[String]](Nil))
    server <- EmberServerBuilder.default[IO].withHost(Host.fromString("127.0.0.1").get).withPort(Port.fromInt(0).get).withHttpApp(provider(calls)).build
    fixture <- Resource.eval(IO.blocking {
      val scope = "runtime-" + UUID.randomUUID()
      val human = token(11); val agent = token(12)
      val humanFile = directory.resolve("human.sha256"); val agentFile = directory.resolve("agent.sha256")
      val cursor = directory.resolve("cursor.hex"); val model = directory.resolve("model.key")
      Files.writeString(humanFile, Digests.text(human) + "\n"); Files.writeString(agentFile, Digests.text(agent) + "\n")
      Files.writeString(cursor, "a" * 64 + "\n"); Files.writeString(model, "controlled-model-token\n")
      val port = Using.resource(new java.net.ServerSocket(0, 1, java.net.InetAddress.getLoopbackAddress))(_.getLocalPort)
      val names = Json.arr(Json.fromString(scope))
      val original = base
      val credentials = original.hcursor.downField("auth").downField("credentials").focus.get.asArray.get.map { value =>
        val file = if (value.hcursor.get[String]("id").toOption.contains("fixture-human")) humanFile else agentFile
        value.mapObject(_.add("scopes", names).add("hashFile", Json.fromString(file.toString)))
      }
      val changes = List(
        List("http", "listenPort") -> Json.fromInt(port),
        List("auth", "publicOrigin") -> Json.fromString(s"http://127.0.0.1:$port"),
        List("auth", "credentials") -> Json.arr(credentials*),
        List("database", "jdbcUrl") -> Json.fromString(sys.env("ONTOLOGY_TEST_JDBC_URL")),
        List("database", "passwordFile") -> Json.fromString(sys.env("ONTOLOGY_TEST_PASSWORD_FILE")),
        List("cursorKeyFile") -> Json.fromString(cursor.toString),
        List("curator", "credentialFile") -> Json.fromString(model.toString),
        List("curator", "operationUrl") -> Json.fromString(s"http://127.0.0.1:${server.address.getPort}/model"),
        List("curation", "scopes") -> names, List("curation", "principal", "scopes") -> names,
        List("projection", "scopes") -> names, List("projection", "principal", "scopes") -> names,
        List("projection", "storage") -> Json.obj("Native" -> Json.obj("path" -> Json.fromString(directory.resolve("rdf").toString))),
        List("capsule", "projection", "contexts") -> Json.arr(Json.obj("scope" -> Json.fromString(scope), "name" -> Json.fromString("fixture-work"))),
        List("runner", "pollEveryMs") -> Json.fromInt(100), List("runner", "renewEveryMs") -> Json.fromInt(100))
      val json = changes.foldLeft(original) { case (value, (path, replacement)) => replace(value, path, replacement) }
      val path = directory.resolve("config.json"); Files.writeString(path, json.noSpaces)
      val environment = RuntimeEnvironment(Clock.systemUTC(), new RuntimeIds(() => UUID.randomUUID()), new FileCredentialDigests,
        new RandomSessionSecrets(new SecureRandom), IzLogger())
      RuntimeFixture(Config.decode(json), path, directory, scope, agent, human, calls, environment)
    })
  } yield fixture
}
