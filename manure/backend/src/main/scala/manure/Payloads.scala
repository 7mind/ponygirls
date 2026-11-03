package manure

import manure.storage.*
import java.io.IOException
import java.nio.file.{FileAlreadyExistsException, NoSuchFileException}
import java.security.MessageDigest
import scala.util.Using
import io.circe.Json

/** All methods are synchronous blocking work; application invokes them only on
  * the JDBC blocking callback or IO.blocking. Never resolves a payload using JDK
  * pathname I/O. Byte transfer stays bounded by one configured chunk/read block.
  */
trait Payloads:
  def initialize(): Unit
  def stage(a: Artifact): Unit
  def sidecar(a: Artifact): Unit
  def write(a: Artifact, path: String, offset: Long, bytes: Array[Byte]): Unit
  def receiptValid(a: Artifact, r: Receipt): Boolean
  def truncateTo(a: Artifact, path: String, end: Long): Unit
  def complete(a: Artifact, live: Boolean): Boolean
  def structureComplete(a: Artifact, live: Boolean): Boolean
  def hasLive(a: Artifact): Boolean
  def publish(a: Artifact, fault: String => Unit): Unit
  def forceLive(a: Artifact, fault: String => Unit): Unit
  def cleanupStage(a: Artifact): Unit
  def cleanup(a: Artifact): Unit
  def open(a: Artifact, path: String): ConfinedFile

