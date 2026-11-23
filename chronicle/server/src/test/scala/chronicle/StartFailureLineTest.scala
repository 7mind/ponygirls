package chronicle

import io.circe.Json
import java.nio.file.{Files,Path}
import java.util.concurrent.TimeUnit
import scala.concurrent.duration.*
import scala.util.Using

/** A real start of the deployed entry point (IOApp's own runtime and failure reporter) in a child JVM: a failed start
  * prints one line naming its stage and cause instead of a stack trace. */
final class StartFailureLineTest extends munit.FunSuite {
  /** A failed start exits within seconds; the bound only stops a hung child. */
  private val childExitBound = 50.seconds
  /** Lines a fresh JVM prints on stderr that are not the service's: the JDK's own warnings (a block ending in an empty line), SLF4J's no-binding notice and
    * cats-effect's CPU-starvation warning on a loaded host. */
  private val unrelatedJvmLines = Vector("WARNING: ","SLF4J: ","SLF4J(","[WARNING] Your app's responsiveness")
  test("serve on an occupied listen port fails the bind stage with address in use and the port") {
    val c = Fixtures.config()
    val dir = Files.createTempDirectory("chronicle-start-")
    Using.resource(new java.net.ServerSocket(0,1,java.net.InetAddress.getByName("127.0.0.1"))) { occupied =>
      val port = occupied.getLocalPort
      val sample = Wire.parse(Files.readString(Path.of("config.example.json")))
      def model(key: String,changes: (String,Json)*): Json = sample.hcursor.downField(key).focus.get.mapObject(o => changes.foldLeft(o)((o,change) => o.add(change._1,change._2)))
      val json = sample.mapObject(_.add("listenPort",Json.fromInt(port)).add("allowedOrigin",Json.fromString(s"http://127.0.0.1:$port"))
        .add("jdbcUrl",Json.fromString(c.jdbcUrl)).add("databaseUser",Json.fromString(c.databaseUser)).add("databasePasswordFile",Json.fromString(c.databasePasswordFile))
        .add("users",Json.fromValues(c.users.map(u => Json.obj("id"->Json.fromString(u.id),"login"->Json.fromString(u.login),"passwordHashFile"->Json.fromString(u.passwordHashFile),"enabled"->Json.fromBoolean(u.enabled)))))
        .add("annotation",model("annotation","endpoint"->Json.fromString("http://127.0.0.1:1/forbidden-model"),"credentialFile"->Json.fromString(c.annotation.credentialFile)))
        .add("embedding",model("embedding","endpoint"->Json.fromString("http://127.0.0.1:1/forbidden-model"),"credentialFile"->Json.fromString(c.embedding.credentialFile),"dimensions"->Json.fromInt(3))))
      val (path,err,out) = (dir.resolve("config.json"),dir.resolve("child.err"),dir.resolve("child.out"))
      try {
        Files.writeString(path,json.noSpaces)
        val classpath = classOf[Main.type].getClassLoader match {
          case loader: java.net.URLClassLoader => loader.getURLs.map(url => Path.of(url.toURI).toString).mkString(java.io.File.pathSeparator)
          case other => fail("the child needs the URL class loader of sbt's forked test JVM, got " + other)
        }
        val process = new ProcessBuilder(Path.of(System.getProperty("java.home"),"bin","java").toString,"-cp",classpath,"chronicle.Main","serve",path.toString)
          .redirectInput(ProcessBuilder.Redirect.from(new java.io.File("/dev/null"))).redirectError(err.toFile).redirectOutput(out.toFile).start()
        try assert(process.waitFor(childExitBound.toSeconds,TimeUnit.SECONDS),"the child did not exit")
        finally { process.destroyForcibly(); process.waitFor() }
        assertEquals((process.exitValue,Files.readString(err).linesIterator.filterNot(line => line.isEmpty || unrelatedJvmLines.exists(line.startsWith)).toList,Files.readString(out)),
          (1,List(s"chronicle failure stage=bind code=address-in-use error=BindException message=\"address in use\" port=$port"),""))
      } finally List(path,err,out,dir).foreach(Files.deleteIfExists)
    }
  }
}
