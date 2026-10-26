package chronicle

import chronicle.api.*
import java.nio.charset.StandardCharsets.UTF_8
import java.time.Instant
import java.util.UUID
import java.sql.DriverManager
import scala.util.Using
import cats.effect.IO
import cats.effect.unsafe.implicits.global

class ArchiveProjectionTest extends munit.FunSuite {
  test("BA specified: source fragments overlap512 scalars, retain long words and always advance") {
    val values=List("a"*20000,"😀"*4000,"a"*4080+"alpha beta"+"x"*5000,"x"*3500+"K"*512+"z"*4000)
    values.foreach { value =>
      val fragments=ArchiveProjection.fragments(value).toList
      assert(fragments.forall(_.getBytes(UTF_8).length<=ArchiveProjection.fragmentBytes))
      assert(fragments.head.nonEmpty)
      fragments.sliding(2).filter(_.size==2).foreach { pair =>
        val previous=pair.head; val suffix=previous.substring(previous.offsetByCodePoints(previous.length,-ArchiveProjection.overlapScalars))
        assert(pair(1).startsWith(suffix))
      }
    }
    assertEquals(ArchiveProjection.fragments("").toList,Nil)
  }
  test("BA specified: lastTimestamp selects actual maximum valid message time, then ended/start without upload time") {
    val original=Fixtures.snapshot(); val metadata=original.metadata.copy(startedAt=Some("2026-01-01T00:00:00Z"),endedAt=Some("2026-10-26T00:00:00Z"))
    val messages=List("2026-02-02T00:00:00Z","invalid","2026-02-01T00:00:00Z").map(value => original.messages.head.copy(timestamp=Some(value)))
    assertEquals(ArchiveProjection.latest(metadata,messages.iterator),Some(Instant.parse("2026-02-02T00:00:00Z")))
    assertEquals(ArchiveProjection.latest(metadata,messages.take(1).map(_.copy(timestamp=Some("invalid"))).iterator),Some(Instant.parse(metadata.endedAt.get)))
    assertEquals(ArchiveProjection.latest(metadata.copy(endedAt=None),Iterator.empty),Some(Instant.parse(metadata.startedAt.get)))
    assertEquals(ArchiveProjection.latest(metadata.copy(endedAt=None,startedAt=None),Iterator.empty),None)
    assertEquals(ArchiveProjection.timestampOrder(Instant.parse("1969-12-31T23:59:59.500000001Z")),"-0.499999999")
  }
  private def database(f: (Config,Database,PostgresArchive) => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh") }
    val config=Fixtures.config(); val db=new Database(config); db.initialize()
    db.transaction { c => Sql.exec(c,"TRUNCATE ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks CASCADE"); Sql.exec(c,"UPDATE ch_profile SET active=?,target=?,maintenance=false",config.profile,config.profile) }
    f(config,db,new PostgresArchive(db,config))
  }
  test("BG GoodCommunication specified: metadata/message pages and locator use pinned projection independent of raw files") { database { (config,db,archive) =>
    val original=Fixtures.snapshot(); val out=archive.ingest("a",original,config.profile)
    val view=ContentView(1,None)
    assertEquals(archive.locateMessage("a",out.sessionId,view,"u"),MessageLocation(view,0,1))
    db.transaction(c => Sql.exec(c,"UPDATE ch_revisions SET snapshot=jsonb_set(snapshot,'{files}',?::jsonb) WHERE session_id=?", "null",out.sessionId))
    assertEquals(archive.readSession("a",out.sessionId,Some(view)).session.metadata,original.metadata)
    assertEquals(archive.messages("a",out.sessionId,0,100,Some(view)).messages,original.messages)
    assertEquals(intercept[DomainError](archive.locateMessage("b",out.sessionId,view,"u")).code,"not-found")
    assertEquals(intercept[DomainError](archive.locateMessage("a",out.sessionId,view,"absent")).code,"not-found")
    assertEquals(intercept[DomainError](archive.locateMessage("a",out.sessionId,ContentView(2,None),"u")).code,"not-found")
  }}
  test("BG GoodCommunication regression: obsolete lexical projections rebuild whole-field folding without changing normalized content") { database { (config,db,archive) =>
    val original=Fixtures.snapshot(); val text="aΣ"+"\u0301"*5000+"b"
    val request=original.copy(metadata=original.metadata.copy(title=text),messages=original.messages.map(_.copy(text=text)))
    val receipt=archive.ingest("a",request,config.profile)
    db.transaction { c =>
      Sql.exec(c,"UPDATE ch_revision_info SET lexical_version=0 WHERE session_id=?",receipt.sessionId)
      Sql.exec(c,"DELETE FROM ch_archive_fragments WHERE session_id=?",receipt.sessionId)
      ArchiveProjection.fragments(text).zipWithIndex.foreach { case (value,ordinal) => Sql.exec(c,"INSERT INTO ch_archive_fragments VALUES(?,1,?,?)",receipt.sessionId,ordinal,value) }
    }
    ArchiveProjection.backfill(db); ArchiveProjection.backfill(db)
    assertEquals(archive.messages("a",receipt.sessionId,0,100,Some(ContentView(1,None))).messages,request.messages)
    assertEquals(archive.raw("a",receipt.sessionId,Some(1)).files,request.files)
    db.transaction { c =>
      assertEquals(Sql.one(c,"SELECT lexical_version FROM ch_revision_info WHERE session_id=?",receipt.sessionId)(_.getInt(1)),Some(ArchiveProjection.lexicalVersion))
      assertEquals(Sql.one(c,"SELECT count(*) FROM ch_archive_fragments WHERE session_id=? AND value LIKE '%σ%'",receipt.sessionId)(_.getInt(1)),Some(2))
      assertEquals(Sql.one(c,"SELECT count(*) FROM ch_archive_fragments WHERE session_id=? AND value LIKE '%ς%'",receipt.sessionId)(_.getInt(1)),Some(0))
    }
  }}
  test("Effectual GoodCommunication specified: backfill commits bounded batches, rolls back a failing batch and resumes") { database { (config,db,archive) =>
    val original=Fixtures.snapshot()
    db.transaction { c =>
      (1 to 5).foreach { number =>
        val id=new UUID(0,number)
        val request=original.copy(source=original.source.copy(collectorNamespace=s"backfill-$number"),messages=original.messages.map(_.copy(text=if(number==5) "projection-reject" else "accepted")))
        Sql.exec(c,"INSERT INTO ch_sources(id,owner,source_key,revision) VALUES(?,'a',?,1)",id,s"backfill-$number")
        Sql.exec(c,"INSERT INTO ch_revisions VALUES(?,1,?::jsonb)",id,Wire.encode(IngestRequest.codecJson,request).noSpaces)
      }
      Sql.exec(c,"DELETE FROM ch_schema_migrations WHERE version=6")
      Sql.exec(c,"ALTER TABLE ch_archive_fragments ADD CONSTRAINT projection_reject CHECK(value<>'projection-reject')")
    }
    try {
      intercept[java.sql.SQLException](ArchiveProjection.backfill(db))
      db.transaction { c =>
        assertEquals(Sql.one(c,"SELECT count(*) FROM ch_revision_info")(_.getInt(1)),Some(4))
        assertEquals(Sql.one(c,"SELECT count(*) FROM ch_messages WHERE session_id=?",new UUID(0,5))(_.getInt(1)),Some(0))
        assertEquals(Sql.one(c,"SELECT count(*) FROM ch_schema_migrations WHERE version=6")(_.getInt(1)),Some(0))
      }
    } finally db.transaction(c => Sql.exec(c,"ALTER TABLE ch_archive_fragments DROP CONSTRAINT projection_reject"))
    ArchiveProjection.backfill(db); ArchiveProjection.backfill(db)
    db.transaction(c => assertEquals(Sql.one(c,"SELECT count(*) FROM ch_revision_info")(_.getInt(1)),Some(5)))
  }}
  test("Effectual GoodCommunication specified: failed ingest rolls back every projection and receipt") { database { (config,db,archive) =>
    db.transaction(c => Sql.exec(c,"ALTER TABLE ch_archive_fragments ADD CONSTRAINT projection_reject CHECK(value<>'projection-reject')"))
    val original=Fixtures.snapshot(); val request=original.copy(messages=original.messages.map(_.copy(text="projection-reject")))
    try intercept[java.sql.SQLException](archive.ingest("a",request,config.profile))
    finally db.transaction(c => Sql.exec(c,"ALTER TABLE ch_archive_fragments DROP CONSTRAINT projection_reject"))
    db.transaction { c =>
      List("ch_sources","ch_revisions","ch_revision_info","ch_messages","ch_archive_fragments","ch_ingest_receipts","ch_jobs").foreach { table =>
        assertEquals(Sql.one(c,s"SELECT count(*) FROM $table")(_.getInt(1)),Some(0),table)
      }
    }
  }}
  test("BG GoodCommunication specified: concurrent backfill, ingest and purge leave no missing or orphan projection") { database { (config,db,archive) =>
    val old=(1 to 6).map(_ => archive.ingest("a",Fixtures.snapshot(),config.profile)).toList
    db.transaction { c => Sql.exec(c,"DELETE FROM ch_revision_info"); Sql.exec(c,"DELETE FROM ch_messages"); Sql.exec(c,"DELETE FROM ch_archive_fragments") }
    val backfill=IO.blocking(ArchiveProjection.backfill(db))
    val mutate=IO.blocking {
      val next=archive.ingest("a",Fixtures.snapshot(),config.profile)
      db.transaction { c =>
        Sql.exec(c,"UPDATE ch_sources SET tombstone=true,published=NULL WHERE id=?",old.head.sessionId)
        Sql.exec(c,"DELETE FROM ch_jobs WHERE session_id=?",old.head.sessionId)
        Sql.exec(c,"DELETE FROM ch_revisions WHERE session_id=?",old.head.sessionId)
      }
      next
    }
    val (_,fresh)=IO.both(backfill,mutate).unsafeRunSync()
    ArchiveProjection.backfill(db)
    assertEquals(archive.messages("a",fresh.sessionId,0,100,Some(ContentView(1,None))).total,1)
    db.transaction { c =>
      assertEquals(Sql.one(c,"SELECT count(*) FROM ch_revisions r LEFT JOIN ch_revision_info i ON i.session_id=r.session_id AND i.revision=r.revision WHERE i.session_id IS NULL")(_.getInt(1)),Some(0))
      assertEquals(Sql.one(c,"SELECT count(*) FROM ch_messages WHERE session_id=?",old.head.sessionId)(_.getInt(1)),Some(0))
      assertEquals(Sql.one(c,"SELECT count(*) FROM ch_archive_fragments WHERE session_id=?",old.head.sessionId)(_.getInt(1)),Some(0))
    }
  }}
  test("Effectual GoodCommunication specified: actual trigram migration installs as a non-superuser database owner") {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh") }
    val config=Fixtures.config(); val suffix=UUID.randomUUID().toString.replace("-","")
    val role="archive_owner_"+suffix; val database="archive_migration_"+suffix
    val jdbc=config.jdbcUrl.substring(0,config.jdbcUrl.lastIndexOf('/')+1)+database
    Using.resource(DriverManager.getConnection(config.jdbcUrl,config.databaseUser,Config.credential(config.databasePasswordFile))) { admin =>
      Using.resource(admin.createStatement()) { statement =>
        statement.execute(s"CREATE ROLE $role LOGIN NOSUPERUSER")
        try {
          statement.execute(s"CREATE DATABASE $database OWNER $role")
          try Using.resource(DriverManager.getConnection(jdbc,role,"")) { connection =>
            Using.resource(connection.createStatement()) { setup =>
              setup.execute("CREATE TABLE ch_revisions(session_id uuid,revision integer,PRIMARY KEY(session_id,revision)); CREATE TABLE ch_generations(id uuid PRIMARY KEY); CREATE TABLE ch_chunks(generation uuid,value jsonb); CREATE TABLE ch_schema_migrations(version integer PRIMARY KEY)")
              val stream=getClass.getResourceAsStream("/006_archive_projection.sql")
              val migration=Using.resource(scala.io.Source.fromInputStream(stream))(_.mkString)
              setup.execute(migration)
            }
            assertEquals(Sql.one(connection,"SELECT rolsuper FROM pg_roles WHERE rolname=current_user")(_.getBoolean(1)),Some(false))
            assertEquals(Sql.one(connection,"SELECT extversion FROM pg_extension WHERE extname='pg_trgm'")(_.getString(1)),Some("1.6"))
          } finally statement.execute(s"DROP DATABASE $database")
        } finally statement.execute(s"DROP ROLE $role")
      }
    }
  }
  test("BG GoodCommunication specified: bounded idempotent backfill skips historic invalid timestamps and cascades purge") { database { (config,db,archive) =>
    val original=Fixtures.snapshot(); val out=archive.ingest("a",original.copy(messages=original.messages.map(_.copy(timestamp=Some("historically accepted")))),config.profile)
    db.transaction { c => Sql.exec(c,"DELETE FROM ch_revision_info"); Sql.exec(c,"DELETE FROM ch_messages"); Sql.exec(c,"DELETE FROM ch_archive_fragments") }
    ArchiveProjection.backfill(db); ArchiveProjection.backfill(db)
    assertEquals(archive.messages("a",out.sessionId,0,100,Some(ContentView(1,None))).messages.head.timestamp,Some("historically accepted"))
    db.transaction { c =>
      assertEquals(Sql.one(c,"SELECT count(*) FROM ch_revision_info")(_.getInt(1)),Some(1))
      assertEquals(Sql.one(c,"SELECT last_timestamp FROM ch_revision_info")(_.getString(1)),original.metadata.startedAt)
      Sql.exec(c,"DELETE FROM ch_revisions WHERE session_id=?",out.sessionId)
      assertEquals(Sql.one(c,"SELECT count(*) FROM ch_messages")(_.getInt(1)),Some(0))
      assertEquals(Sql.one(c,"SELECT count(*) FROM ch_archive_fragments")(_.getInt(1)),Some(0))
    }
  }}
}
