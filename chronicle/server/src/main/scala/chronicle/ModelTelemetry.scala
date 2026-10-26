package chronicle

import cats.effect.{IO,Ref}
import cats.effect.kernel.Clock
import cats.syntax.all.*
import io.circe.Json
import java.time.{Clock as JavaClock,Instant}

// These purposes identify local callers, not provider models or physical GPU work.
enum ModelWorkload(val hasOutput: Boolean) {
  case IndexAnnotation extends ModelWorkload(true)
  case IndexEmbedding extends ModelWorkload(false)
  case QueryEmbedding extends ModelWorkload(false)
  case McpTest extends ModelWorkload(true)
}
final case class ModelCallContext(ownerId: String,purpose: ModelWorkload)
enum ModelCallOutcome { case Complete,Failed,Cancelled }

final case class ModelTelemetryTime(monotonicNanos: Long,wallClock: Instant)
trait ModelTelemetryClock { def read: IO[ModelTelemetryTime] }
final class JavaModelTelemetryClock(wallClock: JavaClock,monotonicClock: Clock[IO]) extends ModelTelemetryClock {
  def read: IO[ModelTelemetryTime] = monotonicClock.monotonic.flatMap(time => IO(ModelTelemetryTime(time.toNanos,wallClock.instant())))
}

final case class ProviderUsage private (input: Option[Long],output: Option[Long],reasoningSubset: Option[Long],invalid: Boolean)
object ProviderUsage {
  val unknown: ProviderUsage = ProviderUsage(None,None,None,false)
  private final case class Counter(value: Option[Long],invalid: Boolean)
  private val missing = Counter(None,false)
  private val malformed = Counter(None,true)
  private val maximumCounterDigits = 19L

  def parse(response: Json,purpose: ModelWorkload): ProviderUsage = {
    response.hcursor.downField("usage").focus match {
      case None | Some(Json.Null) => unknown
      case Some(usage) => usage.asObject match {
        case None => ProviderUsage(None,None,None,true)
        case Some(fields) =>
          val input=counter(fields("prompt_tokens"))
          val output=if(purpose.hasOutput) counter(fields("completion_tokens")) else missing
          val reasoning=if(!purpose.hasOutput) missing else fields("completion_tokens_details") match {
            case None | Some(Json.Null) => missing
            case Some(details) => details.asObject.fold(malformed)(obj => counter(obj("reasoning_tokens")))
          }
          val invalidSubset=reasoning.value.exists(tokens => output.value.exists(tokens>_))
          ProviderUsage(input.value,output.value,if(invalidSubset) None else reasoning.value,input.invalid || output.invalid || reasoning.invalid || invalidSubset)
      }
    }
  }

  private def counter(json: Option[Json]): Counter = json match {
    case None | Some(Json.Null) => missing
    case Some(value) => value.asNumber.fold(malformed) { number =>
      integer(number.toString).fold(malformed)(value => Counter(Some(value),false))
    }
  }

  // Inspect the decimal lexeme without constructing a BigDecimal/BigInt or expanding its exponent.
  private def integer(text: String): Option[Long] = {
    if(text.isEmpty || text.head=='-') return None
    val exponentAt=text.indexWhere(c => c=='e' || c=='E')
    val mantissaEnd=if(exponentAt<0) text.length else exponentAt
    val decimalAt=text.indexOf('.')
    val fractionalDigits=if(decimalAt<0) 0L else (mantissaEnd-decimalAt-1).toLong
    var digits=0L; var leadingZeros=0L; var trailingZeros=0L; var nonzero=false; var index=0
    while(index<mantissaEnd) {
      val char=text.charAt(index)
      if(char!='.') {
        digits+=1
        if(char=='0') { trailingZeros+=1; if(!nonzero) leadingZeros+=1 }
        else { nonzero=true; trailingZeros=0 }
      }
      index+=1
    }
    if(!nonzero) return Some(0L)
    var exponent=0L
    if(exponentAt>=0) {
      index=exponentAt+1
      val negative=text.charAt(index)=='-'
      if(negative || text.charAt(index)=='+') index+=1
      val exponentLimit=Int.MaxValue.toLong+1L
      while(index<text.length) {
        exponent=(exponent*10L+(text.charAt(index)-'0')).min(exponentLimit)
        index+=1
      }
      if(negative) exponent = -exponent
    }
    val significantDigits=digits-leadingZeros-trailingZeros
    val shift=exponent-fractionalDigits+trailingZeros
    if(shift<0 || significantDigits+shift>maximumCounterDigits) return None
    try {
      var result=0L; var consumed=0L; var skipped=0L
      index=0
      while(index<mantissaEnd && consumed<significantDigits) {
        val char=text.charAt(index)
        if(char!='.') {
          if(skipped<leadingZeros) skipped+=1
          else { result=Math.addExact(Math.multiplyExact(result,10L),(char-'0').toLong); consumed+=1 }
        }
        index+=1
      }
      var remaining=shift
      while(remaining>0) { result=Math.multiplyExact(result,10L); remaining-=1 }
      Some(result)
    } catch { case _: ArithmeticException => None }
  }
}

