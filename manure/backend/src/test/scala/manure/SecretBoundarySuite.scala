package manure

import java.nio.file.{Files,Path}
import java.util.concurrent.TimeUnit
import scala.util.Using
import munit.FunSuite

object SecretFileProbe:
  def main(args: Array[String]): Unit =
    println("READ_STARTED")
    try
      SecretCodec.readHash(Path.of(args(0)))
      sys.exit(0)
    catch case _: Exception => println("REFUSED"); sys.exit(3)

/** Regression, real owned no-writer FIFO in a bounded child. No ambient
  * credentials/network/process environment are inherited or inspected.
  */
final class SecretBoundarySuite extends FunSuite:
  test("server hash-file reader rejects FIFO without waiting for a writer") {
    val directory=Files.createTempDirectory("manure-secret-boundary-")
    val fifo=directory.resolve("owned-fifo")
    val create=new ProcessBuilder("mkfifo",fifo.toString).start()
    try
      assert(create.waitFor(5,TimeUnit.SECONDS));assertEquals(create.exitValue(),0)
      val java=Path.of(System.getProperty("java.home"),"bin","java").toString
      val builder=new ProcessBuilder(java,"-cp",System.getProperty("java.class.path"),"manure.SecretFileProbe",fifo.toString).redirectErrorStream(true)
      builder.environment().clear()
      val child=builder.start()
      try
        assert(child.waitFor(2,TimeUnit.SECONDS),"reader blocked on a no-writer FIFO")
        val output=Using.resource(child.getInputStream)(stream => Exact.string(stream.readAllBytes()))
        assert(output.contains("READ_STARTED"));assert(output.contains("REFUSED"));assertEquals(child.exitValue(),3)
      finally
        child.destroyForcibly();child.waitFor(5,TimeUnit.SECONDS)
    finally
      create.destroyForcibly();Files.deleteIfExists(fifo);Files.deleteIfExists(directory)
  }
  test("managed symlink reference allowed; oversized/CRLF/malformed hashes refuse bounded") {
    val directory=Files.createTempDirectory("manure-secret-reference-")
    val target=directory.resolve("resolved");val reference=directory.resolve("reference")
    try
      Files.writeString(target,"a"*64+"\n");Files.createSymbolicLink(reference,target)
      assertEquals(SecretCodec.readHash(reference),"a"*64)
      Vector("a"*64+"\r\n","a"*66,"a"*63," A"*40).foreach { invalid =>
        Files.writeString(target,invalid)
        intercept[Exception](SecretCodec.readHash(reference))
      }
    finally
      Files.deleteIfExists(reference);Files.deleteIfExists(target);Files.deleteIfExists(directory)
  }
