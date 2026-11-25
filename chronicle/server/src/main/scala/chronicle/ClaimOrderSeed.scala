package chronicle

import java.sql.Connection

/** The claim-order values of unfinished jobs that no write path of this release set (claim-order spec §5.5; design §4):
  * rows queued before migration 033, or by an older release afterwards. Neither changes a fence, run or state: no
  * authority check reads `waiting_since` or `bulk`. */
object ClaimOrderSeed {
  /** D-i: a job is bulk work when it is a member of its owner's current rebuild cohort (the member's run and the owner
    * target's epoch still the job's), or when it was retried (single retries before 033 are filed bulk once). */
  def bulkSql(job: String): String =
    s"""(EXISTS(SELECT 1 FROM ch_reindex_members m JOIN ch_sources s ON s.id=$job.session_id JOIN ch_owner_targets t ON t.owner=s.owner
      WHERE m.job_id=$job.id AND m.run_id=$job.run_id AND m.owner=s.owner AND m.target_epoch=t.epoch) OR $job.annotation_retry_epoch>0)"""
  private val unfinished = "j.state IN('Queued','Running')"
  /** Every start, in the start transaction after migration 033: only NULLs are filled, all with the transaction's one
    * `now()`. Returns the rows filled. */
  def startFill(c: Connection): Int =
    Sql.exec(c,s"UPDATE ch_jobs j SET waiting_since=coalesce(j.waiting_since,now()),bulk=coalesce(j.bulk,${bulkSql("j")}) WHERE $unfinished AND (j.waiting_since IS NULL OR j.bulk IS NULL)")
  def startFillLine(rows: Int): String = s"claim order start fill rows=$rows"
  final case class Reseeded(rows: Int,bulk: Int) {
    def line: String = s"claim order reseed rows=$rows bulk=$bulk fresh=${rows-bulk}"
  }
  /** `chronicle-server reseed-claim-order` (server stopped): every unfinished job, NULL or not, waits from one `now()` with
    * the D-i class. Mandatory after any period in which an older release retried or rebuilt jobs on a migrated database:
    * its re-queues leave stale non-NULL values the start fill does not see. Under the start lock (71393721). */
  def reseed(c: Connection): Reseeded = {
    Sql.exec(c,"SELECT pg_advisory_xact_lock(71393721)")
    val migrated=Sql.one(c,"SELECT to_regclass('ch_schema_migrations') IS NOT NULL")(_.getBoolean(1)).contains(true) &&
      Sql.one(c,"SELECT EXISTS(SELECT 1 FROM ch_schema_migrations WHERE version=33)")(_.getBoolean(1)).contains(true)
    Check(migrated,"migration-required","migration 033 is not applied; start this release (or run migrate) first")
    Sql.one(c,s"WITH seeded AS (UPDATE ch_jobs j SET waiting_since=now(),bulk=${bulkSql("j")} WHERE $unfinished RETURNING j.bulk) SELECT count(*)::int,(count(*) FILTER(WHERE bulk))::int FROM seeded")(r => Reseeded(r.getInt(1),r.getInt(2))).get
  }
}
