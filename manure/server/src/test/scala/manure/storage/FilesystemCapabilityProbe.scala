package manure.storage

import java.nio.file.Path
import java.util.concurrent.TimeUnit
import scala.util.Using

/** Explicit loader boundary, never a shared/static or provider fallback. Test scope only. */
private[storage] final case class ProbeRuntime(bridge: PosixNative, childCommand: Vector[String])
private[storage] object ProbeRuntime:
  def shared(library: String, classpath: String): ProbeRuntime =
    require(Path.of(library).isAbsolute, "absolute shared library path required")
    require(classpath.nonEmpty, "explicit child classpath required")
    val java = Path.of(System.getProperty("java.home"), "bin", "java").toString
    ProbeRuntime(PosixNative.shared(library), Vector(java, "--enable-native-access=ALL-UNNAMED", "-cp", classpath,
      "manure.storage.FilesystemCapabilityProbe", "--shared", library))

  def linked(): ProbeRuntime =
    val executable = ProcessHandle.current().info().command().orElseThrow()
    ProbeRuntime(PosixNative.linked(), Vector(executable, "--linked"))

/** Synthetic standalone JVM/native entrypoint; runs the identical OS contracts as MUnit.
  * Successful completion exits zero. This is primitive acceptance, not durable activation.
  * Internal subprocess modes operate only on parent-owned temporary fixture paths.
  */
object FilesystemCapabilityProbe:
  def main(args: Array[String]): Unit =
    val (runtime, rest) = args.toVector match
      case "--shared" +: library +: tail => (ProbeRuntime.shared(library, System.getProperty("java.class.path")), tail)
      case "--linked" +: tail => (ProbeRuntime.linked(), tail)
      case _ => throw new IllegalArgumentException("explicit --shared /absolute/library or --linked required")
    rest match
      case Vector() =>
        println(s"RUNTIME: ${System.getProperty("java.vm.name")} ${System.getProperty("java.version")}")
        val cases = new FilesystemBehavior(runtime.bridge, runtime.childCommand).cases
        cases.foreach { (label, body) =>
          body()
          println(s"PASS: $label")
        }
        println(s"PASS: ${cases.size} filesystem contracts; no publish/recovery claim")
      case Vector("--try-root", root) =>
        try Using.resource(ConfinedDirectory.open(Path.of(root), runtime.bridge))(_.forceRootDirectory())
        catch case _: RootAlreadyClaimed | _: RootLocked => System.exit(3)
      case Vector("--reject-existing", root, leaf) =>
        Using.resource(ConfinedDirectory.open(Path.of(root), runtime.bridge)) { directory =>
          Vector(ExistingFileAccess.ReadOnly, ExistingFileAccess.ReadWrite).foreach { access =>
            try
              directory.openExistingFile(RelativeName.parse(leaf), access).close()
              throw new AssertionError("nonregular existing file was accepted")
            catch case _: java.io.IOException => ()
          }
        }
      case Vector("--hold-root", root) =>
        Using.resource(ConfinedDirectory.open(Path.of(root), runtime.bridge)) { _ =>
          println("READY")
          System.out.flush()
          Thread.sleep(60000)
        }
      case _ => throw new IllegalArgumentException("invalid synthetic probe arguments")

private[storage] object ProbeChildren:
  def start(command: Vector[String], mode: String, root: Path): Process =
    new ProcessBuilder((command ++ Vector(mode, root.toString))*).redirectErrorStream(true).start()

  def exit(command: Vector[String], mode: String, root: Path): Int =
    exit(command ++ Vector(mode, root.toString))

  def rejectExisting(command: Vector[String], root: Path, leaf: String): Int =
    exit(command ++ Vector("--reject-existing", root.toString, leaf))

  def exit(command: Vector[String]): Int =
    // No unread pipe: inherited JVM diagnostics must not deadlock a successful child.
    val child = new ProcessBuilder(command*).redirectErrorStream(true)
      .redirectOutput(ProcessBuilder.Redirect.DISCARD).start()
    try
      assert(child.waitFor(15, TimeUnit.SECONDS), "child deadline exceeded")
      child.exitValue()
    finally stop(child)

  def ready(child: Process): Unit =
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15)
    val output = new java.io.ByteArrayOutputStream
    var ready = false
    while !ready && child.isAlive && System.nanoTime() < deadline do
      val available = child.getInputStream.available()
      if available > 0 then
        val bytes = child.getInputStream.readNBytes(math.min(available, 4096))
        output.write(bytes)
        assert(output.size() <= 16384, "child readiness output bound exceeded")
        ready = output.toString(java.nio.charset.StandardCharsets.UTF_8).linesIterator.contains("READY")
      else Thread.sleep(10)
    assert(ready, "child did not acquire claim by deadline")

  def stop(child: Process): Unit =
    if child.isAlive then child.destroyForcibly()
    assert(child.waitFor(15, TimeUnit.SECONDS), "child kill/reap deadline exceeded")
    child.getInputStream.close()
    child.getOutputStream.close()
    child.getErrorStream.close()
