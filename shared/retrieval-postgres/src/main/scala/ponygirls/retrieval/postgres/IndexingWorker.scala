package ponygirls.retrieval.postgres

import ponygirls.retrieval.*
import ponygirls.runtime.{JdbcFailure,RuntimeFailure}
import cats.effect.{IO,Outcome}
import cats.syntax.all.*
import java.sql.Connection
import java.time.Instant
import scala.concurrent.duration.*

trait RetrievalTransactions {
  def transaction[A](run: Connection => A): IO[A]
}
/** Worker failures for the service's log: identifiers and fixed codes only, never chunk text. */
enum IndexingEvent {
  /** `retryAt` None: not requeued by this worker (claim superseded/removed, or lease lost and reclaimable at its expiry). */
  case AttemptFailed(namespace: String,sourceId: String,attempt: Int,retryAt: Option[Instant],code: String)
  case ClaimFailed(namespace: String,code: String)
  def line: String = this match {
    case AttemptFailed(namespace,sourceId,attempt,retryAt,code) => s"retrieval indexing attempt failed namespace=$namespace source=$sourceId attempt=$attempt next-retry=${retryAt.fold("not-requeued")(_.toString)} code=$code"
    case ClaimFailed(namespace,code) => s"retrieval indexing claim failed namespace=$namespace code=$code"
  }
}
object IndexingEvent {
  def code(error: Throwable): String = error match {
    case e: RetrievalError => e.code
    case e: JdbcFailure => e.code
    case e: RuntimeFailure => e.code
    case _ => "internal"
  }
}
/** Durable worker. Provider IO is NEVER run in a JDBC transaction. Reclaimed jobs
  * reuse committed accepted vectors. A response/commit crash can repeat a call.
  * `clock` decides retry back-off; every failure reaches `events`.
  */
final class IndexingWorker(index: PostgresRetrieval,db: RetrievalTransactions,embedder: EmbeddingClient,batchSize: Int,leaseSeconds: Int,pollInterval: FiniteDuration,clock: IO[Instant],events: IndexingEvent => IO[Unit]) {
  RetrievalChecks(batchSize>=1 && batchSize<=1024 && leaseSeconds>=3 && leaseSeconds<=86400 && pollInterval>Duration.Zero,"config","invalid retrieval worker limits")
  private def process(claim: WorkClaim): IO[Unit] = {
    val batches=claim.chunks.zipWithIndex.grouped(batchSize).toList
    val work=batches.traverse_ { batch =>
      val first=batch.head._2
      db.transaction(c => index.accepted(c,claim,first,batch.size)).flatMap {
        case Some(_) => IO.unit
        case None => embedder.documents(batch.map(_._1.text)).flatMap { vectors =>
          IO(RetrievalChecks(vectors.size==batch.size,"model-output","embedding count mismatch")) *>
            db.transaction(c => index.accept(c,claim,first,vectors))
        }
      }
    } *> db.transaction(c => index.publish(c,claim)).void
    val heartbeat=(IO.sleep((leaseSeconds/3).seconds) *> db.transaction(c => index.renew(c,claim,leaseSeconds))).foreverM
    IO.race(work,heartbeat).void.guaranteeCase {
      case Outcome.Succeeded(_) => IO.unit
      case outcome =>
        val code=outcome match {
          case Outcome.Errored(error) => IndexingEvent.code(error)
          case _ => "cancelled"
        }
        clock.flatMap(now => db.transaction(c => index.fail(c,claim,now))).attempt.flatMap { requeued =>
          events(IndexingEvent.AttemptFailed(index.namespace,claim.sourceId,claim.attempt,requeued.toOption.flatten,code))
        }
    }
  }
  def once: IO[Boolean] = clock.flatMap(now => db.transaction(c => index.claim(c,leaseSeconds,now)))
    .handleErrorWith(error => events(IndexingEvent.ClaimFailed(index.namespace,IndexingEvent.code(error))) *> IO.raiseError(error))
    .flatMap {
      case None => IO.pure(false)
      case Some(claim) => process(claim).as(true)
    }
  /** Claims the next job right after a success; sleeps `pollInterval` only when idle or after a failure. */
  def run: IO[Nothing] = once.attempt.flatMap {
    case Right(true) => IO.cede
    case _ => IO.sleep(pollInterval)
  }.foreverM
}
