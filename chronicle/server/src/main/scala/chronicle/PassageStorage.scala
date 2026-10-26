package chronicle

import chronicle.api.*
import java.sql.Connection
import java.util.UUID

trait PassageReader {
  def passages(reader: String,id: UUID,offset: Int,limit: Int,selector: Option[ContentView]): PassagesResult
  def passageSpans(reader: String,id: UUID,passageId: UUID,offset: Int,limit: Int,selector: Option[ContentView]): PassageSpansResult
}
object PassageStorage {
  def initializeFormats(c: Connection): Unit = Sql.rows(c,"SELECT profile FROM ch_index_profiles WHERE policy='LegacyV4'")(_.getString(1)).foreach { profile =>
    IndexProfiles.registered(c,profile)
    Sql.exec(c,"UPDATE ch_generations SET passage_format='LegacyAnnotations' WHERE profile=? AND passage_format IS NULL",profile)
  }
  def requirePolicy(c: Connection,profile: String,expected: IndexPolicy): Unit = {
    IndexProfiles.registered(c,profile)
    Check(Sql.one(c,"SELECT policy FROM ch_index_profiles WHERE profile=?",profile)(_.getString(1)).contains(expected.toString),"invalid","publication payload does not match profile policy")
  }
  def persist(c: Connection,generation: UUID,publication: ProblemsPublication): Unit = {
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
  private def format(c: Connection,generation: UUID): (PassageFormat,Long) = Sql.one(c,"SELECT passage_format,passage_count FROM ch_generations WHERE id=?",generation) { row =>
    val format=Option(row.getString(1)).flatMap(PassageFormat.parse).filter(_!=PassageFormat.Unindexed).getOrElse(throw DomainError("unavailable","generation passage provenance is unknown"))
    (format,row.getLong(2))
  }.getOrElse(throw DomainError("not-found","content view not found"))
  def passages(c: Connection,view: ContentView,offset: Int,limit: Int): PassagesResult = view.generationId match {
    case None => PassagesResult(view,PassageFormat.Unindexed,Nil,0,offset)
    case Some(generation) =>
      val (kind,total)=format(c,generation)
      val rows=if(kind==PassageFormat.LegacyAnnotations) Nil else Sql.rows(c,"SELECT value FROM ch_problem_passages WHERE generation=? AND ordinal>=? ORDER BY ordinal LIMIT ?",generation,offset,limit)(r => Wire.decode(PassageInfo.codecJson,Sql.json(r,"value")))
      PassagesResult(view,kind,rows,total,offset)
  }
  def spans(c: Connection,view: ContentView,passageId: UUID,offset: Int,limit: Int): PassageSpansResult = {
    val generation=view.generationId.getOrElse(throw DomainError("invalid","passage spans require an indexed content view"))
    format(c,generation)
    val total=Sql.one(c,"SELECT span_count FROM ch_problem_passages WHERE generation=? AND id=?",generation,passageId)(_.getLong(1)).getOrElse(throw DomainError("not-found","passage not found"))
    val values=Sql.rows(c,"SELECT message_id,message_position,start_byte,end_byte FROM ch_problem_spans WHERE generation=? AND passage_id=? AND ordinal>=? ORDER BY ordinal LIMIT ?",generation,passageId,offset.toLong,limit)(r => PassageSourceSpan(r.getString(1),r.getInt(2),r.getInt(3),r.getInt(4)))
    PassageSpansResult(view,passageId,values,total,offset)
  }
}
