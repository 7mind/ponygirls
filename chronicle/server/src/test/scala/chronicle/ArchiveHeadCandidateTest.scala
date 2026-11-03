package chronicle

import chronicle.api.*
import io.circe.Json
import java.sql.{Connection,SQLException}
import java.util.UUID
import java.util.concurrent.{Callable,Executors,TimeUnit}
import scala.concurrent.duration.*

// PostgreSQL mask/trigger/MVCC properties need the real controlled adapter;
// an in-memory archive cannot prove partial-index or row-lock behavior.
class ArchiveHeadCandidateTest extends munit.FunSuite {
  override val munitTimeout=60.seconds

  private def database(f: (Config,Database,PostgresArchive,PostgresArchiveIndex) => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh") }
    val original=Fixtures.config()
    val separator=if(original.jdbcUrl.contains("?")) "&" else "?"
    val options=java.net.URLEncoder.encode("-c statement_timeout=10000",java.nio.charset.StandardCharsets.UTF_8)
    val config=original.copy(jdbcUrl=original.jdbcUrl+separator+"options="+options)
    val db=Fixtures.database(config,IndexProfileCatalog.current(config)); db.initialize()
    db.transaction { c =>
      val present=Sql.one(c,"SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='ch_archive_fragments'::regclass AND attname='head_candidate' AND NOT attisdropped)")(_.getBoolean(1)).get
      assert(present,"head-candidate schema contract: ch_archive_fragments.head_candidate is missing after initialize; migration must install the completeness mask before flag/query assertions")
      Sql.exec(c,"TRUNCATE ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks,ch_groups,ch_members CASCADE")
      Sql.exec(c,"UPDATE ch_profile SET active=?,target=?,maintenance=false",config.profile,config.profile)
      Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=0",config.profile)
    }
    val archive=new PostgresArchive(db,config)
    f(config,db,archive,new PostgresArchiveIndex(db,archive,config))
  }

  private def revision(previous: IngestRequest,texts: List[String],expected: Int): IngestRequest = {
    val messages=texts.zipWithIndex.map { case (text,index) => Message(s"m$index",None,"user",text,None,index) }
    val raw=messages.map(message => Json.obj("id"->Json.fromString(message.id),"text"->Json.fromString(message.text)).noSpaces).mkString("","\n","\n")
    previous.copy(requestId=UUID.randomUUID(),expectedRevision=expected,metadata=previous.metadata.copy(title="candidate fixture",tags=Nil),messages=messages,files=List(RawFile("source.jsonl",Wire.hash(raw),raw)),digest=Wire.hash(raw))
  }
  private def initial(texts: String*): IngestRequest = revision(Fixtures.snapshot(),texts.toList,0)
  private def fragments(c: Connection,id: UUID): List[(Int,Int,String)] =
    Sql.rows(c,"SELECT revision,ordinal,value FROM ch_archive_fragments WHERE session_id=? ORDER BY revision,ordinal",id)(r => (r.getInt(1),r.getInt(2),r.getString(3)))
  private def complete(c: Connection,id: UUID): Unit = {
    assert(Sql.one(c,"SELECT count(*) FROM ch_archive_fragments f JOIN ch_sources s ON s.id=f.session_id AND s.revision=f.revision WHERE s.id=?",id)(_.getLong(1)).get>0,"current-fragment check must not be vacuous")
    assertEquals(Sql.one(c,"SELECT count(*) FROM ch_archive_fragments f JOIN ch_sources s ON s.id=f.session_id AND s.revision=f.revision WHERE s.id=? AND NOT f.head_candidate",id)(_.getLong(1)),Some(0L),"no current HEAD fragment may be excluded by the candidate mask")
  }
  private def search(index: PostgresArchiveIndex,reader: String,body: String): ArchiveSearchResult = {
    val query=ArchiveQuery("mode:lexical ("+body+")",ArchiveSort.Title,SortDirection.Asc,None,10,false)
    index.sourceSearch(reader,query,ArchiveExpression.parse(query.expression),Nil,ReadMaterialization.unrestricted)
  }
  private def ids(index: PostgresArchiveIndex,reader: String,body: String): Set[UUID] = {
    val result=search(index,reader,body)
    assertEquals(result.page.total,result.page.rows.size.toLong)
    assertEquals(result.page.textScope,ArchiveTextScope.ExactLexical)
    result.page.rows.map(_.head.id).toSet
  }

