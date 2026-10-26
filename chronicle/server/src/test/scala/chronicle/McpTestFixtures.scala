package chronicle

import cats.effect.{IO,Ref,Deferred}
import cats.syntax.all.*
import chronicle.api.{Scope,UserInfo}
import io.circe.Json
import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.*

object McpTestFixtures {
  val schema: Json = Json.obj("type"->Json.fromString("object"),"properties"->Json.obj(),"additionalProperties"->Json.False)
  val definitions: List[McpRunToolDefinition] = List(
    McpRunToolDefinition("search","synthetic search",schema.mapObject(_.add("properties",Json.obj("q"->Json.obj("type"->Json.fromString("string"))))),true),
    McpRunToolDefinition("read","synthetic read",schema.mapObject(_.add("properties",Json.obj("sessionId"->Json.obj("type"->Json.fromString("string")))).add("required",Json.arr(Json.fromString("sessionId")))),true))
  val identity: Identity = Identity(UserInfo("a","a",List(Scope.Read)),true,"cookie-a")
  val otherCookie: Identity = identity.copy(credentialHash="another-cookie-a")
  val otherOwner: Identity = Identity(UserInfo("b","b",List(Scope.Read)),true,"cookie-b")
  def config: ModelConfig = ModelConfig("http://127.0.0.1:1/chat","approved-model","pinned-revision","unused",900,4*1024*1024,AnnotationRequestPolicy.GlmMaxReasoning)
  def finalReply(text: String): Json = Json.obj("choices"->Json.arr(Json.obj("finish_reason"->Json.fromString("stop"),"message"->Json.obj("role"->Json.fromString("assistant"),"content"->Json.fromString(text)))))
  def toolReply(calls: List[(String,String,Json)],reasoning: Option[String]): Json = {
    val fields=List("role"->Json.fromString("assistant"),"content"->Json.Null,"tool_calls"->Json.arr(calls.map { case (id,name,args) => Json.obj("id"->Json.fromString(id),"type"->Json.fromString("function"),"function"->Json.obj("name"->Json.fromString(name),"arguments"->Json.fromString(args.noSpaces))) }*)) ++ reasoning.map(text => "reasoning_content"->Json.fromString(text))
    Json.obj("choices"->Json.arr(Json.obj("finish_reason"->Json.fromString("tool_calls"),"message"->Json.obj(fields*))))
  }

  final case class Sleep(deadline: FiniteDuration,id: UUID,gate: Deferred[IO,Unit])
  final case class ClockState(elapsed: FiniteDuration,sleepers: List[Sleep])
  final class ManualClock(state: Ref[IO,ClockState]) extends McpRunClock {
    def now: IO[Instant] = monotonic.map(time => Instant.parse("2026-01-01T00:00:00Z").plusNanos(time.toNanos))
    def monotonic: IO[FiniteDuration] = state.get.map(_.elapsed)
    def sleep(duration: FiniteDuration): IO[Unit] = for {
      gate <- Deferred[IO,Unit]
      id <- IO(UUID.randomUUID())
      _ <- state.update(s => s.copy(sleepers=Sleep(s.elapsed+duration,id,gate)::s.sleepers))
      _ <- gate.get.guarantee(state.update(s => s.copy(sleepers=s.sleepers.filterNot(_.id==id))))
    } yield ()
    def advance(duration: FiniteDuration): IO[Unit] = state.modify { s =>
      val now=s.elapsed+duration
      val (due,remaining)=s.sleepers.partition(_.deadline<=now)
      ClockState(now,remaining) -> due
    }.flatMap(_.traverse_(_.gate.complete(()).void))
  }
  def clock: IO[ManualClock] = Ref.of[IO,ClockState](ClockState(Duration.Zero,Nil)).map(new ManualClock(_))

  final case class AuthState(revision: Long,enabled: Boolean,expired: Boolean)
  final class ManualAuthorization(state: Ref[IO,AuthState],captureHook: Ref[IO,IO[Unit]],verifyHook: Ref[IO,Option[(Deferred[IO,Unit],Deferred[IO,Unit])]]) extends RunAuthorization {
    def capture(identity: Identity): IO[RunAuthority] = captureHook.get.flatten *> state.get.map { state =>
      Check(state.enabled && !state.expired,"unauthorized","synthetic cookie unavailable")
      RunAuthority(identity,state.revision)
    }
    def verify(authority: RunAuthority): IO[Identity] = for {
      current <- state.get
      hook <- verifyHook.getAndSet(None)
      _ <- hook.traverse_ { case (entered,release) => entered.complete(()).void *> release.get }
      _ <- IO {
        Check(current.enabled && !current.expired,"unauthorized","synthetic cookie unavailable")
        Check(current.revision==authority.revision,"authorization-changed","synthetic authority changed")
      }
    } yield authority.identity
    def revision(value: Long): IO[Unit] = state.update(_.copy(revision=value))
    def enabled(value: Boolean): IO[Unit] = state.update(_.copy(enabled=value))
    def expired: IO[Unit] = state.update(_.copy(expired=true))
    def captureWait(effect: IO[Unit]): IO[Unit] = captureHook.set(effect)
    def nextVerifyWait(entered: Deferred[IO,Unit],release: Deferred[IO,Unit]): IO[Unit] = verifyHook.set(Some(entered -> release))
  }
  def authorization: IO[ManualAuthorization] = for {
    state <- Ref.of[IO,AuthState](AuthState(1L,true,false))
    capture <- Ref.of[IO,IO[Unit]](IO.unit)
    verify <- Ref.of[IO,Option[(Deferred[IO,Unit],Deferred[IO,Unit])]](None)
  } yield new ManualAuthorization(state,capture,verify)

