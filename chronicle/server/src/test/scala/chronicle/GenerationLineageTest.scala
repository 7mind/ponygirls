package chronicle

import chronicle.api.*
import java.nio.charset.StandardCharsets.UTF_8
import java.util.UUID
import scala.concurrent.duration.*
import ProblemPassages.{Decision,Part,Point}
import GenerationRows.Kind

/** Generation lineage, migration 028 (ingest-limits spec §5.6.2–§5.6.4, unit L5e-1): readers over rows shared by the
  * versions of a lineage (built here by hand as an incremental publication writes them; this release publishes roots),
  * the per-tuple membership probe's plan, the ranking tie-break, the roots' lineage rows and down-028. */
final class GenerationLineageTest extends munit.FunSuite {
  override val munitTimeout=3.minutes
  private final case class Fixture(config: Config,db: Database,archive: PostgresArchive,search: PostgresSearch,index: PostgresArchiveIndex)
  private def database(run: Fixture => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh") }
    val config=Fixtures.config(); val db=new Database(config,IndexProfileCatalog.current(config)); db.initialize()
    db.transaction { c =>
      Sql.exec(c,"TRUNCATE ch_epochs,ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks CASCADE")
      Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=0",config.profile)
    }
    val archive=new PostgresArchive(db,config)
    try run(Fixture(config,db,archive,new PostgresSearch(db,archive,config),new PostgresArchiveIndex(db,archive,config))) finally db.close()
  }
  private val texts=List("apple orchard","banana grove","context bootstrap","cherry tree","date palm","elder berry","fig leaf","grape vine","honey melon")
  private def request(count: Int,source: Option[SourceIdentity]=None,revision: Int=0): IngestRequest = {
    val base=ProblemPublicationFixtures.request(texts.take(count))
    base.copy(source=source.getOrElse(base.source),expectedRevision=revision)
  }
  /** Passages alpha (m0, m1), Context (m2), beta (m3, m4), omega (m5, m6): six pieces, three passages, one Context span. */
  private def decide(window: ProblemPassages.Window,previous: Option[ProblemPassages.Carry]): Decision = Decision(Vector(
    Part(Point(0,0),Point(1,0),false,"alpha goal",List("t-alpha")),Part(Point(1,0),Point(2,0),true,"alpha goal",List("t-alpha")),
    Part.context(Point(2,0),Point(3,0)),
    Part(Point(3,0),Point(4,0),false,"beta goal",List("t-beta")),Part(Point(4,0),Point(5,0),true,"beta goal",List("t-beta")),
    Part(Point(5,0),Point(6,0),false,"omega goal",List("t-omega")),Part(Point(6,0),window.terminal,true,"omega goal",List("t-omega"))))
  /** A source of `owner` whose first revision (seven messages) is published as a root by the production publication. */
  private def root(f: Fixture,owner: String): UUID = {
    val receipt=f.archive.ingest(owner,request(7))
    val claim=f.archive.claim(Set(f.config.profile),ClaimScope.Owner(owner),300).get
    assertEquals(claim.sessionId,receipt.sessionId)
    assert(f.archive.publishProblems(claim,ProblemPublicationFixtures.build(claim,decide)))
    receipt.sessionId
  }
  private def revise(f: Fixture,owner: String,session: UUID,count: Int): Int = {
    val head=f.archive.headSnapshot(owner,session)
    f.archive.ingest(owner,request(count,Some(head.source),f.archive.session(owner,session).revision)).revision
  }
  private def uuid(r: java.sql.ResultSet,column: Int): UUID = r.getObject(column,classOf[UUID])
  /** Version v+1 of the lineage of the source's published generation (version v), written by hand as an incremental
    * publication of `revision` writes it: the last passage B rewritten with `summary` and `tag` (its row, its spans, and
    * its pieces as twins with new ids, the same texts and vectors) and one new passage of one piece (summary, tag,
    * message position); published (superseded segment rows closed, their pieces' search rows queued, the lineage's tags
    * those of the pieces it holds) or staged for `job` (its own segments invisible). */
  private def grow(f: Fixture,session: UUID,revision: Int,summary: String,tag: String,added: Option[(String,String,Int)],staged: Option[UUID]=None): UUID = f.db.transaction { c =>
    val (parent,lineage,version,profile,passages)=Sql.one(c,"SELECT g.id,g.lineage,g.lineage_version,g.profile,g.passage_count FROM ch_sources s JOIN ch_generations g ON g.id=s.published WHERE s.id=?",session)(r =>
      (uuid(r,1),uuid(r,2),r.getInt(3),r.getString(4),r.getInt(5))).get
    val pieces=GenerationRows.pieceCount(c,parent)
    val b=passages-1
    val generation=UUID.randomUUID()
    val next=version+1
    def held(kind: Kind): String = GenerationRows.members(kind,s"'$parent'::uuid")
    Sql.exec(c,s"INSERT INTO ch_generations(id,session_id,revision,profile,passage_format,passage_count,run_id,lineage,lineage_version) VALUES(?,?,?,?,?,?,?,?,${if(staged.isEmpty) next else "NULL"})",
      generation,session,revision,profile,GenerationRows.lineageFormat,(passages+added.size).toLong,UUID.randomUUID(),lineage)
    val (passage,initial,spanCount)=Sql.one(c,s"SELECT p.value,p.initial_summary,p.span_count FROM (${held(Kind.Passage)}) m JOIN ch_problem_passages p ON p.generation=m.origin AND p.ordinal>=m.lo AND p.ordinal<m.hi WHERE p.ordinal=?",b)(r =>
      (Wire.decode(PassageInfo.codecJson,Sql.json(r,"value")),r.getString(2),r.getLong(3))).get
    def passageRow(info: PassageInfo,initialSummary: String,spans: Long): Unit =
      Sql.exec(c,"INSERT INTO ch_problem_passages(generation,id,ordinal,initial_summary,value,span_count) VALUES(?,?,?,?,?::jsonb,?)",generation,info.id,info.ordinal,initialSummary,Wire.encode(PassageInfo.codecJson,info).noSpaces,spans)
    passageRow(passage.copy(summary=summary,tags=List(tag)),initial,spanCount)
    // B's last span (the one a window can extend) is rewritten; its earlier spans stay the parent's.
    Sql.exec(c,s"""INSERT INTO ch_problem_spans(generation,passage_id,ordinal,message_id,message_position,start_byte,end_byte) SELECT ?,sp.passage_id,sp.ordinal,sp.message_id,sp.message_position,sp.start_byte,sp.end_byte
      FROM (${held(Kind.Span)}) m JOIN ch_problem_spans sp ON sp.generation=m.origin AND sp.passage_id=? AND sp.ordinal=? AND (?,sp.ordinal)>=(m.lo_major,m.lo) AND (?,sp.ordinal)<(m.hi_major,m.hi)""",generation,passage.id,spanCount-1,b,b)
    def piece(ordinal: Int,value: Chunk,vector: String,passageOrdinal: Int): Unit = {
      Sql.exec(c,"INSERT INTO ch_chunks(id,generation,value,document,embedding,ordinal) VALUES(?,?,?::jsonb,to_tsvector('english',?),?::vector,?)",
        value.id,generation,Wire.encode(Chunk.codecJson,value).noSpaces,s"${value.text} ${value.summary} ${value.tags.mkString(" ")}",vector,ordinal)
      Sql.exec(c,"INSERT INTO ch_problem_pieces(generation,chunk_id,passage_ordinal,piece_ordinal) VALUES(?,?,?,?)",generation,value.id,passageOrdinal,ordinal)
    }
    val twins=Sql.rows(c,s"""SELECT ch.ordinal,ch.value,ch.embedding::text FROM (${held(Kind.Piece)}) m JOIN ch_chunks ch ON ch.generation=m.origin AND ch.ordinal>=m.lo AND ch.ordinal<m.hi
      JOIN ch_problem_pieces pc ON pc.generation=ch.generation AND pc.chunk_id=ch.id WHERE pc.passage_ordinal=? ORDER BY ch.ordinal""",b)(r => (r.getInt(1),Wire.decode(Chunk.codecJson,Sql.json(r,"value")),r.getString(3)))
    twins.foreach((ordinal,value,vector) => piece(ordinal,value.copy(id=UUID.randomUUID(),summary=summary,tags=List(tag)),vector,b))
    added.foreach { (addedSummary,addedTag,position) =>
      val message=s"m$position"; val bytes=texts(position).getBytes(UTF_8).length
      val info=PassageInfo(UUID.randomUUID(),b+1,addedSummary,List(addedTag),PassagePoint(message,position,0),PassagePoint(message,position,bytes),bytes.toLong,1L,1L)
      passageRow(info,addedSummary,1L)
      Sql.exec(c,"INSERT INTO ch_problem_spans(generation,passage_id,ordinal,message_id,message_position,start_byte,end_byte) VALUES(?,?,0,?,?,0,?)",generation,info.id,message,position,bytes)
      piece(pieces,Chunk(UUID.randomUUID(),session,texts(position),addedSummary,List(addedTag),List(Span(message,0,bytes)),0.0),"[1,0,0]",b+1)
    }
    Sql.exec(c,"INSERT INTO ch_search_chunks(id,generation,session_id,revision,profile,document,embedding,ordinal) SELECT ch.id,ch.generation,g.session_id,g.revision,g.profile,ch.document,ch.embedding,ch.ordinal FROM ch_chunks ch JOIN ch_generations g ON g.id=ch.generation WHERE g.id=?",generation)
    Sql.exec(c,"INSERT INTO ch_generation_lineage(generation,parent,pieces) VALUES(?,?,?)",generation,parent,(pieces+added.size).toLong)
    val from=twins.map(_._1).min
    val cuts=List((Kind.Piece,0,from.toLong),(Kind.Passage,0,b.toLong),(Kind.Span,b,spanCount-1))
    def own(kind: Kind,major: Int,lo: Long): Unit =
      Sql.exec(c,s"INSERT INTO ch_lineage_segments(lineage,origin,kind,since,until,lo_major,lo,hi_major,hi,staged_by) VALUES(?,?,?,${if(staged.isEmpty) next else "NULL"},NULL,?,?,?,?,?)",
        lineage,generation,kind.sql,major,lo,GenerationRows.openMajor,GenerationRows.openEnd,generation)
    staged match {
      case Some(job) =>
        cuts.foreach(own.tupled)
        Sql.exec(c,"INSERT INTO ch_staged_generations(generation,job_id,run_id,phase,resume) VALUES(?,?,?,'Pieces','{\"step\":0}'::jsonb)",generation,job,UUID.randomUUID())
      case None =>
        val valid="lineage=? AND kind=? AND since<=? AND (until IS NULL OR until>?)"
        Sql.exec(c,s"INSERT INTO ch_search_retirements(session_id,origin,piece_lo,piece_hi) SELECT ?,origin,greatest(lo,?)::int,least(hi,?)::int FROM ch_lineage_segments WHERE $valid AND least(hi,?)>greatest(lo,?)",
          session,from,pieces,lineage,Kind.Piece.sql,version,version,pieces,from)
        cuts.foreach { (kind,major,lo) =>
          Sql.exec(c,s"INSERT INTO ch_lineage_segments(lineage,origin,kind,since,until,lo_major,lo,hi_major,hi,staged_by) SELECT lineage,origin,kind,?,NULL,lo_major,lo,?,?,staged_by FROM ch_lineage_segments WHERE $valid AND (lo_major,lo)<(?,?) AND (hi_major,hi)>(?,?)",
            next,major,lo,lineage,kind.sql,version,version,major,lo,major,lo)
          Sql.exec(c,s"UPDATE ch_lineage_segments SET until=? WHERE $valid AND (hi_major,hi)>(?,?)",next,lineage,kind.sql,version,version,major,lo)
          own(kind,major,lo)
        }
        Sql.exec(c,"UPDATE ch_sources SET published=? WHERE id=?",generation,session)
        Sql.exec(c,"DELETE FROM ch_lineage_tags WHERE lineage=?",lineage)
        Sql.exec(c,s"""INSERT INTO ch_lineage_tags(lineage,tag,pieces) SELECT ?,tag,count(*) FROM (${GenerationRows.members(Kind.Piece,s"'$generation'::uuid")}) m
          JOIN ch_chunks ch ON ch.generation=m.origin AND ch.ordinal>=m.lo AND ch.ordinal<m.hi CROSS JOIN LATERAL jsonb_array_elements_text(ch.value->'tags') tag GROUP BY tag""",lineage)
    }
    generation
  }
  private val emptyFilter=SearchFilter(None,None,None,None,Nil)
  private val vector=List(1.0,0.0,0.0)
  private def encode(result: Result): String = Wire.encode(Result.codecJson,result).noSpaces
  /** What the owner reads of each view: the session (`session`: its head and published revision move on), chunk pages
    * (three per page: pages cross segment ranges), passage pages and every passage's span pages. */
  private def content(f: Fixture,owner: String,views: List[(UUID,Option[ContentView])],session: Boolean=true): List[String] = views.flatMap { (id,view) =>
    val total=f.archive.pageChunks(owner,id,0,1,view).total
    val passages=f.archive.passages(owner,id,0,100,view)
    Option.when(session)(encode(Result.Session(f.archive.readSession(owner,id,view)))).toList++(0 until math.max(total,1) by 3).map(offset => encode(Result.Chunks(f.archive.pageChunks(owner,id,offset,3,view))))++
      (0 until math.max(passages.total.toInt,1) by 2).map(offset => encode(Result.Passages(f.archive.passages(owner,id,offset,2,view))))++
      passages.passages.flatMap(passage => (0 until passage.spanCount.toInt).map(offset => encode(Result.PassageSpans(f.archive.passageSpans(owner,id,passage.id,offset,1,view)))))
  }
  /** What the owner finds: searches in each mode and with generated-tag filters, facets, the tag catalog, Archive searches
    * with their witnesses. */
  private def found(f: Fixture,owner: String): List[String] = {
    val searches=for {
      text <- List("goal","alpha","omega","revised","interim","final","epsilon","secret","grape")
      mode <- List(SearchMode.Lexical,SearchMode.Semantic,SearchMode.Hybrid)
    } yield encode(Result.Search(f.search.search(owner,SearchQuery(text,mode,emptyFilter,10,0),Option.when(mode!=SearchMode.Lexical)(vector))))
    val filtered=List("t-final","t-omega","t-interim").map(tag => encode(Result.Search(f.search.search(owner,SearchQuery("goal",SearchMode.Lexical,emptyFilter.copy(tags=List(tag)),10,0),None))))
    val archive=List("mode:lexical grape","mode:semantic goal","goal","tag:t-final").map { expression =>
      val parsed=ArchiveExpression.parse(expression)
      val vectors=if(parsed.mode==SearchMode.Lexical) Nil else parsed.textOperands.map(ArchiveVector(_,vector))
      encode(Result.ArchiveSearch(f.index.sourceSearch(owner,ArchiveQuery(expression,ArchiveSort.LastTimestamp,SortDirection.Desc,None,10,true),parsed,vectors,ReadMaterialization.unrestricted)))
    }
    searches++filtered++archive++List(encode(Result.Facets(f.search.facets(owner,emptyFilter))),encode(Result.Facets(FacetsResult(Nil,Nil,f.search.tags(owner,TagSearchQuery("t-",emptyFilter,None,100))))))
  }
  private def hits(f: Fixture,text: String,mode: SearchMode,tags: List[String]=Nil): List[(UUID,ContentView,String)] =
    f.search.search("a",SearchQuery(text,mode,emptyFilter.copy(tags=tags),10,0),Option.when(mode!=SearchMode.Lexical)(vector)).hits.map(hit => (hit.session.id,hit.session.view,hit.chunks.head.summary))
  private def summaries(f: Fixture,session: UUID,view: Option[ContentView]): List[String] = f.archive.pageChunks("a",session,0,100,view).chunks.map(_.summary)
  private def published(f: Fixture,session: UUID): UUID = f.archive.session("a",session).view.generationId.get
  /** A generation as an earlier release left it: no lineage, no ordinals on its search rows. */
  private def classic(f: Fixture,session: UUID): Unit = f.db.transaction { c =>
    val generation=Sql.one(c,"SELECT published FROM ch_sources WHERE id=?",session)(uuid(_,1)).get
    Sql.exec(c,"DELETE FROM ch_lineage_segments WHERE lineage=?",generation)
    Sql.exec(c,"DELETE FROM ch_lineage_tags WHERE lineage=?",generation)
    Sql.exec(c,"DELETE FROM ch_generation_lineage WHERE generation=?",generation)
    Sql.exec(c,"UPDATE ch_generations SET lineage=NULL,lineage_version=NULL WHERE id=?",generation)
    Sql.exec(c,"UPDATE ch_search_chunks SET ordinal=NULL WHERE generation=?",generation)
  }

