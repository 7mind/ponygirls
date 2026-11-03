package haystack.domain

import java.time.Instant
import ponygirls.losslessjson.LosslessJson

final case class Fault(code: String, message: String, currentRevision: Option[Long] = None)
    extends RuntimeException(message)

final case class Principal(userId: String, userType: String, tokenId: String)
final case class ItemKey(project: String, item: String) {
  def qualified: String = QualifiedId.encodeKey(this)
}
final case class ItemDocument(
    title: String,
    description: String,
    fields: LosslessJson.Value,
    docType: String,
    status: String,
    importance: String,
    humanAttention: String,
    links: Vector[(String, String)],
    tags: Vector[String] = Vector.empty
)
final case class ItemMetadata(createdAt: Instant, createdBy: String, modifiedAt: Instant, modifiedBy: String)
object ItemMetadata {
  /** Authorship is stamped from the authenticated principal, never document fields. */
  def stamp(previous: Option[ItemMetadata], principal: Principal, now: Instant): ItemMetadata =
    ItemMetadata(previous.fold(now)(_.createdAt), previous.fold(principal.userId)(_.createdBy), now, principal.userId)
}
final case class StoredItem(
    key: ItemKey,
    revision: Long,
    document: ItemDocument,
    documentCanonical: String,
    metadata: ItemMetadata
) {
  def project: String = key.project
  def item: String = key.item
}
final case class RevisionMeta(revision: Long, modifiedAt: Instant, modifiedBy: String, tokenId: String)