final case class ModelTokenWindow(knownTokens: Long,reportedCalls: Long,unknownCalls: Long,tokensPerSecond: Option[Double],sampleAgeMillis: Option[Long])
final case class ModelWorkloadUsage(purpose: ModelWorkload,inFlight: Int,finishedCalls: Long,failedCalls: Long,cancelledCalls: Long,invalidUsageCalls: Long,input: ModelTokenWindow,output: Option[ModelTokenWindow],reasoningSubset: Option[ModelTokenWindow])
final case class ModelUsageSnapshot(observedAt: Instant,processStartedAt: Instant,windowStartAt: Instant,windowEndAt: Instant,coveredMillis: Long,bucketMillis: Long,samples: List[ModelWorkloadUsage])
sealed trait ModelCallTicket { def context: ModelCallContext }
trait ModelTelemetry {
  // Acquire with bracket/Resource before restoring cancellation; caller admission bounds active tickets.
  def begin(context: ModelCallContext): IO[ModelCallTicket]
  def finish(ticket: ModelCallTicket,outcome: ModelCallOutcome,usage: ProviderUsage): IO[Unit]
  def snapshot(ownerId: String): IO[ModelUsageSnapshot]
}
object ModelTelemetry {
  val bucketMillis = 100L
  val bucketCount = 100L
  private val nanosPerMilli = 1000000L
  private val invariantCode = "model-telemetry-invariant"
  private final class Identity
  private final case class Ticket(context: ModelCallContext,sequence: Long,identity: Identity) extends ModelCallTicket
  private final case class Active(context: ModelCallContext,startedMillis: Long)
  private final case class CounterTotal(knownTokens: Long,reportedCalls: Long,unknownCalls: Long) {
    def add(other: CounterTotal): CounterTotal = CounterTotal(plus(knownTokens,other.knownTokens),plus(reportedCalls,other.reportedCalls),plus(unknownCalls,other.unknownCalls))
  }
  private object CounterTotal {
    val empty = CounterTotal(0L,0L,0L)
    def sample(value: Option[Long]): CounterTotal = value.fold(CounterTotal(0L,0L,1L))(tokens => CounterTotal(tokens,1L,0L))
  }
  private final case class Totals(finished: Long,failed: Long,cancelled: Long,invalid: Long,input: CounterTotal,output: CounterTotal,reasoning: CounterTotal) {
    def add(other: Totals): Totals = Totals(plus(finished,other.finished),plus(failed,other.failed),plus(cancelled,other.cancelled),plus(invalid,other.invalid),input.add(other.input),output.add(other.output),reasoning.add(other.reasoning))
  }
  private object Totals {
    val empty = Totals(0L,0L,0L,0L,CounterTotal.empty,CounterTotal.empty,CounterTotal.empty)
    def sample(outcome: ModelCallOutcome,usage: ProviderUsage): Totals = Totals(1L,if(outcome==ModelCallOutcome.Failed) 1L else 0L,if(outcome==ModelCallOutcome.Cancelled) 1L else 0L,if(usage.invalid) 1L else 0L,CounterTotal.sample(usage.input),CounterTotal.sample(usage.output),CounterTotal.sample(usage.reasoningSubset))
  }
  private final case class Latest(input: Option[Long],output: Option[Long],reasoning: Option[Long]) {
    def observe(usage: ProviderUsage,at: Long): Latest = Latest(update(input,usage.input,at),update(output,usage.output,at),update(reasoning,usage.reasoningSubset,at))
    private def update(previous: Option[Long],value: Option[Long],at: Long): Option[Long] = if(value.isEmpty) previous else Some(previous.fold(at)(_.max(at)))
  }
  private final case class Slice(buckets: Map[Long,Totals],latest: Latest)
  private final case class State(nextTicket: Long,active: Map[Long,Active],slices: Map[ModelCallContext,Slice],elapsedMillis: Long)

  def make(clock: ModelTelemetryClock,owners: Set[String]): IO[ModelTelemetry] = for {
    _ <- IO(Check(owners.forall(_.nonEmpty),"config","telemetry owners must be nonempty"))
    started <- clock.read
    slices=owners.toList.flatMap(owner => ModelWorkload.values.toList.map(purpose => ModelCallContext(owner,purpose)->Slice(Map.empty,Latest(None,None,None)))).toMap
    state <- Ref.of[IO,State](State(0L,Map.empty,slices,0L))
  } yield new InMemory(clock,started,state,new Identity)

