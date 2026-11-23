package chronicle
import chronicle.api.*
import cats.effect.{IO,Ref,Deferred,Resource}
import cats.effect.std.{Queue,Semaphore}
import cats.syntax.all.*
import fs2.{Stream,Pipe}
import org.http4s.*
import org.http4s.dsl.io.*
import org.http4s.server.websocket.WebSocketBuilder2
import org.http4s.websocket.WebSocketFrame
import org.typelevel.ci.CIString
import java.util.UUID
import ponygirls.auth.{AccountJson,AccountFailure,PersistentCookie,AccountCredential,AccountEvent,AccountEventKind,AccountRejection,AccountReply,AccountRequest,AccountSession,ClientAddress,CookieEffect,CredentialEndpoint,DeclarativeLogin,ImperativeAccountApi,ImperativePolicy,SignedIn}
import java.nio.file.{Files,Path}
import scala.concurrent.duration.*

final class Http(config: Config,auth: Auth,app: Application,archive: SessionArchive,mcp: Mcp,logger: logstage.IzLogger,webRoot: Http.WebRoot,protocol: VersionedWire,rpc: BrowserRpc,controls: BrowserControlAdmission,liveness: Http.SocketLiveness,snapshots: SnapshotAdmission,uploads: Uploads,raw: RawStream) {
  private val socketQueueCapacity = 32
  private val retryableCloseCode = 1013
  private val normalCloseCode = 1000
  private def header(r: Request[IO],key: String): Option[String] = r.headers.get(CIString(key)).map(_.head.value)
  private def origin(r: Request[IO],required: Boolean): Unit = Check(header(r,"Origin").contains(config.allowedOrigin) || (!required && header(r,"Origin").isEmpty),"forbidden","Origin not allowed")
  private def cookie(r: Request[IO]): String = r.cookies.find(_.name=="chronicle_session").map(_.content).getOrElse("")
  private def bearer(r: Request[IO]): Identity = { Check(cookie(r).isEmpty,"forbidden","cookie and bearer transports are separate"); val value = header(r,"Authorization").getOrElse(""); Check(value.startsWith("Bearer "),"unauthorized","bearer credential required"); auth.bearer(value.substring(7)) }
  private def noUrlSecrets(r: Request[IO]): Unit = Check(r.uri.query.isEmpty,"invalid","query parameters are not supported")
  private def boundedBody(r: Request[IO],maximum: Int): IO[String] = boundedBytes(r,maximum).map(bytes => new String(bytes,java.nio.charset.StandardCharsets.UTF_8))
  private def boundedBytes(r: Request[IO],maximum: Int): IO[Array[Byte]] = {
    Check(r.contentLength.forall(_<=maximum),"too-large","request body too large")
    r.body.take(maximum.toLong+1).compile.to(Array).timeout(30.seconds).map { bytes => Check(bytes.length<=maximum,"too-large","request body too large"); bytes }
  }
  private def json(status: Status,j: io.circe.Json): Response[IO] = Response[IO](status).withEntity(j.noSpaces).putHeaders(Header.Raw(CIString("Content-Type"),"application/json"),Header.Raw(CIString("Cache-Control"),"no-store"))
  private def sessionCookie(secret: String,maxAge: Long): ResponseCookie = ResponseCookie("chronicle_session",secret,path=Some("/"),maxAge=Some(maxAge),secure=config.secureCookies,httpOnly=true,sameSite=Some(SameSite.Strict))
  private def failure(d: DomainError): Response[IO] = {
    val status = d.code match { case "unauthorized" | "totp-required" => Status.Unauthorized; case "forbidden" | "pending-approval" => Status.Forbidden; case "not-found" => Status.NotFound; case "conflict" | "base-mismatch" | "upload-busy" | "content-mismatch" | "upload-expired" => Status.Conflict; case "gone" => Status.Gone; case "too-large" | "record-too-large" => Status.PayloadTooLarge; case "range-not-satisfiable" => Status.RangeNotSatisfiable; case "rate-limited" => Status.TooManyRequests; case "unavailable" => Status.ServiceUnavailable; case _ => Status.BadRequest }
    val r = json(status,Wire.encode(Failure.codecJson,Failure(d.code,d.detail)))
    if(status==Status.Unauthorized) r.putHeaders(Header.Raw(CIString("WWW-Authenticate"),"Bearer realm=\"chronicle\"")) else r
  }
  private def accountBoundary(r: Request[IO],mutating: Boolean): Unit = {
    noUrlSecrets(r)
    def count(name: String): Int = r.headers.headers.count(_.name==CIString(name))
    Check(count("Origin")<=1 && count("Host")==1 && count("Cookie")<=1,"forbidden","ambiguous browser credentials")
    Check(r.cookies.count(_.name=="chronicle_session")<=1,"forbidden","ambiguous browser credentials")
    Check(count("Authorization")==0,"forbidden","browser session required")
    origin(r,mutating)
    val configured=java.net.URI.create(config.allowedOrigin)
    val host=scala.util.Try(java.net.URI.create("//"+header(r,"Host").get)).toOption
    def port(uri: java.net.URI): Int = if(uri.getPort>=0) uri.getPort else if(configured.getScheme=="https") 443 else 80
    Check(host.exists(uri => uri.getHost!=null && uri.getRawUserInfo==null && Option(uri.getRawPath).forall(_.isEmpty) && uri.getRawQuery==null && uri.getRawFragment==null && uri.getHost.equalsIgnoreCase(configured.getHost) && port(uri)==port(configured)),"forbidden","Host not allowed")
    if(mutating) Check(count("Content-Type")==1 && r.contentType.exists(_.mediaType==MediaType.application.json),"invalid","Content-Type application/json required")
  }
  private def profileSwitchBoundary(r: Request[IO],mutating: Boolean): Unit = {
    accountBoundary(r,mutating)
    // A browser's ordinary same-origin GET fetch has no Origin header. Fetch Metadata still distinguishes
    // it from a request from a same-site sibling origin (which could carry the Strict cookie).
    val sites=r.headers.headers.filter(_.name==CIString("Sec-Fetch-Site")).map(_.value)
    Check((sites.isEmpty && header(r,"Origin").nonEmpty) || sites.toList==List("same-origin"),"forbidden","same-origin browser request required")
  }
  private def accountActors(r: Request[IO]): Vector[String] = r.headers.headers.filter(_.name==CIString("X-Account-Actor")).map(_.value).toVector
  /** The opt-in to every account scope: at most one `X-Account-Scopes`, and only `all`. Without it the account answers
    * name the typed scopes only. */
  private def accountScopesAll(r: Request[IO]): Boolean = r.headers.headers.filter(_.name==CIString(Http.accountScopesHeader)).map(_.value) match {
    case Nil => false
    case List(Http.allAccountScopes) => true
    case _ => throw DomainError("invalid","invalid account scopes header")
  }
  private def accountBody(r: Request[IO]): IO[io.circe.Json] = boundedBytes(r,math.min(config.maxBodyBytes,AccountJson.maxBodyBytes)).map(AccountJson.parseUtf8)
  private def accountEmpty(j: io.circe.Json): Unit = Check(j.asObject.exists(_.isEmpty),"invalid","empty object required")
  private def accountOk: Response[IO] = json(Status.Ok,io.circe.Json.obj("ok"->io.circe.Json.True))
  private def handleAccount(io: IO[Response[IO]]): IO[Response[IO]] = IO.defer(io).handleErrorWith {
    case d: DomainError => IO.pure(json(failure(d).status,AccountJson.failure(d.code)))
    case a: AccountFailure => IO.pure(json(failure(DomainError(a.code,"")).status,AccountJson.failure(a.code)))
    case error if Http.databaseUnavailable(error) => IO(logger.warn("account request refused: database unavailable")) *>
      IO.pure(retryAfter(json(Status.ServiceUnavailable,AccountJson.failure("unavailable")),Http.unavailableRetryAfterSeconds))
    case _ => IO(logger.error("account request failed")) *> IO.pure(json(Status.ServiceUnavailable,AccountJson.failure("unavailable")))
  }
  // The socket peer, or the right-most X-Forwarded-For element when that peer is the local reverse proxy.
  private def clientAddress(r: Request[IO]): String =
    ClientAddress.resolve(r.remote.map(_.host.toString).getOrElse(Http.unknownPeer),r.headers.headers.filter(_.name==CIString("X-Forwarded-For")).map(_.value).toVector,Http.loopback)
  private def presentedSession(r: Request[IO]): Option[String] = Some(cookie(r)).filter(_.nonEmpty)
  private def retryAfter(response: Response[IO],seconds: Long): Response[IO] = response.putHeaders(Header.Raw(CIString("Retry-After"),seconds.toString))
  private def audit(event: AccountEvent): Unit = {
    val fields=event.fields.map { case (name,value) => s"$name=$value" }.mkString(" ")
    logger.info(s"account security ${fields -> "fields" -> null}")
  }
  private def accountReply(reply: AccountReply): Response[IO] = {
    val response=json(Status.fromInt(reply.status).fold(throw _,identity),reply.body)
    val delayed=reply.retryAfterSeconds.fold(response)(retryAfter(response,_))
    reply.cookie match {
      case CookieEffect.Set(secret) => delayed.addCookie(sessionCookie(secret,PersistentCookie.maxAgeSeconds))
      case CookieEffect.Keep => delayed
    }
  }
  // The existing password login, for the configured logins the shared dispatcher hands back.
  private val declarativeLogin: DeclarativeLogin = new DeclarativeLogin {
    def login(login: String,password: String,previous: Option[String]): IO[SignedIn] = IO.blocking {
      val (user,secret)=auth.configuredAccountLogin(login,password)
      val hash=Wire.hash(secret)
      SignedIn(user,AccountSession(AccountCredential(user.id,user.userType,hash,hash,true),secret))
    }.adaptError { case d: DomainError => AccountFailure(d.code) }
  }
  /** A request to the account plane of imperative accounts: the existing account boundary, then the shared
    * dispatcher; the audit events are logged after its transaction committed. */
  private def imperativeAccount(r: Request[IO])(dispatch: AccountRequest => IO[AccountReply]): IO[Response[IO]] = {
    val mutating=r.method!=Method.GET
    val answered=handleAccount {
      IO(accountBoundary(r,mutating)) *> (if(mutating) accountBody(r).map(Some(_)) else IO.pure(None)).flatMap { body =>
        IO.blocking(auth.accountSession(cookie(r))).flatMap { session =>
          dispatch(AccountRequest(r.method.name,r.uri.path.renderString.stripPrefix(Http.accountPrefix),body,accountActors(r),session,presentedSession(r),clientAddress(r)))
        }
      }.flatMap(reply => IO(reply.events.foreach(audit)).as(accountReply(reply)))
    }
    // Every 503 of these endpoints carries Retry-After, also one raised outside the dispatcher (the session lookup).
    answered.map(response => if(response.status==Status.ServiceUnavailable && response.headers.get(CIString("Retry-After")).isEmpty) retryAfter(response,ImperativeAccountApi.UnavailableRetryAfterSeconds) else response)
  }
  // The legacy request cannot carry a TOTP code; it shares the address window and the credential gate of account login.
  private def legacyLogin(r: Request[IO],plane: AccountPlane): IO[Response[IO]] = {
    val address=clientAddress(r)
    def rejected(code: String,detail: String): Response[IO] = failure(DomainError(code,detail))
    IO(plane.limiter.request(address,CredentialEndpoint.Login)).flatMap {
      case Some(wait) => IO.pure(retryAfter(rejected("rate-limited","too many login attempts"),Http.retryAfterSeconds(wait)))
      case None => plane.gate.run(boundedBody(r,math.min(config.maxBodyBytes,Http.loginBodyBytes)).flatMap { raw =>
        val request=Wire.decode(LoginRequest.codecJson,Wire.parse(raw))
        IO.blocking(auth.legacyLogin(request,presentedSession(r))).map(request.login -> _)
      }).flatMap {
        case None => IO.pure(retryAfter(rejected("unavailable","login capacity exhausted"),ImperativeAccountApi.UnavailableRetryAfterSeconds))
        case Some((_,LoginOutcome.Established((response,secret)))) => IO.pure(json(Status.Ok,Wire.encode(LoginResponse.codecJson,response)).addCookie(sessionCookie(secret,PersistentCookie.maxAgeSeconds)))
        case Some((login,LoginOutcome.Rejected(reason,locked))) =>
          val refused=failure(Auth.rejection(reason))
          val answer=reason match {
            case AccountRejection.RateLimited(wait) => retryAfter(refused,Http.retryAfterSeconds(wait))
            case _ => refused
          }
          IO(locked.foreach(path => audit(AccountEvent(AccountEventKind.Locked,None,Some(ImperativePolicy.fold(login)),Some(path.text),address)))).as(answer)
      }
    }
  }
  /** Present exactly while the master switch `accounts.enabled` is on. */
  def accountPlane: Resource[IO,Option[AccountPlane]] = AccountPlane.resource(auth.accounts)
  /** The service without the account plane: none of the imperative-account endpoints, and no per-address login window. */
  def routes(ws: WebSocketBuilder2[IO],loginGate: Semaphore[IO]): HttpRoutes[IO] = routes(ws,loginGate,None)
  /** `accounts` is this service's `accountPlane`. */
  def routes(ws: WebSocketBuilder2[IO],loginGate: Semaphore[IO],accounts: Option[AccountPlane]): HttpRoutes[IO] = accounts match {
    case None => declaredRoutes(ws,loginGate,None)
    case Some(plane) => declaredRoutes(ws,loginGate,accounts) <+> HttpRoutes.of[IO] {
      // After the routes above: the five existing account endpoints keep their handlers.
      case r if r.uri.path.renderString.startsWith(Http.accountPrefix+"/") =>
        imperativeAccount(r)(plane.api.handle(Some(plane.access.settings),plane.access.declared,auth.imperative(plane.access),_))
    }
  }
  private def declaredRoutes(ws: WebSocketBuilder2[IO],loginGate: Semaphore[IO],accounts: Option[AccountPlane]): HttpRoutes[IO] = HttpRoutes.of[IO] {
    case r @ POST -> Root / "api" / "account" / "v1" / "login" => accounts match {
      case Some(plane) =>
        imperativeAccount(r)(plane.api.login(plane.access.settings,plane.access.declared,auth.imperative(plane.access),declarativeLogin,_))
      case None => handleAccount {
        IO(accountBoundary(r,true)) *> loginGate.permit.use { _ =>
          accountBody(r).flatMap { j => IO.blocking {
            val (login,password)=AccountJson.decodeLogin(j)
            val (user,secret)=auth.accountLogin(login,password)
            json(Status.Ok,io.circe.Json.obj("user"->AccountJson.user(user))).addCookie(sessionCookie(secret,PersistentCookie.maxAgeSeconds))
          }}
        }
      }
    }
    case r @ GET -> Root / "api" / "account" / "v1" => handleAccount { IO.blocking {
      accountBoundary(r,false)
      val all=accountScopesAll(r)
      val secret=cookie(r)
      val (user,tokens)=auth.account(auth.browser(secret),all)
      json(Status.Ok,AccountJson.account(user,tokens,Vector("Ingest","Read","Raw")++Option.when(all)(JobOperations.scope))).addCookie(sessionCookie(secret,PersistentCookie.maxAgeSeconds))
    } }
    case r @ POST -> Root / "api" / "account" / "v1" / "logout" => handleAccount {
      IO(accountBoundary(r,true)) *> accountBody(r).flatMap { j => IO.blocking {
        accountEmpty(j)
        auth.accountLogout(auth.browser(cookie(r)),accountActors(r))
        accountOk.addCookie(sessionCookie("",0))
      }}
    }
    case r @ POST -> Root / "api" / "account" / "v1" / "tokens" => handleAccount {
      IO { accountBoundary(r,true); accountScopesAll(r) }.flatMap(all => accountBody(r).flatMap { j => IO.blocking {
        val (name,scopes)=AccountJson.decodeIssue(j)
        val secret=cookie(r)
        val issued=auth.issueAccountToken(auth.browser(secret),name,scopes,accountActors(r),all)
        json(Status.Ok,AccountJson.issued(issued)).addCookie(sessionCookie(secret,PersistentCookie.maxAgeSeconds))
      }})
    }
    case r @ POST -> Root / "api" / "account" / "v1" / "tokens" / id / "revoke" => handleAccount {
      IO(accountBoundary(r,true)) *> accountBody(r).flatMap { j => IO.blocking {
        accountEmpty(j)
        val secret=cookie(r)
        auth.revokeAccountToken(auth.browser(secret),id,accountActors(r))
        accountOk.addCookie(sessionCookie(secret,PersistentCookie.maxAgeSeconds))
      }}
    }
    case r @ GET -> Root / "api" / "maintenance" / "v1" / "profile-switch" => handleAccount { IO.blocking {
      profileSwitchBoundary(r,false)
      json(Status.Ok,auth.previewOwnerProfileSwitch(auth.browser(cookie(r))).json)
    } }
    case r @ POST -> Root / "api" / "maintenance" / "v1" / "profile-switch" => handleAccount {
      IO(profileSwitchBoundary(r,true)).flatMap(_ => boundedBytes(r,math.min(config.maxBodyBytes,OwnerProfileSwitch.maxBodyBytes))).flatMap { bytes => IO.blocking {
        val request=OwnerProfileSwitch.decode(AccountJson.parseUtf8(bytes))
        auth.applyOwnerProfileSwitch(auth.browser(cookie(r)),request,accountActors(r))
        json(Status.Ok,request.success)
      }}
    }
    case r @ GET -> Root / "api" / "versions" => IO(json(Status.Ok,Wire.encode(VersionInfo.codecJson,Wire.versions)))
    case r @ POST -> Root / "api" / "login" => handle {
      IO { noUrlSecrets(r); origin(r,true); Check(header(r,"Authorization").isEmpty,"forbidden","browser cookie transport only") } *> (accounts match {
        case Some(plane) => legacyLogin(r,plane)
        case None => loginGate.permit.use { _ =>
          boundedBody(r,math.min(config.maxBodyBytes,Http.loginBodyBytes)).flatMap(raw => IO.blocking(auth.login(Wire.decode(LoginRequest.codecJson,Wire.parse(raw))))).map { case (response,secret) => json(Status.Ok,Wire.encode(LoginResponse.codecJson,response)).addCookie(sessionCookie(secret,PersistentCookie.maxAgeSeconds)) }
        }
      })
    }
    case r @ POST -> Root / "api" / "session" / "refresh" => handle { IO.blocking {
      noUrlSecrets(r); origin(r,true); Check(header(r,"Authorization").isEmpty,"forbidden","browser cookie transport only")
      val secret=cookie(r)
      val user=auth.refreshBrowser(secret)
      json(Status.Ok,Wire.encode(UserInfo.codecJson,user)).putHeaders(Header.Raw(CIString(Http.sessionTtlHeader),PersistentCookie.maxAgeSeconds.toString)).addCookie(sessionCookie(secret,PersistentCookie.maxAgeSeconds))
    } }
    case r @ POST -> Root / "api" / "logout" => handle { IO.blocking { noUrlSecrets(r); origin(r,true); Check(header(r,"Authorization").isEmpty,"forbidden","browser cookie transport only"); val i = auth.browser(cookie(r)); auth.logout(i); json(Status.Ok,io.circe.Json.obj()).addCookie(sessionCookie("",0)) } }
    case r @ POST -> Root / "api" / "ingest" => handle {
      // A snapshot can be hundreds of megabytes: even its text decoding stays off the compute pool.
      IO.blocking { noUrlSecrets(r); origin(r,false); val i = bearer(r); i.requireScope(Scope.Ingest); i }.flatMap(i => snapshots.ingest(r.contentLength)(boundedBytes(r,config.maxBodyBytes).flatMap(bytes => IO.blocking(archive.ingest(i.user.id,Wire.decode(IngestRequest.codecJson,Wire.parse(new String(bytes,java.nio.charset.StandardCharsets.UTF_8)))))))).map(receipt => json(Status.Ok,Wire.encode(IngestReceipt.codecJson,receipt)))
    }
    case r @ GET -> Root / "api" / "ingest" / "uploads" => handle {
      // The capability probe: a server without the upload API answers this path 404 without a Failure body.
      ingestBearer(r).flatMap(_ => boundedBytes(r,0)).map(_ => json(Status.Ok,Wire.encode(UploadLimits.codecJson,uploads.limits)))
    }
    case r @ POST -> Root / "api" / "ingest" / "uploads" => handle {
      ingestBearer(r).flatMap(i => boundedBody(r,math.min(config.maxBodyBytes,UploadPolicy.maxOpenBytes)).flatMap(raw => IO.blocking(uploads.open(i.user.id,Wire.decode(UploadOpen.codecJson,Wire.parse(raw))))))
        .map(state => json(Status.Ok,Wire.encode(UploadState.codecJson,state)))
    }
    case r @ GET -> Root / "api" / "ingest" / "uploads" / UUIDVar(id) => handle {
      ingestBearer(r).flatMap(i => boundedBytes(r,0).flatMap(_ => IO.blocking(uploads.status(i.user.id,id)))).map(state => json(Status.Ok,Wire.encode(UploadState.codecJson,state)))
    }
    case r @ POST -> Root / "api" / "ingest" / "uploads" / UUIDVar(id) / "parts" => handle {
      ingestBearer(r).flatMap { i =>
        def accept(maximum: Int): IO[UploadState] = boundedBytes(r,maximum).flatMap { bytes =>
          IO.blocking(uploads.part(i.user.id,id,Wire.decode(UploadPart.codecJson,Wire.parse(new String(bytes,java.nio.charset.StandardCharsets.UTF_8))),bytes.length.toLong))
        }
        r.contentLength.filter(_>UploadPolicy.maxPartBytes) match {
          // A large part (one record) announces its length and is admitted like a large ingest before its body is read.
          case Some(announced) =>
            Check(announced<=UploadPolicy.maxLargePartBytes(config),"too-large",s"a part has at most ${UploadPolicy.maxLargePartBytes(config)} bytes")
            snapshots.ingest(Some(announced))(accept(announced.toInt))
          case None => accept(UploadPolicy.maxPartBytes)
        }
      }.map(state => json(Status.Ok,Wire.encode(UploadState.codecJson,state)))
    }
    case r @ POST -> Root / "api" / "ingest" / "uploads" / UUIDVar(id) / "commit" => handle {
      ingestBearer(r).flatMap(i => boundedBytes(r,0).flatMap(_ => IO.blocking(uploads.commit(i.user.id,id)))).map(receipt => json(Status.Ok,Wire.encode(IngestReceipt.codecJson,receipt)))
    }
    case r @ POST -> Root / "api" / "ingest" / "uploads" / UUIDVar(id) / "abort" => handle {
      ingestBearer(r).flatMap(i => boundedBytes(r,0).flatMap(_ => IO.blocking(uploads.abort(i.user.id,id)))).map(state => json(Status.Ok,Wire.encode(UploadState.codecJson,state)))
    }
    // Every other request under the upload API is answered with a Failure body, so that clients never mistake it for a
    // server without the API.
    case r if r.uri.path.renderString=="/api/ingest/uploads" || r.uri.path.renderString.startsWith("/api/ingest/uploads/") => handle(IO.raiseError[Response[IO]](DomainError("not-found","no such upload endpoint")))
    case r @ GET -> Root / "api" / "raw" / session => rawManifest(r,session,None)
    case r @ GET -> Root / "api" / "raw" / session / revision => rawManifest(r,session,Some(revision))
    case r @ GET -> Root / "api" / "raw" / session / revision / file => rawAnswer(handle {
      rawReader(r).flatMap { i =>
        val range=single(r,"Range").map(RawStream.range)
        raw.download(i,RawStream.sessionId(session),RawStream.revision(revision),RawStream.file(file),range,single(r,"If-Range"))
      }.map {
        case RawStream.Answer.Bytes(response) => response
        case RawStream.Answer.Unsatisfiable(total) =>
          failure(DomainError("range-not-satisfiable",s"the range lies beyond the file's $total bytes")).putHeaders(Header.Raw(CIString("Content-Range"),s"bytes */$total"))
      }
    })
    // As under the upload API: a Failure body on every path, so that clients never mistake it for a server without the API.
    case r if r.uri.path.renderString=="/api/raw" || r.uri.path.renderString.startsWith("/api/raw/") => handle(IO.raiseError[Response[IO]](DomainError("not-found","no such raw endpoint")))
    case r @ POST -> Root / "api" / "collector" / "progress" => handle {
      IO.blocking { noUrlSecrets(r); origin(r,false); val i=bearer(r); i.requireScope(Scope.Ingest); i }.flatMap { i =>
        boundedBody(r,math.min(config.maxBodyBytes,CollectorProgress.maxBodyBytes)).flatMap(raw => IO.blocking(app.collectorProgress(i,Wire.decode(CollectorProgressUpdate.codecJson,Wire.parse(raw)))))
      }.map(ack => json(Status.Ok,Wire.encode(CollectorProgressAck.codecJson,ack)))
    }
    case r @ POST -> Root / "api" / "jobs" / "v1" => handle(jobOperation(r))
    // As under the upload API: a Failure body on every path, so that clients never mistake it for a server without the API.
    case r if r.uri.path.renderString==Http.jobsPath || r.uri.path.renderString.startsWith(Http.jobsPath+"/") => handle(IO.raiseError[Response[IO]](DomainError("not-found","no such job operations endpoint")))
    case r @ GET -> Root / "api" / "ws" => handle {
      IO { noUrlSecrets(r); origin(r,true); Check(header(r,"Authorization").isEmpty,"forbidden","browser cookie transport only") } *> socket(r,ws)
    }
    case r @ POST -> Root / "mcp" => handle {
      IO.blocking { noUrlSecrets(r); origin(r,false); val i = bearer(r); i.requireScope(Scope.Read)
        Check(r.contentType.exists(_.mediaType==MediaType.application.json),"invalid","Content-Type application/json required")
        val accept = header(r,"Accept").getOrElse(""); Check(accept.contains("application/json") && accept.contains("text/event-stream"),"invalid","Accept must support application/json and text/event-stream")
        Check(header(r,"MCP-Protocol-Version").forall(mcp.versions.contains),"invalid","unsupported MCP protocol version"); i
      }.flatMap { i => boundedBody(r,math.min(config.maxBodyBytes,Http.mcpBodyBytes)).flatMap { raw =>
        io.circe.parser.parse(raw) match {
          case Left(_) => IO.pure(json(Status.BadRequest,mcp.rpcError(io.circe.Json.Null,-32700,"Parse error")))
          case Right(j) => mcp.handle(i,j,app.contextReadAccess(i,IO.blocking(bearer(r)))).map { case None => Response[IO](Status.Accepted); case Some(response) => json(Status.Ok,response) }
        }
      }}
    }
    case GET -> Root / "mcp" => IO.pure(Response[IO](Status.MethodNotAllowed).putHeaders(Header.Raw(CIString("Allow"),"POST")))
    case DELETE -> Root / "mcp" => IO.pure(Response[IO](Status.MethodNotAllowed).putHeaders(Header.Raw(CIString("Allow"),"POST")))
    case r if r.method==Method.GET && !r.uri.path.renderString.startsWith("/api/") => static(r)
  }
  private def ingestBearer(r: Request[IO]): IO[Identity] = IO.blocking { noUrlSecrets(r); origin(r,false); val i=bearer(r); i.requireScope(Scope.Ingest); i }
  /** The job operations of a token with OperateJobs (CONTRACT.md "Job operations for tokens"): any other credential is
    * refused before the body is read; a request holds one of the process's permits; an operation outside the allow-list is
    * refused before dispatch; the owner's budget is charged before any effect (a mutation's only when it executes). */
  private def jobOperation(r: Request[IO]): IO[Response[IO]] = IO.blocking {
    noUrlSecrets(r); origin(r,false); val i=bearer(r)
    Check(r.contentType.exists(_.mediaType==MediaType.application.json),"invalid","Content-Type application/json required")
    i.requireJobOperator(); i
  }.flatMap { i =>
    val jobs=auth.jobs
    Resource.make(IO(jobs.admit()))(admitted => IO.whenA(admitted)(IO(jobs.release()))).use { admitted =>
      if(!admitted) IO.pure(retryAfter(failure(DomainError("unavailable","job operations busy")),JobLimits.busyRetryAfterSeconds))
      else boundedBody(r,math.min(config.maxBodyBytes,Http.jobBodyBytes)).flatMap { raw =>
        IO { val e=Wire.decode(ClientEnvelope.codecJson,Wire.parse(raw)); i.requireOperator(e.operation); e }.flatMap { e =>
          val operation=JobOperations.admitted(e.operation)
          val result=operation match {
            case Some(read @ (JobOperation.ActivityJobs | JobOperation.PreviewRetryFailed)) => IO.blocking(jobs.charge(i.user.id,read)) *> app.operation(i,e)
            case Some(mutation @ (JobOperation.RetryJob | JobOperation.ApplyRetryFailed)) => IO.blocking(auth.operateJob(i,e)).flatTap(receipted => IO(jobLog(mutation,i,e,receipted))).map(_.result)
            case None => IO.raiseError(DomainError("forbidden","browser session required"))
          }
          result.map { value =>
            val answer=json(Status.Ok,Wire.encode(ServerEnvelope.codecJson,ServerEnvelope(e.requestId,value)))
            // The preview counts its jobs (eligibleCurrentFailed), not the windows they still have to annotate: a Failed job
            // keeps its last run's window count only (none when it failed before counting), and which windows reuse accepted
            // work is known only once their content is windowed again.
            if(operation.contains(JobOperation.PreviewRetryFailed)) answer.putHeaders(Header.Raw(CIString(Http.windowsToAnnotateHeader),Http.unknownWindows)) else answer
          }
        }
      }.recover { case JobLimitReached(remaining) => retryAfter(failure(DomainError("rate-limited","job operation limit reached")),Http.retryAfterSeconds(remaining)) }
    }
  }
  private def jobLog(operation: JobOperation,i: Identity,e: ClientEnvelope,receipted: Receipted): Unit = {
    val outcome=receipted.result match {
      case Result.RetryFailed(result) => s"retried=${result.retried}"
      case Result.Error(failure) => failure.code
      case _ => "receipt"
    }
    val fields=List("operation"->operation.toString,"owner"->i.user.id,"caller"->i.token.fold("browser")(_.id.toString),"request"->e.requestId.toString,
      "replay"->receipted.replayed.toString,"actor"->receipted.actor.fold("browser")(_.toString),"outcome"->outcome).map((name,value) => s"$name=$value").mkString(" ")
    logger.info(s"jobs operation ${fields -> "fields" -> null}")
  }
  /** Raw downloads take the browser session only, as `GetRaw`, at the account boundary: no query string and no
    * Authorization header, one Cookie, Origin and Host, the Host of the configured origin, and Origin optional (a download
    * navigation sends none) but exact when present. */
  private def rawReader(r: Request[IO]): IO[Identity] = IO.blocking {
    accountBoundary(r,false)
    val i=auth.browser(cookie(r)); i.requireScope(Scope.Read); i.requireScope(Scope.Raw); i
  }
  private def single(r: Request[IO],name: String): Option[String] = {
    val values=r.headers.headers.filter(_.name==CIString(name))
    Check(values.size<=1,"invalid",s"at most one $name header")
    values.headOption.map(_.value)
  }
  private def rawManifest(r: Request[IO],session: String,revision: Option[String]): IO[Response[IO]] = rawAnswer(handle {
    rawReader(r).flatMap(i => raw.manifest(i,RawStream.sessionId(session),revision.map(RawStream.revision))).map(manifest => json(Status.Ok,Wire.encode(RawManifest.codecJson,manifest)))
  })
  private def rawAnswer(response: IO[Response[IO]]): IO[Response[IO]] =
    response.map(answer => if(answer.status==Status.ServiceUnavailable) retryAfter(answer,RawStream.retryAfterSeconds) else answer)
  private def handle(io: IO[Response[IO]]): IO[Response[IO]] = IO.defer(io).handleErrorWith {
    case d: DomainError => IO.pure(failure(d))
    case error if Http.databaseUnavailable(error) => IO(logger.warn("request refused: database unavailable")) *>
      IO.pure(retryAfter(json(Status.ServiceUnavailable,Wire.encode(Failure.codecJson,Failure("unavailable","database unavailable"))),Http.unavailableRetryAfterSeconds))
    case _ => IO(logger.error("request failed")) *> IO.pure(json(Status.InternalServerError,Wire.encode(Failure.codecJson,Failure("unavailable","request failed"))))
  }
  private def static(r: Request[IO]): IO[Response[IO]] = webRoot.path match {
    case None => NotFound()
    case Some(root) => IO.blocking {
      val base = Path.of(root).toRealPath(); val relative = r.uri.path.renderString.stripPrefix("/")
      val candidate = base.resolve(if(relative.isEmpty) "index.html" else relative).normalize()
      if(!candidate.startsWith(base) || !Files.isRegularFile(candidate) || !candidate.toRealPath().startsWith(base)) None else Some(candidate)
    }.flatMap {
      case None => NotFound()
      case Some(file) =>
        // Nix store mtimes are normalized: equal-length unversioned entry points can share
        // metadata validators across deployments. Always send their current bytes.
        val name=file.getFileName.toString.toLowerCase(java.util.Locale.ROOT)
        val html=name.endsWith(".html") || name.endsWith(".htm")
        val entryPoint=html || Set("/account.js","/account-client.js","/account.css").contains(r.uri.path.renderString) || r.uri.path.renderString.startsWith("/ui/")
        StaticFile.fromPath(fs2.io.file.Path.fromNioPath(file),if(entryPoint) None else Some(r)).getOrElseF(NotFound()).map { response =>
          val cached=if(entryPoint) response.transformHeaders(h => Headers(h.headers.filterNot(v => v.name==CIString("ETag") || v.name==CIString("Last-Modified")))).putHeaders(Header.Raw(CIString("Cache-Control"),"no-store")) else response
          cached.putHeaders(Header.Raw(CIString("Content-Security-Policy"),"default-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"),Header.Raw(CIString("X-Content-Type-Options"),"nosniff"),Header.Raw(CIString("Referrer-Policy"),"no-referrer"))
        }
    }
  }
  private def connectionLease(id: UUID,cleanup: Ref[IO,IO[Unit]],closed: Ref[IO,Boolean]): Resource[IO,(McpRunConnection,IO[Unit])] = Resource.make {
    rpc.connection(id).allocated.flatMap { case (connection,release) => Ref.of[IO,Boolean](false).flatMap { released =>
      val releaseOnce=IO.uncancelable(_ => released.getAndSet(true).flatMap(done => if(done) IO.unit else release))
      cleanup.set(releaseOnce) *> closed.get.ifM(releaseOnce,IO.unit).as(connection -> releaseOnce)
    }}
  }(_._2)

