package chronicle

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import chronicle.api.*
import io.circe.Json
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration.*
import ProblemPassages.{Decision,Part,Point}
import GenerationRows.Kind

/** Incremental publication (ingest-limits spec §5.6, unit L5e-2): an append publishes the next version of the published
  * generation's lineage, writing only the windows from the parent's cut on and the pieces of the open passage whose
  * metadata horizon reaches them, and reads exactly as a full publication (a root) of the same content does; a window
  * whose metadata returns to its member rows' keeps them; a stopped incremental publication is invisible and resumed;
  * a root's switch is O(1); `indexing.metadataHorizonWindows` changes exactly the pieces beyond the horizon. */
final class IncrementalPublicationDifferentialTest extends munit.FunSuite {
  override val munitTimeout=5.minutes
  /** An injected horizon (a configuration with incremental publication refuses any other than 16 at start). */
  private val horizon=4
  private final case class Fixture(config: Config,full: Config,db: Database,incremental: PostgresArchive,complete: PostgresArchive,search: PostgresSearch,index: PostgresArchiveIndex)
  private def database(run: Fixture => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh") }
    val base=Fixtures.config()
    val config=base.copy(indexing=base.indexing.copy(metadataHorizonWindows=horizon))
    val full=config.copy(indexing=config.indexing.copy(incrementalPublication=false))
    // The database starts with a configuration that start validates; the archives and workers use the injected one.
    val db=new Database(base,IndexProfileCatalog.current(base)); db.initialize()
    db.transaction { c =>
      Sql.exec(c,"TRUNCATE ch_epochs,ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks CASCADE")
      Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=0",config.profile)
    }
    val incremental=new PostgresArchive(db,config)
    try run(Fixture(config,full,db,incremental,new PostgresArchive(db,full),new PostgresSearch(db,incremental,config),new PostgresArchiveIndex(db,incremental,config))) finally db.close()
  }
  private def message(id: String,position: Int,text: String): Message = Message(id,None,"user",text,None,position)
  private def request(values: List[Message],source: Option[SourceIdentity],revision: Int): IngestRequest = {
    val raw=values.map(m => Json.obj("id"->Json.fromString(m.id),"text"->Json.fromString(m.text)).noSpaces+"\n").mkString
    val base=Fixtures.snapshot()
    base.copy(source=source.getOrElse(base.source),expectedRevision=revision,messages=values,files=List(RawFile("session.jsonl",Wire.hash(raw),raw)),digest=Wire.hash(raw))
  }
  /** Problem texts shared by every source: exact lexical and vector ties across and within sources. */
  private def shared(position: Int): String = s"shared finding ${position%5}"
  private def context(position: Int): Message = message(s"c$position",position,s"context $position")
  /** One passage for the whole session whose summary and tags change in every window ('w'): the open passage B is passage 0. */
  private def long(count: Int): List[Message] =
    (0 until count).map(p => if(p==0) message("n0-long",p,shared(p)) else if(p%8==0) message(s"w$p-long",p,shared(p)) else context(p)).toList
  /** One passage whose metadata never changes. */
  private def steady(count: Int): List[Message] = (0 until count).map(p => if(p%8==0) message(s"k$p-tie",p,shared(p)) else context(p)).toList
  /** alpha (windows 0-1), an empty message, a Context-only window, beta opened at the next window's start, one message of
    * about 300 KB continuing beta across windows, then gamma. */
  private def mixed(count: Int): List[Message] = (
    (0 until 128).map(p => if(p==0) message("n0-alpha",p,shared(p)) else if(p%4==0) message(s"k$p-alpha",p,shared(p)) else context(p)) ++
    List(message("c128",128,"")) ++ (129 until 193).map(context) ++
    (193 until 257).map(p => if(p==193) message("n193-beta",p,shared(p)) else if(p%4==1) message(s"k$p-beta",p,shared(p)) else context(p)) ++
    List(message("k257-beta",257,"long beta message "*16700)) ++
    (258 until 400).map(p => if(p==300) message("n300-gamma",p,shared(p)) else if(p%4==0) message(s"k$p-gamma",p,shared(p)) else context(p))
  ).toList.take(count)
  /** Per fragment a part directed by its message's id: `c` Context, `n` a new passage (continued by the message's later
    * fragments), `k` continues with the id's label as summary and tag, `w` continues with a summary and tag naming the
    * window (they change in every window). Counts its calls. */
  private final class Scripted extends ProblemPassageAnnotator {
    val calls=new AtomicInteger(0)
    /** Prefixes every summary: another run's accepted work for the same input differs. */
    @volatile var prefix=""
    def annotate(owner: String,window: ProblemPassages.Window,previous: Option[ProblemPassages.Carry]): IO[Decision] = IO {
      calls.incrementAndGet()
      var open=previous.nonEmpty
      val first=window.fragments.head.messagePosition
      val decision=Decision(window.fragments.zipWithIndex.map { (fragment,i) =>
        val (start,end)=(Point(i,0),Point(i+1,0)); val label=fragment.messageId.dropWhile(_!='-').drop(1)
        fragment.messageId.head match {
          case 'c' => Part.context(start,end)
          case kind =>
            val continued=open && (kind!='n' || fragment.byteStart>0); open=true
            if(kind=='w') Part(start,end,continued,s"$prefix$label w$first",List(label,s"w$first")) else Part(start,end,continued,prefix+label,List(label))
        }
      })
      ProblemPassages.validate(window,previous.nonEmpty,decision); decision
    }
  }
  /** The same vector for the same text. */
  private def embedding(text: String): List[Double] = { val h=Wire.hash(text); List(1.0,Integer.parseInt(h.take(4),16)/65536.0,Integer.parseInt(h.slice(4,8),16)/65536.0) }
  private final class Vectors extends Embedder {
    def documents(owner: String,text: List[String]): IO[List[List[Double]]] = IO(text.map(embedding))
    def query(owner: String,text: String): IO[List[Double]] = IO.raiseError(new AssertionError("worker queried embedding"))
  }
  private def drain(worker: Worker): Unit = while(worker.once.unsafeRunSync()) {}
  private def uuid(r: java.sql.ResultSet,column: Int): UUID = r.getObject(column,classOf[UUID])
  private def published(f: Fixture,owner: String,session: UUID): UUID = f.incremental.session(owner,session).view.generationId.getOrElse(fail("not published"))
  private final case class Lineage(lineage: UUID,version: Option[Int],format: String,parent: Option[UUID],pieces: Long)
  private def lineage(f: Fixture,generation: UUID): Lineage = f.db.transaction(c => Sql.one(c,"SELECT g.lineage,g.lineage_version,g.passage_format,l.parent,l.pieces FROM ch_generations g JOIN ch_generation_lineage l ON l.generation=g.id WHERE g.id=?",generation)(r =>
    Lineage(uuid(r,1),Option(r.getObject(2)).map(_ => r.getInt(2)),r.getString(3),Option(r.getObject(4,classOf[UUID])),r.getLong(5)))).get
  private def cut(f: Fixture,generation: UUID): ProblemRows.Cut =
    f.db.transaction(c => Sql.one(c,"SELECT cut,session_id FROM ch_generation_lineage l JOIN ch_generations g ON g.id=l.generation WHERE generation=?",generation)(r => ProblemRows.Cut.decode(Sql.json(r,"cut"),uuid(r,2),UUID.randomUUID()))).get
  private def ownChunks(f: Fixture,generation: UUID): List[Int] = f.db.transaction(c => Sql.rows(c,"SELECT ordinal FROM ch_chunks WHERE generation=? ORDER BY ordinal",generation)(_.getInt(1)))
  private val emptyFilter=SearchFilter(None,None,None,None,Nil)
  private val queryVector=embedding(shared(0))
  private val uuidPattern="[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}".r
  private def encode(result: Result): String = Wire.encode(Result.codecJson,result).noSpaces
  /** Every logical row the session's published generation holds, ids replaced by ordinals: chunks (value, document, vector,
    * passage), passages, Context spans, the lineage's tag counts, the counts, and its search rows (each piece once: the
    * superseded ones are retired). */
  private def rows(f: Fixture,generation: UUID): List[String] = f.db.transaction { c =>
    def held(kind: Kind): String = GenerationRows.members(kind,s"'$generation'::uuid")
    Sql.rows(c,s"""SELECT concat_ws('|','chunk',ch.ordinal,(ch.value-'id')::text,ch.document::text,ch.embedding::text,pc.passage_ordinal) FROM (${held(Kind.Piece)}) m
      JOIN ch_chunks ch ON ch.generation=m.origin AND ch.ordinal>=m.lo AND ch.ordinal<m.hi JOIN ch_problem_pieces pc ON pc.generation=ch.generation AND pc.chunk_id=ch.id ORDER BY ch.ordinal""")(_.getString(1))++
    Sql.rows(c,s"SELECT concat_ws('|','passage',p.ordinal,p.initial_summary,(p.value-'id')::text,p.span_count) FROM (${held(Kind.Passage)}) m JOIN ch_problem_passages p ON p.generation=m.origin AND p.ordinal>=m.lo AND p.ordinal<m.hi ORDER BY p.ordinal")(_.getString(1))++
    Sql.rows(c,s"SELECT concat_ws('|','context',x.ordinal,x.message_id,x.message_position,x.start_byte,x.end_byte) FROM (${held(Kind.Context)}) m JOIN ch_context_spans x ON x.generation=m.origin AND x.ordinal>=m.lo AND x.ordinal<m.hi ORDER BY x.ordinal")(_.getString(1))++
    Sql.rows(c,"SELECT 'tag|'||t.tag||'|'||t.pieces FROM ch_generations g JOIN ch_lineage_tags t ON t.lineage=g.lineage WHERE g.id=? ORDER BY t.tag",generation)(_.getString(1))++
    Sql.rows(c,"SELECT concat_ws('|','counts',g.passage_count,l.pieces,(SELECT count(*) FROM ch_search_chunks sc WHERE sc.session_id=g.session_id)) FROM ch_generations g JOIN ch_generation_lineage l ON l.generation=g.id WHERE g.id=?",generation)(_.getString(1))++
    Sql.rows(c,s"""SELECT concat_ws('|','search',sc.ordinal,sc.document::text,sc.embedding::text) FROM ch_generations g JOIN ch_search_chunks sc ON sc.session_id=g.session_id
      AND ${GenerationRows.piece("g.id","g.lineage","g.lineage_version","sc")} WHERE g.id=? ORDER BY sc.ordinal""",generation)(_.getString(1))
  }
  /** Ids of the sessions' published generations and their chunks and passages, by session index and ordinal (the
    * generations by revision). */
  private def labels(f: Fixture,owner: String,sessions: List[UUID]): Map[String,String] = sessions.zipWithIndex.flatMap { (session,index) =>
    val view=f.incremental.session(owner,session).view
    val generation=view.generationId.get
    f.db.transaction { c =>
      Sql.rows(c,s"SELECT ch.id,ch.ordinal FROM (${GenerationRows.members(Kind.Piece)}) m JOIN ch_chunks ch ON ch.generation=m.origin AND ch.ordinal>=m.lo AND ch.ordinal<m.hi",generation)(r => uuid(r,1).toString -> s"chunk:$index:${r.getInt(2)}")++
      Sql.rows(c,s"SELECT p.id,p.ordinal FROM (${GenerationRows.members(Kind.Passage)}) m JOIN ch_problem_passages p ON p.generation=m.origin AND p.ordinal>=m.lo AND p.ordinal<m.hi",generation)(r => uuid(r,1).toString -> s"passage:$index:${r.getInt(2)}")
    } :+ (generation.toString -> s"generation:$index:${view.revision}")
  }.toMap
  /** What the owner reads and finds, ids replaced (`labels`): the session, every chunk, passage and span page, Related,
    * searches in each mode (hits, views, scores, totals, order), a tag filter, facets, the tag catalog, Archive searches
    * with their witnesses; the semantic legs hold every visible row (complete candidate sets: the order is decided by the
    * tie-breaks alone). */
  private def answers(f: Fixture,owner: String,sessions: List[UUID]): List[String] = {
    val content=sessions.flatMap { session =>
      val total=f.incremental.pageChunks(owner,session,0,1,None).total
      val passages=f.incremental.passages(owner,session,0,100,None)
      val related=f.incremental.pageChunks(owner,session,0,1,None).chunks.headOption.map(_.summary).toList.map(text =>
        encode(Result.Related(RelatedResult(f.search.search(owner,SearchQuery(text,SearchMode.Lexical,emptyFilter,11,0),None).hits.filterNot(_.session.id==session).take(10)))))
      List(encode(Result.Session(f.incremental.readSession(owner,session,None))))++(0 until total by 23).map(offset => encode(Result.Chunks(f.incremental.pageChunks(owner,session,offset,23,None))))++
        (0 until math.max(passages.total.toInt,1) by 2).map(offset => encode(Result.Passages(f.incremental.passages(owner,session,offset,2,None))))++
        passages.passages.flatMap(passage => (0 until passage.spanCount.toInt by 17).map(offset => encode(Result.PassageSpans(f.incremental.passageSpans(owner,session,passage.id,offset,17,None)))))++related
    }
    val searches=for {
      (text,offset) <- List("shared finding"->0,"shared finding"->2,"alpha"->0,"beta long"->0)
      mode <- List(SearchMode.Lexical,SearchMode.Semantic,SearchMode.Hybrid)
    } yield encode(Result.Search(f.search.search(owner,SearchQuery(text,mode,emptyFilter,5,offset),Option.when(mode!=SearchMode.Lexical)(queryVector))))
    val filtered=List("long","alpha").map(tag => encode(Result.Search(f.search.search(owner,SearchQuery("shared",SearchMode.Lexical,emptyFilter.copy(tags=List(tag)),10,0),None))))
    val archive=List("mode:lexical finding","mode:semantic shared finding","shared","tag:beta").map { expression =>
      val parsed=ArchiveExpression.parse(expression)
      val vectors=if(parsed.mode==SearchMode.Lexical) Nil else parsed.textOperands.map(ArchiveVector(_,queryVector))
      encode(Result.ArchiveSearch(f.index.sourceSearch(owner,ArchiveQuery(expression,ArchiveSort.LastTimestamp,SortDirection.Desc,None,10,true),parsed,vectors,ReadMaterialization.unrestricted)))
    }
    // A semantic leg that answers holds at least min(visible rows, candidatesPerLeg) candidates (SemanticLeg.complete:
    // else a second pass, exact here, or unavailable): below the limit, every visible row.
    val visible=sessions.map(session => f.incremental.pageChunks(owner,session,0,1,None).total.toLong).sum
    assert(visible<SearchPolicy.candidatesPerLeg,s"$visible visible rows")
    val map=labels(f,owner,sessions)
    (content++searches++filtered++archive++List(encode(Result.Facets(f.search.facets(owner,emptyFilter))),encode(Result.Facets(FacetsResult(Nil,Nil,f.search.tags(owner,TagSearchQuery("",emptyFilter,None,100)))))))
      .map(text => uuidPattern.replaceAllIn(text,m => map.getOrElse(m.matched,m.matched)))
  }
  /** What an explicit view of a session reads (chunk, passage and span pages; the session read reports the head). */
  private def pinned(f: Fixture,owner: String,session: UUID,view: ContentView): List[String] = {
    val total=f.incremental.pageChunks(owner,session,0,1,Some(view)).total
    val passages=f.incremental.passages(owner,session,0,100,Some(view))
    (0 until total by 29).map(offset => encode(Result.Chunks(f.incremental.pageChunks(owner,session,offset,29,Some(view))))).toList++
      List(encode(Result.Passages(passages)))++passages.passages.map(passage => encode(Result.PassageSpans(f.incremental.passageSpans(owner,session,passage.id,0,100,Some(view)))))
  }
  /** The rows the plan of `query` read from `relations` (EXPLAIN ANALYZE): returned and filtered out, per loop. */
  private def rowsExamined(f: Fixture,query: ReadSources.Query,relations: Set[String]): Long = {
    val plan=f.db.transaction(c => Sql.one(c,"EXPLAIN (ANALYZE, FORMAT JSON) "+query.sql,query.args*)(_.getString(1))).get
    def nodes(node: io.circe.Json): List[io.circe.Json] = node :: node.hcursor.downField("Plans").values.toList.flatten.flatMap(nodes)
    nodes(Wire.parse(plan).asArray.get.head.hcursor.downField("Plan").focus.get).filter(_.hcursor.get[String]("Relation Name").toOption.exists(relations)).map { node =>
      def value(field: String): Long = node.hcursor.get[Double](field).toOption.fold(0L)(_.toLong)
      (value("Actual Rows")+value("Rows Removed by Filter")+value("Rows Removed by Index Recheck"))*math.max(value("Actual Loops"),1L)
    }.sum
  }
  private def job(f: Fixture,session: UUID): UUID = f.db.transaction(c => Sql.one(c,"SELECT id FROM ch_jobs WHERE session_id=? ORDER BY revision DESC LIMIT 1",session)(uuid(_,1))).get

