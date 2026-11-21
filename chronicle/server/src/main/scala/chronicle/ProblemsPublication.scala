package chronicle

import chronicle.api.*
import io.circe.Json
import java.nio.charset.StandardCharsets.UTF_8
import java.util.UUID

/** A finished job's publication, produced step by step from its persisted window results (ingest-limits spec §5.2.4):
  * the steps are its windows in order, then the finishing step that closes the last passage. An archive stages the rows
  * in bounded batches, resumes at a step, and switches to the generation once every row is written. */
trait ProblemRows {
  /** The published generation this publication continues (ingest-limits spec §5.6.2): its steps are the windows from the
    * parent's cut on, and its rows are those the parent's lineage does not hold; None: a root, from window 0. */
  def parent: Option[PublicationParent]
  /** P1: each step's passage, source span and Context span rows from step `from` on; the steps before it are replayed
    * and validated, not handed to `write`. Returns the publication's passage and piece counts and the cut its lineage's
    * next version continues from. */
  def passages(from: Int)(write: (Int,ProblemRows.Passages) => Unit): ProblemRows.Replayed
  /** P2: each step's pieces from step `from` on, with the summary and tags of their passage under the metadata horizon
    * (`stored` reads a staged passage's final ones by ordinal) and their vectors; for an incremental publication first
    * the parent's pieces it rewrites (`stored` reads them), at the steps of their windows. */
  def pieces(from: Int,stored: ProblemRows.Stored)(write: (Int,Vector[ProblemRows.Piece]) => Unit): Unit
}
/** The published generation an incremental publication continues: its lineage, version and cut. */
final case class PublicationParent(generation: UUID,lineage: UUID,version: Int,cut: ProblemRows.Cut)
object ProblemRows {
  /** A piece carries its passage's summary and tags as they stood after the window `indexing.metadataHorizonWindows`
    * after its own, or after the passage's last window (ingest-limits spec §5.6.2). The default, the largest value, gives
    * every piece its passage's final metadata (as before the horizon): a revision that appends to a session then writes
    * again the pieces of the passage open at its first re-done window when that passage's metadata changes. A finite
    * horizon (an operator's choice) bounds those to the pieces of that many windows before it. Passage rows keep the final
    * metadata. Part of no profile. */
  val metadataHorizonWindows: Int = Int.MaxValue
  /** One step's rows: passages seen for the first time and still open (stored as they stand, as their spans refer to
    * them), passages closed by the step (final), source spans that are final (an open passage's last span is not: the
    * next window may extend it) and Context spans with their ordinals. */
  final case class Passages(opened: Vector[ProblemPassages.Passage],closed: Vector[ProblemPassages.Passage],spans: Vector[ProblemPassages.SpanUpdate],context: Vector[(Long,ProblemPassages.SourceSpan)])
  final case class Final(summary: String,tags: List[String])
  /** A piece's chunk carries its passage's summary and tags under the metadata horizon; `source` is where it lies in the
    * source. */
  final case class Piece(passageOrdinal: Int,ordinal: Int,chunk: Chunk,vector: Seq[Double],source: ProblemPassages.SourceSpan)
  /** `steps`: the windows and the finishing step. */
  final case class Counts(steps: Int,passages: Int,pieces: Int)
  /** P1's result: the counts and, for a publication of at least one window, the cut its lineage's next version continues
    * from. */
  final case class Replayed(counts: Counts,cut: Option[Cut])
  /** Rows phase P reads back: a staged passage's final summary and tags, the summary and tags the parent's pieces at
    * `ordinals` carry (in their order), and the pieces (member chunks) of the parent with ordinals in [from, until). */
  trait Stored {
    def passage(ordinal: Int): Final
    def carried(ordinals: Vector[Long]): Vector[Final]
    def members(from: Long,until: Long): Vector[Piece]
  }
  /** Where the next version of a lineage continues (ingest-limits spec §5.6.2): before the generation's last window
    * `window`, the passage state, the Context spans written before it, the streamed validation, the first piece ordinal
    * of each window from max(0, window - horizon, the window the open passage opened in) to `window` (the last one is the
    * state's next piece: only the open passage's pieces of those windows can change) and the horizon its pieces' metadata
    * follows (a lineage never mixes horizons). */
  final case class Cut(window: Int,horizon: Int,state: ProblemPassages.State,context: Long,validation: Validation.Snapshot,firstPieces: Vector[Long]) {
    Check(window>=0 && horizon>=1 && context>=0 && firstPieces.nonEmpty && firstPieces.size<=math.min(window,horizon)+1 && firstPieces.lastOption.contains(state.nextPieceOrdinal) &&
      firstPieces.zip(firstPieces.drop(1)).forall((a,b) => a<=b) &&
      (firstPieces.size==math.min(window,horizon)+1 || state.open.forall(open => state.nextPieceOrdinal-open.passage.pieceCount>=firstPieces.head)),"internal","invalid lineage cut")
    /** The first window whose first piece is known. */
    def firstWindow: Int = window-firstPieces.size+1
  }
  object Cut {
    def json(cut: Cut): Json = Json.obj("window"->Json.fromInt(cut.window),"horizon"->Json.fromInt(cut.horizon),"state"->ProblemPassages.stateJson(cut.state),
      "context"->Json.fromLong(cut.context),"validation"->Validation.json(cut.validation),"firstPieces"->Json.arr(cut.firstPieces.map(Json.fromLong)*))
    /** The cut, continued by the run `namespace` (ProblemPassages.restore). */
    def decode(json: Json,sessionId: UUID,namespace: UUID): Cut = {
      val c=json.hcursor
      def value[A: io.circe.Decoder](field: String): A = c.get[A](field).getOrElse(throw DomainError("internal","invalid lineage cut"))
      Cut(value[Int]("window"),value[Int]("horizon"),ProblemPassages.restore(value[Json]("state"),sessionId,namespace),value[Long]("context"),
        Validation.decode(value[Json]("validation")),value[Vector[Long]]("firstPieces"))
    }
  }

