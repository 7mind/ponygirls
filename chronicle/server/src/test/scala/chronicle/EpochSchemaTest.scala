package chronicle

import java.sql.{DriverManager,SQLException}
import java.util.UUID
import scala.util.Using

/** Migration 024 on PostgreSQL: the revision layout check, the immutability of committed epoch rows and S1's candidate index
  * of the HEAD switch. */
final class EpochSchemaTest extends munit.FunSuite {
  private def database(f: (Config,Database) => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh") }
    val config=Fixtures.config(); val db=new Database(config,IndexProfileCatalog.current(config)); db.initialize()
    def reset(): Unit = db.transaction(c => Sql.exec(c,"TRUNCATE ch_epochs,ch_sources,ch_ingest_receipts CASCADE"))
    try { reset(); f(config,db) } finally { reset(); db.close() }
  }
  /** The mandatory epoch columns of the seeded revision as SQL values (message_time is optional). */
  private val epochColumns=List("message_count"->"2","record_count"->"1","raw_bytes"->"8","message_bytes"->"4","fragment_count"->"2",
    "raw_state"->"decode(repeat('00',40),'hex')","message_chain"->"sha256(''::bytea)")
  /** An epoch revision of the seeded source and epoch (parameters: session, epoch) with `columns` besides the envelope. */
  private def insertRevision(revision: Int,columns: List[(String,String)]): String = {
    val all=List("session_id"->"?","revision"->revision.toString,"epoch"->"?","envelope"->"'{}'")++columns
    s"INSERT INTO ch_revisions(${all.map(_._1).mkString(",")}) VALUES(${all.map(_._2).mkString(",")})"
  }
  /** Revision 1 of a source covers messages 0..1, raw bytes 0..7 and record 0 of its epoch; message 2, the raw segment at
    * offset 8 and record 1 are staged beyond it. */
  private def seed(db: Database): (UUID,UUID) = db.transaction { c =>
    val (session,epoch)=(UUID.randomUUID(),UUID.randomUUID())
    Sql.exec(c,"INSERT INTO ch_sources(id,owner,source_key,revision) VALUES(?,'a','epoch-schema',1)",session)
    Sql.exec(c,"INSERT INTO ch_epochs(id,session_id,raw_path) VALUES(?,?,'session.jsonl')",epoch,session)
    Sql.exec(c,"INSERT INTO ch_epoch_messages(epoch,position,message_id,value) SELECT ?,p,'m'||p,'{}' FROM generate_series(0,2) p",epoch)
    Sql.exec(c,"""INSERT INTO ch_epoch_raw(epoch,byte_offset,content) VALUES(?,0,E'{"r":0}\n'),(?,8,E'{"r":1}\n')""",epoch,epoch)
    Sql.exec(c,"INSERT INTO ch_epoch_records(epoch,record_index,record_key) SELECT ?,r,sha256(convert_to('r'||r,'UTF8')) FROM generate_series(0,1) r",epoch)
    Sql.exec(c,"INSERT INTO ch_epoch_fragments(epoch,position,part,value) SELECT ?,p,0,'fragment '||p FROM generate_series(0,2) p",epoch)
    Sql.exec(c,insertRevision(1,epochColumns),session,epoch)
    Sql.exec(c,"INSERT INTO ch_revision_info(session_id,revision,metadata,source,completion,redacted,message_count,lexical_version) VALUES(?,1,'{}','{}','Quiescent',false,2,?)",session,ArchiveProjection.lexicalVersion)
    (session,epoch)
  }
  private def changed(db: Database,sql: String,args: Sql.Param*): Int = db.transaction(c => Sql.exec(c,sql,args*))
  private def refused(db: Database,reason: String,sql: String,args: Sql.Param*): Unit = {
    // The runtime keeps only the SQLState of a failed transaction; the savepoint keeps the message naming the guard.
    val error=db.transaction { c =>
      val savepoint=c.setSavepoint()
      try { Sql.exec(c,sql,args*); None } catch { case e: SQLException => c.rollback(savepoint); Some(e) }
    }
    assert(error.exists(e => e.getSQLState=="23514" && e.getMessage.contains(reason)),s"$sql: ${error.map(_.getMessage)}")
  }

