package chronicle

import chronicle.api.*
import java.sql.Connection
import java.util.UUID
import scala.util.Using

trait PassageReader {
  def passages(reader: String,id: UUID,offset: Int,limit: Int,selector: Option[ContentView]): PassagesResult
  def passageSpans(reader: String,id: UUID,passageId: UUID,offset: Int,limit: Int,selector: Option[ContentView]): PassageSpansResult
}
/** Where a staged generation's run continues (migration 026): its phase and the first step whose rows are not all
  * written; from P2 on also the publication's counts; `invalid`: phase W discarded embedding parts since chunks were
  * written, so they are written again; `lineageTags`: a root whose every batch this release wrote (migration 028), so its
  * lineage tag counts are complete (a release before 028 rewrites the resume point without it); `parent`: an incremental
  * publication's parent (spec §5.6.2), None for a root; `horizon`: the metadata horizon its pieces, tag counts and cut
  * follow (None: staged by a release before the horizon). */
enum StagedPhase { case Passages,Pieces }
final case class StagedGeneration(generation: UUID,phase: StagedPhase,step: Int,counts: Option[ProblemRows.Counts],invalid: Boolean=false,lineageTags: Boolean=false,parent: Option[UUID]=None,horizon: Option[Int]=None)
object PassageStorage {
  /** A staged generation's rows are written in committed batches of at most this many rows and bytes (spec §5.2.4). */
  val rowsPerBatch = 500
  val bytesPerBatch: Long = 8L*1024*1024
  /** Parallel search-row writers of the process (spec D15): two to three times one writer's HNSW insertions. They share
    * the connection pool (8 by default) with everything else, so all publications together use at most these. */
  val searchRowWriters = 4
  /** Rows a statement deleting a generation's rows touches (search rows of a replaced generation, rows of an abandoned
    * staged one). */
  val rowsPerStatement = 10000
  /** Segment rows of the latest version of a lineage (parameters: lineage, kind, major, ordinal) whose ranges end after
    * (major, ordinal): open (`until` NULL) and switched (`since` set). Read through ch_lineage_segments_open, so an
    * incremental publication examines the rows around its tail, never the lineage's history (closed rows, the runs
    * before its rewrite region). */
  private val openSegments = "lineage=? AND kind=? AND since IS NOT NULL AND until IS NULL AND (hi_major,hi)>(?,?)"
  /** The lineage of `generation`, which must be its latest version (an incremental publication's parent: one job per source,
    * and the switch requires it to be published). */
  private def latest(c: Connection,generation: UUID): UUID =
    Sql.one(c,"SELECT g.lineage FROM ch_generations g WHERE g.id=? AND g.lineage_version=(SELECT max(v.lineage_version) FROM ch_generations v WHERE v.lineage=g.lineage)",generation)(_.getObject(1,classOf[UUID]))
      .getOrElse(throw DomainError("stale-claim","the parent is no longer its lineage's latest version"))
  def requirePolicy(c: Connection,profile: String,expected: IndexPolicy): Unit = {
    IndexProfiles.registered(c,profile)
    Check(Sql.one(c,"SELECT policy FROM ch_index_profiles WHERE profile=?",profile)(_.getString(1)).contains(expected.toString),"invalid","publication payload does not match profile policy")
  }
  def info(passage: ProblemPassages.Passage): PassageInfo = {
    def point(value: ProblemPassages.SourcePoint): PassagePoint = PassagePoint(value.messageId,value.messagePosition,value.byteOffset)
    PassageInfo(passage.id,passage.ordinal,passage.summary,passage.tags,point(passage.start),point(passage.end),passage.sourceBytes,passage.spanCount,passage.pieceCount)
  }
  private def batch(c: Connection,sql: String,rows: Iterable[Seq[Sql.Param]]): Unit = if(rows.nonEmpty) Using.resource(c.prepareStatement(sql)) { p =>
    rows.foreach { row => Sql.bind(p,row); p.addBatch() }
    p.executeBatch(); ()
  }