  private def socket(r: Request[IO],ws: WebSocketBuilder2[IO]): IO[Response[IO]] = for {
    queue <- Queue.bounded[IO,Http.SocketOutput](socketQueueCapacity)
    operations <- Queue.bounded[IO,ClientEnvelope](socketQueueCapacity)
    controlQueue <- Queue.bounded[IO,ClientEnvelope](BrowserControlAdmission.socketQueueCapacity)
    negotiated <- Ref.of[IO,Option[String]](None)
    closed <- Ref.of[IO,Boolean](false)
    cleanup <- Ref.of[IO,IO[Unit]](IO.unit)
    ending <- Deferred[IO,Http.SocketClose]
    heartbeat <- Ref.of[IO,Option[(UUID,String,FiniteDuration)]](None)
    connectionId <- IO(UUID.randomUUID())
    opened <- IO.monotonic
    close = (code: Int,failure: Option[ServerEnvelope]) => IO.uncancelable(_ => closed.set(true) *> cleanup.get.flatten *> ending.complete(Http.SocketClose(code,failure)).void)
    enqueue = (output: Http.SocketOutput) => closed.get.ifM(IO.unit,queue.tryOffer(output).flatMap { accepted =>
      if(accepted) IO.unit else close(retryableCloseCode,None)
    })
    send = (envelope: ServerEnvelope) => enqueue(Http.SocketOutput.Reply(BrowserReply.Control(envelope)))
    error = (id: UUID,d: DomainError) => {
      val envelope=ServerEnvelope(id,Result.Error(Failure(d.code,d.detail)))
      d.code match {
        case "unauthorized" => close(4401,Some(envelope))
        case "version-mismatch" => close(4406,Some(envelope))
        case "protocol-error" => close(4400,Some(envelope))
        case "unavailable" => negotiated.get.flatMap {
          case None => IO(logger.error("WebSocket negotiation unavailable")) *> close(retryableCloseCode,None)
          case Some(_) => send(envelope)
        }
        case _ => send(envelope)
      }
    }
    execute = (envelope: ClientEnvelope,connection: McpRunConnection,control: Boolean) => closed.get.ifM(IO.unit,
      negotiated.get.flatMap { version =>
        val action=IO.blocking(auth.browser(cookie(r))).flatMap { identity =>
          rpc.execute(identity,envelope,version.getOrElse(throw DomainError("protocol-error","Hello required")),connection)
        }
        (if(control) controls.run(action) else action).flatMap(reply => enqueue(Http.SocketOutput.Reply(reply)))
      }.handleErrorWith {
        case d: DomainError => error(envelope.requestId,d)
        case _ => error(envelope.requestId,DomainError("unavailable","operation failed"))
      })
    receive = (frame: WebSocketFrame) => closed.get.ifM(IO.unit,IO.defer {
      frame match {
        case WebSocketFrame.Text(text,true) =>
          if(text.getBytes(java.nio.charset.StandardCharsets.UTF_8).length>math.min(config.maxBodyBytes,Http.socketFrameBytes)) error(new UUID(0,0),DomainError("protocol-error","frame too large"))
          else negotiated.get.flatMap { version => scala.util.Try(protocol.decodeClient(version.getOrElse(Wire.versions.current),Wire.parse(text))).toEither match {
            case Left(_) => error(new UUID(0,0),DomainError("protocol-error","invalid frame"))
            case Right(envelope) =>
              (IO.blocking(auth.browser(cookie(r))).flatMap { identity =>
                negotiated.get.flatMap { ready =>
                  if(ready.isEmpty && !envelope.operation.isInstanceOf[Operation.Hello]) IO.raiseError(DomainError("protocol-error","Hello required"))
                  else envelope.operation match {
                    case Operation.Pong(nonce) => heartbeat.get.flatMap {
                      case Some((id,expected,_)) if nonce==expected && id==envelope.requestId => heartbeat.set(None)
                      case _ => IO.raiseError(DomainError("protocol-error","unexpected Pong"))
                    }
                    case Operation.Hello(versions) =>
                      Check(ready.isEmpty,"protocol-error","Hello already negotiated")
                      val selected=Wire.negotiate(versions)
                      rpc.ordinary(identity,envelope,selected).flatMap(result => negotiated.set(Some(selected)) *> enqueue(Http.SocketOutput.Reply(BrowserReply.Ordinary(ServerEnvelope(envelope.requestId,result),identity))))
                    case _: Operation.Ping => rpc.ordinary(identity,envelope,ready.get).flatMap(result => enqueue(Http.SocketOutput.Reply(BrowserReply.Ordinary(ServerEnvelope(envelope.requestId,result),identity))))
                    case operation =>
                      val selected=if(rpc.isControl(operation)) controlQueue else operations
                      selected.tryOffer(envelope).flatMap(accepted => if(accepted) IO.unit else error(envelope.requestId,DomainError("unavailable","socket operation queue is full")))
                  }
                }
              }).handleErrorWith { case d: DomainError => error(envelope.requestId,d); case _ => error(envelope.requestId,DomainError("unavailable","operation failed")) }
          }}
        case _: WebSocketFrame.Close => close(normalCloseCode,None)
        case _: WebSocketFrame.Ping => enqueue(Http.SocketOutput.Frame(WebSocketFrame.Pong()))
        case _: WebSocketFrame.Pong => IO.unit
        case _ => error(new UUID(0,0),DomainError("protocol-error","text JSON frames required"))
      }
    })
    tick = Stream.awakeEvery[IO](liveness.tick).evalMap { _ => closed.get.ifM(IO.unit,IO.monotonic.flatMap { now =>
      IO.blocking(auth.browser(cookie(r))).attempt.flatMap {
        case Left(d: DomainError) if d.code=="unauthorized" => error(new UUID(0,0),d)
        case Left(_) =>
          // A bare retryable close cannot overtake Hello with an ordinary, not-yet-negotiated error frame.
          IO(logger.error("session verification failed")) *> close(retryableCloseCode,None)
        case Right(_) => negotiated.get.flatMap { ready =>
          if(ready.isEmpty && now-opened>liveness.hello) close(retryableCloseCode,None)
          else if(ready.isEmpty) IO.unit
          else heartbeat.get.flatMap {
            case Some((_,_,deadline)) if now>deadline => close(retryableCloseCode,None)
            case Some(_) => IO.unit
            case None => if(liveness.pingWindow(now-opened)) { val id=UUID.randomUUID(); val nonce=Wire.secret(); heartbeat.set(Some((id,nonce,now+liveness.pongWithin))) *> send(ServerEnvelope(id,Result.Ping(nonce))) } else IO.unit
          }
        }
      }
    }) }.drain
    outgoing = Stream.resource(connectionLease(connectionId,cleanup,closed)).flatMap { case (connection,_) =>
      val ordinary=Stream.fromQueueUnterminated(operations).evalMap(envelope => execute(envelope,connection,false)).drain
      val control=Stream.fromQueueUnterminated(controlQueue).evalMap(envelope => execute(envelope,connection,true)).drain
      val workers=Stream.emits(List.fill(BrowserControlAdmission.socketWorkers)(control)).parJoin(BrowserControlAdmission.socketWorkers)
      val frames=Stream.fromQueueUnterminated(queue).evalMap {
        case Http.SocketOutput.Frame(frame) => IO.pure(Some(frame))
        case Http.SocketOutput.Reply(reply) =>
          val id=reply match {
            case BrowserReply.Ordinary(envelope,_) => envelope.requestId
            case BrowserReply.CommittedLogout(envelope) => envelope.requestId
            case BrowserReply.Control(envelope) => envelope.requestId
            case BrowserReply.McpRead(handle) => handle.requestId
            case BrowserReply.McpCatalog(id) => id
          }
          val render=negotiated.get.flatMap { version => rpc.materialize(reply,IO.blocking(auth.browser(cookie(r))),version.getOrElse(Wire.versions.current),protocol) }
          val admitted=reply match {
            case _: BrowserReply.Ordinary | _: BrowserReply.CommittedLogout | _: BrowserReply.Control => render
            case _ => controls.run(render)
          }
          admitted.map(json => Some(WebSocketFrame.Text(json.noSpaces): WebSocketFrame)).handleErrorWith {
              case d: DomainError if d.code!="unavailable" => error(id,d).as(None)
              case _ => IO(logger.error("delivery authorization unavailable")) *> close(retryableCloseCode,None).as(None)
            }
      }.unNone.interruptWhen(ending.get.as(Right(()): Either[Throwable,Unit]))
      val terminal=Stream.eval(ending.get).flatMap { ending =>
        val failure=Stream.emits(ending.failure.toList).evalMap(envelope => negotiated.get.map(version => WebSocketFrame.Text(protocol.encodeServer(version.getOrElse(Wire.versions.current),envelope).noSpaces): WebSocketFrame))
        failure ++ Stream.emit(WebSocketFrame.Close(ending.code,"chronicle").fold(throw _,identity))
      }
      // Erase runs before awaiting a JDBC-backed ordinary worker's cancellation.
      (frames ++ terminal).onFinalize(close(normalCloseCode,None)).concurrently(ordinary).concurrently(workers).concurrently(tick)
    }.onFinalize(closed.set(true))
    response <- ws.withOnClose(close(normalCloseCode,None)).build(outgoing,_.evalMap(receive))
  } yield response

}