  test("incremental publications of three sources of one owner and one of another, from roots and from incremental parents, read exactly as full publications of the same content (every logical row and reader answer up to ids, exact ties across sources), write only the windows from the cut and the open passage's pieces within the horizon, and keep every earlier pin") { database { f =>
    val annotator=new Scripted; val vectors=new Vectors
    val incremental=ModelFixtures.worker(f.incremental,annotator,vectors,f.config,logstage.IzLogger())
    val complete=ModelFixtures.worker(f.complete,annotator,vectors,f.full,logstage.IzLogger())
    // (owner, messages of revision r at r-1): the session-long passage, the mixed one, the steady one, and the steady one
    // of another owner. Revision 4 appends inside the last window (no new window).
    val counts=List(387,453,513,520)
    val plans: List[(String,Int => List[Message],List[Int])]=List(("a",long,counts),("a",mixed,List(130,194,258,270)),("a",steady,counts),("b",steady,counts))
    // The mixed source's cuts: revision 2 re-does a Context-only window that an empty message precedes, revision 3 one in
    // which alpha closes (beta opens), revision 4 one starting inside a message longer than a window (beta's last span
    // is extended across the cut).
    def windows(values: List[Message]): Vector[ProblemPassages.Window] = {
      val source=ProblemPassages.Source(values)
      Iterator.iterate(source.next(ProblemPassages.SourceCursor.start))(_.flatMap(window => source.next(window.next))).takeWhile(_.nonEmpty).flatten.toVector
    }
    val mixedCuts=List(130,194,258,270).map(n => windows(mixed(n)).last)
    assertEquals(mixedCuts.map(window => (window.start.messagePosition,window.start.utf16Offset>0)).take(3).map(_._1),List(127,192,257))
    assert(mixedCuts(0).fragments.forall(_.messageId.startsWith("c")) && mixed(130)(128).text.isEmpty)
    assert(windows(mixed(194))(2).fragments.forall(_.messageId.startsWith("c")) && windows(mixed(258))(3).fragments.head.messageId=="n193-beta")
    assert(mixedCuts(3).start.utf16Offset>0 && mixedCuts(3).fragments.head.messageId=="k257-beta" && windows(mixed(270)).size==windows(mixed(258)).size)
    val sessions=plans.map((owner,messages,sizes) => f.incremental.ingest(owner,request(messages(sizes.head),None,0)).sessionId)
    drain(incremental)
    val owned=sessions.zip(plans).groupMap(_._2._1)(_._1)
    var pins=List.empty[((String,UUID,ContentView),List[String])]
    def pin(): Unit = plans.zip(sessions).foreach { case ((owner,_,_),session) =>
      val view=f.incremental.session(owner,session).view
      pins:+=((owner,session,view),pinned(f,owner,session,view))
    }
    def pinsUnchanged(): Unit = pins.foreach { case ((owner,session,view),expected) => assertEquals(pinned(f,owner,session,view),expected,view.toString) }
    pin()
    (1 until counts.size).foreach { r =>
      val parents=plans.zip(sessions).map { case ((owner,_,_),session) => published(f,owner,session) }
      plans.zip(sessions).foreach { case ((owner,messages,sizes),session) =>
        f.incremental.ingest(owner,request(messages(sizes(r)),Some(f.incremental.headSnapshot(owner,session).source),r))
      }
      drain(incremental)
      // Each publication writes the windows from the parent's cut on and at most B's pieces in the horizon's windows
      // before it (none where B's metadata stays), as the next version of its parent's lineage.
      plans.zip(sessions).zip(parents).foreach { case (((owner,_,_),session),parent) =>
        val generation=published(f,owner,session)
        val (before,after)=(lineage(f,parent),lineage(f,generation))
        val parentCut=cut(f,parent)
        val own=ownChunks(f,generation)
        val tail=after.pieces-parentCut.state.nextPieceOrdinal
        assert(own.size<=after.pieces-parentCut.firstPieces.head && own.size>=tail,s"$owner r$r: ${own.size} own rows of ${after.pieces}")
        assertEquals((after.lineage,after.version,after.format,after.parent),(before.lineage,before.version.map(_+1),GenerationRows.lineageFormat,Some(parent)),s"$owner $session r$r")
        assertEquals(own.takeRight(tail.toInt),(parentCut.state.nextPieceOrdinal until after.pieces).map(_.toInt).toList)
        // The session-long passage's summary names the window: once the revision adds windows, the pieces of the windows
        // before the cut whose horizon reaches the new ones are written again; without a new window none is.
        if(session==sessions(0)) assertEquals(own.size>tail,cut(f,generation).window>parentCut.window,s"r$r")
        if(session==sessions(2)) assertEquals(own.size.toLong,tail,"B's metadata stays: its pieces keep their rows")
      }
      val incrementalRows=plans.zip(sessions).map { case ((owner,_,_),session) => rows(f,published(f,owner,session)) }
      val incrementalAnswers=owned.toList.sortBy(_._1).map((owner,ids) => answers(f,owner,ids))
      pin()
      // The same revisions published as roots (every window's accepted work reused: no model call).
      annotator.calls.set(0)
      plans.zip(sessions).foreach { case ((owner,_,_),session) => f.incremental.retry(owner,job(f,session)) }
      drain(complete)
      assertEquals(annotator.calls.get,0)
      plans.zip(sessions).foreach { case ((owner,_,_),session) => val root=published(f,owner,session); assertEquals(lineage(f,root).lineage,root) }
      assertEquals(plans.zip(sessions).map { case ((owner,_,_),session) => rows(f,published(f,owner,session)) },incrementalRows)
      assertEquals(owned.toList.sortBy(_._1).map((owner,ids) => answers(f,owner,ids)),incrementalAnswers)
      pin()
      // The next revision grows from an incremental version of that root (the same revision published again).
      if(r<counts.size-1) {
        plans.zip(sessions).foreach { case ((owner,_,_),session) => f.incremental.retry(owner,job(f,session)) }
        drain(incremental)
        plans.zip(sessions).foreach { case ((owner,_,_),session) => assertEquals(lineage(f,published(f,owner,session)).version,Some(1)) }
        assertEquals(plans.zip(sessions).map { case ((owner,_,_),session) => rows(f,published(f,owner,session)) },incrementalRows)
        pin()
      }
      pinsUnchanged()
    }
    // A replacement (a new epoch) is a root.
    plans.zip(sessions).foreach { case ((owner,messages,sizes),session) =>
      val values=messages(sizes.last)
      f.incremental.ingest(owner,request(values.updated(1,values(1).copy(text="replaced context")),Some(f.incremental.headSnapshot(owner,session).source),counts.size))
    }
    drain(incremental)
    plans.zip(sessions).foreach { case ((owner,_,_),session) => val root=published(f,owner,session); assertEquals((lineage(f,root).lineage,lineage(f,root).version),(root,Some(0))) }
    pinsUnchanged()
  }}