  test("a lineage generation's readers answer as its flat copy: superseded and staged rows are invisible, earlier versions read as before, retirement deletes exactly the superseded ranges; roots' lineage rows; down-028 keeps a previous release from starting until it ran, restartable per source") { database { f =>
    val s1=root(f,"a")
    val r1=published(f,s1)
    // A root: the first version of its own lineage, four open segment rows, the tags of its pieces counted, ordinals on
    // its search rows.
    f.db.transaction { c =>
      assertEquals(Sql.one(c,"SELECT concat_ws('|',lineage=id,lineage_version,passage_format,(SELECT pieces FROM ch_generation_lineage WHERE generation=g.id)) FROM ch_generations g WHERE id=?",r1)(_.getString(1)),Some("t|0|ContextAwareProblems|6"))
      assertEquals(Sql.rows(c,"SELECT concat_ws('|',kind,since,until,lo,hi=9223372036854775807) FROM ch_lineage_segments WHERE lineage=? AND origin=? ORDER BY kind",r1,r1)(_.getString(1)),
        List("context|0|0|t","passage|0|0|t","piece|0|0|t","span|0|0|t"))
      assertEquals(Sql.rows(c,"SELECT tag||':'||pieces FROM ch_lineage_tags WHERE lineage=? ORDER BY tag",r1)(_.getString(1)),List("t-alpha:2","t-beta:2","t-omega:2"))
      assertEquals(Sql.one(c,"SELECT count(*) FILTER(WHERE sc.ordinal=ch.ordinal) FROM ch_search_chunks sc JOIN ch_chunks ch ON ch.id=sc.id WHERE ch.generation=?",r1)(_.getInt(1)),Some(6))
    }
    // The next root's switch retires the previous root's lineage: its tag rows go with its search rows.
    val s2=root(f,"a")
    val replaced=published(f,s2)
    val second=f.archive.ingest("a",request(7,Some(f.archive.headSnapshot("a",s2).source),1))
    val claim=f.archive.claim(Set(f.config.profile),ClaimScope.Owner("a"),300).get
    assertEquals(claim.sessionId,second.sessionId)
    assert(f.archive.publishProblems(claim,ProblemPublicationFixtures.build(claim,decide)))
    val r2=published(f,s2)
    f.db.transaction { c =>
      assertEquals(Sql.one(c,"SELECT concat_ws('|',(SELECT count(*) FROM ch_lineage_tags WHERE lineage=?),(SELECT count(*) FROM ch_lineage_tags WHERE lineage=?),(SELECT count(*) FROM ch_lineage_retirements),(SELECT count(*) FROM ch_search_chunks WHERE generation=?))",
        replaced,r2,replaced)(_.getString(1)),Some("0|3|0|0"))
    }
    val s3=root(f,"a")
    classic(f,s3)
    // s1 grows by two versions (published; the first one is then an earlier version, a pin) and a staged third; s2 by one.
    val rootPin=List(s1 -> Some(f.archive.session("a",s1).view))
    val rootContent=content(f,"a",rootPin,false)
    val g1=grow(f,s1,revise(f,"a",s1,8),"revised goal","t-revised",Some(("interim goal","t-interim",7)))
    val g1Pin=List(s1 -> Some(f.archive.session("a",s1).view))
    val g1Content=content(f,"a",g1Pin,false)
    val g2=grow(f,s1,revise(f,"a",s1,9),"final goal","t-final",Some(("epsilon goal","t-epsilon",8)))
    val job=f.db.transaction(c => Sql.one(c,"SELECT id FROM ch_jobs WHERE session_id=? ORDER BY revision DESC LIMIT 1",s1)(uuid(_,1))).get
    val g3=grow(f,s1,f.archive.session("a",s1).revision,"secret goal","t-secret",None,Some(job))
    val h1=grow(f,s2,revise(f,"a",s2,8),"revised goal","t-revised",Some(("interim goal","t-interim",7)))
    // s1 at version 2: alpha and beta of the root, its B as version 1 rewrote it (revised), version 1's new passage as
    // version 2 rewrote it (final), version 2's new one (epsilon); never the root's omega, version 1's interim nor the
    // staged secret, in content, search or generated tags.
    assertEquals(summaries(f,s1,None),List("alpha goal","alpha goal","beta goal","beta goal","revised goal","revised goal","final goal","epsilon goal"))
    assertEquals(f.archive.passages("a",s1,0,100,None).passages.map(_.summary),List("alpha goal","beta goal","revised goal","final goal","epsilon goal"))
    for(text <- List("omega","interim","secret")) {
      assertEquals(hits(f,text,SearchMode.Lexical).filter(_._1==s1),Nil,text)
      // Hybrid: every chunk is a semantic candidate here (one vector); none carries the token.
      assertEquals(hits(f,text,SearchMode.Hybrid).filter(hit => hit._1==s1 && hit._3.startsWith(text)),Nil,text)
    }
    assertEquals(hits(f,"final",SearchMode.Lexical),List((s1,ContentView(3,Some(g2)),"final goal")))
    assertEquals(hits(f,"apple",SearchMode.Lexical).filter(_._1==s1),List((s1,ContentView(3,Some(g2)),"alpha goal")))
    assertEquals(List("t-final","t-omega","t-interim","t-secret").map(tag => hits(f,"goal",SearchMode.Lexical,List(tag)).map(_._1).toSet),List(Set(s1),Set(s3),Set(s2),Set.empty[UUID]))
    assertEquals(intercept[DomainError](f.archive.pageChunks("a",s1,0,10,Some(ContentView(3,Some(g3))))).code,"not-found")
    // Earlier versions read as they did while they were published.
    assertEquals(content(f,"a",rootPin,false),rootContent)
    assertEquals(content(f,"a",g1Pin,false),g1Content)
    // Retirement deletes the search rows of the superseded ranges and nothing else.
    def searchRows: List[String] = f.db.transaction(c => Sql.rows(c,"SELECT ch.generation||':'||ch.ordinal FROM ch_search_chunks sc JOIN ch_chunks ch ON ch.id=sc.id WHERE sc.session_id=? ORDER BY 1",s1)(_.getString(1)))
    val before=searchRows
    f.db.transaction(PassageStorage.retiringRanges(_,None)).foreach(PassageStorage.retireRange(f.db,_,_))
    assertEquals(before.diff(searchRows).sorted,List(s"$r1:4",s"$r1:5",s"$g1:6").sorted)
    assertEquals(f.db.transaction(c => Sql.one(c,"SELECT count(*) FROM ch_search_retirements")(_.getInt(1))),Some(0))
    val views=List(s1,s2,s3).map(_ -> Option.empty[ContentView])
    val lineageContent=content(f,"a",views)
    val lineageFound=found(f,"a")
    val chunks=List(s1,s2).map(source => source -> f.archive.pageChunks("a",source,0,100,None).chunks).toMap
    // The previous release's start re-creates 011's check without the lineage label: it fails while lineage
    // generations exist, and succeeds once down-028 flattened them.
    def previousRelease(): Unit = f.db.transaction { c =>
      Sql.exec(c,"ALTER TABLE ch_generations DROP CONSTRAINT IF EXISTS ch_generations_passage_format_check")
      Sql.exec(c,"ALTER TABLE ch_generations ADD CONSTRAINT ch_generations_passage_format_check CHECK(passage_format IN ('LegacyAnnotations','ContiguousProblems','ContextAwareProblems'))")
    }
    assertEquals(intercept[ponygirls.runtime.JdbcFailure](previousRelease()).sqlState,Some("23514"))
    val name=f.config.jdbcUrl.drop(f.config.jdbcUrl.lastIndexOf('/')+1)
    def down(variables: (String,String)*): (Int,List[String]) = {
      val psql=java.nio.file.Path.of(sys.env.getOrElse("POSTGRES_HOME",throw DomainError("test","POSTGRES_HOME required (nix develop .#chronicle)")),"bin","psql").toString
      val address=f.config.jdbcUrl.stripPrefix("jdbc:postgresql://").takeWhile(_!='/')
      val connection=Map("PGHOST"->address.takeWhile(_!=':'),"PGPORT"->address.dropWhile(_!=':').drop(1),"PGUSER"->f.config.databaseUser,"PGPASSWORD"->Fixtures.databasePassword,"PGDATABASE"->name)
      val ran=CheckChild.run(List(psql,"-X","-q","-v","ON_ERROR_STOP=1")++variables.flatMap((key,value) => List("-v",s"$key=$value"))++List("-f",java.nio.file.Path.of("scripts","down-028-generation-lineage.sql").toString),sys.env,connection,CheckChild.limit)
      (ran.exit,ran.out.linesIterator.toList)
    }
    def plan(): Map[String,String] = {
      val (exit,lines)=down()
      assertEquals((exit,lines.lastOption),(0,Some("DOWN028.result|preflight-complete")),lines.mkString("\n"))
      lines.map(_.split('|')).collect { case Array(key,value) => key.stripPrefix("DOWN028.")->value }.toMap
    }
    def apply(token: String): (Int,List[String]) = down("mode"->"apply","apply_irreversible"->"yes","confirm_database"->name,"expect_plan"->token)
    try {
      val first=plan()
      assertEquals(List("sources","lineage.published","lineage.staged","lineage.unpublished","retired.generations","relabeled.chunks","relabeled.passages").map(first),List("2","2","1","1","3","10","5"))
      assertEquals(apply("stale")._1,3)
      // Stopped in its second source (sources go in id order): the first one's flattening is committed, the second's not.
      val (flattened,stopped)=if(s1.toString<s2.toString) (s1,s2) else (s2,s1)
      f.db.transaction { c =>
        Sql.exec(c,s"CREATE FUNCTION ch_test_stop() RETURNS trigger LANGUAGE plpgsql AS $$$$ BEGIN IF NEW.session_id='$stopped' THEN RAISE EXCEPTION 'stopped'; END IF; RETURN NEW; END $$$$")
        Sql.exec(c,"CREATE TRIGGER ch_test_stop BEFORE UPDATE ON ch_generations FOR EACH ROW EXECUTE FUNCTION ch_test_stop()")
      }
      try assertEquals(apply(first("plan"))._1,3) finally f.db.transaction(c => Sql.exec(c,"DROP FUNCTION ch_test_stop() CASCADE"))
      f.db.transaction { c =>
        def lineageGenerations(source: UUID): Int = Sql.one(c,"SELECT count(*) FROM ch_generations WHERE session_id=? AND passage_format=?",source,GenerationRows.lineageFormat)(_.getInt(1)).get
        assertEquals((lineageGenerations(flattened),lineageGenerations(stopped)>0),(0,true))
      }
      val resumed=plan()
      assertEquals(List("sources","resumed").map(resumed),List("1","t"))
      val (exit,applied)=apply(resumed("plan"))
      assertEquals((exit,applied.lastOption),(0,Some("DOWN028.result|applied")),applied.mkString("\n"))
      assertEquals(down()._2.lastOption,Some("DOWN028.result|absent"))
      previousRelease()
      // The previous release's reads (generation=?, s.published=ch.generation): each published generation's own rows are
      // its whole content; every other generation of its lineage is retired, without rows; the staged one is gone.
      f.db.transaction { c =>
        List(s1,s2).foreach { source =>
          val generation=Sql.one(c,"SELECT published FROM ch_sources WHERE id=?",source)(uuid(_,1)).get
          assertEquals(Sql.rows(c,"SELECT value FROM ch_chunks WHERE generation=? ORDER BY ordinal",generation)(r => Wire.decode(Chunk.codecJson,Sql.json(r,"value"))),chunks(source))
          assertEquals(Sql.one(c,"SELECT count(*) FROM ch_sources s JOIN ch_generations g ON g.id=s.published JOIN ch_search_chunks ch ON ch.generation=s.published AND ch.revision=g.revision WHERE s.id=?",source)(_.getInt(1)),Some(chunks(source).size))
          assertEquals(Sql.one(c,"SELECT count(*) FROM ch_problem_passages p WHERE generation=? AND span_count=(SELECT count(*) FROM ch_problem_spans s WHERE s.generation=p.generation AND s.passage_id=p.id)",generation)(_.getLong(1)),
            Sql.one(c,"SELECT passage_count FROM ch_generations WHERE id=?",generation)(_.getLong(1)))
        }
        assertEquals(Sql.rows(c,"SELECT id FROM ch_generations WHERE retired")(uuid(_,1)).toSet,Set(r1,g1,r2))
        assertEquals(Sql.one(c,"SELECT count(*) FROM ch_chunks WHERE generation IN(SELECT id FROM ch_generations WHERE retired)")(_.getInt(1)),Some(0))
        assertEquals(Sql.one(c,"SELECT count(*) FROM ch_generations WHERE id=?",g3)(_.getInt(1)),Some(0))
        // 028's objects are gone, the foreign keys and the vector index are back.
        assertEquals(Sql.one(c,"""SELECT concat_ws('|',to_regclass('ch_lineage_segments') IS NULL,to_regclass('ch_down028_vector_indexes') IS NULL,
          (SELECT count(*) FROM information_schema.columns WHERE table_name IN('ch_generations','ch_search_chunks') AND column_name IN('lineage','lineage_version','ordinal')),
          (SELECT count(*) FROM pg_constraint WHERE contype='f' AND conrelid IN('ch_problem_spans'::regclass,'ch_problem_pieces'::regclass)),
          to_regclass(?) IS NOT NULL)""",s"ch_search_hnsw_d${f.config.embedding.dimensions}")(_.getString(1)),Some("t|t|0|3|t"))
      }
    } finally f.db.initialize()
    assertEquals(intercept[DomainError](f.archive.pageChunks("a",s1,0,10,Some(ContentView(2,Some(g1))))).code,"indexed-view-retired")
    // The flat copy: down-028's flattening read by this release, with the ordinals of its search rows restored (down-028
    // drops the column with 028).
    f.db.transaction(c => Sql.exec(c,"UPDATE ch_search_chunks sc SET ordinal=ch.ordinal FROM ch_chunks ch WHERE ch.id=sc.id AND sc.session_id<>?",s3))
    assertEquals(content(f,"a",views),lineageContent)
    assertEquals(found(f,"a"),lineageFound)
  }}