  test("committed epoch rows and revisions are immutable; deletes below a committed count are refused and pass once the revisions are gone") { database { (_,db) =>
    val (session,epoch)=seed(db)
    List("UPDATE ch_epoch_messages SET value='[]' WHERE epoch=? AND position=0","UPDATE ch_epoch_messages SET value='[]' WHERE epoch=? AND position=2",
      "UPDATE ch_epoch_raw SET content='{}' WHERE epoch=? AND byte_offset=0","UPDATE ch_epoch_records SET record_index=7 WHERE epoch=? AND record_index=1",
      "UPDATE ch_epoch_fragments SET value='other' WHERE epoch=? AND position=0").foreach(refused(db,"immutable epoch row",_,epoch))
    assertEquals(changed(db,"UPDATE ch_epoch_fragments SET head_candidate=false WHERE epoch=?",epoch),3)
    refused(db,"immutable epoch","UPDATE ch_epochs SET raw_path='other.jsonl' WHERE id=?",epoch)
    assertEquals(changed(db,"UPDATE ch_epochs SET candidates='prune' WHERE id=?",epoch),1)
    List("epoch=gen_random_uuid()","envelope='[]'","message_count=3","record_count=2","raw_bytes=16","message_bytes=5","fragment_count=3",
      "raw_state=decode(repeat('01',40),'hex')","message_chain=sha256('x'::bytea)","message_time='2026-01-01T00:00:00Z'").foreach { assignment =>
      refused(db,"immutable archive revision",s"UPDATE ch_revisions SET $assignment WHERE session_id=?",session)
    }
    refused(db,"ch_revisions_layout","INSERT INTO ch_revisions(session_id,revision,snapshot,epoch,envelope,message_count,record_count,raw_bytes,message_bytes,fragment_count,raw_state,message_chain) SELECT session_id,2,'{}',epoch,envelope,message_count,record_count,raw_bytes,message_bytes,fragment_count,raw_state,message_chain FROM ch_revisions WHERE session_id=?",session)
    // Every mandatory epoch column: all omitted, then each one NULL (a CHECK passes a NULL predicate).
    (Nil::epochColumns.map(_._1).map(nulled => epochColumns.map((column,value) => column->(if(column==nulled) "NULL" else value)))).foreach { columns =>
      refused(db,"ch_revisions_layout",insertRevision(2,columns),session,epoch)
    }
    List("DELETE FROM ch_epoch_messages WHERE epoch=? AND position=1","DELETE FROM ch_epoch_raw WHERE epoch=? AND byte_offset=0",
      "DELETE FROM ch_epoch_records WHERE epoch=? AND record_index=0","DELETE FROM ch_epoch_fragments WHERE epoch=? AND position=1").foreach(refused(db,"committed epoch row",_,epoch))
    List("DELETE FROM ch_epoch_messages WHERE epoch=? AND position=2","DELETE FROM ch_epoch_raw WHERE epoch=? AND byte_offset=8",
      "DELETE FROM ch_epoch_records WHERE epoch=? AND record_index=1","DELETE FROM ch_epoch_fragments WHERE epoch=? AND position=2").foreach { staged =>
      assertEquals(changed(db,staged,epoch),1,staged)
    }
    assertEquals(changed(db,"DELETE FROM ch_revisions WHERE session_id=?",session),1)
    assertEquals(changed(db,"DELETE FROM ch_epochs WHERE id=?",epoch),1)
    db.transaction { c =>
      assertEquals(Sql.one(c,"SELECT (SELECT count(*) FROM ch_epoch_messages)+(SELECT count(*) FROM ch_epoch_raw)+(SELECT count(*) FROM ch_epoch_records)+(SELECT count(*) FROM ch_epoch_fragments)")(_.getLong(1)),Some(0L))
    }
  }}

  test("a head switch reads the session's current candidates through their partial index, not the session's history") { database { (_,db) =>
    val session=UUID.randomUUID()
    // 50 superseded revisions of 100 fragments each, then the head (51) and the next revision (52), both candidates.
    db.transaction { c =>
      Sql.exec(c,"INSERT INTO ch_sources(id,owner,source_key,revision) VALUES(?,'a','head-candidates',51)",session)
      Sql.exec(c,"INSERT INTO ch_revisions(session_id,revision,snapshot) SELECT ?,r,'{}' FROM generate_series(1,52) r",session)
      Sql.exec(c,"INSERT INTO ch_archive_fragments(session_id,revision,ordinal,value,head_candidate) SELECT ?,r,o,'fragment',r>50 FROM generate_series(1,52) r,generate_series(0,99) o",session)
    }
    db.transaction(c => Sql.exec(c,"ANALYZE ch_archive_fragments"))
    db.transaction { c =>
      Sql.exec(c,"UPDATE ch_sources SET revision=52 WHERE id=?",session)
      // One scan of the index by the trigger's obsolete-candidate query, reading the 200 candidates, not the 5,200 fragments.
      assertEquals(Sql.one(c,"SELECT pg_stat_get_xact_numscans('ch_archive_fragments_session_candidates'::regclass),pg_stat_get_xact_tuples_returned('ch_archive_fragments_session_candidates'::regclass)")(r => (r.getLong(1),r.getLong(2))),Some((1L,200L)))
    }
  }}

