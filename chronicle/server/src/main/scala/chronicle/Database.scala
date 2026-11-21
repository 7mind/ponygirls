package chronicle
import java.sql.{Connection, PreparedStatement, ResultSet}
import scala.util.Using
import java.util.UUID
import chronicle.api.*
import io.circe.Json
import ponygirls.auth.{AccountFailure,ImperativeAccountSql}

final class Database private (config: Config,val profiles: IndexProfileCatalog,runtime: ponygirls.runtime.BlockingJdbcDatabase) extends AutoCloseable {
  def this(config: Config, profiles: IndexProfileCatalog) = this(config,profiles,new ponygirls.runtime.BlockingJdbcDatabase(config.jdbcConfig))
  def transaction[A](f: Connection => A): A = runtime.transaction(f)
  def close(): Unit = runtime.close()
  private def migrate(c: Connection,name: String): Unit = {
    val stream=getClass.getResourceAsStream(s"/$name")
    Check(stream!=null,"config","missing migration resource")
    val sql=Using.resource(scala.io.Source.fromInputStream(stream))(_.mkString)
    Using.resource(c.createStatement())(_.execute(sql))
  }
  /** Model identity v1 is retired: rows that migration 021 would discard refuse the start instead. */
  private def requireRetiredModelIdentityMigrated(c: Connection): Unit = {
    List("ch_retained_profile_reads","ch_checkpoint_namespaces","ch_model_identity_migrations").foreach { table =>
      val remaining=Sql.one(c,"SELECT to_regclass(?) IS NOT NULL",table)(_.getBoolean(1)).contains(true) && Sql.one(c,s"SELECT 1 FROM $table LIMIT 1")(_ => true).nonEmpty
      Check(!remaining,"migration-required",s"model identity v1 rows remain in $table; migrate them with the legacy-retirement procedure before starting this release")
    }
    // The singleton only seeded the owner targets of users that had none (an archive from before owner targets).
    val unseeded=Sql.one(c,"SELECT to_regclass('ch_profile') IS NOT NULL AND EXISTS(SELECT 1 FROM ch_users u WHERE NOT EXISTS(SELECT 1 FROM ch_owner_targets t WHERE t.owner=u.id))")(_.getBoolean(1)).contains(true)
    Check(!unseeded,"migration-required","users without an owner target in an archive from before owner targets; start the previous release once to seed them, then migrate with the legacy-retirement procedure")
  }
  /** The old publication formats are retired: until migration 022 has added its check, a generation that is not retired
    * and not in a current format (including one without a format) refuses the start instead of failing the check. */
  private def requireRetiredPassageFormatsMigrated(c: Connection): Unit = {
    val checked=Sql.one(c,"SELECT 1 FROM pg_constraint WHERE conrelid='ch_generations'::regclass AND conname='ch_generations_current_format_check'")(_ => true).nonEmpty
    val remaining= !checked && Sql.one(c,s"SELECT 1 FROM ch_generations WHERE NOT retired AND (passage_format IS NULL OR passage_format NOT IN ${GenerationRows.formatsSql}) LIMIT 1")(_ => true).nonEmpty
    Check(!remaining,"migration-required","generations that are not retired remain in an old publication format; retire them with the legacy-retirement procedure before starting this release")
  }
  /** Migration 017 builds [[Database.candidateIndex]] inside the start's transaction only on a heap of at most `inlineBytes`;
    * above it a missing index, and an invalid one (an interrupted concurrent build) at any size, refuse the start with the
    * operator's psql commands. */
  private def requireCandidateIndex(c: Connection,inlineBytes: Long): Unit = {
    val (index,bytes)=Sql.one(c,"SELECT coalesce((SELECT CASE WHEN indisvalid THEN 'valid' ELSE 'invalid' END FROM pg_index WHERE indexrelid=to_regclass(?)),'missing'),coalesce(pg_relation_size(to_regclass('ch_archive_fragments')),0)",Database.candidateIndex)(r => (r.getString(1),r.getLong(2))).get
    val psql="in psql as the table's owner (the serving release may keep running): SET statement_timeout=0; SET lock_timeout=0;"
    Check(index!="invalid","migration-required",s"index ${Database.candidateIndex} is invalid (an interrupted concurrent build); before starting this release, $psql DROP INDEX CONCURRENTLY ${Database.candidateIndex}; ${Database.candidateIndexBuild};")
    Check(index=="valid" || bytes<=inlineBytes,"migration-required",s"ch_archive_fragments has $bytes bytes, more than the $inlineBytes a start builds index ${Database.candidateIndex} on; before starting this release, $psql ${Database.candidateIndexBuild};")
  }
  def initialize(startupCandidateIndexBytes: Long = Database.startupCandidateIndexBytes): Unit = {
    transaction { c =>
    Sql.exec(c,"SELECT pg_advisory_xact_lock(71393721)")
    requireCandidateIndex(c,startupCandidateIndexBytes)
    List("001.sql","002.sql","003_index_progress.sql","004_collector_progress.sql","005_static_tokens.sql","006_archive_projection.sql","007_owner_profiles.sql","008_problem_passages.sql","009_transient_security_epoch.sql","010_index_checkpoints.sql","011_context_coverage.sql","012_reindex_cohorts.sql","013_revision_bindings.sql","014_renewable_sessions.sql","015_annotation_attempts.sql","020_persistent_sessions.sql").foreach(migrate(c,_))
    requireRetiredModelIdentityMigrated(c)
    migrate(c,"021_model_identity_retired.sql")
    requireRetiredPassageFormatsMigrated(c)
    migrate(c,"022_passage_formats_retired.sql")
    migrate(c,"024_epoch_layout.sql")
    migrate(c,"025_uploads.sql")
    migrate(c,"026_staged_generations.sql")
    migrate(c,"027_window_reuse.sql")
    migrate(c,"028_generation_lineage.sql")
    val dimensions=SearchPolicy.dimensions(config)
    Sql.exec(c,s"CREATE INDEX IF NOT EXISTS ch_search_hnsw_d$dimensions ON ch_search_chunks USING hnsw ((l2_normalize(embedding)::halfvec($dimensions)) halfvec_cosine_ops) WHERE vector_dims(embedding)=$dimensions")
    profiles.register(c)
    val configured=DeclaredUsers.load(config)
    try {
      ImperativeAccountSql.initialize(c)
      // A configured id or login equal to an imperative account that has been active fails closed, with the
      // master switch on or off, before the upsert below could adopt that account's row.
      ImperativeAccountSql.installDeclared(c,DeclaredUsers.directory(configured)) {
        Sql.exec(c,"UPDATE ch_users SET enabled=false")
        configured.foreach { case (u,credential) =>
          Sql.exec(c,"DELETE FROM ch_sessions WHERE owner=? AND EXISTS(SELECT 1 FROM ch_users WHERE id=? AND credential<>?)",u.id,u.id,credential)
          Sql.exec(c,"INSERT INTO ch_users(id,login,enabled,credential) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET login=excluded.login,enabled=excluded.enabled,credential=excluded.credential",u.id,u.login,u.enabled,credential)
        }
      }
    } catch { case failure: AccountFailure => throw DomainError(failure.code,"configured users conflict with imperative accounts or their schema") }
    // Master switch off: the projections stay disabled by the statement above (suspended; rows, tokens and data kept).
    if(config.accountsEnabled) {
      Check(Sql.one(c,"SELECT count(*) FROM ponygirls_imperative_users i WHERE i.status='active' AND NOT EXISTS(SELECT 1 FROM ch_users u WHERE u.id=i.id)")(_.getInt(1)).contains(0),"internal","active imperative account without a user row")
      // Update only: a projection is created by the activating transaction, never here.
      Sql.exec(c,"UPDATE ch_users u SET enabled=true,credential=i.password_hash FROM ponygirls_imperative_users i WHERE i.id=u.id AND i.status='active'")
    }
    StaticTokens.reconcile(c,config)
    Sql.exec(c,"DELETE FROM ch_sessions WHERE owner IN(SELECT id FROM ch_users WHERE NOT enabled) OR expires <= clock_timestamp()")
    Sql.exec(c,"INSERT INTO ch_owner_targets(owner,profile) SELECT id,? FROM ch_users ON CONFLICT DO NOTHING",profiles.preferred.profile)
    }
    ArchiveProjection.backfill(this)
    transaction { c =>
      Sql.exec(c,"SELECT pg_advisory_xact_lock(71393721)")
      // Again: the backfill since the first check can have grown the table.
      requireCandidateIndex(c,startupCandidateIndexBytes)
      migrate(c,"017_head_literal_candidates.sql")
    }
  }
}
object Database {
  /** The index of migration 017 through which a HEAD switch reads the session's head candidates (S1). */
  val candidateIndex = "ch_archive_fragments_session_candidates"
  /** The operator's build of [[candidateIndex]] beside a serving release (psql, autocommit). */
  val candidateIndexBuild = s"CREATE INDEX CONCURRENTLY IF NOT EXISTS $candidateIndex ON ch_archive_fragments(session_id) WHERE head_candidate"
  /** The largest ch_archive_fragments heap a start builds [[candidateIndex]] on, inside its transaction under the service's
    * statement (30 s) and socket (35 s) timeouts. The build reads the whole heap: the clone's 11.8 GB took 1.8 s with two
    * workers and 4.8 s serially from the page cache; 1 GiB from a disk at 100 MB/s takes about 11 s. */
  val startupCandidateIndexBytes: Long = 1024L*1024*1024
  /** Startup diagnostics of imperative accounts: the active ones, which are suspended while the master switch
    * is off, and the rows whose TOTP secret was sealed with a key other than `keyId`. */
  def activeImperativeAccounts(c: Connection): Int = Sql.one(c,"SELECT count(*) FROM ponygirls_imperative_users WHERE status='active'")(_.getInt(1)).getOrElse(0)
  def imperativeAccountsSealedByAnotherKey(c: Connection,keyId: String): Int = Sql.one(c,"SELECT count(*) FROM ponygirls_imperative_users WHERE totp_key_id<>?",keyId)(_.getInt(1)).getOrElse(0)
  /** Explicit runtime injection for trusted JDBC probes; ownership transfers to Database. */
  def withRuntime(config: Config, profiles: IndexProfileCatalog, runtime: ponygirls.runtime.BlockingJdbcDatabase): Database =
    new Database(config,profiles,runtime)
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
object PostgresArchive {
  /** Search rows per insertion statement. A row's vector-index insertion measured 1.5-3.1 ms on the full-size archive copy. */
  val searchRowsPerStatement = 500
  /** The permits of the process's search-row writers (PassageStorage.searchRowWriters), shared by its publications. */
  private[chronicle] val searchRowWriters = new java.util.concurrent.Semaphore(PassageStorage.searchRowWriters)
  /** A message page holds the longest prefix of its messages whose stored values fit (at least one message): a page of
    * 100 messages each bounded only by its request would otherwise hold gigabytes. */
  val messagePageBytes: Long = 64L*1024*1024
  /** Messages fetched per round trip while a whole revision's messages are decoded one at a time (`RevisionContent.request`). */
  val claimedMessagesPerFetch = 64
}
object Jobs {
  val attemptLimit=5
  val supersededRevision = "superseded-revision"
  /** A Running job with a valid lease keeps its claim when its source gets a newer revision, and the head job of its
    * source and profile waits for it; every other unfinished job of an older revision ends superseded. */
  def leased(job: String): String = s"$job.state='Running' AND $job.lease_until>clock_timestamp()"
  val superseding = s"state='Failed',error='$supersededRevision',failure_stage=NULL,fence=fence+1,lease_until=NULL"
  def retry(c: Connection,owner: String,id: UUID): Unit = {
    val target=OwnerTargets.read(c,owner,true).profile
    val head=Sql.one(c,"SELECT s.revision FROM ch_sources s JOIN ch_jobs j ON j.session_id=s.id WHERE j.id=? AND s.owner=? AND NOT s.tombstone FOR UPDATE OF s",id,owner)(_.getInt(1)).getOrElse(throw DomainError("not-found","job not found"))
    val (revision,profile)=Sql.one(c,"SELECT revision,profile FROM ch_jobs WHERE id=? FOR UPDATE",id)(r => (r.getInt(1),r.getString(2))).get
    Check(revision==head,"conflict","job superseded by a newer archive revision")
    Check(profile==target,"conflict","job superseded by the target model profile")
    Sql.exec(c,"UPDATE ch_jobs SET state='Queued',attempts=0,lease_until=NULL,fence=fence+1,annotation_retry_epoch=annotation_retry_epoch+1,run_id=CASE WHEN state='Complete' THEN gen_random_uuid() ELSE run_id END,error=CASE WHEN state='Complete' THEN NULL ELSE error END,failure_stage=CASE WHEN state='Complete' THEN NULL ELSE failure_stage END,completed_windows=0,total_windows=NULL WHERE id=?",id)
  }
  /** The jobs of a source whose head just switched to revision `next`: older unfinished jobs end superseded (a leased
    * Running one keeps its claim; Complete and Failed ones are not written) and the new head's job is queued; returns its id. */
  def switched(c: Connection,id: UUID,next: Int,profile: String): UUID = {
    val job=UUID.randomUUID()
    Sql.exec(c,s"UPDATE ch_jobs j SET ${Jobs.superseding} WHERE j.session_id=? AND j.revision<? AND j.state IN('Queued','Running') AND (${Jobs.leased("j")}) IS NOT TRUE",id,next)
    Sql.exec(c,"INSERT INTO ch_jobs(id,session_id,revision,profile) VALUES(?,?,?,?)",job,id,next,profile)
    job
  }
}
final class PostgresArchive(private[chronicle] val db: Database, config: Config, layout: RevisionLayoutPolicy) extends SessionArchive with PassageReader with MessageSearchReader with ContextReader {
  def this(db: Database,config: Config) = this(db,config,RevisionLayoutPolicy.production)
  private val contextReader=new PostgresContextReader(db,this)
  def readMessageContext(reader: String,id: UUID,view: ContentView,anchor: Span,beforeBytes: Int,afterBytes: Int,materialization: ReadMaterialization): MessageContextResult =
    contextReader.readMessageContext(reader,id,view,anchor,beforeBytes,afterBytes,materialization)
  private[chronicle] val messageSearch=new PostgresMessageSearch(db,this,new MessageSearchCursors,SessionMessageSearchPolicy.scanDeadlineMillis)
  def searchSessionMessages(reader: String,id: UUID,view: ContentView,literal: String,cursor: Option[String],limit: Int,materialization: ReadMaterialization): SessionMessageSearchResult =
    messageSearch.searchSessionMessages(reader,id,view,literal,cursor,limit,materialization)
  val visible = """EXISTS(SELECT 1 FROM ch_users ou WHERE ou.id=s.owner AND ou.enabled) AND EXISTS(SELECT 1 FROM ch_users ru WHERE ru.id=? AND ru.enabled) AND (s.owner=? OR EXISTS(SELECT 1 FROM ch_members a JOIN ch_members b ON a.group_id=b.group_id WHERE a.user_id=? AND b.user_id=s.owner)) AND NOT s.tombstone"""
  def sourceKey(r: IngestRequest): String = Wire.hash(Wire.canonical(Wire.encode(SourceIdentity.codecJson,r.source)))
  val knownProfiles: Set[String] = db.profiles.knownProfiles
  def ingest(owner: String, r: IngestRequest): IngestReceipt = {
    SnapshotValidation.validate(r,config)
    db.transaction { c =>
      OwnerTargets.enabled(c,owner,true)
      val key = sourceKey(r); val payload = Wire.encode(IngestRequest.codecJson,r); val digest = Wire.hash(Wire.canonical(payload))
      Sql.lock(c,s"ingest:$owner:$key")
      Sql.one(c,"SELECT digest,result FROM ch_ingest_receipts WHERE owner=? AND source_key=? AND request_id=?",owner,key,r.requestId) { x =>
        Check(x.getString("digest") == digest,"conflict","request ID bound to different payload"); Wire.decode(IngestReceipt.codecJson,Sql.json(x,"result"))
      } match {
        case Some(receipt) => receipt
        case None =>
          Uploads.admitIngest(c,owner,key)
          val target=OwnerTargets.read(c,owner,true)
          db.profiles.resolve(target.profile)
          Sql.exec(c,"INSERT INTO ch_sources(id,owner,source_key) VALUES(?,?,?) ON CONFLICT(owner,source_key) DO NOTHING",UUID.randomUUID(),owner,key)
          def source(lock: String): (UUID,Int) = Sql.one(c,s"SELECT id,revision,tombstone FROM ch_sources WHERE owner=? AND source_key=?$lock",owner,key) { x =>
            Check(!x.getBoolean("tombstone"),"gone","source purged; use a new collector namespace to restore")
            val revision=x.getInt("revision")
            Check(revision == r.expectedRevision,"conflict",s"expected revision mismatch; current=$revision")
            (x.getObject("id",classOf[UUID]),revision)
          }.get
          // The advisory lock above serializes the ingests of this source; the source row is locked only for the switch
          // to the new revision, not while a large snapshot is projected (indexing claims lock that row on every write),
          // and NO KEY UPDATE does not wait for a publication that is writing its generation.
          val (id,head) = source("")
          val next = head+1
          val written=EpochWriter.write(c,layout,id,head,next,SnapshotProjection(r),() => source(""))
          source(" FOR NO KEY UPDATE")
          Sql.exec(c,"UPDATE ch_sources SET revision=? WHERE id=?",next,id)
          EpochWriter.switched(c,written)
          val receipt = IngestReceipt(r.requestId,id,next,Jobs.switched(c,id,next,target.profile))
          Sql.exec(c,"INSERT INTO ch_ingest_receipts VALUES(?,?,?,?,?::jsonb)",owner,key,r.requestId,digest,Wire.encode(IngestReceipt.codecJson,receipt).noSpaces)
          receipt
      }
    }
  }
  def authorized(c: Connection, reader: String, id: UUID): Unit = Check(Sql.one(c,s"SELECT 1 FROM ch_sources s WHERE s.id=? AND $visible",id,reader,reader,reader)(_ => true).contains(true),"not-found","session not found")
  private def reading[A](f: Connection => A): A = reading(ReadMaterialization.unrestricted)(f)
  private def reading[A](materialization: ReadMaterialization)(f: Connection => A): A = db.transaction { c =>
    c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ)
    materialization.begin(c)
    f(c)
  }
  private def content(c: Connection,id: UUID,revision: Int): RevisionContent =
    RevisionContent.resolve(c,id,revision).getOrElse(throw DomainError("not-found","content view not found"))
  private[chronicle] def selectView(c: Connection,reader: String,id: UUID,selector: Option[ContentView]): ContentView = selectView(c,reader,id,selector,ReadMaterialization.unrestricted)
  private[chronicle] def selectView(c: Connection,reader: String,id: UUID,selector: Option[ContentView],materialization: ReadMaterialization): ContentView =
    select(c,reader,id,selector,materialization)(view => Sql.one(c,"SELECT 1 FROM ch_revisions WHERE session_id=? AND revision=?",id,view.revision)(_ => ()))._1
  /** The selected view and where its revision's content is stored, resolved with the revision's existence. */
  private[chronicle] def selectContent(c: Connection,reader: String,id: UUID,selector: Option[ContentView],materialization: ReadMaterialization): (ContentView,RevisionContent) =
    select(c,reader,id,selector,materialization)(view => RevisionContent.resolve(c,id,view.revision))
  private def select[A](c: Connection,reader: String,id: UUID,selector: Option[ContentView],materialization: ReadMaterialization)(stored: ContentView => Option[A]): (ContentView,A) = {
    authorized(c,reader,id)
    val (head,published,indexed)=Sql.one(c,"SELECT s.revision,s.published,g.revision AS indexed FROM ch_sources s LEFT JOIN ch_generations g ON g.id=s.published WHERE s.id=?",id) { r =>
      val revision=r.getInt("indexed"); val index=if(r.wasNull()) None else Some(revision)
      (r.getInt("revision"),Option(r.getObject("published",classOf[UUID])),index)
    }.get
    materialization.admit(JsonUtf8Size(Json.obj("revision"->Json.fromInt(head),"published"->published.map(id => Json.fromString(id.toString)).getOrElse(Json.Null),"indexed"->indexed.map(Json.fromInt).getOrElse(Json.Null))))
    val view=selector.getOrElse(ContentView(indexed.getOrElse(head),published))
    Check(view.revision>0,"invalid","content revision must be positive")
    view.generationId.foreach { generation =>
      // A staged generation (migration 026) is not a content view until its switch.
      val (retired,current)=Sql.one(c,s"SELECT retired,coalesce(passage_format IN ${GenerationRows.formatsSql},false) FROM ch_generations g WHERE id=? AND session_id=? AND revision=? AND NOT EXISTS(SELECT 1 FROM ch_staged_generations st WHERE st.generation=g.id)",generation,id,view.revision)(r => (r.getBoolean(1),r.getBoolean(2))).getOrElse(throw DomainError("not-found","content view not found"))
      Check(!retired,"indexed-view-retired","indexed content view was retired by an explicit rebuild")
      Check(current,"unavailable","indexed content view is not in the current passage format")
    }
    (view,stored(view).getOrElse(throw DomainError("not-found","content view not found")))
  }
  private[chronicle] def infoQuery(id: UUID,view: ContentView): ReadSources.Query = ReadSources.Query("SELECT s.owner,s.revision,g.revision AS indexed,i.metadata,i.source,i.completion,i.redacted FROM ch_sources s JOIN ch_revision_info i ON i.session_id=s.id AND i.revision=? LEFT JOIN ch_generations g ON g.id=s.published WHERE s.id=?",List(view.revision,id))
  def info(c: Connection,reader: String,id: UUID,selector: Option[ContentView]): SessionInfo = info(c,reader,id,selector,ReadMaterialization.unrestricted)
  def info(c: Connection,reader: String,id: UUID,selector: Option[ContentView],materialization: ReadMaterialization): SessionInfo = {
    val view=selectView(c,reader,id,selector,materialization)
    materialization.admit(ReadSources.bytes(c,infoQuery(id,view)))
    infoForView(c,id,view)
  }
  private[chronicle] def infoForView(c: Connection,id: UUID,view: ContentView): SessionInfo = {
    val query=infoQuery(id,view)
    Sql.one(c,query.sql,query.args*) { row =>
      val idx=row.getInt("indexed"); val indexed=if(row.wasNull()) None else Some(idx)
      SessionInfo(view,id,row.getString("owner"),row.getInt("revision"),indexed,Wire.decode(Metadata.codecJson,Sql.json(row,"metadata")),Wire.decode(SourceIdentity.codecJson,Sql.json(row,"source")),Completion.parse(row.getString("completion")).get,row.getBoolean("redacted"))
    }.getOrElse(throw DomainError("projection","content metadata projection missing"))
  }
  def session(reader: String,id: UUID): SessionInfo = reading(c => info(c,reader,id,None))
  def readSession(reader: String,id: UUID,selector: Option[ContentView]): SessionResult = readSession(reader,id,selector,ReadMaterialization.unrestricted)
  def readSession(reader: String,id: UUID,selector: Option[ContentView],materialization: ReadMaterialization): SessionResult = reading(materialization) { c =>
    val view=selectView(c,reader,id,selector,materialization)
    val total=chunkCount(c,view)
    materialization.admit(ReadSources.sum(List(ReadSources.bytes(c,infoQuery(id,view)),chunkSourceBytes(c,view,0,100),chunkCountBytes(view,total))))
    SessionResult(infoForView(c,id,view),chunksForView(c,view,0,100,total).chunks)
  }
  def messages(reader: String,id: UUID,offset: Int,limit: Int,selector: Option[ContentView]): MessagesResult = messages(reader,id,offset,limit,selector,ReadMaterialization.unrestricted)
  def messages(reader: String,id: UUID,offset: Int,limit: Int,selector: Option[ContentView],materialization: ReadMaterialization): MessagesResult =
    messages(reader,id,offset,limit,selector,materialization,PostgresArchive.messagePageBytes)
  private[chronicle] def messages(reader: String,id: UUID,offset: Int,limit: Int,selector: Option[ContentView],materialization: ReadMaterialization,pageBytes: Long): MessagesResult = reading(materialization) { c =>
    Check.contentPage(offset,limit)
    val (view,content)=selectContent(c,reader,id,selector,materialization)
    val total=Sql.one(c,"SELECT message_count FROM ch_revision_info WHERE session_id=? AND revision=?",id,view.revision)(_.getInt(1)).getOrElse(throw DomainError("projection","message projection missing"))
    val page=messagePage(c,content,offset,limit)
    // Measured as ReadSources.bytes measures the page below, before any value is fetched.
    val kept=Sql.one(c,s"SELECT greatest(1,count(*) FILTER (WHERE running<=?)) FROM (SELECT sum(octet_length(convert_to(jsonb_build_object('value',p.value)::text,'UTF8'))) OVER (ORDER BY p.position) AS running FROM (${page.sql}) p) w",((pageBytes: Sql.Param)::page.args)*)(_.getInt(1)).get
    val cut=messagePage(c,content,offset,kept)
    val query=ReadSources.Query(s"SELECT value FROM (${cut.sql}) m ORDER BY position",cut.args)
    materialization.admit(ReadSources.sum(List(JsonUtf8Size(Json.obj("message_count"->Json.fromInt(total))),ReadSources.bytes(c,query))))
    val messages=Sql.rows(c,query.sql,query.args*)(r => Wire.decode(Message.codecJson,Sql.json(r,"value")))
    MessagesResult(messages,total,offset,view)
  }
  /** At most `limit` messages from position `offset`, read in key order (`keyOrdered`). */
  private[chronicle] def messagePage(c: Connection,content: RevisionContent,offset: Int,limit: Int): ReadSources.Query = {
    keyOrdered(c,content)
    val stored=content.messages
    ReadSources.Query(s"SELECT position,value FROM ${stored.sql} m WHERE position>=? ORDER BY position LIMIT ?",stored.args++List(offset,limit))
  }
  private def keyOrdered(c: Connection,content: RevisionContent): Unit = if(content.isInstanceOf[RevisionContent.Epoch]) RevisionContent.keyOrdered(c)
  def locateMessage(reader: String,id: UUID,selector: ContentView,messageId: String): MessageLocation = reading { c =>
    Check.text(messageId,256)
    val (view,content)=selectContent(c,reader,id,Some(selector),ReadMaterialization.unrestricted)
    val stored=content.messages
    Sql.one(c,s"SELECT m.position,i.message_count FROM ${stored.sql} m JOIN ch_revision_info i ON i.session_id=? AND i.revision=? WHERE m.message_id=?",(stored.args++List(id,view.revision,messageId))*)(r => MessageLocation(view,r.getInt(1),r.getInt(2))).getOrElse(throw DomainError("not-found","message not found"))
  }
  def raw(reader: String,id: UUID,revision: Option[Int]): RawResult = reading { c =>
    authorized(c,reader,id)
    val selected=revision.getOrElse(Sql.one(c,"SELECT revision FROM ch_sources WHERE id=?",id)(_.getInt(1)).get)
    Check(selected>0,"invalid","content revision must be positive")
    val stored=content(c,id,selected)
    val size=rawBytes(c,stored)
    Check(size<=config.maxRawReadBytes,"too-large",s"raw revision of $size bytes exceeds the raw read bound of ${config.maxRawReadBytes} bytes")
    RawResult(RevisionContent.files(c,stored),selected)
  }
  /** The UTF-8 bytes of the revision's raw files, known before any of them is built. */
  private def rawBytes(c: Connection,content: RevisionContent): Long = content match {
    case epoch: RevisionContent.Epoch => epoch.rawBytes
    case legacy: RevisionContent.Legacy =>
      Sql.one(c,"SELECT coalesce(sum(octet_length(f->>'content')),0) FROM ch_revisions r CROSS JOIN LATERAL jsonb_array_elements(r.snapshot->'files') f WHERE r.session_id=? AND r.revision=?",legacy.id,legacy.revision)(_.getLong(1)).get
  }
  def claim(profiles: Set[String],scope: ClaimScope,leaseSeconds: Int,large: LargeJobs): Option[Claim] = {
    Check(profiles.nonEmpty && leaseSeconds>=0,"invalid","invalid claim profiles or lease")
    Check(profiles.subsetOf(knownProfiles),"unavailable","index policy is not executable; explicit rebuild required")
    supersedeEndedLeases(profiles,scope)
    claimHead(profiles,scope,leaseSeconds,large)
  }
  /** Running jobs of an older revision whose lease ended cannot renew and are never claimed again: they end superseded and
    * stop blocking their head jobs. A short transaction of its own that locks the sources FOR NO KEY UPDATE, compatible with
    * the key-share locks of an ingest's projection: inside the claim, FOR UPDATE locks on these sources would hold up their
    * ingests while the claimed snapshot of another source streams. */
  private def supersedeEndedLeases(profiles: Set[String],scope: ClaimScope): Unit = db.transaction { c =>
    val (scoped,owner)=scope match {
      case ClaimScope.AllOwners => ("",List.empty[Sql.Param])
      case ClaimScope.Owner(value) => (" AND t.owner=?",List[Sql.Param](value))
    }
    val ended="j.revision<s.revision AND j.state='Running' AND (j.lease_until>clock_timestamp()) IS NOT TRUE"
    val sources=Sql.rows(c,s"""SELECT s.id,t.profile FROM ch_sources s JOIN ch_owner_targets t ON t.owner=s.owner JOIN ch_users u ON u.id=s.owner AND u.enabled
      WHERE t.profile IN(${profiles.toList.map(_ => "?").mkString(",")})$scoped AND NOT s.tombstone AND EXISTS(SELECT 1 FROM ch_jobs j WHERE j.session_id=s.id AND j.profile=t.profile AND $ended)
      ORDER BY s.id FOR NO KEY UPDATE OF s SKIP LOCKED""",(profiles.toList.sorted++owner)*)(r => (r.getObject(1,classOf[UUID]),r.getString(2)))
    sources.foreach { (id,profile) =>
      Sql.exec(c,s"UPDATE ch_jobs j SET ${Jobs.superseding} FROM ch_sources s WHERE s.id=j.session_id AND j.session_id=? AND j.profile=? AND $ended",id,profile)
    }
  }
  private def claimHead(profiles: Set[String],scope: ClaimScope,leaseSeconds: Int,large: LargeJobs): Option[Claim] = db.transaction { c =>
    profiles.foreach(IndexProfiles.registered(c,_))
    val scoped=scope match {
      case ClaimScope.AllOwners => ("",List.empty[Sql.Param])
      case ClaimScope.Owner(owner) => (" AND t.owner=?",List[Sql.Param](owner))
    }
    val placeholders=profiles.toList.sorted.map(_ => "?").mkString(",")
    val owners=Sql.rows(c,s"SELECT t.owner FROM ch_owner_targets t JOIN ch_users u ON u.id=t.owner AND u.enabled WHERE t.profile IN($placeholders)${scoped._1} ORDER BY t.owner",(profiles.toList.sorted++scoped._2)*)(_.getString(1))
    owners.iterator.map { owner =>
      OwnerTargets.eligible(c,owner).filter(target => profiles.contains(target.profile)).flatMap { target =>
        val exhausted=Sql.rows(c,s"""SELECT s.id FROM ch_sources s WHERE s.owner=? AND NOT s.tombstone AND EXISTS(
          SELECT 1 FROM ch_jobs j WHERE j.session_id=s.id AND j.revision=s.revision AND j.profile=? AND j.state='Running' AND j.lease_until<clock_timestamp() AND j.attempts>=${Jobs.attemptLimit})
          ORDER BY s.id FOR UPDATE OF s SKIP LOCKED""",owner,target.profile)(_.getObject(1,classOf[UUID]))
        exhausted.foreach { id =>
          Sql.exec(c,s"UPDATE ch_jobs SET state='Failed',error='lease-exhausted',failure_stage=NULL,lease_until=NULL,fence=fence+1 WHERE session_id=? AND profile=? AND state='Running' AND lease_until<clock_timestamp() AND attempts>=${Jobs.attemptLimit}",id,target.profile)
        }
        // One job per source and profile at a time: the head job waits while a job of an older revision is Running
        // (supersedeEndedLeases ended those whose lease ended). Without the large-job permit, a claim passes by a job
        // deferred to the lane with it (Queued with its window count: only a deferral records one while it is queued) and
        // a large one whose lease ended. No job is refused for its size (ingest-limits spec §5.2.7).
        val source=Sql.one(c,s"""SELECT s.id,s.revision FROM ch_sources s WHERE s.owner=? AND NOT s.tombstone AND EXISTS(
          SELECT 1 FROM ch_jobs j WHERE j.session_id=s.id AND j.revision=s.revision AND j.profile=? AND j.attempts<${Jobs.attemptLimit} AND (j.state='Queued' OR (j.state='Running' AND j.lease_until<clock_timestamp())))
          AND NOT EXISTS(SELECT 1 FROM ch_jobs o WHERE o.session_id=s.id AND o.revision<s.revision AND o.profile=? AND o.state='Running')
          AND (? OR NOT EXISTS(SELECT 1 FROM ch_jobs d WHERE d.session_id=s.id AND d.revision=s.revision AND d.profile=? AND (d.total_windows>? OR (d.state='Queued' AND d.total_windows IS NOT NULL))))
          ORDER BY s.id FOR UPDATE OF s SKIP LOCKED LIMIT 1""",owner,target.profile,target.profile,large==LargeJobs.Admitted,target.profile,LargeJobs.windows)(r => (r.getObject(1,classOf[UUID]),r.getInt(2)))
        source.flatMap { (id,revision) =>
          Sql.one(c,s"""UPDATE ch_jobs SET state='Running',attempts=attempts+1,fence=fence+1,lease_until=clock_timestamp()+make_interval(secs=>?),completed_windows=0,total_windows=NULL
            WHERE id=(SELECT id FROM ch_jobs WHERE session_id=? AND revision=? AND profile=? AND attempts<${Jobs.attemptLimit} AND (state='Queued' OR (state='Running' AND lease_until<clock_timestamp())) FOR UPDATE SKIP LOCKED LIMIT 1)
            RETURNING id,fence,run_id""",leaseSeconds,id,revision,target.profile) { row =>
            val (snap,binding,messages)=claimedSnapshot(c,id,revision)
            Claim(row.getObject("id",classOf[UUID]),id,revision,row.getLong("fence"),target.profile,snap,owner,target.epoch,row.getObject("run_id",classOf[UUID]),binding,messages)
          }
        }
      }
    }.collectFirst { case Some(claim) => claim }
  }
  /** The claimed revision for indexing (ingest-limits spec §5.2.1): its envelope, binding and the reader of its messages.
    * No message is decoded here: the claim transaction locks the source row FOR UPDATE, which the source's next revision
    * switch waits for; each window reads its messages in a transaction of its own. */
  private[chronicle] def claimedSnapshot(c: Connection,id: UUID,revision: Int): (IngestRequest,RevisionBinding,ClaimedMessages) = {
    val stored=RevisionContent.resolve(c,id,revision).getOrElse(throw DomainError("stale-claim","archive revision no longer exists"))
    val (snapshot,bindingId,count)=RevisionContent.claimed(c,stored)
    val messages=new StoredMessages(db,stored,count)
    (snapshot,RevisionBinding.captured(bindingId,id,revision,snapshot,messages),messages)
  }
  /** The head revision of the claim's live source while the claim's owner target is current. A claim of an older revision
    * keeps its authority: newer revisions do not end a Running job with a valid lease. */
  private def head(c: Connection,claim: Claim): Option[Int] =
    OwnerTargets.eligible(c,claim.owner).filter(target => target.profile==claim.profile && target.epoch==claim.targetEpoch && knownProfiles.contains(claim.profile)).flatMap { _ =>
      // NO KEY UPDATE: serialized with the revision switch and purge, not with the key-share locks an ingest's projection takes.
      Sql.one(c,"SELECT revision FROM ch_sources WHERE id=? AND owner=? AND revision>=? AND NOT tombstone FOR NO KEY UPDATE",claim.sessionId,claim.owner,claim.revision)(_.getInt(1))
    }
  private def current(c: Connection,claim: Claim): Boolean = head(c,claim).nonEmpty
  private val claimedJob="id=? AND session_id=? AND revision=? AND profile=? AND fence=? AND run_id=? AND state='Running'"
  private val validJob=claimedJob+" AND lease_until>clock_timestamp()"
  private def jobArgs(claim: Claim): List[Sql.Param] = List(claim.jobId,claim.sessionId,claim.revision,claim.profile,claim.fence,claim.runId)
  private def lockJob(c: Connection,claim: Claim): Boolean = Sql.one(c,s"SELECT j.id FROM ch_jobs j WHERE $claimedJob FOR UPDATE",jobArgs(claim)*)(_ => true).contains(true)
  private def revisionMatches(c: Connection,claim: Claim): Boolean = {
    if(!claim.revisionBinding.matches(claim)) false else {
      Sql.one(c,"SELECT binding_id FROM ch_revisions WHERE session_id=? AND revision=? FOR SHARE",claim.sessionId,claim.revision) { row =>
        Check(row.getObject("binding_id",classOf[UUID])==claim.revisionBinding.id,"internal","immutable archive revision identity changed")
        true
      }.contains(true)
    }
  }
  private def checkpointAuthority(c: Connection,claim: Claim): Unit = {
    Check(current(c,claim) && lockJob(c,claim) && Sql.one(c,s"SELECT 1 FROM ch_jobs WHERE $validJob",jobArgs(claim)*)(_ => true).contains(true) &&
      revisionMatches(c,claim),"stale-claim","indexing claim is no longer current")
  }
  def reserveAnnotation(claim: Claim,key: CheckpointKey): AnnotationReservation = db.transaction { c =>
    checkpointAuthority(c,claim)
    val attempt=AnnotationAttempts.reserve(c,claim,key)
    checkpointAuthority(c,claim)
    attempt
  }
  def rejectAnnotation(claim: Claim,key: CheckpointKey,attempt: Int,reason: String): Int = db.transaction { c =>
    checkpointAuthority(c,claim)
    val rejected=AnnotationAttempts.reject(c,claim,key,attempt,reason)
    checkpointAuthority(c,claim)
    rejected
  }
  def checkpoint(claim: Claim,key: CheckpointKey): Option[Json] = db.transaction { c =>
    checkpointAuthority(c,claim)
    val value=IndexCheckpoints.read(c,claim,key)
    checkpointAuthority(c,claim)
    value
  }
  def checkpoint(claim: Claim,key: CheckpointKey,value: Json): Unit = db.transaction { c =>
    checkpointAuthority(c,claim)
    IndexCheckpoints.write(c,claim,key,value)
    checkpointAuthority(c,claim)
  }
  def windowWork(claim: Claim,key: CheckpointKey): Option[WindowWork] = db.transaction { c =>
    checkpointAuthority(c,claim)
    val work=IndexCheckpoints.read(c,claim,key).map(WindowWork.Accepted(_)).orElse(IndexCheckpoints.reuse(c,claim,key).map(WindowWork.Reused(_)))
    checkpointAuthority(c,claim)
    work
  }
  def discardCheckpoints(claim: Claim,stage: IndexingStage,window: Int): Int = db.transaction { c =>
    checkpointAuthority(c,claim)
    val discarded=IndexCheckpoints.discard(c,claim,stage,window)
    // The run's staged chunks may hold vectors of the discarded parts: they are written again (spec §5.2.6).
    if(stage==IndexingStage.Embedding) PassageStorage.invalidatePieces(c,claim)
    checkpointAuthority(c,claim)
    discarded
  }
  def progress(claim: Claim,completedWindows: Int,totalWindows: Int): Boolean = {
    Check(completedWindows>=0 && totalWindows>=completedWindows,"invalid","invalid indexing progress")
    db.transaction { c =>
      current(c,claim) && lockJob(c,claim) && Sql.exec(c,s"UPDATE ch_jobs SET completed_windows=?,total_windows=? WHERE $validJob AND completed_windows<=? AND (total_windows IS NULL OR total_windows=?)",(List[Sql.Param](completedWindows,totalWindows)++jobArgs(claim)++List(completedWindows,totalWindows))*)==1
    }
  }
  def defer(claim: Claim,totalWindows: Int): Boolean = {
    Check(totalWindows>=0,"invalid","invalid indexing progress")
    db.transaction { c =>
      head(c,claim).filter(_ => lockJob(c,claim)).exists { head =>
        // A job of an older revision is never queued again: it ends superseded instead.
        if(head>claim.revision) { Sql.exec(c,s"UPDATE ch_jobs SET ${Jobs.superseding},total_windows=? WHERE $validJob",(List[Sql.Param](totalWindows)++jobArgs(claim))*); false }
        else Sql.exec(c,s"UPDATE ch_jobs SET state='Queued',attempts=attempts-1,lease_until=NULL,fence=fence+1,completed_windows=0,total_windows=? WHERE $validJob",(List[Sql.Param](totalWindows)++jobArgs(claim))*)==1
      }
    }
  }
  def renew(claim: Claim,leaseSeconds: Int): Boolean = {
    Check(leaseSeconds>0,"invalid","invalid claim lease")
    db.transaction { c =>
      current(c,claim) && lockJob(c,claim) && Sql.exec(c,s"UPDATE ch_jobs SET lease_until=clock_timestamp()+make_interval(secs=>?) WHERE $validJob",(List[Sql.Param](leaseSeconds)++jobArgs(claim))*)==1
    }
  }
  /** A run's staged generation no longer belongs to it, or its job's claim ended: the publication stops at the batch. */
  private final class StaleStaging extends RuntimeException("stale staged generation",null,false,false)
  /** A transaction of a publication's phase P (ingest-limits spec §5.2.4, §5.2.5): the claim still valid and its run still
    * owning the staged generation, whose row it locks against the sweep (`StagedLock.Write` for a batch that records its
    * resume step, `Share` for the search-row writers). The job row is not locked: a renewal, which locks it, never waits
    * for the search-row writers, which would hold share locks on it one after another; a reclaim does not wait for a
    * batch either, and a stale worker stops at its next one (the switch checks everything again). */
  private def staging[A](claim: Claim,generation: UUID,lock: StagedLock)(f: Connection => A): A = db.transaction { c =>
    // The claim is checked after the staged row's lock is granted: a batch that waited for it while the job was claimed
    // again (whose phase W may have invalidated the staged chunks) stops there (read committed: the check sees the
    // claim's fence and lease as committed by then).
    if(!(Sql.one(c,s"SELECT 1 FROM ch_staged_generations WHERE generation=? AND job_id=? AND run_id=? FOR ${lock.sql}",generation,claim.jobId,claim.runId)(_ => true).contains(true) &&
      Sql.one(c,s"SELECT 1 FROM ch_jobs WHERE $validJob",jobArgs(claim)*)(_ => true).contains(true))) throw new StaleStaging
    f(c)
  }
  private enum StagedLock(val sql: String) { case Write extends StagedLock("NO KEY UPDATE"); case Share extends StagedLock("SHARE") }
  /** Streamed publication (ingest-limits spec §5.2.4): P0 finds the run's staged generation or stages a new one; P1 writes
    * the passages, their spans and Context spans, P2 the chunks and pieces, each in committed batches of at most
    * PassageStorage.rowsPerBatch rows and bytesPerBatch bytes with the step to resume at; P3 the search rows, last, by
    * PassageStorage.searchRowWriters writers; then the switch. Rows are deterministic (`ON CONFLICT DO NOTHING`), so a
    * resumed run rewrites the step it stopped in. False when the claim is no longer current or the job ends superseded. */
  def publishProblems(claim: Claim,rows: ProblemRows): Boolean = try {
    stage(claim,rows.parent) match {
      case None => false
      case Some((staged,abandoned)) =>
        abandoned.foreach(PassageStorage.deleteAbandoned(db,_))
        val written=if(staged.phase==StagedPhase.Passages) writePassages(claim,staged,rows) else staged
        val counts=written.counts.getOrElse(throw DomainError("internal","staged generation without its counts"))
        val pieces=if(written.invalid) rewritePieces(claim,written,counts) else written
        if(pieces.step<counts.steps) writePieces(claim,pieces,counts,rows)
        writeSearchRows(claim,staged.generation,counts.pieces)
        switch(claim,staged.generation,counts.passages,rows.parent)
    }
  } catch { case _: StaleStaging => false }
  /** Whether the claim's publication may continue the source's published generation incrementally (ingest-limits spec
    * §5.6.2, eligibility): `indexing.incrementalPublication`; the published generation is a version of a lineage with a cut
    * under the configured horizon, of the claim's profile and not retired; its revision and the claim's are revisions of
    * one epoch, the claim's holding at least its messages; the claim's run is no confirmed owner rebuild's (which replaces
    * the accepted work: a root), and no explicit rebuild would retire the history at this publication. Checked again at
    * the switch: the parent must still be published. */
  def publicationParent(claim: Claim): Option[PublicationParent] = if(!config.indexing.incrementalPublication) None else db.transaction { c =>
    Sql.one(c,s"""SELECT p.id,p.lineage,p.lineage_version,l.cut FROM ch_sources s JOIN ch_generations p ON p.id=s.published JOIN ch_generation_lineage l ON l.generation=p.id
      JOIN ch_revisions pr ON pr.session_id=s.id AND pr.revision=p.revision JOIN ch_revisions cr ON cr.session_id=s.id AND cr.revision=?
      WHERE s.id=? AND p.lineage IS NOT NULL AND p.lineage_version IS NOT NULL AND l.cut IS NOT NULL AND p.profile=? AND NOT p.retired AND p.passage_format IN ${GenerationRows.formatsSql}
        AND p.revision<=cr.revision AND pr.epoch IS NOT NULL AND pr.epoch=cr.epoch AND pr.message_count<=cr.message_count
        AND NOT EXISTS(SELECT 1 FROM ch_reindex_members m WHERE m.job_id=? AND m.run_id=?)
        AND NOT EXISTS(SELECT 1 FROM ch_reindex_members m JOIN ch_reindex_requests q ON q.owner=m.owner AND q.request_id=m.request_id
          WHERE m.owner=? AND m.session_id=s.id AND m.revision<=cr.revision AND m.target_epoch=? AND q.target_profile=? AND m.retirement_generation IS NULL)""",
      claim.revision,claim.sessionId,claim.profile,claim.jobId,claim.runId,claim.owner,claim.targetEpoch,claim.profile) { r =>
      PublicationParent(r.getObject(1,classOf[UUID]),r.getObject(2,classOf[UUID]),r.getInt(3),ProblemRows.Cut.decode(Sql.json(r,"cut"),claim.sessionId,claim.runId))
    }.filter(_.cut.horizon==config.indexing.metadataHorizonWindows)
  }
  /** P0 under the checkpoint authority; with the job's staged generations of other runs, which it abandons, and the run's
    * own one if it continues another parent than this publication (or is a root where this one continues one, or the
    * reverse). */
  private def stage(claim: Claim,parent: Option[PublicationParent]): Option[(StagedGeneration,List[UUID])] = db.transaction { c =>
    Option.when(current(c,claim) && lockJob(c,claim) && Sql.one(c,s"SELECT 1 FROM ch_jobs WHERE $validJob",jobArgs(claim)*)(_ => true).contains(true) && revisionMatches(c,claim)) {
      PassageStorage.requirePolicy(c,claim.profile,IndexPolicy.ContextAwareProblemsV1)
      val abandoned=PassageStorage.abandonOtherRuns(c,claim)
      val current=PassageStorage.staged(c,claim.jobId,claim.runId)
      val other=current.filter(_.parent!=parent.map(_.generation))
      other.foreach(value => PassageStorage.abandon(c,value.generation))
      (current.filter(_ => other.isEmpty).getOrElse(parent.fold(PassageStorage.stage(c,claim))(PassageStorage.stageIncremental(c,claim,_))),abandoned++other.map(_.generation))
    }
  }
  /** Fills batches of rows of consecutive steps; `flush` commits one with the step a resumed run starts at. */
  private final class Batches[A](bytes: A => Long,flush: (Vector[A],Int) => Unit) {
    private var pending=Vector.empty[A]; private var size=0L
    def add(step: Int,row: A): Unit = {
      pending:+=row; size+=bytes(row)
      if(pending.size>=PassageStorage.rowsPerBatch || size>=PassageStorage.bytesPerBatch) flush(drain(),step)
    }
    def drain(): Vector[A] = { val rows=pending; pending=Vector.empty; size=0; rows }
  }
  private def writePassages(claim: Claim,staged: StagedGeneration,rows: ProblemRows): StagedGeneration = {
    def text(value: String): Long = 2L*value.length
    def bytes(row: ProblemRows.Passages): Long = 64+(row.opened++row.closed).map(p => 256+text(p.initialSummary)+2*text(p.summary)+p.tags.map(text).sum).sum+
      row.spans.map(span => 64+text(span.span.messageId)).sum+row.context.map((_,span) => 64+text(span.messageId)).sum
    def written(next: StagedGeneration,cut: Option[ProblemRows.Cut])(batch: Vector[ProblemRows.Passages]): Unit = staging(claim,staged.generation,StagedLock.Write) { c =>
      PassageStorage.writePassages(c,staged.generation,batch)
      next.counts.foreach(counts => PassageStorage.writeLineage(c,staged.generation,rows.parent.map(_.generation),cut,counts.pieces))
      Check(PassageStorage.resume(c,claim,next),"internal","staged generation resume point not recorded")
    }
    val batches=new Batches[ProblemRows.Passages](bytes,(batch,step) => written(staged.copy(step=step),None)(batch))
    val replayed=rows.passages(staged.step) { (step,value) =>
      value.opened.foreach(p => batches.add(step,ProblemRows.Passages(Vector(p),Vector.empty,Vector.empty,Vector.empty)))
      value.closed.foreach(p => batches.add(step,ProblemRows.Passages(Vector.empty,Vector(p),Vector.empty,Vector.empty)))
      value.spans.foreach(span => batches.add(step,ProblemRows.Passages(Vector.empty,Vector.empty,Vector(span),Vector.empty)))
      value.context.foreach(span => batches.add(step,ProblemRows.Passages(Vector.empty,Vector.empty,Vector.empty,Vector(span))))
    }
    val next=StagedGeneration(staged.generation,StagedPhase.Pieces,0,Some(replayed.counts),lineageTags=staged.lineageTags,parent=staged.parent)
    written(next,replayed.cut)(batches.drain())
    next
  }
  /** Phase W discarded embedding parts the staged chunks may have been written from: every staged chunk (with its search
    * row and piece) and the lineage tag counts of them are deleted in bounded statements, then P2 starts again at step 0. */
  private def rewritePieces(claim: Claim,staged: StagedGeneration,counts: ProblemRows.Counts): StagedGeneration = {
    (0 until counts.pieces by PassageStorage.rowsPerStatement).foreach { from =>
      staging(claim,staged.generation,StagedLock.Write)(c => Sql.exec(c,"DELETE FROM ch_chunks WHERE generation=? AND ordinal>=? AND ordinal<?",staged.generation,from,from+PassageStorage.rowsPerStatement))
    }
    while(staging(claim,staged.generation,StagedLock.Write)(PassageStorage.deleteLineageTagsStep(_,staged.generation))) {}
    val next=staged.copy(step=0,invalid=false)
    staging(claim,staged.generation,StagedLock.Write)(c => Check(PassageStorage.resume(c,claim,next),"internal","staged generation resume point not recorded"))
    next
  }
  private def writePieces(claim: Claim,staged: StagedGeneration,counts: ProblemRows.Counts,rows: ProblemRows): Unit = {
    val stored=new ProblemRows.Stored {
      private var finals=(0,Vector.empty[ProblemRows.Final])
      // A passage's pieces are consecutive: one batch of final passages read at a time.
      def passage(ordinal: Int): ProblemRows.Final = {
        if(ordinal<finals._1 || ordinal>=finals._1+finals._2.size) finals=(ordinal,staging(claim,staged.generation,StagedLock.Share)(c => PassageStorage.finals(c,staged.generation,ordinal,PassageStorage.rowsPerBatch)))
        finals._2.lift(ordinal-finals._1).getOrElse(throw DomainError("internal","staged passage missing"))
      }
      def members(from: Long,until: Long): Vector[ProblemRows.Piece] = {
        val parent=rows.parent.getOrElse(throw DomainError("internal","a root publication has no parent's pieces"))
        staging(claim,staged.generation,StagedLock.Share)(c => PassageStorage.members(c,parent.generation,claim.sessionId,claim.revision,from,until))
      }
    }
    def bytes(piece: ProblemRows.Piece): Long = 256+6L*piece.chunk.text.length+4L*(piece.chunk.summary.length+piece.chunk.tags.map(_.length).sum)+24L*piece.vector.size
    def written(step: Int)(batch: Vector[ProblemRows.Piece]): Unit = staging(claim,staged.generation,StagedLock.Write) { c =>
      Check(batch.forall(_.vector.size==config.embedding.dimensions),"invalid","publication embedding")
      PassageStorage.writePieces(c,staged.generation,batch,rows.parent)
      Check(PassageStorage.resume(c,claim,staged.copy(step=step)),"internal","staged generation resume point not recorded")
    }
    val batches=new Batches[ProblemRows.Piece](bytes,(batch,step) => written(step)(batch))
    rows.pieces(staged.step,stored) { (step,pieces) => pieces.foreach(batches.add(step,_)) }
    written(counts.steps)(batches.drain())
  }
  /** P3: the search rows by ordinal ranges of PostgresArchive.searchRowsPerStatement, each statement committed, by the
    * process's search-row writers. */
  private def writeSearchRows(claim: Claim,generation: UUID,pieces: Int): Unit = {
    // An incremental publication's own chunks start at its first rewritten piece.
    val first=staging(claim,generation,StagedLock.Share)(c => Sql.one(c,"SELECT min(ordinal) FROM ch_chunks WHERE generation=?",generation)(r => Option(r.getObject(1)).map(_ => r.getInt(1))).flatten).getOrElse(pieces)
    val next=new java.util.concurrent.atomic.AtomicInteger(first)
    val stopped=new java.util.concurrent.atomic.AtomicBoolean(false)
    def writer(): Unit = {
      var from=next.getAndAdd(PostgresArchive.searchRowsPerStatement)
      while(from<pieces && !stopped.get) {
        PostgresArchive.searchRowWriters.acquire()
        try staging(claim,generation,StagedLock.Share)(c => PassageStorage.writeSearchRows(c,generation,from,(from+PostgresArchive.searchRowsPerStatement).min(pieces)))
        finally PostgresArchive.searchRowWriters.release()
        from=next.getAndAdd(PostgresArchive.searchRowsPerStatement)
      }
    }
    val writers=PassageStorage.searchRowWriters.min((pieces-first+PostgresArchive.searchRowsPerStatement-1)/PostgresArchive.searchRowsPerStatement)
    if(writers<=1) writer() else {
      val pool=java.util.concurrent.Executors.newFixedThreadPool(writers)
      try {
        val running=List.fill(writers)(pool.submit(new java.util.concurrent.Callable[Unit] { def call(): Unit = try writer() catch { case error: Throwable => stopped.set(true); throw error } }))
        running.foreach { value => try value.get() catch { case failed: java.util.concurrent.ExecutionException => throw failed.getCause } }
      } finally pool.shutdownNow()
    }
  }
  /** The switch, one short transaction (today's tail of the publication): authority, monotonic check (a newer published
    * revision ends the job superseded and leaves its staged generation to the sweep), the passage count, the staged row,
    * the published pointer, the rebuild cohort and the job. The replaced generation's search rows are retired afterwards
    * (`retire`). */
  private def switch(claim: Claim,generation: UUID,passages: Int,parent: Option[PublicationParent]): Boolean = db.transaction { c =>
    val authorized=current(c,claim) && lockJob(c,claim) && Sql.one(c,s"SELECT id FROM ch_jobs WHERE $validJob",jobArgs(claim)*)(_ => true).contains(true) && revisionMatches(c,claim)
    // Publication is monotonic: a job never replaces the published generation of a newer revision; it ends superseded.
    val superseded=authorized && Sql.one(c,"SELECT g.revision>? FROM ch_sources s JOIN ch_generations g ON g.id=s.published WHERE s.id=?",claim.revision,claim.sessionId)(_.getBoolean(1)).contains(true)
    val previous=Sql.one(c,"SELECT published FROM ch_sources WHERE id=?",claim.sessionId)(r => Option(r.getObject(1,classOf[UUID]))).flatten
    if(superseded) { Sql.exec(c,s"UPDATE ch_jobs SET ${Jobs.superseding} WHERE $validJob",jobArgs(claim)*); false }
    // An incremental publication whose parent is no longer published is abandoned: the job's next attempt chooses again.
    else if(authorized && parent.exists(value => !previous.contains(value.generation))) { PassageStorage.abandon(c,generation); false }
    else authorized && {
      // All of the switch or none: its last statement can still find the lease ended.
      val switching=c.setSavepoint()
      val lineageTags=Sql.one(c,"DELETE FROM ch_staged_generations WHERE generation=? AND job_id=? AND run_id=? RETURNING coalesce((resume->>'lineageTags')::boolean,false)",generation,claim.jobId,claim.runId)(_.getBoolean(1))
      val completed=lineageTags.nonEmpty && {
        Sql.exec(c,"UPDATE ch_generations SET passage_count=? WHERE id=?",passages.toLong,generation)
        parent match {
          // The parent's rows stay members; only its superseded ranges' search rows go (ch_search_retirements).
          case Some(value) => PassageStorage.switchIncremental(c,claim.sessionId,generation,value)
          case None =>
            previous.foreach { previous =>
              Sql.exec(c,"INSERT INTO ch_generation_retirements(generation,payload) VALUES(?,false) ON CONFLICT DO NOTHING",previous)
            }
            PassageStorage.switchRoot(c,generation,previous,lineageTags.get)
        }
        Sql.exec(c,"UPDATE ch_sources SET published=? WHERE id=?",generation,claim.sessionId)
        ReindexCohort.published(c,claim,generation)
        Sql.exec(c,s"UPDATE ch_jobs SET state='Complete',error=NULL,failure_stage=NULL,lease_until=NULL WHERE $validJob",jobArgs(claim)*)==1
      }
      if(!completed) c.rollback(switching)
      c.releaseSavepoint(switching)
      completed
    }
  }
  /** Deletes the search rows of the generations a switch of the claim's source replaced (with every generation of a
    * replaced lineage, whose tag rows go too), and the derived rows of those an explicit rebuild retired, and the
    * superseded ranges of search rows, in bounded statements (spec §5.2.4 retirement, §5.6.2 step 4); the maintenance
    * pass completes what a crash leaves. */
  def retire(claim: Claim): Unit = {
    db.transaction(c => PassageStorage.retiringLineages(c,Some(claim.sessionId))).foreach(PassageStorage.retireLineage(db,_))
    db.transaction(c => PassageStorage.retiring(c,Some(claim.sessionId))).foreach(PassageStorage.retire(db,_))
    db.transaction(c => PassageStorage.retiringRanges(c,Some(claim.sessionId))).foreach(PassageStorage.retireRange(db,_,_))
  }
  def fail(claim: Claim,code: String): Unit = failAt(claim,code,None)
  def fail(claim: Claim,code: String,stage: IndexingStage): Unit = failAt(claim,code,Some(stage))
  private def failAt(claim: Claim,code: String,stage: Option[IndexingStage]): Unit = db.transaction { c =>
    val exhausted=AnnotationAttempts.terminal(code) || code==IndexingBudget.exceededCode
    head(c,claim).filter(_ => lockJob(c,claim)).foreach { head =>
      // A job of an older revision is never queued again: where it would be, it ends superseded.
      val superseded=head>claim.revision && Sql.one(c,s"SELECT attempts<${Jobs.attemptLimit} AND NOT ? FROM ch_jobs WHERE $validJob",(List[Sql.Param](exhausted)++jobArgs(claim))*)(_.getBoolean(1)).contains(true)
      if(superseded) Sql.exec(c,s"UPDATE ch_jobs SET ${Jobs.superseding} WHERE $validJob",jobArgs(claim)*)
      else Sql.exec(c,s"UPDATE ch_jobs SET state=CASE WHEN attempts>=${Jobs.attemptLimit} OR ? THEN 'Failed' ELSE 'Queued' END,error=?,failure_stage=NULLIF(?,''),lease_until=NULL,completed_windows=CASE WHEN attempts>=${Jobs.attemptLimit} OR ? THEN completed_windows ELSE 0 END,total_windows=CASE WHEN attempts>=${Jobs.attemptLimit} OR ? THEN total_windows ELSE NULL END WHERE $validJob",(List[Sql.Param](exhausted,code.take(64),stage.fold("")(_.toString),exhausted,exhausted)++jobArgs(claim))*)
    }
  }
  private def chunkSourceBytes(c: Connection,view: ContentView,offset: Int,limit: Int): Long = view.generationId.map(generation => ReadSources.bytes(c,GenerationRows.chunks(generation,offset,limit))).getOrElse(0L)
  private def chunkCount(c: Connection,view: ContentView): Int = view.generationId.map(GenerationRows.pieceCount(c,_)).getOrElse(0)
  private def chunkCountBytes(view: ContentView,total: Int): Long = if(view.generationId.isDefined) JsonUtf8Size(Json.obj("count"->Json.fromInt(total))) else 0L
  private def chunksForView(c: Connection,view: ContentView,offset: Int,limit: Int): ChunksResult = chunksForView(c,view,offset,limit,chunkCount(c,view))
  private def chunksForView(c: Connection,view: ContentView,offset: Int,limit: Int,total: Int): ChunksResult = view.generationId match {
    case None => ChunksResult(Nil,0,offset,view)
    case Some(generation) =>
      val query=GenerationRows.chunks(generation,offset,limit)
      val values=Sql.rows(c,query.sql,query.args*)(r => Wire.decode(Chunk.codecJson,Sql.json(r,"value")))
      ChunksResult(values,total,offset,view)
  }
  def pageChunks(reader: String,id: UUID,offset: Int,limit: Int,selector: Option[ContentView]): ChunksResult = pageChunks(reader,id,offset,limit,selector,ReadMaterialization.unrestricted)
  def pageChunks(reader: String,id: UUID,offset: Int,limit: Int,selector: Option[ContentView],materialization: ReadMaterialization): ChunksResult = reading(materialization) { c =>
    Check.contentPage(offset,limit)
    val view=selectView(c,reader,id,selector,materialization)
    val total=chunkCount(c,view)
    materialization.admit(ReadSources.sum(List(chunkSourceBytes(c,view,offset,limit),chunkCountBytes(view,total))))
    chunksForView(c,view,offset,limit,total)
  }
  def passages(reader: String,id: UUID,offset: Int,limit: Int,selector: Option[ContentView]): PassagesResult = reading { c =>
    Check.contentPage(offset,limit)
    PassageStorage.passages(c,selectView(c,reader,id,selector),offset,limit)
  }
  def passageSpans(reader: String,id: UUID,passageId: UUID,offset: Int,limit: Int,selector: Option[ContentView]): PassageSpansResult = reading { c =>
    Check.contentPage(offset,limit)
    PassageStorage.spans(c,selectView(c,reader,id,selector),passageId,offset,limit)
  }
  def statuses(reader: String,offset: Int,limit: Int): StatusResult = statuses(reader,offset,limit,ReadMaterialization.unrestricted)
  def statuses(reader: String,offset: Int,limit: Int,materialization: ReadMaterialization): StatusResult = reading(materialization) { c =>
    Check.page(offset,limit)
    val from = s"FROM ch_jobs j JOIN ch_sources s ON s.id=j.session_id WHERE $visible"
    val n = Sql.one(c,s"SELECT count(*) $from",reader,reader,reader)(_.getInt(1)).get
    val query=ReadSources.Query(s"SELECT j.id,j.session_id,j.revision,j.state,j.attempts,j.error,j.failure_stage,j.completed_windows,j.total_windows $from ORDER BY j.id LIMIT ? OFFSET ?",List(reader,reader,reader,limit,offset))
    materialization.admit(ReadSources.sum(List(JsonUtf8Size(Json.obj("count"->Json.fromInt(n))),ReadSources.bytes(c,query))))
    val jobs = Sql.rows(c,query.sql,query.args*)(r => JobInfo(r.getObject("id",classOf[UUID]),r.getObject("session_id",classOf[UUID]),r.getInt("revision"),JobState.parse(r.getString("state")).get,r.getInt("attempts"),Option(r.getString("error")),r.getInt("completed_windows"),Option(r.getObject("total_windows",classOf[java.lang.Integer])).map(_.intValue),Option(r.getString("failure_stage")).map(IndexingFailureStage.parse(_).getOrElse(throw DomainError("internal","invalid persisted failure stage")))))
    StatusResult(jobs,n)
  }
  def retry(owner: String,id: UUID): Unit = db.transaction { c =>
    db.profiles.resolve(OwnerTargets.read(c,owner,true).profile)
    Jobs.retry(c,owner,id)
  }
}