  test("Effectual GoodCommunication specified: completeness mask defaults true and canonical stored-value GIN is partial on the mask") { database { (config,db,archive,index) =>
    val out=archive.ingest("a",initial("default mask text"))
    db.transaction { c =>
      val (notNull,booleanType,default)=Sql.one(c,"SELECT a.attnotnull,a.atttypid='boolean'::regtype,pg_get_expr(d.adbin,d.adrelid) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='ch_archive_fragments'::regclass AND a.attname='head_candidate'")(r => (r.getBoolean(1),r.getBoolean(2),Option(r.getString(3)))).get
      assert(notNull && booleanType,"head_candidate must be a non-null boolean")
      assertEquals(default,Some("true"),"old/new fragment writers omitting the mask must remain complete")
      Sql.exec(c,"INSERT INTO ch_archive_fragments(session_id,revision,ordinal,value) VALUES(?,1,999999,'omitted-flag-default')",out.sessionId)
      assertEquals(Sql.one(c,"SELECT head_candidate FROM ch_archive_fragments WHERE session_id=? AND ordinal=999999",out.sessionId)(_.getBoolean(1)),Some(true))
      val (expression,predicate,key,valueAttribute,collation,method,operatorClass,keyCount,valid,ready)=Sql.one(c,"SELECT pg_get_expr(i.indexprs,i.indrelid),pg_get_expr(i.indpred,i.indrelid),i.indkey::text,a.attnum,co.collname,am.amname,op.opcname,i.indnatts,i.indisvalid,i.indisready FROM pg_index i JOIN pg_class ix ON ix.oid=i.indexrelid JOIN pg_am am ON am.oid=ix.relam JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attname='value' JOIN pg_collation co ON co.oid=i.indcollation[0] JOIN pg_opclass op ON op.oid=i.indclass[0] WHERE i.indexrelid='ch_archive_fragments_lower_trgm'::regclass AND i.indrelid='ch_archive_fragments'::regclass")(r => (Option(r.getString(1)),Option(r.getString(2)),r.getString(3),r.getInt(4),r.getString(5),r.getString(6),r.getString(7),r.getInt(8),r.getBoolean(9),r.getBoolean(10))).get
      assertEquals(expression,Option.empty[String]); assertEquals(predicate,Some("head_candidate"),"canonical GIN must exclude known obsolete candidates, without changing the stored-column key")
      assertEquals(key,valueAttribute.toString); assertEquals(keyCount,1)
      assertEquals(collation,"pg_unicode_fast"); assertEquals(method,"gin"); assertEquals(operatorClass,"gin_trgm_ops")
      assert(valid && ready)
      complete(c,out.sessionId)
    }
    val error=intercept[SQLException](db.transaction(c => Sql.exec(c,"UPDATE ch_archive_fragments SET head_candidate=NULL WHERE session_id=?",out.sessionId)))
    assertEquals(error.getSQLState,"23502")
  }}

