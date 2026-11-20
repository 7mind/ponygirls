package ponygirls.retrieval.postgres

import ponygirls.retrieval.*
import io.circe.Json
import java.nio.charset.StandardCharsets.UTF_8
import java.sql.{Connection,PreparedStatement,ResultSet}
import java.time.{Instant,OffsetDateTime,ZoneOffset}
import java.time.temporal.ChronoUnit
import java.util.{Base64,UUID}
import scala.concurrent.duration.*
import scala.util.Using

private[postgres] object Jdbc {
  type Value = String | Int | Long | Boolean | Array[Byte] | BigDecimal | Instant
  def bind(p: PreparedStatement,args: Seq[Value]): Unit = args.zipWithIndex.foreach { (value,i) => value match {
    case x: String => p.setString(i+1,x)
    case x: Int => p.setInt(i+1,x)
    case x: Long => p.setLong(i+1,x)
    case x: Boolean => p.setBoolean(i+1,x)
    case x: Array[Byte] => p.setBytes(i+1,x)
    case x: BigDecimal => p.setBigDecimal(i+1,x.bigDecimal)
    case x: Instant => p.setObject(i+1,OffsetDateTime.ofInstant(x,ZoneOffset.UTC))
  } }
  def exec(c: Connection,sql: String,args: Value*): Int = Using.resource(c.prepareStatement(sql)) { p => bind(p,args); if(sql.startsWith("SELECT") || sql.startsWith("SET")) { p.execute(); 0 } else p.executeUpdate() }
  def rows[A](c: Connection,sql: String,args: Value*)(read: ResultSet => A): List[A] = Using.resource(c.prepareStatement(sql)) { p => bind(p,args); Using.resource(p.executeQuery()) { r => val out=List.newBuilder[A]; while(r.next()) out+=read(r); out.result() } }
  def one[A](c: Connection,sql: String,args: Value*)(read: ResultSet => A): Option[A] = rows(c,sql,args*)(read).headOption
  def key(value: String): String = Base64.getUrlEncoder.withoutPadding.encodeToString(bytes(value))
  def unkey(value: String): String = new String(Base64.getUrlDecoder.decode(value),UTF_8)
  def bytes(value: String): Array[Byte] = { RetrievalChecks(UTF_8.newEncoder().canEncode(value),"invalid","invalid Unicode retrieval value"); value.getBytes(UTF_8) }
}
private[postgres] final case class RetrievalPlan(sql: String,args: List[Jdbc.Value])
final case class WorkClaim(jobId: String,sourceId: String,version: String,epoch: Long,fence: Long,run: String,profile: String,chunks: List[InputChunk],attempt: Int)

object PostgresRetrieval {
  val MaxFilters = 64
  /** A failed attempt n is retried no earlier than min(RetryBase*2^(n-1), RetryCap) later; no attempt count is terminal. */
  val RetryBase: FiniteDuration = 2.seconds
  val RetryCap: FiniteDuration = 5.minutes
  private val retryDoublings = Iterator.iterate(RetryBase)(_*2).indexWhere(_>=RetryCap)
  def retryDelay(attempt: Int): FiniteDuration = {
    RetrievalChecks(attempt>=1,"invalid","retry attempt must be positive")
    if(attempt-1>=retryDoublings) RetryCap else RetryBase*(1L<<(attempt-1))
  }
}

/** All operations run on the caller's Connection: projection/outbox/publication can
  * participate atomically in authoritative app mutations. Never opens/commits a tx.
  * Callers must synchronize EVERY visibility/archive/delete mutation using put/remove
  * in that same transaction. Principal authentication/revocation is app-owned; this
  * is not a cache of a previously computed allowed-ID list.
  */
