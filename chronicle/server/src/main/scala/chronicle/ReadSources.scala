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
    Check(db.transaction(epoch)==observed,"authorization-changed","indexing access changed during read")
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
