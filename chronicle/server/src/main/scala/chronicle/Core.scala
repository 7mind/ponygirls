package chronicle

import baboon.runtime.shared.{BaboonCodecContext, BaboonJsonCodec}
import chronicle.api.*
import io.circe.{Json, Decoder}
import java.nio.charset.StandardCharsets.UTF_8
import java.nio.file.{Files, Path}
import java.security.{MessageDigest, SecureRandom}
import java.util.{UUID, Base64}
import ponygirls.runtime.{BoundedSecretFile, DatabaseWait, JdbcConfig, JdbcLimits, JdbcPoolSizing}
import scala.concurrent.duration.*

case class DomainError(code: String, detail: String) extends RuntimeException(code)
object Check {
  def apply(ok: Boolean, code: String, detail: String): Unit = if (!ok) throw DomainError(code, detail)
  def page(offset: Int, limit: Int): Unit = apply(offset >= 0 && offset <= 100000 && limit >= 1 && limit <= 100, "invalid", "invalid page bounds")
  val maximumContentPageSize = 100
  def contentPage(offset: Int,limit: Int): Unit = apply(offset >= 0 && limit >= 1 && limit <= maximumContentPageSize,"invalid","invalid content page bounds")
  def text(s: String, max: Int): Unit = apply(s.nonEmpty && s.length <= max, "invalid", "invalid text length")
}
object Wire {
  val ctx = BaboonCodecContext.Default
  val versions = VersionInfo(ClientEnvelope.baboonDomainVersion, ClientEnvelope.baboonDomainVersion, List(ClientEnvelope.baboonDomainVersion))
  def negotiate(offered: List[String]): String = versions.supported.find(offered.contains).getOrElse(throw DomainError("version-mismatch","unsupported API version"))
  def encode[A](codec: BaboonJsonCodec[A], value: A): Json = codec.encode(ctx, value)
  def decode[A](codec: BaboonJsonCodec[A], json: Json): A = codec.decode(ctx, json).fold(_ => throw DomainError("invalid", "invalid payload"), identity)
  def parse(s: String): Json = io.circe.parser.parse(s).fold(_ => throw DomainError("invalid", "invalid JSON"), identity)
  def hash(s: String): String = MessageDigest.getInstance("SHA-256").digest(s.getBytes(UTF_8)).map(b => f"${b & 255}%02x").mkString
  def canonical(j: Json): String = j.deepDropNullValues.noSpacesSortKeys
  def secret(): String = { val b = new Array[Byte](32); new SecureRandom().nextBytes(b); Base64.getUrlEncoder.withoutPadding.encodeToString(b) }
}
final case class UserConfig(id: String, login: String, passwordHashFile: String, enabled: Boolean, admin: Boolean)
final case class SignupConfig(enabled: Boolean, requireApproval: Boolean, maxUsers: Int)
final case class EnrollmentConfig(enabled: Boolean, ttlSeconds: Int)
/** Imperative accounts (self-signup, admin enrollment). `enabled` is the master switch: it is never derived from the
  * creation flags, and turning it off suspends the accounts without revoking anything. */
