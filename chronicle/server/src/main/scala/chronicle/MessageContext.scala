package chronicle

import chronicle.api.*
import java.sql.{Connection,SQLException}
import java.util.UUID

trait ContextReader {
  final def readMessageContext(reader: String,id: UUID,view: ContentView,anchor: Span,beforeBytes: Int,afterBytes: Int): MessageContextResult =
    readMessageContext(reader,id,view,anchor,beforeBytes,afterBytes,ReadMaterialization.unrestricted)
  def readMessageContext(reader: String,id: UUID,view: ContentView,anchor: Span,beforeBytes: Int,afterBytes: Int,materialization: ReadMaterialization): MessageContextResult
}
object MessageContextPolicy {
  val maximumAnchorBytes=2048
  val maximumSideBytes=2048
  val minimumSideBytes=4
  val maximumAdjacentMessages=4
  val maximumSourceBytes=64L*1024
  val maximumResultBytes=128L*1024
  val statementDeadlineMillis=5000
  def validate(anchor: Span,before: Int,after: Int): Unit = {
    Check.text(anchor.messageId,256)
    Check(anchor.start>=0 && anchor.end>=anchor.start,"invalid","invalid context anchor range")
    List(before,after).foreach(bytes => Check(bytes==0 || (bytes>=minimumSideBytes && bytes<=maximumSideBytes),"invalid","invalid context byte budget"))
    Check(anchor.end.toLong-anchor.start<=maximumAnchorBytes,"read-budget","context anchor exceeds byte budget")
  }
  def result(value: MessageContextResult): MessageContextResult = {
    Check(JsonUtf8Size(Wire.encode(Result.codecJson,Result.MessageContext(value)))<=maximumResultBytes,"read-budget","context result exceeds byte budget")
    value
  }
}
private[chronicle] final class PostgresContextReader(db: Database,archive: PostgresArchive) extends ContextReader {
  private final case class MessageSize(position: Int,bytes: Int)
  private final case class Range(position: Int,start: Int,end: Int)
  def readMessageContext(reader: String,id: UUID,selector: ContentView,anchor: Span,beforeBytes: Int,afterBytes: Int,materialization: ReadMaterialization): MessageContextResult = {
    MessageContextPolicy.validate(anchor,beforeBytes,afterBytes)
    var consumed=0L
    val bounded=ReadMaterialization.admitted(new ReadAdmission {
      def consume(bytes: Long): Unit = {
        val next=ReadSources.sum(List(consumed,bytes))
        Check(next<=MessageContextPolicy.maximumSourceBytes,"read-budget","context source byte budget exceeded")
        materialization.admit(bytes)
        consumed=next
      }
    })
    try db.transaction { c =>
      c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ)
      Sql.rows(c,"SELECT set_config('statement_timeout',least(coalesce(nullif(setting::bigint,0),?),?)::text,true) FROM pg_settings WHERE name='statement_timeout'",MessageContextPolicy.statementDeadlineMillis,MessageContextPolicy.statementDeadlineMillis)(_ => ())
      val view=archive.selectView(c,reader,id,Some(selector),bounded)
      def numeric[A](query: ReadSources.Query)(decode: java.sql.ResultSet => A): List[A] = {
        bounded.admit(ReadSources.bytes(c,query))
        Sql.rows(c,query.sql,query.args*)(decode)
      }
      def boundarySql: String = "CASE WHEN point<0 OR point>octet_length(body) THEN false WHEN point=octet_length(body) THEN true ELSE (get_byte(body,point)&192)<>128 END"
      val locator=ReadSources.Query("WITH message AS (SELECT position,convert_to(value->>'text','UTF8') AS body FROM ch_messages WHERE session_id=? AND revision=? AND message_id=?) SELECT position,octet_length(body) AS bytes,"+
        "(SELECT message_count FROM ch_revision_info WHERE session_id=? AND revision=?) AS total,"+
        "(SELECT bool_and("+boundarySql+") FROM (VALUES (?::integer),(?::integer)) endpoints(point)) AS valid FROM message",
        List(id,view.revision,anchor.messageId,id,view.revision,anchor.start,anchor.end))
      val located=numeric(locator)(row => (MessageSize(row.getInt("position"),row.getInt("bytes")),row.getInt("total"),row.getBoolean("valid"))).headOption.getOrElse(throw DomainError("not-found","message not found"))
      Check(located._3,"invalid","context anchor is outside the message or cuts a Unicode scalar")
      val center=located._1
      def adjacent(before: Boolean,budget: Int): List[MessageSize] = if(budget==0) Nil else {
        val comparison=if(before) "<" else ">"
        val order=if(before) "DESC" else "ASC"
        numeric(ReadSources.Query(s"SELECT position,octet_length(convert_to(value->>'text','UTF8')) AS bytes FROM ch_messages WHERE session_id=? AND revision=? AND position$comparison? ORDER BY position $order LIMIT ?",List(id,view.revision,center.position,MessageContextPolicy.maximumAdjacentMessages)))(row => MessageSize(row.getInt("position"),row.getInt("bytes")))
      }
      def expand(message: MessageSize,at: Int,budget: Int,before: Boolean): Int = {
        val raw=if(before) math.max(0,at-budget) else math.min(message.bytes.toLong,at.toLong+budget).toInt
        val operator=if(before) "+" else "-"
        val aggregate=if(before) "min" else "max"
        val query=ReadSources.Query(s"WITH message AS (SELECT convert_to(value->>'text','UTF8') AS body FROM ch_messages WHERE session_id=? AND revision=? AND position=?),points AS (SELECT ?::integer$operator delta AS point FROM generate_series(0,3) delta) SELECT $aggregate(point) AS boundary FROM message CROSS JOIN points WHERE point BETWEEN ? AND ? AND "+boundarySql,List(id,view.revision,message.position,raw,if(before) raw else at,if(before) at else raw))
        numeric(query)(_.getInt("boundary")).head
      }
      val leftMessages=adjacent(true,beforeBytes)
      val rightMessages=adjacent(false,afterBytes)
      def side(before: Boolean,budget: Int): List[Range] = if(budget==0) Nil else {
        var remaining=budget
        var stopped=false
        val out=List.newBuilder[Range]
        val messages=center::(if(before) leftMessages else rightMessages)
        messages.foreach { message =>
          if(!stopped) {
            val at=if(message.position==center.position) { if(before) anchor.start else anchor.end } else if(before) message.bytes else 0
            val boundary=expand(message,at,remaining,before)
            val start=if(before) boundary else at
            val end=if(before) at else boundary
            remaining-=end-start
            if(message.position==center.position || message.bytes==0 || end>start) out+=Range(message.position,start,end)
            stopped=if(before) start>0 else end<message.bytes
          }
        }
        out.result()
      }
      val left=side(true,beforeBytes)
      val right=side(false,afterBytes)
      val start=left.headOption.fold(anchor.start)(_.start)
      val end=right.headOption.fold(anchor.end)(_.end)
      val ranges=left.drop(1).reverse:::List(Range(center.position,start,end)):::right.drop(1)
      val parts=ranges.map { range =>
        ReadSources.Query("SELECT jsonb_build_object('messageId',message_id,'messagePosition',position,'start',?::integer,'end',?::integer) AS source,value->>'role' AS role,convert_from(substring(convert_to(value->>'text','UTF8') FROM ? FOR ?),'UTF8') AS text FROM ch_messages WHERE session_id=? AND revision=? AND position=?",List(range.start,range.end,range.start+1,range.end-range.start,id,view.revision,range.position))
      }
      val selection=ReadSources.Selection(ReadSources.Query(parts.map(_.sql).mkString(" UNION ALL "),parts.flatMap(_.args)),"(source->>'messagePosition')::integer",1+2*MessageContextPolicy.maximumAdjacentMessages)
      val excerpts=bounded.selected(c,selection)(json => Wire.decode(ContextExcerpt.codecJson,json))
      Check(excerpts.size==ranges.size,"projection","context message projection missing")
      val first=excerpts.head.source; val last=excerpts.last.source
      val previous=if(first.start>0 || first.messagePosition>0) Some(Span(first.messageId,first.start,first.start)) else None
      val finalBytes=(center::rightMessages).find(_.position==last.messagePosition).get.bytes
      val next=if(last.end<finalBytes || last.messagePosition<located._2-1) Some(Span(last.messageId,last.end,last.end)) else None
      MessageContextPolicy.result(MessageContextResult(id,view,PassageSourceSpan(anchor.messageId,center.position,anchor.start,anchor.end),excerpts,previous,next))
    } catch {
      case error: SQLException if error.getSQLState=="57014" => throw DomainError("deadline","context statement deadline exceeded")
    }
  }
}