  private def resumeJson(staged: StagedGeneration): String =
    io.circe.Json.obj(("step"->io.circe.Json.fromInt(staged.step))::staged.counts.toList.flatMap(value => List("steps"->io.circe.Json.fromInt(value.steps),"passages"->io.circe.Json.fromInt(value.passages),"pieces"->io.circe.Json.fromInt(value.pieces)))++
      Option.when(staged.invalid)("invalid"->io.circe.Json.True)++Option.when(staged.lineageTags)("lineageTags"->io.circe.Json.True)++
      staged.parent.map(value => "parent"->io.circe.Json.fromString(value.toString))++staged.horizon.map(value => "horizon"->io.circe.Json.fromInt(value))*).noSpaces
  /** The staged generation of the job's run, locked against the sweep for the caller's transaction. */
  def staged(c: Connection,jobId: UUID,runId: UUID): Option[StagedGeneration] =
    Sql.one(c,"SELECT generation,phase,resume FROM ch_staged_generations WHERE job_id=? AND run_id=? AND run_id<>generation FOR NO KEY UPDATE",jobId,runId) { r =>
      val resume=Sql.json(r,"resume").hcursor
      def field(name: String): Option[Int] = resume.get[Int](name).toOption
      val counts=for { steps <- field("steps"); passages <- field("passages"); pieces <- field("pieces") } yield ProblemRows.Counts(steps,passages,pieces)
      StagedGeneration(r.getObject(1,classOf[UUID]),StagedPhase.valueOf(r.getString(2)),field("step").getOrElse(throw DomainError("internal","invalid staged generation resume point")),counts,
        resume.get[Boolean]("invalid").getOrElse(false),resume.get[Boolean]("lineageTags").getOrElse(false),resume.get[String]("parent").toOption.map(UUID.fromString),resume.get[Int]("horizon").toOption)
    }
  /** P0: a new staged generation of the claim's run, no row written yet. It is a root (spec §5.6.2): the first version
    * of its own lineage, whose segments hold all its own rows, invisible (`since` NULL) until its switch. */
  def stage(c: Connection,claim: Claim,horizon: Int): StagedGeneration = {
    val generation=UUID.randomUUID()
    Sql.exec(c,"INSERT INTO ch_generations(id,session_id,revision,profile,passage_format,passage_count,run_id,lineage) VALUES(?,?,?,?,?,0,?,?)",generation,claim.sessionId,claim.revision,claim.profile,PassageFormat.ContextAwareProblems.toString,claim.runId,generation)
    batch(c,"INSERT INTO ch_lineage_segments(lineage,origin,kind,since,until,lo_major,lo,hi_major,hi,staged_by) VALUES(?,?,?,NULL,NULL,0,0,?,?,?)",
      GenerationRows.Kind.values.toList.map(kind => List(generation,generation,kind.sql,GenerationRows.openMajor,GenerationRows.openEnd,generation)))
    val staged=StagedGeneration(generation,StagedPhase.Passages,0,None,lineageTags=true,horizon=Some(horizon))
    Sql.exec(c,"INSERT INTO ch_staged_generations(generation,job_id,run_id,phase,resume) VALUES(?,?,?,'Passages',?::jsonb)",generation,claim.jobId,claim.runId,resumeJson(staged))
    staged
  }
  /** P0 of an incremental publication (spec §5.6.2): the next version of the parent's lineage, labeled as a lineage
    * generation, without a version until its switch; its segment rows are written by its switch. */
  def stageIncremental(c: Connection,claim: Claim,parent: PublicationParent,horizon: Int): StagedGeneration = {
    val generation=UUID.randomUUID()
    Sql.exec(c,"INSERT INTO ch_generations(id,session_id,revision,profile,passage_format,passage_count,run_id,lineage) VALUES(?,?,?,?,?,0,?,?)",generation,claim.sessionId,claim.revision,claim.profile,GenerationRows.lineageFormat,claim.runId,parent.lineage)
    val staged=StagedGeneration(generation,StagedPhase.Passages,0,None,parent=Some(parent.generation),horizon=Some(horizon))
    Sql.exec(c,"INSERT INTO ch_staged_generations(generation,job_id,run_id,phase,resume) VALUES(?,?,?,'Passages',?::jsonb)",generation,claim.jobId,claim.runId,resumeJson(staged))
    staged
  }
  /** Records where the run continues; false when the run no longer owns the staged generation (abandoned or gone). */
  def resume(c: Connection,claim: Claim,staged: StagedGeneration): Boolean =
    Sql.exec(c,"UPDATE ch_staged_generations SET phase=?,resume=?::jsonb WHERE generation=? AND job_id=? AND run_id=?",staged.phase.toString,resumeJson(staged),staged.generation,claim.jobId,claim.runId)==1
  /** The run's staged chunks are written again from step 0 (phase W discarded embedding parts they may come from). */
  def invalidatePieces(c: Connection,claim: Claim): Unit = {
    Sql.exec(c,"""UPDATE ch_staged_generations SET resume=jsonb_set(resume,'{step}','0'::jsonb)||'{"invalid":true}'::jsonb WHERE job_id=? AND run_id=? AND run_id<>generation AND phase='Pieces'""",claim.jobId,claim.runId); ()
  }
  /** A lineage generation's lineage row, written with its last passage batch: its parent (None for a root), piece count and
    * the cut its lineage's next version continues from (None: it is never a parent). A generation staged by a release
    * before 028 (no lineage) has none. */
  def writeLineage(c: Connection,generation: UUID,parent: Option[UUID],cut: Option[ProblemRows.Cut],pieces: Int): Unit = {
    // NULLIF: an absent parent or cut is stored as NULL.
    Sql.exec(c,"""INSERT INTO ch_generation_lineage(generation,parent,last_window,cut,pieces) SELECT ?,NULLIF(?,'')::uuid,NULLIF(?,-1),NULLIF(?,'')::jsonb,? WHERE EXISTS(SELECT 1 FROM ch_generations WHERE id=? AND lineage IS NOT NULL)
      ON CONFLICT(generation) DO UPDATE SET parent=excluded.parent,last_window=excluded.last_window,cut=excluded.cut,pieces=excluded.pieces""",
      generation,parent.fold("")(_.toString),cut.fold(-1)(_.window),cut.fold("")(value => ProblemRows.Cut.json(value).noSpaces),pieces.toLong,generation); ()
  }
  /** A root's switch (spec §5.6.2): version 0 of its lineage, its segments valid from it; the lineage of the generation it
    * replaces is retired afterwards (`retireLineage`). At most four segment rows change. A generation staged by a release
    * before 028 has no lineage: it is published as it was staged, holding its own rows. A root that such a release wrote
    * batches of (`lineageTags` false: its tag counts miss those batches' chunks) is published without a lineage too: its
    * segment and lineage rows go, its tag rows are retired afterwards; it is never a parent. */
  def switchRoot(c: Connection,generation: UUID,previous: Option[UUID],lineageTags: Boolean): Unit = {
    if(lineageTags) {
      Sql.exec(c,"UPDATE ch_generations SET lineage_version=0 WHERE id=? AND lineage=id AND lineage_version IS NULL",generation)
      Sql.exec(c,"UPDATE ch_lineage_segments SET since=0 WHERE lineage=? AND staged_by=? AND since IS NULL",generation,generation)
    } else if(Sql.exec(c,"UPDATE ch_generations SET lineage=NULL WHERE id=? AND lineage=id",generation)==1) {
      Sql.exec(c,"DELETE FROM ch_lineage_segments WHERE lineage=? AND origin=?",generation,generation)
      Sql.exec(c,"DELETE FROM ch_generation_lineage WHERE generation=?",generation)
      Sql.exec(c,"INSERT INTO ch_lineage_retirements(lineage) VALUES(?) ON CONFLICT DO NOTHING",generation)
    }
    previous.foreach(id => Sql.exec(c,"INSERT INTO ch_lineage_retirements(lineage) SELECT lineage FROM ch_generations WHERE id=? AND lineage IS NOT NULL AND lineage<>? ON CONFLICT DO NOTHING",id,generation))
  }
  /** The switch of an incremental publication (spec §5.6.2 step 3, "Membership of a partly unchanged R"): version v+1 of
    * the parent's lineage (the parent is version v). Per kind its own ranges replace what version v held there: B's
    * passage row and the passages after it, B's last span and the spans after it, the Context spans from the cut, and its
    * pieces (the runs of rewritten windows before the cut and every piece from the cut's window on). Each segment row valid
    * at v that overlaps them is closed (until = v+1) and its parts outside them are inserted again with their origin,
    * valid from v+1 (so a window whose metadata stayed keeps its rows and ids); its own rows are valid from v+1. The
    * parent's pieces it supersedes are queued for search-row retirement; its staged tag changes are applied to the
    * lineage's counts (a count that reaches 0 goes). Returns the segment rows closed and inserted. */
  def switchIncremental(c: Connection,session: UUID,generation: UUID,parent: PublicationParent): (Int,Int) = {
    import scala.math.Ordering.Implicits.*
    type Point=(Int,Long)
    val cut=parent.cut; val version=parent.version; val next=version+1
    Check(latest(c,parent.generation)==parent.lineage,"internal","an incremental publication's parent is not of its lineage")
    Check(Sql.exec(c,"UPDATE ch_generations SET lineage_version=? WHERE id=? AND lineage=? AND lineage_version IS NULL",next,generation,parent.lineage)==1,"internal","an incremental publication is not a staged version of its parent's lineage")
    val end: Point=(GenerationRows.openMajor,GenerationRows.openEnd)
    val first=cut.state.nextPieceOrdinal
    // Adjacent ranges merged: consecutive rewritten windows, and the last one with the pieces from the cut's window.
    def merged(ranges: List[(Point,Point)]): List[(Point,Point)] = ranges.foldLeft(List.empty[(Point,Point)]) { (result,range) =>
      result match { case (lo,hi)::rest if hi==range._1 => (lo,range._2)::rest; case _ => range::result }
    }.reverse
    val open=cut.state.open
    // The windows before the cut whose pieces of the open passage it wrote again, each whole (Replay.pieces): a probe of
    // each window's first one, not a read of every rewritten piece (under the default horizon, all of the passage's).
    val bFirst=open.fold(first)(value => first-value.passage.pieceCount)
    val windows=cut.firstPieces.zip(cut.firstPieces.drop(1)).map((lo,hi) => (math.max(lo,bFirst),hi)).filter((lo,hi) => lo<hi)
    val written=if(windows.isEmpty) Set.empty[Long] else Sql.rows(c,"SELECT o FROM unnest(?::int[]) o WHERE EXISTS(SELECT 1 FROM ch_chunks WHERE generation=? AND ordinal=o)",
      windows.map(_._1).mkString("{",",","}"),generation)(_.getLong(1)).toSet
    val rewritten=windows.filter((lo,_) => written(lo)).toList
    val own: List[(GenerationRows.Kind,List[(Point,Point)])]=List(
      GenerationRows.Kind.Piece->merged(rewritten.map((lo,hi) => ((0,lo),(0,hi))):+((0,first),end)),
      GenerationRows.Kind.Passage->List(((0,open.fold(cut.state.nextPassageOrdinal)(_.passage.ordinal).toLong),end)),
      GenerationRows.Kind.Span->List((open.fold((cut.state.nextPassageOrdinal,0L))(value => (value.passage.ordinal,value.passage.spanCount-1)),end)),
      GenerationRows.Kind.Context->List(((0,cut.context),end)))
    val parentPieces=Sql.one(c,"SELECT pieces FROM ch_generation_lineage WHERE generation=?",parent.generation)(_.getLong(1)).getOrElse(throw DomainError("internal","the parent has no lineage row"))
    var closed=0; var inserted=0
    def insert(kind: GenerationRows.Kind,origin: UUID,lo: Point,hi: Point,stagedBy: Option[UUID]): Unit = {
      Sql.exec(c,"INSERT INTO ch_lineage_segments(lineage,origin,kind,since,until,lo_major,lo,hi_major,hi,staged_by) VALUES(?,?,?,?,NULL,?,?,?,?,NULLIF(?,'')::uuid)",
        parent.lineage,origin,kind.sql,next,lo._1,lo._2,hi._1,hi._2,stagedBy.fold("")(_.toString))
      inserted+=1
    }
    own.foreach { (kind,ranges) =>
      val start=ranges.head._1
      val query=tailSegments(parent.lineage,kind,start)
      val valid=Sql.rows(c,query.sql,query.args*) { r =>
        (r.getString(1),r.getObject(2,classOf[UUID]),(r.getInt(3),r.getLong(4)): Point,(r.getInt(5),r.getLong(6)): Point,Option(r.getObject(7,classOf[UUID])))
      }
      valid.foreach { (ctid,origin,lo,hi,stagedBy) =>
        val overlapping=ranges.filter((from,until) => from<hi && lo<until)
        if(overlapping.nonEmpty) {
          Sql.exec(c,"UPDATE ch_lineage_segments SET until=? WHERE ctid=?::tid",next,ctid); closed+=1
          // The parts of the row outside this version's own ranges stay members.
          val (kept,last)=overlapping.foldLeft((List.empty[(Point,Point)],lo)) { case ((parts,from),(ownFrom,ownUntil)) =>
            (if(from<ownFrom) (from,ownFrom)::parts else parts,if(ownUntil>from) ownUntil else from)
          }
          ((if(last<hi) (last,hi)::kept else kept).reverse).foreach((from,until) => insert(kind,origin,from,until,stagedBy))
          if(kind==GenerationRows.Kind.Piece) overlapping.foreach { (ownFrom,ownUntil) =>
            val superseded=(math.max(lo._2,ownFrom._2),math.min(math.min(hi._2,ownUntil._2),parentPieces))
            if(superseded._1<superseded._2) Sql.exec(c,"INSERT INTO ch_search_retirements(session_id,origin,piece_lo,piece_hi) VALUES(?,?,?,?)",session,origin,Math.toIntExact(superseded._1),Math.toIntExact(superseded._2))
          }
        }
      }
      ranges.foreach((from,until) => insert(kind,generation,from,until,Some(generation)))
    }
    Sql.exec(c,"""MERGE INTO ch_lineage_tags t USING (SELECT tag,delta FROM ch_lineage_tag_deltas WHERE generation=?) d ON t.lineage=? AND t.tag=d.tag
      WHEN MATCHED AND t.pieces+d.delta=0 THEN DELETE WHEN MATCHED THEN UPDATE SET pieces=t.pieces+d.delta WHEN NOT MATCHED THEN INSERT(lineage,tag,pieces) VALUES(?,d.tag,d.delta)""",
      generation,parent.lineage,parent.lineage)
    Sql.exec(c,"DELETE FROM ch_lineage_tag_deltas WHERE generation=?",generation)
    (closed,inserted)
  }
  /** Marks a staged generation abandoned: no run resumes it, and its rows go in bounded statements. A staged generation
    * whose job has none of its run's chances left (`job` absent): its job ended, was retried as another run or is gone. */
  def abandon(c: Connection,generation: UUID): Unit = { Sql.exec(c,"UPDATE ch_staged_generations SET run_id=generation WHERE generation=?",generation); () }
  /** Staged generations whose job no longer runs or will run them: not Queued or Running with their run. */
  def stale(c: Connection): List[UUID] =
    Sql.rows(c,"SELECT st.generation FROM ch_staged_generations st JOIN ch_jobs j ON j.id=st.job_id WHERE st.run_id<>st.generation AND (j.state NOT IN('Queued','Running') OR j.run_id<>st.run_id) ORDER BY st.generation")(_.getObject(1,classOf[UUID]))
  /** Under the job row's share lock, so a retry that makes the run live again waits and then finds it abandoned. */
  def abandonIfStale(c: Connection,generation: UUID): Boolean =
    Sql.one(c,"SELECT j.state NOT IN('Queued','Running') OR j.run_id<>st.run_id FROM ch_staged_generations st JOIN ch_jobs j ON j.id=st.job_id WHERE st.generation=? AND st.run_id<>st.generation FOR SHARE OF j",generation)(_.getBoolean(1)).contains(true) && { abandon(c,generation); true }
  /** The job's staged generations of other runs, marked abandoned, with those marked before: a retry of a job that is
    * not Complete keeps its run, whose chunk ids a staged generation of it holds until it is deleted. */
  def abandonOtherRuns(c: Connection,claim: Claim): List[UUID] = {
    Sql.exec(c,"UPDATE ch_staged_generations SET run_id=generation WHERE job_id=? AND run_id<>? AND run_id<>generation",claim.jobId,claim.runId)
    Sql.rows(c,"SELECT generation FROM ch_staged_generations WHERE job_id=? AND run_id=generation ORDER BY generation",claim.jobId)(_.getObject(1,classOf[UUID]))
  }
  def abandoned(c: Connection): List[UUID] = Sql.rows(c,"SELECT generation FROM ch_staged_generations WHERE run_id=generation ORDER BY generation")(_.getObject(1,classOf[UUID]))
  /** One bounded statement deleting an abandoned staged generation's rows (chunks take their search rows and pieces with
    * them, passages their spans), the generation itself last; false once nothing is left. */
  def deleteAbandonedStep(c: Connection,generation: UUID): Boolean = {
    val abandoned=Sql.one(c,"SELECT 1 FROM ch_staged_generations WHERE generation=? AND run_id=generation FOR UPDATE",generation)(_ => true).contains(true)
    abandoned && {
      val first=Sql.one(c,"SELECT min(ordinal) FROM ch_chunks WHERE generation=?",generation)(r => Option(r.getObject(1)).map(_ => r.getInt(1))).flatten
      def bounded(table: String,column: String): Int =
        Sql.exec(c,s"DELETE FROM $table WHERE ctid=ANY(ARRAY(SELECT ctid FROM $table WHERE $column=? LIMIT $rowsPerStatement))",generation)
      first match {
        case Some(from) => Sql.exec(c,"DELETE FROM ch_chunks WHERE generation=? AND ordinal>=? AND ordinal<?",generation,from,from+rowsPerStatement); true
        case None =>
          // A staged root's lineage tags are its own (lineage = generation); its segments and lineage row go with it.
          List("ch_problem_spans"->"generation","ch_problem_passages"->"generation","ch_context_spans"->"generation","ch_generation_tags"->"generation",
            "ch_lineage_tags"->"lineage","ch_lineage_tag_deltas"->"generation").exists((table,column) => bounded(table,column)>0) ||
            { Sql.exec(c,"DELETE FROM ch_generations WHERE id=?",generation); false }
      }
    }
  }

