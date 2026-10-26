package chronicle

import chronicle.api.*
import cats.effect.IO
import java.lang.reflect.{InvocationHandler,InvocationTargetException,Method,Proxy}
import java.sql.{Connection,Driver,DriverManager,DriverPropertyInfo,PreparedStatement,ResultSet}
import java.util.{Properties,UUID}
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.{AtomicInteger,AtomicLong}
import java.util.logging.Logger
import scala.jdk.CollectionConverters.*
import java.time.Clock

private[chronicle] enum SourceEvent {
  case Query(sql: String,columns: List[String])
  case Payload(sql: String,column: String)
  case Closed(sql: String,exhausted: Boolean)
  case Consumed(bytes: Long)
}
private[chronicle] final class SourceProbe extends Driver {
  private val prefix="jdbc:chronicle-source:"
  private val events=new ConcurrentLinkedQueue[SourceEvent]()
  val activeResults=new AtomicInteger()
  def observations: List[SourceEvent]=events.iterator().asScala.toList
  def url(original: String): String=prefix+original
  private def call(target: AnyRef,method: Method,args: Array[AnyRef]): AnyRef =
    try method.invoke(target,args*) catch { case error: InvocationTargetException => throw error.getCause }
  def acceptsURL(url: String): Boolean=url.startsWith(prefix)
  def connect(url: String,properties: Properties): Connection = {
    if(!acceptsURL(url)) null else {
      val connection=DriverManager.getConnection(url.stripPrefix(prefix),properties)
      Proxy.newProxyInstance(getClass.getClassLoader,Array(classOf[Connection]),new InvocationHandler {
        def invoke(proxy: AnyRef,method: Method,args: Array[AnyRef]): AnyRef = {
          val result=call(connection,method,args)
          if(method.getName!="prepareStatement") result else {
            val sql=args(0).asInstanceOf[String]
            Proxy.newProxyInstance(getClass.getClassLoader,Array(classOf[PreparedStatement]),new InvocationHandler {
              def invoke(proxy: AnyRef,method: Method,args: Array[AnyRef]): AnyRef = {
                val result=call(resultStatement,method,args)
                if(method.getName!="executeQuery") result else {
                  val rows=result.asInstanceOf[ResultSet]; val metadata=rows.getMetaData
                  events.add(SourceEvent.Query(sql,(1 to metadata.getColumnCount).map(metadata.getColumnLabel).toList))
                  activeResults.incrementAndGet()
                  var exhausted=false; var closed=false
                  Proxy.newProxyInstance(getClass.getClassLoader,Array(classOf[ResultSet]),new InvocationHandler {
                    def invoke(proxy: AnyRef,method: Method,args: Array[AnyRef]): AnyRef = {
                      if(Set("getString","getBytes","getCharacterStream","getBinaryStream")(method.getName)) events.add(SourceEvent.Payload(sql,args(0).toString))
                      val value=call(rows,method,args)
                      if(method.getName=="next" && value==java.lang.Boolean.FALSE) exhausted=true
                      if(method.getName=="close" && !closed) { closed=true; activeResults.decrementAndGet(); events.add(SourceEvent.Closed(sql,exhausted)) }
                      value
                    }
                  })
                }
              }
              private val resultStatement=result
            })
          }
        }
      }).asInstanceOf[Connection]
    }
  }
  def admission(delegate: ReadAdmission,after: Long => Unit): ReadAdmission = new ReadAdmission {
    def consume(bytes: Long): Unit = {
      Check(activeResults.get()==0,"test","admission occurred with a live JDBC result set")
      delegate.consume(bytes); events.add(SourceEvent.Consumed(bytes)); after(bytes)
    }
  }
  def getPropertyInfo(url: String,properties: Properties): Array[DriverPropertyInfo]=Array.empty
  def getMajorVersion: Int=1
  def getMinorVersion: Int=0
  def jdbcCompliant: Boolean=false
  def getParentLogger: Logger=Logger.getLogger("chronicle.test.source")
}
private[chronicle] final class ReadSourceFixture(val config: Config,val db: Database,val archive: PostgresArchive,val catalog: IndexProfileCatalog,val probe: SourceProbe,embedding: String => IO[List[Double]]) {
  val identity=Identity(UserInfo("a","synthetic",List(Scope.Read)),true,"synthetic")
  val access=new McpRunAccess { def fresh: IO[Identity]=IO.pure(identity) }
  private val embedder=new Embedder {
    def query(owner: String,text: String): IO[List[Double]]=embedding(text)
    def documents(owner: String,text: List[String]): IO[List[List[Double]]]=IO.raiseError(new AssertionError("source tool embedded documents"))
  }
  def application(user: String): Application = {
    val projected=config.copy(jdbcUrl=probe.url(config.jdbcUrl),databaseUser=user)
    val readerDb=new Database(projected,catalog); val reader=new PostgresArchive(readerDb,projected)
    new Application(reader,new PostgresSearch(readerDb,reader,projected),embedder,new Auth(db,config),readerDb,
      new CollectorProgress(new PostgresCollectorProgressStore(readerDb),Clock.systemUTC()),new PostgresArchiveIndex(readerDb,reader,projected),new PostgresActivity(readerDb,Clock.systemUTC()),new PostgresExpressionHintIndex(readerDb,reader,Clock.systemUTC()),ModelFixtures.usage(projected))
  }
  val app: Application=application(config.databaseUser)
  val mcp=new Mcp(app)
  val tools=new LiveMcpRunTools(mcp)
  def publish(request: IngestRequest,chunkText: String,summary: String,tags: List[String],spans: List[Span]): IngestReceipt = {
    val receipt=archive.ingest("a",request)
    val current=archive.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get
    assert(archive.publish(current,List(IndexedChunk(Chunk(UUID.randomUUID(),receipt.sessionId,chunkText,summary,tags,spans,0.0),ProblemPublicationFixtures.vector))))
    receipt
  }
}
private[chronicle] object ReadSourceFixture extends munit.Assertions {
  def withFixture(embedding: String => IO[List[Double]])(test: ReadSourceFixture => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped") }
    val config=Fixtures.config(); val catalog=IndexProfileCatalog.legacyOnly(config); val db=new Database(config,catalog); db.initialize()
    db.transaction { c =>
      Sql.exec(c,"TRUNCATE ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks,ch_groups,ch_members,ch_sessions CASCADE")
      Sql.exec(c,"UPDATE ch_profile SET active=?,target=?,maintenance=false",config.profile,config.profile)
      Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=0",config.profile)
    }
    val probe=new SourceProbe
    DriverManager.registerDriver(probe)
    try test(new ReadSourceFixture(config,db,new PostgresArchive(db,config),catalog,probe,embedding)) finally DriverManager.deregisterDriver(probe)
  }
}
