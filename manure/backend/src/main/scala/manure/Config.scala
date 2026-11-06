package manure

import io.circe.{Json, HCursor}
import java.net.{InetAddress, URI}
import java.nio.file.{Files, Path}
import ponygirls.runtime.{JdbcConfig, JdbcLimits}
import scala.concurrent.duration.*

final case class ApiOrigin(value: String, scheme: String, host: String, port: Int):
  def insecure: Boolean = scheme == "http"
object ApiOrigin:
  def parse(value: String): ApiOrigin =
    try
      val uri = URI.create(value)
      Require(Set("http","https")(uri.getScheme) && uri.getHost != null && uri.getRawUserInfo == null &&
        uri.getRawQuery == null && uri.getRawFragment == null && Set("", "/")(Option(uri.getRawPath).getOrElse("")) &&
        !value.exists(c => c.isWhitespace || c.isControl) && uri.getPort >= -1 && uri.getPort <= 65535, "bad-envelope")
      val scheme = uri.getScheme
      val host = uri.getHost.stripPrefix("[").stripSuffix("]").toLowerCase(java.util.Locale.ROOT)
      val port = if uri.getPort < 0 then if scheme == "https" then 443 else 80 else uri.getPort
      ApiOrigin(value.stripSuffix("/"),scheme,host,port)
    catch case _: IllegalArgumentException => throw DomainError("bad-envelope")
  def loopback(host: String): Boolean = Set("localhost","127.0.0.1","::1")(host) || host.endsWith(".localhost")

final case class Network(cidr: String):
  private val parts = cidr.split("/",-1)
  Require(parts.length == 2 && parts(0).matches("[0-9a-fA-F:.]+"), "bad-envelope")
  private val address = com.comcast.ip4s.IpAddress.fromString(parts(0)).getOrElse(throw DomainError("bad-envelope")).toBytes
  private val prefix = try parts(1).toInt catch case _: NumberFormatException => throw DomainError("bad-envelope")
  Require(prefix >= 0 && prefix <= address.length*8, "bad-envelope")
  def contains(remote: String): Boolean =
    try
      val candidate = InetAddress.getByName(remote).getAddress
      candidate.length == address.length && address.indices.forall { i =>
        val bits = math.min(8,math.max(0,prefix-i*8))
        val mask = (0xff << (8-bits)) & 0xff
        (address(i) & mask) == (candidate(i) & mask)
      }
    catch case _: Exception => false

final case class EmbeddingSettings(endpoint: ponygirls.retrieval.EmbeddingEndpoint,maxConcurrent: Int,maxQueued: Int,batchSize: Int,leaseSeconds: Int,pollInterval: FiniteDuration):
  def validate(): Unit =
    endpoint.validate()
    Require(maxConcurrent > 0 && maxQueued >= 0 && batchSize > 0 && batchSize <= endpoint.maxBatch && leaseSeconds >= 3 && leaseSeconds <= 3600 && pollInterval > Duration.Zero, "bad-envelope")

