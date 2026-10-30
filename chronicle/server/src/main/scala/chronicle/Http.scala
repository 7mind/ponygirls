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
import java.nio.file.{Files,Path}
import scala.concurrent.duration.*

final class Http(config: Config,auth: Auth,app: Application,archive: SessionArchive,mcp: Mcp,logger: logstage.IzLogger,webRoot: Http.WebRoot,protocol: VersionedWire,rpc: BrowserRpc,controls: BrowserControlAdmission) {
  private val socketQueueCapacity = 32
  private val retryableCloseCode = 1013
  private val normalCloseCode = 1000
  private def header(r: Request[IO],key: String): Option[String] = r.headers.get(CIString(key)).map(_.head.value)
  private def origin(r: Request[IO],required: Boolean): Unit = Check(header(r,"Origin").contains(config.allowedOrigin) || (!required && header(r,"Origin").isEmpty),"forbidden","Origin not allowed")
  private def cookie(r: Request[IO]): String = r.cookies.find(_.name=="chronicle_session").map(_.content).getOrElse("")
  private def bearer(r: Request[IO]): Identity = { Check(cookie(r).isEmpty,"forbidden","cookie and bearer transports are separate"); val value = header(r,"Authorization").getOrElse(""); Check(value.startsWith("Bearer "),"unauthorized","bearer credential required"); auth.bearer(value.substring(7)) }
  private def noUrlSecrets(r: Request[IO]): Unit = Check(r.uri.query.isEmpty,"invalid","query parameters are not supported")
  private def boundedBody(r: Request[IO],maximum: Int): IO[String] = {
    Check(r.contentLength.forall(_<=maximum),"too-large","request body too large")
    r.body.take(maximum.toLong+1).compile.to(Array).timeout(30.seconds).map { bytes => Check(bytes.length<=maximum,"too-large","request body too large"); new String(bytes,java.nio.charset.StandardCharsets.UTF_8) }
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
        boundedBody(r,math.min(config.maxBodyBytes,Http.loginBodyBytes)).flatMap(raw => IO.blocking(auth.login(Wire.decode(LoginRequest.codecJson,Wire.parse(raw))))).map { case (response,secret) => json(Status.Ok,Wire.encode(LoginResponse.codecJson,response)).addCookie(sessionCookie(secret,config.sessionTtlSeconds.toLong)) }
      }
    }
    case r @ POST -> Root / "api" / "session" / "refresh" => handle { IO.blocking {
      noUrlSecrets(r); origin(r,true); Check(header(r,"Authorization").isEmpty,"forbidden","browser cookie transport only")
      val secret=cookie(r)
      val user=auth.refreshBrowser(secret)
      json(Status.Ok,Wire.encode(UserInfo.codecJson,user)).putHeaders(Header.Raw(CIString(Http.sessionTtlHeader),config.sessionTtlSeconds.toString)).addCookie(sessionCookie(secret,config.sessionTtlSeconds.toLong))
    } }
    case r @ POST -> Root / "api" / "logout" => handle { IO.blocking { noUrlSecrets(r); origin(r,true); Check(header(r,"Authorization").isEmpty,"forbidden","browser cookie transport only"); val i = auth.browser(cookie(r)); auth.logout(i); json(Status.Ok,io.circe.Json.obj()).addCookie(sessionCookie("",0)) } }
    case r @ POST -> Root / "api" / "ingest" => handle {
      IO.blocking { noUrlSecrets(r); origin(r,false); val i = bearer(r); i.requireScope(Scope.Ingest); i }.flatMap(i => boundedBody(r,config.maxBodyBytes).flatMap(raw => IO.blocking(archive.ingest(i.user.id,Wire.decode(IngestRequest.codecJson,Wire.parse(raw)))))).map(receipt => json(Status.Ok,Wire.encode(IngestReceipt.codecJson,receipt)))
    }
    case r @ POST -> Root / "api" / "collector" / "progress" => handle {
      IO.blocking { noUrlSecrets(r); origin(r,false); val i=bearer(r); i.requireScope(Scope.Ingest); i }.flatMap { i =>
        boundedBody(r,math.min(config.maxBodyBytes,CollectorProgress.maxBodyBytes)).flatMap(raw => IO.blocking(app.collectorProgress(i,Wire.decode(CollectorProgressUpdate.codecJson,Wire.parse(raw)))))
      }.map(ack => json(Status.Ok,Wire.encode(CollectorProgressAck.codecJson,ack)))
    }
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
    send = (envelope: ServerEnvelope) => enqueue(Http.SocketOutput.Reply(BrowserReply.Ordinary(envelope)))
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
                      rpc.ordinary(identity,envelope,selected).flatMap(result => negotiated.set(Some(selected)) *> send(ServerEnvelope(envelope.requestId,result)))
                    case _: Operation.Ping => rpc.ordinary(identity,envelope,ready.get).flatMap(result => send(ServerEnvelope(envelope.requestId,result)))
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
    tick = Stream.awakeEvery[IO](1.second).evalMap { _ => closed.get.ifM(IO.unit,IO.monotonic.flatMap { now =>
      IO.blocking(auth.browser(cookie(r))).attempt.flatMap {
        case Left(d: DomainError) if d.code=="unauthorized" => error(new UUID(0,0),d)
        case Left(_) =>
          // A bare retryable close cannot overtake Hello with an ordinary, not-yet-negotiated error frame.
          IO(logger.error("session verification failed")) *> close(retryableCloseCode,None)
        case Right(_) => negotiated.get.flatMap { ready =>
          if(ready.isEmpty && now-opened>10.seconds) close(retryableCloseCode,None)
          else if(ready.isEmpty) IO.unit
          else heartbeat.get.flatMap {
            case Some((_,_,deadline)) if now>deadline => close(retryableCloseCode,None)
            case Some(_) => IO.unit
            case None => if((now-opened).toSeconds%20==0) { val id=UUID.randomUUID(); val nonce=Wire.secret(); heartbeat.set(Some((id,nonce,now+10.seconds))) *> send(ServerEnvelope(id,Result.Ping(nonce))) } else IO.unit
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
            case BrowserReply.Ordinary(envelope) => envelope.requestId
            case BrowserReply.McpRead(handle) => handle.requestId
            case BrowserReply.McpCatalog(id) => id
          }
          val render=negotiated.get.flatMap { version => rpc.materialize(reply,IO.blocking(auth.browser(cookie(r))),version.getOrElse(Wire.versions.current),protocol) }
          val admitted=reply match {
            case _: BrowserReply.Ordinary => render
            case _ => controls.run(render)
          }
          admitted.map(json => Some(WebSocketFrame.Text(json.noSpaces): WebSocketFrame)).handleErrorWith {
              case d: DomainError => error(id,d).as(None)
              case _ => error(id,DomainError("unavailable","operation failed")).as(None)
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
  val socketFrameBytes = 64*1024
  final case class WebRoot(path: Option[String])
  private enum SocketOutput {
    case Reply(value: BrowserReply)
    case Frame(value: WebSocketFrame)
  }
  private final case class SocketClose(code: Int,failure: Option[ServerEnvelope])
}
