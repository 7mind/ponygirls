package manure.storage

/** Same real-OS contracts are run without MUnit by the actual native executable. */
final class ConfinedDirectorySuite extends munit.FunSuite:
  private val library = sys.env.getOrElse("MANURE_POSIX_LIBRARY",
    throw new IllegalArgumentException("explicit MANURE_POSIX_LIBRARY=/absolute/libmanure_posix.so required"))
  private val runtime = ProbeRuntime.shared(library)
  new FilesystemBehavior(runtime.bridge, runtime.childCommand).cases.foreach { (label, body) =>
    test(label)(body())
  }
