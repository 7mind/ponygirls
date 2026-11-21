package chronicle

import chronicle.api.*
import java.nio.charset.StandardCharsets.UTF_8
import java.util.UUID

/** A finished job's publication, produced step by step from its persisted window results (ingest-limits spec §5.2.4):
  * the steps are its windows in order, then the finishing step that closes the last passage. An archive stages the rows
  * in bounded batches, resumes at a step, and switches to the generation once every row is written. */
trait ProblemRows {
  /** P1: each step's passage, source span and Context span rows from step `from` on; the steps before it are replayed
    * and validated, not handed to `write`. Returns the publication's passage and piece counts. */
  def passages(from: Int)(write: (Int,ProblemRows.Passages) => Unit): ProblemRows.Counts
  /** P2: each step's pieces from step `from` on, with the final summary and tags of their passage (`passage` reads it
    * from the staged rows by ordinal) and their vectors. */
  def pieces(from: Int,passage: Int => ProblemRows.Final)(write: (Int,Vector[ProblemRows.Piece]) => Unit): Unit
}
object ProblemRows {
  /** One step's rows: passages seen for the first time and still open (stored as they stand, as their spans refer to
    * them), passages closed by the step (final), source spans that are final (an open passage's last span is not: the
    * next window may extend it) and Context spans with their ordinals. */
  final case class Passages(opened: Vector[ProblemPassages.Passage],closed: Vector[ProblemPassages.Passage],spans: Vector[ProblemPassages.SpanUpdate],context: Vector[(Long,ProblemPassages.SourceSpan)])
  final case class Final(summary: String,tags: List[String])
  /** A piece's chunk carries its passage's final summary and tags; `source` is where it lies in the source. */
  final case class Piece(passageOrdinal: Int,ordinal: Int,chunk: Chunk,vector: Seq[Double],source: ProblemPassages.SourceSpan)
  /** `steps`: the windows and the finishing step. */
  final case class Counts(steps: Int,passages: Int,pieces: Int)

  /** The passages' final source spans step by step: each step's span updates replace the pending ones by key; every span
    * except the open passage's last one is final. */
  final class Spans {
    private var pending=Vector.empty[ProblemPassages.SpanUpdate]
    def step(delta: ProblemPassages.Delta): Vector[ProblemPassages.SpanUpdate] = {
      // In source order: a key keeps the place of its first update.
      val updated=scala.collection.mutable.LinkedHashMap.empty[(UUID,Long),ProblemPassages.SpanUpdate]
      (pending++delta.spans).foreach(span => updated((span.passageId,span.ordinal))=span)
      val open=delta.state.open.map(value => (value.passage.id,value.passage.spanCount-1))
      val (kept,released)=updated.values.toVector.partition(span => open.contains((span.passageId,span.ordinal)))
      pending=kept; released
    }
  }