  test("with a horizon of 4 windows a window before the cut whose metadata returns to its member rows' keeps them (ids, origin) while the others are written again; an incremental publication stopped in its pieces and then by a lost lease in its search rows is invisible and resumed by its run; its switch changes the counted segment rows; a root's switch changes at most 6 rows (its tags staged before it); both equal a full publication; a horizon of 2147483647 differs exactly in the windows beyond 4") { database { f =>
    val annotator=new Scripted; val vectors=new Vectors
    val incremental=ModelFixtures.worker(f.incremental,annotator,vectors,f.config,logstage.IzLogger())
    val complete=ModelFixtures.worker(f.complete,annotator,vectors,f.full,logstage.IzLogger())
    // One passage (B, passage 0), eight pieces a window. Its metadata after window 5 is "x" in revision 2 ("m0" in
    // revision 1, whose last window is 5), after window 6 "m0", after window 7 (revision 2's last) "y".
    def label(p: Int): String = if(p<330) "m0" else if(p<384) "x" else if(p<448) "m0" else "y"
    def values(count: Int): List[Message] = (0 until count).map(p => if(p==0) message("n0-m0",p,shared(p)) else if(p%8==0) message(s"k$p-${label(p)}",p,shared(p)) else context(p)).toList
    // Every row-changing statement on the lineage tables, by transaction.
    f.db.transaction { c =>
      Sql.exec(c,"CREATE TABLE ch_test_changes(txid bigint,tbl text,op text,n bigint)")
      Sql.exec(c,"CREATE FUNCTION ch_test_new() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO ch_test_changes SELECT txid_current(),TG_TABLE_NAME,TG_OP,count(*) FROM changed; RETURN NULL; END $$")
      Sql.exec(c,"CREATE FUNCTION ch_test_old() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO ch_test_changes SELECT txid_current(),TG_TABLE_NAME,TG_OP,count(*) FROM changed; RETURN NULL; END $$")
      for(table <- List("ch_lineage_segments","ch_lineage_tags","ch_generations","ch_lineage_retirements","ch_generation_retirements","ch_search_retirements","ch_sources")) {
        Sql.exec(c,s"CREATE TRIGGER ${table}_i AFTER INSERT ON $table REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION ch_test_new()")
        Sql.exec(c,s"CREATE TRIGGER ${table}_u AFTER UPDATE ON $table REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION ch_test_new()")
        Sql.exec(c,s"CREATE TRIGGER ${table}_d AFTER DELETE ON $table REFERENCING OLD TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION ch_test_old()")
      }
    }
    /** The rows each statement of the switch to `generation` changed: (table, operation, rows). */
    def switched(): List[(String,String,Long)] = f.db.transaction(c => Sql.rows(c,"""SELECT tbl,op,sum(n) FROM ch_test_changes WHERE n>0 AND tbl<>'ch_sources'
      AND txid=(SELECT x.txid FROM ch_test_changes x WHERE x.tbl='ch_sources' AND x.op='UPDATE' AND x.n>0 ORDER BY x.txid DESC LIMIT 1) GROUP BY tbl,op ORDER BY tbl,op""")(r => (r.getString(1),r.getString(2),r.getLong(3))))
    try {
      val session=f.incremental.ingest("a",request(values(330),None,0)).sessionId
      drain(incremental)
      val root=published(f,"a",session)
      assertEquals((lineage(f,root).lineage,cut(f,root).window,cut(f,root).firstWindow),(root,5,1))
      val rootChunks=f.incremental.pageChunks("a",session,0,100,None).chunks
      f.incremental.ingest("a",request(values(457),Some(f.incremental.headSnapshot("a",session).source),1))
      def invisible(staged: UUID): Unit = {
        assertEquals(f.search.search("a",SearchQuery("y",SearchMode.Lexical,emptyFilter,10,0),None).hits,Nil)
        assertEquals(f.search.search("a",SearchQuery("shared",SearchMode.Hybrid,emptyFilter,10,0),Some(queryVector)).hits.map(_.session.view),List(ContentView(1,Some(root))))
        assertEquals(f.incremental.pageChunks("a",session,0,100,None).chunks,rootChunks)
        assertEquals(intercept[DomainError](f.incremental.pageChunks("a",session,0,10,Some(ContentView(2,Some(staged))))).code,"not-found")
      }
      def staged(): (UUID,String,Int) = f.db.transaction(c => Sql.one(c,"SELECT st.generation,st.phase,(SELECT count(*) FROM ch_search_chunks sc WHERE sc.generation=st.generation) FROM ch_staged_generations st")(r => (uuid(r,1),r.getString(2),r.getInt(3)))).get
      // The first attempt stops writing its chunks (the job fails and is queued again), the second loses its lease
      // after its search rows (the switch finds the lease ended); the same run continues the same staged generation.
      f.db.transaction { c =>
        Sql.exec(c,"CREATE FUNCTION ch_test_stop() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS(SELECT 1 FROM inserted i JOIN ch_generations g ON g.id=i.generation WHERE g.lineage<>g.id) THEN RAISE EXCEPTION 'stopped'; END IF; RETURN NULL; END $$")
        Sql.exec(c,"CREATE TRIGGER ch_test_stop AFTER INSERT ON ch_chunks REFERENCING NEW TABLE AS inserted FOR EACH STATEMENT EXECUTE FUNCTION ch_test_stop()")
      }
      assert(incremental.once.unsafeRunSync())
      val (generation,phase,_)=staged()
      assertEquals(phase,"Pieces"); invisible(generation)
      f.db.transaction { c =>
        Sql.exec(c,"DROP FUNCTION ch_test_stop() CASCADE")
        Sql.exec(c,"CREATE FUNCTION ch_test_lease() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE ch_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE state='Running'; RETURN NULL; END $$")
        Sql.exec(c,"CREATE TRIGGER ch_test_lease AFTER INSERT ON ch_search_chunks FOR EACH STATEMENT EXECUTE FUNCTION ch_test_lease()")
      }
      assert(incremental.once.unsafeRunSync())
      val (again,_,searchRows)=staged()
      assertEquals(again,generation); assert(searchRows>0); invisible(generation)
      f.db.transaction(c => Sql.exec(c,"DROP FUNCTION ch_test_lease() CASCADE"))
      assert(incremental.once.unsafeRunSync())
      assertEquals(published(f,"a",session),generation)
      assertEquals(lineage(f,generation),Lineage(root,Some(1),GenerationRows.lineageFormat,Some(root),58))
      // Windows 1, 3 and 4 (pieces 8-15, 24-39) are written again under the new metadata, window 2 (16-23) keeps the
      // root's rows; window 5 on is the generation's own.
      assertEquals(ownChunks(f,generation),((8 until 16)++(24 until 58)).toList)
      val chunks=f.incremental.pageChunks("a",session,0,100,None).chunks
      assertEquals(chunks.slice(16,24),rootChunks.slice(16,24))
      assert(chunks.slice(8,16).map(_.id).intersect(rootChunks.map(_.id)).isEmpty && chunks.slice(24,40).map(_.id).intersect(rootChunks.map(_.id)).isEmpty)
      assertEquals(chunks.map(_.summary).grouped(8).map(_.distinct).toList,List(List("m0"),List("x"),List("m0"),List("y"),List("y"),List("y"),List("y"),List("y")))
      // The root's segment row of each kind closed; inserted: the pieces before window 1 and window 2, B's spans before
      // its last one, the Context spans before the cut; its own rows: window 1, window 3 on, B and after, B's last span
      // and after, the Context spans from the cut. Superseded: pieces 8-15 and 24-39.
      assertEquals(switched().filter(_._1=="ch_lineage_segments"),List(("ch_lineage_segments","INSERT",9L),("ch_lineage_segments","UPDATE",4L)))
      assertEquals(f.db.transaction(c => Sql.rows(c,"SELECT concat_ws('|',origin=?,piece_lo,piece_hi) FROM ch_search_retirements WHERE session_id=?",root,session)(_.getString(1))),Nil)
      def tags(lineage: UUID): List[String] = f.db.transaction(c => Sql.rows(c,"SELECT tag||':'||pieces FROM ch_lineage_tags WHERE lineage=? ORDER BY tag",lineage)(_.getString(1)))
      def memberTags(generation: UUID): List[String] = f.db.transaction(c => Sql.rows(c,s"""SELECT tag||':'||count(*) FROM (${GenerationRows.members(Kind.Piece)}) m JOIN ch_chunks ch ON ch.generation=m.origin AND ch.ordinal>=m.lo AND ch.ordinal<m.hi
        CROSS JOIN LATERAL(SELECT DISTINCT jsonb_array_elements_text(ch.value->'tags') AS tag) t GROUP BY tag ORDER BY tag""",generation)(_.getString(1)))
      assertEquals(tags(root),memberTags(generation))
      assertEquals(f.db.transaction(c => Sql.one(c,"SELECT count(*) FROM ch_search_chunks WHERE session_id=?",session)(_.getInt(1))),Some(58))
      val incrementalRows=rows(f,generation)
      // A root of the same revision: its tag counts were written before its switch, which changes its four segment rows,
      // its generation row, and queues the replaced generation and lineage; the replaced lineage's tags go afterwards.
      f.incremental.retry("a",job(f,session))
      drain(complete)
      val replacing=published(f,"a",session)
      assertEquals(switched(),List(("ch_generation_retirements","INSERT",1L),("ch_generations","UPDATE",2L),("ch_lineage_retirements","INSERT",1L),("ch_lineage_segments","UPDATE",4L)))
      assert(f.db.transaction(c => Sql.one(c,"SELECT count(*) FROM ch_test_changes WHERE tbl='ch_lineage_tags' AND op='INSERT' AND n>0 AND txid<(SELECT max(txid) FROM ch_test_changes WHERE tbl='ch_sources')")(_.getInt(1))).exists(_>0))
      assertEquals((tags(root),tags(replacing)),(Nil,memberTags(replacing)))
      assertEquals(rows(f,replacing),incrementalRows)
      // The same accepted work published with a horizon of 2147483647 (final metadata): only the pieces of windows
      // 0-2 (k + 4 < 7, the last window) differ.
      val unbounded=f.full.copy(indexing=f.full.indexing.copy(metadataHorizonWindows=Int.MaxValue))
      val finals=ModelFixtures.worker(new PostgresArchive(f.db,unbounded),annotator,vectors,unbounded,logstage.IzLogger())
      annotator.calls.set(0)
      f.incremental.retry("a",job(f,session))
      drain(finals)
      assertEquals(annotator.calls.get,0)
      val horizonFour=f.db.transaction(c => Sql.rows(c,s"SELECT ch.value FROM (${GenerationRows.members(Kind.Piece)}) m JOIN ch_chunks ch ON ch.generation=m.origin AND ch.ordinal>=m.lo AND ch.ordinal<m.hi ORDER BY ch.ordinal",replacing)(r => Wire.decode(Chunk.codecJson,Sql.json(r,"value"))))
      val differing=f.incremental.pageChunks("a",session,0,100,None).chunks.zip(horizonFour).zipWithIndex.collect { case ((a,b),ordinal) if (a.summary,a.tags)!=(b.summary,b.tags) => ordinal/8 }.distinct
      assertEquals(differing,List(0,1,2))
      // An incremental publication whose parent is no longer published at its switch is abandoned and its job queued
      // again; the next attempt publishes a root (the published generation has no cut: its horizon exceeds the default).
      val unpublishable=published(f,"a",session)
      f.db.transaction(c => Sql.exec(c,"UPDATE ch_sources SET published=? WHERE id=?",replacing,session))
      f.incremental.ingest("a",request(values(470),Some(f.incremental.headSnapshot("a",session).source),2))
      f.db.transaction { c =>
        Sql.exec(c,s"CREATE FUNCTION ch_test_unpublish() RETURNS trigger LANGUAGE plpgsql AS $$$$ BEGIN UPDATE ch_sources SET published='$unpublishable' WHERE id='$session'; RETURN NULL; END $$$$")
        Sql.exec(c,"CREATE TRIGGER ch_test_unpublish AFTER INSERT ON ch_search_chunks FOR EACH STATEMENT EXECUTE FUNCTION ch_test_unpublish()")
      }
      try assert(incremental.once.unsafeRunSync()) finally f.db.transaction(c => Sql.exec(c,"DROP FUNCTION ch_test_unpublish() CASCADE"))
      val (abandoned,_,_)=staged()
      assertEquals(f.db.transaction(c => Sql.one(c,"SELECT concat_ws('|',st.run_id=st.generation,j.state,j.error) FROM ch_staged_generations st JOIN ch_jobs j ON j.id=st.job_id")(_.getString(1))),Some("t|Queued|stale-claim"))
      assertEquals(lineage(f,abandoned).parent,Some(replacing))
      drain(incremental)
      val third=published(f,"a",session)
      assertEquals((lineage(f,third).lineage,f.db.transaction(c => Sql.one(c,"SELECT count(*) FROM ch_generations WHERE id=?",abandoned)(_.getInt(1)))),(third,Some(0)))
      // A confirmed owner rebuild into the same profile calls the models for every window and publishes a root, whose
      // switch retires the history (an incremental version continuing it is never published).
      f.incremental.ingest("a",request(values(480),Some(f.incremental.headSnapshot("a",session).source),3))
      drain(incremental)
      val beforeRebuild=published(f,"a",session)
      assertEquals(lineage(f,beforeRebuild).parent,Some(third))
      Fixtures.rebuild(f.db,"a")
      annotator.calls.set(0)
      drain(incremental)
      val rebuilt=published(f,"a",session)
      assertEquals((lineage(f,rebuilt).lineage,annotator.calls.get),(rebuilt,cut(f,rebuilt).window+1))
      assertEquals(intercept[DomainError](f.incremental.pageChunks("a",session,0,10,Some(ContentView(4,Some(beforeRebuild))))).code,"indexed-view-retired")
    } finally f.db.transaction(c => Sql.exec(c,"DROP TABLE ch_test_changes; DROP FUNCTION IF EXISTS ch_test_new,ch_test_old,ch_test_stop,ch_test_lease,ch_test_unpublish CASCADE"))
  }}