final case class AccountsConfig(enabled: Boolean, keyFile: Option[String], signup: SignupConfig, enrollment: EnrollmentConfig, issuer: Option[String], reservedUsernames: List[String])
object AccountsConfig {
  val service = "chronicle"
  val defaultRequireApproval = true
  val defaultMaxUsers = 100
  val defaultEnrollmentTtlSeconds = 86400
}
object TokenPolicy { val maximumPerOwner = 100 }
/** `operateJobs`: the account-plane scope OperateJobs (JobOperations), given only by naming it in `scopes`. */
final case class StaticTokenConfig(id: UUID, userId: String, name: String, scopes: List[Scope], tokenFile: String, operateJobs: Boolean = false)
final case class ModelConfig(endpoint: String, model: String, revision: String, credentialFile: String, timeoutSeconds: Int, maxResponseBytes: Int, requestPolicy: AnnotationRequestPolicy)
final case class EmbeddingConfig(endpoint: String, model: String, revision: String, credentialFile: String, timeoutSeconds: Int, maxResponseBytes: Int, dimensions: Int, queryPrefix: String, documentPrefix: String, sendDimensions: Boolean)
/** `incrementalPublication`: an append to an indexed session publishes only its tail as the next version of the published
  * generation's lineage (ingest-limits spec §5.6); false: every publication is a full one (a root). `metadataHorizonWindows`:
  * the metadata horizon of both kinds of publication (ProblemRows.metadataHorizonWindows; the default gives every piece its
  * passage's final metadata). A lineage continues only under the horizon it was published with: a changed horizon makes
  * each session's next publication a root. Neither is part of the index profile. `publicationStatementTimeout`: the statement
  * timeout of a publication's staging transactions (restart-robustness spec §4), `publicationTimeout`. */
