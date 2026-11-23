package chronicle

import cats.effect.ExitCode
import cats.effect.unsafe.implicits.global
import io.circe.Json
import java.io.{ByteArrayOutputStream,PrintStream}
import java.nio.charset.StandardCharsets.UTF_8
import java.nio.file.{Files,Path}
import scala.util.Using

/** A real in-process start: a failed start prints one line naming its stage and cause instead of IOApp's stack trace. */
final class StartFailureLineTest extends munit.FunSuite {
  test("serve on an occupied listen port fails the bind stage with address in use and the port") {
    val c = Fixtures.config()
    Using.resource(new java.net.ServerSocket(0,1,java.net.InetAddress.getByName("127.0.0.1"))) { occupied =>
      val port = occupied.getLocalPort
      val sample = Wire.parse(Files.readString(Path.of("config.example.json")))
      def model(key: String,changes: (String,Json)*): Json = sample.hcursor.downField(key).focus.get.mapObject(o => changes.foldLeft(o)((o,change) => o.add(change._1,change._2)))
      val json = sample.mapObject(_.add("listenPort",Json.fromInt(port)).add("allowedOrigin",Json.fromString(s"http://127.0.0.1:$port"))
        .add("jdbcUrl",Json.fromString(c.jdbcUrl)).add("databaseUser",Json.fromString(c.databaseUser)).add("databasePasswordFile",Json.fromString(c.databasePasswordFile))
        .add("users",Json.fromValues(c.users.map(u => Json.obj("id"->Json.fromString(u.id),"login"->Json.fromString(u.login),"passwordHashFile"->Json.fromString(u.passwordHashFile),"enabled"->Json.fromBoolean(u.enabled)))))
        .add("annotation",model("annotation","endpoint"->Json.fromString("http://127.0.0.1:1/forbidden-model"),"credentialFile"->Json.fromString(c.annotation.credentialFile)))
        .add("embedding",model("embedding","endpoint"->Json.fromString("http://127.0.0.1:1/forbidden-model"),"credentialFile"->Json.fromString(c.embedding.credentialFile),"dimensions"->Json.fromInt(3))))
      val path = Files.createTempFile("chronicle-start-",".json")
      try {
        Files.writeString(path,json.noSpaces)
        val captured = new ByteArrayOutputStream(); val original = System.err
        val exit = try { System.setErr(new PrintStream(captured,true,UTF_8)); Main.run(List("serve",path.toString)).unsafeRunSync() } finally System.setErr(original)
        assertEquals((exit,captured.toString(UTF_8).linesIterator.filter(_.startsWith("chronicle failure")).toList),
          (ExitCode.Error,List(s"""chronicle failure stage=bind code=address-in-use error=BindException message="address in use" port=$port""")))
      } finally Files.deleteIfExists(path)
    }
  }
}
