package chronicle
import chronicle.api.*
// Historical test constructor names now seed the one current policy, never an old executor.
final case class PassagePolicyIdentity(value: String)
extension (factory: IndexProfileCatalog.type) {
  def legacyOnly(config: Config): IndexProfileCatalog = factory.current(config)
  def passages(config: Config,identity: PassagePolicyIdentity): IndexProfileCatalog = factory.current(config)
}
extension (archive: SessionArchive) {
  def publish(claim: Claim,chunks: List[IndexedChunk]): Boolean = archive.publishProblems(claim,TestPublications.from(claim,chunks))
}
import java.nio.file.{Files,Path}
import java.util.UUID
import scala.concurrent.duration.*
import ponygirls.runtime.{BlockingJdbcDatabase, JdbcConnectionFactory, JdbcLimits}
import java.sql.DriverManager
import java.util.Properties
object Fixtures {
  def rebuild(db: Database,owner: String): OwnerReindexOutcome = {
    val service=new PostgresOwnerReindex(db); val plan=service.preview(owner)
    service(owner,UUID.randomUUID(),plan.targetProfile,plan.selectionHash,true)
  }
  // Exact accounted infrastructure statement, not a wildcard SQL exclusion.
  val runtimeSetupSql = """SELECT set_config(s.name,least(coalesce(nullif(s.setting::bigint,0),v.bound),v.bound)::text,false)
      FROM pg_settings s JOIN (VALUES ('statement_timeout',?::bigint),('lock_timeout',?::bigint),
      ('idle_in_transaction_session_timeout',?::bigint)) v(name,bound) ON s.name=v.name"""
  val databasePassword = "chronicle-test-password"
  // Preserve the existing 30s public archive statement budget and >5s renewal
  // waits. Infrastructure lock/idle bounds must not silently preempt those APIs.
  val databaseLimits = JdbcLimits(8,32,5.seconds,5.seconds,30.seconds,35.seconds,60.seconds,35.seconds)
  /** Proxies/schema options are fixture-only real-JDBC probes. Production validation
    * still accepts only a queryless PostgreSQL URL and receives identical properties.
    */
  def database(config: Config, profiles: IndexProfileCatalog): Database = {
    val offset = config.jdbcUrl.indexOf("jdbc:postgresql://")
    require(offset >= 0, "fixture must wrap real PostgreSQL")
    val canonicalUrl = config.jdbcUrl.substring(offset).takeWhile(_ != '?')
    if (canonicalUrl == config.jdbcUrl) new Database(config,profiles)
    else {
      val physical = BlockingJdbcDatabase.withConnectionFactory(config.copy(jdbcUrl=canonicalUrl).jdbcConfig,new JdbcConnectionFactory {
        def open(url: String,properties: Properties): java.sql.Connection = DriverManager.getConnection(config.jdbcUrl,properties)
      })
      // The decorated URL belongs only to the explicit transport probe. Domain
      // initialization still validates an ordinary production-shaped configuration.
      Database.withRuntime(config.copy(jdbcUrl=canonicalUrl),profiles,physical)
    }
  }
  def config(): Config = {
    val dir = Files.createTempDirectory("chronicle-test-")
    val credential = dir.resolve("secret"); Files.writeString(credential,"")
    val databaseCredential = dir.resolve("database-password"); Files.writeString(databaseCredential,databasePassword+"\n")
    val hash = dir.resolve("password"); Files.writeString(hash,Password.hash("synthetic".toCharArray))
    Config("127.0.0.1",8448,"http://127.0.0.1:8448",false,sys.env.getOrElse("CHRONICLE_TEST_JDBC","jdbc:postgresql://127.0.0.1:55438/postgres"),"postgres",databaseCredential.toString,List("a","b","c").map(id => UserConfig(id,id,hash.toString,true)),8388608,16,4194304,10000,43200,ModelConfig("http://127.0.0.1:1/chat","model","v1",credential.toString,1,65536,AnnotationRequestPolicy.StrictJsonSchema),EmbeddingConfig("http://127.0.0.1:1/embedding","embed","v1",credential.toString,1,65536,3,"query: ","passage: ",false),false,Nil,IndexingCapacity.defaults,databaseLimits)
  }
  def snapshot(): IngestRequest = {
    val raw = """{"type":"session","id":"session","version":3}
{"type":"model_change","id":"meta","parentId":null,"modelId":"test"}
{"type":"message","id":"u","parentId":"meta","message":{"role":"user","content":[{"type":"text","text":"synthetic PostgreSQL archive"}]}}
"""
    IngestRequest(UUID.randomUUID(),SourceIdentity(UUID.randomUUID().toString,"native",SourceFormat.Pi,"session",None),0,Wire.hash(raw),Completion.Quiescent,false,Metadata("synthetic",Some("project"),None,None,Some("main"),None,"pi",None,Some("2026-01-01T00:00:00Z"),None,List("synthetic")),List(Message("u",Some("meta"),"user","synthetic PostgreSQL archive",None,2)),List(RawFile("session.jsonl",Wire.hash(raw),raw)))
  }
}