  private def plus(left: Long,right: Long): Long = try Math.addExact(left,right) catch {
    case _: ArithmeticException => throw DomainError(invariantCode,"telemetry counter overflow")
  }
  private def total(buckets: Iterable[Totals]): Totals = buckets.foldLeft(Totals.empty)(_.add(_))
  // Include the current partial bucket and 99 predecessors; the disclosed lower bound advances only at bucket boundaries.
  private def windowStart(elapsed: Long): Long = ((elapsed/bucketMillis)-(bucketCount-1L)).max(0L)*bucketMillis
  private def recent(state: State,elapsed: Long): State = {
    val end=state.elapsedMillis.max(elapsed)
    val start=windowStart(end)
    state.copy(elapsedMillis=end,slices=state.slices.map { case (context,slice) => context->slice.copy(buckets=slice.buckets.filter { case (at,_) => at>=start }) })
  }

  private final class InMemory(clock: ModelTelemetryClock,started: ModelTelemetryTime,state: Ref[IO,State],identity: Identity) extends ModelTelemetry {
    private def elapsed(time: ModelTelemetryTime): Long = try {
      Math.subtractExact(time.monotonicNanos,started.monotonicNanos).max(0L)/nanosPerMilli
    } catch { case _: ArithmeticException => throw DomainError(invariantCode,"telemetry monotonic interval overflow") }
    private def configured(state: State,context: ModelCallContext): Unit = Check(state.slices.contains(context),invariantCode,"telemetry owner is not configured")

    def begin(context: ModelCallContext): IO[ModelCallTicket] = IO.uncancelable { _ => clock.read.flatMap { time =>
      state.modify { previous =>
        configured(previous,context)
        val current=recent(previous,elapsed(time))
        val sequence=plus(current.nextTicket,1L)
        val ticket=Ticket(context,sequence,identity)
        (current.copy(nextTicket=sequence,active=current.active.updated(sequence,Active(context,current.elapsedMillis))),ticket)
      }
    }}

    def finish(ticket: ModelCallTicket,outcome: ModelCallOutcome,usage: ProviderUsage): IO[Unit] = IO.uncancelable { _ => clock.read.flatMap { time =>
      state.update { previous =>
        val local=ticket match {
          case value: Ticket if value.identity eq identity => value
          case _ => throw DomainError(invariantCode,"foreign telemetry ticket")
        }
        val active=previous.active.getOrElse(local.sequence,throw DomainError(invariantCode,"telemetry ticket already finished"))
        Check(active.context==local.context,invariantCode,"telemetry ticket context changed")
        Check(List(usage.input,usage.output,usage.reasoningSubset).flatten.forall(_>=0L),invariantCode,"negative telemetry counter")
        Check(!usage.reasoningSubset.exists(tokens => usage.output.exists(tokens>_)),invariantCode,"reasoning counter exceeds completion")
        val observed=elapsed(time).max(active.startedMillis)
        val current=recent(previous,observed)
        val slice=current.slices(active.context)
        val at=(observed/bucketMillis)*bucketMillis
        val buckets=if(at<windowStart(current.elapsedMillis)) slice.buckets else slice.buckets.updated(at,slice.buckets.getOrElse(at,Totals.empty).add(Totals.sample(outcome,usage)))
        total(buckets.values)
        val updated=slice.copy(buckets=buckets,latest=slice.latest.observe(usage,observed))
        current.copy(active=current.active-local.sequence,slices=current.slices.updated(active.context,updated))
      }
    }}

    def snapshot(ownerId: String): IO[ModelUsageSnapshot] = clock.read.flatMap { time =>
      state.modify { previous =>
        configured(previous,ModelCallContext(ownerId,ModelWorkload.IndexAnnotation))
        val current=recent(previous,elapsed(time))
        val end=current.elapsedMillis
        val start=windowStart(end)
        val covered=end-start
        def counter(value: CounterTotal,last: Option[Long]): ModelTokenWindow = {
          val rate=if(covered==0L || value.reportedCalls==0L || value.unknownCalls>0L) None else Some(value.knownTokens.toDouble/(covered.toDouble/1000.0))
          ModelTokenWindow(value.knownTokens,value.reportedCalls,value.unknownCalls,rate,last.map(at => end-at))
        }
        val samples=ModelWorkload.values.toList.map { purpose =>
          val context=ModelCallContext(ownerId,purpose)
          val slice=current.slices(context)
          val counts=total(slice.buckets.values)
          ModelWorkloadUsage(purpose,current.active.valuesIterator.count(_.context==context),counts.finished,counts.failed,counts.cancelled,counts.invalid,counter(counts.input,slice.latest.input),if(purpose.hasOutput) Some(counter(counts.output,slice.latest.output)) else None,if(purpose.hasOutput) Some(counter(counts.reasoning,slice.latest.reasoning)) else None)
        }
        // Bucket bounds and wall times are projected from the startup anchor; wall-clock corrections cannot alter rates or ages.
        val endAt=started.wallClock.plusMillis(end)
        (current,ModelUsageSnapshot(endAt,started.wallClock,started.wallClock.plusMillis(start),endAt,covered,bucketMillis,samples))
      }
    }
  }
}
