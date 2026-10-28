package chronicle
import chronicle.api.*
import io.circe.Json
import java.nio.charset.StandardCharsets.UTF_8
import java.security.MessageDigest
import java.sql.{Connection,ResultSet}
import java.util.UUID
import scala.util.Using

object RetryFailedJobs {
  private val hashVersion="retry-current-failed-v1"
  private val fetchSize=256
  private val ownedJobs="FROM ch_jobs j JOIN ch_sources s ON s.id=j.session_id WHERE s.owner=? AND NOT s.tombstone"
  private val eligibleJobs=ownedJobs+" AND j.revision=s.revision AND j.profile=? AND j.state='Failed'"
  private val population="SELECT j.state,j.revision=s.revision AS revision_current,j.profile=? AS profile_current "+ownedJobs
  private val aggregate="""count(*) FILTER (WHERE revision_current AND profile_current AND state='Failed') AS eligible,
    count(*) FILTER (WHERE NOT revision_current AND profile_current AND state='Failed') AS superseded,
    count(*) FILTER (WHERE revision_current AND NOT profile_current AND state='Failed') AS obsolete,
    count(*) FILTER (WHERE NOT revision_current AND NOT profile_current AND state='Failed') AS both,
    count(*) FILTER (WHERE revision_current AND profile_current AND state='Queued') AS queued,
    count(*) FILTER (WHERE revision_current AND profile_current AND state='Running') AS running,
    count(*) FILTER (WHERE revision_current AND profile_current AND state='Complete') AS complete"""
  private def counts(r: ResultSet): RetryFailedCounts = RetryFailedCounts(
    r.getLong("eligible"),r.getLong("superseded"),r.getLong("obsolete"),r.getLong("both"),
    r.getLong("queued"),r.getLong("running"),r.getLong("complete")
  )
  private def text(value: String): Unit =
    Check(value!=null && value.nonEmpty && !value.contains('\u0000') && UTF_8.newEncoder().canEncode(value),"invalid","invalid retry identifier")
  private def ownerEnabled(c: Connection,owner: String,lock: Boolean): Unit = {
    val locking=if(lock) " FOR SHARE" else ""
    Check(Sql.one(c,"SELECT 1 FROM ch_users WHERE id=? AND enabled"+locking,owner)(_ => true).contains(true),"unauthorized","owner disabled")
  }
  private def target(c: Connection,owner: String,lock: Boolean): String = OwnerTargets.read(c,owner,lock).profile
  private def each(c: Connection,sql: String,args: Sql.Param*)(f: ResultSet => Unit): Unit =
    Using.resource(c.prepareStatement(sql)) { p =>
      p.setFetchSize(fetchSize)
      Sql.bind(p,args)
      Using.resource(p.executeQuery()) { r => while(r.next()) f(r) }
    }
  private def selectionHash(c: Connection,owner: String,profile: String,sql: String,args: Sql.Param*): String = {
    val digest=MessageDigest.getInstance("SHA-256")
    def append(value: String): Unit = digest.update(value.getBytes(UTF_8))
    def string(value: String): String = Wire.canonical(Json.fromString(value))
    append(s"[${string(hashVersion)},${string(owner)},${string(profile)},[")
    var first=true
    each(c,sql,args*) { r =>
      if(!first) append(",")
      append(Wire.canonical(Json.arr(Json.fromString(r.getObject("id",classOf[UUID]).toString),Json.fromLong(r.getLong("fence")))))
      first=false
    }
    append("]]")
    digest.digest().map(b => f"${b & 255}%02x").mkString
  }
  def preview(c: Connection,owner: String): RetryFailedPlan = {
    text(owner)
    Check(!c.getAutoCommit && Set(Connection.TRANSACTION_REPEATABLE_READ,Connection.TRANSACTION_SERIALIZABLE).contains(c.getTransactionIsolation),"internal","retry preview requires a repeatable-read transaction")
    ownerEnabled(c,owner,false)
    val profile=target(c,owner,false)
    val totals=Sql.one(c,s"SELECT $aggregate FROM ($population) jobs",profile,owner)(counts).get
    val hash=selectionHash(c,owner,profile,s"SELECT j.id,j.fence $eligibleJobs ORDER BY j.id",owner,profile)
    RetryFailedPlan(profile,hash,totals)
  }
  def apply(c: Connection,owner: String,requestId: UUID,targetProfile: String,selectionHash: String,confirm: Boolean): RetryFailedResult = {
    text(owner); text(targetProfile)
    Check(requestId!=null && selectionHash!=null && selectionHash.matches("[0-9a-f]{64}") && confirm,"invalid","valid retry hash and explicit confirmation required")
    Check(!c.getAutoCommit,"internal","retry apply requires a transaction")
    // Pin enabled ownership before profile/source/job locks so disabling cannot race the mutation.
    ownerEnabled(c,owner,true)
    Check(Sql.one(c,"SELECT has_database_privilege(current_user,current_database(),'TEMP')")(_.getBoolean(1)).contains(true),"unavailable","bulk retry requires database TEMP privilege")
    val profile=target(c,owner,true)
    each(c,"SELECT id FROM ch_sources WHERE owner=? AND NOT tombstone ORDER BY id FOR UPDATE",owner)(_ => ())
    // The caller must roll back failures; never issue cleanup SQL in a possibly aborted transaction.
    Sql.exec(c,"CREATE TEMP TABLE ch_retry_failed_selection(id uuid PRIMARY KEY,fence bigint NOT NULL) ON COMMIT DROP")
    val (totals,selected)=Sql.one(c,s"""WITH eligible AS MATERIALIZED (
      SELECT j.id,j.fence $eligibleJobs ORDER BY j.id FOR UPDATE OF j
    ), captured AS (
      INSERT INTO pg_temp.ch_retry_failed_selection SELECT id,fence FROM eligible RETURNING id
    ) SELECT $aggregate,(SELECT count(*) FROM captured) AS captured_count FROM ($population) jobs""",owner,profile,profile,owner) { r =>
      (counts(r),r.getLong("captured_count"))
    }.get
    val hash=RetryFailedJobs.selectionHash(c,owner,profile,"SELECT id,fence FROM pg_temp.ch_retry_failed_selection ORDER BY id")
    Check(profile==targetProfile && hash==selectionHash && selected==totals.eligibleCurrentFailed,"conflict","retry selection changed; preview again")
    // Lease exhaustion can add Failed jobs without source locks: update only this exact captured set.
    val retried=Using.resource(c.prepareStatement("""UPDATE ch_jobs j SET state='Queued',attempts=0,lease_until=NULL,
      fence=j.fence+1,completed_windows=0,total_windows=NULL
      FROM pg_temp.ch_retry_failed_selection chosen WHERE j.id=chosen.id AND j.fence=chosen.fence AND j.state='Failed'"""))(_.executeLargeUpdate())
    Check(retried==selected,"internal","locked retry selection changed")
    Sql.exec(c,"DROP TABLE pg_temp.ch_retry_failed_selection")
    RetryFailedResult(requestId,profile,retried,totals)
  }
}
