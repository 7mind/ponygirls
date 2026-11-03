package ponygirls.runtime

import java.nio.file.{Files, Path}
import java.util.concurrent.TimeUnit
import munit.FunSuite

/** Separate process is essential: the old blocking FIFO read cannot be canceled by IO. */
object CredentialBoundaryProbe {
  def main(args: Array[String]): Unit = try {
    CredentialFile.read(Path.of(args(0)))
    System.exit(0)
  } catch { case _: RuntimeFailure => System.exit(17) }
}
final class CredentialBoundarySuite extends FunSuite {
  test("FIFO credential reference fails before blocking open (bounded subprocess)") {
    val directory = Files.createTempDirectory("runtime-fifo-")
    val fifo = directory.resolve("fifo")
    val output = directory.resolve("probe.log")
    var child: Process = null
    try {
      assertEquals(new ProcessBuilder("mkfifo", fifo.toString).start().waitFor(), 0)
      val sources = List(getClass, classOf[RuntimeFailure], classOf[scala.Option[?]])
        .map(_.getProtectionDomain.getCodeSource.getLocation.getPath).distinct.mkString(java.io.File.pathSeparator)
      child = new ProcessBuilder(Path.of(System.getProperty("java.home"), "bin", "java").toString,
        "-cp", sources, "ponygirls.runtime.CredentialBoundaryProbe", fifo.toString)
        .redirectErrorStream(true).redirectOutput(output.toFile).start()
      val finished = child.waitFor(3, TimeUnit.SECONDS)
      assert(finished, "credential read hung on FIFO (bounded child killed by fixture)")
      assertEquals(child.exitValue(), 17, Files.readString(output))
    } finally {
      if (child != null && child.isAlive) { child.destroyForcibly(); child.waitFor(3, TimeUnit.SECONDS) }
      Files.deleteIfExists(fifo); Files.deleteIfExists(output); Files.delete(directory)
    }
  }
  test("trusted operator-managed secret symlink and explicit credential copy both work") {
    val directory = Files.createTempDirectory("runtime-managed-secret-")
    val secret = directory.resolve("agenix-generation-secret")
    val reference = directory.resolve("agenix-stable-path")
    val copied = directory.resolve("service-credential")
    try {
      Files.writeString(secret, "operator-password\n")
      Files.createSymbolicLink(reference, secret)
      assertEquals(CredentialFile.read(reference), "operator-password")
      // Explicit LoadCredential copies remain supported as well.
      Files.copy(reference, copied)
      assertEquals(CredentialFile.read(copied), "operator-password")
    } finally {
      Files.deleteIfExists(copied); Files.deleteIfExists(reference); Files.deleteIfExists(secret); Files.delete(directory)
    }
  }
}
