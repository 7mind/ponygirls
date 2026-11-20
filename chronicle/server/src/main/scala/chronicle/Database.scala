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
    * and not in the current format (including one without a format) refuses the start instead of failing the check. */
  private def requireRetiredPassageFormatsMigrated(c: Connection): Unit = {
    val checked=Sql.one(c,"SELECT 1 FROM pg_constraint WHERE conrelid='ch_generations'::regclass AND conname='ch_generations_current_format_check'")(_ => true).nonEmpty
    val remaining= !checked && Sql.one(c,"SELECT 1 FROM ch_generations WHERE NOT retired AND passage_format IS DISTINCT FROM 'ContextAwareProblems' LIMIT 1")(_ => true).nonEmpty
    Check(!remaining,"migration-required","generations that are not retired remain in an old publication format; retire them with the legacy-retirement procedure before starting this release")
  }
  def initialize(): Unit = {
    transaction { c =>
    Sql.exec(c,"SELECT pg_advisory_xact_lock(71393721)")
    List("001.sql","002.sql","003_index_progress.sql","004_collector_progress.sql","005_static_tokens.sql","006_archive_projection.sql","007_owner_profiles.sql","008_problem_passages.sql","009_transient_security_epoch.sql","010_index_checkpoints.sql","011_context_coverage.sql","012_reindex_cohorts.sql","013_revision_bindings.sql","014_renewable_sessions.sql","015_annotation_attempts.sql","020_persistent_sessions.sql").foreach(migrate(c,_))
    requireRetiredModelIdentityMigrated(c)
    migrate(c,"021_model_identity_retired.sql")
    requireRetiredPassageFormatsMigrated(c)
    migrate(c,"022_passage_formats_retired.sql")
    migrate(c,"024_epoch_layout.sql")
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
      migrate(c,"017_head_literal_candidates.sql")
    }
  }
}
object Database {
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
  /** A message page holds the longest prefix of its messages whose stored values fit (at least one message): a page of
    * 100 messages each bounded only by its request would otherwise hold gigabytes. */
  val messagePageBytes: Long = 64L*1024*1024
  /** Messages fetched per round trip while a claimed revision's messages are decoded one at a time. */
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
    * Running one keeps its claim) and the new head's job is queued; returns its id. */
  def switched(c: Connection,id: UUID,next: Int,profile: String): UUID = {
    val job=UUID.randomUUID()
    Sql.exec(c,s"UPDATE ch_jobs j SET ${Jobs.superseding} WHERE j.session_id=? AND j.revision<? AND j.state<>'Complete' AND (${Jobs.leased("j")}) IS NOT TRUE",id,next)
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
      val (retired,current)=Sql.one(c,"SELECT retired,passage_format IS NOT DISTINCT FROM ? FROM ch_generations WHERE id=? AND session_id=? AND revision=?",PassageFormat.ContextAwareProblems.toString,generation,id,view.revision)(r => (r.getBoolean(1),r.getBoolean(2))).getOrElse(throw DomainError("not-found","content view not found"))
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
  /** For the rest of the transaction, epoch rows read in position order come through the primary key's range: the
    * planner expects an epoch it has no statistics for (one written after the last ANALYZE, or outside its most common
    * values) to hold a few rows, and otherwise reads the whole epoch through the (epoch,message_id) key or a bitmap scan
    * and sorts it, on disk for a large session (U4 rehearsal). Without sorts the key's range is the only ordered path. */
  private def keyOrdered(c: Connection,content: RevisionContent): Unit = if(content.isInstanceOf[RevisionContent.Epoch]) {
    Sql.exec(c,"SET LOCAL enable_sort = off")
    Sql.exec(c,"SET LOCAL enable_incremental_sort = off")
  }
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
        // (supersedeEndedLeases ended those whose lease ended).
        def source: Option[(UUID,Int)] = Sql.one(c,s"""SELECT s.id,s.revision FROM ch_sources s WHERE s.owner=? AND NOT s.tombstone AND EXISTS(
          SELECT 1 FROM ch_jobs j WHERE j.session_id=s.id AND j.revision=s.revision AND j.profile=? AND j.attempts<${Jobs.attemptLimit} AND (j.state='Queued' OR (j.state='Running' AND j.lease_until<clock_timestamp())))
          AND NOT EXISTS(SELECT 1 FROM ch_jobs o WHERE o.session_id=s.id AND o.revision<s.revision AND o.profile=? AND o.state='Running')
          AND (? OR NOT EXISTS(SELECT 1 FROM ch_jobs d WHERE d.session_id=s.id AND d.revision=s.revision AND d.profile=? AND d.total_windows>?))
          ORDER BY s.id FOR UPDATE OF s SKIP LOCKED LIMIT 1""",owner,target.profile,target.profile,large==LargeJobs.Admitted,target.profile,LargeJobs.windows)(r => (r.getObject(1,classOf[UUID]),r.getInt(2)))
        val claimable=s"SELECT id FROM ch_jobs WHERE session_id=? AND revision=? AND profile=? AND attempts<${Jobs.attemptLimit} AND (state='Queued' OR (state='Running' AND lease_until<clock_timestamp())) FOR UPDATE SKIP LOCKED LIMIT 1"
        /** A job whose estimated heap exceeds the budget ends Failed before its messages are decoded, without an attempt;
          * the next source is tried. */
        @annotation.tailrec def next(): Option[Claim] = source match {
          case Some((id,revision)) if retainedEstimate(c,id,revision)>BigInt(config.maxIndexingBudgetBytes) =>
            if(Sql.exec(c,s"UPDATE ch_jobs SET state='Failed',error=?,failure_stage=NULL,lease_until=NULL,fence=fence+1 WHERE id=($claimable)",IndexingBudget.exceededCode,id,revision,target.profile)==1) next() else None
          case Some((id,revision)) =>
            Sql.one(c,s"""UPDATE ch_jobs SET state='Running',attempts=attempts+1,fence=fence+1,lease_until=clock_timestamp()+make_interval(secs=>?),completed_windows=0,total_windows=NULL
              WHERE id=($claimable) RETURNING id,fence,run_id""",leaseSeconds,id,revision,target.profile) { row =>
              val (snap,binding)=claimedSnapshot(c,id,revision)
              Claim(row.getObject("id",classOf[UUID]),id,revision,row.getLong("fence"),target.profile,snap,owner,target.epoch,row.getObject("run_id",classOf[UUID]),binding)
            }
          case None => None
        }
        next()
      }
    }.collectFirst { case Some(claim) => claim }
  }
  /** IndexingBudget.estimate of the revision: an epoch revision stores its counts; a legacy revision's are summed from its
    * message rows (bounded by the request bound it was ingested under). */
  private def retainedEstimate(c: Connection,id: UUID,revision: Int): BigInt = {
    val stored=Sql.one(c,"SELECT epoch IS NOT NULL,message_count,message_bytes,fragment_count FROM ch_revisions WHERE session_id=? AND revision=?",id,revision) { r =>
      Option.when(r.getBoolean(1))((r.getLong(2),r.getLong(3),r.getLong(4)))
    }.getOrElse(throw DomainError("stale-claim","archive revision no longer exists"))
    val (messages,bytes,fragments)=stored.getOrElse {
      Sql.one(c,s"SELECT count(*),coalesce(sum(octet_length(value::text)),0),coalesce(sum(ceil(octet_length(value->>'text')::numeric/${EpochWriter.fragmentTextBytes})),0)::bigint FROM ch_messages WHERE session_id=? AND revision=?",id,revision)(r => (r.getLong(1),r.getLong(2),r.getLong(3))).get
    }
    IndexingBudget.estimate(messages,bytes,fragments,config.embedding.dimensions)
  }
  /** The claimed revision for indexing: its messages are decoded one at a time and its raw files are left out (indexing
    * reads only messages and digest). Decoding a large snapshot as one syntax tree held gigabytes for seconds, long
    * enough to be promoted, and drove the collector's longest pauses. */
  private[chronicle] def claimedSnapshot(c: Connection,id: UUID,revision: Int): (IngestRequest,RevisionBinding) = {
    val stored=RevisionContent.resolve(c,id,revision).getOrElse(throw DomainError("stale-claim","archive revision no longer exists"))
    // The claim transaction ends after this stream.
    keyOrdered(c,stored)
    val (snapshot,bindingId)=RevisionContent.claimed(c,stored,PostgresArchive.claimedMessagesPerFetch)
    (snapshot,RevisionBinding.captured(bindingId,id,revision,snapshot))
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
  def discardCheckpoints(claim: Claim,stage: IndexingStage,window: Int): Int = db.transaction { c =>
    checkpointAuthority(c,claim)
    val discarded=IndexCheckpoints.discard(c,claim,stage,window)
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
  def publishProblems(claim: Claim,publication: ProblemsPublication): Boolean =
    publishGeneration(claim,publication.chunks,IndexPolicy.ContextAwareProblemsV1,PassageFormat.ContextAwareProblems,publication.passages.size.toLong,
      _ => { publication.validate(claim,config.embedding.dimensions); true },(c,generation) => PassageStorage.persist(c,generation,publication))
  private def publishGeneration(claim: Claim,chunks: List[IndexedChunk],policy: IndexPolicy,format: PassageFormat,passageCount: Long,validate: Connection => Boolean,persist: (Connection,UUID) => Unit): Boolean = db.transaction { c =>
    // The generation is written before the source and job rows are locked: a large one takes minutes, and those rows are
    // what the job's lease renewal and the source's next revision switch lock. Readers see none of it before the commit.
    if (!Sql.one(c,s"SELECT id FROM ch_jobs WHERE $validJob",jobArgs(claim)*)(_ => true).contains(true)) false else {
      PassageStorage.requirePolicy(c,claim.profile,policy)
      if(!validate(c)) false else {
      val publication=c.setSavepoint()
      val generation = UUID.randomUUID()
      Sql.exec(c,"INSERT INTO ch_generations(id,session_id,revision,profile,passage_format,passage_count,run_id) VALUES(?,?,?,?,?,?,?)",generation,claim.sessionId,claim.revision,claim.profile,format.toString,passageCount,claim.runId)
      chunks.zipWithIndex.foreach { case (x,ordinal) => Sql.exec(c,"INSERT INTO ch_chunks(id,generation,value,document,embedding,ordinal) VALUES(?,?,?::jsonb,to_tsvector('english',?),?::vector,?)",x.chunk.id,generation,Wire.encode(Chunk.codecJson,x.chunk).noSpaces,s"${x.chunk.text} ${x.chunk.summary} ${x.chunk.tags.mkString(" ")}",x.vector.mkString("[",",","]"),ordinal) }
      persist(c,generation)
      chunks.flatMap(_.chunk.tags).distinct.foreach(tag => Sql.exec(c,"INSERT INTO ch_generation_tags(generation,tag) VALUES(?,?) ON CONFLICT DO NOTHING",generation,tag))
      // Each search row costs its vector-index insertion: bounded statements instead of one that grows with the job.
      chunks.indices.by(PostgresArchive.searchRowsPerStatement).foreach { from =>
        Sql.exec(c,"INSERT INTO ch_search_chunks(id,generation,session_id,revision,profile,document,embedding) SELECT ch.id,ch.generation,g.session_id,g.revision,g.profile,ch.document,ch.embedding FROM ch_chunks ch JOIN ch_generations g ON g.id=ch.generation WHERE g.id=? AND ch.ordinal>=? AND ch.ordinal<?",generation,from,from+PostgresArchive.searchRowsPerStatement)
      }
      val authorized=current(c,claim) && lockJob(c,claim) && Sql.one(c,s"SELECT id FROM ch_jobs WHERE $validJob",jobArgs(claim)*)(_ => true).contains(true) && revisionMatches(c,claim)
      // Publication is monotonic: a job never replaces the published generation of a newer revision; it ends superseded.
      val superseded=authorized && Sql.one(c,"SELECT g.revision>? FROM ch_sources s JOIN ch_generations g ON g.id=s.published WHERE s.id=?",claim.revision,claim.sessionId)(_.getBoolean(1)).contains(true)
      val completed=authorized && !superseded && {
        Sql.exec(c,"DELETE FROM ch_search_chunks WHERE session_id=? AND generation<>?",claim.sessionId,generation)
        Sql.exec(c,"UPDATE ch_sources SET published=? WHERE id=?",generation,claim.sessionId)
        ReindexCohort.published(c,claim,generation)
        Sql.exec(c,s"UPDATE ch_jobs SET state='Complete',error=NULL,failure_stage=NULL,lease_until=NULL WHERE $validJob",jobArgs(claim)*)==1
      }
      if(!completed) c.rollback(publication)
      c.releaseSavepoint(publication)
      // The rollback released the savepoint's locks: they are taken again, in the same order, to end the job.
      if(superseded && current(c,claim) && lockJob(c,claim)) Sql.exec(c,s"UPDATE ch_jobs SET ${Jobs.superseding} WHERE $validJob",jobArgs(claim)*)
      completed
      }
    }
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
  private def chunksQuery(generation: UUID,offset: Int,limit: Int): ReadSources.Query = ReadSources.Query("SELECT value FROM ch_chunks WHERE generation=? ORDER BY ordinal,id LIMIT ? OFFSET ?",List(generation,limit,offset))
  private def chunkSourceBytes(c: Connection,view: ContentView,offset: Int,limit: Int): Long = view.generationId.map(generation => ReadSources.bytes(c,chunksQuery(generation,offset,limit))).getOrElse(0L)
  private def chunkCount(c: Connection,view: ContentView): Int = view.generationId.map(generation => Sql.one(c,"SELECT count(*) FROM ch_chunks WHERE generation=?",generation)(_.getInt(1)).get).getOrElse(0)
  private def chunkCountBytes(view: ContentView,total: Int): Long = if(view.generationId.isDefined) JsonUtf8Size(Json.obj("count"->Json.fromInt(total))) else 0L
  private def chunksForView(c: Connection,view: ContentView,offset: Int,limit: Int): ChunksResult = chunksForView(c,view,offset,limit,chunkCount(c,view))
  private def chunksForView(c: Connection,view: ContentView,offset: Int,limit: Int,total: Int): ChunksResult = view.generationId match {
    case None => ChunksResult(Nil,0,offset,view)
    case Some(generation) =>
      val query=chunksQuery(generation,offset,limit)
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