final case class Config(
  listenAddress: String, port: Int, dataDir: Path, apiOrigin: ApiOrigin, contentMode: String,
  contentSuffix: String, loopbackDev: Boolean, allowInsecureHttp: Boolean,
  allowedApiOrigins: Vector[ApiOrigin], trustedProxies: Vector[Network], users: Vector[UserConfig],
  limits: Limits, database: JdbcConfig, nativeMode: String, posixLibrary: Option[String],
  dashboardDir: Option[Path], unlockShellDir: Option[Path], maxConnections: Int,
  requestTimeout: FiniteDuration, sweepInterval: FiniteDuration, rateMapMaxEntries: Int,
  rateLimitPerMinute: Int, unlockRatePerMinute: Int, loginRatePerMinutePerIp: Int, embedding: Option[EmbeddingSettings], migrationReceiptDir: Option[Path], migrationManifestMaxBytes: Int, migrationManifestMaxEntries: Int, rootAuthority: Option[KubernetesRootConfig]
):
  def origins: Vector[ApiOrigin] = apiOrigin +: allowedApiOrigins
  def validate(): Unit =
    Require(listenAddress.nonEmpty && port >= 0 && port <= 65535 && dataDir.isAbsolute &&
      Set("path","subdomain")(contentMode) && Set("linked","shared")(nativeMode) &&
      (nativeMode != "shared" || posixLibrary.exists(p => Path.of(p).isAbsolute)) &&
      maxConnections > 0 && requestTimeout > Duration.Zero && sweepInterval > Duration.Zero &&
      rateMapMaxEntries > 0 && rateLimitPerMinute > 0 && unlockRatePerMinute > 0 && loginRatePerMinutePerIp > 0, "bad-envelope")
    Require(apiOrigin.scheme == "https" || loopbackDev || allowInsecureHttp, "bad-envelope")
    Require(!loopbackDev || ApiOrigin.loopback(apiOrigin.host), "bad-envelope")
    Require(allowedApiOrigins.isEmpty || contentMode == "path" && !loopbackDev, "bad-envelope")
    Require(origins.map(_.host).distinct.size == origins.size && origins.forall(o => !o.insecure || loopbackDev || allowInsecureHttp), "bad-envelope")
    if contentMode == "subdomain" || contentSuffix.nonEmpty then
      Require(contentSuffix.length <= 253 && contentSuffix.matches("[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*"), "bad-envelope")
    Require(!loopbackDev || contentSuffix.isEmpty || ApiOrigin.loopback(contentSuffix), "bad-envelope")
    Require(contentMode != "path" || !apiOrigin.host.takeWhile(_ != '.').matches("[0-9a-f]{32}"), "bad-envelope")
    Require(users.nonEmpty && users.map(_.id).distinct.size == users.size && users.forall(u =>
      u.id.nonEmpty && Set("human","agent")(u.userType) && u.tokens.nonEmpty &&
      u.tokens.map(_.id).distinct.size == u.tokens.size && u.tokens.forall(t => t.id.nonEmpty && t.hashFile.toString.nonEmpty)), "bad-envelope")
    Require(migrationManifestMaxBytes > 0 && migrationManifestMaxBytes <= 536870912 && migrationManifestMaxEntries > 0, "bad-envelope")
    rootAuthority.foreach { settings =>
      val writable=Vector(dataDir.normalize()) ++ migrationReceiptDir.map(_.normalize())
      Require(Vector(settings.caFile,settings.tokenFile,settings.podUidFile).forall(path => !writable.exists(path.startsWith)),"config")
    }
    database.validate(); embedding.foreach(_.validate())
    migrationReceiptDir.foreach(p => Require(p.isAbsolute && dataDir == p.resolve("data"), "bad-envelope"))
  def contentMount(id: String): String = if contentMode == "path" then "/view/" + id else ""
  def contentUrl(id: String,origin: ApiOrigin): String =
    Require(id.matches("[0-9a-f]{32}"), "not-found")
    if contentMode == "path" then origin.value + contentMount(id)
    else
      val suffix = if loopbackDev && contentSuffix == "localhost" then "localhost" else contentSuffix
      val portText = if origin.port == (if origin.scheme == "https" then 443 else 80) then "" else ":" + origin.port
      origin.scheme + "://" + id + "." + suffix + portText

