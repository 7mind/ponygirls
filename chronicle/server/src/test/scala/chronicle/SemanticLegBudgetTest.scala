package chronicle

import chronicle.api.*
import java.util.UUID
import ponygirls.retrieval.CandidatePolicy
import scala.concurrent.duration.*

/** Semantic legs whose scan budget is spent on index entries the reader may not see (spec D22). The fixture puts 400
  * chunks of another owner nearest the query; a first pass injected to stop after the index's first `ef_search`
  * candidates (`firstScanTuples` 1) meets only those, as production's 200,000-tuple / 16 MiB pass meets ≥ 200,000
  * staged, in-flight or unvacuumed rows, or the rows a narrow filter rejects. Reader `a` sees 13 sessions (230 chunks):
  * ten of project `main` near the query and three of project `rare` far from it. */
class SemanticLegBudgetTest extends munit.FunSuite {
  override val munitTimeout=2.minutes
  private val query=List(1.0,0.0,0.0)
  private val exactLimit=50
  private val budget=SemanticLegBudget(1,exactLimit,10000,64,5000)
  private final case class Shared(config: Config,db: Database,archive: PostgresArchive,main: List[UUID],rare: List[UUID]) {
    def search(budget: SemanticLegBudget) = new PostgresSearch(db,archive,config,budget)
    def archiveIndex(budget: SemanticLegBudget) = new PostgresArchiveIndex(db,archive,config,budget)
  }
  /** A unit vector at angle `theta` from the query, turned by `turn` around it. */
  private def vector(theta: Double,turn: Double): List[Double] = List(math.cos(theta),math.sin(theta)*math.cos(turn),math.sin(theta)*math.sin(turn))
  private lazy val shared: Shared = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh") }
    val config=Fixtures.config(); val db=new Database(config,IndexProfileCatalog.current(config)); db.initialize()
    db.transaction { c =>
      Sql.exec(c,"TRUNCATE ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks,ch_groups,ch_invites,ch_members CASCADE")
      Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=0",config.profile)
    }
    val archive=new PostgresArchive(db,config)
    var ordinal=0
    def publish(owner: String,project: String,vectors: List[List[Double]]): UUID = {
      val base=Fixtures.snapshot()
      val messages=vectors.indices.toList.map(i => Message(s"m$i",None,"user",s"needle $project chunk $ordinal-$i",None,i))
      val raw=messages.map(value => Wire.encode(Message.codecJson,value).noSpaces).mkString("","\n","\n")
      val request=base.copy(source=base.source.copy(producerSessionId=s"session-$ordinal"),metadata=base.metadata.copy(project=Some(project),tags=Nil),
        messages=messages,files=List(RawFile("source.jsonl",Wire.hash(raw),raw)),digest=Wire.hash(raw))
      ordinal+=1
      val receipt=archive.ingest(owner,request)
      val claim=archive.claim(Set(config.profile),ClaimScope.Owner(owner),300).get
      val chunks=messages.zip(vectors).map((message,v) => IndexedChunk(Fragments.split(List(message)).head.copy(sessionId=receipt.sessionId),v))
      assert(archive.publish(claim,chunks))
      receipt.sessionId
    }
    (0 until 2).foreach(s => publish("c","hidden",(0 until 200).toList.map(i => vector(0.002+0.0002*(s*200+i),i*2.399))))
    val main=(0 until 10).toList.map(s => publish("a","main",(0 until 20).toList.map(i => vector(0.3+0.001*(s*20+i),i*2.399))))
    val rare=(0 until 3).toList.map(s => publish("a","rare",(0 until 10).toList.map(i => vector(1.0+0.01*(s*10+i),i*2.399))))
    db.transaction(c => Sql.exec(c,"ANALYZE"))
    Shared(config,db,archive,main,rare)
  }
  private def semantic(mode: SearchMode,project: Option[String]) = SearchQuery("needle",mode,SearchFilter(project,None,None,None,Nil),20,0)
  private def archiveQuery(expression: String,limit: Int) = ArchiveQuery(expression,ArchiveSort.LastTimestamp,SortDirection.Desc,None,limit,true)
  private def archiveSearch(index: PostgresArchiveIndex,expression: String): ArchiveSearchResult = {
    val q=archiveQuery(expression,ArchiveSearchPolicy.maximumPageSize); val parsed=ArchiveExpression.parse(q.expression)
    index.sourceSearch("a",q,parsed,parsed.textOperands.map(ArchiveVector(_,query)),ReadMaterialization.unrestricted)
  }
  private def archiveBrowse(index: PostgresArchiveIndex,expression: String): ArchiveResult = {
    val q=archiveQuery(expression,100); val parsed=ArchiveExpression.parse(q.expression)
    index.browse("a",q,parsed,parsed.textOperands.map(ArchiveVector(_,query)))
  }
  private def unavailable(body: => Any): Unit = {
    val error=intercept[DomainError](body)
    assertEquals((error.code,error.detail),("unavailable",SemanticLeg.incompleteDetail))
  }

  test("Blackbox-GoodCommunication: a semantic leg whose scan budget the reader's invisible rows spend is completed, through the index or exactly") {
    val s=shared; val search=s.search(budget); val oracle=s.search(SemanticLegBudget.production)
    // Every visible chunk (230) is more than the exact limit: the second pass scans the index under its larger budget.
    val expected=oracle.searchLegacy("a",semantic(SearchMode.Semantic,None),Some(query))
    assertEquals(expected.hits.map(_.session.id).toSet,(s.main++s.rare).toSet)
    val found=search.search("a",semantic(SearchMode.Semantic,None),Some(query))
    assertEquals((found.total,found.hits.map(_.session.id)),(13,expected.hits.map(_.session.id)))
    assertEquals(search.search("a",semantic(SearchMode.Hybrid,None),Some(query)).hits.map(_.session.id).toSet,(s.main++s.rare).toSet)
    // A narrow filter (30 chunks, within the exact limit) is ranked by an exact scan of its visible set.
    val filtered=search.search("a",semantic(SearchMode.Semantic,Some("rare")),Some(query))
    assertEquals((filtered.total,filtered.hits.map(_.session.id)),(3,oracle.searchLegacy("a",semantic(SearchMode.Semantic,Some("rare")),Some(query)).hits.map(_.session.id)))
    val archive=s.archiveIndex(budget)
    val page=archiveSearch(archive,"mode:semantic needle")
    assertEquals((page.page.total,page.page.rows.size),(13L,10))
    assertEquals(archiveBrowse(archive,"mode:semantic needle").rows.map(_.head.id).toSet,(s.main++s.rare).toSet)
    assertEquals(archiveSearch(archive,"project:rare mode:semantic needle").page.rows.map(_.head.id).toSet,s.rare.toSet)
    assertEquals(archiveBrowse(archive,"project:rare needle").rows.map(_.head.id).toSet,s.rare.toSet)
  }

  test("Blackbox-GoodCommunication: a leg the second pass cannot complete fails unavailable, hybrid included, never a partial window") {
    val s=shared; val exhausted=budget.copy(secondScanTuples=budget.firstScanTuples)
    unavailable(s.search(exhausted).search("a",semantic(SearchMode.Semantic,None),Some(query)))
    unavailable(s.search(exhausted).search("a",semantic(SearchMode.Hybrid,None),Some(query)))
    unavailable(archiveSearch(s.archiveIndex(exhausted),"mode:semantic needle"))
    unavailable(archiveBrowse(s.archiveIndex(exhausted),"needle"))
    // The filtered leg is still exact: within the exact limit no index budget applies.
    assertEquals(s.search(exhausted).search("a",semantic(SearchMode.Semantic,Some("rare")),Some(query)).total,3)
  }

  test("Effectual-GoodCommunication: the second pass ends at its deadline in a savepoint, leaves the transaction usable and restores the settings") {
    val s=shared; val deadline=budget.copy(secondPassMillis=100)
    s.db.transaction { c =>
      SemanticLeg.configure(c,SemanticLegBudget.production)
      Sql.exec(c,"SET LOCAL statement_timeout = '7s'")
      def leg(passes: Map[Unit,LegPass]): Long = if(passes.isEmpty) 0L else Sql.one(c,"SELECT 1 FROM pg_sleep(1)")(_.getLong(1)).get
      unavailable(SemanticLeg.complete(c,deadline,List(()))(leg)(rows => Map(() -> rows))(_ => SemanticLeg.visibleCap(deadline).toLong))
      def completed(passes: Map[Unit,LegPass]): Long = if(passes.isEmpty) 0L else SearchPolicy.candidatesPerLeg.toLong
      assertEquals(SemanticLeg.complete(c,deadline,List(()))(completed)(rows => Map(() -> rows))(_ => SemanticLeg.visibleCap(deadline).toLong),SearchPolicy.candidatesPerLeg.toLong)
      assertEquals(Sql.one(c,"SELECT current_setting('statement_timeout'),current_setting('hnsw.max_scan_tuples')")(r => (r.getString(1),r.getString(2))),Some(("7s",CandidatePolicy.maxScanTuples.toString)))
    }
  }

  test("Effectual-GoodCommunication: production semantic leg budgets") {
    assertEquals(SemanticLegBudget.production,SemanticLegBudget(200000,20000,1000000,64,5000))
    assertEquals((SemanticLegBudget.production.firstScanTuples,SemanticLegBudget.production.exactScanChunks),(CandidatePolicy.maxScanTuples,CandidatePolicy.exactScanChunks))
  }
}
