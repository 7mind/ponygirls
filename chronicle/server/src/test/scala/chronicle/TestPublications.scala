package chronicle

import chronicle.api.*
import java.nio.charset.StandardCharsets.UTF_8
import java.util.UUID

/** Explicit synthetic coverage for archive/read fixtures; not an annotation executor. */
object TestPublications {
  /** Stores `chunks` as the claim's current-format publication without the publication validation (no passages, spans
    * or context): stored read-boundary payloads, including deliberately malformed or oversized chunks and tags.
    */
  def stored(db: Database,claim: Claim,chunks: List[IndexedChunk]): Unit = db.transaction { c =>
    val generation=UUID.randomUUID()
    Sql.exec(c,"INSERT INTO ch_generations(id,session_id,revision,profile,passage_format,passage_count,run_id) VALUES(?,?,?,?,'ContextAwareProblems',0,?)",generation,claim.sessionId,claim.revision,claim.profile,claim.runId)
    chunks.zipWithIndex.foreach { (indexed,ordinal) =>
      val chunk=indexed.chunk
      Sql.exec(c,"INSERT INTO ch_chunks(id,generation,value,document,embedding,ordinal) VALUES(?,?,?::jsonb,to_tsvector('english',?),?::vector,?)",chunk.id,generation,Wire.encode(Chunk.codecJson,chunk).noSpaces,s"${chunk.text} ${chunk.summary} ${chunk.tags.mkString(" ")}",indexed.vector.mkString("[",",","]"),ordinal)
    }
    chunks.flatMap(_.chunk.tags).distinct.foreach(tag => Sql.exec(c,"INSERT INTO ch_generation_tags(generation,tag) VALUES(?,?)",generation,tag))
    Sql.exec(c,"DELETE FROM ch_search_chunks WHERE session_id=?",claim.sessionId)
    Sql.exec(c,"INSERT INTO ch_search_chunks(id,generation,session_id,revision,profile,document,embedding) SELECT ch.id,ch.generation,g.session_id,g.revision,g.profile,ch.document,ch.embedding FROM ch_chunks ch JOIN ch_generations g ON g.id=ch.generation WHERE g.id=?",generation)
    Sql.exec(c,"UPDATE ch_sources SET published=? WHERE id=?",generation,claim.sessionId)
    Check(Sql.exec(c,"UPDATE ch_jobs SET state='Complete',error=NULL,failure_stage=NULL,lease_until=NULL WHERE id=? AND state='Running' AND run_id=?",claim.jobId,claim.runId)==1,"test","stored publication fixture job missing")
  }
  def from(claim: Claim,values: List[IndexedChunk]): ProblemsPublication = {
    val messages=claim.snapshot.messages
    val source=values.map { indexed =>
      Check(indexed.chunk.spans.size==1,"test","fixture requires one exact source span per retrieval piece")
      val span=indexed.chunk.spans.head
      val position=messages.indexWhere(_.id==span.messageId)
      Check(position>=0,"test","fixture message is absent")
      ProblemPassages.SourceSpan(span.messageId,position,span.start,span.end)
    }
    val chunks=values.map { indexed =>
      indexed.copy(chunk=indexed.chunk.copy(summary=if(indexed.chunk.summary.isEmpty) "synthetic problem" else indexed.chunk.summary))
    }
    val passages=chunks.zip(source).zipWithIndex.map { case ((indexed,span),ordinal) =>
      val id=UUID.nameUUIDFromBytes(s"synthetic-passage:${indexed.chunk.id}".getBytes(UTF_8))
      ProblemPassages.Passage(id,ordinal,indexed.chunk.summary,indexed.chunk.summary,indexed.chunk.tags,span.startPoint,span.endPoint,span.end.toLong-span.start,1L,1L)
    }.toVector
    val context=messages.zipWithIndex.flatMap { (message,position) =>
      var offset=0; val output=Vector.newBuilder[ProblemPassages.SourceSpan]
      source.filter(_.messagePosition==position).sortBy(_.start).foreach { span =>
        Check(span.start>=offset,"test","overlapping fixture coverage")
        if(span.start>offset) output+=ProblemPassages.SourceSpan(message.id,position,offset,span.start)
        offset=span.end
      }
      val end=message.text.getBytes(UTF_8).length
      if(offset<end) output+=ProblemPassages.SourceSpan(message.id,position,offset,end)
      output.result()
    }.toVector
    new ProblemsPublication(chunks,passages,source.zipWithIndex.map((span,i) => ProblemSourceSpan(i,0L,span)).toVector,
      chunks.zip(source).zipWithIndex.map { case ((indexed,span),i) => ProblemPieceLink(indexed.chunk.id,i,span) }.toVector,context)
  }
}
