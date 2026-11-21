package chronicle

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import chronicle.api.*
import io.circe.Json
import java.util.UUID
import ProblemPassages.{Decision,Part,Point}

/** The streamed publication (ingest-limits spec §5.2.4) against the in-memory publication of the release before it, the
  * oracle (§5.3) given the metadata horizon (§5.6.2): the same claim and the job's accepted checkpoints give every
  * generation table the same rows, up to the generation's id. Nothing an existing session published changes, so none is
  * indexed again. */
final class StreamedPublicationDifferentialTest extends munit.FunSuite {
  override val munitTimeout=scala.concurrent.duration.DurationInt(3).minutes
  private def database(config: Config)(f: Database => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh") }
    val db=new Database(config,IndexProfileCatalog.current(config)); db.initialize()
    db.transaction { c =>
      Sql.exec(c,"TRUNCATE ch_epochs,ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks CASCADE")
      Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=0",config.profile)
    }
    try f(db) finally db.close()
  }
  /** About twelve windows: empty messages, one message of six windows, then several hundred short multibyte messages. */
  private def request(): IngestRequest = {
    val long="A🙂"+(0 until 21000).map(i => s"αβγ line $i of the long message\n").mkString
    val short=(0 until 320).map(i => s"short $i "+("δε🙂 word "*(80+i%170)))
    val texts=List("",long,"","")++short++List("","tail")
    val messages=texts.zipWithIndex.map((text,index) => Message(s"m$index",None,if(index%3==0) "user" else "assistant",text,None,index))
    val raw=messages.map(m => Json.obj("id"->Json.fromString(m.id),"text"->Json.fromString(m.text)).noSpaces+"\n").mkString
    Fixtures.snapshot().copy(messages=messages,files=List(RawFile("session.jsonl",Wire.hash(raw),raw)),digest=Wire.hash(raw))
  }
  /** Windows 0 and 1 continue one problem across their boundary inside the long message; 2 is A, Context, A again (one
    * passage); 3 is Context only; 4 is A, B, C inside the long message; later windows split at a scalar inside a
    * fragment, alternate continuing and new passages and change the open passage's tags. */
  private final class Scripted extends ProblemPassageAnnotator {
    private var window=0
    def annotate(owner: String,value: ProblemPassages.Window,previous: Option[ProblemPassages.Carry]): IO[Decision] = IO {
      val index=window; window+=1
      val n=value.fragments.size; val open=previous.nonEmpty
      def problem(start: Point,end: Point,continue: Boolean,summary: String,tags: List[String]): Part = Part(start,end,continue,summary,tags)
      val all=Point(0,0)
      val decision=index match {
        case 0 => Decision(Vector(problem(all,value.terminal,false,"goal one",List("alpha"))))
        case 1 => Decision(Vector(problem(all,value.terminal,true,"goal one updated",List("alpha"))))
        case 2 => Decision(Vector(problem(all,Point(1,0),true,"goal one",List("alpha")),Part.context(Point(1,0),Point(2,0)),problem(Point(2,0),value.terminal,true,"goal one again",List("alpha","beta"))))
        case 3 => Decision(Vector(Part.context(all,value.terminal)))
        case 4 => Decision(Vector(problem(all,Point(1,0),open,"goal one",List("alpha")),problem(Point(1,0),Point(2,0),false,"goal two",List("beta")),problem(Point(2,0),value.terminal,false,"goal three",List("gamma"))))
        case _ if n==1 => Decision(Vector(problem(all,value.terminal,false,s"goal $index",List(s"tag$index"))))
        case _ =>
          val split=Point(n/2,if(value.fragments(n/2).scalarCount>1) 1 else 0)
          Decision(Vector(problem(all,split,open && index%2==1,s"goal $index",List(s"tag$index","shared")),problem(split,value.terminal,index%3!=0,s"goal $index later",List(s"tag$index later"))))
      }
      ProblemPassages.validate(value,open,decision); decision
    }
  }
  private final class Vectors extends Embedder {
    private var next=0
    def documents(owner: String,text: List[String]): IO[List[List[Double]]] = IO(text.map { _ => next+=1; List(1.0,next.toDouble/1000,(next%7).toDouble) })
    def query(owner: String,text: String): IO[List[Double]] = IO.raiseError(new AssertionError("worker queried embedding"))
  }
  /** The oracle: the release's in-memory builder over the claim's windows with the job's accepted decisions and vectors. */
  private def oracle(db: Database,claim: Claim,config: Config): ProblemsPublication = db.transaction { c =>
    def accepted(key: CheckpointKey): Json = IndexCheckpoints.read(c,claim,key).getOrElse(fail("accepted work missing"))
    val source=ProblemPassages.Source(claim.messages.reader(TestFetch.unadmitted))
    var state=ProblemPassages.State.start(claim.sessionId,claim.runId); var builder=ProblemsPublication.empty(config.indexing.metadataHorizonWindows); var index=0
    var pending=source.next(state.nextSource)
    while(pending.nonEmpty) {
      val window=pending.get
      val input=Json.arr(window.sourceJson,state.carry.map(ProblemPassages.carryJson).getOrElse(Json.Null))
      val decision=ProblemPassages.decode(window,state.carry.nonEmpty,accepted(IndexCheckpoints.key(claim,IndexingStage.Annotation,index,0,ProblemPassages.identity,input)))
      val delta=ProblemPassages.accept(state,window,decision)
      val chunks=delta.pieces.map(_.chunk).toList
      val vectors=chunks.grouped(config.indexing.embeddingBatchSize).zipWithIndex.flatMap { (batch,part) =>
        CheckpointJson.vectors(accepted(IndexCheckpoints.key(claim,IndexingStage.Embedding,index,part,EmbeddingSpaceDescriptor.from(config.embedding).id,CheckpointJson.chunks(batch))))
      }.toList
      builder=builder.append(delta,chunks.zip(vectors).map(IndexedChunk(_,_)))
      state=delta.state; index+=1; pending=source.next(state.nextSource)
    }
    val publication=builder.append(ProblemPassages.finish(state,source),Nil).result
    publication.validate(claim,config.embedding.dimensions,ProblemPassages.Source(claim.messages.reader(TestFetch.unadmitted)))
    publication
  }
  /** Every generation table's rows of `generation` as text, from tables named `prefix` + the table. */
  private def tables(c: java.sql.Connection,prefix: String,generation: UUID): Map[String,List[String]] = Map(
    "chunks"->s"SELECT concat_ws('|',id,value::text,document::text,embedding::text,ordinal) FROM ${prefix}ch_chunks WHERE generation=? ORDER BY ordinal",
    "passages"->s"SELECT concat_ws('|',id,ordinal,initial_summary,value::text,span_count) FROM ${prefix}ch_problem_passages WHERE generation=? ORDER BY ordinal",
    "spans"->s"SELECT concat_ws('|',passage_id,ordinal,message_id,message_position,start_byte,end_byte) FROM ${prefix}ch_problem_spans WHERE generation=? ORDER BY passage_id,ordinal",
    "context"->s"SELECT concat_ws('|',ordinal,message_id,message_position,start_byte,end_byte) FROM ${prefix}ch_context_spans WHERE generation=? ORDER BY ordinal",
    "pieces"->s"SELECT concat_ws('|',chunk_id,passage_ordinal,piece_ordinal) FROM ${prefix}ch_problem_pieces WHERE generation=? ORDER BY piece_ordinal",
    "tags"->s"SELECT tag FROM ${prefix}ch_generation_tags WHERE generation=? ORDER BY tag"
  ).map((table,sql) => table->Sql.rows(c,sql,generation)(_.getString(1)))

