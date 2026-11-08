package rites

import io.circe.{Decoder, DecodingFailure, Json}
import java.net.URI
import java.nio.file.Path
import ponygirls.runtime.{CredentialFile, JdbcConfig, JdbcLimits}
import rites.api.{ForgeKind, ModelInfo, OAuthClientInfo}
import scala.concurrent.duration.*

final case class UserConfig(id: String, login: String, passwordHashFile: String, enabled: Boolean)
final case class ForgeConfig(kind: ForgeKind, host: String, apiBase: String, cloneBase: String) {
  private[rites] def cloneUri(testMode: Boolean): URI = ForgeConfig.validBase(cloneBase, testMode, "cloneBase", Some(host))
  private[rites] def parsed(testMode: Boolean): URI = ForgeConfig.validBase(apiBase, testMode, "apiBase", None)
}
object ForgeConfig {
  private def validBase(value: String, testMode: Boolean, label: String, expectedHost: Option[String]): URI = {
    val uri = URI.create(value)
    Check((uri.getScheme == "https" || (testMode && uri.getScheme == "http")) && uri.getHost != null && uri.getRawUserInfo == null && uri.getRawQuery == null && uri.getRawFragment == null, "config", s"forge $label must be operator-controlled HTTPS")
    Check(uri.getPort >= -1 && uri.getPort <= 65535 && expectedHost.forall(_ == uri.getHost), "config", s"forge $label host mismatch")
    uri
  }
}
final case class OAuthClientConfig(id: String, host: String, label: String, tokenEndpoint: String, clientId: String, clientSecretFile: Option[String], redirectUri: String, expiryLeadSeconds: Int) {
  def publicInfo: OAuthClientInfo = OAuthClientInfo(id, ForgeKind.Gitlab, host, label, expiryLeadSeconds)
  private[rites] def validate(forge: ForgeConfig, testMode: Boolean): Unit = {
    Check(Valid.id(id) && Valid.text(label, 128) && Valid.text(clientId, 512) && Valid.text(redirectUri, 2048) && expiryLeadSeconds >= 0 && expiryLeadSeconds <= 3600, "config", "invalid OAuth client")
    Check(clientSecretFile.forall(p => Path.of(p).isAbsolute), "config", "OAuth client secret path must be absolute")
    val token = URI.create(tokenEndpoint); val api = forge.parsed(testMode); val redirect = URI.create(redirectUri)
    Check(token.getHost == api.getHost && token.getScheme == api.getScheme && token.getPort == api.getPort && token.getRawUserInfo == null && token.getRawQuery == null && token.getRawFragment == null, "config", "OAuth token endpoint must stay on configured forge")
    Check(Set("https", "http").contains(redirect.getScheme) && redirect.getHost != null && redirect.getRawUserInfo == null, "config", "invalid OAuth redirect URI")
  }
}
final case class ModelRef(id: String, provider: String, model: String, thinkingLevel: String, configFile: String)
final case class ModelConfig(id: String, provider: String, model: String, thinkingLevel: String, workerDocument: Json) {
  def publicInfo: ModelInfo = ModelInfo(id, provider, model, thinkingLevel)
}
object ModelConfig {
  private[rites] def load(ref: ModelRef, testMode: Boolean): ModelConfig = {
    Check(Valid.id(ref.id) && Valid.text(ref.provider, 128) && Valid.text(ref.model, 256) && Set("off", "minimal", "low", "medium", "high", "xhigh", "max").contains(ref.thinkingLevel), "config", "invalid model selection")
    val document = JsonSupport.decodeFile[Json](Path.of(ref.configFile), 65536)
    val cursor = document.hcursor
    Check(document.asObject.exists(_.keys.toSet == Set("provider", "modelsJson", "credential")) && cursor.get[String]("provider").contains(ref.provider), "config", "model file must contain exactly one selected provider and credential")
    Check(cursor.downField("credential").get[String]("type").contains("api_key") && cursor.downField("credential").get[String]("key").toOption.exists(k => k.nonEmpty && k.length <= 16384), "config", "model requires one API key credential")
    val providers = cursor.downField("modelsJson").downField("providers")
    Check(providers.keys.exists(_.toSet == Set(ref.provider)), "config", "model file must contain exactly the selected provider")
    val selected = providers.downField(ref.provider)
    Check(selected.downField("models").values.exists(_.exists(_.hcursor.get[String]("id").contains(ref.model))), "config", "selected model is absent from private model file")
    val endpoint = selected.get[String]("baseUrl").getOrElse(throw DomainError("config", "selected provider baseUrl required")); val uri = URI.create(endpoint)
    Check((uri.getScheme == "https" || (testMode && uri.getScheme == "http")) && uri.getHost != null && uri.getRawUserInfo == null, "config", "model endpoint must be HTTPS")
    ModelConfig(ref.id, ref.provider, ref.model, ref.thinkingLevel, document)
  }
}
final case class SchedulerConfig(pollMilliseconds: Int, queueBound: Int, concurrency: Int, runTimeoutSeconds: Int) {
  def poll: FiniteDuration = pollMilliseconds.millis
}
final case class Config(
  listenHost: String, listenPort: Int, allowedOrigin: String, secureCookies: Boolean, allowInsecureHttp: Boolean,
  jdbcUrl: String, databaseUser: String, databasePasswordFile: String, databaseLimits: JdbcLimits,
  users: List[UserConfig], masterKeyFile: String, workerCommand: String, webRoot: Option[String], workspaceRoot: String, cacheRoot: String,
  maxBodyBytes: Int, sessionTtlSeconds: Int, maxPromptBytes: Int, maxFileBytes: Int, maxRunFiles: Int,
  scheduler: SchedulerConfig, forges: List[ForgeConfig], models: List[ModelRef], oauthClients: List[OAuthClientConfig], testMode: Boolean
) {
  private[rites] def workspaceRootPath: Path = Path.of(workspaceRoot)
  private[rites] def cacheRootPath: Path = Path.of(cacheRoot)
  private[rites] def root: Path = workspaceRootPath
  private[rites] def cachePath(repositoryId: String): Path = cacheRootPath.resolve(repositoryId + ".git").normalize()
  def jdbcConfig: JdbcConfig = JdbcConfig(jdbcUrl, databaseUser, Path.of(databasePasswordFile), databaseLimits)
  def validate(): Unit = {
    Check(users.nonEmpty && users.map(_.id).distinct.size == users.size && users.map(_.login).distinct.size == users.size, "config", "duplicate or empty static accounts")
    users.foreach(u => Check(Valid.id(u.id) && Valid.text(u.login, 128) && Path.of(u.passwordHashFile).isAbsolute, "config", "invalid static account"))
    Check(Path.of(masterKeyFile).isAbsolute && !Path.of(masterKeyFile).normalize().startsWith(Path.of("/nix/store")), "config", "vault key must be outside the Nix store")
    Check(Path.of(workspaceRoot).isAbsolute && Path.of(cacheRoot).isAbsolute && Path.of(workspaceRoot) != Path.of(cacheRoot), "config", "runtime roots must be distinct absolute paths")
    Check(workerCommand.nonEmpty && !workerCommand.exists(_.isWhitespace) && !workerCommand.contains('\u0000'), "config", "invalid worker command")
    Check(webRoot.forall(p => Path.of(p).isAbsolute), "config", "webRoot must be absolute")
    Check(listenPort >= 1 && listenPort <= 65535 && maxBodyBytes >= 1024 && maxBodyBytes <= 1048576, "config", "invalid HTTP limits")
    Check(sessionTtlSeconds >= 60 && sessionTtlSeconds <= 2592000 && maxPromptBytes >= 1 && maxPromptBytes <= 262144, "config", "invalid session or prompt limits")
    Check(maxFileBytes >= 1 && maxFileBytes <= 16777216 && maxRunFiles >= 1 && maxRunFiles <= 100000, "config", "invalid export limits")
    Check(scheduler.pollMilliseconds >= 100 && scheduler.pollMilliseconds <= 60000 && scheduler.queueBound >= 1 && scheduler.queueBound <= 1000 && scheduler.concurrency >= 1 && scheduler.concurrency <= 32 && scheduler.runTimeoutSeconds >= 1 && scheduler.runTimeoutSeconds <= 86400, "config", "invalid scheduler bounds")
    try jdbcConfig.validate() catch { case _: IllegalArgumentException => throw DomainError("config", "invalid database configuration") }
    val origin = URI.create(allowedOrigin)
    val loopbacks = Set("127.0.0.1", "localhost", "::1", "[::1]")
    Check(origin.getHost != null && origin.getRawPath.isEmpty && origin.getRawQuery == null && origin.getRawFragment == null && origin.getRawUserInfo == null, "config", "origin must be scheme and authority")
    Check((secureCookies && origin.getScheme == "https") || (!secureCookies && origin.getScheme == "http" && (allowInsecureHttp || (loopbacks.contains(listenHost) && loopbacks.contains(origin.getHost)))), "config", "insecure HTTP requires loopback or explicit test setting")
    Check(forges.nonEmpty && models.nonEmpty, "config", "at least one forge and model required")
    forges.foreach { f => Check(Valid.host(f.host), "config", "invalid forge host"); f.parsed(testMode); f.cloneUri(testMode) }
    Check(forges.map(f => (f.kind, f.host)).distinct.size == forges.size, "config", "duplicate forge")
    Check(models.map(_.id).distinct.size == models.size && models.forall(m => Path.of(m.configFile).isAbsolute), "config", "invalid model references")
    Check(oauthClients.map(_.id).distinct.size == oauthClients.size, "config", "duplicate OAuth client")
    oauthClients.foreach(client => client.validate(forge(ForgeKind.Gitlab, client.host), testMode))
  }
  def forge(kind: ForgeKind, host: String): ForgeConfig = forges.find(f => f.kind == kind && f.host == host).getOrElse(throw DomainError("invalid", "forge is not allowlisted"))
  def oauthClient(id: String, host: String): OAuthClientConfig = oauthClients.find(c => c.id == id && c.host == host).getOrElse(throw DomainError("invalid", "OAuth client is not allowlisted"))
  def loadModels(): List[ModelConfig] = models.map(ModelConfig.load(_, testMode))
  def password(config: UserConfig): String = CredentialFile.read(Path.of(config.passwordHashFile))
}

