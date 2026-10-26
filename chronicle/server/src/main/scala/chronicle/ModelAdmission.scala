package chronicle

import cats.effect.{IO,Resource}
import cats.effect.std.Semaphore

trait ModelAdmission {
  def annotationSession: Resource[IO,Unit]
  def request(purpose: ModelWorkload): Resource[IO,Unit]
}
object ModelAdmission {
  def make(capacity: IndexingCapacity): IO[ModelAdmission] = for {
    _ <- IO(capacity.validate())
    sessions <- Semaphore[IO](capacity.annotationSessions.toLong)
    annotation <- Semaphore[IO](capacity.annotationSessions.toLong)
    embedding <- Semaphore[IO](capacity.embeddingRequests.toLong)
  } yield new ModelAdmission {
    def annotationSession: Resource[IO,Unit] = sessions.permit
    def request(purpose: ModelWorkload): Resource[IO,Unit] = purpose match {
      case ModelWorkload.IndexAnnotation | ModelWorkload.McpTest => annotation.permit
      case ModelWorkload.IndexEmbedding | ModelWorkload.QueryEmbedding => embedding.permit
    }
  }
}
