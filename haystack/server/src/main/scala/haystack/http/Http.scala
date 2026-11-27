package haystack.http

import cats.effect.{IO,Ref,Deferred,SyncIO}
import cats.syntax.all.*
import fs2.Stream
import haystack.{api,domain}
import haystack.domain.Fault
import haystack.auth.*
import haystack.application.ItemService
import haystack.query.{SearchInput,SearchSort,Search,Query,InvalidQuery,QueryDiagnostic,Span}
import org.http4s.*
import org.http4s.dsl.io.*
import org.http4s.server.websocket.WebSocketBuilder2
import org.http4s.websocket.WebSocketFrame
import org.typelevel.ci.CIString
import org.typelevel.vault.Key
import io.circe.Json
import ponygirls.auth.{AccountFailure,ClientAddress}
import ponygirls.auth.boundary.{CredentialAccept,SecureAttribute}
import ponygirls.auth.http4s.{AccountPlane,AccountPlaneSettings,ActorRule,CallerRoute,LoginAdmission,RouteCredential,ServiceCallerSettings,ServiceCallers}
import scala.concurrent.duration.*
import java.nio.file.{Files,Path}

/** Transport owns credentials and bounded decoding only. All mutation and
  * search semantics live in the application/repository shared with MCP. */
final class Http(getAuth:()=>Auth,service:ItemService,hub:LiveHub,webRoot:Option[Path],retrieval:haystack.retrieval.HaystackRetrieval,accounts:AccountService) {
  private val limiter=new RateLimiter
  /** The principal a route authenticated for the response it returns. The access log labels its row with it and looks
    * the caller up itself only for a response without one. */
  private val authenticatedPrincipal:Key[domain.Principal]=Key.newKey[SyncIO,domain.Principal].unsafeRunSync()
  private def all(r:Request[IO],name:String):Vector[String]=r.headers.headers.filter(_.name==CIString(name)).map(_.value).toVector
  private def headers(r:Request[IO]):RequestHeaders=RequestHeaders(all(r,"Host").headOption.getOrElse(""),all(r,"Authorization"),all(r,"Cookie"),all(r,"Origin"),all(r,"Sec-Fetch-Site").headOption,all(r,Sessions.AccountRequestHeader))
  private def json(status:Status,value:Json):Response[IO]=Response[IO](status).withEntity(value.noSpaces).putHeaders(Header.Raw(CIString("Content-Type"),"application/json"),Header.Raw(CIString("Cache-Control"),"no-store"),Header.Raw(CIString("Referrer-Policy"),"no-referrer"))
  private def ok[A](codec:baboon.runtime.shared.BaboonJsonCodec[A],value:A):Response[IO]=json(Status.Ok,Wire.encode(codec,value))
  private def body(r:Request[IO]):IO[Json]=boundedBody(r,Wire.envelopeLimits.maxBytes,Wire.parse)
  private def boundedBody(r:Request[IO],maxBytes:Int,parse:Array[Byte]=>Json):IO[Json]=IO {
    if(r.uri.query.nonEmpty) throw Fault("bad-envelope","query parameters are not supported")
    if(!r.contentType.exists(_.mediaType==MediaType.application.json)) throw Fault("bad-envelope","application/json required")
    if(r.contentLength.exists(_>maxBytes)) throw Fault("too-large","body too large")
  } *> r.body.take(maxBytes.toLong+1).compile.to(Array).timeout(Http.BodyTimeout).map { bytes =>
    if(bytes.length>maxBytes) throw Fault("too-large","body too large")
    parse(bytes)
  }
  /** The callers of Haystack's own routes: either credential, no actor header; `/mcp` takes a bearer token only and
    * refuses a session cookie before any lookup. */
  private val callers=new ServiceCallers[Auth](accounts.shared,ServiceCallerSettings[Auth](_.config.originPolicy,Sessions.Cookies,SecureAttribute.Last))
  private def route(mutate:Boolean,mcp:Boolean):CallerRoute=
    CallerRoute(if(mcp)CredentialAccept.BearerOnly else CredentialAccept.BearerOrCookie,RouteCredential.Either,mutate,ActorRule.NotRequired)
  /** Initial auth admits bounded body work only. Dispatch must use the same
    * still-current identity/transport after that asynchronous read completes. */
  private def revalidate(r:Request[IO],captured:Authenticated,mutate:Boolean=false,mcp:Boolean=false):IO[Authenticated]=
    accounts.caller(callers.recheck(r,route(mutate,mcp),AccountService.captured(captured)))
  private def authorizedBody(r:Request[IO],captured:Authenticated,mutate:Boolean=false,mcp:Boolean=false):IO[Json]=
    body(r).flatTap(_=>revalidate(r,captured,mutate,mcp).void)
  private def version(r:Request[IO]):Unit={
    val offered=all(r,"X-Haystack-Version")
    if(offered.size>1 || offered.exists(_!=Wire.versions.current)) throw Fault("version-mismatch","unsupported API version")
    if(all(r,"Host").size!=1) throw Fault("forbidden","ambiguous host")
    if(r.uri.query.nonEmpty) throw Fault("bad-envelope","query parameters are not supported")
  }
  /** The identity that admits a request, before its body and handler. */
  private def admitted(r:Request[IO],mutate:Boolean):IO[Authenticated]=IO.defer {
    version(r)
    accounts.caller(callers.admit(r,route(mutate,mcp=false))).flatTap(resolved=>IO(limiter.check(resolved.principal,getAuth().config.rateLimit)))
  }
  /** `current` is the last check before delivery: its principal labels the log row and its browser session is renewed. */
  private def delivered(response:Response[IO],current:Authenticated):Response[IO]=
    callers.renewed(response.withAttribute(authenticatedPrincipal,current.principal),AccountService.captured(current))
  /** A handler that waits (a read, a write): the captured identity is checked once more when its result exists, and
    * only then is the result rendered. A caller revoked meanwhile is unauthorized, whatever `render` would answer. */
  private def authedResult[A](r:Request[IO],mutate:Boolean)(f:Authenticated=>IO[A])(render:A=>Response[IO]):IO[Response[IO]]=
    admitted(r,mutate).flatMap(resolved=>f(resolved).flatMap(result=>revalidate(r,resolved,mutate).map(current=>delivered(render(result),current))))
  /** A handler that waits and renders its own response. */
  private def authed(r:Request[IO],mutate:Boolean=false)(f:Authenticated=>IO[Response[IO]]):IO[Response[IO]]=authedResult(r,mutate)(f)(identity)
  /** A handler that cannot wait: its response follows the check that admitted the request without any wait, so that
    * check is also the one before delivery. */
  private def authedPure(r:Request[IO])(f:Authenticated=>Response[IO]):IO[Response[IO]]=
    admitted(r,mutate=false).map(resolved=>delivered(f(resolved),resolved))
  /** A body, then a handler that cannot wait: the check after the body is the one before delivery. */
  private def authedBodyPure(r:Request[IO])(f:Json=>Response[IO]):IO[Response[IO]]=
    admitted(r,mutate=false).flatMap(resolved=>body(r).flatMap(raw=>revalidate(r,resolved).map(current=>delivered(f(raw),current))))
  private def status(code:String):Status=code match {
    case "unauthorized"|"ambiguous-credentials"=>Status.Unauthorized
    case "forbidden"=>Status.Forbidden
    case "not-found"=>Status.NotFound
    case "conflict"|"replay-conflict"=>Status.Conflict
    case "rate-limited"=>Status.TooManyRequests
    case "too-large"=>Status.PayloadTooLarge
    case "unavailable"=>Status.ServiceUnavailable
    case _=>Status.BadRequest
  }
  private def failure(error:Throwable):Response[IO]={
    val (code,spans,current)=error match {
      case f:AccountFailure=>(if(f.code=="config")"unavailable"else f.code,List.empty[api.Span],None)
      case f:Fault if f.code=="config"=>("unavailable",List.empty[api.Span],None)
      case f:Fault=>(f.code,List.empty[api.Span],f.currentRevision.map(_.toInt))
      case _:ponygirls.retrieval.RetrievalError=>("unavailable",List.empty[api.Span],None)
      case q:haystack.query.InvalidQuery=>("invalid-query",q.diagnostics.map(d=>api.Span(d.message,d.span.start,d.span.end)).toList,None)
      case _:haystack.query.InvalidCursor=>("invalid-cursor",List.empty[api.Span],None)
      case _=>("unavailable",List.empty[api.Span],None)
    }
    // Never send raw exception text (SQL, paths, submitted documents, secrets); a typed retrieval reason has a fixed text.
    val message=error match {
      case ponygirls.retrieval.RetrievalError(_,_,Some(reason))=>reason.text
      case _=>code.replace('-',' ')
    }
    json(status(code),Wire.encode(api.Failure.codecJson,api.Failure(code,message,spans,current)))
  }
  private def handled(operation: =>IO[Response[IO]]):IO[Response[IO]]=IO.defer(operation).handleError(e=>failure(e))
  /** Haystack's account failure codes: the shared refusals as Haystack's `Fault`s, then the account protocol's codes. */
  private def accountCode(raw:Throwable):String={
    val category=Refused.asFault(raw) match {
      case e:AccountFailure=>e.code
      case e:Fault=>e.code
      case _=>"unavailable"
    }
    category match {
      case "bad-envelope"=>"invalid"
      case "ambiguous-credentials"=>"unauthorized"
      case "invalid"|"unauthorized"|"forbidden"|"not-found"|"conflict"|"rate-limited"|"too-large"=>category
      case _=>"unavailable"
    }
  }
  /** The socket peer, or the right-most `X-Forwarded-For` element when the peer is the local reverse proxy. */
  private def clientAddress(r:Request[IO]):String=
    ClientAddress.resolve(r.remoteAddr.fold(Http.UnknownPeer)(_.toString),all(r,"X-Forwarded-For"),peer=>scala.util.Try(java.net.InetAddress.ofLiteral(peer).isLoopbackAddress).getOrElse(false))
  /** The shared account plane with Haystack's origin policy, cookies, responses, failure codes, application-log
    * security events (exactly the shared field allowlist), live-socket ends, per-principal rate limit and log label. */
  private val accountPlane=new AccountPlane[Auth](accounts.shared,AccountPlaneSettings[Auth](
    current=getAuth,origins=_.config.originPolicy,cookies=Sessions.Cookies,cookieOrder=SecureAttribute.Last,respond=json,failureCode=accountCode,
    status=status,audit=event=>IO.println(Json.obj(event.fields.map((name,value)=>name->Json.fromString(value))*).noSpaces),endSession=hub.endSession,
    clientAddress=clientAddress,admitted=a=>limiter.check(AccountService.principal(a.authority),getAuth().config.rateLimit),
    delivered=(response,a)=>response.withAttribute(authenticatedPrincipal,AccountService.principal(a.authority)),bodyTimeout=Http.BodyTimeout,
    retryAfterOn503=true,
    // Haystack has never limited declared users' password logins with imperative accounts off; this states that choice.
    loginAdmission=LoginAdmission.Unguarded))
  def routes(ws:WebSocketBuilder2[IO]):HttpRoutes[IO]={
    val core=HttpRoutes.of[IO](accountPlane.routes.orElse {
    case GET -> Root / "api" / "versions" =>IO.pure(ok(api.VersionInfo.codecJson,Wire.versions))
    case GET -> Root / "api" / "v1" / "health" =>IO.pure(ok(api.Ack.codecJson,api.Ack(true)))
    case r @ POST -> Root / "api" / "v1" / "login" =>handled {
      IO {version(r);Sessions.validateTransport(getAuth().config,headers(r));Sessions.csrf(getAuth().config,headers(r))} *> body(r).flatMap { raw=>
        Wire.decode(api.LoginRequest.codecJson,raw)
        IO.raiseError(Fault("unauthorized","password login required"))
      }
    }
    case r @ POST -> Root / "api" / "v1" / "logout" =>handled {IO(version(r)) *> accounts.resolve(headers(r),mutate=true).flatMap { a=>
      accounts.logoutLegacy(a) *> hub.endSession(a.token).as(ok(api.Ack.codecJson,api.Ack(true)).putHeaders(Header.Raw(CIString("Set-Cookie"),Sessions.serialize(None,a.secureCookie))))
    }}
    case r @ GET -> Root / "api" / "v1" / "whoami" =>handled {authedPure(r) { a=>ok(api.Identity.codecJson,Wire.identity(a.principal,getAuth().config.activityProjectId)) }}
    case r @ POST -> Root / "api" / "v1" / "get" =>handled {authed(r) { a=>authorizedBody(r,a).flatMap { raw=>
      val input=Wire.decode(api.GetRequest.codecJson,raw)
      service.get(input.key,input.revision.map(_.toLong)).map(item=>ok(api.Item.codecJson,Wire.item(item)))
    }}}
    case r @ POST -> Root / "api" / "v1" / "put" =>handled {authed(r,true) { a=>authorizedBody(r,a,mutate=true).flatMap { raw=>
      val input=Wire.decode(api.PutRequest.codecJson,raw)
      service.put(input.key,input.document.json,input.expectedRevision,input.requestId.toString,a.principal).map(result=>ok(api.PutResult.codecJson,api.PutResult(input.key,result.revision.toInt,Wire.metadata(result.metadata),result.replayed)))
    }}}
    case r @ POST -> Root / "api" / "v1" / "search" =>handled {authed(r) { a=>authorizedBody(r,a).flatMap { raw=>
      val input=Wire.decode(api.SearchRequest.codecJson,raw)
      service.search(SearchInput(input.query,input.project,input.limit,input.cursor,SearchSort(input.sort.field,input.sort.direction))).map(result=>ok(api.SearchResult.codecJson,api.SearchResult(result.items.map(Wire.summary).toList,result.cursor)))
    }}}
    // `Wire.retrieved` refuses a page with an invalid or incompatible published identity: it renders after the check.
    case r @ POST -> Root / "api" / "v1" / "retrieve" =>handled {authedResult(r,mutate=false) { a=>authorizedBody(r,a).flatMap { raw=>
      val input=Wire.decode(api.RetrieveRequest.codecJson,raw)
      val mode=Wire.retrievalMode(input.mode)
      retrieval.search(input.query,mode,input.project,input.includeArchived,input.offset,input.limit).map(mode->_)
    }} { (mode,page)=>ok(api.RetrieveResult.codecJson,Wire.retrieved(retrieval,mode,page)) }}
    case r @ GET -> Root / "api" / "v1" / "capabilities" =>handled {authedPure(r) { _=>ok(api.RetrievalCapabilities.codecJson,Wire.capabilities(retrieval)) }}
    case r @ POST -> Root / "api" / "v1" / "history" =>handled {authed(r) { a=>authorizedBody(r,a).flatMap { raw=>
      val input=Wire.decode(api.HistoryRequest.codecJson,raw)
      service.history(input.key).map(revisions=>ok(api.HistoryResult.codecJson,api.HistoryResult(revisions.map(v=>api.RevisionInfo(v.revision.toInt,v.modifiedAt.toString,v.modifiedBy,v.tokenId)).toList)))
    }}}
    case r @ POST -> Root / "api" / "v1" / "query" / "analyze" =>handled {authedBodyPure(r) { raw=>
      val input=Wire.decode(api.QueryRequest.codecJson,raw); val diagnostics=Search.analyze(input.query)
      ok(api.AnalyzeResult.codecJson,api.AnalyzeResult(diagnostics.isEmpty,diagnostics.map(d=>api.Span(d.message,d.span.start,d.span.end)).toList))
    }}
    case r @ POST -> Root / "api" / "v1" / "complete" =>handled {authed(r) { a=>authorizedBody(r,a).flatMap { raw=>
      val input=Wire.decode(api.QueryRequest.codecJson,raw)
      if(input.query.length>Query.MaxChars) throw new InvalidQuery(Vector(QueryDiagnostic(s"query exceeds ${Query.MaxChars} characters",Span(0,input.query.length))))
      if(input.caret<0 || input.caret>input.query.length ||
          input.caret>0 && input.caret<input.query.length && Character.isHighSurrogate(input.query.charAt(input.caret-1)) && Character.isLowSurrogate(input.query.charAt(input.caret)))
        throw Fault("bad-envelope","invalid caret")
      service.complete(input.query.take(input.caret).split("\\s+").lastOption.getOrElse("")).map(values=>ok(api.CompletionResult.codecJson,api.CompletionResult(values.toList)))
    }}}
    case r @ POST -> Root / "api" / "v1" / "values" =>handled {authed(r) { a=>authorizedBody(r,a).flatMap(raw=>service.values(Wire.decode(api.ValuesRequest.codecJson,raw).field)).map(values=>ok(api.ValuesResult.codecJson,api.ValuesResult(values.toList))) }}
    case r @ GET -> Root / "api" / "v1" / "live" =>handled {socket(r,ws)}
    case r @ POST -> Root / "mcp" =>IO.defer {
      IO(version(r)) *> accounts.resolve(headers(r),mcp=true).flatMap { a=>
        limiter.check(a.principal,getAuth().config.rateLimit)
        val accept=all(r,"Accept").mkString(",")
        if(!accept.contains("application/json") || !accept.contains("text/event-stream")) throw Fault("bad-envelope","unsupported accept")
        if(all(r,"MCP-Protocol-Version").exists(_!="2025-11-25")) throw Fault("bad-envelope","unsupported MCP version")
        authorizedBody(r,a,mcp=true).flatMap(raw=>new Mcp(service,retrieval).handle(a.principal,raw)).flatMap { result=>
          revalidate(r,a,mcp=true).map(current=>result.fold(json(Status.Accepted,Json.Null))(json(Status.Ok,_)).withAttribute(authenticatedPrincipal,current.principal))
        }
      }
    }.handleError { error=>
      val code=error match{case f:AccountFailure=>f.code;case f:Fault if f.code=="config"=>"unavailable";case f:Fault=>f.code;case _=>"unavailable"}
      json(status(code),Json.obj("jsonrpc"->Json.fromString("2.0"),"id"->Json.Null,"error"->Json.obj("code"->Json.fromInt(if(code=="unauthorized"||code=="ambiguous-credentials") -32001 else -32000),"message"->Json.fromString(code))))
    }
    case r if r.uri.path.renderString=="/mcp"=>IO.pure(json(Status.MethodNotAllowed,Json.Null).putHeaders(Header.Raw(CIString("Allow"),"POST")))
    case r if r.method==Method.GET && !r.uri.path.renderString.startsWith("/api/")=>handled(static(r))
    case r if r.uri.path.renderString.startsWith("/api/")=>IO.pure(failure(Fault("not-found","unknown API operation")))
  })
    cats.data.Kleisli { request=>
      val start=System.nanoTime()
      core(request).semiflatMap { response=>
        val path=request.uri.path.renderString
        val label=if(path=="/mcp") "mcp" else if(path.startsWith("/api/")) AccountPlane.label(request.method,path).orElse(path.split("/").lastOption.filter(Set("login","logout","whoami","get","put","search","history","analyze","complete","values","live","retrieve","capabilities","health","versions"))).getOrElse("unknown") else "static"
        response.attributes.lookup(authenticatedPrincipal).fold(accounts.resolve(headers(request),mcp=label=="mcp").attempt.map(_.toOption.map(_.principal)))(principal=>IO.pure(Some(principal))).flatMap { principal=>
          val event=Json.obj("requestId"->Json.fromString(java.util.UUID.randomUUID().toString),"route"->Json.fromString(label),"status"->Json.fromInt(response.status.code),"result"->Json.fromString(if(response.status.isSuccess) "ok" else "fault"),"durationMs"->Json.fromLong((System.nanoTime()-start)/1000000)).deepMerge(principal.fold(Json.obj())(p=>Json.obj("userId"->Json.fromString(p.userId),"tokenId"->Json.fromString(p.tokenId))))
          IO.println(event.noSpaces).as(response)
        }
      }
    }
  }
  private def static(r:Request[IO]):IO[Response[IO]]=webRoot match {
    case None=>IO.pure(json(Status.NotFound,Json.Null))
    case Some(root)=>IO.blocking {
      val base=root.toRealPath();val relative=r.uri.path.renderString.stripPrefix("/")
      val target=base.resolve(if(relative.isEmpty) "index.html" else relative).normalize()
      if(!target.startsWith(base)|| !Files.isRegularFile(target)|| !target.toRealPath().startsWith(base)) None else Some(target)
    }.flatMap {
      case None=>IO.pure(json(Status.NotFound,Json.Null))
      case Some(file)=>
        // Fixed account and shared-ui entrypoints cannot use normalized mtime/size as content identity.
        val fixedEntry=Set("account.js","account-client.js","account.css").contains(file.getFileName.toString) || r.uri.path.renderString.startsWith("/ui/")
        StaticFile.fromPath(fs2.io.file.Path.fromNioPath(file),if(fixedEntry)None else Some(r)).getOrElseF(IO.pure(json(Status.NotFound,Json.Null))).map(_.putHeaders(Header.Raw(CIString("Referrer-Policy"),"no-referrer"),Header.Raw(CIString("Cache-Control"),if(file.getFileName.toString.matches("[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\\.(js|css|woff2?|svg|png|jpg|webp)")) "public, max-age=31536000, immutable" else "no-store")))
    }
  }
  private def upgradeRejection(r:Request[IO]):Option[Response[IO]]={
    def reject(status:Status)=Some(failure(Fault("bad-envelope","invalid websocket handshake")).withStatus(status).putHeaders(Header.Raw(CIString("Sec-WebSocket-Version"),"13")))
    val connection=all(r,"Connection").flatMap(_.split(",")).exists(_.trim.equalsIgnoreCase("upgrade"))
    val protocol=all(r,"Upgrade").exists(_.trim.equalsIgnoreCase("websocket"))
    if(!connection || !protocol || r.httpVersion!=HttpVersion.`HTTP/1.1`)reject(Status.UpgradeRequired)
    else {
      val keys=all(r,"Sec-WebSocket-Key")
      val keyValid=keys.size==1 && keys.head.matches("[A-Za-z0-9+/]{22}==") && scala.util.Try {
        val decoded=java.util.Base64.getDecoder.decode(keys.head)
        decoded.length==16 && java.util.Base64.getEncoder.encodeToString(decoded)==keys.head
      }.getOrElse(false)
      if(all(r,"Sec-WebSocket-Version")!=Vector("13") || !keyValid)reject(Status.BadRequest)else None
    }
  }
  private def socket(r:Request[IO],ws:WebSocketBuilder2[IO]):IO[Response[IO]]=IO.defer {
    version(r);val auth=getAuth();val h=headers(r)
    Sessions.validateTransport(auth.config,h)
    if(h.origin.size!=1 || !auth.config.allowedOrigins.contains(h.origin.head)) throw Fault("forbidden","live origin required")
    // Upgrade is performed even for missing/revoked sessions so the browser
    // receives an authoritative 4401 rather than mistaking an outage for logout.
    upgradeRejection(r) match {
      case Some(response)=>IO.pure(response)
      case None=>
        accounts.resolve(h).attempt.flatMap { resolution=>
        val resolved=resolution match {
          case Right(value)=>Option.when(value.cookie)(value)
          case Left(f:Fault) if Set("unauthorized","ambiguous-credentials").contains(f.code)=>None
          case Left(f:AccountFailure) if f.code=="unauthorized"=>None
          case Left(error)=>throw error
        }
        // This service owns nonce validation. The default builder filters Pong
        // frames, which would otherwise close healthy peers after two heartbeats.
        val upgrade=ws.withFilterPingPongs(false).withHeaders(Headers(Header.Raw(CIString("Cache-Control"),"no-store"),Header.Raw(CIString("Referrer-Policy"),"no-referrer")))
          .withOnNonWebSocketRequest(IO.pure(failure(Fault("bad-envelope","websocket upgrade required")).withStatus(Status.UpgradeRequired)))
          .withOnHandshakeFailure(IO.pure(failure(Fault("bad-envelope","invalid websocket handshake")).putHeaders(Header.Raw(CIString("Sec-WebSocket-Version"),"13"))))
        (resolved match {
          case None=>upgrade.build(Stream.emit(WebSocketFrame.Close(4401,"Sign in required").fold(throw _,identity)),_.drain).map(_.putHeaders(Header.Raw(CIString("Cache-Control"),"no-store"),Header.Raw(CIString("Referrer-Policy"),"no-referrer")))
          case Some(a)=>
            Deferred[IO,Option[WebSocketFrame=>IO[Unit]]].flatMap { receiver=>
              val outgoing=Stream.eval(revalidate(r,a)).flatMap { current=>
                Stream.resource(hub.register(current)).flatMap { session=>
                  Stream.eval(liveStreams(session)).flatMap { case(send,receive)=>
                    Stream.eval(receiver.complete(Some(receive))).drain ++ send
                  }
                }
              }.handleErrorWith { error=>
                val code=error match{
                  case f:Fault if Set("unauthorized","ambiguous-credentials","forbidden").contains(f.code)=>4401
                  case _=>1013
                }
                Stream.eval(receiver.complete(None)).drain ++ Stream.emit(WebSocketFrame.Close(code,"haystack").fold(throw _,identity))
              }
              // Resource lifetime is the upgraded stream, not construction of the
              // HTTP response. Failed/non-upgrade handshakes never reserve a slot.
              upgrade.withOnClose(receiver.complete(None).void).build(outgoing,_.evalMap(frame=>receiver.get.flatMap(_.fold(IO.unit)(_(frame)))))
                .map(_.putHeaders(Header.Raw(CIString("Cache-Control"),"no-store"),Header.Raw(CIString("Referrer-Policy"),"no-referrer")))
            }
        }).map(response=>resolution.fold(_=>response,value=>response.withAttribute(authenticatedPrincipal,value.principal)))
    }
    }
  }
  private def liveStreams(session:LiveSession):IO[(Stream[IO,WebSocketFrame],WebSocketFrame=>IO[Unit])]=for {
            nonce<-Ref.of[IO,(scodec.bits.ByteVector,Option[scodec.bits.ByteVector])]((scodec.bits.ByteVector.empty,None))
            pending<-Ref.of[IO,Boolean](false)
            incoming=(frame:WebSocketFrame)=>hub.authorized(session,accounts).flatMap {
              case false=>IO.unit
              case true=>frame match {
                case WebSocketFrame.Text(text,_) if text.getBytes(java.nio.charset.StandardCharsets.UTF_8).length>1024=>hub.close(session,1009)
                case WebSocketFrame.Text(text,true)=>IO.defer {
                  val ping=Wire.decode(api.LiveFrame.codecJson,Wire.parse(text.getBytes(java.nio.charset.StandardCharsets.UTF_8)))
                  if(ping.kind!="ping" || ping.nonce.forall(n=>n.isEmpty||n.length>64) || ping.clientTs.forall(!_.isFinite)) hub.close(session,1007)
                  else hub.send(session,WebSocketFrame.Text(Wire.encode(api.LiveFrame.codecJson,api.LiveFrame("pong",None,None,ping.nonce,ping.clientTs,Some(System.currentTimeMillis().toDouble))).noSpaces))
                }.handleErrorWith(_=>hub.close(session,1007))
                case p:WebSocketFrame.Pong=>nonce.get.flatMap { case(current,previous)=>if(p.data==current || previous.contains(p.data))pending.set(false)else IO.unit }
                case _:WebSocketFrame.Ping=>hub.send(session,WebSocketFrame.Pong())
                case _:WebSocketFrame.Close=>hub.close(session,1000)
                case _=>hub.close(session,1003)
              }
            }
            heartbeat=Stream.awakeEvery[IO](30.seconds).evalMap { _=>
              hub.authorized(session,accounts).flatMap {
                case false=>IO.unit
                case true=>pending.getAndSet(true).flatMap { wasPending=>
                  if(wasPending) hub.close(session,1001) else {
                    val bytes=new Array[Byte](8);new java.security.SecureRandom().nextBytes(bytes)
                    val fresh=scodec.bits.ByteVector(bytes)
                    nonce.update(old=>(fresh,Some(old._1))) *> hub.send(session,WebSocketFrame.Ping(fresh))
                  }
                }
              }
            }.drain
            outgoing=Stream.repeatEval(hub.take(session)).evalMap { frame=>
              if(frame.isInstanceOf[WebSocketFrame.Close]) IO.pure(frame)
              else hub.authorized(session,accounts).map(ok=>if(ok)frame else WebSocketFrame.Close(4401,"Session revoked").fold(throw _,identity))
            }.takeThrough(!_.isInstanceOf[WebSocketFrame.Close]).concurrently(heartbeat)
  } yield (outgoing,incoming)
}
object Http {
  /** How long a request body may take to arrive. */
  private val BodyTimeout=30.seconds
  /** Bucket of requests without a socket peer: they share one client address, which is stricter, never weaker. */
  private val UnknownPeer="unknown"
}
private final class RateLimiter {
  private var buckets=Map.empty[(String,String),(Long,Int)]
  def check(principal:domain.Principal,config:Option[RateLimit]):Unit=config.foreach { c=>synchronized {
    val now=System.currentTimeMillis();val key=principal.userId->principal.tokenId
    buckets=buckets.filter(_._2._1>now)
    val (reset,count)=buckets.getOrElse(key,(now+c.windowMs,0))
    if(count>=c.max) throw Fault("rate-limited","rate limit exceeded")
    buckets+=key->(reset,count+1)
  }}
}