  test("Effectual GoodCommunication regression: normal CAS advance preserves historical bytes and all new HEAD candidates") { database { (config,db,archive,index) =>
    val first=initial("historyneedle K %_\\", "aΣ"+"\u0301"*3000+"b")
    val out=archive.ingest("a",first)
    val before=db.transaction(c => fragments(c,out.sessionId))
    val next=revision(first,List("currentneedle İSTANBUL"),1)
    assertEquals(archive.ingest("a",next).sessionId,out.sessionId)
    db.transaction { c =>
      assertEquals(fragments(c,out.sessionId).filter(_._1==1),before,"mask pruning must never delete/rewrite old fragment values")
      assertEquals(Sql.one(c,"SELECT count(*) FROM ch_archive_fragments WHERE session_id=? AND revision=1 AND head_candidate",out.sessionId)(_.getInt(1)),Some(0),"unlocked old candidates are pruned on normal HEAD advance")
      complete(c,out.sessionId)
    }
    assertEquals(archive.messages("a",out.sessionId,0,100,Some(ContentView(1,None))).messages,first.messages)
    assertEquals(archive.raw("a",out.sessionId,Some(1)).files,first.files)
    assertEquals(archive.messages("a",out.sessionId,0,100,Some(ContentView(2,None))).messages,next.messages)
    assertEquals(ids(index,"a","historyneedle"),Set.empty[UUID])
    val found=search(index,"a","currentneedle")
    assertEquals(found.page.rows.map(_.head.id),List(out.sessionId))
    assertEquals(found.page.rows.head.matchedView,Some(ContentView(2,None)))
    assert(found.evidence.flatMap(_.matches).forall(_.view==ContentView(2,None)))
    assertEquals(intercept[DomainError](archive.ingest("a",revision(first,List("stale CAS"),1))).code,"conflict")
    db.transaction(c => complete(c,out.sessionId))
  }}

  test("Effectual GoodCommunication regression: permitted historical TRUE extras cannot leak past current-revision joins or ACL Boolean complements") { database { (config,db,archive,index) =>
    val first=initial("oldonlyneedle"); val out=archive.ingest("a",first)
    archive.ingest("a",revision(first,List("currentonlyneedle"),1))
    val foreign=archive.ingest("b",initial("oldonlyneedle currentonlyneedle"))
    db.transaction { c =>
      Sql.exec(c,"UPDATE ch_archive_fragments SET head_candidate=true WHERE session_id=? AND revision=1",out.sessionId)
      complete(c,out.sessionId); complete(c,foreign.sessionId)
    }
    assertEquals(ids(index,"a","oldonlyneedle"),Set.empty[UUID])
    assertEquals(ids(index,"a","currentonlyneedle AND NOT oldonlyneedle"),Set(out.sessionId))
    assertEquals(ids(index,"a","oldonlyneedle OR NOT oldonlyneedle"),Set(out.sessionId))
    assertEquals(ids(index,"a","user:b OR oldonlyneedle"),Set.empty[UUID])
    assertEquals(ids(index,"b","oldonlyneedle"),Set(foreign.sessionId))
    assertEquals(archive.messages("a",out.sessionId,0,100,Some(ContentView(1,None))).messages,first.messages)
  }}

  test("Effectual GoodCommunication regression: late normalization backfill includes current HEAD and preserves readable historical projections") { database { (config,db,archive,index) =>
    val first=initial("latehistoryneedle K"+"x"*5000); val out=archive.ingest("a",first)
    val next=revision(first,List("latecurrentneedle İ"+"y"*5000),1)
    archive.ingest("a",next)
    val before=db.transaction(c => fragments(c,out.sessionId))
    db.transaction { c =>
      Sql.exec(c,"UPDATE ch_revision_info SET lexical_version=0 WHERE session_id=?",out.sessionId)
      Sql.exec(c,"DELETE FROM ch_archive_fragments WHERE session_id=?",out.sessionId)
    }
    ArchiveProjection.backfill(db)
    db.transaction { c =>
      assertEquals(fragments(c,out.sessionId),before)
      complete(c,out.sessionId)
      assertEquals(Sql.rows(c,"SELECT lexical_version FROM ch_revision_info WHERE session_id=? ORDER BY revision",out.sessionId)(_.getInt(1)),List.fill(2)(ArchiveProjection.lexicalVersion))
      // Old TRUE extras are permitted, not required: cleanup may prune them later.
    }
    assertEquals(ids(index,"a","latehistoryneedle"),Set.empty[UUID])
    assertEquals(ids(index,"a","latecurrentneedle"),Set(out.sessionId))
    db.initialize(); db.initialize()
    db.transaction { c => assertEquals(fragments(c,out.sessionId),before); complete(c,out.sessionId) }
    List((1,first),(2,next)).foreach { case (number,request) =>
      assertEquals(archive.messages("a",out.sessionId,0,100,Some(ContentView(number,None))).messages,request.messages)
      assertEquals(archive.raw("a",out.sessionId,Some(number)).files,request.files)
    }
  }}

