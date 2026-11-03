package haystack.http

import cats.effect.{IO,Ref}
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
import io.circe.Json
import scala.concurrent.duration.*
import java.nio.file.{Files,Path}

/** Transport owns credentials and bounded decoding only. All mutation and
  * search semantics live in the application/repository shared with MCP. */
final class Http(getAuth:()=>Auth,service:ItemService,hub:LiveHub,webRoot:Option[Path],retrieval:haystack.retrieval.HaystackRetrieval) {
  private val limiter=new RateLimiter
  private def all(r:Request[IO],name:String):Vector[String]=r.headers.headers.filter(_.name==CIString(name)).map(_.value).toVector
  private def headers(r:Request[IO]):RequestHeaders=RequestHeaders(all(r,"Host").headOption.getOrElse(""),all(r,"Authorization"),all(r,"Cookie"),all(r,"Origin"),all(r,"Sec-Fetch-Site").headOption)
  private def json(status:Status,value:Json):Response[IO]=Response[IO](status).withEntity(value.noSpaces).putHeaders(Header.Raw(CIString("Content-Type"),"application/json"),Header.Raw(CIString("Cache-Control"),"no-store"),Header.Raw(CIString("Referrer-Policy"),"no-referrer"))
  private def ok[A](codec:baboon.runtime.shared.BaboonJsonCodec[A],value:A):Response[IO]=json(Status.Ok,Wire.encode(codec,value))
  private def body(r:Request[IO]):IO[Json]=IO {
    if(r.uri.query.nonEmpty) throw Fault("bad-envelope","query parameters are not supported")
    if(!r.contentType.exists(_.mediaType==MediaType.application.json)) throw Fault("bad-envelope","application/json required")
    if(r.contentLength.exists(_>Wire.envelopeLimits.maxBytes)) throw Fault("too-large","body too large")
  } *> r.body.take(Wire.envelopeLimits.maxBytes.toLong+1).compile.to(Array).timeout(30.seconds).map { bytes =>
    if(bytes.length>Wire.envelopeLimits.maxBytes) throw Fault("too-large","body too large")
    Wire.parse(bytes)
  }
  private def version(r:Request[IO]):Unit={
    val offered=all(r,"X-Haystack-Version")
    if(offered.size>1 || offered.exists(_!=Wire.versions.current)) throw Fault("version-mismatch","unsupported API version")
    if(all(r,"Host").size!=1) throw Fault("forbidden","ambiguous host")
    if(r.uri.query.nonEmpty) throw Fault("bad-envelope","query parameters are not supported")
  }
  private def authed(r:Request[IO],mutate:Boolean=false)(f:Authenticated=>IO[Response[IO]]):IO[Response[IO]]=IO.defer {
    version(r)
    val auth=getAuth(); val resolved=Sessions.resolve(auth,headers(r),mutate)
    limiter.check(resolved.principal,auth.config.rateLimit)
    f(resolved).attempt.map { outcome =>
      val response=outcome.fold(failure,identity)
      if(resolved.cookie) response.putHeaders(Header.Raw(CIString("Set-Cookie"),Sessions.serialize(Some(resolved.token),resolved.secureCookie))) else response
    }
  }
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
      case f:Fault if f.code=="config"=>("unavailable",List.empty[api.Span],None)
      case f:Fault=>(f.code,List.empty[api.Span],f.currentRevision.map(_.toInt))
      case _:ponygirls.retrieval.RetrievalError=>("unavailable",List.empty[api.Span],None)
      case q:haystack.query.InvalidQuery=>("invalid-query",q.diagnostics.map(d=>api.Span(d.message,d.span.start,d.span.end)).toList,None)
      case _:haystack.query.InvalidCursor=>("invalid-cursor",List.empty[api.Span],None)
      case _=>("unavailable",List.empty[api.Span],None)
    }
    // Never send raw exception text (SQL, paths, submitted documents, secrets).
    json(status(code),Wire.encode(api.Failure.codecJson,api.Failure(code,code.replace('-',' '),spans,current)))
  }
  private def handled(operation: =>IO[Response[IO]]):IO[Response[IO]]=IO.defer(operation).handleError(e=>failure(e))
  def routes(ws:WebSocketBuilder2[IO]):HttpRoutes[IO]={
    val core=HttpRoutes.of[IO] {
    case GET -> Root / "api" / "versions" =>IO.pure(ok(api.VersionInfo.codecJson,Wire.versions))
    case GET -> Root / "api" / "v1" / "health" =>IO.pure(ok(api.Ack.codecJson,api.Ack(true)))
    case r @ POST -> Root / "api" / "v1" / "login" =>handled {
      IO {version(r);Sessions.validateTransport(getAuth().config,headers(r));Sessions.csrf(getAuth().config,headers(r))} *> body(r).flatMap { raw =>
        val input=Wire.decode(api.LoginRequest.codecJson,raw); val auth=getAuth()
        val principal=auth.authenticate(input.token).getOrElse(throw Fault("unauthorized","invalid credentials"))
        val old=Sessions.cookie(headers(r),Sessions.name(Sessions.secure(auth.config,headers(r))))
        old.traverse_(hub.endSession) *> IO.pure(ok(api.LoginResult.codecJson,api.LoginResult(Wire.identity(principal,auth.config.activityProjectId),Wire.versions)).putHeaders(Header.Raw(CIString("Set-Cookie"),Sessions.serialize(Some(input.token),Sessions.secure(auth.config,headers(r))))))
      }
    }
    case r @ POST -> Root / "api" / "v1" / "logout" =>handled {authed(r,true) { a=>
      hub.endSession(a.token).as(ok(api.Ack.codecJson,api.Ack(true)))
    }.map(_.putHeaders(Header.Raw(CIString("Set-Cookie"),Sessions.serialize(None,Sessions.secure(getAuth().config,headers(r))))))}
    case r @ GET -> Root / "api" / "v1" / "whoami" =>handled {authed(r) { a=>IO.pure(ok(api.Identity.codecJson,Wire.identity(a.principal,getAuth().config.activityProjectId))) }}
    case r @ POST -> Root / "api" / "v1" / "get" =>handled {authed(r) { _=>body(r).flatMap { raw=>
      val input=Wire.decode(api.GetRequest.codecJson,raw)
      service.get(input.key,input.revision.map(_.toLong)).map(item=>ok(api.Item.codecJson,Wire.item(item)))
    }}}
    case r @ POST -> Root / "api" / "v1" / "put" =>handled {authed(r,true) { a=>body(r).flatMap { raw=>
      val input=Wire.decode(api.PutRequest.codecJson,raw)
      service.put(input.key,input.document.json,input.expectedRevision,input.requestId.toString,a.principal).map(result=>ok(api.PutResult.codecJson,api.PutResult(input.key,result.revision.toInt,Wire.metadata(result.metadata),result.replayed)))
    }}}
    case r @ POST -> Root / "api" / "v1" / "search" =>handled {authed(r) { _=>body(r).flatMap { raw=>
      val input=Wire.decode(api.SearchRequest.codecJson,raw)
      service.search(SearchInput(input.query,input.project,input.limit,input.cursor,SearchSort(input.sort.field,input.sort.direction))).map(result=>ok(api.SearchResult.codecJson,api.SearchResult(result.items.map(Wire.summary).toList,result.cursor)))
    }}}
    case r @ POST -> Root / "api" / "v1" / "retrieve" =>handled {authed(r) { a=>body(r).flatMap { raw=>
      val input=Wire.decode(api.RetrieveRequest.codecJson,raw)
      val mode=input.mode match {
        case api.RetrievalMode.Lexical=>ponygirls.retrieval.RetrievalMode.Lexical
        case api.RetrievalMode.Semantic=>ponygirls.retrieval.RetrievalMode.Semantic
        case api.RetrievalMode.Hybrid=>ponygirls.retrieval.RetrievalMode.Hybrid
      }
      retrieval.search(input.query,mode,input.project,input.includeArchived,input.offset,input.limit).map { page=>
        if(!getAuth().authenticate(a.token).contains(a.principal)) throw Fault("unauthorized","session revoked")
        val sources=page.hits.map { hit=>
          val revision=hit.version.takeWhile(_!='/').toInt
          val publishedPolicy=hit.version.dropWhile(_!='/').drop(1)
          if(!publishedPolicy.matches("[0-9a-f]{64}")) throw Fault("unavailable","invalid published projection identity")
          if(mode!=ponygirls.retrieval.RetrievalMode.Lexical && (!hit.profile.contains(retrieval.store.profile.get.id) || !hit.embeddingSpace.contains(retrieval.store.profile.get.space.id) || publishedPolicy!=retrieval.policy.id)) throw Fault("unavailable","incompatible published profile")
          api.RetrievedSource(hit.id,revision,hit.chunk.provenance.pointer.getOrElse(""),hit.chunk.text,hit.score,hit.generation,hit.profile,hit.embeddingSpace,publishedPolicy,hit.chunk.provenance.field,hit.chunk.provenance.start,hit.chunk.provenance.end)
        }
        ok(api.RetrieveResult.codecJson,api.RetrieveResult(sources,input.mode,page.countScope.toString,page.total,page.rankingLimit))
      }
    }}}
    case r @ POST -> Root / "api" / "v1" / "history" =>handled {authed(r) { _=>body(r).flatMap { raw=>
      val input=Wire.decode(api.HistoryRequest.codecJson,raw)
      service.history(input.key).map(revisions=>ok(api.HistoryResult.codecJson,api.HistoryResult(revisions.map(v=>api.RevisionInfo(v.revision.toInt,v.modifiedAt.toString,v.modifiedBy,v.tokenId)).toList)))
    }}}
    case r @ POST -> Root / "api" / "v1" / "query" / "analyze" =>handled {authed(r) { _=>body(r).map { raw=>
      val input=Wire.decode(api.QueryRequest.codecJson,raw); val diagnostics=Search.analyze(input.query)
      ok(api.AnalyzeResult.codecJson,api.AnalyzeResult(diagnostics.isEmpty,diagnostics.map(d=>api.Span(d.message,d.span.start,d.span.end)).toList))
    }}}
    case r @ POST -> Root / "api" / "v1" / "complete" =>handled {authed(r) { _=>body(r).flatMap { raw=>
      val input=Wire.decode(api.QueryRequest.codecJson,raw)
      if(input.query.length>Query.MaxChars) throw new InvalidQuery(Vector(QueryDiagnostic(s"query exceeds ${Query.MaxChars} characters",Span(0,input.query.length))))
      if(input.caret<0 || input.caret>input.query.length ||
          input.caret>0 && input.caret<input.query.length && Character.isHighSurrogate(input.query.charAt(input.caret-1)) && Character.isLowSurrogate(input.query.charAt(input.caret)))
        throw Fault("bad-envelope","invalid caret")
      service.complete(input.query.take(input.caret).split("\\s+").lastOption.getOrElse("")).map(values=>ok(api.CompletionResult.codecJson,api.CompletionResult(values.toList)))
    }}}
    case r @ POST -> Root / "api" / "v1" / "values" =>handled {authed(r) { _=>body(r).flatMap(raw=>service.values(Wire.decode(api.ValuesRequest.codecJson,raw).field)).map(values=>ok(api.ValuesResult.codecJson,api.ValuesResult(values.toList))) }}
    case r @ GET -> Root / "api" / "v1" / "live" =>handled {socket(r,ws)}
    case r @ POST -> Root / "mcp" =>IO.defer {
      IO {version(r);val auth=getAuth();val a=Sessions.resolve(auth,headers(r),mcp=true);limiter.check(a.principal,auth.config.rateLimit);a}.flatMap { a=>
        val accept=all(r,"Accept").mkString(",")
        if(!accept.contains("application/json") || !accept.contains("text/event-stream")) throw Fault("bad-envelope","unsupported accept")
        if(all(r,"MCP-Protocol-Version").exists(_!="2025-11-25")) throw Fault("bad-envelope","unsupported MCP version")
        body(r).flatMap(raw=>new Mcp(service).handle(a.principal,raw)).map(_.fold(json(Status.Accepted,Json.Null))(json(Status.Ok,_)))
      }
    }.handleError { error=>
      val code=error match{case f:Fault=>f.code;case _=>"unavailable"}
      json(status(code),Json.obj("jsonrpc"->Json.fromString("2.0"),"id"->Json.Null,"error"->Json.obj("code"->Json.fromInt(if(code=="unauthorized"||code=="ambiguous-credentials") -32001 else -32000),"message"->Json.fromString(code))))
    }
    case r if r.uri.path.renderString=="/mcp"=>IO.pure(json(Status.MethodNotAllowed,Json.Null).putHeaders(Header.Raw(CIString("Allow"),"POST")))
    case r if r.method==Method.GET && !r.uri.path.renderString.startsWith("/api/")=>handled(static(r))
    case r if r.uri.path.renderString.startsWith("/api/")=>IO.pure(failure(Fault("not-found","unknown API operation")))
  }
    cats.data.Kleisli { request=>
      val start=System.nanoTime()
      core(request).semiflatMap { response=>
        val path=request.uri.path.renderString
        val label=if(path=="/mcp") "mcp" else if(path.startsWith("/api/")) path.split("/").lastOption.filter(Set("login","logout","whoami","get","put","search","history","analyze","complete","values","live","retrieve","health","versions")).getOrElse("unknown") else "static"
        val principal=scala.util.Try(Sessions.resolve(getAuth(),headers(request),mcp=label=="mcp")).toOption.map(_.principal)
        val event=Json.obj("requestId"->Json.fromString(java.util.UUID.randomUUID().toString),"route"->Json.fromString(label),"status"->Json.fromInt(response.status.code),"result"->Json.fromString(if(response.status.isSuccess) "ok" else "fault"),"durationMs"->Json.fromLong((System.nanoTime()-start)/1000000)).deepMerge(principal.fold(Json.obj())(p=>Json.obj("userId"->Json.fromString(p.userId),"tokenId"->Json.fromString(p.tokenId))))
        IO.println(event.noSpaces).as(response)
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
      case Some(file)=>StaticFile.fromPath(fs2.io.file.Path.fromNioPath(file),Some(r)).getOrElseF(IO.pure(json(Status.NotFound,Json.Null))).map(_.putHeaders(Header.Raw(CIString("Referrer-Policy"),"no-referrer"),Header.Raw(CIString("Cache-Control"),if(file.getFileName.toString.matches("[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\\.(js|css|woff2?|svg|png|jpg|webp)")) "public, max-age=31536000, immutable" else "no-store")))
    }
  }
  private def socket(r:Request[IO],ws:WebSocketBuilder2[IO]):IO[Response[IO]]=IO.defer {
    version(r);val auth=getAuth();val h=headers(r)
    Sessions.validateTransport(auth.config,h)
    if(h.origin.size!=1 || !auth.config.allowedOrigins.contains(h.origin.head)) throw Fault("forbidden","live origin required")
    // Upgrade is performed even for missing/revoked sessions so the browser
    // receives an authoritative 4401 rather than mistaking an outage for logout.
    val resolved=scala.util.Try(Sessions.resolve(auth,h)).toOption.filter(_.cookie)
    resolved match {
      case None=>ws.build(Stream.emit(WebSocketFrame.Close(4401,"Sign in required").fold(throw _,identity)),_.drain)
      case Some(a)=>
        hub.register(a).allocated.attempt.flatMap {
          case Left(f:Fault) if f.code=="rate-limited"=>ws.build(Stream.emit(WebSocketFrame.Close(1013,"Too many live connections").fold(throw _,identity)),_.drain)
          case Left(error)=>IO.raiseError(error)
          case Right((session,release))=>
          for {
            nonce<-Ref.of[IO,(scodec.bits.ByteVector,Option[scodec.bits.ByteVector])]((scodec.bits.ByteVector.empty,None))
            pending<-Ref.of[IO,Boolean](false)
            incoming=(frame:WebSocketFrame)=>hub.authorized(session,getAuth()).flatMap {
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
              hub.authorized(session,getAuth()).flatMap {
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
              else hub.authorized(session,getAuth()).map(ok=>if(ok)frame else WebSocketFrame.Close(4401,"Session revoked").fold(throw _,identity))
            }.takeThrough(!_.isInstanceOf[WebSocketFrame.Close]).concurrently(heartbeat)
            response<-ws.withOnClose(release).build(outgoing,_.evalMap(incoming))
          } yield response
        }
    }
  }
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
