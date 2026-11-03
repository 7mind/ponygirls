package manure.storage

import java.io.IOException
import java.nio.CharBuffer
import java.nio.channels.ClosedChannelException
import java.nio.charset.{Charset, CodingErrorAction, StandardCharsets}
import java.nio.file.*
import java.security.MessageDigest
import scala.jdk.CollectionConverters.*

/** Literal UTF-8 components, not URL decoding, Unicode normalization or manifest policy. */
final class RelativeName private (private[storage] val components: Vector[Array[Byte]], val value: String):
  override def toString: String = value

object RelativeName:
  def parse(value: String): RelativeName =
    val parts = value.split("/", -1).toVector
    require(parts.forall(p => p.nonEmpty && p != "." && p != ".." &&
      !p.contains('\\') && !p.contains('\u0000')), "invalid relative name")
    new RelativeName(parts.map(PosixErrors.utf8), value)

final class RootReplaced extends IOException("storage root identity changed")
final class RootAlreadyClaimed extends IOException("physical storage root already claimed in this network namespace")
final class OpenFileHandles extends IOException("close refused: storage file handles remain open")
final class OpenRootLeases extends IOException("close refused: storage operation leases remain open")

/** A service/worker lifetime reservation. Validate immediately before metadata effects;
  * acquiring a lease alone is not permission to use a subsequently replaced root.
  */
final class RootLease private[storage] (
  validated: (() => Any) => Any,
  released: () => Unit
) extends AutoCloseable:
  private var closed = false
  def run[A](body: => A): A = synchronized {
    if closed then throw new ClosedChannelException
    validated(() => body).asInstanceOf[A]
  }
  def validate(): Unit = run(())
  override def close(): Unit = synchronized {
    if !closed then
      closed = true
      released()
  }

final case class TreeEntry(name: RelativeName, directory: Boolean)

enum ExistingFileAccess:
  case ReadOnly, ReadWrite

/** Linux descriptor authority, not a complete durable artifact store.
  *
  * The explicitly injected native bridge owns no-follow traversal, type-safe pinned regular
  * opens (O_PATH + trusted procfs), mkdirat, fsync, renameat and raw-name unlink. Opening
  * automatically claims the physical dev/ino in the current Linux network namespace.
  * New directory operations revalidate the configured root before using the original fd.
  * File handles remain pinned after renames/unlink; root close refuses until all close.
  * Same-UID hostile inode moves/hardlinks are outside this boundary. These primitives
  * do not implement publication, metadata transactions or crash recovery.
  */