  test("a start builds the candidate index only on a small archive; a missing one above the threshold and an invalid one refuse the start before any change") { database { (config,db) =>
    assertEquals(Database.startupCandidateIndexBytes,1024L*1024*1024)
    val (session,_)=seed(db)
    db.transaction { c =>
      Sql.exec(c,"INSERT INTO ch_archive_fragments(session_id,revision,ordinal,value) VALUES(?,1,0,'metadata fragment')",session)
      Sql.exec(c,s"DROP INDEX ${Database.candidateIndex}")
      // A change a start makes: 024 records its version again.
      Sql.exec(c,"DELETE FROM ch_schema_migrations WHERE version=24")
    }
    def state(): (String,Int) = db.transaction(c => Sql.one(c,"SELECT coalesce((SELECT CASE WHEN indisvalid THEN 'valid' ELSE 'invalid' END FROM pg_index WHERE indexrelid=to_regclass(?)),'missing'),(SELECT count(*)::int FROM ch_schema_migrations WHERE version=24)",Database.candidateIndex)(r => (r.getString(1),r.getInt(2))).get)
    def refused(threshold: Long,remedy: String): Unit = {
      val error=intercept[DomainError](db.initialize(threshold))
      assertEquals(error.code,"migration-required"); assert(error.detail.contains(remedy),error.detail)
    }
    /** The operator's psql session: autocommit, as CREATE INDEX CONCURRENTLY requires. */
    def operator(statements: String*): Unit = Using.resource(DriverManager.getConnection(config.jdbcUrl,config.databaseUser,Fixtures.databasePassword))(c => statements.foreach(Sql.exec(c,_)))
    try {
      // The table's one page is above a zero threshold.
      refused(0L,Database.candidateIndexBuild)
      assertEquals(state(),("missing",0))
      db.initialize()
      assertEquals(state(),("valid",1))
      // An interrupted operator build: it waits for this open writer until its lock timeout ends it.
      operator(s"DROP INDEX CONCURRENTLY ${Database.candidateIndex}")
      db.transaction { writer =>
        Sql.exec(writer,"UPDATE ch_archive_fragments SET value=value WHERE session_id=?",session)
        intercept[SQLException](operator("SET lock_timeout='100ms'",Database.candidateIndexBuild))
      }
      refused(Database.startupCandidateIndexBytes,s"DROP INDEX CONCURRENTLY ${Database.candidateIndex}")
      assertEquals(state(),("invalid",1))
      operator(s"DROP INDEX CONCURRENTLY ${Database.candidateIndex}",Database.candidateIndexBuild)
      db.initialize(0L)
      assertEquals(state(),("valid",1))
    } finally if(state()._1!="valid") { operator(s"DROP INDEX CONCURRENTLY IF EXISTS ${Database.candidateIndex}"); db.initialize() }
  }}

  test("a restart re-runs 013 and then 024 over existing revisions: the revision guard keeps the epoch columns, the layout check is added once and validated, no indexing row changes") { database { (config,db) =>
    val (session,_)=seed(db)
    changed(db,"UPDATE ch_owner_targets SET profile=?,epoch=0",config.profile)
    val archive=new PostgresArchive(db,config)
    archive.ingest("a",Fixtures.snapshot())
    assert(archive.publish(archive.claim(Set(config.profile),ClaimScope.AllOwners,300).get,Nil))
    def indexing(): List[String] = db.transaction(c => Sql.rows(c,"""SELECT 'job '||j::text FROM ch_jobs j UNION ALL SELECT 'generation '||g::text FROM ch_generations g
      UNION ALL SELECT concat_ws(' ','binding',session_id,revision,binding_id) FROM ch_revisions
      UNION ALL SELECT concat_ws(' ','lexical',session_id,revision,lexical_version) FROM ch_revision_info ORDER BY 1""")(_.getString(1)))
    val before=indexing()
    // An existing database without the check (before 024): the restart adds it NOT VALID and validates both layouts.
    changed(db,"ALTER TABLE ch_revisions DROP CONSTRAINT ch_revisions_layout")
    db.initialize()
    assertEquals(indexing(),before)
    assertEquals(before.count(_.startsWith("generation ")),1)
    refused(db,"immutable archive revision","UPDATE ch_revisions SET message_chain=sha256('x'::bytea) WHERE session_id=?",session)
    db.transaction { c =>
      assertEquals(Sql.rows(c,"SELECT conname,convalidated FROM pg_constraint WHERE conrelid='ch_revisions'::regclass AND (conname='ch_revisions_layout' OR confrelid='ch_epochs'::regclass) ORDER BY conname")(r => (r.getString(1),r.getBoolean(2))),
        List("ch_revisions_epoch_fkey"->true,"ch_revisions_layout"->true))
    }
  }}
}