  test("a confirmed rebuild's accepted work stays its lineage's through incremental versions: a later full republication takes it, not the replaced run's work for the same input, and reads as the incremental version; the switch and the parent's reads examine the rows around the tail, not the lineage's history") { database { f =>
    val annotator=new Scripted; val vectors=new Vectors
    val incremental=ModelFixtures.worker(f.incremental,annotator,vectors,f.config,logstage.IzLogger())
    val complete=ModelFixtures.worker(f.complete,annotator,vectors,f.full,logstage.IzLogger())
    val session=f.incremental.ingest("a",request(long(387),None,0)).sessionId
    annotator.prefix="first "
    drain(incremental)
    // The rebuild's run accepts other annotations for the same inputs; its id sorts after the first run's (the order a
    // lookup falls back to among one job's runs).
    Fixtures.rebuild(f.db,"a")
    f.db.transaction { c =>
      Sql.exec(c,"UPDATE ch_reindex_members SET run_id='ffffffff-ffff-4fff-bfff-ffffffffffff' WHERE session_id=?",session)
      Sql.exec(c,"UPDATE ch_jobs SET run_id='ffffffff-ffff-4fff-bfff-ffffffffffff' WHERE session_id=? AND state='Queued'",session)
    }
    annotator.prefix="rebuilt "
    drain(incremental)
    f.incremental.ingest("a",request(long(453),Some(f.incremental.headSnapshot("a",session).source),1))
    drain(incremental)
    val version=published(f,"a",session)
    assertEquals(lineage(f,version).version,Some(1))
    val incrementalRows=rows(f,version)
    assert(f.incremental.pageChunks("a",session,0,100,None).chunks.forall(_.summary.startsWith("rebuilt ")))
    // The tail reads of the latest version: the switch's segment rows of each kind and the rewrite region's pieces.
    val cutValue=cut(f,version)
    val parentLineage=lineage(f,version).lineage
    def examined(): Long = (GenerationRows.Kind.values.toList.map(kind => PassageStorage.tailSegments(parentLineage,kind,(0,cutValue.firstPieces.head))):+
      PassageStorage.membersQuery(parentLineage,session,2,cutValue.firstPieces.head,cutValue.state.nextPieceOrdinal)).map(rowsExamined(f,_,Set("ch_lineage_segments"))).sum
    val before=examined()
    val base=f.db.transaction(c => Sql.one(c,"SELECT count(*) FROM ch_lineage_segments WHERE lineage=?",parentLineage)(_.getLong(1))).get
    // A long history: rows of earlier versions (closed) and runs of earlier origins before the tail (open), neither
    // holding any piece the session has.
    f.db.transaction { c =>
      Sql.exec(c,"""INSERT INTO ch_lineage_segments(lineage,origin,kind,since,until,lo_major,lo,hi_major,hi) SELECT ?,?,k,0,1,0,1000000000+i,0,1000000001+i
        FROM generate_series(1,2000) i CROSS JOIN unnest(ARRAY['piece','passage','span','context']) k""",parentLineage,parentLineage)
      Sql.exec(c,"""INSERT INTO ch_lineage_segments(lineage,origin,kind,since,until,lo_major,lo,hi_major,hi) SELECT ?,?,k,0,NULL,0,-1000000001-i,0,-1000000000-i
        FROM generate_series(1,2000) i CROSS JOIN unnest(ARRAY['piece','passage','span','context']) k""",parentLineage,parentLineage)
      Sql.exec(c,"ANALYZE ch_lineage_segments")
    }
    // The rows around the tail, not the lineage's (before the history the table is small and a plan may scan it whole).
    val after=examined()
    assert(after<=16,s"segment rows examined: $before of the lineage's $base, with a history of 16,000 more $after")
    // The same revision published whole takes the rebuild's accepted work (no model call): equal to the incremental version.
    annotator.calls.set(0)
    f.incremental.retry("a",job(f,session))
    drain(complete)
    assertEquals(annotator.calls.get,0)
    assertEquals(rows(f,published(f,"a",session)),incrementalRows)
    // The reuse lookup of a checkpoint that 2,000 runs referenced (a recurring part across many versions) examines a
    // bounded number of reference and generation rows, not its referrers.
    val (checkpointJob,stage,content)=f.db.transaction(c => Sql.one(c,"""SELECT k.job_id,k.stage,k.content_hash FROM ch_index_checkpoints k JOIN ch_jobs j ON j.id=k.job_id
      WHERE j.session_id=? AND k.content_hash IS NOT NULL AND k.stage='Embedding' ORDER BY k.job_id,k.run_id,k.window_ordinal,k.part LIMIT 1""",session)(r => (uuid(r,1),r.getString(2),r.getString(3)))).get
    f.db.transaction { c =>
      Sql.exec(c,"""INSERT INTO ch_index_checkpoint_refs(job_id,run_id,stage,window_ordinal,part,input_hash,source_job,source_run,source_stage,source_window,source_part,output_hash)
        SELECT k.job_id,gen_random_uuid(),k.stage,100000+i,0,repeat('0',64),k.job_id,k.run_id,k.stage,k.window_ordinal,k.part,k.output_hash
        FROM (SELECT * FROM ch_index_checkpoints WHERE job_id=? AND content_hash=? LIMIT 1) k CROSS JOIN generate_series(1,2000) i""",checkpointJob,content)
      Sql.exec(c,"ANALYZE ch_index_checkpoint_refs")
    }
    val lookup=IndexCheckpoints.reusableQuery(session,f.config.profile,(UUID.randomUUID(),UUID.randomUUID()),IndexingStage.valueOf(stage),content)
    val references=rowsExamined(f,lookup,Set("ch_index_checkpoint_refs","ch_generations"))
    assert(references<=40,s"$references reference and generation rows examined")
  }}