  test("Effectual GoodCommunication regression: pruning failure rolls back HEAD, new fragments, messages and ingest receipt atomically") { database { (config,db,archive,index) =>
    val first=initial("rollback-old-marker"); val out=archive.ingest("a",first)
    val before=db.transaction(c => fragments(c,out.sessionId))
    val next=revision(first,List("rollback-new-marker"),1)
    db.transaction(c => Sql.exec(c,"ALTER TABLE ch_archive_fragments ADD CONSTRAINT head_candidate_prune_reject CHECK(head_candidate OR value<>'rollback-old-marker')"))
    try {
      val error=intercept[SQLException](archive.ingest("a",next))
      assertEquals(error.getSQLState,"23514","fixture must fail at the old-fragment mask UPDATE constraint")
      assertEquals(archive.session("a",out.sessionId).revision,1)
      db.transaction { c =>
        assertEquals(fragments(c,out.sessionId),before)
        assertEquals(Sql.one(c,"SELECT count(*) FROM ch_revisions WHERE session_id=?",out.sessionId)(_.getInt(1)),Some(1))
        assertEquals(Sql.one(c,"SELECT count(*) FROM ch_messages WHERE session_id=? AND revision=2",out.sessionId)(_.getInt(1)),Some(0))
        assertEquals(Sql.one(c,"SELECT count(*) FROM ch_ingest_receipts WHERE request_id=?",next.requestId)(_.getInt(1)),Some(0))
        assertEquals(Sql.one(c,"SELECT count(*) FROM ch_jobs WHERE session_id=? AND revision=2",out.sessionId)(_.getInt(1)),Some(0))
        complete(c,out.sessionId)
      }
    } finally db.transaction(c => Sql.exec(c,"ALTER TABLE ch_archive_fragments DROP CONSTRAINT head_candidate_prune_reject"))
    assertEquals(archive.ingest("a",next).revision,2,"same request remains retryable after rolled-back pruning failure")
  }}