  final class BehavioralModel(val requests: Ref[IO,Vector[Json]],respond: Json => IO[Json]) extends McpTestModel {
    val metadata: McpRunModel = McpToolModelCodec.metadata(config)
    def request(messages: Vector[Json],tools: List[McpRunToolDefinition]): Json = McpToolModelCodec.request(config,messages,tools)
    def complete(owner: String,request: Json,tools: List[McpRunToolDefinition]): IO[McpModelReply] = requests.update(_ :+ request) *> respond(request).map(McpToolModelCodec.reply(_,tools))
  }
  def model(respond: Json => IO[Json]): IO[BehavioralModel] = Ref.of[IO,Vector[Json]](Vector.empty).map(new BehavioralModel(_,respond))

  final class BehavioralTools(val definitions: List[McpRunToolDefinition],val calls: Ref[IO,Vector[(String,Json)]],run: (McpRunAccess,String,Json,ReadAdmission) => IO[Json]) extends McpRunTools {
    def invoke(access: McpRunAccess,name: String,arguments: Json,admission: ReadAdmission): IO[Json] = calls.update(_ :+ (name -> arguments)) *> run(access,name,arguments,admission)
  }
  def tools(run: (McpRunAccess,String,Json,ReadAdmission) => IO[Json]): IO[BehavioralTools] =
    Ref.of[IO,Vector[(String,Json)]](Vector.empty).map(new BehavioralTools(definitions,_,run))
  def ordinaryTools: IO[BehavioralTools] = tools { (access,name,args,admission) => access.fresh *> IO {
    admission.consume(16L)
    if(name=="search") Json.obj("sessionId"->Json.fromString("found-synthetic-id"))
    else {
      Check(args.hcursor.get[String]("sessionId").toOption.contains("found-synthetic-id"),"not-found","synthetic session not found")
      Json.obj("text"->Json.fromString("source-grounded synthetic answer"))
    }
  }}

  val encoding: McpRunPageEncoding = new McpRunPageEncoding {
    def bytes(snapshot: McpRunSnapshot): Long = McpRunJson.bytes(frame(snapshot).noSpaces).toLong
  }
  def frame(snapshot: McpRunSnapshot): Json = {
    def text(value: String): Json = Json.fromString(value)
    def number(value: Int): Json = Json.fromInt(value)
    def item(value: McpRunItem): Json = value match {
      case McpRunItem.ToolCall(id,name,index,count,part) => Json.obj("ToolCall"->Json.obj("callId"->text(id),"tool"->text(name),"partIndex"->number(index),"partCount"->number(count),"argumentsJsonPart"->text(part)))
      case McpRunItem.ToolResult(id,index,count,part) => Json.obj("ToolResult"->Json.obj("callId"->text(id),"partIndex"->number(index),"partCount"->number(count),"resultJsonPart"->text(part)))
      case McpRunItem.Response(index,count,part) => Json.obj("Response"->Json.obj("partIndex"->number(index),"partCount"->number(count),"textPart"->text(part)))
    }
    Json.obj("frame"->Json.obj("version"->text("1.4.0"),"payload"->Json.obj("requestId"->text("ffffffff-ffff-ffff-ffff-ffffffffffff"),"result"->Json.obj("McpTestRun"->Json.obj("result"->Json.obj(
      "instanceId"->text(snapshot.instanceId.toString),"runId"->text(snapshot.runId.toString),"state"->text(snapshot.state.toString),"observedAt"->text(snapshot.observedAt.toString),
      "events"->Json.arr(snapshot.events.map(e => Json.obj("sequence"->Json.fromLong(e.sequence),"observedAt"->text(e.observedAt.toString),"item"->item(e.item)))*),
      "lastSequence"->Json.fromLong(snapshot.lastSequence),"hasMore"->Json.fromBoolean(snapshot.hasMore),"failure"->snapshot.failure.fold(Json.Null)(f => Json.obj("code"->text(f.code),"message"->text(f.message)))
    ))))))
  }

  def await[A](value: IO[A])(accept: A => Boolean): IO[A] = {
    def loop(remaining: Int): IO[A] = value.flatMap { result =>
      if(accept(result)) IO.pure(result)
      else if(remaining==0) IO.raiseError(new AssertionError("condition did not become true"))
      else IO.sleep(2.millis) *> loop(remaining-1)
    }
    loop(2500)
  }
  def settled(runner: McpTestRuns,identity: Identity,instance: UUID,id: UUID): IO[McpRunSnapshot] =
    await(runner.read(identity,instance,id,0L,256).attempt.flatMap {
      case Left(error: DomainError) if error.code=="mcp-run-changed" => IO.pure(Left(error))
      case Left(error) => IO.raiseError(error)
      case Right(snapshot) => IO.pure(Right(snapshot))
    })(_.exists(snapshot => !snapshot.state.active)).flatMap(IO.fromEither)
}
