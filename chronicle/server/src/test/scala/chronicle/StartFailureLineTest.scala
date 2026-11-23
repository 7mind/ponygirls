package chronicle

import cats.effect.unsafe.implicits.global
import io.circe.Json
import java.io.{ByteArrayOutputStream,PrintStream}
import java.nio.charset.StandardCharsets.UTF_8
import java.nio.file.{Files,Path}
import java.util.concurrent.TimeUnit
import scala.concurrent.duration.*
import scala.util.Using

/** A real start of the deployed entry point (IOApp's own runtime and failure reporter) in a child JVM, or of its `run` in
  * process: a failed start prints one line naming its stage and cause instead of a stack trace. */
final class StartFailureLineTest extends munit.FunSuite {
  /** A failed start exits within seconds; the bound only stops a hung child. */
  private val childExitBound = 50.seconds
  /** The child JVM must not inherit the JVM option variables of the test environment (the Nix check sets JAVA_TOOL_OPTIONS),
    * whose "Picked up …" notice would be a stderr line that is not the service's; the complete stderr stays asserted. */
  private def childEnvironment(builder: ProcessBuilder): ProcessBuilder = {
    Vector("JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS", "JDK_JAVA_OPTIONS").foreach(builder.environment().remove)
    builder
  }
  /** The known notices a fresh JVM prints on stderr that are not the service's, matched exactly: the JDK's warning about
    * Scala's LazyVals, SLF4J's no-binding notices and cats-effect's CPU-starvation warning on a loaded host. */
  private val knownJvmNotices = Vector(
    """WARNING: A terminally deprecated method in sun\.misc\.Unsafe has been called""",
    """WARNING: sun\.misc\.Unsafe::objectFieldOffset has been called by scala\.runtime\.LazyVals\$ \(file:[^)]+\)""",
    """WARNING: Please consider reporting this to the maintainers of class scala\.runtime\.LazyVals\$""",
    """WARNING: sun\.misc\.Unsafe::objectFieldOffset will be removed in a future release""",
    """SLF4J: Failed to load class "org\.slf4j\.impl\.StaticLoggerBinder"\.""",
    """SLF4J: Defaulting to no-operation \(NOP\) logger implementation""",
    """SLF4J: See http://www\.slf4j\.org/codes\.html#StaticLoggerBinder for further details\.""",
    """SLF4J: Failed to load class "org\.slf4j\.impl\.StaticMDCBinder"\.""",
    """SLF4J: Defaulting to no-operation MDCAdapter implementation\.""",
    """SLF4J: See http://www\.slf4j\.org/codes\.html#no_static_mdc_binder for further details\.""",
    """.+ \[WARNING\] Your app's responsiveness to a new asynchronous event \(such as a new connection, an upstream response, or a timer\) was in excess of .+\. Your CPU is probably starving\. .+""")
  /** The example configuration on the test database with the fixture's users and credentials, unreachable models, the
    * given listen port and start wait. */
  private def config(port: Int,startWaitMs: Int,jdbcUrl: Option[String] = None): Json = {
    val c = Fixtures.config()
    val sample = Wire.parse(Files.readString(Path.of("config.example.json")))
    def model(key: String,changes: (String,Json)*): Json = sample.hcursor.downField(key).focus.get.mapObject(o => changes.foldLeft(o)((o,change) => o.add(change._1,change._2)))
    sample.mapObject(_.add("listenPort",Json.fromInt(port)).add("allowedOrigin",Json.fromString(s"http://127.0.0.1:$port"))
      .add("jdbcUrl",Json.fromString(jdbcUrl.getOrElse(c.jdbcUrl))).add("databaseUser",Json.fromString(c.databaseUser)).add("databasePasswordFile",Json.fromString(c.databasePasswordFile))
      .add("databaseLimits",model("databaseLimits","startWaitMs"->Json.fromInt(startWaitMs)))
      .add("users",Json.fromValues(c.users.map(u => Json.obj("id"->Json.fromString(u.id),"login"->Json.fromString(u.login),"passwordHashFile"->Json.fromString(u.passwordHashFile),"enabled"->Json.fromBoolean(u.enabled)))))
      .add("annotation",model("annotation","endpoint"->Json.fromString("http://127.0.0.1:1/forbidden-model"),"credentialFile"->Json.fromString(c.annotation.credentialFile)))
      .add("embedding",model("embedding","endpoint"->Json.fromString("http://127.0.0.1:1/forbidden-model"),"credentialFile"->Json.fromString(c.embedding.credentialFile),"dimensions"->Json.fromInt(3))))
  }
  /** Runs one command in process: its exit code, complete stderr and complete stdout. */
  private def captured(command: String,path: Path): (Int,String,String) = {
    val (err,out,originalErr,originalOut) = (new ByteArrayOutputStream(),new ByteArrayOutputStream(),System.err,System.out)
    val exit = try {
      System.setErr(new PrintStream(err,true,UTF_8)); System.setOut(new PrintStream(out,true,UTF_8))
      Main.run(List(command,path.toString)).unsafeRunSync()
    } finally { System.setErr(originalErr); System.setOut(originalOut) }
    (exit.code,err.toString(UTF_8),out.toString(UTF_8))
  }
  test("an unreachable database is waited for until startWaitMs, then fails the database-wait stage; 999 ms is a config failure") {
    val dir = Files.createTempDirectory("chronicle-start-")
    val path = dir.resolve("config.json")
    try {
      Files.writeString(path,config(8448,1000,Some("jdbc:postgresql://127.0.0.1:1/chronicle_unreachable")).noSpaces)
      val started = System.nanoTime()
      assertEquals(captured("migrate",path),(1,"chronicle database-wait code=jdbc-08001\nchronicle failure stage=database-wait code=jdbc-08001 error=JdbcFailure message=\"database-wait-timeout\"\n",""))
      assert((System.nanoTime() - started).nanos >= 1.second)
      Files.writeString(path,config(8448,999).noSpaces)
      assertEquals(captured("migrate",path),(1,"chronicle failure stage=config code=config error=DomainError message=\"databaseLimits.startWaitMs must be 1000..3600000\"\n",""))
    } finally List(path,dir).foreach(Files.deleteIfExists)
  }
  test("serve on an occupied listen port fails the bind stage with address in use and the port") {
    val dir = Files.createTempDirectory("chronicle-start-")
    Using.resource(new java.net.ServerSocket(0,1,java.net.InetAddress.getByName("127.0.0.1"))) { occupied =>
      val port = occupied.getLocalPort
      val (path,err,out) = (dir.resolve("config.json"),dir.resolve("child.err"),dir.resolve("child.out"))
      try {
        // The smallest start wait passes a healthy database without a wait line.
        Files.writeString(path,config(port,1000).noSpaces)
        val classpath = classOf[Main.type].getClassLoader match {
          case loader: java.net.URLClassLoader => loader.getURLs.map(url => Path.of(url.toURI).toString).mkString(java.io.File.pathSeparator)
          case other => fail("the child needs the URL class loader of sbt's forked test JVM, got " + other)
        }
        val process = childEnvironment(new ProcessBuilder(Path.of(System.getProperty("java.home"),"bin","java").toString,"-cp",classpath,"chronicle.Main","serve",path.toString))
          .redirectInput(ProcessBuilder.Redirect.from(new java.io.File("/dev/null"))).redirectError(err.toFile).redirectOutput(out.toFile).start()
        try assert(process.waitFor(childExitBound.toSeconds,TimeUnit.SECONDS),"the child did not exit")
        finally { process.destroyForcibly(); process.waitFor() }
        assertEquals((process.exitValue,Files.readString(err).linesIterator.filterNot(line => knownJvmNotices.exists(line.matches)).toList,Files.readString(out)),
          (1,List(s"chronicle failure stage=bind code=address-in-use error=BindException message=\"address in use\" port=$port"),""))
      } finally List(path,err,out,dir).foreach(Files.deleteIfExists)
    }
  }
}
