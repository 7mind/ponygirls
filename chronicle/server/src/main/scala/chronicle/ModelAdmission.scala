package chronicle

import cats.effect.{IO,Resource}
import cats.effect.std.Semaphore

trait ModelAdmission {
  def annotationSession: Resource[IO,Unit]
  /** True while this lane may take a large job (LargeJobs): at most IndexingCapacity.largeJobs run at once. Every running job holds
    * its revision's messages and all its accumulated pieces until publication; with four large ones the live heap
    * reached 1.6-2 GB and each full collection of the native image paused HTTP for 300-630 ms. */
  def largeJob: Resource[IO,Boolean]
  /** The large-job permit for as long as the resource is in use, waiting for it (the waiting claim order's lane 0 holds it
    * for the process lifetime; no other lane takes it then). */
  def largeJobOwned: Resource[IO,Unit]
  def request(purpose: ModelWorkload): Resource[IO,Unit]
}
object ModelAdmission {
  def make(capacity: IndexingCapacity): IO[ModelAdmission] = for {
    _ <- IO(capacity.validate())
    sessions <- Semaphore[IO](capacity.annotationSessions.toLong)
    annotation <- Semaphore[IO](capacity.annotationSessions.toLong)
    embedding <- Semaphore[IO](capacity.embeddingRequests.toLong)
    large <- Semaphore[IO](IndexingCapacity.largeJobs.toLong)
  } yield new ModelAdmission {
    def annotationSession: Resource[IO,Unit] = sessions.permit
    def largeJob: Resource[IO,Boolean] = large.tryPermit
    def largeJobOwned: Resource[IO,Unit] = large.permit
    def request(purpose: ModelWorkload): Resource[IO,Unit] = purpose match {
      case ModelWorkload.IndexAnnotation | ModelWorkload.McpTest => annotation.permit
      case ModelWorkload.IndexEmbedding | ModelWorkload.QueryEmbedding => embedding.permit
    }
  }
}