object Config {
  private given Decoder[ForgeKind] = Decoder.decodeString.emap {
    case "Github" => Right(ForgeKind.Github)
    case "Gitlab" => Right(ForgeKind.Gitlab)
    case _ => Left("invalid forge kind")
  }
  private given Decoder[UserConfig] = Decoder.forProduct4("id", "login", "passwordHashFile", "enabled")(UserConfig.apply)
  private given Decoder[ForgeConfig] = Decoder.forProduct4("kind", "host", "apiBase", "cloneBase")(ForgeConfig.apply)
  private given Decoder[ModelRef] = Decoder.forProduct5("id", "provider", "model", "thinkingLevel", "configFile")(ModelRef.apply)
  private given Decoder[OAuthClientConfig] = Decoder.forProduct8("id", "host", "label", "tokenEndpoint", "clientId", "clientSecretFile", "redirectUri", "expiryLeadSeconds")(OAuthClientConfig.apply)
  private given Decoder[JdbcLimits] = Decoder.instance(c => for {
    connections <- c.get[Int]("maxConnections"); queued <- c.get[Int]("maxQueued"); queue <- c.get[Long]("queueTimeoutMs")
    connect <- c.get[Long]("connectTimeoutMs"); statement <- c.get[Long]("statementTimeoutMs"); lock <- c.get[Long]("lockTimeoutMs")
    idle <- c.get[Long]("idleTransactionTimeoutMs"); socket <- c.get[Long]("socketTimeoutMs")
  } yield JdbcLimits(connections, queued, queue.millis, connect.millis, statement.millis, lock.millis, idle.millis, socket.millis))
  private given Decoder[SchedulerConfig] = Decoder.forProduct4("pollMilliseconds", "queueBound", "concurrency", "runTimeoutSeconds")(SchedulerConfig.apply)
  private given Decoder[Config] = Decoder.instance(c => for {
    listenHost <- c.get[String]("listenHost"); listenPort <- c.get[Int]("listenPort"); allowedOrigin <- c.get[String]("allowedOrigin")
    secureCookies <- c.get[Boolean]("secureCookies"); allowInsecureHttp <- c.getOrElse[Boolean]("allowInsecureHttp")(false)
    jdbcUrl <- c.get[String]("jdbcUrl"); databaseUser <- c.get[String]("databaseUser"); databasePasswordFile <- c.get[String]("databasePasswordFile")
    databaseLimits <- c.get[JdbcLimits]("databaseLimits"); users <- c.get[List[UserConfig]]("users"); masterKeyFile <- c.get[String]("masterKeyFile")
    workerCommand <- c.get[String]("workerCommand"); webRoot <- c.get[Option[String]]("webRoot"); workspaceRoot <- c.get[String]("workspaceRoot"); cacheRoot <- c.get[String]("cacheRoot")
    maxBodyBytes <- c.getOrElse[Int]("maxBodyBytes")(65536); sessionTtlSeconds <- c.getOrElse[Int]("sessionTtlSeconds")(86400)
    maxPromptBytes <- c.getOrElse[Int]("maxPromptBytes")(262144); maxFileBytes <- c.getOrElse[Int]("maxFileBytes")(4194304); maxRunFiles <- c.getOrElse[Int]("maxRunFiles")(10000)
    scheduler <- c.get[SchedulerConfig]("scheduler"); forges <- c.get[List[ForgeConfig]]("forges"); models <- c.get[List[ModelRef]]("models")
    testMode <- c.getOrElse[Boolean]("testMode")(false); oauthClients <- c.getOrElse[List[OAuthClientConfig]]("oauthClients")(Nil)
  } yield Config(listenHost, listenPort, allowedOrigin, secureCookies, allowInsecureHttp && testMode, jdbcUrl, databaseUser, databasePasswordFile, databaseLimits, users, masterKeyFile, workerCommand, webRoot, workspaceRoot, cacheRoot, maxBodyBytes, sessionTtlSeconds, maxPromptBytes, maxFileBytes, maxRunFiles, scheduler, forges, models, oauthClients, testMode))
  def load(path: String): Config = { val config = JsonSupport.decodeFile[Config](Path.of(path), 1048576); config.validate(); config.loadModels(); config }
}