object Http {
  val sessionTtlHeader = "X-Chronicle-Session-Ttl-Seconds"
  val loginBodyBytes = 16*1024
  val mcpBodyBytes = 64*1024
  val jobsPath = "/api/jobs/v1"
  val jobBodyBytes = 64*1024
  /** On a job-route preview of Retry failed: the windows its selection still has to annotate, which is not known. */
  val windowsToAnnotateHeader = "X-Chronicle-Windows-To-Annotate"
  val unknownWindows = "unknown"
  val socketFrameBytes = 64*1024
  val accountPrefix = "/api/account/v1"
  val accountScopesHeader = "X-Account-Scopes"
  val allAccountScopes = "all"
  // Bucket of requests whose socket peer is unknown: they share one address window.
  val unknownPeer = "unknown"
  /** The reverse proxy in front of Chronicle is local: only a loopback peer may name the client address. */
  def loopback(peer: String): Boolean = try java.net.InetAddress.ofLiteral(peer).isLoopbackAddress catch { case _: IllegalArgumentException => false }
  def retryAfterSeconds(wait: java.time.Duration): Long = math.max(1L,wait.getSeconds+(if(wait.getNano>0) 1L else 0L))
  /** A database the request may find available again (restart-robustness spec §5 B7): a full, timed-out or closed admission,
    * a connection the pool could not supply by its deadline (a fenced role's 28000 included) or a connection-class
    * SQLSTATE (08xxx, 57P01-57P03). REST answers 503 `unavailable` with Retry-After [[unavailableRetryAfterSeconds]]. */
  def databaseUnavailable(error: Throwable): Boolean = error match {
    case ponygirls.runtime.RuntimeFailure("admission-full" | "admission-timeout" | "runtime-closed") => true
    case ponygirls.runtime.JdbcFailure("connection-unavailable",_) => true
    case ponygirls.runtime.JdbcFailure(_,Some(state)) => state.startsWith("08") || Set("57P01","57P02","57P03").contains(state)
    case _ => false
  }
  val unavailableRetryAfterSeconds = 5L
  final case class WebRoot(path: Option[String])
  /** `hello` bounds the wait for Hello, a Ping is due every `pingEvery` and its Pong within `pongWithin`; the session is rechecked every `tick`. */
  final case class SocketLiveness(hello: FiniteDuration,pingEvery: FiniteDuration,pongWithin: FiniteDuration,tick: FiniteDuration) {
    require(tick.toNanos>0 && pingEvery.toNanos%tick.toNanos==0,"pingEvery must be a whole number of ticks")
    /** A Ping is eligible during the tick-wide window that starts at each multiple of `pingEvery` after the connection opened. */
    def pingWindow(sinceOpened: FiniteDuration): Boolean = sinceOpened.toNanos/tick.toNanos%(pingEvery.toNanos/tick.toNanos)==0
  }
  object SocketLiveness {
    val production: SocketLiveness = SocketLiveness(10.seconds,20.seconds,10.seconds,1.second)
  }
  private enum SocketOutput {
    case Reply(value: BrowserReply)
    case Frame(value: WebSocketFrame)
  }
  private final case class SocketClose(code: Int,failure: Option[ServerEnvelope])
}
