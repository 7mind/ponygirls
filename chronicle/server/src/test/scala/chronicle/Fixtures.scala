package chronicle
import chronicle.api.*
extension (archive: SessionArchive) {
  def publish(claim: Claim,chunks: List[IndexedChunk]): Boolean = archive.publishProblems(claim,TestPublications.from(claim,chunks))
  /** An in-memory publication validated by the oracle against the claimed messages (read without an admission), staged as
    * one step and switched to, then the replaced generation's search rows retired, as the worker publishes. */
  def publishProblems(claim: Claim,publication: ProblemsPublication): Boolean = {
    // The archive checks the vectors' dimensions against its configuration.
    publication.validate(claim,publication.chunks.headOption.fold(0)(_.vector.size),ProblemPassages.Source(claim.messages.reader(TestFetch.unadmitted)))
    val published=archive.publishProblems(claim,ProblemsPublication.rows(publication))
    if(published) archive.retire(claim)
    published
  }
  /** The head revision as it was stored (no production read materializes a whole revision). */
  def headSnapshot(reader: String,id: java.util.UUID): IngestRequest = archive match {
    case postgres: PostgresArchive => postgres.db.transaction { c =>
      postgres.authorized(c,reader,id)
      val revision=Sql.one(c,"SELECT revision FROM ch_sources WHERE id=?",id)(_.getInt(1)).get
      RevisionContent.request(c,RevisionContent.resolve(c,id,revision).get)
    }
    case dummy: DummyArchive => dummy.headSnapshot(reader,id)
    case other => throw new AssertionError(s"no stored head snapshot for ${other.getClass.getName}")
  }
}
/** Message fetching without an admission or a per-message bound (production fetching is the Worker's). */
object TestFetch {
  val unadmitted: MessageFetch = MessageFetch(Long.MaxValue,new LargeDecodes { def apply[A](decode: => A): A = decode })
}
extension (messages: ClaimedMessages) {
  /** Every claimed message, decoded at once (production reads them per window). */
  def decoded: List[Message] = {
    val reader=messages.reader(TestFetch.unadmitted)
    Iterator.unfold(0)(from => Option.when(from<reader.count)(reader.read(from)).map(read => (read,from+read.size))).flatten.toList
  }
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
  /** Runs `body` while the generation carries an old-format label without being retired (a leftover: only a dropped
    * current-format check admits one), then restores the label and, by a start, the check. */
  def leftover(db: Database,generation: UUID)(body: => Unit): Unit = {
    def label(format: PassageFormat): Unit = db.transaction { c => Sql.exec(c,"UPDATE ch_generations SET passage_format=? WHERE id=?",format.toString,generation); () }
    db.transaction(c => Sql.exec(c,"ALTER TABLE ch_generations DROP CONSTRAINT ch_generations_current_format_check"))
    label(PassageFormat.LegacyAnnotations)
    try body finally { label(PassageFormat.ContextAwareProblems); db.initialize() }
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
      val probe = new JdbcConnectionFactory {
        def open(url: String,properties: Properties): java.sql.Connection = DriverManager.getConnection(config.jdbcUrl,properties)
      }
      val canonical = config.copy(jdbcUrl=canonicalUrl)
      // The decorated URL belongs only to the explicit transport probe. Domain
      // initialization still validates an ordinary production-shaped configuration.
      Database.withRuntimes(canonical,profiles,Database.runtimes(canonical,BlockingJdbcDatabase.withConnectionFactory(_,probe)))
    }
  }
  // PBKDF2 at the production iteration count costs ~150 ms: once per JVM, not once per config().
  private lazy val syntheticPasswordHash = Password.hash("synthetic".toCharArray)
  def config(): Config = {
    val dir = Files.createTempDirectory("chronicle-test-")
    val credential = dir.resolve("secret"); Files.writeString(credential,"")
    val databaseCredential = dir.resolve("database-password"); Files.writeString(databaseCredential,databasePassword+"\n")
    val hash = dir.resolve("password"); Files.writeString(hash,syntheticPasswordHash)
    Config("127.0.0.1",8448,"http://127.0.0.1:8448",false,sys.env.getOrElse("CHRONICLE_TEST_JDBC","jdbc:postgresql://127.0.0.1:55438/postgres"),"postgres",databaseCredential.toString,List("a","b","c").map(id => UserConfig(id,id,hash.toString,true,false)),8388608,16,4194304,10000,43200,ModelConfig("http://127.0.0.1:1/chat","model","v1",credential.toString,1,65536,AnnotationRequestPolicy.StrictJsonSchema),EmbeddingConfig("http://127.0.0.1:1/embedding","embed","v1",credential.toString,1,65536,3,"query: ","passage: ",false),false,Nil,IndexingCapacity.defaults,databaseLimits,None,8388608,Config.defaultIndexingBudgetBytes,None)
  }
  def snapshot(): IngestRequest = {
    val raw = """{"type":"session","id":"session","version":3}
{"type":"model_change","id":"meta","parentId":null,"modelId":"test"}
{"type":"message","id":"u","parentId":"meta","message":{"role":"user","content":[{"type":"text","text":"synthetic PostgreSQL archive"}]}}
"""
    IngestRequest(UUID.randomUUID(),SourceIdentity(UUID.randomUUID().toString,"native",SourceFormat.Pi,"session",None),0,Wire.hash(raw),Completion.Quiescent,false,Metadata("synthetic",Some("project"),None,None,Some("main"),None,"pi",None,Some("2026-01-01T00:00:00Z"),None,List("synthetic")),List(Message("u",Some("meta"),"user","synthetic PostgreSQL archive",None,2)),List(RawFile("session.jsonl",Wire.hash(raw),raw)))
  }
}
