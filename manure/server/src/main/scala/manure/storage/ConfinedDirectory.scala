package manure.storage

import java.io.IOException
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.nio.file.*
import java.nio.file.attribute.{BasicFileAttributeView, PosixFilePermissions}
import scala.jdk.CollectionConverters.*
import scala.util.Using

/** A validated, nonempty sequence of literal names; not a URL decoder or manifest policy. */
final class RelativeName private (private[storage] val components: Vector[String]):
  override def toString: String = components.mkString("/")

object RelativeName:
  def parse(value: String): RelativeName =
    val parts = value.split("/", -1).toVector
    require(parts.forall(p => p.nonEmpty && p != "." && p != ".." &&
      !p.contains('\\') && !p.contains('\u0000')), "invalid relative name")
    new RelativeName(parts)

final class MissingPrimitive(val primitives: Vector[String])
  extends UnsupportedOperationException(primitives.mkString("Missing confined primitives: ", ", ", ""))

final class RootReplaced extends IOException("storage root identity changed")

/** Public JDK feasibility boundary, NOT a durable artifact store.
  *
  * Authority is attached to open directory descriptors, not normalized path prefixes.
  * Opening rejects symlinks in *every* root component (including parent aliases).
  * Each operation reopens the root component-wise and checks its provider fileKey;
  * subsequent operations still use the original descriptor, never the checked pathname.
  * Concurrent renames cannot redirect authority to the replacement root. An already
  * opened inode remains authorized even if moved elsewhere; this is not revocation.
  *
  * New file handles permit IO/force on a known regular inode, even after name replacement.
  * Existing-file opens are deliberately absent: SDS cannot fstat a returned channel to
  * exclude devices/FIFOs atomically. No public JDK mkdirat/physical-root exclusive claim
  * exists. Those operations fail explicitly, before filesystem effects. Directory force
  * uses a descriptor-relative dot open; provider support and crash durability must be
  * validated separately (a successful force is not a full publication boundary).
  * Not safe as a complete server backend; requireDurableStore always refuses activation.
  */