  /** An abandoned staged generation deleted, a bounded statement per transaction. */
  def deleteAbandoned(db: Database,generation: UUID): Unit = while(db.transaction(deleteAbandonedStep(_,generation))) {}
  /** A retired generation's search rows or derived rows deleted, a bounded statement per transaction. */
  def retire(db: Database,generation: UUID): Unit = {
    var cursor=Option(Retirement.start)
    while(cursor.nonEmpty) cursor=db.transaction(retireStep(_,generation,cursor.get))
  }
  /** Where a retirement continues: after chunk id `after`, valid for the kind of retirement (`payload`) it was taken in. */
  final case class Retirement(after: UUID,payload: Boolean)
  object Retirement { val start: Retirement = Retirement(new UUID(0L,0L),false) }

  /** P1 rows of a batch, in the order their references need. */
  def writePassages(c: Connection,generation: UUID,rows: Seq[ProblemRows.Passages]): Unit = {
    def passage(value: ProblemPassages.Passage): Seq[Sql.Param] =
      List(generation,value.id,value.ordinal,value.initialSummary,Wire.encode(PassageInfo.codecJson,info(value)).noSpaces,value.spanCount)
    batch(c,"INSERT INTO ch_problem_passages(generation,id,ordinal,initial_summary,value,span_count) VALUES(?,?,?,?,?::jsonb,?) ON CONFLICT DO NOTHING",rows.flatMap(_.opened).map(passage))
    batch(c,"INSERT INTO ch_problem_passages(generation,id,ordinal,initial_summary,value,span_count) VALUES(?,?,?,?,?::jsonb,?) ON CONFLICT(generation,id) DO UPDATE SET value=excluded.value,span_count=excluded.span_count",rows.flatMap(_.closed).map(passage))
    batch(c,"INSERT INTO ch_generation_tags(generation,tag) VALUES(?,?) ON CONFLICT DO NOTHING",rows.flatMap(_.closed).flatMap(_.tags).distinct.map(tag => List(generation,tag)))
    batch(c,"INSERT INTO ch_problem_spans(generation,passage_id,ordinal,message_id,message_position,start_byte,end_byte) VALUES(?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
      rows.flatMap(_.spans).map(span => List(generation,span.passageId,span.ordinal,span.span.messageId,span.span.messagePosition,span.span.start,span.span.end)))
    batch(c,"INSERT INTO ch_context_spans VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING",rows.flatMap(_.context).map((ordinal,span) => List(generation,ordinal,span.messageId,span.messagePosition,span.start,span.end)))
  }
  /** P2 rows: chunks as the in-memory publication stored them (its JSON, document and vector text) and their pieces, the
    * generation tags of a root (the distinct tags of its chunks, as the in-memory publication stored them), and the tag
    * counts of the chunks this batch inserts (a resumed step writes rows again that an earlier batch committed with their
    * counts): a root's lineage tag counts (pieces per tag), an incremental publication's staged changes of its lineage's
    * counts (spec §5.6.2: + the tags of its pieces, - those of the parent's pieces they replace). A generation staged by a
    * release before 028 (no lineage) has no counts. */
  def writePieces(c: Connection,generation: UUID,pieces: Seq[ProblemRows.Piece],parent: Option[PublicationParent]): Unit = if(pieces.nonEmpty) {
    val ordinals=pieces.map(_.ordinal)
    val present=Sql.rows(c,"SELECT id FROM ch_chunks WHERE generation=? AND ordinal>=? AND ordinal<=?",generation,ordinals.min,ordinals.max)(_.getObject(1,classOf[UUID])).toSet
    batch(c,"INSERT INTO ch_chunks(id,generation,value,document,embedding,ordinal) VALUES(?,?,?::jsonb,to_tsvector('english',?),?::vector,?) ON CONFLICT DO NOTHING",pieces.map { piece =>
      val chunk=piece.chunk
      List(chunk.id,generation,Wire.encode(Chunk.codecJson,chunk).noSpaces,s"${chunk.text} ${chunk.summary} ${chunk.tags.mkString(" ")}",piece.vector.mkString("[",",","]"),piece.ordinal)
    })
    batch(c,"INSERT INTO ch_problem_pieces(generation,chunk_id,passage_ordinal,piece_ordinal) VALUES(?,?,?,?) ON CONFLICT DO NOTHING",pieces.map(piece => List(generation,piece.chunk.id,piece.passageOrdinal,piece.ordinal)))
    val inserted=pieces.filterNot(piece => present(piece.chunk.id))
    def counts(tags: Seq[List[String]]): Map[String,Long] = tags.flatMap(_.distinct).groupMapReduce(identity)(_ => 1L)(_+_)
    parent match {
      case None =>
        batch(c,"INSERT INTO ch_generation_tags(generation,tag) VALUES(?,?) ON CONFLICT DO NOTHING",pieces.flatMap(_.chunk.tags).distinct.map(tag => List(generation,tag)))
        batch(c,"INSERT INTO ch_lineage_tags(lineage,tag,pieces) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM ch_generations WHERE id=? AND lineage=id) ON CONFLICT(lineage,tag) DO UPDATE SET pieces=ch_lineage_tags.pieces+excluded.pieces",
          counts(inserted.map(_.chunk.tags)).toList.sortBy(_._1).map((tag,count) => List(generation,tag,count,generation)))
      case Some(value) if inserted.nonEmpty =>
        val replacing=inserted.map(_.ordinal).toSet
        val (from,until)=(replacing.min.toLong,replacing.max.toLong+1)
        val replaced=Sql.rows(c,s"""SELECT ch.ordinal,ch.value->'tags' FROM ch_lineage_segments m JOIN ch_chunks ch ON ch.generation=m.origin
          AND ch.ordinal>=greatest(m.lo,?) AND ch.ordinal<least(m.hi,?) WHERE $openSegments AND m.lo<?""",
          from,until,latest(c,value.generation),GenerationRows.Kind.Piece.sql,0,from,until)(r => (r.getInt(1),Wire.parse(r.getString(2)).as[List[String]].getOrElse(throw DomainError("internal","invalid stored chunk tags"))))
          .collect { case (ordinal,tags) if replacing(ordinal) => tags }
        val delta=(counts(inserted.map(_.chunk.tags)).toList++counts(replaced).toList.map((tag,count) => (tag,-count))).groupMapReduce(_._1)(_._2)(_+_).filter(_._2!=0L)
        batch(c,"INSERT INTO ch_lineage_tag_deltas(generation,tag,delta) VALUES(?,?,?) ON CONFLICT(generation,tag) DO UPDATE SET delta=ch_lineage_tag_deltas.delta+excluded.delta",
          delta.toList.sortBy(_._1).map((tag,count) => List(generation,tag,count)))
      case Some(_) => ()
    }
  }
  /** The parent's pieces (its member chunks) with ordinals in [from, until), in ordinal order, with their passage ordinals,
    * vectors and source positions (an epoch revision's message positions). */
  def members(c: Connection,parent: UUID,session: UUID,revision: Int,from: Long,until: Long): Vector[ProblemRows.Piece] = {
    val query=membersQuery(latest(c,parent),session,revision,from,until)
    Sql.rows(c,query.sql,query.args*) { r =>
      val chunk=Wire.decode(Chunk.codecJson,Sql.json(r,"value"))
      val vector=r.getString(3).stripPrefix("[").stripSuffix("]").split(',').toVector.map(_.toDouble)
      val span=chunk.spans match { case List(value) => value; case _ => throw DomainError("internal","a stored piece without its one source span") }
      ProblemRows.Piece(r.getInt(4),r.getInt(1),chunk,vector,ProblemPassages.SourceSpan(span.messageId,r.getInt(5),span.start,span.end))
    }.toVector
  }
  /** The summary and tags of the parent's pieces (its member chunks) at `ordinals`, in their order. */
  def carried(c: Connection,parent: UUID,ordinals: Vector[Long]): Vector[ProblemRows.Final] = if(ordinals.isEmpty) Vector.empty else {
    val (from,until)=(ordinals.min,ordinals.max+1)
    val found=Sql.rows(c,s"""SELECT ch.ordinal,ch.value FROM ch_lineage_segments m JOIN ch_chunks ch ON ch.generation=m.origin
      AND ch.ordinal>=greatest(m.lo,?) AND ch.ordinal<least(m.hi,?) AND ch.ordinal=ANY(?::int[]) WHERE $openSegments AND m.lo<?""",
      from,until,ordinals.mkString("{",",","}"),latest(c,parent),GenerationRows.Kind.Piece.sql,0,from,until) { r =>
      val chunk=Wire.decode(Chunk.codecJson,Sql.json(r,"value")); r.getLong(1) -> ProblemRows.Final(chunk.summary,chunk.tags)
    }.toMap
    ordinals.map(ordinal => found.getOrElse(ordinal,throw DomainError("internal","the parent's piece is not its member")))
  }
  /** `members`' statement: the latest version of `lineage`. */
  private[chronicle] def membersQuery(lineage: UUID,session: UUID,revision: Int,from: Long,until: Long): ReadSources.Query =
    ReadSources.Query(s"""SELECT ch.ordinal,ch.value,ch.embedding::text,pc.passage_ordinal,em.position FROM ch_lineage_segments m
      JOIN ch_chunks ch ON ch.generation=m.origin AND ch.ordinal>=greatest(m.lo,?) AND ch.ordinal<least(m.hi,?)
      JOIN ch_problem_pieces pc ON pc.generation=ch.generation AND pc.chunk_id=ch.id
      JOIN ch_revisions r ON r.session_id=? AND r.revision=?
      JOIN ch_epoch_messages em ON em.epoch=r.epoch AND em.message_id=ch.value->'spans'->0->>'messageId'
      WHERE $openSegments AND m.lo<? ORDER BY ch.ordinal""",List(from,until,session,revision,lineage,GenerationRows.Kind.Piece.sql,0,from,until))
  /** The switch's statement for the segment rows of `kind` of the latest version of `lineage` ending after `start`. */
  private[chronicle] def tailSegments(lineage: UUID,kind: GenerationRows.Kind,start: (Int,Long)): ReadSources.Query =
    ReadSources.Query(s"SELECT ctid::text,origin,lo_major,lo,hi_major,hi,staged_by FROM ch_lineage_segments WHERE $openSegments",List(lineage,kind.sql,start._1,start._2))
  /** The tag counts of the staged generation's chunks deleted, a bounded statement: a root's lineage tag counts, an
    * incremental publication's staged changes; false once none is left (its chunks are written again). */
  def deleteLineageTagsStep(c: Connection,generation: UUID): Boolean =
    Sql.exec(c,s"DELETE FROM ch_lineage_tags WHERE ctid=ANY(ARRAY(SELECT ctid FROM ch_lineage_tags WHERE lineage=? LIMIT $rowsPerStatement))",generation)>0 ||
      Sql.exec(c,s"DELETE FROM ch_lineage_tag_deltas WHERE ctid=ANY(ARRAY(SELECT ctid FROM ch_lineage_tag_deltas WHERE generation=? LIMIT $rowsPerStatement))",generation)>0
  /** Final summaries and tags of the staged passages from ordinal `from` on. */
  def finals(c: Connection,generation: UUID,from: Int,limit: Int): Vector[ProblemRows.Final] =
    Sql.rows(c,"SELECT value FROM ch_problem_passages WHERE generation=? AND ordinal>=? AND ordinal<? ORDER BY ordinal",generation,from,from+limit) { r =>
      val value=Wire.decode(PassageInfo.codecJson,Sql.json(r,"value")); ProblemRows.Final(value.summary,value.tags)
    }.toVector
  /** P3: the search rows of the staged chunks with ordinals in [from, until), today's statement. */
  def writeSearchRows(c: Connection,generation: UUID,from: Int,until: Int): Unit = {
    Sql.exec(c,"INSERT INTO ch_search_chunks(id,generation,session_id,revision,profile,document,embedding,ordinal) SELECT ch.id,ch.generation,g.session_id,g.revision,g.profile,ch.document,ch.embedding,ch.ordinal FROM ch_chunks ch JOIN ch_generations g ON g.id=ch.generation WHERE g.id=? AND ch.ordinal>=? AND ch.ordinal<? ON CONFLICT DO NOTHING",generation,from,until)
    ()
  }