final class ConfinedDirectory private (
  bridge: PosixNative,
  rootPath: Array[Byte],
  root: Int,
  identity: Vector[Long],
  claim: Int
) extends AutoCloseable:
  import PosixErrors.call
  private var closed = false
  private var files = 0
  private var leases = 0

  /** Root ownership spans all DB transactions, file work and workers, not merely
    * open payload handles. Close refusal retains both the root and physical claim.
    */
  def lease(): RootLease = synchronized {
    checked()
    leases += 1
    new RootLease(
      body => synchronized { checked(); body() },
      () => synchronized { leases -= 1 }
    )
  }

  /** Strict, bounded no-follow topology inventory for publication. Invalid UTF-8,
    * symlinks and special inodes fail closed; cleanup still uses the raw-name API.
    * Enumeration is not a snapshot against hostile same-UID inode manipulation.
    */
  def tree(name: RelativeName, maxEntries: Int, maxDepth: Int): Vector[TreeEntry] = synchronized {
    require(maxEntries > 0 && maxDepth > 0, "positive topology bounds required")
    checked()
    val found = scala.collection.mutable.ArrayBuffer.empty[TreeEntry]
    withComponents(name.components) { start =>
      def visit(fd: Int, prefix: String, depth: Int): Unit =
        if depth > maxDepth then throw new IOException("topology bound exceeded")
        val entries = call(bridge.entries(fd, maxEntries - found.size + 1))
        if entries.length > maxEntries - found.size then throw new IOException("topology bound exceeded")
        entries.foreach { raw =>
          val decoder = StandardCharsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
          val leaf = try decoder.decode(java.nio.ByteBuffer.wrap(raw)).toString
            catch case _: java.nio.charset.CharacterCodingException => throw new IOException("invalid payload name")
          val relative = RelativeName.parse(if prefix.isEmpty then leaf else prefix + "/" + leaf)
          val kind = call(bridge.kind(fd, raw))
          if kind != PosixNative.DIRECTORY && kind != PosixNative.REGULAR then
            throw new IOException("invalid payload topology")
          if found.size >= maxEntries then throw new IOException("topology bound exceeded")
          found += TreeEntry(relative, kind == PosixNative.DIRECTORY)
          if kind == PosixNative.DIRECTORY then
            withFd(call(bridge.openDirectory(fd, raw)))(child => visit(child, relative.value, depth + 1))
        }
      visit(start, "", 1)
    }
    found.toVector
  }

  def physicalIdentity: Vector[Long] = synchronized { checked(); identity }

  def forceRootDirectory(): Unit = synchronized {
    checked()
    call(bridge.sync(root))
  }

  def forceDirectory(name: RelativeName): Unit = synchronized {
    checked()
    withComponents(name.components)(fd => call(bridge.sync(fd)))
  }

  /** Create one directory; its parent must already exist. No recursive path fallback. */
  def createDirectory(name: RelativeName): Unit = synchronized {
    checked()
    withParent(name)((parent, leaf) => call(bridge.mkdir(parent, leaf)))
  }

  /** CREATE_NEW, 0600; caller owns the pinned regular handle. */
  def createFile(name: RelativeName): ConfinedFile = synchronized {
    checked()
    acquireFile(name)((parent, leaf) => bridge.createFile(parent, leaf))
  }

  /** Existing regular inode only; no FIFO/device open to discover its type.
    * Requires the native bridge's trusted procfs fd-reopen facility, with no fallback.
    */
  def openExistingFile(name: RelativeName, access: ExistingFileAccess): ConfinedFile = synchronized {
    checked()
    acquireFile(name)((parent, leaf) => bridge.openFile(parent, leaf, access == ExistingFileAccess.ReadWrite))
  }

  private def acquireFile(name: RelativeName)(open: (Int, Array[Byte]) => Int): ConfinedFile =
    var fd = -1
    try
      // Assign before temporary parent fds close: a close failure must not leak the file.
      withParent(name) { (parent, leaf) => fd = call(open(parent, leaf)) }
      val file = new ConfinedFile(bridge, fd, () => synchronized { files -= 1 })
      files += 1
      file
    catch
      case error: Throwable =>
        if fd >= 0 then PosixErrors.suppress(error)(call(bridge.close(fd)))
        throw error

  /** Atomic entry rename, including symlink entries. Replaces destinations under POSIX
    * rules; not no-replace, not durable rename, and not a publish acknowledgement.
    */
  def move(source: RelativeName, destination: RelativeName): Unit = synchronized {
    checked()
    withParent(source) { (from, leaf) =>
      withParent(destination) { (to, target) => call(bridge.move(from, leaf, to, target)) }
    }
  }

  def deleteFile(name: RelativeName): Unit = synchronized {
    checked()
    withParent(name)((parent, leaf) => call(bridge.unlink(parent, leaf, false)))
  }

  /** Inclusive finite entry/depth limits; the named root counts as one. Names returned by
    * readdir remain raw bytes (including invalid UTF-8), never decoded and re-encoded.
    * Structural races can fail or leave partial cleanup; no pathname retry or link walk.
    */
  def removeTree(name: RelativeName, maxEntries: Int, maxDepth: Int): Unit = synchronized {
    require(maxEntries > 0 && maxDepth > 0, "positive cleanup bounds required")
    checked()
    withParent(name)((parent, leaf) => removeEntry(parent, leaf, maxEntries, maxDepth))
  }

  /** Exclusive-owner orphan cleanup. Retained names compare exact raw UTF-8
    * bytes; invalid UTF-8 names can be removed without decode/re-encode. Callers
    * must revalidate metadata under their process/DB exclusion before invoking.
    * Enumeration and each removed tree are independently bounded; overflow is
    * an explicit failure, never a claim that the pass completed.
    */
  def cleanupChildren(name: RelativeName, keep: Set[String], maxEntries: Int, maxDepth: Int): Int = synchronized {
    require(maxEntries > 0 && maxDepth > 0, "positive cleanup bounds required")
    checked()
    val retained = keep.toVector.map(PosixErrors.utf8)
    withComponents(name.components) { parent =>
      val entries = call(bridge.entries(parent, maxEntries + 1))
      if entries.length > maxEntries then throw new IOException("cleanup bound exceeded")
      var removed = 0
      entries.foreach { leaf =>
        if !retained.exists(java.util.Arrays.equals(_, leaf)) then
          removeEntry(parent, leaf, maxEntries, maxDepth)
          removed += 1
      }
      if removed > 0 then call(bridge.sync(parent))
      removed
    }
  }

  private def removeEntry(parent: Int, leaf: Array[Byte], maxEntries: Int, maxDepth: Int): Unit =
    // Reserve the root, then reserve every enumerated child before descending. The
    // combined raw-name arrays, not just each individual batch, stay within the budget.
    var remaining = maxEntries - 1
    final class Frame(val parent: Int, val leaf: Array[Byte], val fd: Int,
      val depth: Int, val entries: Array[Array[Byte]]):
      var next = 0
    val stack = scala.collection.mutable.ArrayBuffer.empty[Frame]
    def visit(parent: Int, leaf: Array[Byte], depth: Int): Unit =
      if depth > maxDepth then throw new IOException("cleanup bound exceeded")
      if call(bridge.kind(parent, leaf)) == PosixNative.DIRECTORY then
        val child = call(bridge.openDirectory(parent, leaf))
        try
          // One extra entry detects overflow, never silently truncates enumeration.
          val entries = call(bridge.entries(child, remaining + 1))
          if entries.length > remaining then throw new IOException("cleanup bound exceeded")
          remaining -= entries.length
          stack += new Frame(parent, leaf, child, depth, entries)
        catch
          case error: Throwable =>
            PosixErrors.suppress(error)(call(bridge.close(child)))
            throw error
      else call(bridge.unlink(parent, leaf, false))
    {
      try
        visit(parent, leaf, 1)
        while stack.nonEmpty do
          val frame = stack.last
          if frame.next < frame.entries.length then
            if frame.depth >= maxDepth then throw new IOException("cleanup bound exceeded")
            val entry = frame.entries(frame.next)
            frame.next += 1
            visit(frame.fd, entry, frame.depth + 1)
          else
            // Remove ownership before close, including a close that reports an error.
            stack.remove(stack.size - 1)
            call(bridge.close(frame.fd))
            call(bridge.unlink(frame.parent, frame.leaf, true))
      catch
        case error: Throwable =>
          stack.reverseIterator.foreach(frame => PosixErrors.suppress(error)(call(bridge.close(frame.fd))))
          throw error
    }

  private def checked(): Unit =
    if closed then throw new ClosedChannelException
    withFd(call(bridge.openRoot(rootPath))) { current =>
      if call(bridge.identity(current)).toVector != identity then throw new RootReplaced
    }

  private def withParent[A](name: RelativeName)(f: (Int, Array[Byte]) => A): A =
    withComponents(name.components.init)(parent => f(parent, name.components.last))

  private def withComponents[A](components: Vector[Array[Byte]])(f: Int => A): A =
    // Iterative traversal avoids stack exhaustion from deep untrusted relative names.
    var current = root
    var owned = false
    try
      components.foreach { component =>
        val next = call(bridge.openDirectory(current, component))
        if owned then
          try call(bridge.close(current))
          catch
            case error: Throwable =>
              // close is consumed even on error; never retry a possibly reused fd.
              owned = false
              PosixErrors.suppress(error)(call(bridge.close(next)))
              throw error
        current = next
        owned = true
      }
      val result = f(current)
      if owned then
        owned = false
        call(bridge.close(current))
      result
    catch
      case error: Throwable =>
        if owned then PosixErrors.suppress(error)(call(bridge.close(current)))
        throw error

  private def withFd[A](fd: Int)(f: Int => A): A = PosixErrors.withFd(bridge, fd)(f)

  /** Refusal retains root and claim. Once closing starts, both fds are consumed exactly
    * once even if close reports an error; the error is propagated, never called success.
    * All root work is serialized; file work retains ownership through its handle count.
    */
  override def close(): Unit = synchronized {
    if !closed then
      if files != 0 then throw new OpenFileHandles
      if leases != 0 then throw new OpenRootLeases
      closed = true
      var failure: Throwable = null
      try call(bridge.close(root))
      catch case error: Throwable => failure = error
      try call(bridge.close(claim))
      catch
        case error: Throwable =>
          if failure == null then failure = error else failure.addSuppressed(error)
      if failure != null then throw failure
  }