  /** ProblemsPublication's validation (now the test oracle), window by window (ingest-limits spec §5.2.4): windows cover
    * consecutive disjoint ranges of the source, so each window's coverage (pieces and Context spans in source order)
    * tiles exactly that window's fragments, which are exact slices of the messages, continuing where the previous window
    * ended. Spans are coalesced again from the pieces and must equal the final spans the publication stores; each
    * passage's counts and extents are checked when it closes. Memory: one window and its passages' counters. */
  final class Validation(sessionId: UUID) {
    private var frontier=Option.empty[(Int,Int)]
    private var opened=0
    private var closed=0
    private var pieces=0L
    private final case class Current(id: UUID,ordinal: Int,var pieces: Long,var bytes: Long,var spans: Long,var pending: Option[ProblemPassages.SourceSpan])
    private var current=Option.empty[Current]
    private var coalesced=Vector.empty[ProblemPassages.SpanUpdate]
    private var stored=Vector.empty[ProblemPassages.SpanUpdate]
    private def metadata(value: String,maximum: Int): Unit =
      Check(value.nonEmpty && !value.contains('\u0000') && UTF_8.newEncoder().canEncode(value) && value.codePointCount(0,value.length)<=maximum,"invalid","publication annotation bounds")
    private def location(span: ProblemPassages.SourceSpan): (Int,Int) = (span.messagePosition,span.start)
    private def flush(value: Current): Unit = value.pending.foreach { span =>
      coalesced:+=ProblemPassages.SpanUpdate(value.id,value.spans,span); value.spans+=1; value.pending=None
    }
    /** The passage whose pieces ended closes in the same step: a Problem part that does not continue it opens the next. */
    private def close(value: Current,delta: ProblemPassages.Delta): Unit = {
      val passage=delta.passages.find(update => update.closed && update.passage.id==value.id).map(_.passage).getOrElse(throw DomainError("invalid","publication passage order/identity"))
      metadata(passage.initialSummary,ProblemPassages.summaryScalars); metadata(passage.summary,ProblemPassages.summaryScalars)
      Check(passage.tags.size<=ProblemPassages.maximumTags && passage.tags.distinct==passage.tags,"invalid","publication tags")
      passage.tags.foreach(metadata(_,ProblemPassages.tagScalars))
      val end=value.pending.map(_.endPoint)
      flush(value)
      Check(passage.ordinal==closed && passage.pieceCount==value.pieces && passage.sourceBytes==value.bytes && passage.spanCount==value.spans && end.contains(passage.end),"invalid","publication passage extents/counts")
      closed+=1; current=None
    }
    private def compareSpans(finalSpans: Vector[ProblemPassages.SpanUpdate]): Unit = {
      stored++=finalSpans
      val paired=coalesced.size.min(stored.size)
      Check(coalesced.take(paired)==stored.take(paired),"invalid","publication source span mismatch")
      coalesced=coalesced.drop(paired); stored=stored.drop(paired)
    }
    /** One window's delta and the final spans stored for it. */
    def window(window: ProblemPassages.Window,delta: ProblemPassages.Delta,finalSpans: Vector[ProblemPassages.SpanUpdate]): Unit = {
      val coverage=(delta.pieces.map(piece => (piece.sourceSpan,Some(piece)))++delta.context.map(span => (span,None))).sortBy(item => location(item._1))
      var index=0
      window.fragments.foreach { fragment =>
        frontier.foreach { (position,offset) =>
          Check((fragment.messagePosition==position && fragment.byteStart==offset) || (fragment.messagePosition>position && fragment.byteStart==0),"invalid","publication source coverage")
        }
        val text=fragment.text.getBytes(UTF_8)
        var offset=fragment.byteStart
        while(offset<fragment.byteEnd) {
          Check(index<coverage.size,"invalid","incomplete publication problem/context coverage")
          val (span,piece)=coverage(index)
          Check(span.messageId==fragment.messageId && span.messagePosition==fragment.messagePosition && span.start==offset && span.end>span.start && span.end<=fragment.byteEnd,"invalid","publication source coverage")
          piece.foreach { value =>
            val chunk=value.chunk
            Check(UTF_8.newEncoder().canEncode(chunk.text) && !chunk.text.contains('\u0000'),"invalid","publication piece bounds")
            Check(java.util.Arrays.equals(chunk.text.getBytes(UTF_8),java.util.Arrays.copyOfRange(text,span.start-fragment.byteStart,span.end-fragment.byteStart)) &&
              chunk.spans==List(Span(span.messageId,span.start,span.end)) && chunk.sessionId==sessionId,"invalid","publication piece source")
          }
          offset=span.end; index+=1
        }
        frontier=Some((fragment.messagePosition,fragment.byteEnd))
      }
      Check(index==coverage.size,"invalid","publication coverage past source")
      val closing=closed
      delta.pieces.foreach { piece =>
        Check(piece.ordinal==pieces,"invalid","publication piece identity/count"); pieces+=1
        if(!current.exists(_.id==piece.passageId)) {
          current.foreach(close(_,delta))
          val passage=delta.passages.map(_.passage).find(_.id==piece.passageId).getOrElse(throw DomainError("invalid","publication missing passage"))
          Check(passage.ordinal==opened && passage.start==piece.sourceSpan.startPoint,"invalid","publication passage continuity")
          opened+=1; current=Some(Current(passage.id,passage.ordinal,0,0,0,None))
        }
        val value=current.get; val span=piece.sourceSpan
        value.pending match {
          case Some(previous) if previous.messagePosition==span.messagePosition && previous.messageId==span.messageId && previous.end==span.start => value.pending=Some(previous.copy(end=span.end))
          case _ => flush(value); value.pending=Some(span)
        }
        value.pieces+=1; value.bytes+=span.end-span.start
      }
      Check(delta.passages.count(_.closed)==closed-closing && delta.passages.forall(update => update.passage.ordinal<opened),"invalid","publication passage order/identity")
      compareSpans(finalSpans)
    }
    /** The finishing step: every passage closed, every piece and span accounted for. */
    def finish(steps: Int,delta: ProblemPassages.Delta,finalSpans: Vector[ProblemPassages.SpanUpdate]): Counts = {
      Check(delta.state.finished && delta.pieces.isEmpty && delta.context.isEmpty && delta.passages.size==current.size,"invalid","publication requires finished source")
      current.foreach(close(_,delta))
      compareSpans(finalSpans)
      Check(closed==opened && opened==delta.state.nextPassageOrdinal && pieces==delta.state.nextPieceOrdinal && coalesced.isEmpty && stored.isEmpty,"invalid","incomplete publication passages/spans")
      Check(pieces<=Int.MaxValue,"invalid","publication piece ordinal exceeds the chunk ordinal range")
      Counts(steps,opened,pieces.toInt)
    }
  }
}
