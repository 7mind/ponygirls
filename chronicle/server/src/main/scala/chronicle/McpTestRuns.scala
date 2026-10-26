package chronicle

import cats.effect.{IO,Ref,Resource,FiberIO,Outcome}
import cats.effect.std.Supervisor
import cats.syntax.all.*
import io.circe.Json
import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.*

trait McpRunAccess {
  /** Invoke after each asynchronous boundary, immediately before authorized source reads. */
  def fresh: IO[Identity]
}
trait McpRunTools {
  def definitions: List[McpRunToolDefinition]
  def invoke(access: McpRunAccess,name: String,arguments: Json,admission: ReadAdmission): IO[Json]
}
trait McpRunClock {
  def now: IO[Instant]
  def monotonic: IO[FiniteDuration]
  def sleep(duration: FiniteDuration): IO[Unit]
}
final class SystemMcpRunClock(wall: java.time.Clock,clock: cats.effect.kernel.Clock[IO]) extends McpRunClock {
  def now: IO[Instant] = IO(wall.instant())
  def monotonic: IO[FiniteDuration] = clock.monotonic
  def sleep(duration: FiniteDuration): IO[Unit] = IO.sleep(duration)
}

enum McpRunState {
  case Queued,Running,Complete,Failed,Cancelled,AuthorizationLost,Expired
  def active: Boolean = this==Queued || this==Running
}
enum McpRunItem {
  case ToolCall(callId: String,tool: String,partIndex: Int,partCount: Int,argumentsJsonPart: String)
  case ToolResult(callId: String,partIndex: Int,partCount: Int,resultJsonPart: String)
  case Response(partIndex: Int,partCount: Int,textPart: String)
  override def toString: String = "McpRunItem(redacted)"
}
final case class McpRunEvent(sequence: Long,observedAt: Instant,item: McpRunItem) {
  override def toString: String = s"McpRunEvent($sequence,redacted)"
}
final case class McpRunFailure(code: String,message: String)
final case class McpRunSnapshot(instanceId: UUID,runId: UUID,state: McpRunState,observedAt: Instant,events: List[McpRunEvent],lastSequence: Long,hasMore: Boolean,failure: Option[McpRunFailure]) {
  override def toString: String = s"McpRunSnapshot($instanceId,$runId,$state,redacted)"
}
final case class McpRunCatalog(instanceId: UUID,model: McpRunModel,tools: List[McpRunToolDefinition])
final case class McpRunKey(instanceId: UUID,runId: UUID)

/** Must measure the complete encoded protocol frame, including Result and ServerEnvelope wrappers. */
trait McpRunPageEncoding {
  def bytes(snapshot: McpRunSnapshot): Long
}

final class McpRunConnection private[chronicle] (private[chronicle] val instanceId: UUID,val connectionId: UUID,private[chronicle] val token: UUID)

private[chronicle] object McpRunCancellation {
  enum Winner { case Work,Deadline }
  def handoff(transition: IO[List[FiberIO[Unit]]],cancel: FiberIO[Unit] => IO[Unit]): IO[Unit] =
    IO.uncancelable(_ => transition.flatMap(_.traverse_(cancel)))
  def race(work: IO[Unit],deadline: IO[Unit])(adopt: (Winner,Outcome[IO,Throwable,Unit],FiberIO[Unit]) => IO[Unit]): IO[Unit] =
    IO.uncancelable { poll => poll(IO.racePair(work,deadline)).flatMap {
      case Left((outcome,timer)) => adopt(Winner.Work,outcome,timer)
      case Right((worker,outcome)) => adopt(Winner.Deadline,outcome,worker)
    }}
}

object McpTestRuns {
  private final case class Binding(owner: String,credentialHash: String,promptDigest: String)
  private final case class Entry(binding: Binding,authority: RunAuthority,connection: UUID,generation: Long,state: McpRunState,started: FiniteDuration,terminalAt: Option[FiniteDuration],events: Vector[McpRunEvent],traceBytes: Long,lastSequence: Long,context: Vector[Json],failure: Option[McpRunFailure],fiber: Option[FiberIO[Unit]],terminalOrder: Long)
  private final case class Registry(instanceId: UUID,entries: Map[McpRunKey,Entry],seen: Set[UUID],connections: Map[UUID,UUID],nextTerminalOrder: Long)
  private val partEnvelopeReserveBytes = 1024
  private val maintenanceInterval = 1.second