  test("Effectual GoodCommunication specified: repeatable-read snapshot spanning HEAD advance retains its old complete candidate set") { database { (config,db,archive,index) =>
    val first=initial("snapshotoldneedle"); val out=archive.ingest("a",first)
    val next=revision(first,List("snapshotnewneedle"),1)
    db.transaction { snapshot =>
      snapshot.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ)
      assertEquals(Sql.one(snapshot,"SELECT revision FROM ch_sources WHERE id=?",out.sessionId)(_.getInt(1)),Some(1))
      val before=fragments(snapshot,out.sessionId)
      complete(snapshot,out.sessionId)
      assertEquals(archive.ingest("a",next).revision,2)
      assertEquals(Sql.one(snapshot,"SELECT revision FROM ch_sources WHERE id=?",out.sessionId)(_.getInt(1)),Some(1))
      assertEquals(fragments(snapshot,out.sessionId),before)
      complete(snapshot,out.sessionId)
      assertEquals(Sql.one(snapshot,"SELECT count(*) FROM ch_sources s JOIN ch_archive_fragments f ON f.session_id=s.id AND f.revision=s.revision WHERE s.id=? AND f.head_candidate AND f.value LIKE '%snapshotoldneedle%'",out.sessionId)(_.getInt(1)),Some(1))
      assertEquals(Sql.one(snapshot,"SELECT count(*) FROM ch_archive_fragments WHERE session_id=? AND revision=2",out.sessionId)(_.getInt(1)),Some(0))
    }
    assertEquals(ids(index,"a","snapshotoldneedle"),Set.empty[UUID])
    assertEquals(ids(index,"a","snapshotnewneedle"),Set(out.sessionId))
    db.transaction(c => complete(c,out.sessionId))
  }}

  test("Effectual GoodCommunication regression: HEAD advance skips a locked obsolete fragment and later no-op cleanup safely prunes its extra candidate") { database { (config,db,archive,index) =>
    val first=initial("lockedoldneedle"); val out=archive.ingest("a",first)
    val before=db.transaction(c => fragments(c,out.sessionId))
    val next=revision(first,List("lockednewneedle"),1)
    val executor=Executors.newSingleThreadExecutor()
    try {
      db.transaction { held =>
        val ordinal=Sql.one(held,"SELECT ordinal FROM ch_archive_fragments WHERE session_id=? AND revision=1 AND value='lockedoldneedle' FOR UPDATE",out.sessionId)(_.getInt(1)).get
        val advancing=executor.submit(new Callable[IngestReceipt] { def call(): IngestReceipt=archive.ingest("a",next) })
        // Completion while this transaction still owns the row lock is the proof;
        // no sleep/racy overlap or elapsed-performance threshold substitutes for it.
        assertEquals(advancing.get(5,TimeUnit.SECONDS).revision,2)
        assertEquals(Sql.one(held,"SELECT head_candidate FROM ch_archive_fragments WHERE session_id=? AND revision=1 AND ordinal=?",out.sessionId,ordinal)(_.getBoolean(1)),Some(true),"locked obsolete row is allowed to remain a TRUE extra")
        db.transaction { c =>
          assert(Sql.one(c,"SELECT count(*) FROM ch_archive_fragments WHERE session_id=? AND revision=1 AND NOT head_candidate",out.sessionId)(_.getInt(1)).get>0,"unlocked obsolete rows should still be pruned")
          complete(c,out.sessionId)
        }
        assertEquals(ids(index,"a","lockedoldneedle"),Set.empty[UUID])
        assertEquals(ids(index,"a","lockednewneedle"),Set(out.sessionId))
      }
      db.transaction { c =>
        Sql.exec(c,"UPDATE ch_sources SET revision=revision WHERE id=?",out.sessionId)
        assertEquals(Sql.one(c,"SELECT count(*) FROM ch_archive_fragments WHERE session_id=? AND revision=1 AND head_candidate",out.sessionId)(_.getInt(1)),Some(0))
        assertEquals(fragments(c,out.sessionId).filter(_._1==1),before)
        complete(c,out.sessionId)
      }
    } finally {
      executor.shutdownNow()
      assert(executor.awaitTermination(12,TimeUnit.SECONDS),"owned ingest task must terminate after releasing obsolete-fragment lock")
    }
    assertEquals(archive.messages("a",out.sessionId,0,100,Some(ContentView(1,None))).messages,first.messages)
  }}

  test("Effectual GoodCommunication regression: actual same-source backfill DELETE and late reinsert remain complete across a concurrent HEAD advance") { database { (config,db,archive,index) =>
    val first=initial("barrierhistoryneedle K"+"x"*5000); val out=archive.ingest("a",first)
    val before=db.transaction(c => fragments(c,out.sessionId))
    val next=revision(first,List("barriercurrentneedle İ"+"y"*5000),1)
    val suffix=UUID.randomUUID().toString.replace("-","")
    val function="hc_backfill_gate_"+suffix; val trigger="hc_backfill_pause_"+suffix
    val barrierKey=1729013371L
    val application="head-candidate-backfill-"+suffix
    val backfillConfig=config.copy(jdbcUrl=config.jdbcUrl+"&ApplicationName="+application)
    val backfillDb=Fixtures.database(backfillConfig,db.profiles)
    db.transaction { c =>
      Sql.exec(c,"UPDATE ch_revision_info SET lexical_version=0 WHERE session_id=? AND revision=1",out.sessionId)
      Sql.exec(c,s"CREATE FUNCTION $function() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN PERFORM pg_advisory_xact_lock($barrierKey::bigint); RETURN OLD; END;'")
      Sql.exec(c,s"CREATE TRIGGER $trigger BEFORE DELETE ON ch_archive_fragments FOR EACH ROW WHEN (OLD.session_id='${out.sessionId}'::uuid AND OLD.revision=1) EXECUTE FUNCTION $function()")
    }
    val executor=Executors.newFixedThreadPool(2)
    try {
      val backfilling=db.transaction { gate =>
        Sql.exec(gate,"SELECT pg_advisory_xact_lock(?)",barrierKey)
        val actualBackfill=executor.submit(new Callable[Unit] { def call(): Unit=ArchiveProjection.backfill(backfillDb) })
        def deletingAtBarrier: Boolean = db.transaction(c => Sql.one(c,"SELECT EXISTS(SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE l.locktype='advisory' AND NOT l.granted AND l.classid::bigint=0 AND l.objid::bigint=? AND l.objsubid=1 AND a.datname=current_database() AND a.application_name=? AND a.query LIKE 'DELETE FROM ch_archive_fragments%')",barrierKey,application)(_.getBoolean(1)).get)
        val deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(3)
        var paused=deletingAtBarrier
        while(!paused && !actualBackfill.isDone && System.nanoTime()<deadline) paused=deletingAtBarrier
        if(!paused && actualBackfill.isDone) actualBackfill.get(1,TimeUnit.SECONDS)
        assert(paused,"actual ArchiveProjection.backfill must reach the fixture's BEFORE DELETE advisory wait; overlap is established from pg_locks, not sleep/timing")
        val advancing=executor.submit(new Callable[IngestReceipt] { def call(): IngestReceipt=archive.ingest("a",next) })
        assertEquals(advancing.get(5,TimeUnit.SECONDS).revision,2,"ingest must commit while backfill owns the obsolete revision/DELETE row locks")
        assert(deletingAtBarrier,"backfill must still be paused behind the held gate after HEAD advance, not have timed out or finished")
        db.transaction(c => complete(c,out.sessionId))
        // Gate commit releases only this test's advisory lock; the real backfill
        // then deletes/reinserts revision1 while the public HEAD is already2.
        actualBackfill
      }
      backfilling.get(5,TimeUnit.SECONDS) // Surface actual backfill failures, not just executor termination.
      db.transaction { c =>
        assertEquals(fragments(c,out.sessionId).filter(_._1==1),before,"real late reinsert must preserve historical fragment values/ordinals")
        complete(c,out.sessionId)
        assertEquals(Sql.one(c,"SELECT lexical_version FROM ch_revision_info WHERE session_id=? AND revision=1",out.sessionId)(_.getInt(1)),Some(ArchiveProjection.lexicalVersion))
        assertEquals(Sql.one(c,"SELECT count(*) FROM ch_archive_fragments WHERE session_id=? AND revision=1 AND head_candidate AND value LIKE '%barrierhistoryneedle%'",out.sessionId)(_.getInt(1)),Some(1),"late real backfill creates a permitted DEFAULT TRUE historical candidate")
      }
      assertEquals(ids(index,"a","barrierhistoryneedle"),Set.empty[UUID],"late historical TRUE extras must not leak into current-HEAD search")
      assertEquals(ids(index,"a","barriercurrentneedle"),Set(out.sessionId))
      List((1,first),(2,next)).foreach { case (number,request) =>
        assertEquals(archive.messages("a",out.sessionId,0,100,Some(ContentView(number,None))).messages,request.messages)
        assertEquals(archive.raw("a",out.sessionId,Some(number)).files,request.files)
      }
    } finally {
      try { executor.shutdownNow(); assert(executor.awaitTermination(12,TimeUnit.SECONDS),"owned backfill/ingest tasks must terminate after barrier release") }
      finally db.transaction { c => Sql.exec(c,s"DROP TRIGGER $trigger ON ch_archive_fragments"); Sql.exec(c,s"DROP FUNCTION $function()") }
    }
  }}
}