final class ConfinedDirectory private (
  rootPath: Path,
  root: SecureDirectoryStream[Path],
  identity: AnyRef
) extends AutoCloseable:
  private var closed = false

  def requireDurableStore(): Unit = throw new MissingPrimitive(ConfinedDirectory.missingPrimitives)
  /** Linux-provider feasibility operation: open dot relative to the pinned descriptor,
    * then force that channel. No absolute path or reflection fallback. Unsupported
    * providers fail explicitly. This does not force children or acquire ownership.
    */
  def forceRootDirectory(): Unit = synchronized {
    checked()
    forceAt(root)
  }

  def forceDirectory(name: RelativeName): Unit = synchronized {
    checked()
    withComponents(name.components)(forceAt)
  }

  def createDirectory(name: RelativeName): Unit = throw new MissingPrimitive(Vector("mkdirat"))
  def claimExclusiveRoot(): Unit = throw new MissingPrimitive(Vector("kernel-lifetime physical-root claim"))
  def openExistingFile(name: RelativeName): Nothing =
    throw new MissingPrimitive(Vector("descriptor fstat/type-checked existing-file open"))

  /** No overwrites or reopening by name; caller owns and must close the returned handle.
    * File force does NOT persist the parent directory entry.
    */
  def createFile(name: RelativeName): ConfinedFile = synchronized {
    checked()
    withParent(name) { (parent, leaf) =>
      val options = Set[OpenOption](StandardOpenOption.CREATE_NEW, StandardOpenOption.READ,
        StandardOpenOption.WRITE, LinkOption.NOFOLLOW_LINKS).asJava
      val channel = parent.newByteChannel(leaf, options,
        PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")))
      channel match
        case file: FileChannel => new ConfinedFile(file)
        case other =>
          other.close()
          // Do not clean up by name: another writer may have replaced it.
          throw new MissingPrimitive(Vector("FileChannel force on created handle"))
    }
  }

  /** SDS.move specifies atomic rename, not durable rename, no-replace, or a publish commit.
    * It moves the named entry itself, including a symlink; it never traverses that entry.
    * Replacing an existing destination is provider-specific. No precheck disguises this.
    */
  def move(source: RelativeName, destination: RelativeName): Unit = synchronized {
    checked()
    withParent(source) { (from, leaf) =>
      withParent(destination) { (to, target) => from.move(leaf, to, target) }
    }
  }

  /** Unlink one non-directory entry (including symlinks) without following it. */
  def deleteFile(name: RelativeName): Unit = synchronized {
    checked()
    withParent(name)((parent, leaf) => parent.deleteFile(leaf))
  }

  /** Bounded, descriptor-relative cleanup. Symlinks are unlinked, never traversed.
    * Concurrent structural changes may cause IOException and leave partial cleanup;
    * no retry through a pathname and no durability acknowledgement is made.
    */
  def removeTree(name: RelativeName, maxEntries: Int, maxDepth: Int): Unit = synchronized {
    require(maxEntries > 0 && maxDepth > 0, "positive cleanup bounds required")
    checked()
    var remaining = maxEntries
    def remove(parent: SecureDirectoryStream[Path], leaf: Path, depth: Int): Unit =
      if remaining == 0 || depth > maxDepth then throw new IOException("cleanup bound exceeded")
      remaining -= 1
      val attributes = parent.getFileAttributeView(leaf, classOf[BasicFileAttributeView],
        LinkOption.NOFOLLOW_LINKS).readAttributes()
      if attributes.isDirectory then
        Using.resource(parent.newDirectoryStream(leaf, LinkOption.NOFOLLOW_LINKS)) { child =>
          child.iterator().asScala.foreach(entry => remove(child, entry.getFileName, depth + 1))
        }
        parent.deleteDirectory(leaf)
      else parent.deleteFile(leaf)
    withParent(name)((parent, leaf) => remove(parent, leaf, 1))
  }

  private def checked(): Unit =
    if closed then throw new java.nio.channels.ClosedChannelException
    Using.resource(ConfinedDirectory.openRoot(rootPath)) { current =>
      if ConfinedDirectory.fileKey(current) != identity then throw new RootReplaced
    }

  private def withParent[A](name: RelativeName)(f: (SecureDirectoryStream[Path], Path) => A): A =
    withComponents(name.components.init)(parent =>
      f(parent, rootPath.getFileSystem.getPath(name.components.last)))

  private def withComponents[A](components: Vector[String])(f: SecureDirectoryStream[Path] => A): A =
    def walk(current: SecureDirectoryStream[Path], rest: Vector[String]): A =
      if rest.isEmpty then f(current)
      else Using.resource(current.newDirectoryStream(rootPath.getFileSystem.getPath(rest.head),
        LinkOption.NOFOLLOW_LINKS))(child => walk(child, rest.tail))
    walk(root, components)

  private def forceAt(directory: SecureDirectoryStream[Path]): Unit =
    val options = Set[OpenOption](StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS).asJava
    // Internal dot is intentional: unlike payload dots, this cannot select an ancestor.
    Using.resource(directory.newByteChannel(rootPath.getFileSystem.getPath("."), options)) { channel =>
      channel match
        case file: FileChannel => file.force(true)
        case _ => throw new MissingPrimitive(Vector("FileChannel force on directory handle"))
    }

  override def close(): Unit = synchronized {
    if !closed then
      closed = true
      root.close()
  }

object ConfinedDirectory:
  val missingPrimitives: Vector[String] = Vector(
    "mkdirat", "kernel-lifetime physical-root claim",
    "descriptor fstat/type-checked existing-file open"
  )

  /** Read-only provider preflight on the filesystem root; no payload directory required.
    * Success proves only descriptor support and a non-null fileKey, not store feasibility.
    */
  def checkProvider(anchor: Path): Unit =
    Using.resource(openRoot(anchor.toAbsolutePath.getRoot)) { directory =>
      fileKey(directory)
      ()
    }

  /** Root must already exist; does not create directories or acquire exclusive ownership. */
  def open(path: Path): ConfinedDirectory =
    val absolute = path.toAbsolutePath
    // Never normalize away dot components before no-follow traversal.
    require(absolute.iterator().asScala.forall(p => p.toString != "." && p.toString != ".."),
      "dot root components forbidden")
    val directory = openRoot(absolute)
    try new ConfinedDirectory(absolute, directory, fileKey(directory))
    catch
      case error: Throwable =>
        try directory.close()
        catch case closeError: Throwable => error.addSuppressed(closeError)
        throw error

  private def fileKey(directory: SecureDirectoryStream[Path]): AnyRef =
    val key = directory.getFileAttributeView(classOf[BasicFileAttributeView]).readAttributes().fileKey()
    if key == null then throw new MissingPrimitive(Vector("stable physical directory fileKey"))
    key

  private def openRoot(path: Path): SecureDirectoryStream[Path] =
    val initial = Files.newDirectoryStream(path.getRoot)
    val secure = initial match
      case directory: SecureDirectoryStream[Path] => directory
      case other =>
        other.close()
        throw new MissingPrimitive(Vector(s"SecureDirectoryStream (provider returned ${other.getClass.getName})"))
    var current = secure
    try
      path.iterator().asScala.foreach { component =>
        val next = current.newDirectoryStream(component, LinkOption.NOFOLLOW_LINKS)
        try current.close()
        catch
          case error: Throwable =>
            try next.close()
            catch case closeError: Throwable => error.addSuppressed(closeError)
            throw error
        current = next
      }
      current
    catch
      case error: Throwable =>
        try current.close()
        catch case closeError: Throwable => error.addSuppressed(closeError)
        throw error

/** A newly created, pinned regular file. No methods resolve its old pathname again.
  * Methods are serialized per handle; close ends authority. Not a durable receipt.
  */
final class ConfinedFile private[storage] (channel: FileChannel) extends AutoCloseable:
  def write(offset: Long, bytes: Array[Byte]): Unit = synchronized {
    ensureOpen()
    require(offset >= 0 && offset <= Long.MaxValue - bytes.length, "invalid write range")
    val buffer = ByteBuffer.wrap(bytes)
    var position = offset
    while buffer.hasRemaining do
      val count = channel.write(buffer, position)
      if count <= 0 then throw new IOException("file write made no progress")
      position += count
  }

  def read(offset: Long, maxBytes: Int): Array[Byte] = synchronized {
    ensureOpen()
    require(offset >= 0 && maxBytes >= 0 && offset <= Long.MaxValue - maxBytes, "invalid read range")
    val buffer = ByteBuffer.allocate(maxBytes)
    var position = offset
    var eof = false
    while buffer.hasRemaining && !eof do
      val count = channel.read(buffer, position)
      if count == -1 then eof = true
      else if count == 0 then throw new IOException("file read made no progress")
      else position += count
    java.util.Arrays.copyOf(buffer.array(), buffer.position())
  }

  private def ensureOpen(): Unit =
    if !channel.isOpen then throw new java.nio.channels.ClosedChannelException

  /** Force the open inode only; never substitutes for parent-directory fsync. */
  def forceFile(): Unit = synchronized { channel.force(true) }
  override def close(): Unit = synchronized { channel.close() }
