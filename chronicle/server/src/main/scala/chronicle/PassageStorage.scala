package chronicle

import chronicle.api.*
import java.sql.Connection
import java.util.UUID

trait PassageReader {
  def passages(reader: String,id: UUID,offset: Int,limit: Int,selector: Option[ContentView]): PassagesResult
  def passageSpans(reader: String,id: UUID,passageId: UUID,offset: Int,limit: Int,selector: Option[ContentView]): PassageSpansResult
}
object PassageStorage {
  def requirePolicy(c: Connection,profile: String,expected: IndexPolicy): Unit = {
    IndexProfiles.registered(c,profile)
    Check(Sql.one(c,"SELECT policy FROM ch_index_profiles WHERE profile=?",profile)(_.getString(1)).contains(expected.toString),"invalid","publication payload does not match profile policy")
  }
  def persist(c: Connection,generation: UUID,publication: ProblemsPublication): Unit = {
    publication.context.zipWithIndex.foreach { (span,ordinal) =>
      Sql.exec(c,"INSERT INTO ch_context_spans VALUES(?,?,?,?,?,?)",generation,ordinal.toLong,span.messageId,span.messagePosition,span.start,span.end)
    }
    publication.passages.foreach { passage =>
      Sql.exec(c,"INSERT INTO ch_problem_passages(generation,id,ordinal,initial_summary,value,span_count) VALUES(?,?,?,?,?::jsonb,?)",generation,passage.id,passage.ordinal,passage.initialSummary,Wire.encode(PassageInfo.codecJson,ProblemsPublication.info(passage)).noSpaces,passage.spanCount)
    }
    publication.spans.foreach { span =>
      val passage=publication.passages(span.passageOrdinal); val source=span.source
      Sql.exec(c,"INSERT INTO ch_problem_spans(generation,passage_id,ordinal,message_id,message_position,start_byte,end_byte) VALUES(?,?,?,?,?,?,?)",generation,passage.id,span.ordinal,source.messageId,source.messagePosition,source.start,source.end)
    }
    publication.links.zipWithIndex.foreach { (link,ordinal) =>
      Sql.exec(c,"INSERT INTO ch_problem_pieces(generation,chunk_id,passage_ordinal,piece_ordinal) VALUES(?,?,?,?)",generation,link.chunkId,link.passageOrdinal,ordinal)
    }
  }
  /** Generated tags are derived content: a visible publication that is not retired and not in the current format (a
    * leftover) refuses the whole read, as Database.selectView refuses a view of it. */
  def requireCurrentPublications(c: Connection,visible: String,reader: String): Unit =
    Check(Sql.one(c,s"SELECT 1 FROM ch_sources s JOIN ch_generations g ON g.id=s.published WHERE ($visible) AND NOT g.retired AND g.passage_format IS DISTINCT FROM ? LIMIT 1",
      reader,reader,reader,PassageFormat.ContextAwareProblems.toString)(_ => true).isEmpty,"unavailable","a visible publication is not in the current passage format")
  /** `view` comes from Database.selectView, which admits a generation only in the current format. */
  def passages(c: Connection,view: ContentView,offset: Int,limit: Int): PassagesResult = view.generationId match {
    case None => PassagesResult(view,PassageFormat.Unindexed,Nil,0,offset)
    case Some(generation) =>
      val total=Sql.one(c,"SELECT passage_count FROM ch_generations WHERE id=?",generation)(_.getLong(1)).getOrElse(throw DomainError("not-found","content view not found"))
      val rows=Sql.rows(c,"SELECT value FROM ch_problem_passages WHERE generation=? AND ordinal>=? ORDER BY ordinal LIMIT ?",generation,offset,limit)(r => Wire.decode(PassageInfo.codecJson,Sql.json(r,"value")))
      PassagesResult(view,PassageFormat.ContextAwareProblems,rows,total,offset)
  }
  def spans(c: Connection,view: ContentView,passageId: UUID,offset: Int,limit: Int): PassageSpansResult = {
    val generation=view.generationId.getOrElse(throw DomainError("invalid","passage spans require an indexed content view"))
    val total=Sql.one(c,"SELECT span_count FROM ch_problem_passages WHERE generation=? AND id=?",generation,passageId)(_.getLong(1)).getOrElse(throw DomainError("not-found","passage not found"))
    val values=Sql.rows(c,"SELECT message_id,message_position,start_byte,end_byte FROM ch_problem_spans WHERE generation=? AND passage_id=? AND ordinal>=? ORDER BY ordinal LIMIT ?",generation,passageId,offset.toLong,limit)(r => PassageSourceSpan(r.getString(1),r.getInt(2),r.getInt(3),r.getInt(4)))
    PassageSpansResult(view,passageId,values,total,offset)
  }
}
