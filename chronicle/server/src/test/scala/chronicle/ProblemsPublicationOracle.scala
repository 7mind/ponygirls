package chronicle

import chronicle.api.*
import java.nio.charset.StandardCharsets.UTF_8
import java.util.UUID

/** The in-memory publication of the release before the streamed one (ingest-limits spec §5.3), unchanged: the oracle the
  * streamed publication is compared with, and the shape the archive fixtures publish. */
final case class ProblemPieceLink(chunkId: UUID,passageOrdinal: Int,source: ProblemPassages.SourceSpan)
final case class ProblemSourceSpan(passageOrdinal: Int,ordinal: Long,source: ProblemPassages.SourceSpan)
final class ProblemsPublication private[chronicle] (val chunks: List[IndexedChunk],val passages: Vector[ProblemPassages.Passage],val spans: Vector[ProblemSourceSpan],val links: Vector[ProblemPieceLink],val context: Vector[ProblemPassages.SourceSpan]) {
  /** Against the claim's messages, read through `source`. */
  def validate(claim: Claim,dimensions: Int,source: ProblemPassages.Source): Unit = {
    Check(passages.map(_.ordinal)==passages.indices.toVector && passages.map(_.id).distinct.size==passages.size,"invalid","publication passage order/identity")
    Check(chunks.size==links.size && chunks.map(_.chunk.id).distinct.size==chunks.size,"invalid","publication piece identity/count")
    passages.foreach { passage =>
      def metadata(value: String,maximum: Int): Unit = Check(value.nonEmpty && !value.contains('\u0000') && UTF_8.newEncoder().canEncode(value) && value.codePointCount(0,value.length)<=maximum,"invalid","publication annotation bounds")
      metadata(passage.initialSummary,ProblemPassages.summaryScalars); metadata(passage.summary,ProblemPassages.summaryScalars)
      Check(passage.tags.size<=ProblemPassages.maximumTags && passage.tags.distinct==passage.tags,"invalid","publication tags")
      passage.tags.foreach(metadata(_,ProblemPassages.tagScalars))
    }
    def location(span: ProblemPassages.SourceSpan): (Int,Int) = (span.messagePosition,span.start)
    Check(context==context.sortBy(location) && links.map(_.source)==links.map(_.source).sortBy(location),"invalid","publication coverage order")
    var position=0; var chars=0; var offset=0
    def skipEmpty(): Unit = while(position<source.count && chars==source.message(position).text.length) { position+=1; chars=0; offset=0 }
    val coverage=links.zip(chunks).map { (link,indexed) =>
      Check(link.chunkId==indexed.chunk.id && indexed.chunk.sessionId==claim.sessionId,"invalid","publication piece/session identity")
      (link.source,Some(indexed))
    }++context.map(span => (span,None))
    coverage.sortBy(item => location(item._1)).foreach { (span,indexed) =>
      skipEmpty()
      Check(position<source.count,"invalid","publication coverage past source")
      val message=source.message(position)
      Check(span.messageId==message.id && span.messagePosition==position && span.start==offset && span.end>span.start,"invalid","publication source coverage")
      indexed.foreach { value =>
        val chunk=value.chunk; val size=chunk.text.getBytes(UTF_8).length
        Check(size>0 && size<=ProblemPassages.maximumFragmentBytes && UTF_8.newEncoder().canEncode(chunk.text) && !chunk.text.contains('\u0000'),"invalid","publication piece bounds")
        Check(span.end.toLong==offset.toLong+size && message.text.startsWith(chunk.text,chars) && chunk.spans==List(Span(span.messageId,span.start,span.end)),"invalid","publication piece source")
        Check(value.vector.size==dimensions && value.vector.forall(_.isFinite) && value.vector.exists(_!=0.0),"invalid","publication embedding")
      }
      while(offset<span.end && chars<message.text.length) {
        val scalar=message.text.codePointAt(chars)
        offset+=new String(Character.toChars(scalar)).getBytes(UTF_8).length; chars+=Character.charCount(scalar)
      }
      Check(offset==span.end,"invalid","publication coverage UTF8 boundary")
    }
    skipEmpty(); Check(position==source.count,"invalid","incomplete publication problem/context coverage")
    val expectedSpans=spans.iterator
    var passageOrdinal = -1; var pieceCount=0L; var sourceBytes=0L; var spanCount=0L
    var pending=Option.empty[ProblemPassages.SourceSpan]
    def flushSpan(): Unit = pending.foreach { span =>
      Check(expectedSpans.hasNext && expectedSpans.next()==ProblemSourceSpan(passageOrdinal,spanCount,span),"invalid","publication source span mismatch")
      spanCount+=1
    }
    var last=Option.empty[Chunk]
    def closePassage(): Unit = if(passageOrdinal>=0) {
      flushSpan()
      val passage=passages(passageOrdinal)
      // Under the metadata horizon a passage's last piece carries its final summary and tags.
      Check(last.exists(chunk => chunk.summary==passage.summary && chunk.tags==passage.tags),"invalid","publication final annotations")
      Check(passage.pieceCount==pieceCount && passage.sourceBytes==sourceBytes && passage.spanCount==spanCount && passage.end==pending.get.endPoint,"invalid","publication passage extents/counts")
    }
    chunks.iterator.zip(links.iterator).foreach { (indexed,link) =>
      val chunk=indexed.chunk; val span=link.source
      val size=chunk.text.getBytes(UTF_8).length
      if(link.passageOrdinal!=passageOrdinal) {
        closePassage()
        Check(link.passageOrdinal==passageOrdinal+1 && link.passageOrdinal<passages.size,"invalid","publication passage continuity")
        passageOrdinal=link.passageOrdinal; pieceCount=0; sourceBytes=0; spanCount=0; pending=None
        Check(passages(passageOrdinal).start==span.startPoint,"invalid","publication passage start")
      }
      pending match {
        case Some(previous) if previous.messagePosition==span.messagePosition && previous.messageId==span.messageId && previous.end==span.start => pending=Some(previous.copy(end=span.end))
        case _ => flushSpan(); pending=Some(span)
      }
      pieceCount+=1; sourceBytes+=size; last=Some(chunk)
    }
    closePassage()
    Check(passageOrdinal+1==passages.size && !expectedSpans.hasNext,"invalid","incomplete publication passages/spans")
  }
}
object ProblemsPublication {
  private final case class SpanKey(passageId: UUID,ordinal: Long)
  /** `windows`: per window appended, the passage open after it (its ordinal, summary and tags); `pieceWindows`: each piece's
    * window. A piece carries its passage's metadata after the window `horizon` windows after its own, or after the last
    * one (ingest-limits spec §5.6.2): the open passage's there, a closed passage's final one. */
  final class Builder private[ProblemsPublication] (private val metadata: Map[UUID,ProblemPassages.PassageUpdate],private val source: Map[SpanKey,ProblemPassages.SourceSpan],
    private val pieces: Vector[(ProblemPassages.RetrievalPiece,IndexedChunk)],private val state: Option[ProblemPassages.State],private val context: Vector[ProblemPassages.SourceSpan],
    private val horizon: Int,private val windows: Vector[Option[(Int,ProblemRows.Final)]],private val pieceWindows: Vector[Int]) {
    def append(delta: ProblemPassages.Delta,indexed: List[IndexedChunk]): Builder = {
      Check(!state.exists(_.finished) && state.forall(old => old.namespace==delta.state.namespace && old.sessionId==delta.state.sessionId),"invalid","publication builder state")
      Check(indexed.map(_.chunk)==delta.pieces.map(_.chunk).toList && delta.pieces.map(_.ordinal)==(pieces.size.toLong until pieces.size.toLong+indexed.size).toVector &&
        delta.state.nextPieceOrdinal==pieces.size.toLong+indexed.size,"invalid","publication indexed window mismatch")
      val window=if(delta.state.finished) windows else windows:+delta.state.open.map(open => (open.passage.ordinal,ProblemRows.Final(open.passage.summary,open.passage.tags)))
      new Builder(metadata++delta.passages.map(update => update.passage.id->update),source++delta.spans.map(update => SpanKey(update.passageId,update.ordinal)->update.span),
        pieces++delta.pieces.zip(indexed),Some(delta.state),context++delta.context,horizon,window,pieceWindows++Vector.fill(indexed.size)(windows.size))
    }
    def result: ProblemsPublication = {
      Check(state.exists(_.finished) && metadata.values.forall(_.closed),"invalid","publication requires finished source")
      val passages=metadata.values.map(_.passage).toVector.sortBy(_.ordinal)
      Check(passages.map(_.ordinal)==passages.indices.toVector && state.get.nextPassageOrdinal==passages.size,"invalid","publication final passage order/count")
      val ordinals=passages.map(p => p.id->p.ordinal).toMap
      def ordinal(id: UUID): Int = ordinals.getOrElse(id,throw DomainError("invalid","publication missing passage"))
      val spans=source.iterator.map((key,span) => ProblemSourceSpan(ordinal(key.passageId),key.ordinal,span)).toVector.sortBy(s => (s.passageOrdinal,s.ordinal))
      val chunks=pieces.zip(pieceWindows).map { case ((piece,indexed),window) =>
        val passage=passages(ordinal(piece.passageId))
        val value=windows(math.min(window.toLong+horizon,windows.size-1L).toInt).filter(_._1==passage.ordinal).fold(ProblemRows.Final(passage.summary,passage.tags))(_._2)
        indexed.copy(chunk=indexed.chunk.copy(summary=value.summary,tags=value.tags))
      }.toList
      new ProblemsPublication(chunks,passages,spans,pieces.map((piece,_) => ProblemPieceLink(piece.chunk.id,ordinal(piece.passageId),piece.sourceSpan)),context)
    }
  }
  def empty: Builder = empty(ProblemRows.metadataHorizonWindows)
  def empty(horizon: Int): Builder = new Builder(Map.empty,Map.empty,Vector.empty,None,Vector.empty,horizon,Vector.empty,Vector.empty)
  def info(passage: ProblemPassages.Passage): PassageInfo = PassageStorage.info(passage)
  /** The release's PassageStorage.persist and publication chunk loop, unchanged but for the tables' names (`prefix` + the
    * table): the generation's rows exactly as it wrote them. */
  def persist(c: java.sql.Connection,prefix: String,generation: UUID,publication: ProblemsPublication): Unit = {
    publication.chunks.zipWithIndex.foreach { case (x,ordinal) => Sql.exec(c,s"INSERT INTO ${prefix}ch_chunks(id,generation,value,document,embedding,ordinal) VALUES(?,?,?::jsonb,to_tsvector('english',?),?::vector,?)",x.chunk.id,generation,Wire.encode(Chunk.codecJson,x.chunk).noSpaces,s"${x.chunk.text} ${x.chunk.summary} ${x.chunk.tags.mkString(" ")}",x.vector.mkString("[",",","]"),ordinal) }
    publication.context.zipWithIndex.foreach { (span,ordinal) =>
      Sql.exec(c,s"INSERT INTO ${prefix}ch_context_spans VALUES(?,?,?,?,?,?)",generation,ordinal.toLong,span.messageId,span.messagePosition,span.start,span.end)
    }
    publication.passages.foreach { passage =>
      Sql.exec(c,s"INSERT INTO ${prefix}ch_problem_passages(generation,id,ordinal,initial_summary,value,span_count) VALUES(?,?,?,?,?::jsonb,?)",generation,passage.id,passage.ordinal,passage.initialSummary,Wire.encode(PassageInfo.codecJson,ProblemsPublication.info(passage)).noSpaces,passage.spanCount)
    }
    publication.spans.foreach { span =>
      val passage=publication.passages(span.passageOrdinal); val source=span.source
      Sql.exec(c,s"INSERT INTO ${prefix}ch_problem_spans(generation,passage_id,ordinal,message_id,message_position,start_byte,end_byte) VALUES(?,?,?,?,?,?,?)",generation,passage.id,span.ordinal,source.messageId,source.messagePosition,source.start,source.end)
    }
    publication.links.zipWithIndex.foreach { (link,ordinal) =>
      Sql.exec(c,s"INSERT INTO ${prefix}ch_problem_pieces(generation,chunk_id,passage_ordinal,piece_ordinal) VALUES(?,?,?,?)",generation,link.chunkId,link.passageOrdinal,ordinal)
    }
    publication.chunks.flatMap(_.chunk.tags).distinct.foreach(tag => Sql.exec(c,s"INSERT INTO ${prefix}ch_generation_tags(generation,tag) VALUES(?,?) ON CONFLICT DO NOTHING",generation,tag))
  }
  /** An in-memory publication as the rows an archive stages: one step holding every row. */
  def rows(publication: ProblemsPublication): ProblemRows = new ProblemRows {
    def parent: Option[PublicationParent] = None
    def passages(from: Int)(write: (Int,ProblemRows.Passages) => Unit): ProblemRows.Replayed = {
      if(from==0) write(0,ProblemRows.Passages(Vector.empty,publication.passages,
        publication.spans.map(span => ProblemPassages.SpanUpdate(publication.passages(span.passageOrdinal).id,span.ordinal,span.source)),
        publication.context.zipWithIndex.map((span,ordinal) => (ordinal.toLong,span))))
      ProblemRows.Replayed(ProblemRows.Counts(1,publication.passages.size,publication.chunks.size),None)
    }
    def pieces(from: Int,stored: ProblemRows.Stored)(write: (Int,Vector[ProblemRows.Piece]) => Unit): Unit =
      if(from==0) write(0,publication.chunks.zip(publication.links).zipWithIndex.map { case ((indexed,link),ordinal) =>
        ProblemRows.Piece(link.passageOrdinal,ordinal,indexed.chunk,indexed.vector,link.source)
      }.toVector)
  }
  /** The publication `rows` stage, in memory (the dummy archive's staging). */
  def collect(rows: ProblemRows): ProblemsPublication = {
    val passages=scala.collection.mutable.Map.empty[Int,ProblemPassages.Passage]
    val spans=Vector.newBuilder[ProblemPassages.SpanUpdate]; val context=Vector.newBuilder[ProblemPassages.SourceSpan]
    rows.passages(0) { (_,step) =>
      (step.opened++step.closed).foreach(passage => passages(passage.ordinal)=passage)
      spans++=step.spans; context++=step.context.map(_._2)
    }
    val ordered=passages.values.toVector.sortBy(_.ordinal)
    val ordinals=ordered.map(passage => passage.id->passage.ordinal).toMap
    val pieces=Vector.newBuilder[ProblemRows.Piece]
    rows.pieces(0,new ProblemRows.Stored {
      def passage(ordinal: Int): ProblemRows.Final = ProblemRows.Final(ordered(ordinal).summary,ordered(ordinal).tags)
      def members(from: Long,until: Long): Vector[ProblemRows.Piece] = throw new AssertionError("an in-memory publication is a root")
    }) { (_,step) => pieces++=step }
    val values=pieces.result()
    new ProblemsPublication(values.map(piece => IndexedChunk(piece.chunk,piece.vector)).toList,ordered,
      spans.result().map(span => ProblemSourceSpan(ordinals(span.passageId),span.ordinal,span.span)).sortBy(span => (span.passageOrdinal,span.ordinal)),
      values.map(piece => ProblemPieceLink(piece.chunk.id,piece.passageOrdinal,piece.source)),
      context.result())
  }
}