final class PostgresRetrieval(val namespace: String,val profile: Option[RetrievalProfile],private[postgres] val candidatesPerLeg: Int,private[postgres] val exactScanChunks: Int) {
  import Jdbc.*
  def this(namespace: String,profile: Option[RetrievalProfile]) = this(namespace,profile,CandidatePolicy.candidatesPerLeg,CandidatePolicy.exactScanChunks)
  RetrievalChecks(candidatesPerLeg>0,"config","candidate window must be positive")
  RetrievalChecks(exactScanChunks>=0,"config","exact-scan threshold must not be negative")
  private def rankingLimit(mode: RetrievalMode): Int = if(mode==RetrievalMode.Hybrid) candidatesPerLeg*2 else candidatesPerLeg
  RetrievalChecks.text(namespace,128)
  profile.foreach(_.validate())
  private val ns=key(namespace)
  private def transaction(c: Connection): Unit = RetrievalChecks(!c.getAutoCommit,"config","retrieval requires caller transaction")
  def initialize(c: Connection): Unit = {
    transaction(c)
    exec(c,"SELECT pg_advisory_xact_lock(71393722)")
    exec(c,"CREATE EXTENSION IF NOT EXISTS vector")
    exec(c,"CREATE TABLE IF NOT EXISTS pony_retrieval_migrations(version integer PRIMARY KEY,digest text NOT NULL)")
    Schema.migrations.foreach { (version,ddl) =>
      val digest=RetrievalChecks.hash(ddl)
      one(c,"SELECT digest FROM pony_retrieval_migrations WHERE version=?",version)(_.getString(1)) match {
        case Some(value) => RetrievalChecks(value==digest,"config","retrieval migration checksum mismatch")
        case None => Using.resource(c.createStatement())(_.execute(ddl)); exec(c,"INSERT INTO pony_retrieval_migrations VALUES(?,?)",version,digest)
      }
    }
    profile.foreach { p =>
      exec(c,"INSERT INTO pony_retrieval_profiles(namespace,id,space,descriptor,policy) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING",ns,p.id,p.space.id,p.space.json.noSpaces,bytes(p.policy))
      RetrievalChecks(one(c,"SELECT space=? AND descriptor=? AND policy=? FROM pony_retrieval_profiles WHERE namespace=? AND id=?",p.space.id,p.space.json.noSpaces,bytes(p.policy),ns,p.id)(_.getBoolean(1)).contains(true),"config","immutable retrieval profile mismatch")
      val d=p.space.dimensions
      exec(c,s"CREATE INDEX IF NOT EXISTS pony_retrieval_hnsw_d$d ON pony_retrieval_chunks USING hnsw ((l2_normalize(embedding)::halfvec($d)) halfvec_cosine_ops) WHERE vector_dims(embedding)=$d")
    }
  }
  private def provenance(p: ChunkProvenance): String = Json.arr(Json.fromString(p.field),p.pointer.fold(Json.Null)(Json.fromString),p.start.fold(Json.Null)(Json.fromInt),p.end.fold(Json.Null)(Json.fromInt)).noSpaces
  private def readChunk(r: ResultSet): InputChunk = {
    val p=io.circe.parser.parse(new String(r.getBytes("provenance"),UTF_8)).toOption.get.asArray.get
    InputChunk(unkey(r.getString("chunk_id")),new String(r.getBytes("body"),UTF_8),ChunkProvenance(p(0).asString.get,p(1).asString,p(2).asNumber.flatMap(_.toInt),p(3).asNumber.flatMap(_.toInt)))
  }
  private def inputDigest(chunks: List[InputChunk]): String = RetrievalChecks.hash(Json.arr(chunks.map(ch => Json.arr(Json.fromString(ch.id),Json.fromString(ch.text),Json.fromString(provenance(ch.provenance))))*).noSpaces)
  private def heads(c: Connection,id: String): List[InputChunk] = rows(c,"SELECT chunk_id,body,provenance FROM pony_retrieval_head_chunks WHERE namespace=? AND source_id=? ORDER BY ordinal",ns,id)(readChunk)
  def put(c: Connection,source: SourceProjection): Unit = {
    transaction(c)
    RetrievalChecks(source.id.nonEmpty && source.version.nonEmpty && source.chunks.size<=100000 && source.chunks.map(_.id).distinct.size==source.chunks.size,"invalid","invalid source projection")
    RetrievalChecks(source.attributes.map(_.key).distinct.size==source.attributes.size,"invalid","duplicate projection attribute")
    val id=key(source.id); val version=key(source.version); val digest=inputDigest(source.chunks); val target=profile.fold("")(_.id)
    exec(c,"INSERT INTO pony_retrieval_sources(namespace,id,version,input_digest,target_profile,head_generation) VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING",ns,id,version,digest,target,UUID.randomUUID().toString)
    val old=one(c,"SELECT version,input_digest,target_profile,epoch,head_generation FROM pony_retrieval_sources WHERE namespace=? AND id=? FOR UPDATE",ns,id)(r => (r.getString(1),r.getString(2),r.getString(3),r.getLong(4),r.getString(5))).get
    RetrievalChecks(old._1!=version || old._2==digest,"conflict","source version reused with different retrieval content")
    val changed=old._1!=version || old._2!=digest || old._3!=target || old._4==0L || old._5.isEmpty
    exec(c,"UPDATE pony_retrieval_sources SET eligible=?,archived=?,expires_at=NULLIF(?,'')::numeric WHERE namespace=? AND id=?",source.eligible,source.archived,source.expiresAt.fold("")(_.value.bigDecimal.toPlainString),ns,id)
    exec(c,"DELETE FROM pony_retrieval_attributes WHERE namespace=? AND source_id=?",ns,id)
    source.attributes.foreach(a => exec(c,"INSERT INTO pony_retrieval_attributes VALUES(?,?,?,?)",ns,id,a.key.value,bytes(a.value.value)))
    exec(c,"DELETE FROM pony_retrieval_audience WHERE namespace=? AND source_id=?",ns,id)
    source.audience.foreach(p => exec(c,"INSERT INTO pony_retrieval_audience VALUES(?,?,?)",ns,id,key(p)))
    if(changed) {
      val epoch=old._4+1
      exec(c,"UPDATE pony_retrieval_sources SET version=?,input_digest=?,target_profile=?,epoch=?,head_generation=? WHERE namespace=? AND id=?",version,digest,target,epoch,UUID.randomUUID().toString,ns,id)
      exec(c,"UPDATE pony_retrieval_jobs SET state='Superseded',fence=fence+1 WHERE namespace=? AND source_id=? AND state<>'Complete'",ns,id)
      exec(c,"DELETE FROM pony_retrieval_head_chunks WHERE namespace=? AND source_id=?",ns,id)
      source.chunks.zipWithIndex.foreach { (ch,i) =>
        // NUL remains byte-for-byte in body; it is a token separator only in the FTS projection.
        exec(c,"INSERT INTO pony_retrieval_head_chunks VALUES(?,?,?,?,?,?,to_tsvector('english',?))",ns,id,i,key(ch.id),bytes(ch.text),bytes(provenance(ch.provenance)),ch.text.replace('\u0000',' '))
      }
      profile.foreach(p => exec(c,"INSERT INTO pony_retrieval_jobs(namespace,id,source_id,epoch,profile,run_id) VALUES(?,?,?,?,?,?)",ns,UUID.randomUUID().toString,id,epoch,p.id,UUID.randomUUID().toString))
    }
  }
  def remove(c: Connection,id: String): Unit = {
    transaction(c)
    one(c,"SELECT id FROM pony_retrieval_sources WHERE namespace=? AND id=? FOR UPDATE",ns,key(id))(_.getString(1)).foreach { encoded =>
      exec(c,"UPDATE pony_retrieval_jobs SET state='Superseded',fence=fence+1 WHERE namespace=? AND source_id=?",ns,encoded)
      exec(c,"UPDATE pony_retrieval_sources SET eligible=false,epoch=epoch+1,published=NULL,head_generation='' WHERE namespace=? AND id=?",ns,encoded)
      exec(c,"DELETE FROM pony_retrieval_audience WHERE namespace=? AND source_id=?",ns,encoded)
      exec(c,"DELETE FROM pony_retrieval_chunks WHERE namespace=? AND source_id=?",ns,encoded)
      // A later explicit same-version restore must rebuild, not resurrect a stranded job.
      exec(c,"DELETE FROM pony_retrieval_head_chunks WHERE namespace=? AND source_id=?",ns,encoded)
    }
  }
  /** `now` (caller's retry clock) decides back-off and expiry; leases use the database clock.
    * Due: Queued past its back-off, or Running past its lease (an expired lease is its own back-off). */
  def claim(c: Connection,leaseSeconds: Int,now: Instant): Option[WorkClaim] = {
    transaction(c); RetrievalChecks(leaseSeconds>0 && leaseSeconds<=86400,"invalid","invalid retrieval lease")
    profile.flatMap { p =>
      val due="((j.state='Queued' AND (j.not_before IS NULL OR j.not_before<=?)) OR (j.state='Running' AND j.lease_until<clock_timestamp()))"
      // Lock source before jobs, matching put/remove/publication lock order.
      val source=one(c,s"""SELECT s.id FROM pony_retrieval_sources s WHERE s.namespace=? AND s.target_profile=? AND s.eligible AND (s.expires_at IS NULL OR s.expires_at>?) AND EXISTS(
        SELECT 1 FROM pony_retrieval_jobs j WHERE j.namespace=s.namespace AND j.source_id=s.id AND j.epoch=s.epoch AND j.profile=s.target_profile AND $due) ORDER BY s.id FOR UPDATE OF s SKIP LOCKED LIMIT 1""",ns,p.id,EpochSeconds.fromInstant(now).value,now)(_.getString(1))
      source.flatMap { id => one(c,s"""UPDATE pony_retrieval_jobs SET state='Running',attempts=attempts+1,fence=fence+1,not_before=NULL,lease_until=clock_timestamp()+make_interval(secs=>?) WHERE namespace=? AND id=(
        SELECT j.id FROM pony_retrieval_jobs j JOIN pony_retrieval_sources s ON s.namespace=j.namespace AND s.id=j.source_id WHERE j.namespace=? AND j.source_id=? AND j.epoch=s.epoch AND j.profile=s.target_profile AND $due FOR UPDATE OF j SKIP LOCKED LIMIT 1) RETURNING id,epoch,fence,run_id,profile,attempts""",leaseSeconds,ns,ns,id,now) { r =>
          val version=one(c,"SELECT version FROM pony_retrieval_sources WHERE namespace=? AND id=?",ns,id)(_.getString(1)).get
          WorkClaim(r.getString("id"),unkey(id),unkey(version),r.getLong("epoch"),r.getLong("fence"),r.getString("run_id"),r.getString("profile"),heads(c,id),r.getInt("attempts"))
        } }
    }
  }
  private def current(c: Connection,claim: WorkClaim): Boolean = {
    transaction(c)
    val source=one(c,"SELECT epoch,target_profile,eligible,version,input_digest FROM pony_retrieval_sources WHERE namespace=? AND id=? AND (expires_at IS NULL OR expires_at>?) FOR UPDATE",ns,key(claim.sourceId),EpochSeconds.fromInstant(java.time.Instant.now()).value)(r => r.getLong(1)==claim.epoch && r.getString(2)==claim.profile && r.getBoolean(3) && r.getString(4)==key(claim.version) && r.getString(5)==inputDigest(claim.chunks)).contains(true)
    source && one(c,"SELECT 1 FROM pony_retrieval_jobs WHERE namespace=? AND id=? AND epoch=? AND profile=? AND fence=? AND run_id=? AND state='Running' AND lease_until>clock_timestamp() FOR UPDATE",ns,claim.jobId,claim.epoch,claim.profile,claim.fence,claim.run)(_ => true).contains(true)
  }
  private def requireCurrent(c: Connection,claim: WorkClaim): Unit = RetrievalChecks(current(c,claim),"stale-claim","retrieval claim no longer current")
  def renew(c: Connection,claim: WorkClaim,leaseSeconds: Int): Unit = {
    requireCurrent(c,claim); RetrievalChecks(leaseSeconds>0 && leaseSeconds<=86400,"invalid","invalid retrieval lease")
    exec(c,"UPDATE pony_retrieval_jobs SET lease_until=clock_timestamp()+make_interval(secs=>?) WHERE namespace=? AND id=?",leaseSeconds,ns,claim.jobId)
  }
  /** Accepted results are immutable and survive lease reclamation; no exactly-once provider-call claim. */
  def accepted(c: Connection,claim: WorkClaim,firstOrdinal: Int,count: Int): Option[List[List[Double]]] = {
    requireCurrent(c,claim)
    RetrievalChecks(firstOrdinal>=0 && count>0 && firstOrdinal.toLong+count<=claim.chunks.size,"invalid","invalid accepted batch range")
    val result=rows(c,"SELECT ordinal,embedding::text FROM pony_retrieval_accepted WHERE namespace=? AND job_id=? AND ordinal>=? AND ordinal<? ORDER BY ordinal",ns,claim.jobId,firstOrdinal,firstOrdinal+count)(r => r.getInt(1)->io.circe.parser.parse(r.getString(2)).toOption.get.as[List[Double]].toOption.get)
    if(result.size==count) Some(result.map(_._2)) else None
  }
  def accept(c: Connection,claim: WorkClaim,firstOrdinal: Int,vectors: List[List[Double]]): Unit = {
    requireCurrent(c,claim)
    val p=profile.filter(_.id==claim.profile).getOrElse(throw RetrievalError("unavailable","retrieval profile not executable"))
    RetrievalChecks(firstOrdinal>=0 && vectors.nonEmpty && firstOrdinal.toLong+vectors.size<=claim.chunks.size,"invalid","invalid accepted batch range")
    vectors.zipWithIndex.foreach { (vector,i) =>
      val rendered=Vectors.sql(vector,p.space.dimensions)
      val hash=RetrievalChecks.hash(Json.arr(vector.map(Json.fromDoubleOrNull)*).noSpaces)
      exec(c,"INSERT INTO pony_retrieval_accepted VALUES(?,?,?,?,?::vector) ON CONFLICT DO NOTHING",ns,claim.jobId,firstOrdinal+i,hash,rendered)
      RetrievalChecks(one(c,"SELECT digest=? FROM pony_retrieval_accepted WHERE namespace=? AND job_id=? AND ordinal=?",hash,ns,claim.jobId,firstOrdinal+i)(_.getBoolean(1)).contains(true),"conflict","accepted embedding batch changed")
    }
  }
  def publish(c: Connection,claim: WorkClaim): String = {
    transaction(c)
    val completed=one(c,"""SELECT s.published FROM pony_retrieval_sources s JOIN pony_retrieval_jobs j ON j.namespace=s.namespace AND j.source_id=s.id
      WHERE s.namespace=? AND s.id=? AND s.epoch=? AND s.version=? AND s.input_digest=? AND s.target_profile=? AND s.eligible
      AND j.id=? AND j.fence=? AND j.run_id=? AND j.state='Complete'""",ns,key(claim.sourceId),claim.epoch,key(claim.version),inputDigest(claim.chunks),claim.profile,claim.jobId,claim.fence,claim.run)(_.getString(1))
    completed.getOrElse {
      requireCurrent(c,claim)
      val p=profile.filter(_.id==claim.profile).getOrElse(throw RetrievalError("unavailable","retrieval profile not executable"))
      RetrievalChecks(one(c,"SELECT count(*) FROM pony_retrieval_accepted WHERE namespace=? AND job_id=?",ns,claim.jobId)(_.getInt(1)).contains(claim.chunks.size),"incomplete-generation","cannot publish partial retrieval generation")
      val savepoint=c.setSavepoint()
      try {
        val generation=UUID.randomUUID().toString; val id=key(claim.sourceId)
        exec(c,"INSERT INTO pony_retrieval_generations VALUES(?,?,?,?,?,?,?)",ns,generation,id,key(claim.version),p.id,p.space.id,bytes(p.policy))
        exec(c,"DELETE FROM pony_retrieval_chunks WHERE namespace=? AND source_id=?",ns,id)
        exec(c,"""INSERT INTO pony_retrieval_chunks(namespace,generation,source_id,id,chunk_id,ordinal,body,provenance,document,embedding,profile)
          SELECT h.namespace,?,h.source_id,h.source_id||':'||h.chunk_id,h.chunk_id,h.ordinal,h.body,h.provenance,h.document,a.embedding,?
          FROM pony_retrieval_head_chunks h JOIN pony_retrieval_accepted a ON a.namespace=h.namespace AND a.job_id=? AND a.ordinal=h.ordinal WHERE h.namespace=? AND h.source_id=?""",generation,p.id,claim.jobId,ns,id)
        // Recheck deadline after potentially large insert. Roll back even if caller catches the error.
        RetrievalChecks(current(c,claim),"stale-claim","retrieval claim expired during publication")
        exec(c,"UPDATE pony_retrieval_sources SET published=? WHERE namespace=? AND id=?",generation,ns,id)
        exec(c,"UPDATE pony_retrieval_jobs SET state='Complete',lease_until=NULL WHERE namespace=? AND id=?",ns,claim.jobId)
        c.releaseSavepoint(savepoint)
        generation
      } catch {
        case scala.util.control.NonFatal(error) => c.rollback(savepoint); c.releaseSavepoint(savepoint); throw error
      }
    }
  }
  /** Requeues a current claim with back-off from `now` and returns its earliest retry time;
    * None when the claim is no longer current (superseded, removed or its lease lost). */
  def fail(c: Connection,claim: WorkClaim,now: Instant): Option[Instant] = Option.when(current(c,claim)) {
    val retryAt=now.plusNanos(PostgresRetrieval.retryDelay(claim.attempt).toNanos).truncatedTo(ChronoUnit.MICROS)
    exec(c,"UPDATE pony_retrieval_jobs SET state='Queued',lease_until=NULL,not_before=? WHERE namespace=? AND id=?",retryAt,ns,claim.jobId)
    retryAt
  }
  private def authorization(query: RetrievalQuery): (String,List[Value]) = {
    val attributes=query.filters.map {
      case AttributeFilter.Equal(_,_) => " AND EXISTS(SELECT 1 FROM pony_retrieval_attributes f WHERE f.namespace=s.namespace AND f.source_id=s.id AND f.key=? AND f.value=?)"
    }.mkString
    val arguments=query.filters.toList.flatMap { case AttributeFilter.Equal(k,v) => List[Value](k.value,bytes(v.value)) }
    ("s.namespace=? AND s.eligible AND (? OR NOT s.archived) AND (s.expires_at IS NULL OR s.expires_at>?) AND EXISTS(SELECT 1 FROM pony_retrieval_audience acl WHERE acl.namespace=s.namespace AND acl.source_id=s.id AND acl.principal=?)"+attributes,List[Value](ns,query.includeArchived,query.now.value,key(query.principal))++arguments)
  }
  /** Decided per query from the data, not from configuration: a count bounded at the threshold + 1. */
  private def exactScan(c: Connection): Boolean =
    one(c,"SELECT count(*) FROM (SELECT 1 FROM pony_retrieval_chunks WHERE namespace=? LIMIT ?) bounded",ns,exactScanChunks.toLong+1)(_.getLong(1)).exists(_<=exactScanChunks)
  private[postgres] def plan(c: Connection,query: RetrievalQuery,vector: Option[List[Double]]): RetrievalPlan = {
    transaction(c)
    RetrievalChecks(query.principal.nonEmpty && query.text.length<=2048 && query.offset>=0 && query.limit>=1 && query.filters.size<=PostgresRetrieval.MaxFilters,"invalid","invalid retrieval query")
    val semantic=query.mode!=RetrievalMode.Lexical
    RetrievalChecks(!semantic || query.offset<rankingLimit(query.mode),"invalid","offset exceeds candidate ranking window")
    val (scope,scopeArgs)=authorization(query)
    val (sql,args,pending)=if(!semantic) {
      val matches=if(query.text.nonEmpty) " AND ch.document @@ websearch_to_tsquery('english',?)" else ""
      val fields="ch.source_id||':'||ch.chunk_id AS id,ch.chunk_id,ch.source_id,s.version,s.head_generation AS generation,NULL::text AS profile,NULL::text AS space,ch.body,ch.provenance"
      (s"WITH scored AS(SELECT $fields,ts_rank_cd(ch.document,websearch_to_tsquery('english',?)) AS score FROM pony_retrieval_head_chunks ch JOIN pony_retrieval_sources s ON s.namespace=ch.namespace AND s.id=ch.source_id WHERE $scope$matches),sessions AS(SELECT DISTINCT ON(source_id) * FROM scored ORDER BY source_id,score DESC,id)",List[Value](query.text)++scopeArgs++(if(query.text.nonEmpty) List[Value](query.text) else Nil),
        RetrievalPlan("SELECT 0::bigint AS n",Nil))
    } else {
      val p=profile.getOrElse(throw RetrievalError.unavailable(UnavailableReason.NotConfigured))
      val v=Vectors.sql(vector.getOrElse(throw RetrievalError.unavailable(UnavailableReason.EmbeddingFailed)),p.space.dimensions)
      // Declared partial readiness: in-scope sources whose current head has no publication under the active profile.
      val pending=RetrievalPlan(s"SELECT count(*) AS n FROM pony_retrieval_sources s WHERE $scope AND NOT EXISTS(SELECT 1 FROM pony_retrieval_generations g WHERE g.namespace=s.namespace AND g.id=s.published AND g.version=s.version AND g.profile=?)",scopeArgs:+p.id)
      val exact=exactScan(c)
      if(!exact) CandidateSql.configureStatements.foreach(exec(c,_))
      val fields="ch.id,ch.chunk_id,ch.source_id,g.version,ch.generation,ch.profile,g.space,ch.body,ch.provenance,ch.document,ch.embedding"
      // OFFSET 0 keeps live visibility/filter checks inside the ordered index scan before LIMIT.
      val authorized=s"(SELECT true FROM pony_retrieval_sources s WHERE s.namespace=ch.namespace AND s.id=ch.source_id AND s.published=ch.generation AND $scope OFFSET 0)"
      val base=s"ch.namespace=? AND vector_dims(ch.embedding)=${p.space.dimensions} AND ch.profile=? AND $authorized"
      val baseArgs=List[Value](ns,p.id)++scopeArgs
      // The window keeps each authorized source's best chunk. The exact scan orders every chunk by the reranking distance,
      // which no index serves, over the authorization join: the window is the nearest sources. The HNSW scan keeps the
      // distinct sources among its first candidatesPerLeg*annChunksPerCandidate chunks; sources with more near chunks than
      // that can still fill the read.
      val (scan,scanArgs)=if(exact)
        (s"SELECT ch.id,ch.source_id,ch.embedding <=> ?::vector AS distance FROM pony_retrieval_chunks ch JOIN pony_retrieval_sources s ON s.namespace=ch.namespace AND s.id=ch.source_id AND s.published=ch.generation WHERE ch.namespace=? AND ch.profile=? AND $scope",List[Value](v,ns,p.id)++scopeArgs)
      else
        (s"SELECT ch.id,ch.source_id,${CandidateSql.annDistance(p.space.dimensions,"ch.embedding")} AS distance FROM pony_retrieval_chunks ch WHERE $base ORDER BY distance LIMIT ${candidatesPerLeg.toLong*CandidatePolicy.annChunksPerCandidate}",v::baseArgs)
      val ann=s"ann_scan AS MATERIALIZED($scan),ann_best AS(SELECT DISTINCT ON(source_id) id,source_id,distance FROM ann_scan ORDER BY source_id,distance,id),ann AS MATERIALIZED(SELECT $fields FROM (SELECT id FROM ann_best ORDER BY distance,source_id LIMIT $candidatesPerLeg) w JOIN pony_retrieval_chunks ch ON ch.namespace=? AND ch.id=w.id JOIN pony_retrieval_generations g ON g.namespace=ch.namespace AND g.id=ch.generation)"
      val (legs,legArgs)=if(query.mode==RetrievalMode.Hybrid && query.text.nonEmpty) {
        (s",lexical AS MATERIALIZED(SELECT $fields FROM pony_retrieval_chunks ch JOIN pony_retrieval_generations g ON g.namespace=ch.namespace AND g.id=ch.generation WHERE $base AND ch.document @@ websearch_to_tsquery('english',?) ORDER BY ts_rank_cd(ch.document,websearch_to_tsquery('english',?)) DESC,ch.id LIMIT $candidatesPerLeg),candidates AS(SELECT * FROM ann UNION SELECT * FROM lexical)",baseArgs++List[Value](query.text,query.text))
      } else (",candidates AS(SELECT * FROM ann)",Nil)
      (s"WITH $ann$legs,"+CandidateSql.rerankCtes(query.mode,"source_id"),scanArgs++List[Value](ns)++legArgs++List[Value](query.text,query.text,v),pending)
    }
    // One statement: the pending count shares the snapshot of the ranked page.
    val page=sql+s",result_entities AS MATERIALIZED(SELECT * FROM sessions),pending AS(${pending.sql}) SELECT counted.total,pending.n AS pending,page.* FROM pending,(SELECT count(*) AS total FROM result_entities) counted LEFT JOIN LATERAL(SELECT * FROM result_entities ORDER BY score DESC,source_id LIMIT ? OFFSET ?) page ON true ORDER BY page.score DESC,page.source_id"
    RetrievalPlan(page,args++pending.args++List[Value](query.limit,query.offset))
  }
  def search(c: Connection,query: RetrievalQuery,vector: Option[List[Double]]): RetrievalPage = {
    val compiled=plan(c,query,vector)
    val semantic=query.mode!=RetrievalMode.Lexical
    val result=rows(c,compiled.sql,compiled.args*) { r =>
      val hit=Option(r.getString("source_id")).map { id => RetrievalHit(unkey(id),unkey(r.getString("version")),r.getString("generation"),Option(r.getString("profile")),Option(r.getString("space")),readChunk(r),r.getDouble("score")) }
      (r.getLong("total"),r.getLong("pending"),hit)
    }
    RetrievalPage(result.flatMap(_._3),result.head._1,if(semantic) CountScope.CandidateWindow else CountScope.ExactMatches,if(semantic) Some(rankingLimit(query.mode)) else None,result.head._2)
  }
  /** Delivery-time reauthorization on a fresh transaction; never relabel a pinned old hit. */
  def visible(c: Connection,query: RetrievalQuery,id: String): Boolean = {
    transaction(c); val (scope,args)=authorization(query)
    one(c,s"SELECT 1 FROM pony_retrieval_sources s WHERE $scope AND s.id=?",(args:+key(id))*)(_ => true).contains(true)
  }
}