final class FilesystemPayloads(root: ConfinedDirectory, limits: Limits) extends Payloads:
  private def name(value: String): RelativeName = RelativeName.parse(value)
  private def prefix(a: Artifact, live: Boolean): String =
    Require(a.id.matches("[0-9a-f]{32}"), "unavailable")
    if live then "live/" + a.id else "staging/" + a.id + "/tree"
  private def directory(value: String): Unit =
    try
      root.createDirectory(name(value))
      root.forceDirectory(name(value))
      forceParent(value)
    catch case _: FileAlreadyExistsException => root.forceDirectory(name(value))
  private def directories(value: String): Unit =
    val parts = value.split("/")
    parts.indices.foreach(i => directory(parts.take(i + 1).mkString("/")))
  private def forceParent(value: String): Unit =
    val end = value.lastIndexOf('/')
    if end < 0 then root.forceRootDirectory() else root.forceDirectory(name(value.substring(0, end)))
  private def absent(body: => Unit): Unit = try body catch case _: NoSuchFileException => ()
  private def remove(value: String): Unit = absent {
    root.removeTree(name(value), limits.cleanupEntries, 68)
    forceParent(value)
  }
  def initialize(): Unit =
    directory("staging"); directory("live"); root.forceRootDirectory()
  def stage(a: Artifact): Unit =
    val base = prefix(a, false)
    directories(base)
    a.manifest.foreach { e =>
      val path = base + "/" + e.path
      if e.directory then directories(path)
      else
        directories(path.substring(0,path.lastIndexOf('/')))
        if e.size == 0 then
          try Using.resource(root.createFile(name(path)))(_.forceFile())
          catch case _: FileAlreadyExistsException =>
            Using.resource(root.openExistingFile(name(path), ExistingFileAccess.ReadOnly)) { file =>
              Require(file.size() == 0, "invalid-path")
            }
          forceParent(path)
    }
    root.forceDirectory(name(base)); forceParent(base)
  def sidecar(a: Artifact): Unit =
    val target = "staging/" + a.id + ".json"
    val temporary = "staging/" + a.id + ".tmp"
    val value = Json.obj("artifact_id" -> Json.fromString(a.id), "owner" -> Json.fromString(a.createdByUser),
      "token" -> Json.fromString(a.createdByToken), "activity" -> Json.fromDoubleOrNull(a.lastActivityAt),
      "manifest" -> io.circe.parser.parse(a.manifestJson).getOrElse(throw DomainError("unavailable"))).noSpaces
    absent(root.deleteFile(name(temporary)))
    Using.resource(root.createFile(name(temporary))) { file => file.write(0, Exact.utf8(value)); file.forceFile() }
    root.move(name(temporary), name(target)); root.forceDirectory(name("staging"))
  def write(a: Artifact, path: String, offset: Long, bytes: Array[Byte]): Unit =
    val target = prefix(a, false) + "/" + path
    directories(target.substring(0,target.lastIndexOf('/')))
    val file = try root.openExistingFile(name(target), ExistingFileAccess.ReadWrite)
      catch case _: NoSuchFileException => root.createFile(name(target))
    Using.resource(file) { f => f.write(offset, bytes); f.forceFile() }
    forceParent(target)
    root.forceDirectory(name(prefix(a, false)))
  def receiptValid(a: Artifact, r: Receipt): Boolean =
    if r.length <= 0 || r.length > limits.chunkBytes || r.offset < 0 then false
    else try Using.resource(root.openExistingFile(name(prefix(a,false) + "/" + r.path), ExistingFileAccess.ReadOnly)) { file =>
      val bytes = file.read(r.offset, r.length.toInt)
      bytes.length == r.length && SecretCodec.sha256(bytes) == r.sha256
    }
    catch case _: IOException => false
  def truncateTo(a: Artifact, path: String, end: Long): Unit = absent {
    Using.resource(root.openExistingFile(name(prefix(a,false) + "/" + path), ExistingFileAccess.ReadWrite)) { file =>
      if file.size() > end then { file.truncate(end); file.forceFile() }
    }
  }
  def complete(a: Artifact, live: Boolean): Boolean = verified(a,live,true)
  def structureComplete(a: Artifact, live: Boolean): Boolean = verified(a,live,false)
  private def verified(a: Artifact, live: Boolean, hashes: Boolean): Boolean =
    val base = prefix(a, live)
    try
      val topology = root.tree(name(base), limits.cleanupEntries, 65).map(e => e.name.value -> e.directory).toMap
      a.manifest.forall { e =>
        if e.directory then topology.get(e.path).contains(true)
        else topology.get(e.path).contains(false) && Using.resource(root.openExistingFile(name(base + "/" + e.path), ExistingFileAccess.ReadOnly)) { file =>
          if file.size() != e.size then false
          else if !hashes then true
          else
            val hash = MessageDigest.getInstance("SHA-256")
            var offset = 0L
            while offset < e.size do
              val bytes = file.read(offset, math.min(1048576L,e.size-offset).toInt)
              Require(bytes.nonEmpty, "unavailable"); hash.update(bytes); offset += bytes.length
            SecretCodec.hex(hash.digest()) == e.sha256
        }
      }
    catch case _: IOException | _: DomainError => false
  def hasLive(a: Artifact): Boolean =
    try { root.forceDirectory(name(prefix(a,true))); true }
    catch case _: NoSuchFileException => false
  private def forceTree(a: Artifact, live: Boolean): Unit =
    val base = prefix(a,live)
    val topology = root.tree(name(base),limits.cleanupEntries,65)
    topology.filterNot(_.directory).foreach { e =>
      Using.resource(root.openExistingFile(name(base + "/" + e.name.value), ExistingFileAccess.ReadOnly))(_.forceFile())
    }
    topology.filter(_.directory).sortBy(_.name.value.count(_ == '/')).reverse.foreach(e => root.forceDirectory(name(base + "/" + e.name.value)))
    root.forceDirectory(name(base))
  def publish(a: Artifact, fault: String => Unit): Unit =
    forceTree(a,false); fault("after_tree_fsync")
    remove(prefix(a,true))
    root.move(name(prefix(a,false)),name(prefix(a,true)))
    fault("after_rename")
    // Both rename parents, not only destination, must be durable.
    root.forceDirectory(name("staging/" + a.id)); root.forceDirectory(name("staging"))
    forceLive(a,fault)
  def forceLive(a: Artifact, fault: String => Unit): Unit =
    forceTree(a,true)
    fault("fsync_live_dir"); root.forceDirectory(name("live"))
    fault("fsync_data_dir"); root.forceRootDirectory()
  def cleanupStage(a: Artifact): Unit =
    remove("staging/" + a.id)
    absent { root.deleteFile(name("staging/" + a.id + ".json")); root.forceDirectory(name("staging")) }
    absent { root.deleteFile(name("staging/" + a.id + ".tmp")); root.forceDirectory(name("staging")) }
  def cleanup(a: Artifact): Unit =
    remove(prefix(a,true)); cleanupStage(a)
  def open(a: Artifact,path: String): ConfinedFile =
    Manifest.path(path)
    Require(a.manifest.exists(e => !e.directory && e.path == path), "not-found")
    val file = root.openExistingFile(name(prefix(a,true) + "/" + path), ExistingFileAccess.ReadOnly)
    try
      Require(file.size() == a.manifest.find(_.path == path).get.size, "unavailable")
      file
    catch case error: Throwable =>
      try file.close() catch case closeError: Throwable => error.addSuppressed(closeError)
      throw error
