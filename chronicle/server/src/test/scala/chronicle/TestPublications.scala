package chronicle

import chronicle.api.*
import java.nio.charset.StandardCharsets.UTF_8
import java.util.UUID

/** Explicit synthetic coverage for archive/read fixtures; not an annotation executor. */
object TestPublications {
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