  test("the semantic legs' per-tuple membership probe is correlated on lineage and origin with a freshly analyzed near-empty segment table, and an index probe on both once it holds 10,000 rows, analyzed or not") { database { f =>
    val s1=root(f,"a")
    grow(f,s1,revise(f,"a",s1,8),"revised goal","t-revised",Some(("interim goal","t-interim",7)))
    /** The scans of ch_lineage_segments in the plans of a hybrid search and a semantic Archive search: node type and
      * condition (the index condition, else the filter). */
    def probes(): List[(String,String)] = {
      val q=SearchQuery("goal",SearchMode.Hybrid,emptyFilter,10,0)
      val search=f.search.pageStatement(f.search.statement("a",q,Some(vector)),q)
      val parsed=ArchiveExpression.parse("mode:semantic goal")
      val archive=f.index.statement("a",ArchiveQuery("mode:semantic goal",ArchiveSort.LastTimestamp,SortDirection.Desc,None,10,true),parsed,parsed.textOperands.map(ArchiveVector(_,vector)),None)
      List(search.sql -> search.args,archive.text -> archive.args).flatMap { (sql,args) =>
        val plan=f.db.transaction(c => Sql.one(c,"EXPLAIN (FORMAT JSON) "+sql,args*)(_.getString(1))).get
        def nodes(node: io.circe.Json): List[io.circe.Json] = node :: node.hcursor.downField("Plans").values.toList.flatten.flatMap(nodes)
        val scans=nodes(Wire.parse(plan).asArray.get.head.hcursor.downField("Plan").focus.get).filter(_.hcursor.get[String]("Relation Name").toOption.contains("ch_lineage_segments"))
        assert(scans.nonEmpty,plan)
        scans.map { node =>
          val c=node.hcursor
          (c.get[String]("Node Type").getOrElse(""),c.get[String]("Index Cond").orElse(c.get[String]("Filter")).getOrElse(""))
        }
      }
    }
    /** Per tuple: the published generation's lineage and the row's origin (E7's hashed form probes by origin alone). */
    def correlated(scans: List[(String,String)],index: Boolean): Unit = scans.foreach { (node,condition) =>
      assert(raw".*\(lineage = p(_[0-9]+)?\.lineage\).*".r.matches(condition) && raw".*\(origin = ch(_[0-9]+)?\.generation\).*".r.matches(condition) && (!index || node.startsWith("Index")),scans.mkString("\n"))
    }
    // E7's statistics: many generations analyzed, a near-empty segment table freshly analyzed.
    f.db.transaction { c =>
      Sql.exec(c,"INSERT INTO ch_generations(id,session_id,revision,profile,passage_format,passage_count,retired) SELECT gen_random_uuid(),?,1,?,'ContextAwareProblems',0,true FROM generate_series(1,6000)",s1,f.config.profile)
      Sql.exec(c,"ANALYZE ch_generations")
      Sql.exec(c,"ANALYZE ch_lineage_segments")
    }
    correlated(probes(),false)
    f.db.transaction { c =>
      Sql.exec(c,"INSERT INTO ch_lineage_segments(lineage,origin,kind,since,until,lo_major,lo,hi_major,hi) SELECT g.id,g.id,'piece',v,v+1,0,v*10,0,v*10+10 FROM (SELECT id FROM ch_generations WHERE session_id=? AND retired ORDER BY id LIMIT 100) g CROSS JOIN generate_series(0,99) v",s1)
    }
    correlated(probes(),true)
    f.db.transaction(c => Sql.exec(c,"ANALYZE ch_lineage_segments"))
    assertEquals(f.db.transaction(c => Sql.one(c,"SELECT reltuples>=10000 FROM pg_class WHERE oid='ch_lineage_segments'::regclass")(_.getBoolean(1))),Some(true))
    correlated(probes(),true)
  }}

