package chronicle

import chronicle.api.*
import java.nio.charset.StandardCharsets.UTF_8
import java.util.UUID

final case class ProblemPieceLink(chunkId: UUID,passageOrdinal: Int,source: ProblemPassages.SourceSpan)
final case class ProblemSourceSpan(passageOrdinal: Int,ordinal: Long,source: ProblemPassages.SourceSpan)
final class ProblemsPublication private (val chunks: List[IndexedChunk],val passages: Vector[ProblemPassages.Passage],val spans: Vector[ProblemSourceSpan],val links: Vector[ProblemPieceLink]) {
  def validate(claim: Claim,dimensions: Int): Unit = {
    val messages=ProblemPassages.Source(claim.snapshot.messages).messages
    Check(passages.map(_.ordinal)==passages.indices.toVector && passages.map(_.id).distinct.size==passages.size,"invalid","publication passage order/identity")
    Check(chunks.size==links.size && chunks.map(_.chunk.id).distinct.size==chunks.size,"invalid","publication piece identity/count")
    passages.foreach { passage =>
      def metadata(value: String,maximum: Int): Unit = Check(value.nonEmpty && !value.contains('\u0000') && UTF_8.newEncoder().canEncode(value) && value.codePointCount(0,value.length)<=maximum,"invalid","publication annotation bounds")
      metadata(passage.initialSummary,ProblemPassages.summaryScalars); metadata(passage.summary,ProblemPassages.summaryScalars)
      Check(passage.tags.size<=ProblemPassages.maximumTags && passage.tags.distinct==passage.tags,"invalid","publication tags")
      passage.tags.foreach(metadata(_,ProblemPassages.tagScalars))
    }
    var position=0; var chars=0; var offset=0
    def skipEmpty(): Unit = while(position<messages.size && chars==messages(position).text.length) { position+=1; chars=0; offset=0 }
    val expectedSpans=spans.iterator
    var passageOrdinal = -1; var pieceCount=0L; var sourceBytes=0L; var spanCount=0L
    var pending=Option.empty[ProblemPassages.SourceSpan]
    def flushSpan(): Unit = pending.foreach { span =>
      Check(expectedSpans.hasNext && expectedSpans.next()==ProblemSourceSpan(passageOrdinal,spanCount,span),"invalid","publication source span mismatch")
      spanCount+=1
    }
    def closePassage(): Unit = if(passageOrdinal>=0) {
      flushSpan()
      val passage=passages(passageOrdinal)
      Check(passage.pieceCount==pieceCount && passage.sourceBytes==sourceBytes && passage.spanCount==spanCount && passage.end==pending.get.endPoint,"invalid","publication passage extents/counts")
    }
    chunks.iterator.zip(links.iterator).foreach { (indexed,link) =>
      skipEmpty()
      val chunk=indexed.chunk; val span=link.source
      Check(position<messages.size && link.chunkId==chunk.id && chunk.sessionId==claim.sessionId,"invalid","publication source/session identity")
      val size=chunk.text.getBytes(UTF_8).length
      Check(size>0 && size<=ProblemPassages.maximumFragmentBytes && UTF_8.newEncoder().canEncode(chunk.text) && !chunk.text.contains('\u0000'),"invalid","publication piece bounds")
      val message=messages(position)
      Check(span.messageId==message.id && span.messagePosition==position && span.start==offset && span.end.toLong==offset.toLong+size && message.text.startsWith(chunk.text,chars),"invalid","publication source coverage")
      Check(chunk.spans==List(Span(span.messageId,span.start,span.end)),"invalid","publication piece span")
      Check(indexed.vector.size==dimensions && indexed.vector.forall(_.isFinite) && indexed.vector.exists(_!=0.0),"invalid","publication embedding")
      if(link.passageOrdinal!=passageOrdinal) {
        closePassage()
        Check(link.passageOrdinal==passageOrdinal+1 && link.passageOrdinal<passages.size,"invalid","publication passage continuity")
        passageOrdinal=link.passageOrdinal; pieceCount=0; sourceBytes=0; spanCount=0; pending=None
        Check(passages(passageOrdinal).start==span.startPoint,"invalid","publication passage start")
      }
      val passage=passages(passageOrdinal)
      Check(chunk.summary==passage.summary && chunk.tags==passage.tags,"invalid","publication final annotations")
      pending match {
        case Some(previous) if previous.messagePosition==span.messagePosition && previous.messageId==span.messageId && previous.end==span.start => pending=Some(previous.copy(end=span.end))
        case _ => flushSpan(); pending=Some(span)
      }
      pieceCount+=1; sourceBytes+=size; chars+=chunk.text.length; offset+=size
    }
    closePassage(); skipEmpty()
    Check(position==messages.size && passageOrdinal+1==passages.size && !expectedSpans.hasNext,"invalid","incomplete publication source/passages/spans")
  }
}
object ProblemsPublication {
  private final case class SpanKey(passageId: UUID,ordinal: Long)
  final class Builder private[ProblemsPublication] (private val metadata: Map[UUID,ProblemPassages.PassageUpdate],private val source: Map[SpanKey,ProblemPassages.SourceSpan],
    private val pieces: Vector[(ProblemPassages.RetrievalPiece,IndexedChunk)],private val state: Option[ProblemPassages.State]) {
    def append(delta: ProblemPassages.Delta,indexed: List[IndexedChunk]): Builder = {
      Check(!state.exists(_.finished) && state.forall(old => old.namespace==delta.state.namespace && old.sessionId==delta.state.sessionId),"invalid","publication builder state")
      Check(indexed.map(_.chunk)==delta.pieces.map(_.chunk).toList && delta.pieces.map(_.ordinal)==(pieces.size.toLong until pieces.size.toLong+indexed.size).toVector &&
        delta.state.nextPieceOrdinal==pieces.size.toLong+indexed.size,"invalid","publication indexed window mismatch")
      new Builder(metadata++delta.passages.map(update => update.passage.id->update),source++delta.spans.map(update => SpanKey(update.passageId,update.ordinal)->update.span),
        pieces++delta.pieces.zip(indexed),Some(delta.state))
    }
    def result: ProblemsPublication = {
      Check(state.exists(_.finished) && metadata.values.forall(_.closed),"invalid","publication requires finished source")
      val passages=metadata.values.map(_.passage).toVector.sortBy(_.ordinal)
      val ordinals=passages.map(p => p.id->p.ordinal).toMap
      def ordinal(id: UUID): Int = ordinals.getOrElse(id,throw DomainError("invalid","publication missing passage"))
      val spans=source.iterator.map((key,span) => ProblemSourceSpan(ordinal(key.passageId),key.ordinal,span)).toVector.sortBy(s => (s.passageOrdinal,s.ordinal))
      val chunks=pieces.map { (piece,indexed) =>
        val passage=passages(ordinal(piece.passageId))
        indexed.copy(chunk=indexed.chunk.copy(summary=passage.summary,tags=passage.tags))
      }.toList
      new ProblemsPublication(chunks,passages,spans,pieces.map((piece,_) => ProblemPieceLink(piece.chunk.id,ordinal(piece.passageId),piece.sourceSpan)))
    }
  }
  def empty: Builder = new Builder(Map.empty,Map.empty,Vector.empty,None)
  def info(passage: ProblemPassages.Passage): PassageInfo = {
    def point(value: ProblemPassages.SourcePoint): PassagePoint = PassagePoint(value.messageId,value.messagePosition,value.byteOffset)
    PassageInfo(passage.id,passage.ordinal,passage.summary,passage.tags,point(passage.start),point(passage.end),passage.sourceBytes,passage.spanCount,passage.pieceCount)
  }
}
