package chronicle

import java.sql.SQLException
import java.util.UUID

/** Migration 024 on PostgreSQL: the revision layout check and the immutability of committed epoch rows. */
final class EpochSchemaTest extends munit.FunSuite {
  private def database(f: (Config,Database) => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh") }
    val config=Fixtures.config(); val db=new Database(config,IndexProfileCatalog.current(config)); db.initialize()
    def reset(): Unit = db.transaction(c => Sql.exec(c,"TRUNCATE ch_epochs,ch_sources,ch_ingest_receipts CASCADE"))
    try { reset(); f(config,db) } finally { reset(); db.close() }
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
    Sql.exec(c,"""INSERT INTO ch_revisions(session_id,revision,epoch,envelope,message_count,record_count,raw_bytes,message_bytes,fragment_count,raw_state,message_chain)
      VALUES(?,1,?,'{}',2,1,8,4,2,decode(repeat('00',40),'hex'),sha256(''::bytea))""",session,epoch)
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
