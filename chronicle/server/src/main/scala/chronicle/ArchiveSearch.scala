package chronicle

import chronicle.api.*
import io.circe.Json
import java.sql.Connection
import java.util.UUID

object ArchiveSearchPolicy {
  val maximumPageSize=10
  val maximumMatches=2
  val maximumSourceBytes=64L*1024
  val maximumResultBytes=128L*1024
  val statementDeadlineMillis=30000
  // Per plan node, not per request: avoid lossy trigram bitmaps without changing the database-wide setting.
  val minimumLexicalWorkMemory="16MB"
  def configureLexical(c: Connection): Unit = {
    Sql.exec(c,"SELECT set_config('work_mem',greatest(pg_size_bytes(current_setting('work_mem')),pg_size_bytes(?))::text||'B',true)",minimumLexicalWorkMemory)
    ()
  }
  def page(limit: Int): Unit = Check(limit>=1 && limit<=maximumPageSize,"invalid","invalid archive search page bounds")
  def materialization(caller: ReadMaterialization): ReadMaterialization = {
    var consumed=0L
    ReadMaterialization.admitted(new ReadAdmission {
      def consume(bytes: Long): Unit = {
        val next=ReadSources.sum(List(consumed,bytes))
        Check(next<=maximumSourceBytes,"read-budget","archive search source byte budget exceeded")
        caller.admit(bytes)
        consumed=next
      }
    })
  }
  def result(value: ArchiveSearchResult): ArchiveSearchResult = {
    Check(JsonUtf8Size(Wire.encode(Result.codecJson,Result.ArchiveSearch(value)))<=maximumResultBytes,"read-budget","archive search result byte budget exceeded")
    value
  }
}
private[chronicle] final case class ArchiveSemanticWitness(operand: Int,id: UUID,view: ContentView)
private[chronicle] object ArchiveSearchWitnesses {
  def decode(json: Json): List[ArchiveSemanticWitness] = json.asArray.getOrElse(throw DomainError("projection","invalid archive witnesses")).toList.map { value =>
    val c=value.hcursor
    ArchiveSemanticWitness(c.get[Int]("operand").toTry.get,UUID.fromString(c.get[String]("id").toTry.get),ContentView(c.get[Int]("revision").toTry.get,Some(UUID.fromString(c.get[String]("generation").toTry.get))))
  }
  /** A page row's first matching message positions of one literal, ascending. */
  def positions(json: Json): List[Int] = {
    val values=json.as[List[Int]].getOrElse(throw DomainError("projection","invalid archive literal positions"))
    Check(values.size<=ArchiveSearchPolicy.maximumMatches && values.forall(_>=0) && values==values.distinct.sorted,"projection","invalid archive literal positions")
    values
  }
  /** `literal`: by text operand index, the first matching message positions of the head's epoch (PageRow). */
  def read(c: Connection,archive: PostgresArchive,reader: String,row: ArchiveRow,parsed: ParsedArchiveExpression,semantic: List[ArchiveSemanticWitness],literal: Map[Int,List[Int]],materialization: ReadMaterialization): List[ArchiveSourceMatch] = {
    val positives=ArchiveExpression.positiveTextOperands(parsed)
    val lexical=if(parsed.mode==SearchMode.Semantic || positives.isEmpty) Nil else {
      val (view,content)=archive.selectContent(c,reader,row.head.id,Some(row.head.view),materialization)
      val maximum=if(semantic.nonEmpty) 1 else ArchiveSearchPolicy.maximumMatches
      val candidates=positives.zipWithIndex.flatMap((operand,index) => literal.get(parsed.textOperands.indexOf(operand)).map(index -> _)).toMap
      val selection=literalSelection(content,positives,maximum,candidates)
      materialization.selected(c,selection) { json =>
        val cursor=json.hcursor
        Check(cursor.get[Boolean]("valid").contains(true),"projection","invalid archive literal coordinate projection")
        val operand=cursor.get[Int]("operand").toTry.get
        Check(operand>=0 && operand<positives.size,"projection","invalid archive literal operand")
        val span=Span(cursor.get[String]("messageId").toTry.get,cursor.get[Int]("start").toTry.get,cursor.get[Int]("end").toTry.get)
        Check(span.start>=0 && span.end>span.start,"projection","invalid archive literal span")
        ArchiveSourceMatch(view,span,ArchiveMatchKind.Literal,positives(operand),None)
      }
    }
    var remaining=ArchiveSearchPolicy.maximumMatches-lexical.size
    val annotated=List.newBuilder[ArchiveSourceMatch]
    semantic.foreach { witness =>
      if(remaining>0) {
        Check(witness.operand>=0 && witness.operand<parsed.textOperands.size && positives.contains(parsed.textOperands(witness.operand)),"projection","invalid archive semantic operand")
        val view=archive.selectView(c,reader,row.head.id,Some(witness.view),materialization)
        val selection=ReadSources.Selection(GenerationRows.chunk(view.generationId.get,witness.id),"value->>'id'",1)
        val chunk=materialization.selected(c,selection)(json => Wire.decode(Chunk.codecJson,json.hcursor.downField("value").focus.get)).headOption.getOrElse(throw DomainError("projection","archive semantic witness missing"))
        Check(chunk.id==witness.id && chunk.sessionId==row.head.id && chunk.spans.nonEmpty,"projection","invalid archive semantic witness")
        val selected=chunk.spans.take(remaining)
        selected.foreach { span =>
          Check(span.start>=0 && span.end>span.start,"projection","invalid archive semantic span")
          annotated+=ArchiveSourceMatch(view,span,ArchiveMatchKind.Semantic,parsed.textOperands(witness.operand),Some(chunk.summary))
        }
        remaining-=selected.size
      }
    }
    lexical++annotated.result()
  }

  /** The first `maximum` matches of `operands` in `content`'s messages by operand and position. An operand with
    * `candidates` (by operand index: its first matching message positions, ascending) reads only those messages; the
    * others share one scan of every message. */
  private[chronicle] def literalSelection(content: RevisionContent,operands: List[String],maximum: Int,candidates: Map[Int,List[Int]]): ReadSources.Selection = {
    Check(candidates.isEmpty || content.isInstanceOf[RevisionContent.Epoch],"projection","archive literal candidates outside an epoch")
    Check(candidates.keys.forall(operands.indices.contains),"projection","invalid archive literal operand")
    val stored=content.messages
    val values=operands.zipWithIndex.map { (_,index) => s"($index,lower(? COLLATE pg_unicode_fast))" }.mkString(",")
    val (listed,scanned)=operands.indices.toList.partition(candidates.contains)
    def hits(restriction: String): String =
      s"""(SELECT operand,message_id,position,value->>'text' AS body,strpos(lower((value->>'text') COLLATE pg_unicode_fast),needle)-1 AS at,char_length(needle) AS width
        FROM ${stored.sql} m CROSS JOIN operands WHERE $restriction strpos(lower((value->>'text') COLLATE pg_unicode_fast),needle)>0
        ORDER BY operand,position LIMIT $maximum)"""
    val scan=if(scanned.isEmpty) Nil else List(hits(if(listed.isEmpty) "" else scanned.mkString("operand IN(",",",") AND")) -> stored.args)
    // The positions (integers) are a constant array: a bound one is an expression to the planner, which then may read the
    // whole epoch through its (epoch,message_id) key and filter it instead of looking the positions up in the primary key.
    val reads=listed.map(index => hits(s"operand=$index AND m.position=ANY('${candidates(index).mkString("{",",","}")}'::int[]) AND") -> stored.args)
    val branches=scan++reads
    // pg_unicode_fast uses Unicode default lowercase: only U+0130 expands; contextual sigma changes value, not length.
    // Prefix *lengths*, not independently folded characters, map whole-field folded coordinates monotonically.
    val sql=s"""WITH RECURSIVE operands(operand,needle) AS (VALUES $values),
      found AS MATERIALIZED(SELECT * FROM (${branches.map(_._1).mkString(" UNION ALL ")}) hits ORDER BY operand,position LIMIT $maximum),
      targets AS (SELECT f.*,edge,CASE WHEN edge=0 THEN at ELSE at+width END AS target FROM found f CROSS JOIN (VALUES(0),(1)) edges(edge)),
      search(operand,message_id,position,body,at,width,edge,target,lo,hi) AS (
        SELECT operand,message_id,position,body,at,width,edge,target,0,char_length(body) FROM targets
        UNION ALL
        SELECT operand,message_id,position,body,at,width,edge,target,
          CASE WHEN char_length(lower(left(body,(lo+hi)/2) COLLATE pg_unicode_fast))<target THEN (lo+hi)/2+1 ELSE lo END,
          CASE WHEN char_length(lower(left(body,(lo+hi)/2) COLLATE pg_unicode_fast))<target THEN hi ELSE (lo+hi)/2 END
        FROM search WHERE lo<hi),
      boundaries AS (SELECT *,CASE WHEN edge=0 AND char_length(lower(left(body,lo) COLLATE pg_unicode_fast))>target THEN lo-1 ELSE lo END AS scalar FROM search WHERE lo=hi),
      spans AS (SELECT operand,message_id,position,body,at,width,min(scalar) FILTER(WHERE edge=0) AS first,max(scalar) FILTER(WHERE edge=1) AS last FROM boundaries GROUP BY operand,message_id,position,body,at,width)
      SELECT operand,message_id AS "messageId",position,octet_length(left(body,first)) AS start,octet_length(left(body,last)) AS end,
        (first>=0 AND last>first AND last<=char_length(body)
        AND char_length(lower(left(body,first) COLLATE pg_unicode_fast))<=at
        AND char_length(lower(left(body,first+1) COLLATE pg_unicode_fast))>at
        AND char_length(lower(left(body,last) COLLATE pg_unicode_fast))>=at+width
        AND char_length(lower(left(body,last-1) COLLATE pg_unicode_fast))<at+width) AS valid FROM spans"""
    ReadSources.Selection(ReadSources.Query(sql,operands:::branches.flatMap(_._2)),"operand,position",maximum)
  }
}