object ConfinedDirectory:
  /** Existing root only. Claim precedes payload effects. Claim names interoperate with
    * Python: manure- + SHA256(unsigned decimal dev + ':' + unsigned decimal ino).
    * Abstract AF_UNIX claims are confined to this Linux network namespace, not global.
    */
  def open(path: Path, bridge: PosixNative): ConfinedDirectory =
    require(path.getFileSystem == FileSystems.getDefault, "default filesystem required")
    // Path's roundtrip must use the same byte encoding as the explicit native ABI.
    // A non-UTF8 Unix filesystem charset could otherwise roundtrip a different inode.
    require(Option(System.getProperty("sun.jnu.encoding")).map(Charset.forName)
      .contains(StandardCharsets.UTF_8), "UTF-8 filesystem filename encoding required")
    val absolute = path.toAbsolutePath
    // UnixPath may retain undecodable raw bytes which toString replaces with U+FFFD.
    // Reject before native open: encoding that display string could claim a sibling inode.
    require(absolute.getFileSystem.getPath(absolute.toString) == absolute,
      "root must round-trip through its Unicode representation")
    require(absolute.iterator().asScala.forall(p => p.toString != "." && p.toString != ".."),
      "dot root components forbidden")
    val encoded = PosixErrors.utf8(absolute.toString)
    val root = PosixErrors.call(bridge.openRoot(encoded))
    var claim = -1
    try
      val identity = PosixErrors.call(bridge.identity(root)).toVector
      if identity.size != 2 then throw new IOException("invalid physical root identity")
      val key = identity.map(java.lang.Long.toUnsignedString).mkString(":")
      val digest = MessageDigest.getInstance("SHA-256").digest(PosixErrors.utf8(key))
      val claimName = "manure-" + digest.map(b => f"${b & 0xff}%02x").mkString
      claim = PosixErrors.call(bridge.claim(PosixErrors.utf8(claimName)))
      new ConfinedDirectory(bridge, encoded, root, identity, claim)
    catch
      case error: Throwable =>
        if claim >= 0 then PosixErrors.suppress(error)(PosixErrors.call(bridge.close(claim)))
        PosixErrors.suppress(error)(PosixErrors.call(bridge.close(root)))
        throw error