  test("a staged root continues only under the metadata horizon it was staged with: stopped after its first committed pieces under a horizon of 2147483647, it is staged again from nothing under 4") { database { f =>
    val annotator=new Scripted; val vectors=new Vectors
    val unbounded=f.full.copy(indexing=f.full.indexing.copy(metadataHorizonWindows=Int.MaxValue))
    val finals=ModelFixtures.worker(new PostgresArchive(f.db,unbounded),annotator,vectors,unbounded,logstage.IzLogger())
    val complete=ModelFixtures.worker(f.complete,annotator,vectors,f.full,logstage.IzLogger())
    // One passage whose summary names the window, every message a piece: 64 pieces a window, 10 windows.
    val session=f.incremental.ingest("a",request((0 until 600).map(p => message(if(p==0) "n0-long" else s"w$p-long",p,shared(p))).toList,None,0)).sessionId
    f.db.transaction { c =>
      Sql.exec(c,"CREATE FUNCTION ch_test_stop() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF (SELECT count(*) FROM ch_chunks WHERE generation IN(SELECT generation FROM inserted))>500 THEN RAISE EXCEPTION 'stopped'; END IF; RETURN NULL; END $$")
      Sql.exec(c,"CREATE TRIGGER ch_test_stop AFTER INSERT ON ch_chunks REFERENCING NEW TABLE AS inserted FOR EACH STATEMENT EXECUTE FUNCTION ch_test_stop()")
    }
    val stopped=try {
      assert(finals.once.unsafeRunSync())
      f.db.transaction(c => Sql.one(c,"SELECT st.generation,st.resume->>'horizon',(SELECT count(*) FROM ch_chunks ch WHERE ch.generation=st.generation) FROM ch_staged_generations st")(r => (uuid(r,1),r.getString(2),r.getInt(3)))).get
    } finally f.db.transaction(c => Sql.exec(c,"DROP FUNCTION ch_test_stop() CASCADE"))
    assertEquals((stopped._2,stopped._3),(Int.MaxValue.toString,PassageStorage.rowsPerBatch))
    drain(complete)
    val root=published(f,"a",session)
    // Its pieces, tag counts and cut are those of a publication under 4 from nothing (a RetryJob's).
    val resumed=rows(f,root)
    f.incremental.retry("a",job(f,session))
    drain(complete)
    assertEquals(rows(f,published(f,"a",session)),resumed)
    assertEquals((root==stopped._1,f.db.transaction(c => Sql.one(c,"SELECT count(*) FROM ch_generations WHERE id=?",stopped._1)(_.getInt(1))),cut(f,root).horizon),(false,Some(0),horizon))
  }}