  /** Lineages a root's switch superseded (ch_lineage_retirements): of one source, or all. */
  def retiringLineages(c: Connection,session: Option[UUID]): List[UUID] = session match {
    case Some(id) => Sql.rows(c,"SELECT r.lineage FROM ch_lineage_retirements r JOIN ch_generations g ON g.id=r.lineage WHERE g.session_id=? ORDER BY r.lineage",id)(_.getObject(1,classOf[UUID]))
    case None => Sql.rows(c,"SELECT lineage FROM ch_lineage_retirements ORDER BY lineage")(_.getObject(1,classOf[UUID]))
  }
  /** A superseded lineage, a bounded statement per transaction: its generations' search rows are queued for retirement
    * (`retire`), then its tag rows deleted, then its retirement row. */
  def retireLineage(db: Database,lineage: UUID): Unit = while(db.transaction(retireLineageStep(_,lineage))) {}
  /** One bounded statement of a lineage's retirement; false when done. A lineage whose generation is published again
    * (never by this release) keeps its rows. */
  def retireLineageStep(c: Connection,lineage: UUID): Boolean =
    Sql.one(c,"SELECT NOT EXISTS(SELECT 1 FROM ch_sources s JOIN ch_generations g ON g.id=s.published WHERE g.lineage=r.lineage) FROM ch_lineage_retirements r WHERE r.lineage=? FOR UPDATE",lineage)(_.getBoolean(1)) match {
      case None => false
      case Some(retired) =>
        val more=retired && (Sql.exec(c,s"""INSERT INTO ch_generation_retirements(generation,payload) SELECT g.id,false FROM ch_generations g WHERE g.lineage=?
            AND NOT EXISTS(SELECT 1 FROM ch_generation_retirements r WHERE r.generation=g.id) AND NOT EXISTS(SELECT 1 FROM ch_staged_generations st WHERE st.generation=g.id)
            ORDER BY g.id LIMIT $rowsPerStatement ON CONFLICT DO NOTHING""",lineage)>0 ||
          Sql.exec(c,s"DELETE FROM ch_lineage_tags WHERE ctid=ANY(ARRAY(SELECT ctid FROM ch_lineage_tags WHERE lineage=? LIMIT $rowsPerStatement))",lineage)>0)
        if(!more) Sql.exec(c,"DELETE FROM ch_lineage_retirements WHERE lineage=?",lineage)
        more
    }
  /** Superseded ranges of an origin's search rows (ch_search_retirements): of one source, or all; (origin, first piece). */
  def retiringRanges(c: Connection,session: Option[UUID]): List[(UUID,Int)] = session match {
    case Some(id) => Sql.rows(c,"SELECT origin,piece_lo FROM ch_search_retirements WHERE session_id=? ORDER BY origin,piece_lo",id)(r => (r.getObject(1,classOf[UUID]),r.getInt(2)))
    case None => Sql.rows(c,"SELECT origin,piece_lo FROM ch_search_retirements ORDER BY origin,piece_lo")(r => (r.getObject(1,classOf[UUID]),r.getInt(2)))
  }
  /** A superseded range's search rows deleted, `rowsPerStatement` pieces per transaction. */
  def retireRange(db: Database,origin: UUID,lo: Int): Unit = {
    var from=Option(lo)
    while(from.nonEmpty) from=db.transaction(retireRangeStep(_,origin,from.get))
  }
  /** The search rows of the origin's pieces [lo, lo+rowsPerStatement) inside the pending range starting at `lo` deleted
    * (their ids through ch_chunks (generation, ordinal)); the range shrinks, or goes once empty. Returns where it continues. */
  def retireRangeStep(c: Connection,origin: UUID,lo: Int): Option[Int] =
    Sql.one(c,"SELECT piece_hi FROM ch_search_retirements WHERE origin=? AND piece_lo=? FOR UPDATE",origin,lo)(_.getInt(1)).flatMap { hi =>
      val until=math.min(hi.toLong,lo.toLong+rowsPerStatement).toInt
      Sql.exec(c,"DELETE FROM ch_search_chunks WHERE id IN(SELECT id FROM ch_chunks WHERE generation=? AND ordinal>=? AND ordinal<?)",origin,lo,until)
      if(until<hi) { Sql.exec(c,"UPDATE ch_search_retirements SET piece_lo=? WHERE origin=? AND piece_lo=?",until,origin,lo); Some(until) }
      else { Sql.exec(c,"DELETE FROM ch_search_retirements WHERE origin=? AND piece_lo=?",origin,lo); None }
    }
  /** Generations being retired (ch_generation_retirements): of one source, or all. */
  def retiring(c: Connection,session: Option[UUID]): List[UUID] = session match {
    case Some(id) => Sql.rows(c,"SELECT r.generation FROM ch_generation_retirements r JOIN ch_generations g ON g.id=r.generation WHERE g.session_id=? ORDER BY r.generation",id)(_.getObject(1,classOf[UUID]))
    case None => Sql.rows(c,"SELECT generation FROM ch_generation_retirements ORDER BY generation")(_.getObject(1,classOf[UUID]))
  }
  /** One bounded statement of a retirement: the next `rowsPerStatement` chunks of the generation after the cursor lose
    * their search rows, or for an explicit rebuild's retirement (`payload`) the chunks themselves (their search rows and
    * pieces with them); once no chunk is left, the passages' spans, the passages, Context spans and tags of a payload
    * retirement, `rowsPerStatement` at a time. A cursor taken in a search-row retirement that a rebuild has since made a
    * payload retirement starts again from the first chunk (the chunks behind it still exist). Returns where to continue,
    * None when done (and the retirement row deleted). A generation that is published again (never by this release) or
    * staged is not retired. */
  def retireStep(c: Connection,generation: UUID,cursor: Retirement): Option[Retirement] =
    Sql.one(c,"SELECT r.payload,NOT EXISTS(SELECT 1 FROM ch_sources s WHERE s.published=r.generation) AND NOT EXISTS(SELECT 1 FROM ch_staged_generations st WHERE st.generation=r.generation) FROM ch_generation_retirements r WHERE r.generation=? FOR UPDATE",generation)(r => (r.getBoolean(1),r.getBoolean(2))) match {
      case None => None
      case Some((payload,retired)) =>
        val deleted=if(payload) "DELETE FROM ch_chunks t USING batch b WHERE t.id=b.id" else "DELETE FROM ch_search_chunks t USING batch b WHERE t.id=b.id"
        val after=if(cursor.payload==payload) cursor.after else Retirement.start.after
        val last=if(!retired) None else Sql.one(c,s"""WITH batch AS MATERIALIZED(SELECT id FROM ch_chunks WHERE generation=? AND id>? ORDER BY id LIMIT $rowsPerStatement),
          deleted AS($deleted) SELECT id FROM batch ORDER BY id DESC LIMIT 1""",generation,after)(_.getObject(1,classOf[UUID]))
        def rest: Boolean = retired && payload && List("ch_problem_spans","ch_problem_passages","ch_context_spans","ch_generation_tags").exists(table =>
          Sql.exec(c,s"DELETE FROM $table WHERE ctid=ANY(ARRAY(SELECT ctid FROM $table WHERE generation=? LIMIT $rowsPerStatement))",generation)>0)
        last.orElse(Option.when(rest)(after)).map(Retirement(_,payload)).orElse { Sql.exec(c,"DELETE FROM ch_generation_retirements WHERE generation=?",generation); None }
    }

