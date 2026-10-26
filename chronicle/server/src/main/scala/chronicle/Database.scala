package chronicle
import java.sql.{Connection, DriverManager, PreparedStatement, ResultSet}
import scala.util.Using
import java.util.UUID
import chronicle.api.*
import io.circe.Json

final class Database(config: Config) {
  Class.forName("org.postgresql.Driver")
  def transaction[A](f: Connection => A): A = Using.resource(DriverManager.getConnection(config.jdbcUrl, config.databaseUser, Config.credential(config.databasePasswordFile))) { c =>
    c.setAutoCommit(false)
    try { val a = f(c); c.commit(); a } catch { case e: Throwable => c.rollback(); throw e }
  }
  def initialize(): Unit = {
    transaction { c =>
    Sql.exec(c,"SELECT pg_advisory_xact_lock(71393721)")
    List("001.sql","002.sql","003_index_progress.sql","004_collector_progress.sql","005_static_tokens.sql","006_archive_projection.sql").foreach { migration =>
      val stream = getClass.getResourceAsStream(s"/$migration")
      Check(stream != null,"config","missing migration resource")
      val sql = Using.resource(scala.io.Source.fromInputStream(stream))(_.mkString)
      Using.resource(c.createStatement())(_.execute(sql))
    }
    val dimensions=SearchPolicy.dimensions(config)
    Sql.exec(c,s"CREATE INDEX IF NOT EXISTS ch_search_hnsw_d$dimensions ON ch_search_chunks USING hnsw ((l2_normalize(embedding)::halfvec($dimensions)) halfvec_cosine_ops) WHERE vector_dims(embedding)=$dimensions")
    Sql.exec(c,"UPDATE ch_users SET enabled=false")
    config.users.foreach { u =>
      val credential = Config.credential(u.passwordHashFile)
      Sql.exec(c,"DELETE FROM ch_sessions WHERE owner=? AND EXISTS(SELECT 1 FROM ch_users WHERE id=? AND credential<>?)",u.id,u.id,credential)
      Sql.exec(c,"INSERT INTO ch_users(id,login,enabled,credential) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET login=excluded.login,enabled=excluded.enabled,credential=excluded.credential",u.id,u.login,u.enabled,credential)
    }
    StaticTokens.reconcile(c,config)
    Sql.exec(c,"DELETE FROM ch_sessions WHERE owner IN(SELECT id FROM ch_users WHERE NOT enabled) OR expires < now()")
    Sql.exec(c,"INSERT INTO ch_profile(singleton,active,target,maintenance) VALUES(true,?,?,false) ON CONFLICT DO NOTHING",config.profile,config.profile)
    }
    ArchiveProjection.backfill(this)
  }
}
object Sql {
  type Param = String | Int | Long | Boolean | UUID
  def bind(p: PreparedStatement, args: Seq[Param]): Unit = args.zipWithIndex.foreach { case (a,i) => a match {
    case s: String => p.setString(i+1,s); case n: Int => p.setInt(i+1,n); case n: Long => p.setLong(i+1,n); case b: Boolean => p.setBoolean(i+1,b); case u: UUID => p.setObject(i+1,u)
  }}
  def exec(c: Connection, sql: String, args: Param*): Int = Using.resource(c.prepareStatement(sql)) { p => bind(p,args); if (sql.startsWith("SELECT")) { Using.resource(p.executeQuery())(_ => 0) } else p.executeUpdate() }
  def rows[A](c: Connection, sql: String, args: Param*)(f: ResultSet => A): List[A] = Using.resource(c.prepareStatement(sql)) { p => bind(p,args); Using.resource(p.executeQuery()) { r => val out = List.newBuilder[A]; while(r.next()) out += f(r); out.result() } }
  def one[A](c: Connection, sql: String, args: Param*)(f: ResultSet => A): Option[A] = rows(c,sql,args*)(f).headOption
  def lock(c: Connection, key: String): Unit = exec(c,"SELECT pg_advisory_xact_lock(hashtextextended(?,0))",key)
  def json(r: ResultSet, col: String): Json = Wire.parse(r.getString(col))
}
object Jobs {
  val supersededRevision = "superseded-revision"
  def retry(c: Connection,owner: String,id: UUID): Unit = {
    val target=Sql.one(c,"SELECT target FROM ch_profile WHERE singleton FOR SHARE")(_.getString(1)).get
    val head=Sql.one(c,"SELECT s.revision FROM ch_sources s JOIN ch_jobs j ON j.session_id=s.id WHERE j.id=? AND s.owner=? AND NOT s.tombstone FOR UPDATE OF s",id,owner)(_.getInt(1)).getOrElse(throw DomainError("not-found","job not found"))
    val (revision,profile)=Sql.one(c,"SELECT revision,profile FROM ch_jobs WHERE id=? FOR UPDATE",id)(r => (r.getInt(1),r.getString(2))).get
    Check(revision==head,"conflict","job superseded by a newer archive revision")
    Check(profile==target,"conflict","job superseded by the target model profile")
    Sql.exec(c,"UPDATE ch_jobs SET state='Queued',attempts=0,lease_until=NULL,fence=fence+1,error=NULL,completed_windows=0,total_windows=NULL WHERE id=?",id)
  }
}
final class PostgresArchive(db: Database, config: Config) extends SessionArchive {
  val visible = """EXISTS(SELECT 1 FROM ch_users ou WHERE ou.id=s.owner AND ou.enabled) AND EXISTS(SELECT 1 FROM ch_users ru WHERE ru.id=? AND ru.enabled) AND (s.owner=? OR EXISTS(SELECT 1 FROM ch_members a JOIN ch_members b ON a.group_id=b.group_id WHERE a.user_id=? AND b.user_id=s.owner)) AND NOT s.tombstone"""
  def sourceKey(r: IngestRequest): String = Wire.hash(Wire.canonical(Wire.encode(SourceIdentity.codecJson,r.source)))
  def ingest(owner: String, r: IngestRequest, profile: String): IngestReceipt = {
    SnapshotValidation.validate(r,config)
    db.transaction { c =>
      val key = sourceKey(r); val payload = Wire.encode(IngestRequest.codecJson,r); val digest = Wire.hash(Wire.canonical(payload))
      Sql.lock(c,s"ingest:$owner:$key")
      Sql.one(c,"SELECT digest,result FROM ch_ingest_receipts WHERE owner=? AND source_key=? AND request_id=?",owner,key,r.requestId) { x =>
        Check(x.getString("digest") == digest,"conflict","request ID bound to different payload"); Wire.decode(IngestReceipt.codecJson,Sql.json(x,"result"))
      } match {
        case Some(receipt) => receipt
        case None =>
          Sql.exec(c,"INSERT INTO ch_sources(id,owner,source_key) VALUES(?,?,?) ON CONFLICT(owner,source_key) DO NOTHING",UUID.randomUUID(),owner,key)
          val (id,head,deleted) = Sql.one(c,"SELECT id,revision,tombstone FROM ch_sources WHERE owner=? AND source_key=? FOR UPDATE",owner,key)(x => (x.getObject("id",classOf[UUID]),x.getInt("revision"),x.getBoolean("tombstone"))).get
          Check(!deleted,"gone","source purged; use a new collector namespace to restore")
          Check(head == r.expectedRevision,"conflict",s"expected revision mismatch; current=$head")
          val next = head+1; val job = UUID.randomUUID(); val receipt = IngestReceipt(r.requestId,id,next,job)
          val snapshot=SnapshotProjection(r)
          Sql.exec(c,"INSERT INTO ch_revisions VALUES(?,?,?::jsonb)",id,next,Wire.encode(IngestRequest.codecJson,snapshot).noSpaces)
          ArchiveProjection.persist(c,id,next,snapshot)
          Sql.exec(c,"UPDATE ch_sources SET revision=? WHERE id=?",next,id)
          Sql.exec(c,"UPDATE ch_jobs SET state='Failed',error=?,fence=fence+1,lease_until=NULL WHERE session_id=? AND revision<? AND state<>'Complete'",Jobs.supersededRevision,id,next)
          Sql.exec(c,"INSERT INTO ch_jobs(id,session_id,revision,profile) VALUES(?,?,?,?)",job,id,next,profile)
          Sql.exec(c,"INSERT INTO ch_ingest_receipts VALUES(?,?,?,?,?::jsonb)",owner,key,r.requestId,digest,Wire.encode(IngestReceipt.codecJson,receipt).noSpaces)
          receipt
      }
    }
  }
  def authorized(c: Connection, reader: String, id: UUID): Unit = Check(Sql.one(c,s"SELECT 1 FROM ch_sources s WHERE s.id=? AND $visible",id,reader,reader,reader)(_ => true).contains(true),"not-found","session not found")
  private def reading[A](f: Connection => A): A = db.transaction { c =>
    c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ)
    f(c)
  }
  private def content(c: Connection,id: UUID,revision: Int): IngestRequest =
    Sql.one(c,"SELECT snapshot FROM ch_revisions WHERE session_id=? AND revision=?",id,revision)(r => Wire.decode(IngestRequest.codecJson,Sql.json(r,"snapshot"))).getOrElse(throw DomainError("not-found","content view not found"))
  private def selectView(c: Connection,reader: String,id: UUID,selector: Option[ContentView]): ContentView = {
    authorized(c,reader,id)
    val (head,published,indexed)=Sql.one(c,"SELECT s.revision,s.published,g.revision AS indexed FROM ch_sources s LEFT JOIN ch_generations g ON g.id=s.published WHERE s.id=?",id) { r =>
      val revision=r.getInt("indexed"); val index=if(r.wasNull()) None else Some(revision)
      (r.getInt("revision"),Option(r.getObject("published",classOf[UUID])),index)
    }.get
    val view=selector.getOrElse(ContentView(indexed.getOrElse(head),published))
    Check(view.revision>0,"invalid","content revision must be positive")
    view.generationId.foreach { generation =>
      Check(Sql.one(c,"SELECT 1 FROM ch_generations WHERE id=? AND session_id=? AND revision=?",generation,id,view.revision)(_ => true).contains(true),"not-found","content view not found")
    }
    Check(Sql.one(c,"SELECT 1 FROM ch_revisions WHERE session_id=? AND revision=?",id,view.revision)(_ => true).contains(true),"not-found","content view not found")
    view
  }
  def info(c: Connection,reader: String,id: UUID,selector: Option[ContentView]): SessionInfo = {
    val view=selectView(c,reader,id,selector)
    Sql.one(c,"SELECT s.owner,s.revision,g.revision AS indexed,i.metadata,i.source,i.completion,i.redacted FROM ch_sources s JOIN ch_revision_info i ON i.session_id=s.id AND i.revision=? LEFT JOIN ch_generations g ON g.id=s.published WHERE s.id=?",view.revision,id) { row =>
      val idx=row.getInt("indexed"); val indexed=if(row.wasNull()) None else Some(idx)
      SessionInfo(view,id,row.getString("owner"),row.getInt("revision"),indexed,Wire.decode(Metadata.codecJson,Sql.json(row,"metadata")),Wire.decode(SourceIdentity.codecJson,Sql.json(row,"source")),Completion.parse(row.getString("completion")).get,row.getBoolean("redacted"))
    }.getOrElse(throw DomainError("projection","content metadata projection missing"))
  }
  def session(reader: String,id: UUID): SessionInfo = reading(c => info(c,reader,id,None))
  def headSnapshot(reader: String,id: UUID): IngestRequest = reading { c =>
    authorized(c,reader,id)
    val revision=Sql.one(c,"SELECT revision FROM ch_sources WHERE id=?",id)(_.getInt(1)).get
    content(c,id,revision)
  }
  def readSession(reader: String,id: UUID,selector: Option[ContentView]): SessionResult = reading { c =>
    val session=info(c,reader,id,selector)
    SessionResult(session,chunksForView(c,session.view,0,100).chunks)
  }
  def messages(reader: String,id: UUID,offset: Int,limit: Int,selector: Option[ContentView]): MessagesResult = reading { c =>
    Check.page(offset,limit)
    val view=selectView(c,reader,id,selector)
    val total=Sql.one(c,"SELECT message_count FROM ch_revision_info WHERE session_id=? AND revision=?",id,view.revision)(_.getInt(1)).getOrElse(throw DomainError("projection","message projection missing"))
    val messages=Sql.rows(c,"SELECT value FROM ch_messages WHERE session_id=? AND revision=? ORDER BY position LIMIT ? OFFSET ?",id,view.revision,limit,offset)(r => Wire.decode(Message.codecJson,Sql.json(r,"value")))
    MessagesResult(messages,total,offset,view)
  }
  def locateMessage(reader: String,id: UUID,selector: ContentView,messageId: String): MessageLocation = reading { c =>
    Check.text(messageId,256)
    val view=selectView(c,reader,id,Some(selector))
    Sql.one(c,"SELECT m.position,i.message_count FROM ch_messages m JOIN ch_revision_info i ON i.session_id=m.session_id AND i.revision=m.revision WHERE m.session_id=? AND m.revision=? AND m.message_id=?",id,view.revision,messageId)(r => MessageLocation(view,r.getInt(1),r.getInt(2))).getOrElse(throw DomainError("not-found","message not found"))
  }
  def raw(reader: String,id: UUID,revision: Option[Int]): RawResult = reading { c =>
    authorized(c,reader,id)
    val selected=revision.getOrElse(Sql.one(c,"SELECT revision FROM ch_sources WHERE id=?",id)(_.getInt(1)).get)
    Check(selected>0,"invalid","content revision must be positive")
    RawResult(content(c,id,selected).files,selected)
  }
  def claim(profile: String, leaseSeconds: Int): Option[Claim] = db.transaction { c =>
    Sql.exec(c,"UPDATE ch_jobs SET state='Failed',error='lease-exhausted',lease_until=NULL WHERE state='Running' AND lease_until<now() AND attempts>=5")
    Sql.one(c,"""WITH candidate AS(SELECT j.id FROM ch_jobs j JOIN ch_sources s ON s.id=j.session_id JOIN ch_profile p ON p.singleton WHERE j.profile=? AND p.target=? AND NOT s.tombstone AND j.revision=s.revision AND j.attempts<5 AND (j.state='Queued' OR (j.state='Running' AND j.lease_until<now())) ORDER BY j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1) UPDATE ch_jobs j SET state='Running',attempts=attempts+1,fence=fence+1,lease_until=now()+make_interval(secs=>?),completed_windows=0,total_windows=NULL FROM candidate WHERE j.id=candidate.id RETURNING j.*""",profile,profile,leaseSeconds) { row =>
      val sid = row.getObject("session_id",classOf[UUID]); val rev = row.getInt("revision")
      val snap = Sql.one(c,"SELECT snapshot FROM ch_revisions WHERE session_id=? AND revision=?",sid,rev)(r => Wire.decode(IngestRequest.codecJson,Sql.json(r,"snapshot"))).get
      Claim(row.getObject("id",classOf[UUID]),sid,rev,row.getLong("fence"),profile,snap)
    }
  }
  def progress(claim: Claim,completedWindows: Int,totalWindows: Int): Boolean = {
    Check(completedWindows>=0 && totalWindows>=completedWindows,"invalid","invalid indexing progress")
    db.transaction { c =>
      val target=Sql.one(c,"SELECT target FROM ch_profile WHERE singleton FOR SHARE")(_.getString(1)).get
      val current=target==claim.profile && Sql.one(c,"SELECT id FROM ch_sources WHERE id=? AND revision=? AND NOT tombstone FOR UPDATE",claim.sessionId,claim.revision)(_ => true).contains(true)
      current && Sql.exec(c,"UPDATE ch_jobs SET completed_windows=?,total_windows=? WHERE id=? AND fence=? AND state='Running' AND lease_until>now() AND completed_windows<=? AND (total_windows IS NULL OR total_windows=?)",completedWindows,totalWindows,claim.jobId,claim.fence,completedWindows,totalWindows)==1
    }
  }
  def publish(claim: Claim,chunks: List[IndexedChunk]): Boolean = db.transaction { c =>
    val target=Sql.one(c,"SELECT target FROM ch_profile WHERE singleton FOR SHARE")(_.getString(1)).get
    val current=target==claim.profile && Sql.one(c,"SELECT id FROM ch_sources WHERE id=? AND revision=? AND NOT tombstone FOR UPDATE",claim.sessionId,claim.revision)(_ => true).contains(true)
    val valid=current && Sql.one(c,"SELECT j.id FROM ch_jobs j WHERE j.id=? AND j.fence=? AND j.state='Running' AND j.lease_until>now() FOR UPDATE",claim.jobId,claim.fence)(_ => true).contains(true)
    if (!valid) false else {
      val generation = UUID.randomUUID()
      Sql.exec(c,"INSERT INTO ch_generations VALUES(?,?,?,?)",generation,claim.sessionId,claim.revision,claim.profile)
      chunks.zipWithIndex.foreach { case (x,ordinal) => Sql.exec(c,"INSERT INTO ch_chunks(id,generation,value,document,embedding,ordinal) VALUES(?,?,?::jsonb,to_tsvector('english',?),?::vector,?)",x.chunk.id,generation,Wire.encode(Chunk.codecJson,x.chunk).noSpaces,s"${x.chunk.text} ${x.chunk.summary} ${x.chunk.tags.mkString(" ")}",x.vector.mkString("[",",","]"),ordinal) }
      chunks.flatMap(_.chunk.tags).distinct.foreach(tag => Sql.exec(c,"INSERT INTO ch_generation_tags(generation,tag) VALUES(?,?) ON CONFLICT DO NOTHING",generation,tag))
      Sql.exec(c,"DELETE FROM ch_search_chunks WHERE session_id=?",claim.sessionId)
      Sql.exec(c,"INSERT INTO ch_search_chunks(id,generation,session_id,revision,profile,document,embedding) SELECT ch.id,ch.generation,g.session_id,g.revision,g.profile,ch.document,ch.embedding FROM ch_chunks ch JOIN ch_generations g ON g.id=ch.generation WHERE g.id=?",generation)
      Sql.exec(c,"UPDATE ch_sources SET published=? WHERE id=?",generation,claim.sessionId)
      Sql.exec(c,"UPDATE ch_jobs SET state='Complete',error=NULL,lease_until=NULL WHERE id=?",claim.jobId)
      true
    }
  }
  def fail(claim: Claim,code: String): Unit = db.transaction { c =>
    val target=Sql.one(c,"SELECT target FROM ch_profile WHERE singleton FOR SHARE")(_.getString(1)).get
    val current=target==claim.profile && Sql.one(c,"SELECT id FROM ch_sources WHERE id=? AND revision=? AND NOT tombstone FOR UPDATE",claim.sessionId,claim.revision)(_ => true).contains(true)
    if(current) Sql.exec(c,"UPDATE ch_jobs SET state=CASE WHEN attempts>=5 THEN 'Failed' ELSE 'Queued' END,error=?,lease_until=NULL,completed_windows=CASE WHEN attempts>=5 THEN completed_windows ELSE 0 END,total_windows=CASE WHEN attempts>=5 THEN total_windows ELSE NULL END WHERE id=? AND fence=? AND state='Running' AND lease_until>now()",code.take(64),claim.jobId,claim.fence)
    ()
  }
  private def chunksForView(c: Connection,view: ContentView,offset: Int,limit: Int): ChunksResult = view.generationId match {
    case None => ChunksResult(Nil,0,offset,view)
    case Some(generation) =>
      val total=Sql.one(c,"SELECT count(*) FROM ch_chunks WHERE generation=?",generation)(_.getInt(1)).get
      val values=Sql.rows(c,"SELECT value FROM ch_chunks WHERE generation=? ORDER BY ordinal,id LIMIT ? OFFSET ?",generation,limit,offset)(r => Wire.decode(Chunk.codecJson,Sql.json(r,"value")))
      ChunksResult(values,total,offset,view)
  }
  def pageChunks(reader: String,id: UUID,offset: Int,limit: Int,selector: Option[ContentView]): ChunksResult = reading { c =>
    Check.page(offset,limit)
    chunksForView(c,selectView(c,reader,id,selector),offset,limit)
  }
  def statuses(reader: String,offset: Int,limit: Int): StatusResult = db.transaction { c =>
    Check.page(offset,limit)
    val from = s"FROM ch_jobs j JOIN ch_sources s ON s.id=j.session_id WHERE $visible"
    val n = Sql.one(c,s"SELECT count(*) $from",reader,reader,reader)(_.getInt(1)).get
    val jobs = Sql.rows(c,s"SELECT j.* $from ORDER BY j.id LIMIT ? OFFSET ?",reader,reader,reader,limit,offset)(r => JobInfo(r.getObject("id",classOf[UUID]),r.getObject("session_id",classOf[UUID]),r.getInt("revision"),JobState.parse(r.getString("state")).get,r.getInt("attempts"),Option(r.getString("error")),r.getInt("completed_windows"),Option(r.getObject("total_windows",classOf[java.lang.Integer])).map(_.intValue)))
    StatusResult(jobs,n)
  }
  def retry(owner: String,id: UUID): Unit = db.transaction(c => Jobs.retry(c,owner,id))
  def beginMaintenance(): Unit = db.transaction { c =>
    Sql.exec(c,"SELECT pg_advisory_xact_lock(71393721)")
    val target = Sql.one(c,"SELECT target,maintenance FROM ch_profile FOR UPDATE")(r => (r.getString(1),r.getBoolean(2))).get
    Check(!target._2 || target._1 == config.profile,"conflict","another profile maintenance is active")
    Sql.exec(c,"UPDATE ch_profile SET target=?,maintenance=true",config.profile)
    Sql.exec(c,"""INSERT INTO ch_jobs(id,session_id,revision,profile) SELECT gen_random_uuid(),s.id,s.revision,? FROM ch_sources s LEFT JOIN ch_generations g ON g.id=s.published WHERE NOT s.tombstone AND (g.profile IS DISTINCT FROM ? OR g.revision<>s.revision) ON CONFLICT(session_id,revision,profile) DO UPDATE SET state='Queued',attempts=0,fence=ch_jobs.fence+1,lease_until=NULL,error=NULL,completed_windows=0,total_windows=NULL WHERE ch_jobs.state='Complete'""",config.profile,config.profile)
  }
  def finishMaintenance(): Boolean = db.transaction { c =>
    val left = Sql.one(c,"SELECT count(*) FROM ch_sources s LEFT JOIN ch_generations g ON g.id=s.published WHERE NOT s.tombstone AND (g.profile IS DISTINCT FROM ? OR g.revision<>s.revision)",config.profile)(_.getInt(1)).get
    if(left>0) false else { Sql.exec(c,"UPDATE ch_profile SET active=target,maintenance=false WHERE target=?",config.profile); true }
  }
}
