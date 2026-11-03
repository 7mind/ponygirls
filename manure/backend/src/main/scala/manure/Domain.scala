package manure

import java.nio.charset.{CodingErrorAction, StandardCharsets}
import java.nio.{ByteBuffer, CharBuffer}
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.Locale
import io.circe.{Json, parser}

final case class DomainError(code: String) extends RuntimeException(code)
object Require:
  def apply(ok: Boolean, code: String): Unit = if !ok then throw DomainError(code)

/** Bytes, names and source timestamps have independent representations. Never put
  * arbitrary source strings into PostgreSQL text (NUL is valid stored metadata).
  */
object Exact:
  def utf8(value: String): Array[Byte] =
    val encoded = StandardCharsets.UTF_8.newEncoder().onMalformedInput(CodingErrorAction.REPORT)
      .onUnmappableCharacter(CodingErrorAction.REPORT).encode(CharBuffer.wrap(value))
    val bytes = new Array[Byte](encoded.remaining()); encoded.get(bytes); bytes
  def string(value: Array[Byte]): String = StandardCharsets.UTF_8.newDecoder()
    .onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
    .decode(ByteBuffer.wrap(value)).toString
  def timestamp(value: Double): Array[Byte] = ByteBuffer.allocate(8).putLong(java.lang.Double.doubleToRawLongBits(value)).array()
  def timestamp(value: Array[Byte]): Double =
    Require(value.length == 8, "unavailable")
    java.lang.Double.longBitsToDouble(ByteBuffer.wrap(value).getLong())
  def displayTime(value: Double): String = DateTimeFormatter.ISO_INSTANT.format(Instant.ofEpochSecond(math.floor(value).toLong))
  def compare(a: String, b: String): Int = java.util.Arrays.compareUnsigned(utf8(a), utf8(b))
  /** Normative full Unicode 16.0.0 casefold (CONTRACT7.1), independent of JDK
    * locale/Unicode defaults. Ordering and stored source bytes stay unchanged.
    */
  def matching(value: String): String = UnicodeCaseFold.fold(value)

enum ArtifactKind:
  case File, Directory
  def wire: String = if this == File then "file" else "dir"
object ArtifactKind:
  def parse(value: String): ArtifactKind = value match
    case "file" => File
    case "dir" => Directory
    case _ => throw DomainError("invalid-manifest")

enum Visibility:
  case Internal, External, Public
  def wire: String = toString.toLowerCase(Locale.ROOT)
object Visibility:
  def parse(value: String): Visibility = value match
    case "internal" => Internal
    case "external" => External
    case "public" => Public
    case _ => throw DomainError("invalid-visibility")

enum UploadState:
  case Uploading, Publishing, Ready
  def wire: String = toString.toLowerCase(Locale.ROOT)
object UploadState:
  def parse(value: String): UploadState = value match
    case "uploading" => Uploading
    case "publishing" => Publishing
    case "ready" => Ready
    case _ => throw DomainError("unavailable")

final case class ManifestEntry(path: String, directory: Boolean, size: Long = 0, sha256: String = "")
final case class Limits(
  storageQuotaBytes: Long = 21474836480L,
  chunkBytes: Int = 1048576,
  maxFileBytes: Long = 536870912L,
  maxArtifactBytes: Long = 2147483648L,
  maxFilesPerArtifact: Int = 10000,
  maxRequestBodyBytes: Int = 4194304,
  maxListLimit: Int = 200,
  maxSessionsPerUser: Int = 10,
  maxSessionsGlobal: Int = 1000,
  maxGrantsPerArtifact: Int = 10000,
  incompleteSessionTtl: Long = 86400,
  grantTtl: Long = 86400,
  oneTimeGrantTtl: Long = 60,
  cleanupEntries: Int = 650001,
  sweepBatch: Int = 1000
):
  Require(storageQuotaBytes > 0 && chunkBytes >= 262144 && chunkBytes <= 4194304 &&
    maxFileBytes > 0 && maxArtifactBytes > 0 && maxFilesPerArtifact > 0 && maxRequestBodyBytes > 0 &&
    maxListLimit > 0 && maxSessionsPerUser > 0 && maxSessionsGlobal > 0 && maxGrantsPerArtifact > 0 &&
    incompleteSessionTtl > 0 && grantTtl > 0 && oneTimeGrantTtl > 0 && cleanupEntries > 0 && sweepBatch > 0, "bad-envelope")