  def resource(tools: McpRunTools,model: McpTestModel,authorization: RunAuthorization,clock: McpRunClock,configuredOwners: Set[String],encoding: McpRunPageEncoding,newInstanceId: IO[UUID]): Resource[IO,McpTestRuns] = for {
    _ <- Resource.eval(IO(McpToolModelCodec.catalog(tools.definitions)))
    instance <- Resource.eval(newInstanceId)
    state <- Resource.eval(Ref.of[IO,Registry](Registry(instance,Map.empty,Set.empty,Map.empty,0L)))
    supervisor <- Supervisor[IO](await=false)
    runner = new McpTestRuns(instance,tools,model,authorization,clock,configuredOwners,encoding,state,supervisor,newInstanceId)
    _ <- Resource.make(supervisor.supervise((clock.sleep(maintenanceInterval) *> runner.maintain).foreverM))(_.cancel)
    _ <- Resource.onFinalize(runner.eraseAll)
  } yield runner
}

final class McpTestRuns private (
  componentId: UUID,tools: McpRunTools,model: McpTestModel,authorization: RunAuthorization,
  clock: McpRunClock,configuredOwners: Set[String],encoding: McpRunPageEncoding,
  registry: Ref[IO,McpTestRuns.Registry],supervisor: Supervisor[IO],newInstanceId: IO[UUID]
) {
  import McpTestRuns.*
  private val definitions=tools.definitions

  /** instanceId identifies the current admission registry incarnation, not the process lifetime. */
  def catalog(identity: Identity): IO[McpRunCatalog] = freshCaller(identity) *> registry.get.map(state => McpRunCatalog(state.instanceId,model.metadata,definitions))

  def connection(connectionId: UUID): Resource[IO,McpRunConnection] = Resource.make(IO(UUID.randomUUID()).flatMap { token =>
    registry.modify { state =>
      Check(!state.connections.contains(connectionId),"conflict","connection ID already registered")
      Check(state.connections.size<McpRunLimits.maximumConnections,"mcp-capacity","connection capacity reached")
      state.copy(connections=state.connections.updated(connectionId,token)) -> new McpRunConnection(componentId,connectionId,token)
    }
  })(disconnect)

  private def freshCaller(identity: Identity): IO[RunAuthority] = IO {
    identity.requireBrowser()
    identity.requireScope(chronicle.api.Scope.Read)
    Check(configuredOwners.contains(identity.user.id),"unauthorized","owner is unavailable")
  } *> authorization.capture(identity)

  private def uncertain(): Nothing = throw DomainError("mcp-run-uncertain","run is unknown or no longer retained; original execution cannot be determined")
  private def bound(entry: Entry,identity: Identity): Unit =
    Check(entry.binding.owner==identity.user.id && entry.binding.credentialHash==identity.credentialHash,"mcp-run-uncertain","run is unavailable for this credential")
  private def sameConnection(state: Registry,connection: McpRunConnection): Boolean =
    connection.instanceId==componentId && state.connections.get(connection.connectionId).contains(connection.token)

  def start(identity: Identity,connection: McpRunConnection,instance: UUID,runId: UUID,prompt: String): IO[McpRunSnapshot] = IO.uncancelable { poll =>
    for {
      _ <- IO {
        McpRunJson.scalar(prompt,"invalid")
        Check(prompt.trim.nonEmpty && McpRunJson.bytes(prompt)<=McpRunLimits.maximumPromptBytes,"invalid","invalid prompt size")
        Check(definitions.forall(_.readOnly),"mcp-approval-required","write-capable catalog requires explicit approval and is unavailable")
      }
      authority <- poll(freshCaller(identity))
      candidateInstance <- newInstanceId
      key = McpRunKey(instance,runId)
      now <- clock.monotonic
      wall <- clock.now
      binding = Binding(identity.user.id,identity.credentialHash,Wire.hash(prompt))
      messages = Vector(Json.obj("role"->Json.fromString("system"),"content"->Json.fromString(McpToolModelCodec.system)),Json.obj("role"->Json.fromString("user"),"content"->Json.fromString(prompt)))
      _ <- IO(model.request(messages,definitions))
      admitted <- registry.modify { state =>
        Check(sameConnection(state,connection),"mcp-disconnected","starting connection is closed")
        state.entries.get(key) match {
          case Some(existing) =>
            bound(existing,identity)
            Check(existing.binding==binding,"conflict","run ID is bound to a different prompt")
            if(existing.state==McpRunState.Expired) uncertain()
            state -> false
          case None =>
            if(instance!=state.instanceId || state.seen.contains(runId)) uncertain()
            Check(!state.entries.values.exists(e => e.binding.owner==identity.user.id && e.state.active),"mcp-active-run","owner already has an active run")
            val entry=Entry(binding,authority,connection.token,0L,McpRunState.Queued,now,None,Vector.empty,0L,0L,messages,None,None,0L)
            val seen=state.seen+runId
            val rotate=seen.size>=McpRunLimits.maximumSeenRuns
            Check(!rotate || (candidateInstance!=state.instanceId && !state.entries.keys.exists(_.instanceId==candidateInstance)),"mcp-instance-invariant","instance generator did not return a fresh UUID")
            trim(state.copy(instanceId=if(rotate) candidateInstance else state.instanceId,entries=state.entries.updated(key,entry),seen=if(rotate) Set.empty else seen)) -> true
        }
      }
      _ <- if(!admitted) IO.unit else for {
        fiber <- supervisor.supervise(execute(key,0L).handleErrorWith(error => fail(key,0L,error)))
        keep <- registry.modify { state => state.entries.get(key) match {
          case Some(entry) if entry.generation==0L && entry.state.active => state.copy(entries=state.entries.updated(key,entry.copy(fiber=Some(fiber)))) -> true
          case _ => state -> false
        }}
        _ <- if(keep) IO.unit else supervisor.supervise(fiber.cancel).void
      } yield ()
      result <- observed(identity,key,0L,1,wall)
    } yield result
  }

  private def trim(state: Registry): Registry = {
    val excess=state.entries.toList.filterNot(_._2.state.active).groupBy(_._2.binding.owner).values.flatMap { records =>
      records.sortBy(_._2.terminalOrder).dropRight(McpRunLimits.terminalRecordsPerOwner).map(_._1)
    }.toSet
    state.copy(entries=state.entries -- excess)
  }

  private def execute(key: McpRunKey,generation: Long): IO[Unit] = {
    val work=guard(key,generation) *> update(key,generation)(_.copy(state=McpRunState.Running)) *> rounds(key,generation,0,0,Set.empty)
    def finish(outcome: Outcome[IO,Throwable,Unit]): IO[Unit] = outcome match {
      case Outcome.Succeeded(result) => result
      case Outcome.Errored(error) => IO.raiseError(error)
      case Outcome.Canceled() => terminate(key,generation,McpRunState.Cancelled,None,erase=true)
    }
    for {
      entry <- current(key,generation)
      now <- clock.monotonic
      remaining=(McpRunLimits.deadlineSeconds.seconds-(now-entry.started)).max(Duration.Zero)
      _ <- McpRunCancellation.race(work,clock.sleep(remaining)) { (winner,outcome,loser) => winner match {
        case McpRunCancellation.Winner.Work => supervisor.supervise(loser.cancel).void *> finish(outcome)
        case McpRunCancellation.Winner.Deadline => McpRunCancellation.handoff(
          (finish(outcome) *> expire(key,generation)).as(List(loser)),fiber => supervisor.supervise(fiber.cancel).void)
      }}
    } yield ()
  }

  private def expire(key: McpRunKey,generation: Long): IO[Unit] =
    terminate(key,generation,McpRunState.Expired,Some(McpRunFailure("mcp-deadline","whole-run deadline exceeded; provider processing and cost remain unknown")),erase=true)

  private def rounds(key: McpRunKey,generation: Long,round: Int,callCount: Int,callIds: Set[String]): IO[Unit] = for {
    _ <- IO(Check(round<McpRunLimits.maximumRounds,"mcp-round-limit","model round limit exceeded"))
    _ <- guard(key,generation)
    entry <- current(key,generation)
    request <- IO(model.request(entry.context,definitions))
    reply <- model.complete(entry.binding.owner,request,definitions)
    _ <- guard(key,generation)
    _ <- IO {
      Check(reply.calls.map(_.id).forall(id => !callIds.contains(id)),"model-output","duplicate tool call ID")
      Check(callCount+reply.calls.size<=McpRunLimits.maximumToolCalls,"mcp-call-limit","tool call limit exceeded")
      Check(reply.calls.isEmpty || round+1<McpRunLimits.maximumRounds,"mcp-round-limit","no model round remains for tool results")
    }
    _ <- appendContext(key,generation,reply.assistant)
    _ <- reply.response match {
      case Some(text) => capture(key,generation,text,(part,index,count) => McpRunItem.Response(index,count,part)) *>
        terminate(key,generation,McpRunState.Complete,None,erase=false)
      case None =>
        Check(reply.calls.nonEmpty,"model-output","empty tool reply")
        reply.calls.traverse_ { call =>
          for {
            _ <- guard(key,generation)
            _ <- IO {
              val definition=definitions.find(_.name==call.name).getOrElse(throw DomainError("model-output/unknown-tool","unknown function"))
              Check(definition.readOnly,"mcp-approval-required","write-capable tool requires explicit approval and is unavailable")
              Check(call.arguments.isObject,"model-output","function arguments must be an object")
              McpRunJson.check(call.arguments,McpRunLimits.maximumArgumentBytes,"model-output")
            }
            _ <- capture(key,generation,call.arguments.noSpaces,(part,index,count) => McpRunItem.ToolCall(call.id,call.name,index,count,part))
            admission <- ReadAdmission.limited(McpRunLimits.maximumSourceBytes.toLong)
            access = new McpRunAccess { def fresh: IO[Identity] = guard(key,generation) }
            result <- tools.invoke(access,call.name,call.arguments,admission)
            _ <- guard(key,generation)
            _ <- IO(McpRunJson.check(result,McpRunLimits.maximumResultBytes,"mcp-result-limit"))
            _ <- appendContext(key,generation,Json.obj("role"->Json.fromString("tool"),"tool_call_id"->Json.fromString(call.id),"content"->Json.fromString(result.noSpaces)))
            _ <- capture(key,generation,result.noSpaces,(part,index,count) => McpRunItem.ToolResult(call.id,index,count,part))
          } yield ()
        } *> rounds(key,generation,round+1,callCount+reply.calls.size,callIds ++ reply.calls.map(_.id))
    }
  } yield ()

  private def current(key: McpRunKey,generation: Long): IO[Entry] = registry.get.map { state =>
    val entry=state.entries.getOrElse(key,uncertain())
    Check(entry.generation==generation && entry.state.active,"mcp-stopped","run is no longer active")
    entry
  }
  private def update(key: McpRunKey,generation: Long)(change: Entry => Entry): IO[Unit] = registry.update { state =>
    val entry=state.entries.getOrElse(key,uncertain())
    Check(entry.generation==generation && entry.state.active,"mcp-stopped","run is no longer active")
    state.copy(entries=state.entries.updated(key,change(entry)))
  }
  private def guard(key: McpRunKey,generation: Long): IO[Identity] = for {
    entry <- current(key,generation)
    identity <- authorization.verify(entry.authority).handleErrorWith { error =>
      terminate(key,generation,McpRunState.AuthorizationLost,Some(McpRunFailure("authorization-changed","authorization is no longer current")),erase=true) *> IO.raiseError(error)
    }
    latest <- current(key,generation)
    now <- clock.monotonic
    _ <- if(now-latest.started<McpRunLimits.deadlineSeconds.seconds) IO.unit
      else expire(key,generation) *> IO.raiseError(DomainError("mcp-deadline","whole-run deadline exceeded"))
  } yield identity

  private def appendContext(key: McpRunKey,generation: Long,message: Json): IO[Unit] = guard(key,generation) *> update(key,generation) { entry =>
    val context=entry.context :+ message
    model.request(context,definitions)
    entry.copy(context=context)
  }

  private def failure(error: Throwable): McpRunFailure = error match {
    case error: DomainError =>
      val codes=Set("model-http","model-output","model-output/truncated","model-output/refusal","model-output/unknown-tool","model-timeout","mcp-context-limit","mcp-result-limit","mcp-round-limit","mcp-call-limit","mcp-trace-limit","mcp-page-invariant","mcp-approval-required","read-budget","invalid","not-found")
      McpRunFailure(if(codes.contains(error.code)) error.code else "mcp-tool-failed","one-shot test failed; no automatic retry was performed")
    case _ => McpRunFailure("mcp-test-failed","one-shot test failed; no automatic retry was performed")
  }
  private def isAuthorityError(error: Throwable): Boolean = error match {
    case e: DomainError => Set("unauthorized","forbidden","security-state","authorization-changed").contains(e.code)
    case _ => false
  }
  private def fail(key: McpRunKey,generation: Long,error: Throwable): IO[Unit] =
    if(isAuthorityError(error)) terminate(key,generation,McpRunState.AuthorizationLost,Some(McpRunFailure("authorization-changed","authorization is no longer current")),erase=true)
    else terminate(key,generation,McpRunState.Failed,Some(failure(error)),erase=false)

  private def terminate(key: McpRunKey,generation: Long,state: McpRunState,failure: Option[McpRunFailure],erase: Boolean): IO[Unit] = McpRunCancellation.handoff(clock.monotonic.flatMap { now =>
    registry.modify { registry => registry.entries.get(key) match {
      case Some(entry) if entry.generation==generation && entry.state!=McpRunState.Expired && (entry.state.active || (erase && entry.state!=state)) =>
        val order=Math.addExact(registry.nextTerminalOrder,1L)
        val next=entry.copy(generation=if(erase) entry.generation+1 else entry.generation,state=state,terminalAt=Some(now),events=if(erase) Vector.empty else entry.events,traceBytes=if(erase) 0L else entry.traceBytes,context=Vector.empty,failure=failure,fiber=None,terminalOrder=order)
        trim(registry.copy(entries=registry.entries.updated(key,next),nextTerminalOrder=order)) -> (if(erase) entry.fiber else None)
      case _ => registry -> None
    }}.map(_.toList)
  },fiber => supervisor.supervise(fiber.cancel).void)

  private def snapshot(key: McpRunKey,entry: Entry,wall: Instant,events: List[McpRunEvent],hasMore: Boolean): McpRunSnapshot =
    McpRunSnapshot(key.instanceId,key.runId,entry.state,wall,events,entry.lastSequence,hasMore,entry.failure)

  private def capture(key: McpRunKey,generation: Long,text: String,item: (String,Int,Int) => McpRunItem): IO[Unit] = for {
    _ <- guard(key,generation)
    wall <- clock.now
    _ <- IO(McpRunJson.scalar(text,"mcp-trace-limit"))
    _ <- update(key,generation) { entry =>
      val boundaries=Vector.newBuilder[Int]
      boundaries += 0
      var index=0
      while(index<text.length) { index+=Character.charCount(text.codePointAt(index)); boundaries += index }
      val points=boundaries.result()
      val parts=Vector.newBuilder[String]
      var start=0
      var partCount=0
      while(start<points.size-1 || (text.isEmpty && start==0)) {
        partCount+=1
        Check(entry.events.size+partCount<=McpRunLimits.maximumEvents,"mcp-trace-limit","event count limit exceeded")
        var low=start+1
        var high=points.size-1
        var admitted=start
        if(text.isEmpty) { parts += ""; start=1 }
        else {
          while(low<=high) {
            val mid=low+(high-low)/2
            val event=McpRunEvent(Long.MaxValue,wall,item(text.substring(points(start),points(mid)),Int.MaxValue,Int.MaxValue))
            val size=encoding.bytes(snapshot(key,entry,wall,List(event),true))
            Check(size>=0,"mcp-page-invariant","negative frame size")
            if(size<=McpRunLimits.pageBytes-partEnvelopeReserveBytes) { admitted=mid; low=mid+1 }
            else high=mid-1
          }
          Check(admitted>start,"mcp-page-invariant","a Unicode scalar cannot fit in an event page")
          parts += text.substring(points(start),points(admitted))
          start=admitted
        }
      }
      val values=parts.result()
      val events=values.zipWithIndex.map { case (part,i) => McpRunEvent(entry.lastSequence+i+1,wall,item(part,i,values.size)) }
      Check(entry.events.size+events.size<=McpRunLimits.maximumEvents,"mcp-trace-limit","event count limit exceeded")
      val bytes=events.foldLeft(0L) { (total,event) =>
        val size=encoding.bytes(snapshot(key,entry,wall,List(event),false))
        Check(size>=0 && size<=McpRunLimits.pageBytes,"mcp-page-invariant","event envelope exceeds page limit")
        Math.addExact(total,size)
      }
      Check(bytes<=McpRunLimits.maximumTraceBytes-entry.traceBytes,"mcp-trace-limit","trace byte limit exceeded")
      entry.copy(events=entry.events ++ events,traceBytes=entry.traceBytes+bytes,lastSequence=entry.lastSequence+events.size)
    }
  } yield ()

  private def erase(key: McpRunKey,generation: Long,state: McpRunState,reason: Option[McpRunFailure]): IO[Unit] =
    terminate(key,generation,state,reason,erase=true)

  private def disconnect(connection: McpRunConnection): IO[Unit] = McpRunCancellation.handoff(for {
    now <- clock.monotonic
    fibers <- registry.modify { state =>
      val matches=state.entries.filter { case (_,entry) => entry.connection==connection.token && (entry.state.active || entry.state==McpRunState.Complete || entry.state==McpRunState.Failed) }
      val entries=state.entries ++ matches.toList.zipWithIndex.map { case ((id,entry),index) => id -> entry.copy(generation=entry.generation+1,state=McpRunState.Cancelled,terminalAt=Some(now),events=Vector.empty,traceBytes=0L,context=Vector.empty,failure=None,fiber=None,terminalOrder=Math.addExact(state.nextTerminalOrder,index.toLong+1)) }
      trim(state.copy(entries=entries,nextTerminalOrder=Math.addExact(state.nextTerminalOrder,matches.size.toLong),connections=state.connections.filterNot { case (id,token) => id==connection.connectionId && token==connection.token })) -> matches.values.flatMap(_.fiber).toList
    }
  } yield fibers,fiber => supervisor.supervise(fiber.cancel).void)

  def read(identity: Identity,instance: UUID,runId: UUID,afterSequence: Long,limit: Int): IO[McpRunSnapshot] = for {
    _ <- IO {
      Check(afterSequence>=0 && limit>=1 && limit<=McpRunLimits.maximumReadEvents,"invalid","invalid event page bounds")
    }
    _ <- freshCaller(identity).handleErrorWith(error => eraseCredential(identity,error) *> IO.raiseError(error))
    wall <- clock.now
    result <- observed(identity,McpRunKey(instance,runId),afterSequence,limit,wall)
  } yield result

  private def observed(identity: Identity,key: McpRunKey,afterSequence: Long,limit: Int,wall: Instant): IO[McpRunSnapshot] = for {
    entry <- registry.get.map(_.entries.getOrElse(key,uncertain()))
    _ <- IO(bound(entry,identity))
    _ <- authorization.verify(entry.authority).handleErrorWith { error =>
      erase(key,entry.generation,McpRunState.AuthorizationLost,Some(McpRunFailure("authorization-changed","authorization is no longer current"))) *> IO.raiseError(error)
    }
    result <- registry.get.map { state =>
      val latest=state.entries.getOrElse(key,uncertain())
      bound(latest,identity)
      Check(latest.generation==entry.generation,"mcp-run-changed","run changed while authorization was checked; read again")
      Check(afterSequence<=latest.lastSequence,"invalid","event cursor is in the future")
      val candidates=latest.events.filter(_.sequence>afterSequence)
      var page=List.empty[McpRunEvent]
      var count=0
      var fits=true
      while(count<candidates.size && count<limit && fits) {
        val next=page :+ candidates(count)
        val bytes=encoding.bytes(snapshot(key,latest,wall,next,count+1<candidates.size))
        Check(bytes>=0,"mcp-page-invariant","negative frame size")
        if(bytes<=McpRunLimits.pageBytes) { page=next; count+=1 }
        else fits=false
      }
      Check(candidates.isEmpty || page.nonEmpty,"mcp-page-invariant","first event cannot fit in a page")
      val result=snapshot(key,latest,wall,page,count<candidates.size)
      val bytes=encoding.bytes(result)
      Check(bytes>=0 && bytes<=McpRunLimits.pageBytes,"mcp-page-invariant","snapshot envelope exceeds page limit")
      result
    }
  } yield result

  def cancel(identity: Identity,instance: UUID,runId: UUID): IO[McpRunSnapshot] = {
    val key=McpRunKey(instance,runId)
    for {
    _ <- freshCaller(identity).handleErrorWith(error => eraseCredential(identity,error) *> IO.raiseError(error))
    entry <- registry.get.map(_.entries.getOrElse(key,uncertain()))
    _ <- IO(bound(entry,identity))
    _ <- authorization.verify(entry.authority).handleErrorWith { error => erase(key,entry.generation,McpRunState.AuthorizationLost,Some(McpRunFailure("authorization-changed","authorization is no longer current"))) *> IO.raiseError(error) }
    _ <- erase(key,entry.generation,McpRunState.Cancelled,None)
    wall <- clock.now
    result <- observed(identity,key,0L,1,wall)
    } yield result
  }

  private def eraseCredential(identity: Identity,error: Throwable): IO[Unit] =
    if(!isAuthorityError(error)) IO.unit else registry.get.flatMap { state =>
      state.entries.toList.filter { case (_,entry) => entry.binding.owner==identity.user.id && entry.binding.credentialHash==identity.credentialHash }
        .traverse_ { case (id,entry) => erase(id,entry.generation,McpRunState.AuthorizationLost,Some(McpRunFailure("authorization-changed","authorization is no longer current"))) }
    }

  /** Also exposed for deterministic maintenance/clock tests; no provider requests are issued. */
  def maintain: IO[Unit] = for {
    now <- clock.monotonic
    entries <- registry.get.map(_.entries.toList)
    _ <- entries.traverse_ { case (id,entry) =>
      if(entry.state==McpRunState.Expired) IO.unit
      else if(entry.terminalAt.exists(time => now-time>=McpRunLimits.retentionSeconds.seconds))
        erase(id,entry.generation,McpRunState.Expired,Some(McpRunFailure("mcp-expired","run retention expired; original execution cannot be determined")))
      else if(entry.state.active && now-entry.started>=McpRunLimits.deadlineSeconds.seconds)
        erase(id,entry.generation,McpRunState.Expired,Some(McpRunFailure("mcp-deadline","whole-run deadline exceeded; provider processing and cost remain unknown")))
      else authorization.verify(entry.authority).attempt.flatMap {
        case Right(_) => IO.unit
        case Left(_) => erase(id,entry.generation,McpRunState.AuthorizationLost,Some(McpRunFailure("authorization-changed","authorization is no longer current")))
      }
    }
  } yield ()

  private def eraseAll: IO[Unit] = McpRunCancellation.handoff(
    registry.getAndSet(Registry(componentId,Map.empty,Set.empty,Map.empty,0L)).map(_.entries.values.toList.flatMap(_.fiber)),
    fiber => supervisor.supervise(fiber.cancel).void)
}