final case class IndexingCapacity(annotationSessions: Int,embeddingRequests: Int,embeddingBatchSize: Int,incrementalPublication: Boolean=true,metadataHorizonWindows: Int=ProblemRows.metadataHorizonWindows,publicationStatementTimeout: Option[FiniteDuration]=None) {
  def validate(): Unit = {
    Check(annotationSessions>=1 && annotationSessions<=8,"config","annotation session capacity must be 1..8")
    Check(embeddingRequests>=1 && embeddingRequests<=32,"config","embedding request capacity must be 1..32")
    Check(embeddingBatchSize>=1 && embeddingBatchSize<=16,"config","embedding batch size must be 1..16")
  }
  /** The publication keys, checked at start (Config.validate). */
  def validatePublication(limits: JdbcLimits): Unit = {
    Check(metadataHorizonWindows>=1,"config","indexing.metadataHorizonWindows must be 1..2147483647")
    Check(publicationStatementTimeout.forall(value => value>=limits.statementTimeout && value<=IndexingCapacity.maximumPublicationStatementTimeout),"config","indexing.publicationStatementTimeoutMs must be databaseLimits.statementTimeoutMs..3600000")
  }
  /** The configured publication statement timeout; omitted, the default, or the configured statement timeout where that
    * is longer (a configuration valid before the key stays valid). */
  def publicationTimeout(limits: JdbcLimits): FiniteDuration =
    publicationStatementTimeout.getOrElse(IndexingCapacity.publicationStatementTimeout.max(limits.statementTimeout))
}
object IndexingCapacity {
  val defaults = IndexingCapacity(4,8,16)
  /** A publication's statements (P1-P3) run up to this long: after a database restart the vector index is read from disk. */
  val publicationStatementTimeout: FiniteDuration = 5.minutes
  val maximumPublicationStatementTimeout: FiniteDuration = 1.hour
  /** Large jobs (LargeJobs) running at once; small jobs use every annotation session. */
  val largeJobs: Int = 1
}
final case class Config(listenHost: String, listenPort: Int, allowedOrigin: String, secureCookies: Boolean, jdbcUrl: String, databaseUser: String, databasePasswordFile: String, users: List[UserConfig], maxBodyBytes: Int, maxFiles: Int, maxFileBytes: Long, maxMessages: Int, sessionTtlSeconds: Int, annotation: ModelConfig, embedding: EmbeddingConfig, allowInsecureHttp: Boolean, staticTokens: List[StaticTokenConfig],indexing: IndexingCapacity,databaseLimits: JdbcLimits,accounts: Option[AccountsConfig],maxRawReadBytes: Long,maxIndexingBudgetBytes: Long,maxSmallJobBudgetBytes: Option[Long],maxRecordBytes: Long=Config.defaultMaxRecordBytes,databaseStartWaitMs: Long=DatabaseWait.defaultBound.toMillis,databaseRequestConnections: Option[Int]=None,databaseBackgroundConnections: Option[Int]=None) {
  def accountsEnabled: Boolean = accounts.exists(_.enabled)
  def jdbcConfig: JdbcConfig = JdbcConfig(jdbcUrl,databaseUser,Path.of(databasePasswordFile),databaseLimits)
  def databaseStartWait: FiniteDuration = databaseStartWaitMs.millis
  /** The pool (restart-robustness spec §5) from `databaseLimits.requestConnections` and `backgroundConnections`. */
  def databasePool: JdbcPoolSizing =
    JdbcPoolSizing.partitioned(databaseLimits,databaseRequestConnections,databaseBackgroundConnections,Config.minimumBackgroundConnections)
      .fold(invalid => throw DomainError("config",s"databaseLimits.$invalid"),identity)
  def profile: String = IndexProfileCatalog.current(this).preferred.profile
  def validate(): Unit = {
    indexing.validate()
    indexing.validatePublication(databaseLimits)
    try jdbcConfig.validate() catch { case _: IllegalArgumentException => throw DomainError("config","invalid database configuration") }
    Check(DatabaseWait.startWait(databaseStartWaitMs).nonEmpty,"config",s"databaseLimits.startWaitMs must be ${DatabaseWait.minimumBound.toMillis}..${DatabaseWait.maximumBound.toMillis}")
    databasePool
    Check(users.map(_.id).distinct.size == users.size && users.map(_.login).distinct.size == users.size, "config", "duplicate users")
    accounts.foreach { a =>
      Check(a.enabled || !(a.signup.enabled || a.enrollment.enabled),"config","accounts.signup and accounts.enrollment require accounts.enabled")
      if(a.enabled) {
        Check(a.keyFile.map(Path.of(_)).exists(path => path.isAbsolute && !path.normalize().startsWith(Path.of("/nix/store"))),"config","accounts require a runtime key file")
        Check(users.exists(u => u.enabled && u.admin),"config","accounts require an enabled administrator")
      }
    }
    Check(staticTokens.map(_.id).distinct.size==staticTokens.size,"config","duplicate static token IDs")
    Check(staticTokens.groupBy(_.userId).values.forall(_.size<=TokenPolicy.maximumPerOwner),"config","static token owner limit")
    staticTokens.foreach { t =>
      Check(users.exists(_.id==t.userId),"config","static token owner must be configured")
      Check(t.name.nonEmpty && t.name.length<=128,"config","invalid static token name")
      Check(t.scopes.nonEmpty && t.scopes.distinct.size==t.scopes.size && (!t.scopes.contains(Scope.Raw)||t.scopes.contains(Scope.Read)) && (!t.operateJobs||t.scopes.contains(Scope.Read)),"config","invalid static token scopes")
      val path=Path.of(t.tokenFile)
      Check(path.isAbsolute && !path.normalize().startsWith(Path.of("/nix/store")),"config","static token requires runtime credential file")
    }
    SearchPolicy.dimensions(this)
    Check(maxBodyBytes > 0 && maxBodyBytes <= Config.maximumBodyBytes && maxFileBytes > 0 && maxFiles > 0 && maxMessages > 0, "config", "invalid limits")
    Check(maxRawReadBytes > 0 && maxRawReadBytes <= Config.maximumRawReadBytes && maxIndexingBudgetBytes > 0 && maxSmallJobBudgetBytes.forall(_ > 0), "config", "invalid raw read or indexing budget limits")
    Check(maxRecordBytes >= Config.minimumRecordBytes && maxRecordBytes <= Config.maximumRecordBytes, "config", "maxRecordBytes must be 1048576..134217728")
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
  /** GetRaw builds the raw in one database value and doubles it in its JSON response; PostgreSQL cannot build 1 GiB. */
  val maximumRawReadBytes: Long = 512L*1024*1024
  /** The estimated heap of one window of an indexing job and of one message's decode (IndexingBudget, ingest-limits spec
    * §5.2.7); no job is refused for its whole size. */
  val defaultIndexingBudgetBytes: Long = Int.MaxValue.toLong
  /** Part uploads: the largest raw record (one JSONL line); a record whose part exceeds the ordinary part bound travels
    * alone in a large part. The maximum keeps a message text derived from one record far below PostgreSQL's jsonb
    * string limit (256 MiB). */
  val defaultMaxRecordBytes: Long = 32L*1024*1024
  val minimumRecordBytes: Long = 1024L*1024
  val maximumRecordBytes: Long = 128L*1024*1024
  /** Background connections of a partitioned pool kept for short indexing work whatever long work holds. */
  val controlReserve = 2
  /** The publication gate's one permit and the [[controlReserve]]. */
  val minimumBackgroundConnections: Int = 1+controlReserve
  // An omitted member is absent; an explicit null is rejected, as for the other optional members.
  private def present[A: Decoder](cursor: io.circe.HCursor,field: String): Decoder.Result[Option[A]] =
    if(cursor.downField(field).focus.isEmpty) Right(None) else cursor.get[A](field).map(Some(_))
  private def optional[A: Decoder](cursor: io.circe.HCursor,field: String,omitted: A): Decoder.Result[A] = present[A](cursor,field).map(_.getOrElse(omitted))
  private val omittedAdmin = false
  given Decoder[UserConfig] = Decoder.instance { cursor => for {
    id <- cursor.get[String]("id")
    login <- cursor.get[String]("login")
    passwordHashFile <- cursor.get[String]("passwordHashFile")
    enabled <- cursor.get[Boolean]("enabled")
    admin <- optional(cursor,"admin",omittedAdmin)
  } yield UserConfig(id,login,passwordHashFile,enabled,admin) }
  private val omittedCreation = false
  given Decoder[SignupConfig] = Decoder.instance { cursor => for {
    enabled <- optional(cursor,"enabled",omittedCreation)
    requireApproval <- optional(cursor,"requireApproval",AccountsConfig.defaultRequireApproval)
    maxUsers <- optional(cursor,"maxUsers",AccountsConfig.defaultMaxUsers)
  } yield SignupConfig(enabled,requireApproval,maxUsers) }
  given Decoder[EnrollmentConfig] = Decoder.instance { cursor => for {
    enabled <- optional(cursor,"enabled",omittedCreation)
    ttlSeconds <- optional(cursor,"ttlSeconds",AccountsConfig.defaultEnrollmentTtlSeconds)
  } yield EnrollmentConfig(enabled,ttlSeconds) }
  // The master switch is a required member of a present `accounts` object; everything else defaults to off.
  given Decoder[AccountsConfig] = Decoder.instance { cursor => for {
    enabled <- cursor.get[Boolean]("enabled")
    keyFile <- present[String](cursor,"keyFile")
    signup <- optional(cursor,"signup",SignupConfig(omittedCreation,AccountsConfig.defaultRequireApproval,AccountsConfig.defaultMaxUsers))
    enrollment <- optional(cursor,"enrollment",EnrollmentConfig(omittedCreation,AccountsConfig.defaultEnrollmentTtlSeconds))
    issuer <- present[String](cursor,"issuer")
    reservedUsernames <- optional(cursor,"reservedUsernames",List.empty[String])
  } yield AccountsConfig(enabled,keyFile,signup,enrollment,issuer,reservedUsernames) }
  given Decoder[StaticTokenConfig] = Decoder.instance { cursor => for {
    id <- cursor.get[UUID]("id")
    owner <- cursor.get[String]("userId")
    name <- cursor.get[String]("name")
    scopes <- cursor.get[List[String]]("scopes").flatMap(xs => JobOperations.scopes(xs).toRight(io.circe.DecodingFailure("invalid static token scopes",cursor.history)))
    file <- cursor.get[String]("tokenFile")
  } yield StaticTokenConfig(id,owner,name,scopes._1,file,scopes._2) }
  given Decoder[AnnotationRequestPolicy] = Decoder.decodeString.emap {
    case "strict-json-schema" => Right(AnnotationRequestPolicy.StrictJsonSchema)
    case "strict-json-schema-32k" => Right(AnnotationRequestPolicy.StrictJsonSchema32k)
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
      incremental <- if(cursor.downField("incrementalPublication").focus.isEmpty) Right(true) else cursor.get[Boolean]("incrementalPublication")
      horizon <- if(cursor.downField("metadataHorizonWindows").focus.isEmpty) Right(ProblemRows.metadataHorizonWindows) else integer("metadataHorizonWindows")
      publication <- present[Long](cursor,"publicationStatementTimeoutMs")
    } yield IndexingCapacity(annotation,embedding,batch,incremental,horizon,publication.map(_.millis))
  }
  given Decoder[JdbcLimits] = Decoder.instance { cursor => for {
    connections <- cursor.get[Int]("maxConnections")
    queued <- cursor.get[Int]("maxQueued")
    queue <- cursor.get[Long]("queueTimeoutMs")
    connect <- cursor.get[Long]("connectTimeoutMs")
    statement <- cursor.get[Long]("statementTimeoutMs")
    lock <- cursor.get[Long]("lockTimeoutMs")
    idle <- cursor.get[Long]("idleTransactionTimeoutMs")
    socket <- cursor.get[Long]("socketTimeoutMs")
  } yield JdbcLimits(connections,queued,queue.millis,connect.millis,statement.millis,lock.millis,idle.millis,socket.millis) }
  /** Optional beside the eight required limits: how long a start waits for the database to accept queries. */
  private val startWaitMs: Decoder[Long] = Decoder.instance(optional(_,"startWaitMs",DatabaseWait.defaultBound.toMillis))
  /** Optional beside the eight required limits: the pool's request and background connections. */
  private val poolKeys: Decoder[(Option[Int],Option[Int])] = Decoder.instance(cursor => for {
    request <- present[Int](cursor,"requestConnections")
    background <- present[Int](cursor,"backgroundConnections")
  } yield (request,background))
  given Decoder[Config] = Decoder.instance { cursor => for {
    listenHost <- cursor.get[String]("listenHost")
    listenPort <- cursor.get[Int]("listenPort")
    allowedOrigin <- cursor.get[String]("allowedOrigin")
    secureCookies <- cursor.get[Boolean]("secureCookies")
    jdbcUrl <- cursor.get[String]("jdbcUrl")
    databaseUser <- cursor.get[String]("databaseUser")
    databasePasswordFile <- cursor.get[String]("databasePasswordFile")
    databaseLimits <- cursor.get[JdbcLimits]("databaseLimits")
    databaseStartWaitMs <- cursor.downField("databaseLimits").as(using startWaitMs)
    pooled <- cursor.downField("databaseLimits").as(using poolKeys)
    users <- cursor.get[List[UserConfig]]("users")
    staticTokens <- if(cursor.downField("staticTokens").focus.isEmpty) Right(Nil) else cursor.get[List[StaticTokenConfig]]("staticTokens")
    maxBodyBytes <- cursor.get[Int]("maxBodyBytes")
    maxFiles <- cursor.get[Int]("maxFiles")
    maxFileBytes <- cursor.get[Long]("maxFileBytes")
    maxMessages <- cursor.get[Int]("maxMessages")
    sessionTtlSeconds <- cursor.get[Int]("sessionTtlSeconds")
    annotation <- cursor.get[ModelConfig]("annotation")
    embedding <- cursor.get[EmbeddingConfig]("embedding")
    allowInsecureHttp <- if(cursor.downField("allowInsecureHttp").focus.isEmpty) Right(false) else cursor.get[Boolean]("allowInsecureHttp")
    indexing <- if(cursor.downField("indexing").focus.isEmpty) Right(IndexingCapacity.defaults) else cursor.get[IndexingCapacity]("indexing")
    accounts <- present[AccountsConfig](cursor,"accounts")
    // Omitted: everything /api/ingest can store stays readable.
    maxRawReadBytes <- optional(cursor,"maxRawReadBytes",maxBodyBytes.toLong)
    maxIndexingBudgetBytes <- optional(cursor,"maxIndexingBudgetBytes",defaultIndexingBudgetBytes)
    // Retired (ingest-limits spec §5.2.7): accepted and validated so existing configurations start, without effect.
    maxSmallJobBudgetBytes <- present[Long](cursor,"maxSmallJobBudgetBytes")
    maxRecordBytes <- optional(cursor,"maxRecordBytes",defaultMaxRecordBytes)
  } yield Config(listenHost,listenPort,allowedOrigin,secureCookies,jdbcUrl,databaseUser,databasePasswordFile,users,maxBodyBytes,maxFiles,maxFileBytes,maxMessages,sessionTtlSeconds,annotation,embedding,allowInsecureHttp,staticTokens,indexing,databaseLimits,accounts,maxRawReadBytes,maxIndexingBudgetBytes,maxSmallJobBudgetBytes,maxRecordBytes,databaseStartWaitMs,pooled._1,pooled._2) }
  def load(path: String): Config = { val c = Wire.parse(Files.readString(Path.of(path))).as[Config].fold(_ => throw DomainError("config", "invalid configuration"), identity); c.validate(); c }
  def credential(path: String): String = BoundedSecretFile.read(Path.of(path),16384).stripTrailing()
}
object Password {
  def hash(chars: Array[Char]): String = ponygirls.auth.Password.hash(chars)
  def verify(chars: Array[Char],encoded: String): Boolean = ponygirls.auth.Password.verify(chars,encoded)
}
/** A bearer identity's token: its id and whether it has the account-plane scope OperateJobs (JobOperations). */
final case class TokenAuthority(id: UUID, operateJobs: Boolean)
final case class Identity(user: UserInfo, browser: Boolean, credentialHash: String, token: Option[TokenAuthority] = None) {
  def requireScope(s: Scope): Unit = Check(user.scopes.contains(s), "forbidden", "scope required")
  def requireBrowser(): Unit = Check(browser, "forbidden", "browser session required")
  /** A token with OperateJobs; any other credential is refused exactly as `requireBrowser` refuses a bearer. */
  def requireJobOperator(): Unit = Check(token.exists(_.operateJobs), "forbidden", "browser session required")
  /** Before `operation` runs: a browser session passes; a bearer only for an operation of the allow-list
    * (JobOperations.admitted) with OperateJobs and Read, and is otherwise refused exactly as `requireBrowser` refuses it. */
  def requireOperator(operation: Operation): Unit = if(!browser) {
    Check(JobOperations.admitted(operation).nonEmpty && token.exists(_.operateJobs), "forbidden", "browser session required")
    requireScope(Scope.Read)
  }
}
/** `snapshot` is the claimed revision's envelope (no messages, no raw files); `messages` reads its messages by position
  * (ingest-limits spec §5.2.1). */