  /** The passages' final source spans step by step: each step's span updates replace the pending ones by key; every span
    * except the open passage's last one is final. */
  final class Spans(initial: Vector[ProblemPassages.SpanUpdate]=Vector.empty) {
    private var pending=initial
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
  final class Validation(sessionId: UUID,from: Option[Validation.Snapshot]=None) {
    private val start=from.getOrElse(Validation.Snapshot(None,0,0,0L,None,Vector.empty,Vector.empty))
    private var frontier=start.frontier
    private var opened=start.opened
    private var closed=start.closed
    private var pieces=start.pieces
    private final case class Current(id: UUID,ordinal: Int,var pieces: Long,var bytes: Long,var spans: Long,var pending: Option[ProblemPassages.SourceSpan])
    private var current=start.current.map(value => Current(value.id,value.ordinal,value.pieces,value.bytes,value.spans,value.pending))
    private var coalesced=start.coalesced
    private var stored=start.stored
    /** Where the validation stands between windows (a lineage's cut). */
    def snapshot: Validation.Snapshot =
      Validation.Snapshot(frontier,opened,closed,pieces,current.map(value => Validation.Open(value.id,value.ordinal,value.pieces,value.bytes,value.spans,value.pending)),coalesced,stored)
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
  object Validation {
    /** The passage whose pieces the validation counts, as `Current`. */
    final case class Open(id: UUID,ordinal: Int,pieces: Long,bytes: Long,spans: Long,pending: Option[ProblemPassages.SourceSpan])
    final case class Snapshot(frontier: Option[(Int,Int)],opened: Int,closed: Int,pieces: Long,current: Option[Open],coalesced: Vector[ProblemPassages.SpanUpdate],stored: Vector[ProblemPassages.SpanUpdate])
    private def spanJson(span: ProblemPassages.SourceSpan): Json =
      Json.obj("messageId"->Json.fromString(span.messageId),"messagePosition"->Json.fromInt(span.messagePosition),"start"->Json.fromInt(span.start),"end"->Json.fromInt(span.end))
    private def updateJson(update: ProblemPassages.SpanUpdate): Json =
      Json.obj("passageId"->Json.fromString(update.passageId.toString),"ordinal"->Json.fromLong(update.ordinal),"span"->spanJson(update.span))
    def json(value: Snapshot): Json = Json.obj(
      "frontier"->value.frontier.fold(Json.Null)((position,offset) => Json.arr(Json.fromInt(position),Json.fromInt(offset))),
      "opened"->Json.fromInt(value.opened),"closed"->Json.fromInt(value.closed),"pieces"->Json.fromLong(value.pieces),
      "current"->value.current.fold(Json.Null)(open => Json.obj("id"->Json.fromString(open.id.toString),"ordinal"->Json.fromInt(open.ordinal),"pieces"->Json.fromLong(open.pieces),
        "bytes"->Json.fromLong(open.bytes),"spans"->Json.fromLong(open.spans),"pending"->open.pending.fold(Json.Null)(spanJson))),
      "coalesced"->Json.arr(value.coalesced.map(updateJson)*),"stored"->Json.arr(value.stored.map(updateJson)*))
    def decode(json: Json): Snapshot = {
      def invalid: Nothing = throw DomainError("internal","invalid lineage cut validation")
      def value[A: io.circe.Decoder](cursor: io.circe.ACursor,field: String): A = cursor.get[A](field).getOrElse(invalid)
      def span(cursor: io.circe.ACursor): ProblemPassages.SourceSpan =
        ProblemPassages.SourceSpan(value[String](cursor,"messageId"),value[Int](cursor,"messagePosition"),value[Int](cursor,"start"),value[Int](cursor,"end"))
      def updates(field: String): Vector[ProblemPassages.SpanUpdate] = json.hcursor.downField(field).values.getOrElse(invalid).toVector.map { item =>
        val c=item.hcursor; ProblemPassages.SpanUpdate(java.util.UUID.fromString(value[String](c,"passageId")),value[Long](c,"ordinal"),span(c.downField("span")))
      }
      val c=json.hcursor
      val frontier=c.downField("frontier").focus.filterNot(_.isNull).map(_ => value[(Int,Int)](c,"frontier"))
      val current=c.downField("current").focus.filterNot(_.isNull).map { _ =>
        val o=c.downField("current")
        Open(java.util.UUID.fromString(value[String](o,"id")),value[Int](o,"ordinal"),value[Long](o,"pieces"),value[Long](o,"bytes"),value[Long](o,"spans"),
          o.downField("pending").focus.filterNot(_.isNull).map(_ => span(o.downField("pending"))))
      }
      Snapshot(frontier,value[Int](c,"opened"),value[Int](c,"closed"),value[Long](c,"pieces"),current,updates("coalesced"),updates("stored"))
    }
  }
}
