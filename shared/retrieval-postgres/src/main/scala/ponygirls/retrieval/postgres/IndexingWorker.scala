package ponygirls.retrieval.postgres

import ponygirls.retrieval.*
import cats.effect.{IO,Outcome}
import cats.syntax.all.*
import java.sql.Connection
import scala.concurrent.duration.*

trait RetrievalTransactions {
  def transaction[A](run: Connection => A): IO[A]
}
/** Durable worker. Provider IO is NEVER run in a JDBC transaction. Reclaimed jobs
  * reuse committed accepted vectors. A response/commit crash can repeat a call.
  */
final class IndexingWorker(index: PostgresRetrieval,db: RetrievalTransactions,embedder: EmbeddingClient,batchSize: Int,leaseSeconds: Int,pollInterval: FiniteDuration) {
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
      case _ => db.transaction(c => index.fail(c,claim))
    }
  }
  def once: IO[Boolean] = db.transaction(c => index.claim(c,leaseSeconds)).flatMap {
    case None => IO.pure(false)
    case Some(claim) => process(claim).as(true)
  }
  /** Safe, bounded outage polling; ordinary app transactions remain independent. */
  def run: IO[Nothing] = (once.attempt *> IO.sleep(pollInterval)).foreverM
}
