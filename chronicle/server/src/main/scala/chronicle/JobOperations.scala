package chronicle
import chronicle.api.*
import java.time.{Clock,Duration,Instant}
import java.util.concurrent.Semaphore
import scala.collection.mutable

/** The operations a token with OperateJobs may run (POST /api/jobs/v1), each with its own budget. */
enum JobOperation {
  case ActivityJobs, RetryJob, PreviewRetryFailed, ApplyRetryFailed
}

/** Job operations for tokens (R-f): the account-plane scope OperateJobs, named wherever scopes are strings (Settings, the
  * account API on opt-in, static configuration). It is not a `chronicle.api.Scope` value: typed values never carry it. */
object JobOperations {
  val scope = "OperateJobs"
  val maximumScopes = 16
  /** A requested scope list as typed scopes and whether OperateJobs is given. The original list is validated first —
    * nonempty, at most `maximumScopes`, distinct, each known, Raw and OperateJobs each require Read — and only then split. */
  def scopes(requested: Seq[String]): Option[(List[Scope],Boolean)] = {
    val read=requested.contains(Scope.Read.toString)
    val valid=requested.nonEmpty && requested.size<=maximumScopes && requested.distinct.size==requested.size &&
      requested.forall(name => name==scope || Scope.parse(name).nonEmpty) &&
      (!requested.contains(Scope.Raw.toString) || read) && (!requested.contains(scope) || read)
    Option.when(valid)((requested.filterNot(_==scope).flatMap(Scope.parse).toList,requested.contains(scope)))
  }
  /** The allow-list, decided before dispatch: every other operation, including one added later, is refused. */
  def admitted(operation: Operation): Option[JobOperation] = operation match {
    case _: Operation.ActivityJobs => Some(JobOperation.ActivityJobs)
    case _: Operation.RetryJob => Some(JobOperation.RetryJob)
    case _: Operation.PreviewRetryFailed => Some(JobOperation.PreviewRetryFailed)
    case _: Operation.ApplyRetryFailed => Some(JobOperation.ApplyRetryFailed)
    case _ => None
  }
}

/** Per owner (shared by all its tokens) and operation, at most the operation's count in a fixed window of `window`; at most
  * `concurrent` job-operation requests of tokens per process. */
final case class JobLimits(window: Duration,activityJobs: Int,retryJob: Int,previewRetryFailed: Int,applyRetryFailed: Int,concurrent: Int) {
  require(!window.isNegative && !window.isZero && List(activityJobs,retryJob,previewRetryFailed,applyRetryFailed,concurrent).forall(_>0),"job limits must be positive")
  def apply(operation: JobOperation): Int = operation match {
    case JobOperation.ActivityJobs => activityJobs
    case JobOperation.RetryJob => retryJob
    case JobOperation.PreviewRetryFailed => previewRetryFailed
    case JobOperation.ApplyRetryFailed => applyRetryFailed
  }
}
object JobLimits {
  val production = JobLimits(Duration.ofMinutes(30),120,20,6,2,2)
  /** The Retry-After of a request refused because every permit is taken. */
  val busyRetryAfterSeconds = 5L
}
/** The owner's budget for the operation is spent until its window ends, `remaining` from now. */
final case class JobLimitReached(remaining: Duration) extends RuntimeException("rate-limited")

/** The budget of job operations by tokens, in memory (a restart resets it). Browser sessions are never charged. */
final class JobBudget(val limits: JobLimits,clock: Clock) {
  private final case class Window(start: Instant,count: Int)
  private val permits=new Semaphore(limits.concurrent)
  private val windows=mutable.HashMap.empty[(String,JobOperation),Window]
  /** A permit for one request's lifetime; false when every permit is taken. */
  def admit(): Boolean = permits.tryAcquire()
  def release(): Unit = permits.release()
  /** Charges one operation of the owner before any of its effects, or raises JobLimitReached. The clock is read first;
    * the check and the count are one step, so tokens of one owner racing for its last slot get exactly one. A window opens
    * at the first charge after the previous one ended. */
  def charge(owner: String,operation: JobOperation): Unit = {
    val now=clock.instant()
    synchronized {
      val key=(owner,operation)
      windows.get(key).filter(window => now.isBefore(window.start.plus(limits.window))) match {
        case Some(window) if window.count>=limits(operation) => throw JobLimitReached(Duration.between(now,window.start.plus(limits.window)))
        case Some(window) => windows.update(key,window.copy(count=window.count+1))
        case None => windows.update(key,Window(now,1))
      }
    }
  }
}
