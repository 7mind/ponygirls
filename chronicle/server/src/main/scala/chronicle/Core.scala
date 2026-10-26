package chronicle

import baboon.runtime.shared.{BaboonCodecContext, BaboonJsonCodec}
import chronicle.api.*
import io.circe.{Json, Decoder}
import java.nio.charset.StandardCharsets.UTF_8
import java.nio.file.{Files, Path}
import java.security.{MessageDigest, SecureRandom}
import java.util.{UUID, Base64}
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

final case class DomainError(code: String, detail: String) extends RuntimeException(code)
object Check {
  def apply(ok: Boolean, code: String, detail: String): Unit = if (!ok) throw DomainError(code, detail)
  def page(offset: Int, limit: Int): Unit = apply(offset >= 0 && offset <= 100000 && limit >= 1 && limit <= 100, "invalid", "invalid page bounds")
  def text(s: String, max: Int): Unit = apply(s.nonEmpty && s.length <= max, "invalid", "invalid text length")
}
object Wire {
  val ctx = BaboonCodecContext.Default
  val versions = VersionInfo("1.2.0", "1.0.0", List("1.2.0","1.1.0","1.0.0"))
  def negotiate(offered: List[String]): String = versions.supported.find(offered.contains).getOrElse(throw DomainError("version-mismatch","unsupported API version"))
  def encode[A](codec: BaboonJsonCodec[A], value: A): Json = codec.encode(ctx, value)
  def decode[A](codec: BaboonJsonCodec[A], json: Json): A = codec.decode(ctx, json).fold(_ => throw DomainError("invalid", "invalid payload"), identity)
  def parse(s: String): Json = io.circe.parser.parse(s).fold(_ => throw DomainError("invalid", "invalid JSON"), identity)
  def hash(s: String): String = MessageDigest.getInstance("SHA-256").digest(s.getBytes(UTF_8)).map(b => f"${b & 255}%02x").mkString
  def canonical(j: Json): String = j.deepDropNullValues.noSpacesSortKeys
  def secret(): String = { val b = new Array[Byte](32); new SecureRandom().nextBytes(b); Base64.getUrlEncoder.withoutPadding.encodeToString(b) }
}
final case class UserConfig(id: String, login: String, passwordHashFile: String, enabled: Boolean)
final case class ModelConfig(endpoint: String, model: String, revision: String, credentialFile: String, timeoutSeconds: Int, maxResponseBytes: Int)
final case class EmbeddingConfig(endpoint: String, model: String, revision: String, credentialFile: String, timeoutSeconds: Int, maxResponseBytes: Int, dimensions: Int, queryPrefix: String, documentPrefix: String, sendDimensions: Boolean)
final case class Config(listenHost: String, listenPort: Int, allowedOrigin: String, secureCookies: Boolean, jdbcUrl: String, databaseUser: String, databasePasswordFile: String, users: List[UserConfig], maxBodyBytes: Int, maxFiles: Int, maxFileBytes: Int, maxMessages: Int, sessionTtlSeconds: Int, annotation: ModelConfig, embedding: EmbeddingConfig, allowInsecureHttp: Boolean) {
  def profile: String = Wire.hash(Json.arr(List(annotation.endpoint,annotation.model,annotation.revision,annotation.maxResponseBytes.toString,embedding.endpoint,embedding.model,embedding.revision,embedding.dimensions.toString,embedding.sendDimensions.toString,embedding.queryPrefix,embedding.documentPrefix,AnnotationPartition.identity,"prompt:v3:fragment-indices-only","schema:v2","cosine").map(Json.fromString)*).noSpaces)
  def validate(): Unit = {
    Check(users.map(_.id).distinct.size == users.size && users.map(_.login).distinct.size == users.size, "config", "duplicate users")
    SearchPolicy.dimensions(this)
    Check(maxBodyBytes > 0 && maxBodyBytes <= 64*1024*1024 && maxFileBytes > 0 && maxFiles > 0 && maxMessages > 0, "config", "invalid limits")
    Check(sessionTtlSeconds > 0 && annotation.timeoutSeconds > 0 && embedding.timeoutSeconds > 0 && annotation.maxResponseBytes > 0 && embedding.maxResponseBytes > 0, "config", "invalid timeouts")
    val origin = java.net.URI.create(allowedOrigin)
    val loopbacks = Set("127.0.0.1","localhost","::1","[::1]")
    Check(origin.getHost != null && origin.getPort >= -1 && origin.getPort <= 65535, "config", "Origin must have a valid host and port")
    Check(origin.getRawPath.isEmpty && origin.getRawQuery==null && origin.getRawFragment==null && origin.getRawUserInfo==null, "config", "Origin must be scheme and authority only")
    Check((secureCookies && origin.getScheme=="https") || (!secureCookies && origin.getScheme=="http" && (allowInsecureHttp || (loopbacks.contains(listenHost) && loopbacks.contains(origin.getHost)))), "config", "HTTP requires insecure cookies and explicit allowInsecureHttp or loopback development")
  }
}
object Config {
  given Decoder[UserConfig] = Decoder.forProduct4("id","login","passwordHashFile","enabled")(UserConfig.apply)
  given Decoder[ModelConfig] = Decoder.forProduct6("endpoint","model","revision","credentialFile","timeoutSeconds","maxResponseBytes")(ModelConfig.apply)
  private val omittedSendDimensions = false
  given Decoder[EmbeddingConfig] = Decoder.instance { cursor => for {
    endpoint <- cursor.get[String]("endpoint")
    model <- cursor.get[String]("model")
    revision <- cursor.get[String]("revision")
    credential <- cursor.get[String]("credentialFile")
    timeout <- cursor.get[Int]("timeoutSeconds")
    bound <- cursor.get[Int]("maxResponseBytes")
    dimensions <- cursor.get[Int]("dimensions")
    queryPrefix <- cursor.get[String]("queryPrefix")
    documentPrefix <- cursor.get[String]("documentPrefix")
    sendDimensions <- if(cursor.downField("sendDimensions").focus.isEmpty) Right(omittedSendDimensions) else cursor.get[Boolean]("sendDimensions")
  } yield EmbeddingConfig(endpoint,model,revision,credential,timeout,bound,dimensions,queryPrefix,documentPrefix,sendDimensions) }
  given Decoder[Config] = Decoder.instance { cursor => for {
    listenHost <- cursor.get[String]("listenHost")
    listenPort <- cursor.get[Int]("listenPort")
    allowedOrigin <- cursor.get[String]("allowedOrigin")
    secureCookies <- cursor.get[Boolean]("secureCookies")
    jdbcUrl <- cursor.get[String]("jdbcUrl")
    databaseUser <- cursor.get[String]("databaseUser")
    databasePasswordFile <- cursor.get[String]("databasePasswordFile")
    users <- cursor.get[List[UserConfig]]("users")
    maxBodyBytes <- cursor.get[Int]("maxBodyBytes")
    maxFiles <- cursor.get[Int]("maxFiles")
    maxFileBytes <- cursor.get[Int]("maxFileBytes")
    maxMessages <- cursor.get[Int]("maxMessages")
    sessionTtlSeconds <- cursor.get[Int]("sessionTtlSeconds")
    annotation <- cursor.get[ModelConfig]("annotation")
    embedding <- cursor.get[EmbeddingConfig]("embedding")
    allowInsecureHttp <- if(cursor.downField("allowInsecureHttp").focus.isEmpty) Right(false) else cursor.get[Boolean]("allowInsecureHttp")
  } yield Config(listenHost,listenPort,allowedOrigin,secureCookies,jdbcUrl,databaseUser,databasePasswordFile,users,maxBodyBytes,maxFiles,maxFileBytes,maxMessages,sessionTtlSeconds,annotation,embedding,allowInsecureHttp) }
  def load(path: String): Config = { val c = Wire.parse(Files.readString(Path.of(path))).as[Config].fold(_ => throw DomainError("config", "invalid configuration"), identity); c.validate(); c }
  def credential(path: String): String = Files.readString(Path.of(path)).stripTrailing()
}
object Password {
  val iterations = 600000
  def hash(chars: Array[Char]): String = {
    val salt = new Array[Byte](16); new SecureRandom().nextBytes(salt)
    s"pbkdf2-sha256$$$iterations$$${Base64.getEncoder.encodeToString(salt)}$$${Base64.getEncoder.encodeToString(derive(chars, salt, iterations))}"
  }
  private def derive(chars: Array[Char], salt: Array[Byte], rounds: Int): Array[Byte] = {
    val spec = new PBEKeySpec(chars, salt, rounds, 256)
    try SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded finally spec.clearPassword()
  }
  def verify(chars: Array[Char], encoded: String): Boolean = scala.util.Try {
    val p = encoded.split("\\$"); val n = p(1).toInt
    p.length == 4 && p(0) == "pbkdf2-sha256" && n >= 600000 && n <= 2000000 && MessageDigest.isEqual(derive(chars, Base64.getDecoder.decode(p(2)), n), Base64.getDecoder.decode(p(3)))
  }.getOrElse(false)
}
final case class Identity(user: UserInfo, browser: Boolean, credentialHash: String) {
  def requireScope(s: Scope): Unit = Check(user.scopes.contains(s), "forbidden", "scope required")
  def requireBrowser(): Unit = Check(browser, "forbidden", "browser session required")
}
final case class Claim(jobId: UUID, sessionId: UUID, revision: Int, fence: Long, profile: String, snapshot: IngestRequest)
final case class IndexedChunk(chunk: Chunk, vector: List[Double])
trait SessionArchive {
  def ingest(owner: String, request: IngestRequest, profile: String): IngestReceipt
  def session(reader: String, id: UUID): SessionInfo
  def headSnapshot(reader: String, id: UUID): IngestRequest
  def claim(profile: String, leaseSeconds: Int): Option[Claim]
  def publish(claim: Claim, chunks: List[IndexedChunk]): Boolean
  def fail(claim: Claim, code: String): Unit
}
object SnapshotValidation {
  def validate(r: IngestRequest, c: Config): Unit = {
    Check(r.expectedRevision >= 0 && r.files.nonEmpty && r.files.size <= c.maxFiles && r.messages.size <= c.maxMessages, "invalid", "snapshot limits")
    List(r.source.collectorNamespace,r.source.discoveryRootId,r.source.producerSessionId).foreach(Check.text(_,256))
    r.source.subagentId.foreach(Check.text(_,256))
    Check(r.files.map(_.path).distinct.size == r.files.size, "invalid", "duplicate files")
    r.files.foreach { f =>
      Check(f.content.getBytes(UTF_8).length <= c.maxFileBytes && !f.path.startsWith("/") && !f.path.split('/').contains(".."), "invalid", "invalid file")
      Check(Wire.hash(f.content) == f.sha256 && f.content.linesIterator.filter(_.nonEmpty).forall(l => io.circe.parser.parse(l).isRight), "invalid", "invalid file digest or JSONL")
    }
    Check(Wire.hash(r.files.map(_.content).mkString) == r.digest, "invalid", "source digest mismatch")
    Check(r.messages.map(_.id).distinct.size == r.messages.size, "invalid", "duplicate message IDs")
    val records = r.files.flatMap(_.content.linesIterator.filter(_.nonEmpty).map(Wire.parse))
    val rawIds = records.flatMap(j => List(j.hcursor.get[String]("id").toOption,j.hcursor.get[String]("uuid").toOption).flatten).toSet
    val ids = r.messages.map(_.id).toSet ++ rawIds
    r.messages.foreach { m => Check.text(m.id,256); Check.text(m.role,64); Check(m.recordIndex >= 0 && m.recordIndex < records.size && m.parentId.forall(ids.contains),"invalid","invalid message provenance") }
    Check(r.metadata.tags.size <= 32 && r.metadata.tags.forall(_.length <= 128), "invalid", "invalid tags")
    List(r.metadata.startedAt,r.metadata.endedAt).flatten.foreach(t => Check(scala.util.Try(java.time.Instant.parse(t)).isSuccess,"invalid","invalid timestamp"))
  }
}