  List(RevisionLayoutPolicy.production->"an epoch",RevisionLayoutPolicy.Legacy->"a legacy revision").foreach { (layout,stored) =>
    test(s"a streamed publication of $stored, stopped in its pieces and resumed, equals the in-memory publication of the same claim and checkpoints in every generation table") {
      // A horizon of 2 windows (full publications): pieces of passages longer than that carry metadata of later windows.
      val config=Fixtures.config().copy(maxBodyBytes=16*1024*1024,maxFileBytes=16*1024*1024,indexing=IndexingCapacity.defaults.copy(incrementalPublication=false,metadataHorizonWindows=2))
      database(config) { db =>
        val archive=new PostgresArchive(db,config,layout)
        val receipt=archive.ingest("a",request())
        var claimed=Option.empty[Claim]
        val capturing=new ForwardingArchive(archive) {
          override def claim(profiles: Set[String],scope: ClaimScope,lease: Int,large: LargeJobs): Option[Claim] = { val value=super.claim(profiles,scope,lease,large); value.foreach(v => claimed=Some(v)); value }
        }
        val worker=ModelFixtures.worker(capturing,new Scripted,new Vectors,config,logstage.IzLogger())
        // The first attempt stops at its second batch of chunks; the next one continues the same staged generation.
        db.transaction { c =>
          Sql.exec(c,"CREATE FUNCTION ch_test_stop_pieces() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF (SELECT count(*) FROM ch_chunks WHERE generation IN(SELECT generation FROM inserted))>500 THEN RAISE EXCEPTION 'stopped'; END IF; RETURN NULL; END $$")
          Sql.exec(c,"CREATE TRIGGER ch_test_stop_pieces AFTER INSERT ON ch_chunks REFERENCING NEW TABLE AS inserted FOR EACH STATEMENT EXECUTE FUNCTION ch_test_stop_pieces()")
        }
        val staged=try {
          assert(worker.once.unsafeRunSync())
          db.transaction(c => Sql.one(c,"SELECT st.generation,st.phase,(SELECT count(*) FROM ch_chunks ch WHERE ch.generation=st.generation),j.state FROM ch_staged_generations st JOIN ch_jobs j ON j.id=st.job_id")(r => (r.getObject(1,classOf[UUID]),r.getString(2),r.getInt(3),r.getString(4)))).get
        } finally db.transaction(c => Sql.exec(c,"DROP FUNCTION ch_test_stop_pieces() CASCADE"))
        assertEquals(staged._2::staged._3::staged._4::Nil,List("Pieces",PassageStorage.rowsPerBatch,"Queued"))
        assert(worker.once.unsafeRunSync())
        val view=archive.session("a",receipt.sessionId).view
        assertEquals(view.generationId,Some(staged._1),"the staged generation was resumed and published")
        val claim=claimed.get
        val publication=oracle(db,claim,config)
        assert(publication.chunks.size>PassageStorage.rowsPerBatch && publication.passages.size>8 && publication.context.nonEmpty)
        db.transaction { c =>
          List("ch_chunks","ch_problem_passages","ch_problem_spans","ch_context_spans","ch_problem_pieces","ch_generation_tags").foreach(table =>
            Sql.exec(c,s"CREATE TEMP TABLE oracle_$table (LIKE $table) ON COMMIT DROP"))
          val oracleGeneration=UUID.randomUUID()
          ProblemsPublication.persist(c,"oracle_",oracleGeneration,publication)
          val (streamed,expected)=(tables(c,"",staged._1),tables(c,"oracle_",oracleGeneration))
          expected.foreach((table,rows) => assertEquals(streamed(table),rows,table))
          // The search rows are the chunks' (today's INSERT…SELECT), and the generation row is what the release wrote.
          assertEquals(Sql.rows(c,"SELECT concat_ws('|',id,session_id,revision,profile,document::text,embedding::text,ordinal) FROM ch_search_chunks WHERE generation=? ORDER BY id",staged._1)(_.getString(1)),
            Sql.rows(c,"SELECT concat_ws('|',ch.id,?::uuid,1,?,ch.document::text,ch.embedding::text,ch.ordinal) FROM oracle_ch_chunks ch WHERE generation=? ORDER BY ch.id",receipt.sessionId,claim.profile,oracleGeneration)(_.getString(1)))
          // A root's lineage tags count its pieces per tag, each once although the resumed step wrote its rows again.
          assertEquals(Sql.rows(c,"SELECT tag||':'||pieces FROM ch_lineage_tags WHERE lineage=? ORDER BY tag",staged._1)(_.getString(1)),
            Sql.rows(c,"SELECT tag||':'||count(*) FROM oracle_ch_chunks ch CROSS JOIN LATERAL(SELECT DISTINCT jsonb_array_elements_text(ch.value->'tags') AS tag) tags WHERE generation=? GROUP BY tag ORDER BY tag",oracleGeneration)(_.getString(1)))
          assertEquals(Sql.one(c,"SELECT concat_ws('|',session_id,revision,profile,passage_format,passage_count,run_id,retired) FROM ch_generations WHERE id=?",staged._1)(_.getString(1)),
            Some(s"${receipt.sessionId}|1|${claim.profile}|ContextAwareProblems|${publication.passages.size}|${claim.runId}|f"))
        }
      }
    }
  }
}
