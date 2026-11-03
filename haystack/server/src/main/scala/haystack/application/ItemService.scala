package haystack.application

import cats.effect.IO
import cats.syntax.all.*
import haystack.domain.*
import haystack.storage.{ItemRepository,CommitSuccess}
import haystack.query.{Search,SearchInput,SearchResult}
import java.time.Instant

final class ItemService(repo: ItemRepository, changed: (String,Long) => IO[Unit], clock: IO[Instant] = IO.realTimeInstant) {
  def get(key: String, revision: Option[Long] = None): IO[StoredItem] = IO(QualifiedId.decodeKey(key)).flatMap { decoded =>
    revision match {
      case Some(n) if n <= 0 || n > Int.MaxValue => IO.raiseError(Fault("bad-envelope","revision must be positive"))
      case Some(n) => repo.revision(decoded,n)
      case None => repo.current(decoded)
    }
  }.flatMap(_.fold(IO.raiseError[StoredItem](Fault("not-found","item not found")))(IO.pure))
  def history(key: String): IO[Vector[RevisionMeta]] = IO(QualifiedId.decodeKey(key)).flatMap(repo.history)
  def put(key: String, documentJson: String, expectedRevision: Long, requestId: String, principal: Principal): IO[CommitSuccess] = for {
    operation <- IO(OperationEnvelope.accept(key,documentJson,expectedRevision,requestId))
    now <- clock
    result <- repo.commit(operation,principal,now)
    // Only acknowledged fresh commits invalidate. Failure/replay never does.
    // Notification is advisory; a disconnect cannot undo a committed write.
    _ <- if (result.replayed) IO.unit else changed(key,result.revision).handleErrorWith(_ => IO.unit)
  } yield result
  def search(input: SearchInput): IO[SearchResult] = repo.allCurrent().map(Search.search(_,input))
  def complete(fragment: String): IO[Vector[String]] = repo.allCurrent().map(Search.complete(_,fragment))
  def values(field: String): IO[Vector[String]] = repo.allCurrent().flatMap { items =>
    val values = field match {
      case "type" => items.map(_.document.docType)
      case "status" => items.map(_.document.status)
      case "importance" => items.map(_.document.importance)
      case "tags" => items.flatMap(_.document.tags)
      case _ => throw Fault("not-found","unknown value set")
    }
    IO.pure(values.distinct.sorted.take(100))
  }
}
