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
import ponygirls.auth.{AccountCredential,AccountEvent,AccountFailure,AccountJson,AccountReply,AccountRequest,ClientAddress,CookieEffect,IndexingAccountEndpoint,PersistentCookie}

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
final class Http(config: Config, artifacts: Artifacts, catalogue: Catalogue, auth: Auth, clock: DomainClock, search: Search, accounts: Accounts, plane: AccountPlane):
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
  /** The one secret a request presents, with its kind (`bearer`, `cookie` or none), before any lookup. */
  private def presentedSecret(req: Request[IO],ctx: Context): (Option[String],String) =
    val authorization = header(req,"Authorization")
    val cookie = Cookies.credential(header(req,"Cookie"),Cookies.sessionName(config.loopbackDev,ctx.insecure))
    Require(!(authorization.nonEmpty && cookie.nonEmpty), "ambiguous-credentials")
    val bearer = authorization.map { value =>
      Require(value.startsWith("Bearer "), "unauthorized"); value.substring(7)
    }
    (bearer.orElse(cookie),if bearer.nonEmpty then "bearer" else if cookie.nonEmpty then "cookie" else "")
  private def credentials(req: Request[IO],ctx: Context,publicAssets: Boolean): IO[Credentials] = IO(presentedSecret(req,ctx)).flatMap { (secret,kind) =>
    secret match
      case None => IO.pure(Credentials(None,kind,None))
      case Some(_) if kind == "cookie" && publicAssets => IO.pure(Credentials(None,"",None))
      case Some(value) =>
        val principal = if kind == "bearer" then accounts.bearer(value) else accounts.browser(value)
        principal.map { identity =>
          Require(identity.nonEmpty, "unauthorized")
          Credentials(identity,kind,secret)
        }
  }
  private def required(c: Credentials): Identity = c.identity.getOrElse(throw DomainError("unauthorized"))
  private def mutation(req: Request[IO],ctx: Context,c: Credentials): Unit =
    val offered = originHeader(req)
    Require(if c.kind == "cookie" then offered.contains(ctx.origin.value) else offered.forall(_ == ctx.origin.value), "forbidden")
    val i = required(c)
    Require(throttle.allow("mutation:" + i.userId,config.rateLimitPerMinute), "rate-limited")
  private def sessionCookie(ctx: Context,value: String,clear: Boolean): String =
    Cookies.sessionName(config.loopbackDev,ctx.insecure) + "=" + (if clear then "" else value) +
      "; Path=/; HttpOnly; SameSite=Strict" + (if !config.loopbackDev && !ctx.insecure then "; Secure" else "") +
      "; Max-Age=" + (if clear then "0" else PersistentCookie.maxAgeSeconds.toString)
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
    val (code,reason) = error match
      case d: DomainError => (d.code,d.reason)
      case e: AccountFailure => (e.code,None)
      case _ => ("unavailable",None)
    val response = envelope(id,CurrentWire.error(code,reason),CurrentWire.status(code))
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
  private def accountPath(req: Request[IO]): Boolean =
    val path = req.uri.path.renderString
    path == "/api/account/v1" || path.startsWith("/api/account/v1/")
  private def accountFailure(error: Throwable): Response[IO] =
    val code = error match
      case e: DomainError => e.code
      case e: AccountFailure => e.code
      case _ => "unavailable"
    val normalized = code match
      case "bad-envelope" | "ambiguous-credentials" | "bad-host" | "invalid-path" => "invalid"
      case "tls-required" => "forbidden"
      case "config" => "unavailable"
      case _ => code
    json(AccountJson.failure(normalized),if normalized == "conflict" then 409 else CurrentWire.status(normalized))
  private def accountActors(req: Request[IO]): Vector[String] =
    req.headers.headers.filter(_.name == CIString("X-Account-Actor")).map(_.value).toVector
  private def accountJson(req: Request[IO]): IO[io.circe.Json] =
    IO(Require(header(req,"Content-Type").exists(_.split(";",2)(0).trim == "application/json"), "bad-envelope")) *>
      body(req,math.min(AccountJson.maxBodyBytes,config.limits.maxRequestBodyBytes)).map(AccountJson.parseUtf8)
  private def emptyAccountBody(req: Request[IO]): IO[Unit] = accountJson(req).flatMap(value =>
    IO(Require(value.asObject.exists(_.isEmpty), "bad-envelope")))
  /** Empty exactly when the request carried no body bytes. */
  private def optionalAccountJson(req: Request[IO]): IO[Option[io.circe.Json]] =
    body(req,math.min(AccountJson.maxBodyBytes,config.limits.maxRequestBodyBytes)).flatMap { bytes =>
      if bytes.isEmpty then IO.pure(None)
      else IO {
        Require(header(req,"Content-Type").exists(_.split(";",2)(0).trim == "application/json"), "bad-envelope")
        val opaqueTarget = req.method == Method.POST && req.uri.path.renderString == accountPrefix + IndexingAccountEndpoint.SetOverride.path
        Some(if opaqueTarget then AccountJson.parseOpaqueIndexingTargetUtf8(bytes) else AccountJson.parseUtf8(bytes))
      }
    }
  /** The socket peer, or the right-most `X-Forwarded-For` element when the peer is a trusted proxy. */
  private def clientAddress(req: Request[IO]): String =
    val forwarded = req.headers.headers.filter(_.name == CIString("X-Forwarded-For")).map(_.value).toVector
    ClientAddress.resolve(peer(req),forwarded,p => com.comcast.ip4s.IpAddress.fromString(p).nonEmpty && config.trustedProxies.exists(_.contains(p)))
  private val accountPrefix = "/api/account/v1"
  private def accountRequest(req: Request[IO],body: Option[io.circe.Json],session: Option[AccountCredential],secret: Option[String]): AccountRequest =
    AccountRequest(req.method.name,req.uri.path.renderString.stripPrefix(accountPrefix),body,accountActors(req),session,secret,clientAddress(req))
  /** Security events after commit, one JSON line each, with the allowlisted fields only. */
  private def audit(events: Vector[AccountEvent]): IO[Unit] = events.traverse_ { event =>
    IO.println("MANURE_ACCOUNT_EVENT " + io.circe.Json.fromFields(event.fields.map((k,v) => k -> io.circe.Json.fromString(v))).noSpaces)
  }
  private def accountReply(ctx: Context,reply: AccountReply): IO[Response[IO]] =
    val response = json(reply.body,reply.status)
    val cookie = reply.cookie match
      case CookieEffect.Set(secret) => response.putHeaders(raw("Set-Cookie",sessionCookie(ctx,secret,false)))
      case CookieEffect.Keep => response
    audit(reply.events).as(reply.retryAfterSeconds.fold(cookie)(seconds => cookie.putHeaders(raw("Retry-After",seconds.toString))))
  /** The five endpoints that exist with the master switch off. */
  private def declarativeAccountPath(method: Method,path: String): Boolean =
    method == Method.GET && path == accountPrefix || method == Method.POST && (path == accountPrefix + "/logout" ||
      path == accountPrefix + "/tokens" || path.startsWith(accountPrefix + "/tokens/") && path.endsWith("/revoke"))
  /** The independent indexing routes and the imperative routes share the same cookie-only boundary. */
  private def accountOperation(req: Request[IO],ctx: Context)(dispatch: AccountRequest => IO[AccountReply]): IO[Response[IO]] =
    IO {
      Require(header(req,"Authorization").isEmpty, "ambiguous-credentials")
      Cookies.credential(header(req,"Cookie"),Cookies.sessionName(config.loopbackDev,ctx.insecure))
    }.flatMap { secret => for
      body <- optionalAccountJson(req)
      session <- secret.flatTraverse(accounts.session)
      reply <- dispatch(accountRequest(req,body,session,secret))
      response <- accountReply(ctx,reply)
    yield response }
  private def account(req: Request[IO],ctx: Context): IO[Response[IO]] = IO {
    Require(!ctx.content, "not-found")
    Require(!req.uri.renderString.contains("?"), "bad-envelope")
    val offered = originHeader(req)
    Require(if req.method == Method.GET then offered.forall(_ == ctx.origin.value) else offered.contains(ctx.origin.value), "forbidden")
  } *> {
    val path = req.uri.path.renderString
    if req.method == Method.POST && path == "/api/account/v1/login" then
      IO {
        Require(header(req,"Authorization").isEmpty, "ambiguous-credentials")
        val previous = Cookies.credential(header(req,"Cookie"),Cookies.sessionName(config.loopbackDev,ctx.insecure))
        Require(throttle.allow("login:" + peer(req),config.loginRatePerMinutePerIp), "rate-limited")
        previous
      }.flatMap { previous => auth.imperative match
        case Some(settings) => accountJson(req).flatMap(value => plane.login(settings,accountRequest(req,Some(value),None,previous))).flatMap(accountReply(ctx,_))
        case None => accountJson(req).flatMap(value => IO(AccountJson.decodeLogin(value))).flatMap { (login,password) =>
          accounts.login(login,password,previous).map { (user,session) =>
            json(io.circe.Json.obj("user" -> AccountJson.user(user))).putHeaders(raw("Set-Cookie",sessionCookie(ctx,session.secret,false)))
          }
        }
      }
    else if IndexingAccountEndpoint.route(req.method.name,path.stripPrefix(accountPrefix)).nonEmpty then
      accountOperation(req,ctx)(plane.handleIndexing(config.indexingPolicy,_))
    else if auth.imperative.nonEmpty && !declarativeAccountPath(req.method,path) then accountOperation(req,ctx)(plane.handle)
    else if req.method == Method.GET && path == accountPrefix then IO(presentedSecret(req,ctx)).flatMap {
      // The read authenticates the session in its own transaction. The mutations below resolve it first, to key their
      // throttle before the body.
      case (Some(secret),"cookie") => accounts.read(secret).map { (user,tokens) =>
        json(AccountJson.account(user,tokens,Vector("api"))).putHeaders(raw("Set-Cookie",sessionCookie(ctx,secret,false)))
      }
      case _ => credentials(req,ctx,false) *> IO.raiseError(DomainError("unauthorized"))
    }
    else credentials(req,ctx,false).flatMap { c =>
      IO {
        Require(c.kind == "cookie", "unauthorized")
        required(c)
        c.raw.getOrElse(throw DomainError("unauthorized"))
      }.flatMap { secret =>
        val result = if req.method == Method.POST && path == "/api/account/v1/logout" then
          IO(mutation(req,ctx,c)) *> emptyAccountBody(req) *> accounts.logoutAccount(secret,accountActors(req)).as(
            json(io.circe.Json.obj("ok" -> io.circe.Json.True)).putHeaders(raw("Set-Cookie",sessionCookie(ctx,"",true))))
        else if req.method == Method.POST && path == "/api/account/v1/tokens" then
          IO(mutation(req,ctx,c)) *> accountJson(req).flatMap(value => IO(AccountJson.decodeIssue(value))).flatMap { (name,scopes) =>
            IO(Require(scopes == Vector("api"), "forbidden")) *> accounts.issue(secret,name,accountActors(req)).map(value => json(AccountJson.issued(value)))
          }
        else if req.method == Method.POST && path.startsWith("/api/account/v1/tokens/") && path.endsWith("/revoke") then
          val encodedId = path.stripPrefix("/api/account/v1/tokens/").stripSuffix("/revoke")
          IO(mutation(req,ctx,c)) *> emptyAccountBody(req) *> IO {
            val (id,trailing) = decoded("/" + encodedId)
            Require(!trailing && !id.contains('/'), "bad-envelope")
            id
          }.flatMap(id => accounts.revoke(secret,id,accountActors(req))).as(json(io.circe.Json.obj("ok" -> io.circe.Json.True)))
        else IO.raiseError(DomainError("not-found"))
        result.map { response =>
          if response.headers.headers.exists(_.name == CIString("Set-Cookie")) then response
          else response.putHeaders(raw("Set-Cookie",sessionCookie(ctx,secret,false)))
        }
      }
    }
  }
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
  private def dispatch(req: Request[IO],ctx: Context,c: Credentials,e: wire.ClientEnvelope): IO[Response[IO]] =
    c.identity.traverse_ { expected =>
      val secret = c.raw.getOrElse(throw DomainError("unauthorized"))
      val current = c.kind match
        case "cookie" => accounts.browser(secret)
        case "bearer" => accounts.bearer(secret)
        case _ => IO.raiseError(DomainError("unauthorized"))
      current.flatMap(principal => IO(Require(principal.contains(expected), "unauthorized")))
    }.flatMap(_ => command(req,ctx,c,e))
  private def command(req: Request[IO],ctx: Context,c: Credentials,e: wire.ClientEnvelope): IO[Response[IO]] =
    val result: IO[wire.Result] = e.command match
      case _: wire.Command.Version => IO.pure(wire.Result.Version(wire.VersionInfo(CurrentWire.version,List(CurrentWire.version))))
      case _: wire.Command.GetCapabilities =>
        IO.pure(wire.Result.CapabilityInfo(wire.Capabilities(if config.contentMode == "path" then wire.ContentMode.Path else wire.ContentMode.Subdomain,
          search.modes,true,config.limits.chunkBytes,config.limits.maxListLimit,config.limits.maxRequestBodyBytes,
          config.limits.maxFileBytes,config.limits.maxArtifactBytes,config.limits.maxFilesPerArtifact,31536000,CataloguePolicy.Id)))
      case _: wire.Command.Whoami => IO(wire.Result.Identity(CurrentWire.principal(required(c))))
      case _: wire.Command.Login => IO(Require(originHeader(req).contains(ctx.origin.value), "forbidden")) *> IO.raiseError(DomainError("bad-envelope"))
      case _: wire.Command.Logout =>
        IO(mutation(req,ctx,c)) *> logout(c).as(wire.Result.Ok())
      case wire.Command.ListArtifacts(q) => catalogue.list(required(c),q).map { (items,next) => wire.Result.Catalogue(wire.CataloguePage(items.map(summary(ctx,_)).toList,next)) }
      case wire.Command.InitUpload(name,kind,visibility,expiry,files,tags,hostname,projectPath) =>
        IO(mutation(req,ctx,c)) *> artifacts.init(required(c),InitUpload(name,CurrentWire.kind(kind),CurrentWire.visibility(visibility),CurrentWire.manifest(files),expiry.map(_.toLong),tags.toVector,hostname,projectPath))
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
  private def logout(c: Credentials): IO[Unit] =
    if c.kind == "cookie" then accounts.logout(c.raw.getOrElse(throw DomainError("unauthorized")))
    else artifacts.logout(required(c))
  // Shared design system (shared/ui-web), copied into the dashboard directory as ui/ at packaging time;
  // the content shell (unlock_shell_dir) carries its own ui/ copy for the content-origin pages.
  private val dashboardUiAssets = Set("ui/tokens.css","ui/components.css","ui/theme-init.js","ui/icons.js","ui/fonts/InterVariable.woff2")
  private def dashboardAsset(req: Request[IO]): Boolean =
    val path = req.uri.path.renderString
    req.method == Method.GET && (path == "/" || Set("/favicon.svg","/app.js","/styles.css","/current-protocol.js","/current-schema.js","/quick-upload.js","/sha256.js","/common.js","/detail.js","/upload.js","/upload.css","/overlays.js","/account.js","/account-client.js","/account.css")(path) || dashboardUiAssets(path.drop(1)) || path.startsWith("/current/"))
  private def api(req: Request[IO],ctx: Context): IO[Response[IO]] = credentials(req,ctx,dashboardAsset(req)).flatMap { c =>
    apiRequest(req,ctx,c).map { response =>
      if c.kind == "cookie" && response.status != Status.Unauthorized && !response.headers.headers.exists(_.name == CIString("Set-Cookie")) then
        response.putHeaders(raw("Set-Cookie",sessionCookie(ctx,c.raw.getOrElse(throw DomainError("unauthorized")),false)))
      else response
    }
  }
  private def apiRequest(req: Request[IO],ctx: Context,c: Credentials): IO[Response[IO]] =
    val path = req.uri.path.renderString
    if req.method == Method.POST && path == "/api/current" then
      readJson(req).flatMap { value =>
        val id = CurrentWire.requestId(value)
        IO(CurrentWire.command(value)).flatMap(dispatch(req,ctx,c,_)).handleError(e => failure(id,e))
      }
    else if req.method == Method.POST && path == "/api/current/login" then
      IO(Require(originHeader(req).contains(ctx.origin.value), "forbidden")) *> IO.raiseError(DomainError("bad-envelope"))
    else if req.method == Method.POST && path == "/api/current/logout" then
      IO(mutation(req,ctx,c)) *> form(req) *> logout(c).as(
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
    else if dashboardAsset(req) then
      c.identity.foreach(auth.human)
      asset(config.dashboardDir,if path == "/" then "index.html" else path.drop(1),ctx,true)
    else IO.raiseError(DomainError("not-found"))
  private def asset(directory: Option[Path],name: String,ctx: Context,dashboard: Boolean): IO[Response[IO]] = IO.blocking {
    val root = directory.getOrElse(throw DomainError(if dashboard then "dashboard-disabled" else "not-found"))
    val generated = name.matches("current/(?:manure/api/)?[A-Za-z][A-Za-z0-9_]*\\.js")
    Require(Set("index.html","favicon.svg","app.js","styles.css","unlock.js","current-protocol.js","current-schema.js","quick-upload.js","sha256.js","common.js","detail.js","upload.js","upload.css","overlays.js","account.js","account-client.js","account.css","chrome.js","content.css")(name) || dashboard && generated || dashboardUiAssets(name), "not-found")
    val file = root.resolve(name)
    Require(Files.isRegularFile(file) && Files.size(file) <= 2097152, "not-found")
    var bytes = Files.readAllBytes(file)
    if name == "index.html" && ctx.mount.nonEmpty then
      val html = Exact.string(bytes).replace("href=\"/","href=\"" + ctx.mount + "/")
        .replace("src=\"/","src=\"" + ctx.mount + "/").replace("action=\"/","action=\"" + ctx.mount + "/")
      bytes = Exact.utf8(html.replace("id=\"path-mode-warning\" hidden","id=\"path-mode-warning\""))
    val response = Response[IO](Status.Ok).withEntity(bytes).putHeaders(raw("Content-Type",if name.endsWith(".woff2") then "font/woff2" else mime(name)))
    val navigational = if name == "index.html" then response.putHeaders(raw("Referrer-Policy","strict-origin")) else response
    if dashboard then
      val port = if ctx.origin.port == (if ctx.origin.scheme == "https" then 443 else 80) then "" else ":" + ctx.origin.port
      val forms = if config.contentMode == "path" then "'self'" else "'self' " + ctx.origin.scheme + "://*." + config.contentSuffix + port
      navigational.putHeaders(raw("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action " + forms))
    else navigational
  }
  /** Lower-case file name and its extension (the text after the last dot of the name; empty without a dot). The one
    * reading of a path's type for both the content type and the viewer. */
  private def nameAndExtension(path: String): (String,String) =
    val name = path.substring(path.lastIndexOf('/') + 1).toLowerCase(java.util.Locale.ROOT)
    (name,if name.contains('.') then name.substring(name.lastIndexOf('.') + 1) else "")
  private def mime(path: String): String = nameAndExtension(path)._2 match
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
    case "cast" => "application/x-asciicast"
    case "wasm" => "application/wasm"
    case "mp4" | "m4v" => "video/mp4"
    case "webm" => "video/webm"
    case "mov" => "video/quicktime"
    case "ogv" => "video/ogg"
    case "mp3" => "audio/mpeg"
    case "wav" => "audio/wav"
    case "ogg" | "oga" | "opus" => "audio/ogg"
    case "m4a" => "audio/mp4"
    case "flac" => "audio/flac"
    case "aac" => "audio/aac"
    // Files the text viewer shows are text for a browser as well; nosniff keeps them inert.
    case _ => if viewerKind(path).contains("text") then "text/plain; charset=utf-8" else "application/octet-stream"
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
  /** Display label and preview renderer of a file, by name or extension. `viewer` is the viewer shell's `data-kind`;
    * HTML alone has none and is always served as the page it is. */
  private final case class FileType(label: String,viewer: Option[String])
  private def group(viewer: Option[String],labels: (String,Seq[String])*): Seq[(String,FileType)] =
    labels.flatMap((label,keys) => keys.map(_ -> FileType(label,viewer)))
  private val fileTypes: Map[String,FileType] =
    (group(Some("markdown"),"Markdown" -> Seq("md","markdown")) ++
      group(Some("image"),"PNG image" -> Seq("png"),"JPEG image" -> Seq("jpg","jpeg"),"GIF image" -> Seq("gif"),"WebP image" -> Seq("webp"),
        "AVIF image" -> Seq("avif"),"BMP image" -> Seq("bmp"),"SVG image" -> Seq("svg"),"Icon" -> Seq("ico")) ++
      group(Some("pdf"),"PDF document" -> Seq("pdf")) ++
      group(Some("asciinema"),"Terminal recording" -> Seq("cast")) ++
      group(Some("mermaid"),"Mermaid source" -> Seq("mmd","mermaid")) ++
      group(Some("graphviz"),"Graphviz source" -> Seq("dot","gv")) ++
      group(Some("text"),"Text" -> Seq("txt","text"),"Log" -> Seq("log"),"CSV" -> Seq("csv"),"TSV" -> Seq("tsv"),"JSON" -> Seq("json","json5","jsonc"),
        "JSON lines" -> Seq("jsonl","ndjson"),"Jupyter notebook" -> Seq("ipynb"),"YAML" -> Seq("yaml","yml"),"TOML" -> Seq("toml"),
        "Configuration" -> Seq("ini","cfg","conf","properties","env"),"Lock file" -> Seq("lock"),
        "XML" -> Seq("xml"),"Python" -> Seq("py","pyi"),"JavaScript" -> Seq("js","mjs","cjs"),"TypeScript" -> Seq("ts","tsx"),"JSX" -> Seq("jsx"),
        "Shell script" -> Seq("sh","bash","zsh","fish"),"PowerShell" -> Seq("ps1"),"Batch file" -> Seq("bat","cmd"),"Nix" -> Seq("nix"),
        "Scala" -> Seq("scala","sc","sbt"),"Java" -> Seq("java"),"Kotlin" -> Seq("kt","kts"),"Groovy" -> Seq("groovy","gradle"),"Go" -> Seq("go"),"Rust" -> Seq("rs"),
        "C" -> Seq("c","h"),"C++" -> Seq("cc","cpp","cxx","hh","hpp","hxx"),"C#" -> Seq("cs"),"Swift" -> Seq("swift"),"Dart" -> Seq("dart"),"Zig" -> Seq("zig"),
        "Ruby" -> Seq("rb"),"PHP" -> Seq("php"),"Perl" -> Seq("pl","pm"),"SQL" -> Seq("sql"),"Lua" -> Seq("lua"),"R" -> Seq("r"),"Julia" -> Seq("jl"),
        "Haskell" -> Seq("hs"),"OCaml" -> Seq("ml","mli"),"Elixir" -> Seq("ex","exs"),"Erlang" -> Seq("erl"),"Clojure" -> Seq("clj","cljs"),
        "CSS" -> Seq("css","scss","sass","less"),"Vue" -> Seq("vue"),"Svelte" -> Seq("svelte"),"GraphQL" -> Seq("graphql","gql"),"Diff" -> Seq("diff","patch"),
        "Starlark" -> Seq("bzl","bazel","star"),"CMake" -> Seq("cmake"),"Makefile" -> Seq("mk"),"Terraform" -> Seq("tf","tfvars","hcl"),
        "reStructuredText" -> Seq("rst"),"AsciiDoc" -> Seq("adoc"),"LaTeX" -> Seq("tex"),"Protocol Buffers" -> Seq("proto"),"Thrift" -> Seq("thrift"),
        "Baboon model" -> Seq("baboon")) ++
      group(Some("video"),"MP4 video" -> Seq("mp4","m4v"),"WebM video" -> Seq("webm"),"QuickTime video" -> Seq("mov"),"Ogg video" -> Seq("ogv")) ++
      group(Some("audio"),"MP3 audio" -> Seq("mp3"),"WAV audio" -> Seq("wav"),"Ogg audio" -> Seq("ogg","oga","opus"),"MPEG-4 audio" -> Seq("m4a"),
        "FLAC audio" -> Seq("flac"),"AAC audio" -> Seq("aac")) ++
      group(Some("archive"),"ZIP archive" -> Seq("zip"),"Tar archive" -> Seq("tar"),"Gzip archive" -> Seq("gz","tgz"),
        "Bzip2 archive" -> Seq("bz2"),"XZ archive" -> Seq("xz"),"Zstandard archive" -> Seq("zst"),"7-Zip archive" -> Seq("7z"),
        "Java archive" -> Seq("jar"),"Python wheel" -> Seq("whl")) ++
      group(None,"HTML" -> Seq("html","htm"))).toMap
  /** Text files known by their whole name, compared in lower case. */
  private val fileNames: Map[String,FileType] =
    group(Some("text"),"Makefile" -> Seq("makefile","gnumakefile"),"Dockerfile" -> Seq("dockerfile","containerfile"),
      "Text" -> Seq("license","licence","copying","notice","authors","contributors","readme","changelog","todo"),
      "Groovy" -> Seq("jenkinsfile"),"Ruby" -> Seq("gemfile","rakefile","vagrantfile"),
      "Configuration" -> Seq(".gitignore",".gitattributes",".gitconfig",".dockerignore",".editorconfig",".npmrc",".env"),
      "Shell script" -> Seq(".bashrc",".bash_profile",".profile",".zshrc")).toMap
  /** A type that is not listed is `unknown`: the viewer shows it as text when its content is text, and otherwise
    * offers the download. */
  private def fileType(path: String): FileType =
    val (name,extension) = nameAndExtension(path)
    fileNames.get(name).orElse(fileTypes.get(extension))
      .getOrElse(FileType(if extension.isEmpty then "File" else extension.toUpperCase(java.util.Locale.ROOT) + " file",Some("unknown")))
  private def viewerKind(path: String): Option[String] = fileType(path).viewer
  private val sizeUnits = Vector("KiB","MiB","GiB","TiB")
  private val sizeStep = 1024L
  private def displaySize(bytes: Long): String =
    if bytes < sizeStep then bytes.toString + " B"
    else
      val unit = Iterator.iterate(0)(_ + 1).find(u => u == sizeUnits.size - 1 || bytes.toDouble / math.pow(sizeStep.toDouble,u + 2) < 1).get
      String.format(java.util.Locale.ROOT,"%.1f %s",Double.box(bytes.toDouble / math.pow(sizeStep.toDouble,unit + 1)),sizeUnits(unit))
  private def counted(count: Int,noun: String): String = count.toString + " " + noun + (if count == 1 then "" else "s")
  private def htmlAttribute(value: String): String = value.flatMap {
    case '&' => "&amp;"
    case '<' => "&lt;"
    case '>' => "&gt;"
    case '"' => "&quot;"
    case '\'' => "&#39;"
    case c => c.toString
  }
  private val faviconSvg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#3b2b1c"/><g fill="none" stroke="#f4c078" stroke-width="2.5" stroke-linejoin="round"><path d="m6 10 10-5 10 5v13l-10 5-10-5Z"/><path d="m6 10 10 5 10-5M16 15v13M11 8l10 5v6"/></g></svg>
"""
  private def faviconLink(ctx: Context): String =
    "<link rel=\"icon\" type=\"image/svg+xml\" href=\"" + ctx.mount + "/__manure/viewer/favicon.svg\">"
  private val viewerAssets = Set("viewer.js","graphviz-worker.js","pdf.worker.min.mjs","pdf.renderer.min.mjs","styles.css",
    "asciinema-player.js","asciinema-player.css")
  private def viewerBytes(name: String): IO[Array[Byte]] = IO.blocking {
    val root = config.viewerDir.getOrElse(throw DomainError("not-found"))
    Require(name == "index.html" || viewerAssets(name), "not-found")
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
  /** Viewer CSP; also used by directory listings that render a README with the viewer bundle. */
  private val viewerPolicy = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self'; font-src 'self'; worker-src 'self'; connect-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
  /** The content shell: page chrome and the shared design system of Manure's content-origin pages (viewer, listing,
    * unlock), served from unlock_shell_dir under the reserved prefix, independently of the dashboard and the viewer.
    * Without a shell directory these pages are the built-in unstyled versions, like the built-in unlock form. */
  private val contentShell = Set("chrome.js","content.css") ++ dashboardUiAssets
  private def shellBase(ctx: Context): String = ctx.mount + "/__manure/shell"
  /** Listing CSP: only the content shell under the reserved prefix, never artifact content of the same origin. */
  private def listingPolicy(ctx: Context): String =
    val reserved = ctx.contentOrigin + ctx.mount + "/__manure/"
    val shell = if config.unlockShellDir.isEmpty then "" else
      "script-src " + reserved + "shell/; style-src " + reserved + "shell/; font-src " + reserved + "shell/ui/fonts/; "
    "default-src 'none'; " + shell + "img-src " + reserved + "viewer/favicon.svg; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
  /** The template's content-shell links; dropped when there is no shell directory to serve them. */
  private val shellLinks = "(?s)<!--manure-shell-->.*?<!--/manure-shell-->".r
  private def viewerShell(ctx: Context,a: Artifact,path: String): IO[Response[IO]] =
    val kind = viewerKind(path).getOrElse(throw DomainError("not-found"))
    val entry = a.manifest.find(e => !e.directory && e.path == path).getOrElse(throw DomainError("not-found"))
    viewerBytes("index.html").map { bytes =>
      val values = Map("__MANURE_ASSET_BASE__" -> (ctx.mount + "/__manure/viewer"),"__MANURE_SHELL_BASE__" -> shellBase(ctx),
        "__MANURE_ROOT_URL__" -> (ctx.mount + "/"),"__MANURE_ARTIFACT_NAME__" -> a.name,
        "__MANURE_CREATED_AT__" -> a.createdAt,"__MANURE_PATH__" -> path,"__MANURE_RAW_URL__" -> (ctx.mount + "/__manure/raw/" + encoded(path)),
        "__MANURE_DOWNLOAD_URL__" -> (ctx.mount + "/__manure/files/" + encoded(path) + "/content"),"__MANURE_KIND__" -> kind,
        "__MANURE_SIZE__" -> displaySize(entry.size),"__MANURE_TYPE__" -> fileType(path).label)
      // A single pass prevents filenames containing placeholder text from being re-expanded.
      val template = Exact.string(bytes)
      val shell = if config.unlockShellDir.nonEmpty then template else shellLinks.replaceAllIn(template,"")
      val html = "__MANURE_(?:ASSET_BASE|SHELL_BASE|ROOT_URL|ARTIFACT_NAME|CREATED_AT|PATH|RAW_URL|DOWNLOAD_URL|KIND|SIZE|TYPE)__".r.replaceAllIn(shell,
        m => java.util.regex.Matcher.quoteReplacement(htmlAttribute(values(m.matched))))
      Response[IO](Status.Ok).withEntity(html).putHeaders(raw("Content-Type","text/html; charset=utf-8"),raw("Content-Security-Policy",viewerPolicy))
    }
  private def icon(name: String,classes: String): String =
    "<span class=\"icon" + classes + "\" data-icon=\"" + name + "\" aria-hidden=\"true\"></span>"
  private val themeMenu =
    "<div class=\"anchor\" data-theme-control hidden><button class=\"btn btn-ghost btn-icon\" type=\"button\" aria-label=\"Theme\" aria-haspopup=\"menu\" aria-expanded=\"false\">" +
      icon("sun","") + "</button><div class=\"menu\" role=\"menu\" aria-label=\"Theme\" hidden>" +
      Vector("system" -> ("monitor","System"),"light" -> ("sun","Light"),"dark" -> ("moon","Dark")).map { case (value,(glyph,label)) =>
        "<button class=\"menu-item\" type=\"button\" role=\"menuitemradio\" aria-checked=\"false\" data-theme-set=\"" + value + "\">" + icon(glyph,"") + label + "</button>"
      }.mkString + "</div></div>"
  private val cliDestination = "[^A-Za-z0-9._-]+".r
  /** Manifest-only immediate children: no filesystem traversal and no hidden recursive listing. */
  private def directoryPage(ctx: Context,a: Artifact,path: String): IO[Response[IO]] =
    val prefix = if path.isEmpty then "" else path + "/"
    val children = a.manifest.filter(_.path.startsWith(prefix)).flatMap { entry =>
      val rest = entry.path.stripPrefix(prefix)
      if rest.isEmpty then None
      else Some((rest.takeWhile(_ != '/'),entry.directory || rest.contains('/')))
    }.groupMapReduce(_._1)(_._2)(_ || _).toVector.sortBy((name,dir) => (if dir then 0 else 1,name))
    def filesUnder(directory: String): Vector[ManifestEntry] = a.manifest.filter(e => !e.directory && e.path.startsWith(directory))
    def directoryUrl(directory: String): String = ctx.mount + "/" + (if directory.isEmpty then "" else encoded(directory) + "/")
    def text(value: String): String = htmlAttribute(value)
    def link(url: String,label: String,attributes: String): String = "<a href=\"" + text(url) + "\"" + attributes + ">" + label + "</a>"
    val segments = if path.isEmpty then Vector.empty else path.split("/").toVector
    val crumbs = (if segments.isEmpty then "<span class=\"crumb-here\" aria-current=\"page\">" + text(a.name) + "</span>"
      else link(directoryUrl(""),text(a.name),"")) + "<span class=\"crumb-sep\">/</span>" +
      segments.zipWithIndex.map { (segment,index) =>
        (if index == segments.size - 1 then "<span class=\"crumb-here\" aria-current=\"page\">" + text(segment) + "</span>"
          else link(directoryUrl(segments.take(index + 1).mkString("/")),text(segment),"")) + "<span class=\"crumb-sep\">/</span>"
      }.mkString
    def row(entry: String,name: String,nameAttributes: String,href: String,kind: String,size: String,action: String): String =
      "<tr data-entry=\"" + entry + "\"><td><div class=\"path-cell" + (if entry == "folder" then " is-dir" else "") + "\">" +
        icon(if entry == "parent" then "arrow-up" else entry,"") + link(href,name,nameAttributes) +
        (if entry == "parent" then "<span class=\"xs muted\">Parent directory</span>" else "") + "</div></td><td class=\"col-v-type hide-sm muted\">" + kind +
        "</td><td class=\"col-v-size col-num\">" + size + "</td><td class=\"col-v-dl col-actions\">" + action + "</td></tr>"
    def open(href: String,label: String): String =
      link(href,"Open" + icon("chevron-right"," icon-sm")," class=\"btn btn-sm btn-ghost\" aria-label=\"" + text(label) + "\"")
    val parent = if path.isEmpty then "" else
      val up = directoryUrl(segments.dropRight(1).mkString("/"))
      row("parent","..", " aria-label=\"Parent directory\"",up,"","",open(up,"Open parent directory"))
    val rows = children.map { (name,dir) =>
      val full = prefix + name
      if dir then
        val inside = filesUnder(full + "/")
        row("folder",text(name + "/"),"",directoryUrl(full),"Folder · " + (if inside.isEmpty then "empty" else counted(inside.size,"file")),
          if inside.isEmpty then "—" else displaySize(inside.map(_.size).sum),open(directoryUrl(full),"Open " + name + "/"))
      else
        val href = if config.viewerDir.nonEmpty && viewerKind(full).nonEmpty then ctx.mount + "/__manure/view/" + encoded(full)
          else ctx.mount + "/" + encoded(full)
        val size = a.manifest.find(e => !e.directory && e.path == full).map(e => displaySize(e.size)).getOrElse("")
        row("file",text(name),"",href,text(fileType(full).label),size,link(ctx.mount + "/__manure/files/" + encoded(full) + "/content",
          icon("download"," icon-sm") + "Download"," class=\"btn btn-sm btn-ghost\" download aria-label=\"" + text("Download " + name) + "\""))
    }.mkString
    val table = "<div class=\"card\"><table class=\"table table-inset table-static listing-table\" aria-label=\"Directory contents\"><thead><tr>" +
      "<th scope=\"col\">Name</th><th scope=\"col\" class=\"col-v-type hide-sm\">Type</th><th scope=\"col\" class=\"col-v-size col-num\">Size</th>" +
      "<th scope=\"col\" class=\"col-v-dl col-actions\"><span class=\"sr-only\">Actions</span></th></tr></thead><tbody>" + parent + rows + "</tbody></table></div>"
    val empty = if children.nonEmpty then "" else
      "<div class=\"empty\">" + icon("folder","") + "<h2>Empty directory</h2><p>This folder contains no files.</p></div>"
    val readme = a.manifest.filter(e => !e.directory && e.path.startsWith(prefix)).map(_.path.stripPrefix(prefix))
      .filter(name => !name.contains('/') && name.equalsIgnoreCase("readme.md"))
      .sortBy(name => (if name == "README.md" then 0 else if name == "readme.md" then 1 else 2,name))
      .headOption.map(prefix + _).filter(_ => config.viewerDir.nonEmpty)
    val readmeSection = readme.fold("") { file =>
      val size = a.manifest.find(e => !e.directory && e.path == file).map(_.size).getOrElse(0L)
      "<div class=\"section-head\"><h2>" + icon("file","") + text(file.stripPrefix(prefix)) + "</h2><span class=\"xs muted hide-sm\">" + displaySize(size) +
        " · rendered from this directory</span>" + link(ctx.mount + "/__manure/view/" + encoded(file),"Open file" + icon("chevron-right"," icon-sm"),
          " class=\"btn btn-sm btn-ghost\"") + "</div><p id=\"status\" class=\"viewer-status\" role=\"status\" aria-live=\"polite\">Loading preview…</p>" +
        "<section id=\"content\" class=\"readme\" aria-label=\"README preview\"></section>"
    }
    val readmeMeta = readme.fold("") { file =>
      "<meta id=\"manure-viewer\" data-embed=\"readme\" data-kind=\"markdown\" data-path=\"" + text(file) + "\" data-raw-url=\"" +
        text(ctx.mount + "/__manure/raw/" + encoded(file)) + "\" data-download-url=\"" + text(ctx.mount + "/__manure/files/" + encoded(file) + "/content") + "\">"
    }
    val directFiles = children.count(!_._2)
    val destination = cliDestination.replaceAllIn(a.name,"-").stripPrefix("-").stripSuffix("-")
    val command = "manure fetch " + url(ctx,a.id) + " ./" + (if destination.isEmpty then "artifact" else destination) +
      (if a.visibility == Visibility.External then " --password-file ./password.txt" else "")
    val shell = shellBase(ctx)
    val head = (if config.unlockShellDir.isEmpty then "" else
      "<script src=\"" + shell + "/ui/theme-init.js\"></script><link rel=\"stylesheet\" href=\"" + shell + "/ui/tokens.css\"><link rel=\"stylesheet\" href=\"" +
        shell + "/ui/components.css\"><link rel=\"stylesheet\" href=\"" + shell + "/content.css\"><script type=\"module\" src=\"" + shell + "/chrome.js\"></script>") +
      (if readme.isEmpty then "" else "<link rel=\"stylesheet\" href=\"" + ctx.mount + "/__manure/viewer/styles.css\"><script type=\"module\" src=\"" +
        ctx.mount + "/__manure/viewer/viewer.js\"></script>")
    val html = "<!doctype html><html lang=\"en\" data-app=\"manure\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
      readmeMeta + "<title>" + text((if path.isEmpty then a.name else segments.last) + "/") + " · Manure</title>" + faviconLink(ctx) + head + "</head><body data-viewer data-page=\"directory\"><a class=\"skip-link\" href=\"#main\">Skip to content</a>" +
      "<header class=\"masthead viewer-bar\">" + link(directoryUrl(""),"<span class=\"brand-mark\">" + icon("box","") + "</span><span class=\"brand-name\">manure</span><small>viewer</small>",
        " class=\"brand\" aria-label=\"Artifact root\"") + "<span class=\"vr\"></span><nav class=\"crumbs crumbs-mono\" aria-label=\"Path\">" + crumbs +
      "</nav><div class=\"masthead-end\"><details class=\"anchor cli-fetch\"><summary class=\"btn\" aria-label=\"Download all (CLI)\">" + icon("terminal","") +
      "<span class=\"hide-sm\">Download all (CLI)…</span></summary><div class=\"popover\"><div class=\"stack-sm\"><strong>Download the whole artifact</strong>" +
      "<p class=\"xs muted\">The browser downloads single files. The CLI fetches every file and verifies its checksum.</p><div class=\"code-block\" id=\"cli-command\">" +
      text(command) + "</div><div><button class=\"btn btn-sm\" type=\"button\" data-copy-from=\"cli-command\" data-copied=\"Command copied\" hidden>" + icon("copy"," icon-sm") +
      "Copy command</button></div></div></div></details>" + themeMenu + "</div></header><div class=\"viewer-meta\"><span>" +
      counted(children.size - directFiles,"folder") + " · " + counted(directFiles,"file") + " · " + displaySize(filesUnder(prefix).map(_.size).sum) +
      " · uploaded <time class=\"uploaded-at\" data-local datetime=\"" + text(a.createdAt) + "\" title=\"" + text(a.createdAt) + "\">" + text(a.createdAt) + "</time></span></div>" +
      "<main id=\"main\" class=\"viewer-wide\">" + (if parent.nonEmpty || rows.nonEmpty then table else "") + empty + readmeSection +
      "</main><div class=\"toasts\" role=\"status\" aria-live=\"polite\" id=\"toasts\"></div></body></html>"
    IO.pure(Response[IO](Status.Ok).withEntity(html).putHeaders(raw("Content-Type","text/html; charset=utf-8"),
      raw("Content-Security-Policy",if readme.nonEmpty then viewerPolicy else listingPolicy(ctx))))
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
      val html = "<!doctype html><html><head><meta charset=\"utf-8\"><title>manure — password required</title>" + faviconLink(ctx) + "</head><body>" + warning +
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
    else if req.method == Method.GET && path == "/__manure/viewer/favicon.svg" then
      IO.pure(Response[IO](Status.Ok).withEntity(faviconSvg).putHeaders(raw("Content-Type","image/svg+xml")))
    else if req.method == Method.GET && path.startsWith("/__manure/shell/") then
      // Public like the favicon: the locked unlock page needs it, and it carries no artifact data.
      val name = path.stripPrefix("/__manure/shell/")
      IO(Require(contentShell(name), "not-found")) *> asset(config.unlockShellDir,name,ctx,false)
    else if req.method == Method.GET && path.startsWith("/__manure/viewer/") then
      artifacts.contentInfo(id,presented(req,ctx,id),header(req,"X-Manure-Password"),None).flatMap { _ =>
        val name = path.stripPrefix("/__manure/viewer/")
        Require(viewerAssets(name), "not-found")
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
        else viewerShell(ctx,a,file)
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
              viewerShell(ctx,a,target)
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
            location
          }.flatMap { location => credentials(req,ctx,false).flatMap { c =>
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
                "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Manure · Internal artifact</title>" + faviconLink(ctx) + refresh +
                  "</head><body><main><p>" + message + "</p><a href=\"" + htmlAttribute(link) + "\">" +
                  (if continued then "Sign in on dashboard" else "Continue") + "</a></main></body></html>")
                .putHeaders(raw("Content-Type","text/html; charset=utf-8"),raw("Referrer-Policy","no-referrer"),
                  raw("Content-Security-Policy","default-src 'none'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'")))
            else if c.kind != "cookie" then content(req,ctx,id)
            else
              IO {
                val identity = required(c)
                auth.human(identity)
                Require(throttle.allow("navigation:" + identity.userId,config.rateLimitPerMinute), "rate-limited")
                identity
              }.flatMap { identity =>
                artifacts.createGrant(identity,id).flatMap(artifacts.redeem(id,_)).map { (value,expiry) =>
                  val response = Response[IO](Status.SeeOther).putHeaders(raw("Location",location),raw("Content-Length","0"),
                    raw("Set-Cookie",contentCookie(ctx,id,value,expiry,false)))
                  response.withHeaders(Headers(response.headers.headers :+ raw("Set-Cookie",sessionCookie(ctx,c.raw.getOrElse(throw DomainError("unauthorized")),false))))
                }
              }
          }}
        case error => IO.raiseError(error)
      }
  val app: HttpApp[IO] = org.http4s.HttpApp[IO] { req =>
    IO(context(req)).attempt.flatMap {
      case Left(error) => IO.pure(secure(if accountPath(req) then accountFailure(error) else failure(new UUID(0L,0L),error),false))
      case Right(ctx) =>
        val action = IO.defer(ctx.contentId match
          case Some(id) => contentNavigation(req,ctx,id)
          case None => if accountPath(req) then account(req,ctx) else api(req,ctx))
        action.timeoutTo(config.requestTimeout,IO.raiseError(DomainError("unavailable")))
          .handleError(e => if accountPath(req) && !ctx.content then accountFailure(e) else failure(new UUID(0L,0L),e)).map(secure(_,ctx.content))
    }
  }
