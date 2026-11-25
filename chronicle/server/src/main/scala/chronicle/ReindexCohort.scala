package chronicle

import chronicle.api.*
import io.circe.Json
import java.nio.charset.StandardCharsets.UTF_8
import java.security.MessageDigest
import java.sql.{Connection,ResultSet}
import java.util.UUID
import scala.util.Using

/** Explicit fixed-current rebuild. A request captures a finite cohort, never a moving HEAD scan. */
object ReindexCohort {
  private def each(c: Connection,sql: String,args: Sql.Param*)(run: ResultSet => Unit): Unit =
    Using.resource(c.prepareStatement(sql)) { statement =>
      statement.setFetchSize(256); Sql.bind(statement,args)
      Using.resource(statement.executeQuery()) { rows => while(rows.next()) run(rows) }
    }
  private def target(c: Connection,owner: String,lock: Boolean): OwnerTarget = {
    OwnerTargets.enabled(c,owner,lock)
    Sql.one(c,"SELECT profile,epoch FROM ch_owner_targets WHERE owner=?"+(if(lock) " FOR UPDATE" else ""),owner)(row => OwnerTarget(row.getString(1),row.getLong(2)))
      .getOrElse(throw DomainError("internal","missing owner target"))
  }
  private def selection(c: Connection,owner: String,current: OwnerTarget,destination: String,indexingEpoch: Long): String = {
    val digest=MessageDigest.getInstance("SHA-256")
    def append(value: String): Unit = digest.update(value.getBytes(UTF_8))
    val version=if(indexingEpoch==0) "finite-current-rebuild-v1" else s"finite-current-rebuild-v1:indexing-epoch:$indexingEpoch"
    append(Json.arr(Json.fromString(version),Json.fromString(owner),Json.fromString(current.profile),Json.fromLong(current.epoch),Json.fromString(destination)).noSpaces)
    List(
      "SELECT jsonb_build_array(s.id,s.revision,r.binding_id,s.published,g.profile,g.revision,g.retired,g.run_id) AS value FROM ch_sources s LEFT JOIN ch_revisions r ON r.session_id=s.id AND r.revision=s.revision LEFT JOIN ch_generations g ON g.id=s.published WHERE s.owner=? AND NOT s.tombstone ORDER BY s.id",
      "SELECT jsonb_build_array(j.id,j.session_id,j.revision,j.profile,j.state,j.run_id,j.fence,j.attempts,j.lease_until,j.error,j.failure_stage,j.completed_windows,j.total_windows) AS value FROM ch_sources s JOIN ch_jobs j ON j.session_id=s.id WHERE s.owner=? AND NOT s.tombstone ORDER BY j.id"
    ).foreach { sql => append("["); each(c,sql,owner)(row => { append(Sql.json(row,"value").noSpacesSortKeys); append(",") }); append("]") }
    digest.digest().map(value => f"${value & 255}%02x").mkString
  }
  private def plan(c: Connection,owner: String,current: OwnerTarget,catalog: IndexProfileCatalog,indexingEpoch: Long): OwnerReindexPreview = {
    val destination=catalog.preferred.profile
    IndexProfiles.registered(c,destination)
    val heads=Sql.one(c,"SELECT count(*) FROM ch_sources WHERE owner=? AND NOT tombstone",owner)(_.getLong(1)).get
    OwnerReindexPreview(current.profile,destination,selection(c,owner,current,destination,indexingEpoch),heads,0L,heads)
  }
  def preview(c: Connection,owner: String,catalog: IndexProfileCatalog,defaultEnabled: Boolean): OwnerReindexPreview = {
    Check(!c.getAutoCommit && Set(Connection.TRANSACTION_REPEATABLE_READ,Connection.TRANSACTION_SERIALIZABLE).contains(c.getTransactionIsolation),"internal","rebuild preview requires repeatable read")
    val current=target(c,owner,false)
    val epoch=ChronicleIndexing.requireEnabled(ChronicleIndexing.read(c,defaultEnabled,owner))
    plan(c,owner,current,catalog,epoch)
  }
  private def outcome(value: OwnerReindexResult): OwnerReindexOutcome = OwnerReindexOutcome(value.requestId,value.targetProfile,value.heads,value.queued,value.alreadyCurrent,value.invalidatedClaims)
  def apply(c: Connection,owner: String,id: UUID,profile: String,hash: String,confirm: Boolean,catalog: IndexProfileCatalog,defaultEnabled: Boolean): OwnerReindexOutcome = {
    Check(!c.getAutoCommit && id!=null && confirm && hash!=null && hash.matches("[0-9a-f]{64}"),"invalid","valid rebuild selection and explicit confirmation required")
    val current=target(c,owner,true)
    val replay=Sql.one(c,"SELECT selection_hash,result FROM ch_reindex_requests WHERE owner=? AND request_id=?",owner,id) { row =>
      val recorded=Wire.decode(OwnerReindexResult.codecJson,Sql.json(row,"result"))
      // The control projection can canonicalize; the original request receipt cannot.
      Check(recorded.targetProfile==profile && row.getString("selection_hash")==hash,"conflict","rebuild request ID bound to another selection")
      outcome(recorded)
    }
    replay.getOrElse {
      val indexingEpoch=ChronicleIndexing.requireEnabled(ChronicleIndexing.locked(c,defaultEnabled,owner))
      each(c,"SELECT id FROM ch_sources WHERE owner=? AND NOT tombstone ORDER BY id FOR UPDATE",owner)(_ => ())
      each(c,"SELECT j.id FROM ch_sources s JOIN ch_jobs j ON j.session_id=s.id WHERE s.owner=? AND NOT s.tombstone ORDER BY j.id FOR UPDATE OF j",owner)(_ => ())
      val selected=plan(c,owner,current,catalog,indexingEpoch)
      Check(profile==selected.targetProfile && hash==selected.selectionHash,"conflict","owner reindex selection changed; preview again")
      val epoch=current.epoch+1
      Check(epoch>current.epoch,"internal","owner target epoch overflow")
      Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=? WHERE owner=?",profile,epoch,owner)
      val invalidated=Sql.one(c,"SELECT count(*) FROM ch_jobs j JOIN ch_sources s ON s.id=j.session_id WHERE s.owner=? AND NOT s.tombstone AND j.state='Running'",owner)(_.getLong(1)).get
      Jobs.supersede(c,"UPDATE ch_jobs j SET state='Failed',error='explicit-rebuild-superseded',failure_stage=NULL,fence=j.fence+1,lease_until=NULL FROM ch_sources s WHERE j.session_id=s.id AND s.owner=? AND NOT s.tombstone AND j.state IN('Queued','Running') RETURNING j.id",owner)
      Sql.exec(c,"CREATE TEMP TABLE ch_rebuild_heads ON COMMIT DROP AS SELECT id,revision,published FROM ch_sources WHERE owner=? AND NOT tombstone",owner)
      // The cohort is bulk work, every job of it waiting from this transaction's time (claim-order spec §5.2 r5).
      Sql.exec(c,"INSERT INTO ch_jobs(id,session_id,revision,profile,waiting_since,bulk) SELECT gen_random_uuid(),id,revision,?,now(),true FROM pg_temp.ch_rebuild_heads ON CONFLICT(session_id,revision,profile) DO UPDATE SET state='Queued',attempts=0,fence=ch_jobs.fence+1,run_id=gen_random_uuid(),lease_until=NULL,transient_failures=0,transient_range=NULL,error=NULL,failure_stage=NULL,completed_windows=0,total_windows=NULL,waiting_since=now(),bulk=true",profile)
      val result=OwnerReindexResult(id,profile,selected.heads,selected.heads,selected.alreadyCurrent,invalidated)
      Sql.exec(c,"INSERT INTO ch_reindex_requests(owner,request_id,target_profile,selection_hash,result) VALUES(?,?,?,?,?::jsonb)",owner,id,profile,hash,Wire.encode(OwnerReindexResult.codecJson,result).noSpaces)
      Sql.exec(c,"INSERT INTO ch_reindex_members(owner,request_id,session_id,revision,job_id,run_id,target_epoch,previous_generation) SELECT ?,?,h.id,h.revision,j.id,j.run_id,?,h.published FROM pg_temp.ch_rebuild_heads h JOIN ch_jobs j ON j.session_id=h.id AND j.revision=h.revision AND j.profile=?",owner,id,epoch,profile)
      Sql.exec(c,"DROP TABLE pg_temp.ch_rebuild_heads")
      outcome(result)
    }
  }
  def status(c: Connection,owner: String,id: UUID): ReindexStatusResult = {
    OwnerTargets.enabled(c,owner,false)
    val profile=Sql.one(c,"SELECT target_profile FROM ch_reindex_requests WHERE owner=? AND request_id=?",owner,id)(_.getString(1)).getOrElse(throw DomainError("not-found","rebuild request not found"))
    // A member whose job keeps running after a newer revision can still complete: it stays pending until the job ends.
    Sql.one(c,s"""WITH outcomes AS(SELECT CASE WHEN m.completed_generation IS NOT NULL THEN 'complete'
      WHEN s.id IS NULL OR s.tombstone OR (s.revision<>m.revision AND (${Jobs.leased("j")}) IS NOT TRUE) OR j.id IS NULL OR j.run_id<>m.run_id OR t.profile<>? OR t.epoch<>m.target_epoch THEN 'superseded'
      WHEN j.state='Failed' THEN 'failed' ELSE 'pending' END AS state
      FROM ch_reindex_members m LEFT JOIN ch_sources s ON s.id=m.session_id LEFT JOIN ch_jobs j ON j.id=m.job_id LEFT JOIN ch_owner_targets t ON t.owner=m.owner
      WHERE m.owner=? AND m.request_id=?) SELECT count(*),count(*) FILTER(WHERE state='complete'),count(*) FILTER(WHERE state='superseded'),count(*) FILTER(WHERE state='failed'),count(*) FILTER(WHERE state='pending') FROM outcomes""",profile,owner,id) { row =>
      ReindexStatusResult(id,profile,row.getLong(1),row.getLong(2),row.getLong(3),row.getLong(4),row.getLong(5))
    }.get
  }
  def published(c: Connection,claim: Claim,generation: UUID): Unit = {
    Sql.exec(c,"UPDATE ch_reindex_members SET completed_generation=? WHERE owner=? AND session_id=? AND revision=? AND job_id=? AND run_id=? AND target_epoch=? AND completed_generation IS NULL",generation,claim.owner,claim.sessionId,claim.revision,claim.jobId,claim.runId,claim.targetEpoch)
    // Retirement is one finite source-level intent, distinct from exact-revision completion.
    // A superseding revision can fulfill it, but cannot grant consent to retire future ordinary history.
    val retirements=Sql.exec(c,"UPDATE ch_reindex_members m SET retirement_generation=? FROM ch_reindex_requests r WHERE r.owner=m.owner AND r.request_id=m.request_id AND m.owner=? AND m.session_id=? AND m.revision<=? AND m.target_epoch=? AND r.target_profile=? AND m.retirement_generation IS NULL",generation,claim.owner,claim.sessionId,claim.revision,claim.targetEpoch,claim.profile)
    if(retirements>0) {
      // Every other generation's rows go: the publication must hold only its own rows, as a root (or a generation without
      // a lineage) does (ingest-limits spec §5.6.3); an incremental publication is never a rebuild's.
      Check(Sql.one(c,"SELECT lineage IS NULL OR lineage=id FROM ch_generations WHERE id=?",generation)(_.getBoolean(1)).contains(true),"internal","an explicit rebuild's publication is not a root of its lineage")
      // Pins of the older generations answer indexed-view-retired from this commit on; their derived rows are deleted
      // afterwards in bounded statements (ch_generation_retirements, ingest-limits spec §5.2.4 retirement).
      Sql.exec(c,"INSERT INTO ch_generation_retirements(generation,payload) SELECT id,true FROM ch_generations WHERE session_id=? AND id<>? AND NOT retired ON CONFLICT(generation) DO UPDATE SET payload=true",claim.sessionId,generation)
      Sql.exec(c,"UPDATE ch_generations SET retired=true WHERE session_id=? AND id<>? AND NOT retired",claim.sessionId,generation)
    }
  }
}
