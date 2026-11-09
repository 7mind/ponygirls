package manure.storage

import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.util.concurrent.TimeUnit
import scala.jdk.CollectionConverters.*
import scala.util.Using

final class ProbeRuntimeClasspathSuite extends munit.FunSuite:
  private val childDeadlineSeconds = 15
  private val maximumOutputBytes = 16 * 1024

  test("shared probe child starts with the explicit test runtime classpath") {
    val library = sys.env.getOrElse("MANURE_POSIX_LIBRARY",
      throw new IllegalArgumentException("explicit MANURE_POSIX_LIBRARY required"))
    val runtime = ProbeRuntime.shared(library, sys.props.getOrElse("manure.test.childClasspath",
      throw new IllegalArgumentException("explicit manure.test.childClasspath required")))
    val root = Files.createTempDirectory("manure-probe-classpath-")
    val child = ProbeChildren.start(runtime.childCommand, "--try-root", root)
    try
      assert(child.waitFor(childDeadlineSeconds, TimeUnit.SECONDS), "probe child deadline exceeded")
      val output = new String(child.getInputStream.readNBytes(maximumOutputBytes + 1), StandardCharsets.UTF_8)
      assert(output.getBytes(StandardCharsets.UTF_8).length <= maximumOutputBytes, "probe child output bound exceeded")
      val classpath = runtime.childCommand(runtime.childCommand.indexOf("-cp") + 1)
      assertEquals(child.exitValue(), 0, s"child classpath=$classpath\nchild output=$output")
    finally
      ProbeChildren.stop(child)
      Using.resource(Files.walk(root))(_.iterator().asScala.toVector.reverse.foreach(Files.delete))
  }
