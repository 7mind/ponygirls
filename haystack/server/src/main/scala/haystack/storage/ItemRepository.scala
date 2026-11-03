package haystack.storage

import cats.effect.IO
import haystack.domain.*
import java.time.Instant

final case class CommitSuccess(revision: Long, metadata: ItemMetadata, replayed: Boolean)
trait ItemRepository {
  def current(key: ItemKey): IO[Option[StoredItem]]
  def revision(key: ItemKey, revision: Long): IO[Option[StoredItem]]
  def history(key: ItemKey): IO[Vector[RevisionMeta]]
  def allCurrent(): IO[Vector[StoredItem]]
  /** Includes terminal validation/CAS outcomes. An IO failure is uncertain,
    * never permission to retry under a new identity. */
  def commit(operation: AcceptedOperation, principal: Principal, now: Instant): IO[CommitSuccess]
}

private[storage] object Mutation {
  def decide(operation: AcceptedOperation, principal: Principal, now: Instant, current: Option[StoredItem]): Either[Fault, StoredItem] =
    operation.document.flatMap { document =>
      if (operation.expectedRevision == 0 && current.nonEmpty) Left(Fault("conflict", "revision conflict", current.map(_.revision)))
      else if (operation.expectedRevision > 0 && current.isEmpty) Left(Fault("not-found", "item not found"))
      else if (current.exists(_.revision != operation.expectedRevision)) Left(Fault("conflict", "revision conflict", current.map(_.revision)))
      else if (current.exists(_.revision >= Int.MaxValue)) Left(Fault("conflict", "revision limit reached", current.map(_.revision)))
      else {
        val metadata = current.fold(ItemMetadata(now, principal.userId, now, principal.userId))(s => s.metadata.copy(modifiedAt = now, modifiedBy = principal.userId))
        Right(StoredItem(operation.key, current.fold(1L)(_.revision + 1), document, operation.documentCanonical, metadata))
      }
    }
}

/** Handwritten atomic dummy. Tuple identities deliberately avoid concatenation
  * collisions in the historical TypeScript dummy. */
final class MemoryItemRepository extends ItemRepository {
  private var items = Map.empty[ItemKey, Vector[(StoredItem, String)]]
  private var replays = Map.empty[(String, String, String), (OperationDigest, Either[Fault, CommitSuccess])]
  def current(key: ItemKey): IO[Option[StoredItem]] = IO(synchronized(items.get(key).flatMap(_.lastOption).map(_._1)))
  def revision(key: ItemKey, revision: Long): IO[Option[StoredItem]] = IO(synchronized(items.get(key).flatMap(_.find(_._1.revision == revision)).map(_._1)))
  def history(key: ItemKey): IO[Vector[RevisionMeta]] = IO(synchronized(items.getOrElse(key, Vector.empty).reverse.map { case (s, token) => RevisionMeta(s.revision, s.metadata.modifiedAt, s.metadata.modifiedBy, token) }))
  def allCurrent(): IO[Vector[StoredItem]] = IO(synchronized(items.valuesIterator.map(_.last._1).toVector))
  def commit(operation: AcceptedOperation, principal: Principal, now: Instant): IO[CommitSuccess] = IO(synchronized {
    val identity = (principal.userId, principal.tokenId, operation.requestId)
    replays.get(identity) match {
      case Some((digest, result)) =>
        if (digest != operation.digest) Left(Fault("replay-conflict", "request identity reused"))
        else result.map(_.copy(replayed = true))
      case None =>
        val result = Mutation.decide(operation, principal, now, items.get(operation.key).flatMap(_.lastOption).map(_._1)).map { stored =>
          items += operation.key -> (items.getOrElse(operation.key, Vector.empty) :+ (stored -> principal.tokenId))
          CommitSuccess(stored.revision, stored.metadata, false)
        }
        replays += identity -> (operation.digest -> result)
        result
    }
  }).flatMap(IO.fromEither)
}