object Config:
  private def field[A: io.circe.Decoder](c: HCursor,key: String): A = c.get[A](key).getOrElse(throw DomainError("bad-envelope"))
  private def default[A: io.circe.Decoder](c: HCursor,key: String,value: A): A =
    if c.downField(key).focus.isEmpty then value else field[A](c,key)
  private def shell(c: HCursor,key: String): Option[Path] =
    if c.downField(key).focus.contains(Json.Null) then None
    else Some(Path.of(default(c,key,"manure/web/" + (if key == "dashboard_dir" then "dashboard" else "unlock"))))
  def load(path: Path): Config =
    val source = ponygirls.runtime.BoundedSecretFile.read(path.toAbsolutePath,1048576)
    val c = CurrentWire.parse(source).hcursor
    val known = Set("listen_address","port","data_dir","api_origin","content_mode","content_suffix","loopback_dev","allow_insecure_http","allowed_api_origins","trusted_proxies","users","database","native_mode","posix_library","dashboard_dir","unlock_shell_dir","storage_quota_bytes","chunk_bytes","max_file_bytes","max_artifact_bytes","max_files_per_artifact","max_request_body_bytes","max_list_limit","max_connections","request_timeout_s","max_sessions_per_user","max_sessions_global","max_grants_per_artifact","rate_map_max_entries","rate_limit_per_min","unlock_rate_per_min","login_rate_per_min_per_ip","sweep_interval_s","incomplete_session_ttl_s","grant_ttl_s","one_time_grant_ttl_s","embedding","migration_receipt_dir","migration_manifest_max_bytes","migration_manifest_max_entries","root_authority")
    Require(c.keys.exists(_.forall(known)), "bad-envelope")
    val users = field[Vector[Json]](c,"users").map { j =>
      val u = j.hcursor
      UserConfig(field(u,"id"),field(u,"type"),field[Vector[Json]](u,"tokens").map { token =>
        val t = token.hcursor; TokenRef(field(t,"id"),Path.of(field[String](t,"hashFile")))
      },default(u,"displayName",""))
    }
    val l = Limits(default(c,"storage_quota_bytes",21474836480L),default(c,"chunk_bytes",1048576),
      default(c,"max_file_bytes",536870912L),default(c,"max_artifact_bytes",2147483648L),default(c,"max_files_per_artifact",10000),
      default(c,"max_request_body_bytes",4194304),default(c,"max_list_limit",200),default(c,"max_sessions_per_user",10),
      default(c,"max_sessions_global",1000),default(c,"max_grants_per_artifact",10000),default(c,"incomplete_session_ttl_s",86400L),
      default(c,"grant_ttl_s",86400L),default(c,"one_time_grant_ttl_s",60L))
    val d = c.downField("database").success.getOrElse(throw DomainError("bad-envelope"))
    val b = d.downField("limits").success.getOrElse(throw DomainError("bad-envelope"))
    val database = JdbcConfig(field(d,"jdbcUrl"),field(d,"user"),Path.of(field[String](d,"passwordFile")),JdbcLimits(
      field(b,"maxConnections"),field(b,"maxQueued"),field[Long](b,"queueTimeoutMs").millis,
      field[Long](b,"connectTimeoutMs").millis,field[Long](b,"statementTimeoutMs").millis,
      field[Long](b,"lockTimeoutMs").millis,field[Long](b,"idleTransactionTimeoutMs").millis,field[Long](b,"socketTimeoutMs").millis))
    val embedding = c.get[Option[Json]]("embedding").getOrElse(throw DomainError("bad-envelope")).map { value =>
      val e = value.hcursor
      val endpoint = ponygirls.retrieval.EmbeddingEndpoint(field(e,"operationUrl"),field(e,"model"),field(e,"revision"),field(e,"dimensions"),
        field(e,"sendDimensions"),field(e,"documentPrefix"),field(e,"queryPrefix"),field(e,"normalization"),field(e,"credentialFile"),
        field[Long](e,"deadlineMs").millis,field(e,"maxResponseBytes"),field(e,"maxBatch"),field(e,"maxInputBytes"),field(e,"maxRequestBytes"))
      EmbeddingSettings(endpoint,field(e,"maxConcurrent"),field(e,"maxQueued"),field(e,"batchSize"),field(e,"leaseSeconds"),field[Long](e,"pollIntervalMs").millis)
    }
    val config = Config(default(c,"listen_address","127.0.0.1"),default(c,"port",47329),Path.of(field[String](c,"data_dir")),
      ApiOrigin.parse(field(c,"api_origin")),default(c,"content_mode","subdomain"),default(c,"content_suffix",""),default(c,"loopback_dev",false),
      default(c,"allow_insecure_http",false),default(c,"allowed_api_origins",Vector.empty[String]).map(ApiOrigin.parse),
      default(c,"trusted_proxies",Vector("127.0.0.1/32","::1/128")).map(Network.apply),users,l,database,
      default(c,"native_mode","linked"),c.get[Option[String]]("posix_library").getOrElse(throw DomainError("bad-envelope")),
      shell(c,"dashboard_dir"),shell(c,"unlock_shell_dir"),default(c,"max_connections",128),default[Long](c,"request_timeout_s",30L).seconds,
      default[Long](c,"sweep_interval_s",300L).seconds,default(c,"rate_map_max_entries",4096),default(c,"rate_limit_per_min",600),
      default(c,"unlock_rate_per_min",10),default(c,"login_rate_per_min_per_ip",10),embedding,c.get[Option[String]]("migration_receipt_dir").getOrElse(throw DomainError("bad-envelope")).map(Path.of(_)),default(c,"migration_manifest_max_bytes",67108864),default(c,"migration_manifest_max_entries",1000000),c.get[Option[Json]]("root_authority").getOrElse(throw DomainError("bad-envelope")).map(KubernetesRootConfig.parse))
    config.validate(); config
