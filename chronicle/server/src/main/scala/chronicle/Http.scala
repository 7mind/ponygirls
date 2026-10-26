package chronicle
import chronicle.api.*
import cats.effect.{IO,Ref}
import cats.effect.std.{Queue,Semaphore}
import cats.syntax.all.*
import fs2.{Stream,Pipe}
import org.http4s.*
import org.http4s.dsl.io.*
import org.http4s.server.websocket.WebSocketBuilder2
import org.http4s.websocket.WebSocketFrame
import org.typelevel.ci.CIString
import java.util.UUID
import java.nio.file.{Files,Path}
import scala.concurrent.duration.*

final class Http(config: Config,auth: Auth,app: Application,archive: SessionArchive,mcp: Mcp,logger: logstage.IzLogger,webRoot: Http.WebRoot,protocol: VersionedWire) {
  private val socketQueueCapacity = 32
  private val livenessTimeoutCloseCode = 1013
  private def header(r: Request[IO],key: String): Option[String] = r.headers.get(CIString(key)).map(_.head.value)
  private def origin(r: Request[IO],required: Boolean): Unit = Check(header(r,"Origin").contains(config.allowedOrigin) || (!required && header(r,"Origin").isEmpty),"forbidden","Origin not allowed")
  private def cookie(r: Request[IO]): String = r.cookies.find(_.name=="chronicle_session").map(_.content).getOrElse("")
  private def bearer(r: Request[IO]): Identity = { Check(cookie(r).isEmpty,"forbidden","cookie and bearer transports are separate"); val value = header(r,"Authorization").getOrElse(""); Check(value.startsWith("Bearer "),"unauthorized","bearer credential required"); auth.bearer(value.substring(7)) }
  private def noUrlSecrets(r: Request[IO]): Unit = Check(r.uri.query.isEmpty,"invalid","query parameters are not supported")
  private def body(r: Request[IO]): IO[String] = {
    Check(r.contentLength.forall(_<=config.maxBodyBytes),"too-large","request body too large")
    r.body.take(config.maxBodyBytes.toLong+1).compile.to(Array).timeout(30.seconds).map { bytes => Check(bytes.length<=config.maxBodyBytes,"too-large","request body too large"); new String(bytes,java.nio.charset.StandardCharsets.UTF_8) }
  }
  private def json(status: Status,j: io.circe.Json): Response[IO] = Response[IO](status).withEntity(j.noSpaces).putHeaders(Header.Raw(CIString("Content-Type"),"application/json"),Header.Raw(CIString("Cache-Control"),"no-store"))
  private def sessionCookie(secret: String,maxAge: Long): ResponseCookie = ResponseCookie("chronicle_session",secret,path=Some("/"),maxAge=Some(maxAge),secure=config.secureCookies,httpOnly=true,sameSite=Some(SameSite.Strict))
  private def failure(d: DomainError): Response[IO] = {
    val status = d.code match { case "unauthorized" => Status.Unauthorized; case "forbidden" => Status.Forbidden; case "not-found" => Status.NotFound; case "conflict" => Status.Conflict; case "gone" => Status.Gone; case "too-large" => Status.PayloadTooLarge; case "unavailable" => Status.ServiceUnavailable; case _ => Status.BadRequest }
    val r = json(status,Wire.encode(Failure.codecJson,Failure(d.code,d.detail)))
    if(status==Status.Unauthorized) r.putHeaders(Header.Raw(CIString("WWW-Authenticate"),"Bearer realm=\"chronicle\"")) else r
  }
  def routes(ws: WebSocketBuilder2[IO],loginGate: Semaphore[IO]): HttpRoutes[IO] = HttpRoutes.of[IO] {
    case r @ GET -> Root / "api" / "versions" => IO(json(Status.Ok,Wire.encode(VersionInfo.codecJson,Wire.versions)))
    case r @ POST -> Root / "api" / "login" => handle {
      IO { noUrlSecrets(r); origin(r,true); Check(header(r,"Authorization").isEmpty,"forbidden","browser cookie transport only") } *> loginGate.permit.use { _ =>
        body(r).flatMap(raw => IO.blocking(auth.login(Wire.decode(LoginRequest.codecJson,Wire.parse(raw))))).map { case (response,secret) => json(Status.Ok,Wire.encode(LoginResponse.codecJson,response)).addCookie(sessionCookie(secret,config.sessionTtlSeconds.toLong)) }
      }
    }
    case r @ POST -> Root / "api" / "logout" => handle { IO.blocking { noUrlSecrets(r); origin(r,true); val i = auth.browser(cookie(r)); auth.logout(i); json(Status.Ok,io.circe.Json.obj()).addCookie(sessionCookie("",0)) } }
    case r @ POST -> Root / "api" / "ingest" => handle {
      IO.blocking { noUrlSecrets(r); origin(r,false); val i = bearer(r); i.requireScope(Scope.Ingest); i }.flatMap(i => body(r).flatMap(raw => IO.blocking(archive.ingest(i.user.id,Wire.decode(IngestRequest.codecJson,Wire.parse(raw)),config.profile)))).map(receipt => json(Status.Ok,Wire.encode(IngestReceipt.codecJson,receipt)))
    }
    case r @ GET -> Root / "api" / "ws" => handle {
      IO { noUrlSecrets(r); origin(r,true); Check(header(r,"Authorization").isEmpty,"forbidden","browser cookie transport only") } *> socket(r,ws)
    }
    case r @ POST -> Root / "mcp" => handle {
      IO.blocking { noUrlSecrets(r); origin(r,false); val i = bearer(r); i.requireScope(Scope.Read)
        Check(r.contentType.exists(_.mediaType==MediaType.application.json),"invalid","Content-Type application/json required")
        val accept = header(r,"Accept").getOrElse(""); Check(accept.contains("application/json") && accept.contains("text/event-stream"),"invalid","Accept must support application/json and text/event-stream")
        Check(header(r,"MCP-Protocol-Version").forall(mcp.versions.contains),"invalid","unsupported MCP protocol version"); i
      }.flatMap { i => body(r).flatMap { raw =>
        io.circe.parser.parse(raw) match {
          case Left(_) => IO.pure(json(Status.BadRequest,mcp.rpcError(io.circe.Json.Null,-32700,"Parse error")))
          case Right(j) => mcp.handle(i,j).map { case None => Response[IO](Status.Accepted); case Some(response) => json(Status.Ok,response) }
        }
      }}
    }
    case GET -> Root / "mcp" => IO.pure(Response[IO](Status.MethodNotAllowed).putHeaders(Header.Raw(CIString("Allow"),"POST")))
    case DELETE -> Root / "mcp" => IO.pure(Response[IO](Status.MethodNotAllowed).putHeaders(Header.Raw(CIString("Allow"),"POST")))
    case r if r.method==Method.GET && !r.uri.path.renderString.startsWith("/api/") => static(r)
  }
  private def handle(io: IO[Response[IO]]): IO[Response[IO]] = IO.defer(io).handleErrorWith {
    case d: DomainError => IO.pure(failure(d))
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
        // Nix store mtimes are normalized: equal-length HTML can share metadata validators
        // across deployments. Never let an old validator hide the current asset references.
        val name=file.getFileName.toString.toLowerCase(java.util.Locale.ROOT)
        val html=name.endsWith(".html") || name.endsWith(".htm")
        StaticFile.fromPath(fs2.io.file.Path.fromNioPath(file),if(html) None else Some(r)).getOrElseF(NotFound()).map { response =>
          val cached=if(html) response.transformHeaders(h => Headers(h.headers.filterNot(v => v.name==CIString("ETag") || v.name==CIString("Last-Modified")))).putHeaders(Header.Raw(CIString("Cache-Control"),"no-store")) else response
          cached.putHeaders(Header.Raw(CIString("Content-Security-Policy"),"default-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"),Header.Raw(CIString("X-Content-Type-Options"),"nosniff"),Header.Raw(CIString("Referrer-Policy"),"no-referrer"))
        }
    }
  }
  private def socket(r: Request[IO],ws: WebSocketBuilder2[IO]): IO[Response[IO]] = for {
    queue <- Queue.bounded[IO,WebSocketFrame](socketQueueCapacity)
    operations <- Queue.bounded[IO,ClientEnvelope](socketQueueCapacity)
    negotiated <- Ref.of[IO,Option[String]](None)
    closed <- Ref.of[IO,Boolean](false)
    heartbeat <- Ref.of[IO,Option[(UUID,String,FiniteDuration)]](None)
    opened <- IO.monotonic
    send = (e: ServerEnvelope) => closed.get.ifM(IO.unit,negotiated.get.flatMap(version => queue.offer(WebSocketFrame.Text(protocol.encodeServer(version.getOrElse(Wire.versions.current),e).noSpaces))))
    close = (code: Int) => closed.set(true) *> queue.offer(WebSocketFrame.Close(code,"chronicle").fold(throw _,identity))
    error = (id: UUID,d: DomainError) => send(ServerEnvelope(id,Result.Error(Failure(d.code,d.detail)))) *> (d.code match { case "unauthorized" => close(4401); case "version-mismatch" => close(4406); case "protocol-error" => close(4400); case _ => IO.unit })
    execute = (e: ClientEnvelope) => closed.get.ifM(IO.unit,
      negotiated.get.flatMap(version => IO.blocking(auth.browser(cookie(r))).flatMap(i => app.operationVersion(i,e,version.getOrElse(throw DomainError("protocol-error","Hello required"))))).flatMap(result => send(ServerEnvelope(e.requestId,result))).handleErrorWith {
        case d: DomainError => error(e.requestId,d)
        case _ => error(e.requestId,DomainError("unavailable","operation failed"))
      })
    work = Stream.fromQueueUnterminated(operations).evalMap(execute).drain
    receive = (frame: WebSocketFrame) => closed.get.ifM(IO.unit,IO.defer {
      frame match {
        case WebSocketFrame.Text(text,true) =>
          if(text.getBytes(java.nio.charset.StandardCharsets.UTF_8).length>config.maxBodyBytes) error(new UUID(0,0),DomainError("protocol-error","frame too large"))
          else negotiated.get.flatMap { version => scala.util.Try(protocol.decodeClient(version.getOrElse(Wire.versions.current),Wire.parse(text))).toEither match {
            case Left(_) => error(new UUID(0,0),DomainError("protocol-error","invalid frame"))
            case Right(e) =>
              (IO.blocking(auth.browser(cookie(r))).flatMap { i =>
                negotiated.get.flatMap { ready =>
                  if(ready.isEmpty && !e.operation.isInstanceOf[Operation.Hello]) IO.raiseError(DomainError("protocol-error","Hello required"))
                  else e.operation match {
                    case Operation.Pong(nonce) => heartbeat.get.flatMap {
                      case Some((id,expected,_)) if nonce==expected && id==e.requestId => heartbeat.set(None)
                      case _ => IO.raiseError(DomainError("protocol-error","unexpected Pong"))
                    }
                    case Operation.Hello(versions) =>
                      Check(ready.isEmpty,"protocol-error","Hello already negotiated")
                      val selected=Wire.negotiate(versions)
                      app.operation(i,e).flatMap(result => negotiated.set(Some(selected)) *> send(ServerEnvelope(e.requestId,result)))
                    case _: Operation.Ping => app.operation(i,e).flatMap(result => send(ServerEnvelope(e.requestId,result)))
                    case _ => operations.tryOffer(e).flatMap(accepted => if(accepted) IO.unit else error(e.requestId,DomainError("unavailable","socket operation queue is full")))
                  }
                }
              }).handleErrorWith { case d: DomainError => error(e.requestId,d); case _ => error(e.requestId,DomainError("unavailable","operation failed")) }
          }}
        case _: WebSocketFrame.Close => closed.set(true)
        case _: WebSocketFrame.Ping => queue.offer(WebSocketFrame.Pong())
        case _: WebSocketFrame.Pong => IO.unit
        case _ => error(new UUID(0,0),DomainError("protocol-error","text JSON frames required"))
      }
    })
    tick = (Stream.awakeEvery[IO](1.second).evalMap { _ => closed.get.ifM(IO.unit,IO.monotonic.flatMap { now =>
      IO.blocking(auth.browser(cookie(r))).attempt.flatMap {
        case Left(_) => error(new UUID(0,0),DomainError("unauthorized","session expired or revoked"))
        case Right(_) => negotiated.get.flatMap { ready =>
          if(ready.isEmpty && now-opened>10.seconds) close(livenessTimeoutCloseCode)
          else if(ready.isEmpty) IO.unit
          else heartbeat.get.flatMap {
            case Some((_,_,deadline)) if now>deadline => close(livenessTimeoutCloseCode)
            case Some(_) => IO.unit
            case None => if((now-opened).toSeconds%20==0) { val id=UUID.randomUUID(); val nonce=Wire.secret(); heartbeat.set(Some((id,nonce,now+10.seconds))) *> send(ServerEnvelope(id,Result.Ping(nonce))) } else IO.unit
          }
        }
      }
    }) }).drain
    response <- ws.withOnClose(closed.set(true)).build(Stream.fromQueueUnterminated(queue).mergeHaltL(tick).mergeHaltL(work),_.evalMap(receive))
  } yield response
}

object Http {
  final case class WebRoot(path: Option[String])
}