private[postgres] object Schema {
  val v1 = """
CREATE TABLE pony_retrieval_profiles(namespace text NOT NULL,id text NOT NULL,space text NOT NULL,descriptor text NOT NULL,policy bytea NOT NULL,PRIMARY KEY(namespace,id));
CREATE TABLE pony_retrieval_sources(namespace text NOT NULL,id text NOT NULL,version text NOT NULL,input_digest text NOT NULL,target_profile text NOT NULL,epoch bigint NOT NULL DEFAULT 0,head_generation text NOT NULL,published text,eligible boolean NOT NULL DEFAULT true,archived boolean NOT NULL DEFAULT false,expires_at numeric,PRIMARY KEY(namespace,id));
CREATE TABLE pony_retrieval_audience(namespace text NOT NULL,source_id text NOT NULL,principal text NOT NULL,PRIMARY KEY(namespace,source_id,principal),FOREIGN KEY(namespace,source_id) REFERENCES pony_retrieval_sources(namespace,id));
CREATE INDEX pony_retrieval_audience_principal ON pony_retrieval_audience(namespace,principal,source_id);
CREATE TABLE pony_retrieval_attributes(namespace text NOT NULL,source_id text NOT NULL,key text NOT NULL,value bytea NOT NULL,PRIMARY KEY(namespace,source_id,key),FOREIGN KEY(namespace,source_id) REFERENCES pony_retrieval_sources(namespace,id));
CREATE TABLE pony_retrieval_head_chunks(namespace text NOT NULL,source_id text NOT NULL,ordinal integer NOT NULL,chunk_id text NOT NULL,body bytea NOT NULL,provenance bytea NOT NULL,document tsvector NOT NULL,PRIMARY KEY(namespace,source_id,ordinal),UNIQUE(namespace,source_id,chunk_id),FOREIGN KEY(namespace,source_id) REFERENCES pony_retrieval_sources(namespace,id));
CREATE INDEX pony_retrieval_head_fts ON pony_retrieval_head_chunks USING gin(document);
CREATE TABLE pony_retrieval_jobs(namespace text NOT NULL,id text NOT NULL,source_id text NOT NULL,epoch bigint NOT NULL,profile text NOT NULL,run_id text NOT NULL,state text NOT NULL DEFAULT 'Queued',fence bigint NOT NULL DEFAULT 0,attempts integer NOT NULL DEFAULT 0,lease_until timestamptz,PRIMARY KEY(namespace,id),UNIQUE(namespace,source_id,epoch),FOREIGN KEY(namespace,source_id) REFERENCES pony_retrieval_sources(namespace,id));
CREATE TABLE pony_retrieval_accepted(namespace text NOT NULL,job_id text NOT NULL,ordinal integer NOT NULL,digest text NOT NULL,embedding vector NOT NULL,PRIMARY KEY(namespace,job_id,ordinal),FOREIGN KEY(namespace,job_id) REFERENCES pony_retrieval_jobs(namespace,id));
CREATE TABLE pony_retrieval_generations(namespace text NOT NULL,id text NOT NULL,source_id text NOT NULL,version text NOT NULL,profile text NOT NULL,space text NOT NULL,policy bytea NOT NULL,PRIMARY KEY(namespace,id),FOREIGN KEY(namespace,source_id) REFERENCES pony_retrieval_sources(namespace,id));
CREATE TABLE pony_retrieval_chunks(namespace text NOT NULL,generation text NOT NULL,source_id text NOT NULL,id text NOT NULL,chunk_id text NOT NULL,ordinal integer NOT NULL,body bytea NOT NULL,provenance bytea NOT NULL,document tsvector NOT NULL,embedding vector NOT NULL,profile text NOT NULL,PRIMARY KEY(namespace,id),FOREIGN KEY(namespace,generation) REFERENCES pony_retrieval_generations(namespace,id));
CREATE INDEX pony_retrieval_fts ON pony_retrieval_chunks USING gin(document);
"""
  /** Back-off instead of a terminal state: earliest retry per job; formerly Failed jobs are queued again. */
  val v2 = """
ALTER TABLE pony_retrieval_jobs ADD COLUMN not_before timestamptz;
UPDATE pony_retrieval_jobs SET state='Queued',fence=fence+1,lease_until=NULL WHERE state='Failed';
"""
  val migrations: List[(Int,String)] = List(1 -> v1,2 -> v2)
}
