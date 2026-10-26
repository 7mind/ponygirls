package chronicle

import java.sql.Connection

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
