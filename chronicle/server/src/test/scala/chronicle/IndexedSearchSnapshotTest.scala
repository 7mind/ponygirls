package chronicle
import chronicle.api.*
import java.sql.{Connection,Driver,DriverManager,DriverPropertyInfo,PreparedStatement}
import java.lang.reflect.{InvocationHandler,InvocationTargetException,Method,Proxy}
import java.util.Properties
import java.util.concurrent.atomic.AtomicInteger
import java.util.logging.Logger
import scala.concurrent.duration.*

class IndexedSearchSnapshotTest extends munit.FunSuite {
  override val munitTimeout=2.minutes
  private val dimensions=32
  private val initialChunks=24000
  private val addedChunks=6000
  private val chunksPerSession=20
  private val pageLimit=100
  private val expectedTailSize=50
  private val proxyPrefix="jdbc:chronicle-snapshot:"
  private def embedding(seed: Int): List[Double]=(1 to dimensions).map(d => math.sin(seed*d*0.031)+math.cos(seed*d*0.017)).toList
  private final class MutatingDriver(afterFirstAnn: Connection => Unit) extends Driver {
    val annStatements=new AtomicInteger()
    private def invoke(target: AnyRef,method: Method,args: Array[AnyRef]): AnyRef =
      try method.invoke(target,args*) catch { case error: InvocationTargetException => throw error.getCause }
    def acceptsURL(url: String): Boolean=url.startsWith(proxyPrefix)
    def connect(url: String,properties: Properties): Connection = {
      if(!acceptsURL(url)) null else {
        val connection=DriverManager.getConnection(url.stripPrefix(proxyPrefix),properties)
        Proxy.newProxyInstance(getClass.getClassLoader,Array(classOf[Connection]),new InvocationHandler {
          def invoke(proxy: AnyRef,method: Method,args: Array[AnyRef]): AnyRef = {
            val result=MutatingDriver.this.invoke(connection,method,args)
            if(method.getName=="prepareStatement" && args(0).asInstanceOf[String].startsWith("WITH ann AS")) {
              val statement=result
              Proxy.newProxyInstance(getClass.getClassLoader,Array(classOf[PreparedStatement]),new InvocationHandler {
                def invoke(proxy: AnyRef,method: Method,args: Array[AnyRef]): AnyRef = {
                  val result=MutatingDriver.this.invoke(statement,method,args)
                  if(method.getName=="executeQuery" && annStatements.incrementAndGet()==1) afterFirstAnn(connection)
                  result
                }
              })
            } else result
          }
        }).asInstanceOf[Connection]
      }
    }
    def getPropertyInfo(url: String,properties: Properties): Array[DriverPropertyInfo]=Array.empty
    def getMajorVersion: Int=1
    def getMinorVersion: Int=0
    def jdbcCompliant: Boolean=false
    def getParentLogger: Logger=Logger.getLogger("chronicle.test.snapshot")
  }
  test("Effectual-GoodCommunication regression: one ANN traversal supplies count and page despite invisible HNSW graph inserts") {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh") }
    val original=Fixtures.config(); val config=original.copy(embedding=original.embedding.copy(dimensions=dimensions))
    val db=new Database(config); db.initialize()
    db.transaction { c =>
      Sql.exec(c,"TRUNCATE ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks,ch_groups,ch_invites,ch_members,ch_tokens,ch_sessions,ch_mutations CASCADE")
      Sql.exec(c,"UPDATE ch_profile SET active=?,target=?,maintenance=false",config.profile,config.profile)
    }
    val snapshot=Wire.encode(IngestRequest.codecJson,Fixtures.snapshot()).noSpaces
    val chunk=Wire.encode(Chunk.codecJson,Fragments.split(Fixtures.snapshot().messages).head).noSpaces
    def insert(first: Int,last: Int): Unit={ db.transaction { c =>
      Sql.exec(c,s"CREATE TEMP TABLE fixture AS SELECT i,md5('source'||((i-1)/$chunksPerSession))::uuid AS sid,md5('generation'||((i-1)/$chunksPerSession))::uuid AS gid,md5('chunk'||i)::uuid AS cid FROM generate_series($first,$last)i")
      Sql.exec(c,"INSERT INTO ch_sources(id,owner,source_key,revision,published) SELECT DISTINCT sid,'a',sid::text,1,gid FROM fixture ON CONFLICT DO NOTHING")
      Sql.exec(c,"INSERT INTO ch_revisions SELECT DISTINCT sid,1,?::jsonb FROM fixture ON CONFLICT DO NOTHING",snapshot)
      Sql.exec(c,"INSERT INTO ch_generations SELECT DISTINCT gid,sid,1,? FROM fixture ON CONFLICT DO NOTHING",config.profile)
      Sql.exec(c,s"INSERT INTO ch_chunks SELECT cid,gid,?::jsonb || jsonb_build_object('id',cid,'sessionId',sid),to_tsvector('english','synthetic'),(SELECT array_agg(sin(i*d*0.031)+cos(i*d*0.017))::vector FROM generate_series(1,$dimensions)d),0 FROM fixture",chunk)
      Sql.exec(c,"INSERT INTO ch_search_chunks SELECT ch.id,ch.generation,g.session_id,g.revision,g.profile,ch.document,ch.embedding FROM ch_chunks ch JOIN fixture f ON f.cid=ch.id JOIN ch_generations g ON g.id=ch.generation")
    }
      ArchiveProjection.backfill(db)
    }
    try {
      insert(1,initialChunks); db.transaction(c => Sql.exec(c,"ANALYZE"))
      val archive=new PostgresArchive(db,config); val index=new PostgresSearch(db,archive,config)
      val query=SearchQuery("synthetic",SearchMode.Semantic,SearchFilter(None,None,None,None,Nil),pageLimit,0)
      val vector=Some(embedding(42)); val plan=index.statement("a",query,vector)
      val initialTotal=db.transaction { c => SearchPolicy.configure(c); Sql.one(c,plan.sql+" SELECT count(*) FROM sessions",plan.args*)(_.getInt(1)).get }
      val offset=initialTotal-expectedTailSize
      val driver=new MutatingDriver(reader => {
        val before=Sql.one(reader,"SELECT count(*) FROM ch_search_chunks")(_.getInt(1)).get
        insert(initialChunks+1,initialChunks+addedChunks)
        val after=Sql.one(reader,"SELECT count(*) FROM ch_search_chunks")(_.getInt(1)).get
        assertEquals(before,initialChunks); assertEquals(after,before,"repeatable-read logical rows must remain unchanged")
      })
      DriverManager.registerDriver(driver)
      try {
        val proxied=config.copy(jdbcUrl=proxyPrefix+config.jdbcUrl); val readerDb=new Database(proxied)
        val result=new PostgresSearch(readerDb,new PostgresArchive(readerDb,proxied),proxied).search("a",query.copy(offset=offset),vector)
        println(s"ANN SNAPSHOT initialTotal=$initialTotal responseTotal=${result.total} offset=$offset hits=${result.hits.size} annStatements=${driver.annStatements.get()}")
        assertEquals(result.hits.size,math.min(pageLimit,math.max(0,result.total-offset)),"response count and tail page must come from the same candidate pool")
        assertEquals(driver.annStatements.get(),1,"count and page must share one physical ANN traversal")
        val empty=index.search("a",query.copy(offset=SearchPolicy.candidatesPerLeg-1),vector)
        assertEquals(empty.hits,Nil); assert(empty.total>0,"an empty offset page must retain its nonzero candidate count")
      } finally DriverManager.deregisterDriver(driver)
    } finally db.transaction(c => Sql.exec(c,"TRUNCATE ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks,ch_groups,ch_invites,ch_members,ch_tokens,ch_sessions,ch_mutations CASCADE"))
  }
}
