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
  val maximumContentPageSize = 100
  def contentPage(offset: Int,limit: Int): Unit = apply(offset >= 0 && limit >= 1 && limit <= maximumContentPageSize,"invalid","invalid content page bounds")
  def text(s: String, max: Int): Unit = apply(s.nonEmpty && s.length <= max, "invalid", "invalid text length")
}
object Wire {
  val ctx = BaboonCodecContext.Default
  val versions = VersionInfo("1.7.0", "1.0.0", List("1.7.0","1.6.0","1.5.0","1.4.0","1.3.0","1.2.0","1.1.0","1.0.0"))
  def negotiate(offered: List[String]): String = versions.supported.find(offered.contains).getOrElse(throw DomainError("version-mismatch","unsupported API version"))
  def encode[A](codec: BaboonJsonCodec[A], value: A): Json = codec.encode(ctx, value)
  def decode[A](codec: BaboonJsonCodec[A], json: Json): A = codec.decode(ctx, json).fold(_ => throw DomainError("invalid", "invalid payload"), identity)
  def parse(s: String): Json = io.circe.parser.parse(s).fold(_ => throw DomainError("invalid", "invalid JSON"), identity)
  def hash(s: String): String = MessageDigest.getInstance("SHA-256").digest(s.getBytes(UTF_8)).map(b => f"${b & 255}%02x").mkString
  def canonical(j: Json): String = j.deepDropNullValues.noSpacesSortKeys
  def secret(): String = { val b = new Array[Byte](32); new SecureRandom().nextBytes(b); Base64.getUrlEncoder.withoutPadding.encodeToString(b) }
}
final case class UserConfig(id: String, login: String, passwordHashFile: String, enabled: Boolean)
object TokenPolicy { val maximumPerOwner = 100 }
final case class StaticTokenConfig(id: UUID, userId: String, name: String, scopes: List[Scope], tokenFile: String)
final case class ModelConfig(endpoint: String, model: String, revision: String, credentialFile: String, timeoutSeconds: Int, maxResponseBytes: Int, requestPolicy: AnnotationRequestPolicy)
final case class EmbeddingConfig(endpoint: String, model: String, revision: String, credentialFile: String, timeoutSeconds: Int, maxResponseBytes: Int, dimensions: Int, queryPrefix: String, documentPrefix: String, sendDimensions: Boolean)
final case class IndexingCapacity(annotationSessions: Int,embeddingRequests: Int,embeddingBatchSize: Int) {
  def validate(): Unit = {
    Check(annotationSessions>=1 && annotationSessions<=8,"config","annotation session capacity must be 1..8")
    Check(embeddingRequests>=1 && embeddingRequests<=32,"config","embedding request capacity must be 1..32")
    Check(embeddingBatchSize>=1 && embeddingBatchSize<=16,"config","embedding batch size must be 1..16")
  }
}
object IndexingCapacity { val defaults = IndexingCapacity(4,8,16) }
final case class Config(listenHost: String, listenPort: Int, allowedOrigin: String, secureCookies: Boolean, jdbcUrl: String, databaseUser: String, databasePasswordFile: String, users: List[UserConfig], maxBodyBytes: Int, maxFiles: Int, maxFileBytes: Int, maxMessages: Int, sessionTtlSeconds: Int, annotation: ModelConfig, embedding: EmbeddingConfig, allowInsecureHttp: Boolean, staticTokens: List[StaticTokenConfig],indexing: IndexingCapacity) {
  def profile: String = IndexProfileCatalog.current(this).preferred.profile
  def validate(): Unit = {
    indexing.validate()
    Check(users.map(_.id).distinct.size == users.size && users.map(_.login).distinct.size == users.size, "config", "duplicate users")
    Check(staticTokens.map(_.id).distinct.size==staticTokens.size,"config","duplicate static token IDs")
    Check(staticTokens.groupBy(_.userId).values.forall(_.size<=TokenPolicy.maximumPerOwner),"config","static token owner limit")
    staticTokens.foreach { t =>
      Check(users.exists(_.id==t.userId),"config","static token owner must be configured")
      Check(t.name.nonEmpty && t.name.length<=128,"config","invalid static token name")
      Check(t.scopes.nonEmpty && t.scopes.distinct.size==t.scopes.size && (!t.scopes.contains(Scope.Raw)||t.scopes.contains(Scope.Read)),"config","invalid static token scopes")
      val path=Path.of(t.tokenFile)
      Check(path.isAbsolute && !path.normalize().startsWith(Path.of("/nix/store")),"config","static token requires runtime credential file")
    }
    SearchPolicy.dimensions(this)
    Check(maxBodyBytes > 0 && maxBodyBytes <= Config.maximumBodyBytes && maxFileBytes > 0 && maxFiles > 0 && maxMessages > 0, "config", "invalid limits")
    Check(sessionTtlSeconds > 0 && annotation.timeoutSeconds > 0 && embedding.timeoutSeconds > 0 && annotation.maxResponseBytes > 0 && embedding.maxResponseBytes > 0, "config", "invalid timeouts")
    val origin = java.net.URI.create(allowedOrigin)
    val loopbacks = Set("127.0.0.1","localhost","::1","[::1]")
    Check(origin.getHost != null && origin.getPort >= -1 && origin.getPort <= 65535, "config", "Origin must have a valid host and port")
    Check(origin.getRawPath.isEmpty && origin.getRawQuery==null && origin.getRawFragment==null && origin.getRawUserInfo==null, "config", "Origin must be scheme and authority only")
    Check((secureCookies && origin.getScheme=="https") || (!secureCookies && origin.getScheme=="http" && (allowInsecureHttp || (loopbacks.contains(listenHost) && loopbacks.contains(origin.getHost)))), "config", "HTTP requires insecure cookies and explicit allowInsecureHttp or loopback development")
  }
}
object Config {
  val maximumBodyBytes = 512*1024*1024
  given Decoder[UserConfig] = Decoder.forProduct4("id","login","passwordHashFile","enabled")(UserConfig.apply)
  given Decoder[StaticTokenConfig] = Decoder.instance { cursor => for {
    id <- cursor.get[UUID]("id")
    owner <- cursor.get[String]("userId")
    name <- cursor.get[String]("name")
    scopes <- cursor.get[List[String]]("scopes").flatMap(xs => xs.foldLeft[Decoder.Result[List[Scope]]](Right(Nil)) { (acc,s) => for {
      values <- acc
      scope <- Scope.parse(s).toRight(io.circe.DecodingFailure("invalid scope",cursor.history))
    } yield values :+ scope })
    file <- cursor.get[String]("tokenFile")
  } yield StaticTokenConfig(id,owner,name,scopes,file) }
  given Decoder[AnnotationRequestPolicy] = Decoder.decodeString.emap {
    case "strict-json-schema" => Right(AnnotationRequestPolicy.StrictJsonSchema)
    case "glm-max-reasoning" => Right(AnnotationRequestPolicy.GlmMaxReasoning)
    case _ => Left("invalid annotation request policy")
  }
  given Decoder[ModelConfig] = Decoder.forProduct7("endpoint","model","revision","credentialFile","timeoutSeconds","maxResponseBytes","requestPolicy")(ModelConfig.apply)
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
  given Decoder[IndexingCapacity] = Decoder.instance { cursor =>
    def integer(field: String): Decoder.Result[Int] = cursor.downField(field).focus.flatMap(_.asNumber).flatMap(_.toInt)
      .toRight(io.circe.DecodingFailure("expected capacity integer",cursor.downField(field).history))
    for {
      annotation <- integer("annotationSessions")
      embedding <- integer("embeddingRequests")
      batch <- integer("embeddingBatchSize")
    } yield IndexingCapacity(annotation,embedding,batch)
  }
  given Decoder[Config] = Decoder.instance { cursor => for {
    listenHost <- cursor.get[String]("listenHost")
    listenPort <- cursor.get[Int]("listenPort")
    allowedOrigin <- cursor.get[String]("allowedOrigin")
    secureCookies <- cursor.get[Boolean]("secureCookies")
    jdbcUrl <- cursor.get[String]("jdbcUrl")
    databaseUser <- cursor.get[String]("databaseUser")
    databasePasswordFile <- cursor.get[String]("databasePasswordFile")
    users <- cursor.get[List[UserConfig]]("users")
    staticTokens <- if(cursor.downField("staticTokens").focus.isEmpty) Right(Nil) else cursor.get[List[StaticTokenConfig]]("staticTokens")
    maxBodyBytes <- cursor.get[Int]("maxBodyBytes")
    maxFiles <- cursor.get[Int]("maxFiles")
    maxFileBytes <- cursor.get[Int]("maxFileBytes")
    maxMessages <- cursor.get[Int]("maxMessages")
    sessionTtlSeconds <- cursor.get[Int]("sessionTtlSeconds")
    annotation <- cursor.get[ModelConfig]("annotation")
    embedding <- cursor.get[EmbeddingConfig]("embedding")
    allowInsecureHttp <- if(cursor.downField("allowInsecureHttp").focus.isEmpty) Right(false) else cursor.get[Boolean]("allowInsecureHttp")
    indexing <- if(cursor.downField("indexing").focus.isEmpty) Right(IndexingCapacity.defaults) else cursor.get[IndexingCapacity]("indexing")
  } yield Config(listenHost,listenPort,allowedOrigin,secureCookies,jdbcUrl,databaseUser,databasePasswordFile,users,maxBodyBytes,maxFiles,maxFileBytes,maxMessages,sessionTtlSeconds,annotation,embedding,allowInsecureHttp,staticTokens,indexing) }
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
final case class Claim(jobId: UUID, sessionId: UUID, revision: Int, fence: Long, profile: String, snapshot: IngestRequest, owner: String, targetEpoch: Long, runId: UUID, revisionBinding: RevisionBinding)
final case class IndexedChunk(chunk: Chunk, vector: List[Double])
enum ClaimScope {
  case AllOwners
  case Owner(owner: String)
}
trait SessionArchive extends IndexCheckpoints {
  def knownProfiles: Set[String]
  def ingest(owner: String, request: IngestRequest): IngestReceipt
  def session(reader: String, id: UUID): SessionInfo
  def headSnapshot(reader: String, id: UUID): IngestRequest
  def claim(profiles: Set[String], scope: ClaimScope, leaseSeconds: Int): Option[Claim]
  def renew(claim: Claim, leaseSeconds: Int): Boolean
  def progress(claim: Claim, completedWindows: Int, totalWindows: Int): Boolean
  def publishProblems(claim: Claim, publication: ProblemsPublication): Boolean
  def fail(claim: Claim, code: String): Unit
  def fail(claim: Claim, code: String, stage: IndexingStage): Unit
}
object SnapshotProjection {
  def text(value: String): String = value.replace("\u0000", "\\u0000")
  def apply(r: IngestRequest): IngestRequest = {
    val m=r.metadata
    r.copy(metadata=m.copy(title=text(m.title),project=m.project.map(text),gitRemote=m.gitRemote.map(text),gitBranch=m.gitBranch.map(text),gitCommit=m.gitCommit.map(text),producer=text(m.producer),model=m.model.map(text),tags=m.tags.map(text)),messages=r.messages.map(m => m.copy(text=text(m.text))))
  }
}
object SnapshotValidation {
  private def scalar(value: String): Unit = {
    var index=0
    while(index<value.length) {
      val char=value.charAt(index)
      if(Character.isHighSurrogate(char)) {
        Check(index+1<value.length && Character.isLowSurrogate(value.charAt(index+1)),"invalid","unpaired Unicode surrogate")
        index+=2
      } else {
        Check(!Character.isLowSurrogate(char),"invalid","unpaired Unicode surrogate")
        index+=1
      }
    }
  }
  private def structured(value: String): Unit = {
    scalar(value)
    Check(!value.contains('\u0000'),"invalid","NUL in structured field")
  }
  def validate(r: IngestRequest, c: Config): Unit = {
    Check(r.expectedRevision >= 0 && r.files.nonEmpty && r.files.size <= c.maxFiles && r.messages.size <= c.maxMessages, "invalid", "snapshot limits")
    List(r.source.collectorNamespace,r.source.discoveryRootId,r.source.producerSessionId).foreach(Check.text(_,256))
    r.source.subagentId.foreach(Check.text(_,256))
    (List(r.source.collectorNamespace,r.source.discoveryRootId,r.source.producerSessionId,r.digest)++r.source.subagentId).foreach(structured)
    val metadata=r.metadata
    (List(metadata.title,metadata.producer)++metadata.project++metadata.gitRemote++metadata.gitBranch++metadata.gitCommit++metadata.model++metadata.tags).foreach(scalar)
    metadata.workdir.foreach(structured)
    Check(r.files.map(_.path).distinct.size == r.files.size, "invalid", "duplicate files")
    r.files.foreach { f =>
      structured(f.path); structured(f.sha256); scalar(f.content)
      Check(f.content.getBytes(UTF_8).length <= c.maxFileBytes && !f.path.startsWith("/") && !f.path.split('/').contains(".."), "invalid", "invalid file")
      Check(Wire.hash(f.content) == f.sha256 && f.content.linesIterator.filter(_.nonEmpty).forall(l => io.circe.parser.parse(l).isRight), "invalid", "invalid file digest or JSONL")
    }
    Check(Wire.hash(r.files.map(_.content).mkString) == r.digest, "invalid", "source digest mismatch")
    Check(r.messages.map(_.id).distinct.size == r.messages.size, "invalid", "duplicate message IDs")
    val records = r.files.flatMap(_.content.linesIterator.filter(_.nonEmpty).map(Wire.parse))
    val recordCount = records.size
    val rawIds = records.flatMap(j => List(j.hcursor.get[String]("id").toOption,j.hcursor.get[String]("uuid").toOption).flatten).toSet
    val ids = r.messages.map(_.id).toSet ++ rawIds
    r.messages.foreach { m =>
      (List(m.id,m.role)++m.parentId++m.timestamp).foreach(structured); scalar(m.text)
      Check.text(m.id,256); Check.text(m.role,64); Check(m.recordIndex >= 0 && m.recordIndex < recordCount && m.parentId.forall(ids.contains),"invalid","invalid message provenance")
    }
    Check(r.metadata.tags.size <= 32 && r.metadata.tags.forall(t => SnapshotProjection.text(t).length <= 128), "invalid", "invalid tags")
    List(r.metadata.startedAt,r.metadata.endedAt).flatten.foreach(t => Check(scala.util.Try(java.time.Instant.parse(t)).isSuccess,"invalid","invalid timestamp"))
  }
}
