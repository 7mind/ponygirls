package manure

import cats.effect.unsafe.implicits.global
import io.circe.Json
import java.nio.file.{Files,Path}
import java.util.concurrent.TimeUnit
import scala.util.Using
import munit.FunSuite

object CheckConfigProbe:
  def main(args: Array[String]): Unit = sys.exit(Main.run(args.toList).unsafeRunSync().code)

/** Actual CLI, isolated child, owned no-writer FIFOs/nonexistent references and
  * unreachable loopback model/JDBC endpoints. Configuration validation must not
  * open any referenced secret, payload root, native library, model or database.
  */
final class CheckConfigSuite extends FunSuite:
  test("check-config validates current config without referenced credential or external IO") {
    val directory=Files.createTempDirectory("manure-check-config-")
    val fifo=directory.resolve("credential-fifo")
    val mkfifo=new ProcessBuilder("mkfifo",fifo.toString).start()
    try
      assert(mkfifo.waitFor(5,TimeUnit.SECONDS));assertEquals(mkfifo.exitValue(),0)
      val limits=Json.obj("maxConnections" -> Json.fromInt(1),"maxQueued" -> Json.fromInt(1),
        "queueTimeoutMs" -> Json.fromInt(5000),"connectTimeoutMs" -> Json.fromInt(5000),"statementTimeoutMs" -> Json.fromInt(5000),
        "lockTimeoutMs" -> Json.fromInt(5000),"idleTransactionTimeoutMs" -> Json.fromInt(5000),"socketTimeoutMs" -> Json.fromInt(5000))
      val config=Json.obj("data_dir" -> Json.fromString(directory.resolve("nonexistent-data").toString),
        "api_origin" -> Json.fromString("https://api.example.test"),"content_mode" -> Json.fromString("path"),
        "native_mode" -> Json.fromString("shared"),"posix_library" -> Json.fromString(directory.resolve("nonexistent-native.so").toString),
        "users" -> Json.arr(Json.obj("id" -> Json.fromString("operator"),"type" -> Json.fromString("human"),
          "tokens" -> Json.arr(Json.obj("id" -> Json.fromString("primary"),"hashFile" -> Json.fromString(fifo.toString))))),
        "database" -> Json.obj("jdbcUrl" -> Json.fromString("jdbc:postgresql://127.0.0.1:1/unreachable"),
          "user" -> Json.fromString("unreachable"),"passwordFile" -> Json.fromString(fifo.toString),"limits" -> limits),
        "embedding" -> Json.obj("operationUrl" -> Json.fromString("http://127.0.0.1:1/embeddings"),"model" -> Json.fromString("fixture"),
          "revision" -> Json.fromString("immutable"),"dimensions" -> Json.fromInt(3),"sendDimensions" -> Json.False,
          "documentPrefix" -> Json.fromString(""),"queryPrefix" -> Json.fromString(""),"normalization" -> Json.fromString("cosine"),
          "credentialFile" -> Json.fromString(fifo.toString),"deadlineMs" -> Json.fromInt(5000),"maxResponseBytes" -> Json.fromInt(1024),
          "maxBatch" -> Json.fromInt(1),"maxInputBytes" -> Json.fromInt(1024),"maxRequestBytes" -> Json.fromInt(4096),
          "maxConcurrent" -> Json.fromInt(1),"maxQueued" -> Json.fromInt(1),"batchSize" -> Json.fromInt(1),
          "leaseSeconds" -> Json.fromInt(30),"pollIntervalMs" -> Json.fromInt(1000)))
      val path=directory.resolve("config.json")
      def run(json: Json,expected: Int): String =
        Files.writeString(path,json.noSpaces)
        val builder=new ProcessBuilder(Path.of(System.getProperty("java.home"),"bin","java").toString,"-cp",System.getProperty("java.class.path"),
          "manure.CheckConfigProbe","check-config",path.toString).redirectErrorStream(true)
        builder.environment().clear()
        val child=builder.start()
        try
          assert(child.waitFor(2,TimeUnit.SECONDS),"check-config touched a blocking reference or external endpoint")
          val output=Using.resource(child.getInputStream)(s => Exact.string(s.readAllBytes()))
          assertEquals(child.exitValue(),expected)
          assert(!output.contains(fifo.toString));assert(!output.contains("127.0.0.1:1"));output
        finally
          child.destroyForcibly();child.waitFor(5,TimeUnit.SECONDS)
      assert(run(config,0).contains("MANURE_CONFIG_OK"))
      val duplicate=config.mapObject(_.add("allowed_api_origins",Json.arr(Json.fromString("https://api.example.test:8443"))))
      assert(!run(duplicate,1).contains("MANURE_CONFIG_OK"))
      assert(!Files.exists(directory.resolve("nonexistent-data")))
    finally
      mkfifo.destroyForcibly()
      Files.deleteIfExists(directory.resolve("config.json"));Files.deleteIfExists(fifo);Files.deleteIfExists(directory)
  }