object Manifest:
  val hashPattern = "[0-9a-f]{64}".r
  def path(value: String): Unit =
    Require(value.nonEmpty && value.codePointCount(0, value.length) <= 1024 &&
      !value.exists(c => c < 32 || c == 127 || c == '\\') &&
      !value.startsWith("/") && !value.matches("^[A-Za-z]:.*"), "invalid-path")
    try Exact.utf8(value) catch case _: java.nio.charset.CharacterCodingException => throw DomainError("invalid-path")
    val parts = value.split("/", -1)
    Require(parts.length <= 64 && parts.forall(p => p.nonEmpty && p != "." && p != "..") &&
      !Set("__manure", "api").contains(parts(0)), "invalid-path")
  def validate(entries: Vector[ManifestEntry], kind: ArtifactKind, limits: Limits): Long =
    Require(entries.size <= limits.maxFilesPerArtifact, "invalid-manifest")
    Require(entries.map(_.path).distinct.size == entries.size, "invalid-manifest")
    if kind == ArtifactKind.File then Require(entries.size == 1 && !entries.head.directory, "invalid-manifest")
    val byPath = entries.map(e => e.path -> e).toMap
    var total = 0L
    entries.foreach { e =>
      path(e.path)
      if e.directory then Require(e.size == 0 && e.sha256.isEmpty, "invalid-manifest")
      else
        Require(e.size >= 0 && e.size <= limits.maxFileBytes && hashPattern.matches(e.sha256), "invalid-manifest")
        Require(e.size <= limits.maxArtifactBytes - total, "invalid-manifest")
        total += e.size
      val parts = e.path.split("/")
      (1 until parts.length).foreach { n =>
        Require(byPath.get(parts.take(n).mkString("/")).forall(_.directory), "invalid-manifest")
      }
    }
    total
  def encode(entries: Vector[ManifestEntry]): String = Json.fromValues(entries.map { e =>
    if e.directory then Json.obj("path" -> Json.fromString(e.path), "kind" -> Json.fromString("dir"))
    else Json.obj("path" -> Json.fromString(e.path), "kind" -> Json.fromString("file"), "size" -> Json.fromLong(e.size), "sha256" -> Json.fromString(e.sha256))
  }).noSpaces
  def decode(value: String): Vector[ManifestEntry] =
    val values = parser.parse(value).toOption.flatMap(_.asArray).getOrElse(throw DomainError("unavailable"))
    values.map { j =>
      val c = j.hcursor
      val path = c.get[String]("path").toOption.getOrElse(throw DomainError("unavailable"))
      c.get[String]("kind").toOption match
        case Some("dir") => ManifestEntry(path, true)
        case Some("file") => ManifestEntry(path, false,
          c.get[Long]("size").toOption.getOrElse(throw DomainError("unavailable")),
          c.get[String]("sha256").toOption.getOrElse(throw DomainError("unavailable")))
        case _ => throw DomainError("unavailable")
    }.toVector

final case class Artifact(
  id: String, name: String, kind: ArtifactKind, visibility: Visibility,
  createdByUser: String, createdByToken: String, createdAt: String, createdAtSeconds: Double,
  expiresAt: Option[String], expiresAtSeconds: Option[Double], state: UploadState,
  totalBytes: Long, fileCount: Long, reservedBytes: Long, externalPasswordHash: Option[String],
  lastActivityAt: Double, manifestJson: String
):
  lazy val manifest: Vector[ManifestEntry] = Manifest.decode(manifestJson)
  def expired(now: Double): Boolean = expiresAtSeconds.exists(now >= _)
  def requireOwner(user: String): Unit =
    if state != UploadState.Ready then Require(createdByUser == user, "session-not-owned")
  def requireLive(now: Double): Unit = Require(!expired(now), "expired")