/** Pinned regular inode; no method resolves the old payload pathname. */
final class ConfinedFile private[storage] (
  bridge: PosixNative,
  fd: Int,
  released: () => Unit
) extends AutoCloseable:
  private var closed = false
  private def ensureOpen(): Unit = if closed then throw new ClosedChannelException

  def write(offset: Long, bytes: Array[Byte]): Unit = synchronized {
    ensureOpen()
    require(offset >= 0 && offset <= Long.MaxValue - bytes.length, "invalid write range")
    PosixErrors.call(bridge.write(fd, offset, bytes))
  }

  def read(offset: Long, maxBytes: Int): Array[Byte] = synchronized {
    ensureOpen()
    require(offset >= 0 && maxBytes >= 0 && offset <= Long.MaxValue - maxBytes, "invalid read range")
    PosixErrors.call(bridge.read(fd, offset, maxBytes))
  }

  def size(): Long = synchronized {
    ensureOpen()
    PosixErrors.call(bridge.size(fd))
  }

  /** Exact ftruncate semantics: may shrink or extend; requires a writable handle. */
  def truncate(size: Long): Unit = synchronized {
    ensureOpen()
    require(size >= 0, "invalid file size")
    PosixErrors.call(bridge.truncate(fd, size))
  }

  def forceFile(): Unit = synchronized {
    ensureOpen()
    PosixErrors.call(bridge.sync(fd))
  }

  override def close(): Unit = synchronized {
    if !closed then
      closed = true
      try PosixErrors.call(bridge.close(fd))
      finally released() // Linux close consumes the fd even when reporting an error.
  }

private[storage] object PosixErrors:
  def utf8(value: String): Array[Byte] =
    require(!value.contains('\u0000'), "NUL forbidden")
    val encoder = StandardCharsets.UTF_8.newEncoder()
      .onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
    try
      val bytes = encoder.encode(CharBuffer.wrap(value))
      val result = new Array[Byte](bytes.remaining())
      bytes.get(result)
      result
    catch case _: java.nio.charset.CharacterCodingException =>
      throw new IllegalArgumentException("invalid Unicode name")

  /** Fixed labels only: never include payloads, user names, root paths or native strerror. */
  def call[A](body: => A): A =
    try body
    catch
      case failure: NativeFailure =>
        val mapped: IOException = failure.errno() match
          case 1 | 13 => new AccessDeniedException("storage entry")
          case 2 => new NoSuchFileException("storage entry")
          case 17 => new FileAlreadyExistsException("storage entry")
          case 20 => new NotDirectoryException("storage entry")
          case 39 => new DirectoryNotEmptyException("storage entry")
          case 40 => new FileSystemLoopException("storage entry")
          case 98 => new RootAlreadyClaimed
          case n => new IOException(s"POSIX storage operation failed (errno $n)")
        throw mapped

  def suppress(error: Throwable)(cleanup: => Unit): Unit =
    try cleanup
    catch case closeError: Throwable => error.addSuppressed(closeError)

  def withFd[A](bridge: PosixNative, fd: Int)(f: Int => A): A =
    val result = try f(fd)
    catch
      case error: Throwable =>
        suppress(error)(call(bridge.close(fd)))
        throw error
    call(bridge.close(fd))
    result
