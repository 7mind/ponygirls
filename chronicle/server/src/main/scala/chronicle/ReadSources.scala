package chronicle

import java.sql.Connection

/** An indexed result is materialized in one snapshot. Compare its epoch in a fresh transaction, not again in
  * that same snapshot: an indexing opt-out committed during a read must not leave an already-built page deliverable.
  * This is a local check before returning the result, not a fence on transport delivery. */
private[chronicle] object IndexedRead {
  def epoch(c: Connection): Long =
    Sql.one(c,"SELECT indexing_revision FROM ch_security_epoch WHERE singleton")(_.getLong(1))
      .getOrElse(throw DomainError("security-state","indexing epoch is unavailable"))
  def transaction[A](db: Database,guarded: Boolean=true)(read: Connection => A): A = {
    val (result,observed)=db.transaction { c =>
      c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ)
      val result=read(c)
      (result,Option.when(guarded)(epoch(c)))
    }
    observed.foreach(verify(db,_))
    result
  }
  def verify(db: Database,observed: Long): Unit =
    Check(db.transaction(epoch)==observed,"unavailable","indexing policy changed during read; retry the request")
}

/** The effective read-side state of a job. A crashed worker need not return its invalidated lease before we show it
  * as pending. Keep the stored job intact for resume. */
private[chronicle] object IndexedJobRead {
  def effective(job: String,owner: String,indexingAllowed: String): String = {
    val epoch=ChronicleIndexing.epochOwnerSql(owner)
    val parked=s"CASE WHEN $job.state='Running' THEN NOT ($indexingAllowed) OR $job.indexing_epoch<>($epoch) ELSE false END"
    s"""LATERAL (SELECT CASE WHEN held.parked THEN 'Queued' ELSE $job.state END AS state,
      CASE WHEN held.parked THEN greatest($job.attempts-1,0) ELSE $job.attempts END AS attempts,
      CASE WHEN held.parked THEN NULL ELSE $job.lease_until END AS lease_until,
      CASE WHEN held.parked THEN 0 ELSE $job.completed_windows END AS completed_windows,
      CASE WHEN held.parked THEN NULL ELSE $job.total_windows END AS total_windows
      FROM (SELECT $parked AS parked OFFSET 0) held)"""
  }
}

object ReadSources {
  final case class Query(sql: String,args: List[Sql.Param])
  final case class Selection(query: Query,orderBy: String,maximumRows: Int)
  def bytes(c: Connection,query: Query): Long = {
    val measured=Sql.one(c,"SELECT COALESCE(sum(octet_length(convert_to(to_jsonb(selected_source)::text,'UTF8'))::numeric),0) AS source_bytes FROM ("+query.sql+") selected_source",query.args*)(_.getBigDecimal(1)).get
    checked(measured)
  }
  def checked(measured: java.math.BigDecimal): Long = {
    Check(measured.signum()>=0 && measured.compareTo(java.math.BigDecimal.valueOf(Long.MaxValue))<=0,"read-budget","source byte count overflow")
    try measured.longValueExact() catch { case _: ArithmeticException => throw DomainError("read-budget","invalid source byte count") }
  }
  def sum(values: Iterable[Long]): Long = values.foldLeft(0L) { (total,next) =>
    Check(next>=0 && next<=Long.MaxValue-total,"read-budget","source byte count overflow")
    total+next
  }
}