final case class Receipt(artifactId: String, path: String, offset: Long, length: Long, sha256: String)
final case class OneTimeGrant(hash: String, artifactId: String, principal: String, expiresAt: Double,
  used: Boolean, userId: Option[String], tokenId: Option[String], tokenDigest: Option[String])
final case class ContentGrant(hash: String, artifactId: String, expiresAt: Double, createdAt: Double,
  userId: Option[String], tokenId: Option[String], tokenDigest: Option[String], passwordHash: Option[String])
final case class Identity(userId: String, userType: String, tokenId: String, tokenDigest: String)
final case class InitUpload(name: String, kind: ArtifactKind, visibility: Visibility,
  files: Vector[ManifestEntry], expiresInSeconds: Option[Long])
final case class Initialized(artifact: Artifact, externalPassword: Option[String])
final case class FileProgress(path: String, size: Long, receivedBytes: Long, ranges: Vector[(Long, Long)])
final case class UploadProgress(artifactId: String, state: UploadState, files: Vector[FileProgress])
enum TtlPatch:
  case Unchanged, Never
  case After(seconds: Long)
final case class ArtifactPatch(name: Option[String], visibility: Option[Visibility], ttl: TtlPatch)

object UploadRules:
  def name(value: String): Unit =
    Require(value.nonEmpty && value.codePointCount(0, value.length) <= 256, "bad-envelope")
    try Exact.utf8(value) catch case _: java.nio.charset.CharacterCodingException => throw DomainError("bad-envelope")
  def ttl(value: Option[Long]): Unit = value.foreach(n => Require(n >= 60 && n <= 31536000L, "invalid-ttl"))
  def chunk(size: Long, offset: Long, length: Int, limits: Limits): Unit =
    Require(length > 0, "invalid-range")
    Require(length <= limits.chunkBytes, "too-large")
    Require(offset >= 0 && offset <= size && length.toLong <= size - offset && size > 0, "invalid-range")
    if offset + length < size then Require(length == limits.chunkBytes && offset % limits.chunkBytes == 0, "invalid-range")
    else Require(if size > limits.chunkBytes then offset % limits.chunkBytes == 0 else offset == 0, "invalid-range")
  def ranges(rows: Vector[Receipt], size: Long): Vector[(Long, Long)] =
    rows.map(r => (math.max(0L, r.offset), math.min(size, r.offset + r.length)))
      .filter((s,e) => e > s).sortBy(_._1).foldLeft(Vector.empty[(Long, Long)]) { (out, next) =>
        out.lastOption match
          case Some((s,e)) if next._1 <= e => out.init :+ (s, math.max(e, next._2))
          case _ => out :+ next
      }
  /** Single RFC7233 byte range. A malformed or unsatisfiable range is rejected,
    * never silently turned into an unbounded full-body response.
    */
  def range(header: String, size: Long): (Long, Long) =
    Require(size > 0 && header.matches("bytes=[0-9]*-[0-9]*"), "invalid-range")
    val pair = header.substring(6).split("-", -1)
    try
      if pair(0).isEmpty then
        val suffix = pair(1).toLong
        Require(suffix > 0, "invalid-range"); (math.max(0L, size - suffix), size)
      else
        val start = pair(0).toLong
        val end = if pair(1).isEmpty then size else math.min(size, Math.addExact(pair(1).toLong, 1L))
        Require(start >= 0 && start < size && end > start, "invalid-range"); (start, end)
    catch case _: NumberFormatException | _: ArithmeticException => throw DomainError("invalid-range")
