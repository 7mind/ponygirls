package chronicle

import java.sql.Connection
import java.util.UUID

final case class OwnerReindexPreview(currentTargetProfile: String,targetProfile: String,selectionHash: String,heads: Long,alreadyCurrent: Long,replacements: Long)
final case class OwnerReindexOutcome(requestId: UUID,targetProfile: String,heads: Long,queued: Long,alreadyCurrent: Long,invalidatedClaims: Long)
trait OwnerReindex {
  def preview(owner: String): OwnerReindexPreview
  def apply(owner: String,requestId: UUID,targetProfile: String,selectionHash: String,confirm: Boolean): OwnerReindexOutcome
  def completed(owner: String): Boolean
  def status(owner: String,requestId: UUID): chronicle.api.ReindexStatusResult
}
final class PostgresOwnerReindex(db: Database) extends OwnerReindex {
  def preview(owner: String): OwnerReindexPreview = db.transaction { c =>
    c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ)
    OwnerReindex.preview(c,owner,db.profiles)
  }
  def apply(owner: String,requestId: UUID,targetProfile: String,selectionHash: String,confirm: Boolean): OwnerReindexOutcome =
    db.transaction(c => OwnerReindex(c,owner,requestId,targetProfile,selectionHash,confirm,db.profiles))
  def status(owner: String,requestId: UUID): chronicle.api.ReindexStatusResult = db.transaction { c =>
    c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ)
    ReindexCohort.status(c,owner,requestId)
  }
  def completed(owner: String): Boolean = db.transaction { c =>
    c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ)
    OwnerTargets.enabled(c,owner,false)
    Sql.one(c,"SELECT request_id FROM ch_reindex_requests WHERE owner=? ORDER BY created_at DESC,request_id DESC LIMIT 1",owner)(_.getObject(1,classOf[UUID])).exists { id =>
      val state=ReindexCohort.status(c,owner,id)
      state.complete==state.total
    }
  }
}
object OwnerReindex {
  def preview(c: Connection,owner: String,catalog: IndexProfileCatalog): OwnerReindexPreview = ReindexCohort.preview(c,owner,catalog)
  def apply(c: Connection,owner: String,requestId: UUID,targetProfile: String,selectionHash: String,confirm: Boolean,catalog: IndexProfileCatalog): OwnerReindexOutcome =
    ReindexCohort(c,owner,requestId,targetProfile,selectionHash,confirm,catalog)
}
