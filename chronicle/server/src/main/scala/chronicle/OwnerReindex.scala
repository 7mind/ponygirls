package chronicle

import io.circe.Json
import java.nio.charset.StandardCharsets.UTF_8
import java.security.MessageDigest
import java.sql.{Connection,ResultSet}
import java.util.UUID
import scala.util.Using

final case class OwnerReindexPreview(currentTargetProfile: String,targetProfile: String,selectionHash: String,heads: Long,alreadyCurrent: Long,replacements: Long)
final case class OwnerReindexOutcome(requestId: UUID,targetProfile: String,heads: Long,queued: Long,alreadyCurrent: Long,invalidatedClaims: Long)
trait OwnerReindex {
  def preview(owner: String): OwnerReindexPreview
  def apply(owner: String,requestId: UUID,targetProfile: String,selectionHash: String,confirm: Boolean): OwnerReindexOutcome
  def completed(owner: String): Boolean
}
final class PostgresOwnerReindex(db: Database) extends OwnerReindex {
  def preview(owner: String): OwnerReindexPreview = db.transaction { c =>
    c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ)
    OwnerReindex.preview(c,owner,db.profiles)
  }
  def apply(owner: String,requestId: UUID,targetProfile: String,selectionHash: String,confirm: Boolean): OwnerReindexOutcome =
    db.transaction(c => OwnerReindex(c,owner,requestId,targetProfile,selectionHash,confirm,db.profiles))
  def completed(owner: String): Boolean = db.transaction { c =>
    c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ)
    val target=OwnerTargets.read(c,owner,false)
    db.profiles.resolve(target.profile)
    Sql.one(c,"""SELECT NOT EXISTS(SELECT 1 FROM ch_sources s LEFT JOIN ch_generations g ON g.id=s.published
      WHERE s.owner=? AND NOT s.tombstone AND (g.profile IS DISTINCT FROM ? OR g.revision<>s.revision))""",owner,target.profile)(_.getBoolean(1)).get
  }
}
object OwnerReindex {
  private val hashVersion="owner-reindex-v1"
  private val fetchSize=256
  private def each(c: Connection,sql: String,args: Sql.Param*)(f: ResultSet => Unit): Unit =
    Using.resource(c.prepareStatement(sql)) { p =>
      p.setFetchSize(fetchSize); Sql.bind(p,args)
      Using.resource(p.executeQuery()) { r => while(r.next()) f(r) }
    }
  private def hash(c: Connection,owner: String,current: OwnerTarget,destination: String): String = {
    val digest=MessageDigest.getInstance("SHA-256")
    def append(value: String): Unit = digest.update(value.getBytes(UTF_8))
    append(Json.arr(Json.fromString(hashVersion),Json.fromString(owner),Json.fromString(current.profile),Json.fromLong(current.epoch),Json.fromString(destination)).noSpaces)
    def section(sql: String): Unit = {
      append("[")
      each(c,sql,owner) { r => append(Wire.canonical(Sql.json(r,"value"))); append(",") }
      append("]")
    }
    section("""SELECT jsonb_build_array(s.id,s.revision,s.published,g.profile,g.revision) AS value
      FROM ch_sources s LEFT JOIN ch_generations g ON g.id=s.published WHERE s.owner=? AND NOT s.tombstone ORDER BY s.id""")
    section("""SELECT jsonb_build_array(j.id,j.session_id,j.revision,j.profile,j.state,j.fence,j.attempts,j.lease_until,j.error,j.completed_windows,j.total_windows) AS value
      FROM ch_sources s JOIN ch_jobs j ON j.session_id=s.id WHERE s.owner=? AND NOT s.tombstone ORDER BY j.id""")
    digest.digest().map(b => f"${b & 255}%02x").mkString
  }
  private def noMaintenance(c: Connection,lock: Boolean): Unit = {
    val suffix=if(lock) " FOR SHARE" else ""
    val armed=Sql.one(c,"SELECT maintenance FROM ch_profile WHERE singleton"+suffix)(_.getBoolean(1))
      .getOrElse(throw DomainError("internal","missing maintenance profile"))
    Check(!armed,"conflict","global profile maintenance is active")
  }
  private def plan(c: Connection,owner: String,current: OwnerTarget,catalog: IndexProfileCatalog): OwnerReindexPreview = {
    val destination=catalog.transition(current.profile)
    Check(IndexProfiles.registered(c,current.profile)==destination.embedding.id,"unavailable","owner transition requires a verified compatible embedding space")
    Check(IndexProfiles.registered(c,destination.profile)==destination.embedding.id,"unavailable","destination profile registration mismatch")
    val (heads,ready)=Sql.one(c,"""SELECT count(*),count(*) FILTER (WHERE g.profile=? AND g.revision=s.revision)
      FROM ch_sources s LEFT JOIN ch_generations g ON g.id=s.published WHERE s.owner=? AND NOT s.tombstone""",destination.profile,owner)(r => (r.getLong(1),r.getLong(2))).get
    OwnerReindexPreview(current.profile,destination.profile,hash(c,owner,current,destination.profile),heads,ready,heads-ready)
  }
  def preview(c: Connection,owner: String,catalog: IndexProfileCatalog): OwnerReindexPreview = {
    Check(!c.getAutoCommit && Set(Connection.TRANSACTION_REPEATABLE_READ,Connection.TRANSACTION_SERIALIZABLE).contains(c.getTransactionIsolation),"internal","owner reindex preview requires repeatable read")
    noMaintenance(c,false)
    plan(c,owner,OwnerTargets.read(c,owner,false),catalog)
  }
  def apply(c: Connection,owner: String,requestId: UUID,targetProfile: String,selectionHash: String,confirm: Boolean,catalog: IndexProfileCatalog): OwnerReindexOutcome = {
    Check(!c.getAutoCommit,"internal","owner reindex apply requires a transaction")
    Check(requestId!=null && confirm && selectionHash!=null && selectionHash.matches("[0-9a-f]{64}"),"invalid","valid owner selection hash and explicit confirmation required")
    OwnerTargets.enabled(c,owner,true)
    val current=Sql.one(c,"SELECT profile,epoch FROM ch_owner_targets WHERE owner=? FOR UPDATE",owner)(r => OwnerTarget(r.getString(1),r.getLong(2))).getOrElse(throw DomainError("internal","missing owner target"))
    noMaintenance(c,true)
    each(c,"SELECT id FROM ch_sources WHERE owner=? AND NOT tombstone ORDER BY id FOR UPDATE",owner)(_ => ())
    each(c,"SELECT j.id FROM ch_sources s JOIN ch_jobs j ON j.session_id=s.id WHERE s.owner=? AND NOT s.tombstone ORDER BY j.id FOR UPDATE OF j",owner)(_ => ())
    val selected=plan(c,owner,current,catalog)
    Check(targetProfile==selected.targetProfile && selectionHash==selected.selectionHash,"conflict","owner reindex selection changed; preview again")
    val changed=current.profile!=targetProfile
    if(changed) Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=epoch+1 WHERE owner=?",targetProfile,owner)
    val invalidated=Sql.one(c,"""WITH obsolete AS MATERIALIZED(
      SELECT j.id,j.state FROM ch_sources s JOIN ch_jobs j ON j.session_id=s.id WHERE s.owner=? AND NOT s.tombstone AND j.profile<>? AND j.state IN('Queued','Running')
    ), fenced AS (
      UPDATE ch_jobs j SET state='Failed',error='obsolete-owner-target',fence=j.fence+1,lease_until=NULL FROM obsolete old WHERE j.id=old.id RETURNING old.state
    ) SELECT count(*) FILTER(WHERE state='Running') FROM fenced""",owner,targetProfile)(_.getLong(1)).get
    val queued=Sql.one(c,"""WITH queued AS (
      INSERT INTO ch_jobs(id,session_id,revision,profile)
      SELECT gen_random_uuid(),s.id,s.revision,? FROM ch_sources s LEFT JOIN ch_generations g ON g.id=s.published
      WHERE s.owner=? AND NOT s.tombstone AND (g.profile IS DISTINCT FROM ? OR g.revision<>s.revision)
      ON CONFLICT(session_id,revision,profile) DO UPDATE SET state='Queued',attempts=0,fence=ch_jobs.fence+1,lease_until=NULL,error=NULL,completed_windows=0,total_windows=NULL
      WHERE NOT (ch_jobs.state='Running' AND ch_jobs.lease_until>clock_timestamp() AND ?)
      RETURNING id
    ) SELECT count(*) FROM queued""",targetProfile,owner,targetProfile,!changed)(_.getLong(1)).get
    OwnerReindexOutcome(requestId,targetProfile,selected.heads,queued,selected.alreadyCurrent,invalidated)
  }
}