  test("exact score ties are ordered by session and ordinal, not by chunk id: two id assignments rank alike in every mode") { database { f =>
    val sessions=List.fill(2)(f.archive.ingest("a",request(2)).sessionId).sortBy(_.toString)
    val text="tie token"
    /** Publishes two chunks of equal text and vector per session with the ids `ids(session)(ordinal)`; the hits of each
      * mode as (session, ordinal of the chunk, score). */
    def ranked(ids: Map[UUID,List[Long]]): List[List[(UUID,Int,Double)]] = {
      val ordinals=ids.toList.flatMap((session,values) => values.zipWithIndex.map((id,ordinal) => new UUID(0L,id) -> ordinal)).toMap
      sessions.foreach { _ =>
        val claim=f.archive.claim(Set(f.config.profile),ClaimScope.Owner("a"),300).get
        TestPublications.stored(f.db,claim,ids(claim.sessionId).map(id => IndexedChunk(Chunk(new UUID(0L,id),claim.sessionId,text,"tie goal",List("t-tie"),List(Span("m0",0,1)),0.0),vector)))
        f.db.transaction(c => Sql.exec(c,"UPDATE ch_search_chunks sc SET ordinal=ch.ordinal FROM ch_chunks ch WHERE ch.id=sc.id AND sc.session_id=?",claim.sessionId))
      }
      List(SearchMode.Lexical,SearchMode.Semantic,SearchMode.Hybrid).map { mode =>
        f.search.search("a",SearchQuery("tie",mode,emptyFilter,10,0),Option.when(mode!=SearchMode.Lexical)(vector)).hits.map(hit => (hit.session.id,ordinals(hit.chunks.head.id),hit.score))
      }
    }
    // Ids in the reverse order of (session, ordinal), then in that order.
    val reversed=ranked(Map(sessions(0) -> List(4L,3L),sessions(1) -> List(2L,1L)))
    sessions.foreach(session => f.archive.ingest("a",request(2,Some(f.archive.headSnapshot("a",session).source),1)))
    val ordered=ranked(Map(sessions(0) -> List(11L,12L),sessions(1) -> List(13L,14L)))
    assertEquals(reversed,ordered)
    assertEquals(ordered.map(_.map(hit => (hit._1,hit._2))),List.fill(3)(sessions.map(_ -> 0)))
  }}
}