final case class Claim(jobId: UUID, sessionId: UUID, revision: Int, fence: Long, profile: String, snapshot: IngestRequest, owner: String, targetEpoch: Long, runId: UUID, revisionBinding: RevisionBinding, messages: ClaimedMessages, attempt: ClaimAttempt = ClaimAttempt.unclaimed())
final case class IndexedChunk(chunk: Chunk, vector: Seq[Double])
enum ClaimScope {
  case AllOwners
  case Owner(owner: String)
}
/** Whether a claim may take a large job (more than LargeJobs.windows): a claim that may not passes one it knows by and
  * defers one it finds while running; the job waits in the queue for a claim that may. Large jobs share lane time, not
  * heap: a job's heap is one window whatever its size (ingest-limits spec §5.2.7). */
enum LargeJobs {
  case Admitted
  case Skipped
}
object LargeJobs {
  val windows: Int = 100
}
trait SessionArchive extends IndexCheckpoints {
  def knownProfiles: Set[String]
  def ingest(owner: String, request: IngestRequest): IngestReceipt
  def session(reader: String, id: UUID): SessionInfo
  def claim(profiles: Set[String], scope: ClaimScope, leaseSeconds: Int, large: LargeJobs): Option[Claim]
  final def claim(profiles: Set[String], scope: ClaimScope, leaseSeconds: Int): Option[Claim] = claim(profiles,scope,leaseSeconds,LargeJobs.Admitted)
  /** Returns a claimed job to the queue without counting the attempt, recording its window count. A job whose source has
    * a newer revision ends superseded instead and false is returned. */
  def defer(claim: Claim, totalWindows: Int): Boolean
  def renew(claim: Claim, leaseSeconds: Int): Boolean
  def progress(claim: Claim, completedWindows: Int, totalWindows: Int): Boolean
  /** Stages the publication's rows and switches the source to it (ingest-limits spec §5.2.4); false when the claim is no
    * longer current. */
  def publishProblems(claim: Claim, rows: ProblemRows): Boolean
  /** The published generation the claim's publication may continue incrementally (ingest-limits spec §5.6.2, eligibility),
    * None for a full publication (a root). */
  def publicationParent(claim: Claim): Option[PublicationParent]
  /** Deletes the search rows of the generations the claim's publication replaced (bounded statements). */
  def retire(claim: Claim): Unit
  def fail(claim: Claim, code: String): Unit
  def fail(claim: Claim, code: String, stage: IndexingStage): Unit
  /** Records a transient database failure of the attempt (restart-robustness spec §4) in the fenced transaction of `fail`,
    * each of its waits within `bound`: the job held Queued with back-off and its attempt refunded, or Failed after the
    * consecutive limit. */
  def holdTransient(claim: Claim, stage: Option[IndexingStage], bound: FiniteDuration): TransientOutcome
}
object SnapshotProjection {
  def text(value: String): String = value.replace("\u0000", "\\u0000")
  def apply(r: IngestRequest): IngestRequest = {
    val m=r.metadata
    r.copy(metadata=m.copy(title=text(m.title),project=m.project.map(text),gitRemote=m.gitRemote.map(text),gitBranch=m.gitBranch.map(text),gitCommit=m.gitCommit.map(text),producer=text(m.producer),model=m.model.map(text),tags=m.tags.map(text)),messages=r.messages.map(m => m.copy(text=text(m.text))))
  }
}
/** A whole `/api/ingest` request, through the rules part uploads share (UploadValidation). */
object SnapshotValidation {
  import UploadValidation.{scalar,structured}
  def validate(r: IngestRequest, c: Config): Unit = {
    Check(r.expectedRevision >= 0 && r.files.nonEmpty && r.files.size <= c.maxFiles && r.messages.size <= c.maxMessages, "invalid", "snapshot limits")
    UploadValidation.source(r.source)
    structured(r.digest)
    UploadValidation.metadata(r.metadata)
    Check(r.files.map(_.path).distinct.size == r.files.size, "invalid", "duplicate files")
    var recordCount = 0
    val rawIds = Set.newBuilder[String]
    r.files.foreach { f =>
      UploadValidation.path(f.path); structured(f.sha256); scalar(f.content)
      Check(f.content.getBytes(UTF_8).length <= c.maxFileBytes, "invalid", "invalid file")
      Check(Wire.hash(f.content) == f.sha256, "invalid", "invalid file digest or JSONL")
      recordCount += UploadValidation.records(f.content)(rawIds ++= _)
    }
    Check(Wire.hash(r.files.map(_.content).mkString) == r.digest, "invalid", "source digest mismatch")
    Check(r.messages.map(_.id).distinct.size == r.messages.size, "invalid", "duplicate message IDs")
    val ids = r.messages.map(_.id).toSet ++ rawIds.result()
    r.messages.foreach { m =>
      UploadValidation.message(m)
      Check(m.recordIndex < recordCount && m.parentId.forall(ids.contains),"invalid","invalid message provenance")
    }
  }
}