  /** Generated tags are derived content: a visible publication that is not retired and not in a current format (a
    * leftover) refuses the whole read, as Database.selectView refuses a view of it. */
  def requireCurrentPublications(c: Connection,visible: String,reader: String): Unit =
    Check(Sql.one(c,s"SELECT 1 FROM ch_sources s JOIN ch_generations g ON g.id=s.published WHERE ($visible) AND NOT g.retired AND (g.passage_format IS NULL OR g.passage_format NOT IN ${GenerationRows.formatsSql}) LIMIT 1",
      reader,reader,reader)(_ => true).isEmpty,"unavailable","a visible publication is not in the current passage format")
  /** `view` comes from Database.selectView, which admits a generation only in a current format. The passages it holds
    * with ordinals in [offset, offset+limit). */
  def passages(c: Connection,view: ContentView,offset: Int,limit: Int): PassagesResult = view.generationId match {
    case None => PassagesResult(view,PassageFormat.Unindexed,Nil,0,offset)
    case Some(generation) =>
      val total=Sql.one(c,"SELECT passage_count FROM ch_generations WHERE id=?",generation)(_.getLong(1)).getOrElse(throw DomainError("not-found","content view not found"))
      val rows=Sql.rows(c,s"SELECT p.value FROM (${GenerationRows.members(GenerationRows.Kind.Passage)}) m JOIN ch_problem_passages p ON p.generation=m.origin AND p.ordinal>=greatest(m.lo,?) AND p.ordinal<least(m.hi,?) ORDER BY p.ordinal LIMIT ?",
        generation,offset.toLong,offset.toLong+limit,limit)(r => Wire.decode(PassageInfo.codecJson,Sql.json(r,"value")))
      PassagesResult(view,PassageFormat.ContextAwareProblems,rows,total,offset)
  }
  /** The spans of the passage the generation holds with that id, with ordinals in [offset, offset+limit). */
  def spans(c: Connection,view: ContentView,passageId: UUID,offset: Int,limit: Int): PassageSpansResult = {
    val generation=view.generationId.getOrElse(throw DomainError("invalid","passage spans require an indexed content view"))
    val (ordinal,total)=Sql.one(c,s"SELECT p.ordinal,p.span_count FROM (${GenerationRows.members(GenerationRows.Kind.Passage)}) m JOIN ch_problem_passages p ON p.generation=m.origin AND p.id=? AND p.ordinal>=m.lo AND p.ordinal<m.hi",
      generation,passageId)(r => (r.getInt(1),r.getLong(2))).getOrElse(throw DomainError("not-found","passage not found"))
    val values=Sql.rows(c,s"""SELECT sp.message_id,sp.message_position,sp.start_byte,sp.end_byte FROM (${GenerationRows.members(GenerationRows.Kind.Span)}) m
      JOIN ch_problem_spans sp ON sp.generation=m.origin AND sp.passage_id=? AND sp.ordinal>=? AND sp.ordinal<? AND (?,sp.ordinal)>=(m.lo_major,m.lo) AND (?,sp.ordinal)<(m.hi_major,m.hi) ORDER BY sp.ordinal LIMIT ?""",
      generation,passageId,offset.toLong,offset.toLong+limit,ordinal,ordinal,limit)(r => PassageSourceSpan(r.getString(1),r.getInt(2),r.getInt(3),r.getInt(4)))
    PassageSpansResult(view,passageId,values,total,offset)
  }
}
