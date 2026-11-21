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
  * written, so they are written again. */
enum StagedPhase { case Passages,Pieces }
final case class StagedGeneration(generation: UUID,phase: StagedPhase,step: Int,counts: Option[ProblemRows.Counts],invalid: Boolean=false)
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
      Option.when(staged.invalid)("invalid"->io.circe.Json.True)*).noSpaces
  /** The staged generation of the job's run, locked against the sweep for the caller's transaction. */
  def staged(c: Connection,jobId: UUID,runId: UUID): Option[StagedGeneration] =
    Sql.one(c,"SELECT generation,phase,resume FROM ch_staged_generations WHERE job_id=? AND run_id=? AND run_id<>generation FOR NO KEY UPDATE",jobId,runId) { r =>
      val resume=Sql.json(r,"resume").hcursor
      def field(name: String): Option[Int] = resume.get[Int](name).toOption
      val counts=for { steps <- field("steps"); passages <- field("passages"); pieces <- field("pieces") } yield ProblemRows.Counts(steps,passages,pieces)
      StagedGeneration(r.getObject(1,classOf[UUID]),StagedPhase.valueOf(r.getString(2)),field("step").getOrElse(throw DomainError("internal","invalid staged generation resume point")),counts,
        resume.get[Boolean]("invalid").getOrElse(false))
    }
  /** P0: a new staged generation of the claim's run, no row written yet. */
  def stage(c: Connection,claim: Claim): StagedGeneration = {
    val generation=UUID.randomUUID()
    Sql.exec(c,"INSERT INTO ch_generations(id,session_id,revision,profile,passage_format,passage_count,run_id) VALUES(?,?,?,?,?,0,?)",generation,claim.sessionId,claim.revision,claim.profile,PassageFormat.ContextAwareProblems.toString,claim.runId)
    val staged=StagedGeneration(generation,StagedPhase.Passages,0,None)
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
      def bounded(table: String): Int =
        Sql.exec(c,s"DELETE FROM $table WHERE ctid=ANY(ARRAY(SELECT ctid FROM $table WHERE generation=? LIMIT $rowsPerStatement))",generation)
      first match {
        case Some(from) => Sql.exec(c,"DELETE FROM ch_chunks WHERE generation=? AND ordinal>=? AND ordinal<?",generation,from,from+rowsPerStatement); true
        case None =>
          List("ch_problem_spans","ch_problem_passages","ch_context_spans","ch_generation_tags").exists(table => bounded(table)>0) ||
            { Sql.exec(c,"DELETE FROM ch_generations WHERE id=?",generation); false }
      }
    }
  }

  /** An abandoned staged generation deleted, a bounded statement per transaction. */
  def deleteAbandoned(db: Database,generation: UUID): Unit = while(db.transaction(deleteAbandonedStep(_,generation))) {}
  /** A replaced generation's search rows deleted, a bounded statement per transaction. */
  def retire(db: Database,generation: UUID): Unit = {
    var after=Option(new UUID(0L,0L))
    while(after.nonEmpty) after=db.transaction(retireStep(_,generation,after.get))
  }

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
  /** P2 rows: chunks as the in-memory publication stored them (its JSON, document and vector text) and their pieces. */
  def writePieces(c: Connection,generation: UUID,pieces: Seq[ProblemRows.Piece]): Unit = {
    batch(c,"INSERT INTO ch_chunks(id,generation,value,document,embedding,ordinal) VALUES(?,?,?::jsonb,to_tsvector('english',?),?::vector,?) ON CONFLICT DO NOTHING",pieces.map { piece =>
      val chunk=piece.chunk
      List(chunk.id,generation,Wire.encode(Chunk.codecJson,chunk).noSpaces,s"${chunk.text} ${chunk.summary} ${chunk.tags.mkString(" ")}",piece.vector.mkString("[",",","]"),piece.ordinal)
    })
    batch(c,"INSERT INTO ch_problem_pieces(generation,chunk_id,passage_ordinal,piece_ordinal) VALUES(?,?,?,?) ON CONFLICT DO NOTHING",pieces.map(piece => List(generation,piece.chunk.id,piece.passageOrdinal,piece.ordinal)))
  }
  /** Final summaries and tags of the staged passages from ordinal `from` on. */
  def finals(c: Connection,generation: UUID,from: Int,limit: Int): Vector[ProblemRows.Final] =
    Sql.rows(c,"SELECT value FROM ch_problem_passages WHERE generation=? AND ordinal>=? AND ordinal<? ORDER BY ordinal",generation,from,from+limit) { r =>
      val value=Wire.decode(PassageInfo.codecJson,Sql.json(r,"value")); ProblemRows.Final(value.summary,value.tags)
    }.toVector
  /** P3: the search rows of the staged chunks with ordinals in [from, until), today's statement. */
  def writeSearchRows(c: Connection,generation: UUID,from: Int,until: Int): Unit = {
    Sql.exec(c,"INSERT INTO ch_search_chunks(id,generation,session_id,revision,profile,document,embedding) SELECT ch.id,ch.generation,g.session_id,g.revision,g.profile,ch.document,ch.embedding FROM ch_chunks ch JOIN ch_generations g ON g.id=ch.generation WHERE g.id=? AND ch.ordinal>=? AND ch.ordinal<? ON CONFLICT DO NOTHING",generation,from,until)
    ()
  }

  /** Generations being retired (ch_generation_retirements): of one source, or all. */
  def retiring(c: Connection,session: Option[UUID]): List[UUID] = session match {
    case Some(id) => Sql.rows(c,"SELECT r.generation FROM ch_generation_retirements r JOIN ch_generations g ON g.id=r.generation WHERE g.session_id=? ORDER BY r.generation",id)(_.getObject(1,classOf[UUID]))
    case None => Sql.rows(c,"SELECT generation FROM ch_generation_retirements ORDER BY generation")(_.getObject(1,classOf[UUID]))
  }
  /** One bounded statement of a retirement: the next `rowsPerStatement` chunks of the generation after chunk id `after`
    * lose their search rows, or for an explicit rebuild's retirement (`payload`) the chunks themselves (their search rows
    * and pieces with them); once no chunk is left, the passages' spans, the passages, Context spans and tags of a payload
    * retirement, `rowsPerStatement` at a time. Returns where to continue, None when done (and the retirement row
    * deleted). A generation that is published again (never by this release) or staged is not retired. */
  def retireStep(c: Connection,generation: UUID,after: UUID): Option[UUID] =
    Sql.one(c,"SELECT r.payload,NOT EXISTS(SELECT 1 FROM ch_sources s WHERE s.published=r.generation) AND NOT EXISTS(SELECT 1 FROM ch_staged_generations st WHERE st.generation=r.generation) FROM ch_generation_retirements r WHERE r.generation=? FOR UPDATE",generation)(r => (r.getBoolean(1),r.getBoolean(2))) match {
      case None => None
      case Some((payload,retired)) =>
        val deleted=if(payload) "DELETE FROM ch_chunks t USING batch b WHERE t.id=b.id" else "DELETE FROM ch_search_chunks t USING batch b WHERE t.id=b.id"
        val last=if(!retired) None else Sql.one(c,s"""WITH batch AS MATERIALIZED(SELECT id FROM ch_chunks WHERE generation=? AND id>? ORDER BY id LIMIT $rowsPerStatement),
          deleted AS($deleted) SELECT id FROM batch ORDER BY id DESC LIMIT 1""",generation,after)(_.getObject(1,classOf[UUID]))
        def rest: Boolean = retired && payload && List("ch_problem_spans","ch_problem_passages","ch_context_spans","ch_generation_tags").exists(table =>
          Sql.exec(c,s"DELETE FROM $table WHERE ctid=ANY(ARRAY(SELECT ctid FROM $table WHERE generation=? LIMIT $rowsPerStatement))",generation)>0)
        last.orElse(Option.when(rest)(after)).orElse { Sql.exec(c,"DELETE FROM ch_generation_retirements WHERE generation=?",generation); None }
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
