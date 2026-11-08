package manure

import cats.effect.IO
import cats.syntax.all.*
import fs2.Stream
import org.http4s.{Header, Headers, HttpApp, Method, Request, Response, Status}
import org.typelevel.ci.CIString
import manure.{api => wire}
import java.net.{URI, URLDecoder, URLEncoder}
import java.nio.file.{Files, Path}
import java.util.UUID
import scala.concurrent.duration.*

final class Throttle(capacity: Int, clock: DomainClock):
  private val entries = scala.collection.mutable.Map.empty[String,(Double,Int)]
  def allow(key: String,limit: Int): Boolean = synchronized {
    val now = clock.now
    entries.filterInPlace((_,value) => now-value._1 < 60)
    entries.get(key) match
      case Some((start,count)) if count < limit => entries.update(key,(start,count+1)); true
      case Some(_) => false
      case None if entries.size < capacity => entries.update(key,(now,1)); true
      case None => false
  }

/** Domain HTTP adapter. Raw bytes are NEVER put in generated JSON or read as an
  * entire file. Security context is resolved before route/body/domain effects.
  */
final class Http(config: Config, artifacts: Artifacts, catalogue: Catalogue, auth: Auth, clock: DomainClock, search: Search):
  @volatile private var boundPort = config.port
  def setBoundPort(value: Int): Unit = boundPort = value
  private val throttle = new Throttle(config.rateMapMaxEntries,clock)
  private case class Context(origin: ApiOrigin,contentId: Option[String],mount: String):
    def content: Boolean = contentId.nonEmpty
    def insecure: Boolean = origin.insecure
    def contentOrigin: String = contentId.map(config.contentUrl(_,origin)).map(v => {
      val uri = URI.create(v); uri.getScheme + "://" + uri.getRawAuthority
    }).getOrElse(origin.value)
  private def header(req: Request[IO],name: String): Option[String] =
    val values = req.headers.headers.filter(_.name == CIString(name)).map(_.value)
    Require(values.size <= 1, if name == "Host" then "bad-host" else "bad-envelope")
    values.headOption
  private def peer(req: Request[IO]): String = req.remoteAddr.map(_.toString).getOrElse("unknown")
  private def originHeader(req: Request[IO]): Option[String] = header(req,"Origin")
  private def effective(origin: ApiOrigin): ApiOrigin =
    if config.port == 0 && origin == config.apiOrigin then
      val host = if origin.host.contains(":") then "[" + origin.host + "]" else origin.host
      ApiOrigin.parse(origin.scheme + "://" + host + ":" + boundPort)
    else origin
  private def context(req: Request[IO]): Context =
    val hostValue = header(req,"Host").getOrElse(throw DomainError("bad-host"))
    Require(hostValue.nonEmpty && !hostValue.exists(c => c.isWhitespace || c.isControl) && !hostValue.contains("@"), "bad-host")
    val uri = try URI.create("http://" + hostValue) catch case _: IllegalArgumentException => throw DomainError("bad-host")
    Require(uri.getHost != null && uri.getRawPath.isEmpty && uri.getRawQuery == null && uri.getRawFragment == null &&
      uri.getPort >= -1 && uri.getPort <= 65535 && !hostValue.endsWith(":"), "bad-host")
    val host = uri.getHost.stripPrefix("[").stripSuffix("]").toLowerCase(java.util.Locale.ROOT)
    val origins = config.origins.map(effective)
    val matched = origins.find(_.host == host)
    val subdomain = if config.contentMode == "subdomain" && host.endsWith("." + config.contentSuffix) then
      Some(host.stripSuffix("." + config.contentSuffix)).filter(_.matches("[0-9a-f]{32}")) else None
    Require(matched.nonEmpty || subdomain.nonEmpty, "bad-host")
    val origin = matched.getOrElse(effective(config.apiOrigin))
    val expectedPort = origin.port
    val actualPort = if uri.getPort < 0 then if origin.scheme == "https" then 443 else 80 else uri.getPort
    Require(actualPort == expectedPort || config.loopbackDev && uri.getPort < 0, "bad-host")
    val raw = req.uri.path.renderString
    val mounted = if config.contentMode == "path" && matched.nonEmpty then
      raw.split("/",4).toVector match
        case Vector("","view",id, _*) if id.matches("[0-9a-f]{32}") => Some(id)
        case _ => None
    else None
    val id = subdomain.orElse(mounted)
    val ctx = Context(origin,id,id.map(config.contentMount).getOrElse(""))
    if config.loopbackDev && origin.insecure then Require(ApiOrigin.loopback(host), "tls-required")
    if !config.loopbackDev && !origin.insecure then
      Require(config.trustedProxies.exists(_.contains(peer(req))) && header(req,"X-Forwarded-Proto").contains("https"), "tls-required")
    ctx
  private case class Credentials(identity: Option[Identity],kind: String,raw: Option[String])
  private def credentials(req: Request[IO],ctx: Context): Credentials =
    val authorization = header(req,"Authorization")
    val cookie = Cookies.parse(header(req,"Cookie")).get(Cookies.sessionName(config.loopbackDev,ctx.insecure))
    Require(!(authorization.nonEmpty && cookie.nonEmpty), "ambiguous-credentials")
    val bearer = authorization.map { value =>
      Require(value.startsWith("Bearer "), "unauthorized"); value.substring(7)
    }
    val raw = bearer.orElse(cookie)
    val identity = raw.map(v => auth.authenticate(v).getOrElse(throw DomainError("unauthorized")))
    Credentials(identity,if bearer.nonEmpty then "bearer" else if cookie.nonEmpty then "cookie" else "",raw)
  private def required(c: Credentials): Identity = c.identity.getOrElse(throw DomainError("unauthorized"))
  private def mutation(req: Request[IO],ctx: Context,c: Credentials): Unit =
    val offered = originHeader(req)
    Require(if c.kind == "cookie" then offered.contains(ctx.origin.value) else offered.forall(_ == ctx.origin.value), "forbidden")
    val i = required(c)
    Require(throttle.allow("mutation:" + i.userId,config.rateLimitPerMinute), "rate-limited")
  private def sessionCookie(ctx: Context,value: String,clear: Boolean): String =
    Cookies.sessionName(config.loopbackDev,ctx.insecure) + "=" + (if clear then "" else value) +
      "; Path=/; HttpOnly; SameSite=Strict" + (if !config.loopbackDev && !ctx.insecure then "; Secure" else "") +
      "; Max-Age=" + (if clear then "0" else "86400")
  private def contentCookie(ctx: Context,id: String,value: String,expiry: Double,clear: Boolean): String =
    Cookies.grantName(config.loopbackDev,ctx.insecure,id,config.contentMode == "path") + "=" + (if clear then "" else value) +
      "; Path=" + ctx.mount + "/; HttpOnly; SameSite=Lax" + (if !config.loopbackDev && !ctx.insecure then "; Secure" else "") +
      "; Max-Age=" + (if clear then "0" else math.max(1L,(expiry-clock.now).toLong).toString)
  private def presented(req: Request[IO],ctx: Context,id: String): Option[String] =
    Cookies.parse(header(req,"Cookie")).get(Cookies.grantName(config.loopbackDev,ctx.insecure,id,config.contentMode == "path"))
  private def raw(name: String,value: String): Header.Raw = Header.Raw(CIString(name),value)
  private def secure(response: Response[IO],content: Boolean): Response[IO] =
    val base = response.putHeaders(raw("Origin-Agent-Cluster","?1"),raw("Cross-Origin-Opener-Policy","same-origin"),
      raw("Cross-Origin-Resource-Policy","same-origin"),raw("X-Content-Type-Options","nosniff"),
      raw("Cache-Control","no-store"))
      .putHeaders(raw("Referrer-Policy",response.headers.headers.find(_.name == CIString("Referrer-Policy")).map(_.value).getOrElse("no-referrer")))
    if content && !base.headers.headers.exists(_.name == CIString("Content-Security-Policy")) then base.putHeaders(raw("Content-Security-Policy","frame-ancestors 'none'; base-uri 'none'; form-action 'self'")) else base
  private def json(value: io.circe.Json,status: Int = 200): Response[IO] =
    Response[IO](Status.fromInt(status).getOrElse(Status.InternalServerError)).withEntity(value.noSpaces)
      .putHeaders(raw("Content-Type","application/json"))
  private def envelope(id: UUID,result: wire.Result,status: Int = 200): Response[IO] =
    json(CurrentWire.encode(wire.ServerEnvelope.codecJson,wire.ServerEnvelope(id,result)),status)
  private def failure(id: UUID,error: Throwable): Response[IO] =
    val code = error match
      case d: DomainError => d.code
      case _ => "unavailable"
    val response = envelope(id,CurrentWire.error(code),CurrentWire.status(code))
    if Set("unavailable","rate-limited","session-limit")(code) then response.putHeaders(raw("Retry-After","5")) else response
  /** Rejection has no credential/body effects and cannot retain a keep-alive slot. */
  def overloaded: Response[IO] = secure(failure(new UUID(0L,0L),DomainError("unavailable")),false)
    .putHeaders(raw("Connection","close"))
  private def body(req: Request[IO],cap: Int): IO[Array[Byte]] = IO {
    Require(header(req,"Transfer-Encoding").isEmpty, "bad-envelope")
    header(req,"Content-Length").foreach { value =>
      Require(value.matches("[0-9]+"), "bad-envelope")
      val length = try value.toLong catch case _: NumberFormatException => throw DomainError("too-large")
      Require(length <= cap, "too-large")
    }
  } *> req.body.take(cap.toLong+1).compile.to(Array).flatTap(bytes => IO(Require(bytes.length <= cap, "too-large")))
  private def readJson(req: Request[IO]): IO[io.circe.Json] =
    IO(Require(header(req,"Content-Type").exists(_.split(";",2)(0).trim == "application/json"), "bad-envelope")) *>
      body(req,config.limits.maxRequestBodyBytes).map(b => CurrentWire.parse(Exact.string(b)))
  private def decoded(rawPath: String): (String,Boolean) =
    Require(rawPath.startsWith("/"), "invalid-path")
    if rawPath == "/" then ("",false)
    else
      val trailing = rawPath.endsWith("/")
      val stripped = rawPath.drop(1).stripSuffix("/")
      val parts = stripped.split("/",-1).toVector.map { value =>
        Require(!"%(?![0-9a-fA-F]{2})".r.findFirstIn(value).nonEmpty, "invalid-path")
        val decoded = try
          val buffer = new java.io.ByteArrayOutputStream()
          var i = 0
          while i < value.length do
            if value.charAt(i) == '%' then
              buffer.write(Integer.parseInt(value.substring(i+1,i+3),16)); i += 3
            else
              val cp = value.codePointAt(i)
              buffer.write(Exact.utf8(new String(Character.toChars(cp)))); i += Character.charCount(cp)
          Exact.string(buffer.toByteArray)
        catch case _: IllegalArgumentException | _: java.nio.charset.CharacterCodingException => throw DomainError("invalid-path")
        Require(decoded.nonEmpty && decoded != "." && decoded != ".." && !decoded.contains('/'), "invalid-path")
        decoded
      }
      val value = parts.mkString("/"); Manifest.path(value); (value,trailing)
  private def query(req: Request[IO],key: String): Option[String] =
    val values = req.uri.query.multiParams.getOrElse(key,Seq.empty)
    Require(values.size <= 1, "bad-envelope"); values.headOption
  private def url(ctx: Context,id: String): String = config.contentUrl(id,ctx.origin)
  private def summary(ctx: Context,a: Artifact): wire.Artifact = CurrentWire.artifact(a,url(ctx,a.id))
  private def command(req: Request[IO],ctx: Context,c: Credentials,e: wire.ClientEnvelope): IO[Response[IO]] =
    val result: IO[wire.Result] = e.command match
      case _: wire.Command.Version => IO.pure(wire.Result.Version(wire.VersionInfo(CurrentWire.version,List(CurrentWire.version))))
      case _: wire.Command.GetCapabilities =>
        IO.pure(wire.Result.CapabilityInfo(wire.Capabilities(if config.contentMode == "path" then wire.ContentMode.Path else wire.ContentMode.Subdomain,
          search.modes,true,config.limits.chunkBytes,config.limits.maxListLimit,config.limits.maxRequestBodyBytes,
          config.limits.maxFileBytes,config.limits.maxArtifactBytes,config.limits.maxFilesPerArtifact,31536000,CataloguePolicy.Id)))
      case _: wire.Command.Whoami => IO(wire.Result.Identity(CurrentWire.principal(required(c))))
      case wire.Command.Login(token) =>
        return IO {
          Require(originHeader(req).contains(ctx.origin.value), "forbidden")
          Require(throttle.allow("login:" + peer(req),config.loginRatePerMinutePerIp), "rate-limited")
          val i = auth.authenticate(token).getOrElse(throw DomainError("unauthorized"))
          auth.human(i)
          envelope(e.requestId,wire.Result.Identity(CurrentWire.principal(i))).putHeaders(raw("Set-Cookie",sessionCookie(ctx,token,false)))
        }
      case _: wire.Command.Logout =>
        IO(mutation(req,ctx,c)) *> artifacts.logout(required(c)).as(wire.Result.Ok())
      case wire.Command.ListArtifacts(q) => catalogue.list(required(c),q).map { (items,next) => wire.Result.Catalogue(wire.CataloguePage(items.map(summary(ctx,_)).toList,next)) }
      case wire.Command.InitUpload(name,kind,visibility,expiry,files) =>
        IO(mutation(req,ctx,c)) *> artifacts.init(required(c),InitUpload(name,CurrentWire.kind(kind),CurrentWire.visibility(visibility),CurrentWire.manifest(files),expiry.map(_.toLong)))
          .map(a => wire.Result.UploadInitialized(a.artifact.id,config.limits.chunkBytes,url(ctx,a.artifact.id),a.externalPassword))
      case wire.Command.GetArtifact(id) => artifacts.info(required(c),id).map(a => wire.Result.ArtifactInfo(summary(ctx,a)))
      case wire.Command.GetManifest(id) =>
        val visible = c.identity match
          case Some(identity) => artifacts.info(identity,id)
          case None => artifacts.contentInfo(id,None,None,None)
        visible.map(a => wire.Result.ArtifactManifest(CurrentWire.manifest(a)))
      case wire.Command.GetUploadStatus(id) => artifacts.status(required(c),id).map { p =>
        wire.Result.UploadProgress(wire.UploadStatus(id,CurrentWire.state(p.state),config.limits.chunkBytes,p.files.map(f =>
          wire.FileProgress(f.path,f.size,f.receivedBytes,f.ranges.map((s,e) => wire.ByteRange(s,e)).toList)).toList))
      }
      case wire.Command.PatchArtifact(id,patch) =>
        val expiry = patch.expiry match
          case _: wire.ExpiryChange.Keep => TtlPatch.Unchanged
          case _: wire.ExpiryChange.Clear => TtlPatch.Never
          case wire.ExpiryChange.Set(seconds) => TtlPatch.After(seconds.toLong)
        IO(mutation(req,ctx,c)) *> artifacts.patch(required(c),id,ArtifactPatch(patch.name,patch.visibility.map(CurrentWire.visibility),expiry))
          .map(a => wire.Result.ArtifactPatched(summary(ctx,a.artifact),a.externalPassword))
      case wire.Command.DeleteArtifact(id) => IO(mutation(req,ctx,c)) *> artifacts.delete(required(c),id).as(wire.Result.Ok())
      case wire.Command.GetExternalPassword(id) => IO(mutation(req,ctx,c)) *> artifacts.externalPassword(required(c),id).map(wire.Result.ExternalPasswordRetrieved.apply)
      case wire.Command.RotateExternalPassword(id) => IO(mutation(req,ctx,c)) *> artifacts.rotate(required(c),id).map(wire.Result.PasswordRotated.apply)
      case wire.Command.FinishUpload(id) => IO(mutation(req,ctx,c)) *> artifacts.finish(required(c),id).map(a => wire.Result.UploadFinished(id,CurrentWire.state(a.state),url(ctx,id)))
      case wire.Command.CreateGrant(id) => IO(mutation(req,ctx,c)) *> artifacts.createGrant(required(c),id).map(g => wire.Result.GrantCreated(g,config.limits.oneTimeGrantTtl.toInt))
      case wire.Command.Search(q) => search.query(required(c),q,ctx.origin).map(wire.Result.SearchResults.apply)
    result.map { result =>
      val response = envelope(e.requestId,result)
      if e.command.isInstanceOf[wire.Command.Logout] then response.putHeaders(raw("Set-Cookie",sessionCookie(ctx,"",true))) else response
    }
  private def api(req: Request[IO],ctx: Context): IO[Response[IO]] =
    val path = req.uri.path.renderString
    val c = credentials(req,ctx)
    if req.method == Method.POST && path == "/api/current" then
      readJson(req).flatMap { value =>
        val id = CurrentWire.requestId(value)
        IO(CurrentWire.command(value)).flatMap(command(req,ctx,c,_)).handleError(e => failure(id,e))
      }
    else if req.method == Method.POST && path == "/api/current/login" then
      IO {
        Require(originHeader(req).contains(ctx.origin.value), "forbidden")
        Require(throttle.allow("login:" + peer(req),config.loginRatePerMinutePerIp), "rate-limited")
      } *> form(req).flatMap { fields => IO {
        val token = fields.getOrElse("token","")
        val i = auth.authenticate(token).getOrElse(throw DomainError("unauthorized"))
        auth.human(i)
        Response[IO](Status.SeeOther).putHeaders(raw("Location","/"),raw("Set-Cookie",sessionCookie(ctx,token,false)))
      }}
    else if req.method == Method.POST && path == "/api/current/logout" then
      IO(mutation(req,ctx,c)) *> form(req) *> artifacts.logout(required(c)).as(
        Response[IO](Status.SeeOther).putHeaders(raw("Location","/"),raw("Set-Cookie",sessionCookie(ctx,"",true))))
    else if req.method == Method.PUT && path.matches("/api/current/artifacts/[0-9a-f]{32}/chunks") then
      val id = path.split("/")(4)
      IO(mutation(req,ctx,c)) *> IO {
        val path = query(req,"path").getOrElse(throw DomainError("bad-envelope"))
        val offset = query(req,"offset").getOrElse(throw DomainError("invalid-range"))
        Require(offset.matches("[0-9]+"), "invalid-range")
        val n = try offset.toLong catch case _: NumberFormatException => throw DomainError("invalid-range")
        val hash = header(req,"X-Chunk-SHA256").getOrElse(throw DomainError("invalid-range"))
        (path,n,hash)
      }.flatMap { (file,offset,hash) => body(req,config.limits.chunkBytes).flatMap { bytes =>
        artifacts.putChunk(required(c),id,file,offset,bytes,hash).map { received =>
          json(CurrentWire.encode(wire.ChunkReceipt.codecJson,wire.ChunkReceipt(file,offset,bytes.length,received)))
        }
      }}
    else if req.method == Method.GET && path.matches("/api/current/artifacts/[0-9a-f]{32}/files/.+/content") then
      val id = path.split("/")(4)
      val encoded = path.substring(("/api/current/artifacts/" + id + "/files/").length).stripSuffix("/content")
      val (file,_) = decoded("/" + encoded)
      val eligibility = c.identity match
        case Some(identity) => artifacts.info(identity,id).map(_ => ())
        case None => IO.unit
      eligibility *> serveFile(req,ctx,id,file,true,c.identity)
    else if req.method == Method.GET && (path == "/" || Set("/app.js","/styles.css","/current-protocol.js","/current-schema.js","/quick-upload.js","/sha256.js")(path) || path.startsWith("/current/")) then
      c.identity.foreach(auth.human)
      asset(config.dashboardDir,if path == "/" then "index.html" else path.drop(1),ctx,true)
    else IO.raiseError(DomainError("not-found"))
  private def asset(directory: Option[Path],name: String,ctx: Context,dashboard: Boolean): IO[Response[IO]] = IO.blocking {
    val root = directory.getOrElse(throw DomainError(if dashboard then "dashboard-disabled" else "not-found"))
    val generated = name.matches("current/(?:manure/api/)?[A-Za-z][A-Za-z0-9_]*\\.js")
    Require(Set("index.html","app.js","styles.css","unlock.js","current-protocol.js","current-schema.js","quick-upload.js","sha256.js")(name) || dashboard && generated, "not-found")
    val file = root.resolve(name)
    Require(Files.isRegularFile(file) && Files.size(file) <= 2097152, "not-found")
    var bytes = Files.readAllBytes(file)
    if name == "index.html" && ctx.mount.nonEmpty then
      val html = Exact.string(bytes).replace("href=\"/","href=\"" + ctx.mount + "/")
        .replace("src=\"/","src=\"" + ctx.mount + "/").replace("action=\"/","action=\"" + ctx.mount + "/")
      bytes = Exact.utf8(html.replace("id=\"path-mode-warning\" hidden","id=\"path-mode-warning\""))
    val response = Response[IO](Status.Ok).withEntity(bytes).putHeaders(raw("Content-Type",mime(name)))
    val navigational = if name == "index.html" then response.putHeaders(raw("Referrer-Policy","strict-origin")) else response
    if dashboard then
      val port = if ctx.origin.port == (if ctx.origin.scheme == "https" then 443 else 80) then "" else ":" + ctx.origin.port
      val forms = if config.contentMode == "path" then "'self'" else "'self' " + ctx.origin.scheme + "://*." + config.contentSuffix + port
      navigational.putHeaders(raw("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action " + forms))
    else navigational
  }
  private def mime(path: String): String = path.toLowerCase(java.util.Locale.ROOT).split('.').lastOption.getOrElse("") match
    case "html" | "htm" => "text/html; charset=utf-8"
    case "js" | "mjs" => "application/javascript; charset=utf-8"
    case "css" => "text/css; charset=utf-8"
    case "txt" | "md" | "markdown" | "mmd" | "mermaid" | "dot" | "gv" => "text/plain; charset=utf-8"
    case "json" => "application/json"
    case "svg" => "image/svg+xml"
    case "png" => "image/png"
    case "jpg" | "jpeg" => "image/jpeg"
    case "gif" => "image/gif"
    case "webp" => "image/webp"
    case "avif" => "image/avif"
    case "bmp" => "image/bmp"
    case "ico" => "image/x-icon"
    case "pdf" => "application/pdf"
    case "wasm" => "application/wasm"
    case _ => "application/octet-stream"
  private def encoded(value: String): String = value.split("/",-1).map(v => URLEncoder.encode(v,"UTF-8").replace("+","%20")).mkString("/")
  private def disposition(value: String): String =
    val base = value.split("/").last
    val fallback = base.map(c => if c >= 32 && c < 127 && c != '"' && c != '\\' then c else '_')
    "attachment; filename=\"" + fallback + "\"; filename*=UTF-8''" + encoded(base)
  private def serveFile(req: Request[IO],ctx: Context,id: String,path: String,attachment: Boolean,identity: Option[Identity]): IO[Response[IO]] =
    val grant = if ctx.content then presented(req,ctx,id) else None
    val password = if ctx.content then header(req,"X-Manure-Password") else None
    artifacts.contentInfo(id,grant,password,identity).flatMap { a =>
      val entry = a.manifest.find(e => !e.directory && e.path == path).getOrElse(throw DomainError("not-found"))
      val range = header(req,"Range")
      val selected = try Right(range.map(UploadRules.range(_,entry.size)).getOrElse((0L,entry.size))) catch case d: DomainError => Left(d)
      selected match
        case Left(_) => IO.pure(envelope(new UUID(0L,0L),CurrentWire.error("invalid-range"),416)
          .putHeaders(raw("Content-Range","bytes */" + entry.size),raw("Accept-Ranges","bytes")))
        case Right((start,end)) =>
          val stream = Stream.resource(artifacts.openContent(id,path,grant,password,identity)).flatMap { (_,file) =>
            Stream.unfoldChunkEval(start) { offset =>
              if offset >= end then IO.pure(None)
              else IO.blocking {
                val bytes = file.read(offset,math.min(65536L,end-offset).toInt)
                Require(bytes.nonEmpty, "unavailable")
                Some((fs2.Chunk.array(bytes),offset+bytes.length))
              }
            }
          }.interruptAfter(config.requestTimeout)
          var response = Response[IO](if range.nonEmpty then Status.PartialContent else Status.Ok).withBodyStream(stream)
            .putHeaders(raw("Content-Length",(end-start).toString),raw("Content-Type",if attachment then "application/octet-stream" else mime(path)),raw("Accept-Ranges","bytes"))
          if range.nonEmpty then response = response.putHeaders(raw("Content-Range",s"bytes $start-${end-1}/${entry.size}"))
          if attachment then response = response.putHeaders(raw("Content-Disposition",disposition(path)))
          IO.pure(response)
    }
  private def acceptsViewer(req: Request[IO]): Boolean =
    header(req,"Accept").exists(_.split(",").exists { offer =>
      val parts = offer.split(";").map(_.trim.toLowerCase(java.util.Locale.ROOT))
      parts.headOption.contains("text/html") && parts.drop(1).filter(_.startsWith("q=")).forall { q =>
        q.drop(2).toDoubleOption.exists(v => v > 0 && v <= 1)
      }
    })
  private def viewerKind(path: String): Option[String] =
    path.toLowerCase(java.util.Locale.ROOT).split('.').lastOption.flatMap {
      case "md" | "markdown" => Some("markdown")
      case "png" | "jpg" | "jpeg" | "gif" | "webp" | "avif" | "bmp" | "svg" | "ico" => Some("image")
      case "pdf" => Some("pdf")
      case "mmd" | "mermaid" => Some("mermaid")
      case "dot" | "gv" => Some("graphviz")
      case _ => None
    }
  private def htmlAttribute(value: String): String = value.flatMap {
    case '&' => "&amp;"
    case '<' => "&lt;"
    case '>' => "&gt;"
    case '"' => "&quot;"
    case '\'' => "&#39;"
    case c => c.toString
  }
  private def viewerBytes(name: String): IO[Array[Byte]] = IO.blocking {
    val root = config.viewerDir.getOrElse(throw DomainError("not-found"))
    Require(Set("index.html","viewer.js","graphviz-worker.js","pdf.worker.min.mjs","pdf.renderer.min.mjs","styles.css")(name), "not-found")
    val file = root.resolve(name)
    Require(Files.isRegularFile(file) && Files.size(file) <= 16777216L, "not-found")
    // Bound the read too: a concurrently replaced asset cannot bypass the cap.
    val input = Files.newInputStream(file)
    try
      val bytes = input.readNBytes(16777217)
      Require(bytes.length <= 16777216, "not-found")
      bytes
    finally input.close()
  }
  private def viewerShell(ctx: Context,path: String,directory: String): IO[Response[IO]] =
    val kind = viewerKind(path).getOrElse(throw DomainError("not-found"))
    viewerBytes("index.html").map { bytes =>
      val values = Map("__MANURE_ASSET_BASE__" -> (ctx.mount + "/__manure/viewer"),
        "__MANURE_PATH__" -> path,"__MANURE_RAW_URL__" -> (ctx.mount + "/__manure/raw/" + encoded(path)),
        "__MANURE_DOWNLOAD_URL__" -> (ctx.mount + "/__manure/files/" + encoded(path) + "/content"),"__MANURE_KIND__" -> kind)
      // A single pass prevents filenames containing placeholder text from being re-expanded.
      val html = "__MANURE_(?:ASSET_BASE|PATH|RAW_URL|DOWNLOAD_URL|KIND)__".r.replaceAllIn(Exact.string(bytes),
        m => java.util.regex.Matcher.quoteReplacement(htmlAttribute(values(m.matched))))
      val page = if directory.isEmpty then html else html.replace("<main>","<main>" + directory)
      Response[IO](Status.Ok).withEntity(page).putHeaders(raw("Content-Type","text/html; charset=utf-8"),
        raw("Content-Security-Policy","default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; worker-src 'self'; connect-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"))
    }
  /** Manifest-only immediate children: no filesystem traversal and no hidden recursive listing. */
  private def directoryPage(ctx: Context,a: Artifact,path: String): IO[Response[IO]] =
    val prefix = if path.isEmpty then "" else path + "/"
    val children = a.manifest.filter(_.path.startsWith(prefix)).flatMap { entry =>
      val rest = entry.path.stripPrefix(prefix)
      if rest.isEmpty then None
      else Some((rest.takeWhile(_ != '/'),entry.directory || rest.contains('/')))
    }.groupMapReduce(_._1)(_._2)(_ || _).toVector.sortBy((name,dir) => (if dir then 0 else 1,name))
    def link(url: String,label: String): String = "<a href=\"" + htmlAttribute(url) + "\">" + htmlAttribute(label) + "</a>"
    val parent = if path.isEmpty then "" else
      val up = path.split("/").dropRight(1).mkString("/")
      "<p>" + link(ctx.mount + "/" + (if up.isEmpty then "" else encoded(up) + "/"),"Parent directory") + "</p>"
    val rows = children.map { (name,dir) =>
      val full = prefix + name
      val href = if dir then ctx.mount + "/" + encoded(full) + "/"
        else if config.viewerDir.nonEmpty && viewerKind(full).nonEmpty then ctx.mount + "/__manure/view/" + encoded(full)
        else ctx.mount + "/" + encoded(full)
      val download = if dir then "" else " · " + link(ctx.mount + "/__manure/files/" + encoded(full) + "/content","Download")
      "<li>" + link(href,name + (if dir then "/" else "")) + download + "</li>"
    }.mkString
    val listing = "<section aria-label=\"Directory contents\"><h1>" + htmlAttribute(a.name) + " /" + htmlAttribute(path) +
      "</h1>" + parent + (if children.isEmpty then "<p>Empty directory</p>" else "<ul>" + rows + "</ul>") + "</section>"
    val readme = a.manifest.filter(e => !e.directory && e.path.startsWith(prefix)).map(_.path.stripPrefix(prefix))
      .filter(name => !name.contains('/') && name.equalsIgnoreCase("readme.md"))
      .sortBy(name => (if name == "README.md" then 0 else if name == "readme.md" then 1 else 2,name))
      .headOption.map(prefix + _)
    if config.viewerDir.nonEmpty && readme.nonEmpty then viewerShell(ctx,readme.get,listing)
    else IO.pure(Response[IO](Status.Ok).withEntity(
      "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Manure · Directory</title></head><body><main>" +
        listing + "</main></body></html>").putHeaders(raw("Content-Type","text/html; charset=utf-8"),
        raw("Content-Security-Policy","default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'")))
  private def form(req: Request[IO]): IO[Map[String,String]] =
    IO(Require(header(req,"Content-Type").exists(_.split(";",2)(0).trim == "application/x-www-form-urlencoded"), "bad-envelope")) *>
      body(req,config.limits.maxRequestBodyBytes).map { bytes =>
        Exact.string(bytes).split("&",-1).filter(_.nonEmpty).foldLeft(Map.empty[String,String]) { (out,pair) =>
          val parts = pair.split("=",2)
          val key = URLDecoder.decode(parts(0),"UTF-8")
          Require(!out.contains(key), "bad-envelope")
          out.updated(key,URLDecoder.decode(if parts.length == 2 then parts(1) else "","UTF-8"))
        }
      }
  private def unlockPage(ctx: Context,status: Status = Status.Ok): IO[Response[IO]] = config.unlockShellDir match
    case Some(_) => asset(config.unlockShellDir,"index.html",ctx,false).map(_.withStatus(status))
    case None =>
      val warning = if config.contentMode == "path" then "<span id=\"path-mode-warning\" role=\"img\" title=\"Low-security path hosting: artifacts share the dashboard/API origin. Trusted content only.\">ⓘ</span>" else ""
      val html = "<!doctype html><html><head><meta charset=\"utf-8\"><title>manure — password required</title></head><body>" + warning +
        "<h1>password required</h1><form method=\"post\" action=\"" + ctx.mount + "/__manure/unlock\">" +
        "<label>External password<input type=\"password\" name=\"password\" autocomplete=\"off\" required></label><button type=\"submit\">unlock</button></form></body></html>"
      IO.pure(Response[IO](status).withEntity(html).putHeaders(raw("Content-Type","text/html; charset=utf-8"),raw("Referrer-Policy","strict-origin")))
  private def contentCommand(req: Request[IO],ctx: Context,id: String,command: wire.ContentCommand,requestId: UUID): IO[Response[IO]] = command match
    case wire.ContentCommand.Unlock(password) =>
      IO {
        Require(originHeader(req).contains(ctx.contentOrigin), "forbidden")
        Require(throttle.allow("unlock:" + id + ":" + peer(req),config.unlockRatePerMinute), "rate-limited")
      } *> artifacts.unlock(id,password).map { (value,expiry) =>
        envelope(requestId,wire.Result.Ok()).putHeaders(raw("Set-Cookie",contentCookie(ctx,id,value,expiry,false)))
      }
    case wire.ContentCommand.RedeemGrant(value) =>
      IO(Require(originHeader(req).contains(ctx.origin.value), "forbidden")) *> artifacts.redeem(id,value).map { (value,expiry) =>
        envelope(requestId,wire.Result.Ok()).putHeaders(raw("Set-Cookie",contentCookie(ctx,id,value,expiry,false)))
      }
    case _: wire.ContentCommand.Logout =>
      IO(Require(originHeader(req).contains(ctx.contentOrigin), "forbidden")) *>
        presented(req,ctx,id).traverse_(artifacts.logoutContent).as(envelope(requestId,wire.Result.Ok())
          .putHeaders(raw("Set-Cookie",contentCookie(ctx,id,"",0,true))))
    case _: wire.ContentCommand.GetManifest =>
      artifacts.contentInfo(id,presented(req,ctx,id),header(req,"X-Manure-Password"),None)
        .map(a => envelope(requestId,wire.Result.ArtifactManifest(CurrentWire.manifest(a))))
  private def content(req: Request[IO],ctx: Context,id: String): IO[Response[IO]] =
    val path = req.uri.path.renderString.stripPrefix(ctx.mount)
    if req.method == Method.GET && ctx.mount.nonEmpty && path.isEmpty then
      IO.pure(Response[IO](Status.SeeOther).putHeaders(raw("Location",ctx.mount + "/")))
    else if path.startsWith("/api/") then IO.raiseError(DomainError("not-found"))
    else if req.method == Method.POST && path == "/__manure/current" then
      readJson(req).flatMap { value =>
        val rid = CurrentWire.requestId(value)
        IO(CurrentWire.content(value)).flatMap(e => contentCommand(req,ctx,id,e.command,e.requestId)).handleError(e => failure(rid,e))
      }
    else if req.method == Method.POST && Set("/__manure/unlock","/__manure/grant","/__manure/logout")(path) then
      form(req).flatMap { fields =>
        val command = path match
          case "/__manure/unlock" => wire.ContentCommand.Unlock(fields.getOrElse("password",""))
          case "/__manure/grant" => wire.ContentCommand.RedeemGrant(fields.getOrElse("grant",""))
          case _ => wire.ContentCommand.Logout()
        contentCommand(req,ctx,id,command,new UUID(0L,0L)).map { response =>
          response.withStatus(Status.SeeOther).withBodyStream(Stream.empty)
            .putHeaders(raw("Content-Length","0"),raw("Location",ctx.mount + "/"))
        }.handleErrorWith {
          case e: DomainError if path == "/__manure/unlock" && Set("password-invalid","rate-limited")(e.code) =>
            unlockPage(ctx,if e.code == "password-invalid" then Status.Unauthorized else Status.TooManyRequests)
          case error => IO.raiseError(error)
        }
      }
    else if req.method == Method.GET && path.startsWith("/__manure/viewer/") then
      artifacts.contentInfo(id,presented(req,ctx,id),header(req,"X-Manure-Password"),None).flatMap { _ =>
        val name = path.stripPrefix("/__manure/viewer/")
        Require(Set("viewer.js","graphviz-worker.js","pdf.worker.min.mjs","pdf.renderer.min.mjs","styles.css")(name), "not-found")
        viewerBytes(name).map(bytes => Response[IO](Status.Ok).withEntity(bytes).putHeaders(raw("Content-Type",mime(name))))
      }
    else if req.method == Method.GET && path.startsWith("/__manure/raw/") then
      val (file,trailing) = decoded("/" + path.stripPrefix("/__manure/raw/"))
      Require(!trailing, "not-found")
      serveFile(req,ctx,id,file,false,None)
    else if req.method == Method.GET && path.startsWith("/__manure/view/") then
      val (file,trailing) = decoded("/" + path.stripPrefix("/__manure/view/"))
      artifacts.contentInfo(id,presented(req,ctx,id),header(req,"X-Manure-Password"),None).flatMap { a =>
        Require(!trailing && a.manifest.exists(e => !e.directory && e.path == file) && viewerKind(file).nonEmpty, "not-found")
        if header(req,"Range").nonEmpty || config.viewerDir.isEmpty then serveFile(req,ctx,id,file,false,None)
        else viewerShell(ctx,file,"")
      }
    else if req.method == Method.GET && path.startsWith("/__manure/files/") && path.endsWith("/content") then
      val (file,_) = decoded("/" + path.stripPrefix("/__manure/files/").stripSuffix("/content"))
      serveFile(req,ctx,id,file,true,None)
    else if req.method == Method.GET && path == "/__manure/password" then
      artifacts.externalInfo(id).flatMap(_ => unlockPage(ctx))
    else if req.method == Method.GET && !path.startsWith("/__manure/") then
      val (file,trailing) = decoded(if path.isEmpty then "/" else path)
      artifacts.contentInfo(id,presented(req,ctx,id),None,None).flatMap { a =>
        val isDirectory = a.kind == ArtifactKind.Directory && (file.isEmpty ||
          a.manifest.exists(e => e.path.startsWith(file + "/") || e.directory && e.path == file))
        if isDirectory && file.nonEmpty && !trailing then
          IO.pure(Response[IO](Status.SeeOther).putHeaders(raw("Location",ctx.mount + "/" + encoded(file) + "/")))
        else
          val prefix = if file.isEmpty then "" else file + "/"
          val index = Vector("index.html","index.htm").map(prefix + _).find(p => a.manifest.exists(e => !e.directory && e.path == p))
          if isDirectory && index.isEmpty then directoryPage(ctx,a,file)
          else
            val target = if isDirectory then index.get
              else if file.isEmpty && a.kind == ArtifactKind.File then a.manifest.find(!_.directory).map(_.path).getOrElse("")
              else if trailing then file + "/index.html" else file
            val negotiates = file.isEmpty && a.kind == ArtifactKind.File && viewerKind(target).nonEmpty && config.viewerDir.nonEmpty
            val response = if negotiates && header(req,"Range").isEmpty && acceptsViewer(req) then
              viewerShell(ctx,target,"")
            else serveFile(req,ctx,id,target,false,None)
            response.map(r => if negotiates then r.putHeaders(raw("Vary","Accept")) else r)
      }.handleErrorWith {
        case d: DomainError if d.code == "password-required" =>
          // Only the external entry point is a password page. Preserve the
          // locked-path contract: trusted shell siblings or 404 JSON, never
          // turn an unknown file or revoked file grant into a 200 HTML body.
          if file.isEmpty then unlockPage(ctx)
          else if !trailing && Set("styles.css","unlock.js","index.html")(file) then asset(config.unlockShellDir,file,ctx,false)
          else IO.raiseError(DomainError("not-found"))
        case error => IO.raiseError(error)
      }
    else IO.raiseError(DomainError("not-found"))
  /** Path hosting shares the management host by explicit low-security opt-in.
    * Exchange a human browser session only for document navigation, never let
    * management credentials authorize raw bytes or content API requests. The
    * resulting grant retains ordinary credential binding/revocation checks.
    * Subdomain content deliberately cannot see the host-only session cookie.
    */
  private def contentNavigation(req: Request[IO],ctx: Context,id: String): IO[Response[IO]] =
    val path = req.uri.path.renderString.stripPrefix(ctx.mount)
    val document = req.method == Method.GET && header(req,"Sec-Fetch-Mode").contains("navigate") &&
      header(req,"Sec-Fetch-Dest").contains("document")
    val target = !path.startsWith("/api/") && (!path.startsWith("/__manure/") || path.startsWith("/__manure/view/"))
    if config.contentMode != "path" || !document || !target then content(req,ctx,id)
    else
      artifacts.contentInfo(id,presented(req,ctx,id),None,None).flatMap(_ => content(req,ctx,id)).handleErrorWith {
        // External navigation belongs to the existing unlock-page/path policy,
        // not to the internal management-session exchange.
        case d: DomainError if d.code == "password-required" => content(req,ctx,id)
        case d: DomainError if d.code == "grant-required" =>
          IO {
            // Validate before either the inert continuation or grant effects.
            Require(originHeader(req).forall(_ == ctx.origin.value), "forbidden")
            val viewerPrefix = if path.startsWith("/__manure/view/") then "/__manure/view" else ""
            val localPath = path.stripPrefix(viewerPrefix)
            val (file,trailing) = decoded(if localPath.isEmpty then "/" else localPath)
            val location = ctx.mount + viewerPrefix + "/" + encoded(file) + (if file.nonEmpty && trailing then "/" else "")
            (credentials(req,ctx),location)
          }.flatMap { (c,location) =>
            if c.kind.isEmpty then
              // Strict cookies are withheld on cross-site links. An inert local
              // document establishes the site before one browser-initiated retry.
              // The marker is not authority; no cookie still means no grant.
              val continued = req.uri.query.multiParams.contains("manure-continue")
              val next = location + "?manure-continue=1"
              val refresh = if continued then "" else "<meta http-equiv=\"refresh\" content=\"0;url=" + htmlAttribute(next) + "\">"
              val message = if continued then "Sign in to open this internal artifact." else "Continuing to internal artifact…"
              val link = if continued then "/#/artifact/" + id else next
              IO.pure(Response[IO](if continued then Status.Unauthorized else Status.Ok).withEntity(
                "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Manure · Internal artifact</title>" + refresh +
                  "</head><body><main><p>" + message + "</p><a href=\"" + htmlAttribute(link) + "\">" +
                  (if continued then "Sign in on dashboard" else "Continue") + "</a></main></body></html>")
                .putHeaders(raw("Content-Type","text/html; charset=utf-8"),raw("Referrer-Policy","no-referrer"),
                  raw("Content-Security-Policy","default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'")))
            else if c.kind != "cookie" then content(req,ctx,id)
            else
              IO {
                val identity = required(c)
                auth.human(identity)
                Require(throttle.allow("navigation:" + identity.userId,config.rateLimitPerMinute), "rate-limited")
                identity
              }.flatMap { identity =>
                artifacts.createGrant(identity,id).flatMap(artifacts.redeem(id,_)).map { (value,expiry) =>
                  Response[IO](Status.SeeOther).putHeaders(raw("Location",location),raw("Content-Length","0"),
                    raw("Set-Cookie",contentCookie(ctx,id,value,expiry,false)))
                }
              }
          }
        case error => IO.raiseError(error)
      }
  val app: HttpApp[IO] = org.http4s.HttpApp[IO] { req =>
    IO(context(req)).attempt.flatMap {
      case Left(error) => IO.pure(secure(failure(new UUID(0L,0L),error),false))
      case Right(ctx) =>
        val action = IO.defer(ctx.contentId match
          case Some(id) => contentNavigation(req,ctx,id)
          case None => api(req,ctx))
        action.timeoutTo(config.requestTimeout,IO.raiseError(DomainError("unavailable")))
          .handleError(e => failure(new UUID(0L,0L),e)).map(secure(_,ctx.content))
    }
  }
