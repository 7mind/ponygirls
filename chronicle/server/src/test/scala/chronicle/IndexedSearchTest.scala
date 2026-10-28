package chronicle
import chronicle.api.*
import java.sql.Connection
import java.util.UUID
import scala.util.Using
import scala.concurrent.duration.*

class IndexedSearchTest extends munit.FunSuite {
  override val munitTimeout=2.minutes
  private val corpusSize=12000
  private val testDimensions=32
  private val resultSize=20
  private val minimumRecall=0.95
  private val prepareExecutions=9
  private val highDimensionCorpusSize=2048
  private def vector(seed: Int,dimensions: Int): List[Double] = (1 to dimensions).map(d => math.sin(seed*d*0.031)+math.cos(seed*d*0.017)).toList
  private case class CorpusKey(dimensions: Int,size: Int)
  private case class SearchDatabase(config: Config,db: Database,archive: PostgresArchive,index: PostgresSearch)
  private case class SeededCorpus(key: CorpusKey,database: SearchDatabase,members: List[(UUID,String)])
  // Serial suites own the shared database; only memberships may change between same-key cases.
  private var seededCorpus=Option.empty[SeededCorpus]
  private def clear(db: Database): Unit = db.transaction(c => Sql.exec(c,"TRUNCATE ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks,ch_groups,ch_invites,ch_members,ch_tokens,ch_sessions,ch_mutations CASCADE"))
  private def clearCorpus(): Unit = {
    val previous=seededCorpus; seededCorpus=None
    previous.foreach(corpus => clear(corpus.database.db))
  }
  override def afterAll(): Unit = try clearCorpus() finally super.afterAll()
  private def openDatabase(dimensions: Int): SearchDatabase = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh") }
    val original=Fixtures.config(); val config=original.copy(embedding=original.embedding.copy(dimensions=dimensions))
    val db=new Database(config,IndexProfileCatalog.legacyOnly(config)); db.initialize()
    db.transaction { c =>
      Sql.exec(c,"TRUNCATE ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks,ch_groups,ch_invites,ch_members,ch_tokens,ch_sessions,ch_mutations CASCADE")
      Sql.exec(c,"UPDATE ch_profile SET active=?,target=?,maintenance=false",config.profile,config.profile); Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=0",config.profile)
    }
    val archive=new PostgresArchive(db,config)
    SearchDatabase(config,db,archive,new PostgresSearch(db,archive,config))
  }
  private def database(dimensions: Int)(f: (Config,Database,PostgresArchive,PostgresSearch) => Unit): Unit = {
    clearCorpus()
    val database=openDatabase(dimensions)
    try f(database.config,database.db,database.archive,database.index)
    finally clear(database.db)
  }
  private def members(db: Database): List[(UUID,String)] = db.transaction(c => Sql.rows(c,"SELECT group_id,user_id FROM ch_members ORDER BY group_id,user_id")(r => (r.getObject(1,classOf[UUID]),r.getString(2))))
  private def assertCorpus(corpus: SeededCorpus): Unit = corpus.database.db.transaction { c =>
    List("ch_sources","ch_revisions","ch_generations","ch_chunks","ch_search_chunks","ch_revision_info","ch_messages").foreach { table =>
      assertEquals(Sql.one(c,s"SELECT count(*) FROM $table")(_.getInt(1)),Some(corpus.key.size),table)
    }
    assertEquals(Sql.one(c,"SELECT count(*) FROM ch_search_chunks WHERE vector_dims(embedding)=?",corpus.key.dimensions)(_.getInt(1)),Some(corpus.key.size))
    assertEquals(Sql.one(c,"SELECT count(*) FROM ch_revision_info WHERE lexical_version=?",ArchiveProjection.lexicalVersion)(_.getInt(1)),Some(corpus.key.size))
    assertEquals(Sql.rows(c,"SELECT version FROM ch_schema_migrations WHERE version IN(2,6) ORDER BY version")(_.getInt(1)),List(2,6))
    assertEquals(Sql.one(c,"SELECT count(*) FROM ch_revision_info i JOIN ch_revisions r USING(session_id,revision) WHERE (i.metadata,i.source,i.completion,i.redacted,i.message_count) IS DISTINCT FROM (r.snapshot->'metadata',r.snapshot->'source',r.snapshot->>'completion',(r.snapshot->>'redacted')::boolean,jsonb_array_length(r.snapshot->'messages'))")(_.getInt(1)),Some(0))
    assertEquals(Sql.one(c,"SELECT count(*) FROM ch_messages m JOIN ch_revisions r USING(session_id,revision) WHERE m.value IS DISTINCT FROM r.snapshot->'messages'->m.position")(_.getInt(1)),Some(0))
    assertEquals(Sql.one(c,"SELECT count(*) FROM ch_search_chunks sc JOIN ch_chunks ch ON ch.id=sc.id JOIN ch_generations g ON g.id=ch.generation JOIN ch_sources s ON s.id=g.session_id WHERE (sc.generation,sc.session_id,sc.revision,sc.profile,sc.document,sc.embedding) IS DISTINCT FROM (s.published,s.id,g.revision,g.profile,ch.document,ch.embedding)")(_.getInt(1)),Some(0))
  }
  private def corpus(dimensions: Int,size: Int)(f: (Config,Database,PostgresArchive,PostgresSearch) => Unit): Unit = {
    val key=CorpusKey(dimensions,size)
    val current=seededCorpus.filter(_.key==key).getOrElse {
      clearCorpus()
      val database=openDatabase(dimensions)
      try {
        seed(database.config,database.db,size)
        val prepared=SeededCorpus(key,database,members(database.db))
        assertCorpus(prepared)
        database.db.initialize()
        assertCorpus(prepared)
        seededCorpus=Some(prepared)
        prepared
      } catch { case error: Throwable => clear(database.db); throw error }
    }
    assertCorpus(current)
    assertEquals(members(current.database.db),current.members)
    val database=current.database
    try f(database.config,database.db,database.archive,database.index)
    finally database.db.transaction { c =>
      Sql.exec(c,"DELETE FROM ch_members")
      current.members.foreach { case (group,user) => Sql.exec(c,"INSERT INTO ch_members VALUES(?,?)",group,user) }
    }
  }
  private def seed(config: Config,db: Database,size: Int): Unit = {
    val snapshot=Wire.encode(IngestRequest.codecJson,Fixtures.snapshot()).noSpaces
    val chunk=Wire.encode(Chunk.codecJson,Fragments.split(Fixtures.snapshot().messages).head).noSpaces
    db.transaction { c =>
      Sql.exec(c,s"CREATE TEMP TABLE fixture AS SELECT i,md5('source'||i)::uuid AS sid,md5('generation'||i)::uuid AS gid,md5('chunk'||i)::uuid AS cid,CASE WHEN i%100=0 THEN 'a' WHEN i%100=1 THEN 'b' ELSE 'c' END AS owner FROM generate_series(1,$size)i")
      Sql.exec(c,"INSERT INTO ch_sources(id,owner,source_key,revision,published) SELECT sid,owner,i::text,1,gid FROM fixture")
      Sql.exec(c,"INSERT INTO ch_revisions SELECT sid,1,jsonb_set(?::jsonb,'{metadata,project}',to_jsonb(CASE WHEN i%37=0 THEN 'needle' ELSE 'haystack' END)) FROM fixture",snapshot)
      Sql.exec(c,"INSERT INTO ch_generations SELECT gid,sid,1,? FROM fixture",config.profile)
      Sql.exec(c,s"INSERT INTO ch_chunks SELECT cid,gid,?::jsonb || jsonb_build_object('id',cid,'sessionId',sid),to_tsvector('english',CASE WHEN i%61=0 THEN 'targetterm synthetic' ELSE 'commonterm synthetic' END),(SELECT array_agg(sin(i*d*0.031)+cos(i*d*0.017))::vector FROM generate_series(1,${config.embedding.dimensions})d),0 FROM fixture",chunk)
      Sql.exec(c,"DELETE FROM ch_schema_migrations WHERE version=2")
      val ab=UUID.randomUUID(); val bc=UUID.randomUUID()
      Sql.exec(c,"INSERT INTO ch_groups VALUES(?,'a','AB'),(?,'b','BC')",ab,bc)
      Sql.exec(c,"INSERT INTO ch_members VALUES(?,'a'),(?,'b'),(?,'b'),(?,'c')",ab,ab,bc,bc)
    }
    db.initialize()
    db.transaction(c => Sql.exec(c,"ANALYZE"))
  }
  private val emptyFilter=SearchFilter(None,None,None,None,Nil)
  private def query(mode: SearchMode): SearchQuery = SearchQuery("targetterm",mode,emptyFilter,resultSize,0)
  private def explain(c: Connection,statement: SearchStatement): String = Sql.rows(c,"EXPLAIN (ANALYZE,BUFFERS) "+statement.sql,statement.args*)(_.getString(1)).mkString("\n")
  private def literal(value: Sql.Param): String = value match {
    case s: String => "'"+s.replace("'","''")+"'"
    case u: UUID => "'"+u.toString+"'"
    case other => other.toString
  }
  private def genericExplain(c: Connection,statement: SearchStatement): String = Using.resource(c.prepareStatement(statement.sql)) { prepared =>
    (1 to prepareExecutions).foreach { _ => Sql.bind(prepared,statement.args); Using.resource(prepared.executeQuery())(rows => while(rows.next()) ()) }
    Sql.exec(c,"SET LOCAL plan_cache_mode = force_generic_plan")
    Sql.bind(prepared,statement.args); Using.resource(prepared.executeQuery())(rows => while(rows.next()) ())
    val cached=Sql.one(c,"SELECT name,generic_plans FROM pg_prepared_statements WHERE statement LIKE ?",statement.sql.take(32)+"%")(r => (r.getString(1),r.getLong(2))).get
    assert(cached._2>0,"must exercise a generic server-prepared plan")
    Sql.rows(c,s"EXPLAIN (ANALYZE,BUFFERS) EXECUTE \"${cached._1}\"(${statement.args.map(literal).mkString(",")})")(_.getString(1)).mkString("\n")
  }
  test("Effectual-GoodCommunication regression: production SQL naturally uses HNSW and GIN, including generic JDBC plans; disabled-index control does not") { corpus(testDimensions,corpusSize) { (config,db,archive,index) =>
    val semantic=query(SearchMode.Semantic); val embedding=Some(vector(42,testDimensions))
    val page=index.pageStatement(index.statement("c",semantic,embedding),semantic)
    db.transaction { c =>
      SearchPolicy.configure(c)
      val natural=explain(c,page); println("PRODUCTION NATURAL HNSW\n"+natural)
      assert(natural.contains("ch_search_hnsw_d32"),natural)
      val count=index.statement("c",semantic,embedding)
      val countPlan=explain(c,SearchStatement(count.sql+" SELECT count(*) FROM sessions",count.args))
      println("PRODUCTION NATURAL ANN COUNT\n"+countPlan); assert(countPlan.contains("ch_search_hnsw_d32"),countPlan)
      val lexical=query(SearchMode.Lexical)
      val lexicalPage=index.pageStatement(index.statement("c",lexical,None),lexical)
      val gin=explain(c,lexicalPage); println("PRODUCTION NATURAL GIN\n"+gin)
      assert(gin.contains("ch_search_fts"),gin)
      val generic=genericExplain(c,page)
      println("PRODUCTION GENERIC HNSW\n"+generic); assert(generic.contains("ch_search_hnsw_d32"),generic)
      val genericGin=genericExplain(c,lexicalPage)
      println("PRODUCTION GENERIC GIN\n"+genericGin); assert(genericGin.contains("ch_search_fts"),genericGin)
      Sql.exec(c,"SET LOCAL enable_indexscan = off"); Sql.exec(c,"SET LOCAL enable_bitmapscan = off")
      val disabled=explain(c,page); println("PRODUCTION INDEX-DISABLED CONTROL\n"+disabled)
      assert(!disabled.contains("ch_search_hnsw_d32"),disabled)
      assert(disabled.contains("Seq Scan on ch_search_chunks"),disabled)
    }
  }}
  test("Blackbox-GoodCommunication: ANN recall against exact full-vector oracle survives selective ACL, filters and nontransitive groups") { corpus(testDimensions,corpusSize) { (config,db,archive,index) =>
    List(("a",100,emptyFilter),("b",101,emptyFilter),("c",42,emptyFilter),("a",3700,emptyFilter.copy(project=Some("needle"))),("c",74,emptyFilter.copy(project=Some("needle")))).foreach { case (reader,target,filter) =>
      val q=query(SearchMode.Semantic).copy(filter=filter)
      val embedding=Some(vector(target,testDimensions))
      val exact=index.searchLegacy(reader,q,embedding)
      val ann=index.search(reader,q,embedding)
      val truth=exact.hits.map(_.session.id).toSet
      val recall=ann.hits.count(h => truth.contains(h.session.id)).toDouble/truth.size
      println(s"RECALL reader=$reader project=${filter.project} exactTotal=${exact.total} candidateTotal=${ann.total} recall@$resultSize=$recall")
      assert(recall>=minimumRecall,s"recall=$recall reader=$reader")
      assertEquals(ann.countScope,SearchCountScope.CandidateWindow); assertEquals(ann.rankingLimit,Some(SearchPolicy.candidatesPerLeg))
      ann.hits.foreach { h =>
        assert(h.session.ownerId==reader || (reader=="a" && h.session.ownerId=="b") || reader=="b" || (reader=="c" && h.session.ownerId=="b"))
        val exactScore=db.transaction(c => Sql.one(c,"SELECT 1.0-(embedding <=> ?::vector) FROM ch_chunks WHERE id=?",embedding.get.mkString("[",",","]"),h.chunks.head.id)(_.getDouble(1)).get)
        assertEquals(h.score,exactScore)
      }
    }
    val lexical=index.search("a",query(SearchMode.Lexical),None)
    assertEquals(lexical.countScope,SearchCountScope.ExactMatches); assertEquals(lexical.rankingLimit,None)
    val hybrid=index.search("a",query(SearchMode.Hybrid),Some(vector(100,testDimensions)))
    assertEquals(hybrid.countScope,SearchCountScope.CandidateWindow); assertEquals(hybrid.rankingLimit,Some(SearchPolicy.rankingLimit(SearchMode.Hybrid)))
    val bounded=index.search("b",query(SearchMode.Semantic),Some(vector(101,testDimensions)))
    assert(bounded.total<=SearchPolicy.candidatesPerLeg); assert(bounded.total<corpusSize)
    assertEquals(intercept[DomainError](index.search("b",query(SearchMode.Semantic).copy(offset=SearchPolicy.candidatesPerLeg),Some(vector(101,testDimensions)))).code,"invalid")
    db.transaction(c => Sql.exec(c,"DELETE FROM ch_members WHERE user_id='b'"))
    val privateOnly=index.search("a",query(SearchMode.Semantic),Some(vector(100,testDimensions)))
    assertEquals(privateOnly.total,corpusSize/100); assert(privateOnly.hits.forall(_.session.ownerId=="a"))
  }}
  test("Effectual-GoodCommunication: projection replaces complete generations, backfills idempotently and purges without deleting pinned history early") { database(3) { (config,db,archive,index) =>
    val request=Fixtures.snapshot(); val out=archive.ingest("a",request)
    val first=archive.claim(Set(config.profile),ClaimScope.AllOwners,300).get
    def chunk()=IndexedChunk(Fragments.split(request.messages).head.copy(sessionId=out.sessionId),List(1.0,0.0,0.0))
    val whole=chunk(); val middle=whole.chunk.text.length/2
    val pieces=List(whole.copy(chunk=whole.chunk.copy(text=whole.chunk.text.take(middle),spans=List(Span("u",0,middle)))),whole.copy(chunk=whole.chunk.copy(id=UUID.randomUUID(),text=whole.chunk.text.drop(middle),spans=List(Span("u",middle,whole.chunk.text.length)))))
    assert(archive.publish(first,pieces))
    val old=archive.session("a",out.sessionId).view
    archive.ingest("a",request.copy(requestId=UUID.randomUUID(),expectedRevision=1))
    assert(archive.publish(archive.claim(Set(config.profile),ClaimScope.AllOwners,300).get,List(chunk())))
    db.initialize(); db.initialize()
    db.transaction { c =>
      assertEquals(Sql.one(c,"SELECT count(*) FROM ch_search_chunks")(_.getInt(1)),Some(1))
      assertEquals(Sql.one(c,"SELECT count(*) FROM ch_chunks")(_.getInt(1)),Some(3))
      assertEquals(Sql.one(c,"SELECT count(*) FROM ch_search_chunks ch JOIN ch_sources s ON s.id=ch.session_id WHERE ch.generation<>s.published")(_.getInt(1)),Some(0))
    }
    assertEquals(archive.pageChunks("a",out.sessionId,0,100,Some(old)).total,2)
    val auth=new Auth(db,config); val (_,cookie)=auth.login(LoginRequest("a","synthetic"))
    auth.mutate(auth.browser(cookie),ClientEnvelope(UUID.randomUUID(),Operation.Purge(out.sessionId)))
    db.transaction(c => assertEquals(Sql.one(c,"SELECT count(*) FROM ch_search_chunks")(_.getInt(1)),Some(0)))
  }}
  test("Effectual-GoodCommunication: 2048-dimensional embeddings use halfvec HNSW while preserving float vectors and exact cosine scores") { corpus(2048,highDimensionCorpusSize) { (config,db,archive,index) =>
    val highQuery=query(SearchMode.Semantic)
    db.transaction { c =>
      SearchPolicy.configure(c)
      val plan=explain(c,index.pageStatement(index.statement("b",highQuery,Some(vector(17,2048))),highQuery))
      println("PRODUCTION NATURAL 2048D HNSW\n"+plan); assert(plan.contains("ch_search_hnsw_d2048"),plan)
    }
    val exact=index.searchLegacy("b",highQuery,Some(vector(17,2048)))
    val approximate=index.search("b",highQuery,Some(vector(17,2048)))
    val truth=exact.hits.map(_.session.id).toSet
    val recall=approximate.hits.count(h => truth.contains(h.session.id)).toDouble/truth.size
    println(s"RECALL dimensions=2048 corpus=$highDimensionCorpusSize recall@$resultSize=$recall")
    assert(recall>=minimumRecall)
    val request=Fixtures.snapshot(); val out=archive.ingest("a",request)
    val values=vector(17,2048); val chunk=Fragments.split(request.messages).head.copy(sessionId=out.sessionId)
    assert(archive.publish(archive.claim(Set(config.profile),ClaimScope.AllOwners,300).get,List(IndexedChunk(chunk,values))))
    val result=index.search("a",query(SearchMode.Semantic),Some(values))
    assertEquals(result.hits.head.session.id,out.sessionId); assert(math.abs(result.hits.head.score-1.0)<0.000001)
    db.transaction { c =>
      assertEquals(Sql.one(c,"SELECT vector_dims(embedding),pg_typeof(embedding)::text FROM ch_search_chunks WHERE id=?",chunk.id)(r => (r.getInt(1),r.getString(2))),Some((2048,"vector")))
      val definition=Sql.one(c,"SELECT indexdef FROM pg_indexes WHERE indexname='ch_search_hnsw_d2048'")(_.getString(1)).get
      assert(definition.contains("halfvec(2048)"),definition)
    }
    assertEquals(intercept[DomainError](config.copy(embedding=config.embedding.copy(dimensions=4001)).validate()).code,"config")
  }}
}