  test("indexing.metadataHorizonWindows: 1..2147483647, default 16, optional; another value requires indexing.incrementalPublication=false, which defaults to true") {
    val config=Fixtures.config()
    import Config.given
    def capacity(fields: (String,Json)*): IndexingCapacity =
      Json.obj((List("annotationSessions"->Json.fromInt(4),"embeddingRequests"->Json.fromInt(8),"embeddingBatchSize"->Json.fromInt(16))++fields)*).as[IndexingCapacity].toOption.get
    assertEquals(capacity(),IndexingCapacity(4,8,16,true,16))
    assertEquals(capacity("incrementalPublication"->Json.False,"metadataHorizonWindows"->Json.fromInt(Int.MaxValue)),IndexingCapacity(4,8,16,false,Int.MaxValue))
    config.copy(indexing=capacity("incrementalPublication"->Json.False,"metadataHorizonWindows"->Json.fromInt(4))).validate()
    for(horizon <- List(4,0)) {
      val refused=intercept[DomainError](config.copy(indexing=IndexingCapacity(4,8,16,horizon==4,horizon)).validate())
      assertEquals(refused.code,"config")
      assert(refused.detail.contains("indexing.metadataHorizonWindows"),refused.detail)
    }
    assert(intercept[DomainError](config.copy(indexing=IndexingCapacity(4,8,16,true,4)).validate()).detail.contains("indexing.incrementalPublication=false"))
  }
}
