package chronicle

import chronicle.api.*
import java.nio.charset.StandardCharsets.UTF_8
import java.nio.file.Files
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
    val config=Fixtures.config(); val db=new Database(config,IndexProfileCatalog.legacyOnly(config)); db.initialize()
    db.transaction { c => Sql.exec(c,"TRUNCATE ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks,ch_groups,ch_members CASCADE"); Sql.exec(c,"UPDATE ch_profile SET active=?,target=?,maintenance=false",config.profile,config.profile); Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=0",config.profile) }
    f(config,db,new PostgresArchive(db,config))
  }
  test("BG GoodCommunication specified: metadata/message pages and locator use pinned projection independent of raw files") { database { (config,db,archive) =>
    val original=Fixtures.snapshot(); val out=archive.ingest("a",original)
    val view=ContentView(1,None)
    assertEquals(archive.locateMessage("a",out.sessionId,view,"u"),MessageLocation(view,0,1))
    // Deliberately corrupt this owned fixture; normal snapshot UPDATE is now forbidden.
    db.transaction { c =>
      Sql.exec(c,"ALTER TABLE ch_revisions DISABLE TRIGGER ch_immutable_revision")
      Sql.exec(c,"UPDATE ch_revisions SET snapshot=jsonb_set(snapshot,'{files}',?::jsonb) WHERE session_id=?","null",out.sessionId)
      Sql.exec(c,"ALTER TABLE ch_revisions ENABLE TRIGGER ch_immutable_revision")
    }
    assertEquals(archive.readSession("a",out.sessionId,Some(view)).session.metadata,original.metadata)
    assertEquals(archive.messages("a",out.sessionId,0,100,Some(view)).messages,original.messages)
    assertEquals(intercept[DomainError](archive.locateMessage("b",out.sessionId,view,"u")).code,"not-found")
    assertEquals(intercept[DomainError](archive.locateMessage("a",out.sessionId,view,"absent")).code,"not-found")
    assertEquals(intercept[DomainError](archive.locateMessage("a",out.sessionId,ContentView(2,None),"u")).code,"not-found")
  }}
  test("Effectual GoodCommunication regression: canonical lexical GIN indexes the stored Unicode column, not a redundant lower expression") { database { (config,db,archive) =>
    db.transaction { c =>
      val (expression,key,valueAttribute,indexCollation,columnCollation,operatorClass,method,keyCount,valid,ready)=Sql.one(c,"SELECT pg_get_expr(i.indexprs,i.indrelid),i.indkey::text,a.attnum,ic.collname,ac.collname,op.opcname,am.amname,i.indnatts,i.indisvalid,i.indisready FROM pg_index i JOIN pg_class ix ON ix.oid=i.indexrelid JOIN pg_am am ON am.oid=ix.relam JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attname='value' JOIN pg_collation ic ON ic.oid=i.indcollation[0] JOIN pg_collation ac ON ac.oid=a.attcollation JOIN pg_opclass op ON op.oid=i.indclass[0] WHERE i.indexrelid='ch_archive_fragments_lower_trgm'::regclass AND i.indrelid='ch_archive_fragments'::regclass") { r =>
        (Option(r.getString(1)),r.getString(2),r.getInt(3),r.getString(4),r.getString(5),r.getString(6),r.getString(7),r.getInt(8),r.getBoolean(9),r.getBoolean(10))
      }.get
      assertEquals(expression,Option.empty[String],"canonical GIN must have pg_index.indexprs IS NULL: fragments are already whole-field lowered")
      assertEquals(key,valueAttribute.toString,"indkey must reference ch_archive_fragments.value, not expression attribute 0")
      assertEquals(indexCollation,"pg_unicode_fast"); assertEquals(columnCollation,"pg_unicode_fast")
      assertEquals(operatorClass,"gin_trgm_ops"); assertEquals(method,"gin"); assertEquals(keyCount,1)
      assert(valid && ready,"canonical stored-column GIN must be valid and ready")
    }
  }}
  test("Effectual GoodCommunication regression: maximum-width high-entropy literal fragments remain ingestible") { database { (config,db,archive) =>
    val alphabet="abcdefghijklmnopqrstuvwxyz0123456789"; val random=new scala.util.Random(0L)
    val text=List.fill(ArchiveProjection.fragmentBytes)(alphabet.charAt(random.nextInt(alphabet.length))).mkString
    val original=Fixtures.snapshot(); val request=original.copy(messages=original.messages.map(_.copy(text=text)))
    val out=archive.ingest("a",request)
    assertEquals(archive.messages("a",out.sessionId,0,100,Some(ContentView(1,None))).messages,request.messages)
    db.transaction(c => assertEquals(Sql.one(c,"SELECT count(*) FROM ch_archive_fragments WHERE session_id=? AND value=?",out.sessionId,text)(_.getInt(1)),Some(1)))
  }}
  test("BG GoodCommunication specified: credential failure prevents the post-backfill index migration") { database { (config,db,archive) =>
    db.transaction { c =>
      Sql.exec(c,"DROP INDEX ch_archive_fragments_lower_trgm")
      Sql.exec(c,"CREATE INDEX ch_archive_fragments_lower_trgm ON ch_archive_fragments USING gin((lower(value COLLATE pg_unicode_fast)) gin_trgm_ops)")
      Sql.exec(c,"DELETE FROM ch_schema_migrations WHERE version=17")
    }
    def indexIdentity = db.transaction(c => Sql.one(c,"SELECT c.oid,c.relfilenode,pg_get_expr(i.indexprs,i.indrelid) FROM pg_class c JOIN pg_index i ON i.indexrelid=c.oid WHERE c.oid='ch_archive_fragments_lower_trgm'::regclass")(r => (r.getLong(1),r.getLong(2),Option(r.getString(3))))).get
    val legacy=indexIdentity
    val directory=Files.createTempDirectory("chronicle-index-rollback")
    try {
      val broken=config.copy(users=config.users.map(_.copy(passwordHashFile=directory.resolve("absent").toString)))
      intercept[ponygirls.runtime.RuntimeFailure](new Database(broken,db.profiles).initialize())
      assertEquals(indexIdentity,legacy,"credential failure must leave the original index bytes and identity unchanged")
      db.transaction(c => assertEquals(Sql.one(c,"SELECT count(*) FROM ch_schema_migrations WHERE version=17")(_.getInt(1)),Some(0)))
      db.initialize()
      assert(indexIdentity._1!=legacy._1)
      assertEquals(indexIdentity._3,Option.empty[String])
    } finally Files.deleteIfExists(directory)
  }}
  test("BG GoodCommunication regression: initialize recreates a missing stored-column GIN after migration17") { database { (config,db,archive) =>
    db.transaction { c =>
      assertEquals(Sql.one(c,"SELECT count(*) FROM ch_schema_migrations WHERE version=17")(_.getInt(1)),Some(1))
      Sql.exec(c,"DROP INDEX ch_archive_fragments_lower_trgm")
    }
    db.initialize()
    db.transaction { c =>
      assertEquals(Sql.one(c,"SELECT pg_get_expr(indexprs,indrelid) FROM pg_index WHERE indexrelid='ch_archive_fragments_lower_trgm'::regclass")(r => Option(r.getString(1))),Some(Option.empty[String]),"recovery must restore the current stored-column representation")
      assertEquals(Sql.one(c,"SELECT pg_get_expr(indpred,indrelid) FROM pg_index WHERE indexrelid='ch_archive_fragments_lower_trgm'::regclass")(_.getString(1)),Some("head_candidate"))
    }
  }}
  test("Effectual GoodCommunication regression: migrated startup recovers projections and GIN without revisiting source revisions") { database { (config,db,archive) =>
    val original=Fixtures.snapshot(); val out=archive.ingest("a",original)
    archive.ingest("a",original.copy(requestId=UUID.randomUUID(),expectedRevision=1))
    db.transaction { c =>
      Sql.exec(c,"UPDATE ch_revision_info SET lexical_version=0 WHERE session_id=? AND revision=1",out.sessionId)
      Sql.exec(c,"DELETE FROM ch_revision_info WHERE session_id=? AND revision=2",out.sessionId)
      Sql.exec(c,"DELETE FROM ch_messages WHERE session_id=? AND revision=2",out.sessionId)
      Sql.exec(c,"DELETE FROM ch_archive_fragments WHERE session_id=? AND revision=2",out.sessionId)
      Sql.exec(c,"DROP INDEX ch_archive_fragments_lower_trgm")
      Sql.exec(c,"CREATE FUNCTION reject_startup_revision_sweep() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION USING ERRCODE = ''P0001'', MESSAGE = ''startup revisited source revisions''; END;'")
      Sql.exec(c,"CREATE TRIGGER reject_startup_revision_sweep BEFORE UPDATE OF revision ON ch_sources FOR EACH STATEMENT EXECUTE FUNCTION reject_startup_revision_sweep()")
    }
    try {
      db.initialize(); db.initialize()
      db.transaction { c =>
        assertEquals(Sql.one(c,"SELECT pg_get_expr(indpred,indrelid) FROM pg_index WHERE indexrelid='ch_archive_fragments_lower_trgm'::regclass")(_.getString(1)),Some("head_candidate"))
        assertEquals(Sql.one(c,"SELECT count(*) FROM ch_archive_fragments WHERE session_id=? AND revision=2 AND NOT head_candidate",out.sessionId)(_.getInt(1)),Some(0))
        assert(Sql.one(c,"SELECT count(*) FROM ch_archive_fragments WHERE session_id=? AND revision=1 AND head_candidate",out.sessionId)(_.getInt(1)).get>0,"rebuilt historical TRUE extras are permitted; startup must not require archive-wide compaction")
        assertEquals(Sql.rows(c,"SELECT lexical_version FROM ch_revision_info WHERE session_id=? ORDER BY revision",out.sessionId)(_.getInt(1)),List.fill(2)(ArchiveProjection.lexicalVersion))
      }
      List(1,2).foreach { revision =>
        assertEquals(archive.messages("a",out.sessionId,0,100,Some(ContentView(revision,None))).messages,original.messages)
        assertEquals(archive.raw("a",out.sessionId,Some(revision)).files,original.files)
      }
    } finally db.transaction { c =>
      Sql.exec(c,"DROP TRIGGER reject_startup_revision_sweep ON ch_sources")
      Sql.exec(c,"DROP FUNCTION reject_startup_revision_sweep()")
    }
  }}
  test("BG GoodCommunication regression: initialize repairs obsolete and missing whole-field projections, then preserves bytes and GIN identity") { database { (config,db,archive) =>
    val original=Fixtures.snapshot(); val text="aΣ"+"\u0301"*5000+"b İSTANBUL KELVIN %_\\"
    val request=original.copy(metadata=original.metadata.copy(title=text),messages=original.messages.map(_.copy(text=text)))
    val receipt=archive.ingest("a",request)
    val missing=archive.ingest("a",request.copy(requestId=UUID.randomUUID(),source=request.source.copy(collectorNamespace="missing-"+UUID.randomUUID())))
    def fragments = db.transaction(c => Sql.rows(c,"SELECT session_id,revision,ordinal,value FROM ch_archive_fragments ORDER BY session_id,revision,ordinal")(r => (r.getObject(1,classOf[UUID]),r.getInt(2),r.getInt(3),r.getString(4))))
    def indexIdentity = db.transaction(c => Sql.one(c,"SELECT c.oid,c.relfilenode FROM pg_class c WHERE c.oid='ch_archive_fragments_lower_trgm'::regclass")(r => (r.getLong(1),r.getLong(2)))).get
    val expectedFragments=fragments
    db.transaction { c =>
      Sql.exec(c,"DROP INDEX ch_archive_fragments_lower_trgm")
      Sql.exec(c,"CREATE INDEX ch_archive_fragments_lower_trgm ON ch_archive_fragments USING gin((lower(value COLLATE pg_unicode_fast)) gin_trgm_ops)")
      Sql.exec(c,"DELETE FROM ch_schema_migrations WHERE version=17")
    }
    val legacyIndex=indexIdentity
    db.transaction { c =>
      Sql.exec(c,"UPDATE ch_revision_info SET lexical_version=0 WHERE session_id=?",receipt.sessionId)
      Sql.exec(c,"DELETE FROM ch_archive_fragments WHERE session_id=?",receipt.sessionId)
      ArchiveProjection.fragments(text).zipWithIndex.foreach { case (value,ordinal) => Sql.exec(c,"INSERT INTO ch_archive_fragments(session_id,revision,ordinal,value) VALUES(?,1,?,?)",receipt.sessionId,ordinal,value) }
      Sql.exec(c,"DELETE FROM ch_revision_info WHERE session_id=?",missing.sessionId)
      Sql.exec(c,"DELETE FROM ch_messages WHERE session_id=?",missing.sessionId)
      Sql.exec(c,"DELETE FROM ch_archive_fragments WHERE session_id=?",missing.sessionId)
    }
    db.initialize()
    val upgradedIndex=indexIdentity
    assert(upgradedIndex._1!=legacyIndex._1,s"startup must replace the populated legacy expression GIN: legacy=$legacyIndex current=$upgradedIndex")
    db.transaction(c => assertEquals(Sql.one(c,"SELECT indexprs IS NULL FROM pg_index WHERE indexrelid='ch_archive_fragments_lower_trgm'::regclass")(_.getBoolean(1)),Some(true),"upgraded canonical GIN must index the stored column, not lower(value)"))
    assertEquals(fragments,expectedFragments,"startup must restore exactly the whole-field-lowered fragments")
    db.initialize()
    assertEquals(indexIdentity,upgradedIndex,"repeated initialize must preserve canonical index OID and relfilenode")
    assertEquals(fragments,expectedFragments,"repeated initialize must not rewrite canonical fragments")
    List(receipt,missing).foreach { out =>
      assertEquals(archive.messages("a",out.sessionId,0,100,Some(ContentView(1,None))).messages,request.messages)
      assertEquals(archive.raw("a",out.sessionId,Some(1)).files,request.files)
    }
    db.transaction { c =>
      assertEquals(Sql.rows(c,"SELECT lexical_version FROM ch_revision_info ORDER BY session_id")(_.getInt(1)),List.fill(2)(ArchiveProjection.lexicalVersion))
      assertEquals(Sql.one(c,"SELECT count(*) FROM ch_archive_fragments WHERE convert_to(value,'UTF8')<>convert_to(lower(value COLLATE pg_unicode_fast),'UTF8')")(_.getInt(1)),Some(0))
      assertEquals(Sql.one(c,"SELECT count(*) FROM ch_archive_fragments WHERE session_id=? AND value LIKE '%σ%'",receipt.sessionId)(_.getInt(1)),Some(2))
      assertEquals(Sql.one(c,"SELECT count(*) FROM ch_archive_fragments WHERE session_id=? AND value LIKE '%ς%'",receipt.sessionId)(_.getInt(1)),Some(0))
    }
  }}
  test("Effectual GoodCommunication specified: initialization defers its index migration until bounded backfill succeeds") { database { (config,db,archive) =>
    val original=Fixtures.snapshot()
    def indexIdentity = db.transaction(c => Sql.one(c,"SELECT c.oid,c.relfilenode FROM pg_class c WHERE c.oid='ch_archive_fragments_lower_trgm'::regclass")(r => (r.getLong(1),r.getLong(2)))).get
    db.transaction { c =>
      (1 to 5).foreach { number =>
        val id=new UUID(0,number)
        val request=original.copy(source=original.source.copy(collectorNamespace=s"backfill-$number"),messages=original.messages.map(_.copy(text=if(number==5) "projection-reject" else "accepted")))
        Sql.exec(c,"INSERT INTO ch_sources(id,owner,source_key,revision) VALUES(?,'a',?,1)",id,s"backfill-$number")
        Sql.exec(c,"INSERT INTO ch_revisions VALUES(?,1,?::jsonb)",id,Wire.encode(IngestRequest.codecJson,request).noSpaces)
      }
      Sql.exec(c,"DELETE FROM ch_schema_migrations WHERE version IN(6,17)")
      Sql.exec(c,"DROP INDEX ch_archive_fragments_lower_trgm")
      Sql.exec(c,"CREATE INDEX ch_archive_fragments_lower_trgm ON ch_archive_fragments USING gin((lower(value COLLATE pg_unicode_fast)) gin_trgm_ops)")
      Sql.exec(c,"ALTER TABLE ch_archive_fragments ADD CONSTRAINT projection_reject CHECK(value<>'projection-reject')")
    }
    val legacy=indexIdentity
    try {
      intercept[java.sql.SQLException](db.initialize())
      assertEquals(indexIdentity,legacy)
      db.transaction { c =>
        assertEquals(Sql.one(c,"SELECT count(*) FROM ch_revision_info")(_.getInt(1)),Some(4))
        assertEquals(Sql.one(c,"SELECT count(*) FROM ch_messages WHERE session_id=?",new UUID(0,5))(_.getInt(1)),Some(0))
        assertEquals(Sql.one(c,"SELECT count(*) FROM ch_schema_migrations WHERE version=6")(_.getInt(1)),Some(0))
        assertEquals(Sql.one(c,"SELECT count(*) FROM ch_schema_migrations WHERE version=17")(_.getInt(1)),Some(0))
        assertEquals(Sql.one(c,"SELECT indexprs IS NULL FROM pg_index WHERE indexrelid='ch_archive_fragments_lower_trgm'::regclass")(_.getBoolean(1)),Some(false))
      }
    } finally db.transaction(c => Sql.exec(c,"ALTER TABLE ch_archive_fragments DROP CONSTRAINT projection_reject"))
    db.initialize()
    val migrated=indexIdentity
    assert(migrated._1!=legacy._1)
    db.initialize()
    assertEquals(indexIdentity,migrated,"repeated startup must preserve the committed post-backfill migration")
    db.transaction(c => assertEquals(Sql.one(c,"SELECT count(*) FROM ch_revision_info")(_.getInt(1)),Some(5)))
  }}
  test("Effectual GoodCommunication specified: populated column-less archive with prior migration16 upgrades without changing fragment bytes") { database { (config,db,archive) =>
    val request=Fixtures.snapshot(); val out=archive.ingest("a",request)
    archive.ingest("a",request.copy(requestId=UUID.randomUUID(),expectedRevision=1))
    def fragments = db.transaction(c => Sql.rows(c,"SELECT revision,ordinal,value FROM ch_archive_fragments WHERE session_id=? ORDER BY revision,ordinal",out.sessionId)(r => (r.getInt(1),r.getInt(2),r.getString(3))))
    val before=fragments
    db.transaction { c =>
      Sql.exec(c,"DROP TRIGGER ch_archive_head_candidates ON ch_sources")
      Sql.exec(c,"ALTER TABLE ch_archive_fragments DROP COLUMN head_candidate CASCADE")
      Sql.exec(c,"CREATE INDEX ch_archive_fragments_lower_trgm ON ch_archive_fragments USING gin((lower(value COLLATE pg_unicode_fast)) gin_trgm_ops)")
      Sql.exec(c,"DELETE FROM ch_schema_migrations WHERE version=17")
      Sql.exec(c,"INSERT INTO ch_schema_migrations VALUES(16) ON CONFLICT DO NOTHING")
    }
    db.initialize(); db.initialize()
    assertEquals(fragments,before)
    db.transaction { c =>
      assertEquals(Sql.one(c,"SELECT count(*) FROM ch_schema_migrations WHERE version IN(16,17)")(_.getInt(1)),Some(2))
      assertEquals(Sql.one(c,"SELECT count(*) FROM ch_archive_fragments f JOIN ch_sources s ON s.id=f.session_id AND s.revision=f.revision WHERE NOT head_candidate")(_.getInt(1)),Some(0))
      assertEquals(Sql.one(c,"SELECT count(*) FROM ch_archive_fragments WHERE session_id=? AND revision=1 AND head_candidate",out.sessionId)(_.getInt(1)),Some(0))
    }
    assertEquals(archive.messages("a",out.sessionId,0,100,Some(ContentView(1,None))).messages,request.messages)
  }}
  test("Effectual GoodCommunication specified: migration failure rolls back the partial index, mask changes and marker together") { database { (config,db,archive) =>
    val request=Fixtures.snapshot(); val out=archive.ingest("a",request)
    archive.ingest("a",request.copy(requestId=UUID.randomUUID(),expectedRevision=1))
    db.transaction { c =>
      Sql.exec(c,"UPDATE ch_archive_fragments SET head_candidate=true WHERE session_id=? AND revision=1",out.sessionId)
      Sql.exec(c,"DROP INDEX ch_archive_fragments_lower_trgm")
      Sql.exec(c,"CREATE INDEX ch_archive_fragments_lower_trgm ON ch_archive_fragments USING gin((lower(value COLLATE pg_unicode_fast)) gin_trgm_ops)")
      Sql.exec(c,"DELETE FROM ch_schema_migrations WHERE version=17")
      Sql.exec(c,"ALTER TABLE ch_schema_migrations ADD CONSTRAINT reject_head_migration CHECK(version<>17)")
    }
    def identity = db.transaction(c => Sql.one(c,"SELECT ix.oid,ix.relfilenode,pg_get_expr(i.indexprs,i.indrelid) FROM pg_class ix JOIN pg_index i ON i.indexrelid=ix.oid WHERE ix.oid='ch_archive_fragments_lower_trgm'::regclass")(r => (r.getLong(1),r.getLong(2),Option(r.getString(3))))).get
    val legacy=identity
    val flags=db.transaction(c => Sql.rows(c,"SELECT revision,ordinal,head_candidate FROM ch_archive_fragments WHERE session_id=? ORDER BY revision,ordinal",out.sessionId)(r => (r.getInt(1),r.getInt(2),r.getBoolean(3))))
    try {
      assertEquals(intercept[java.sql.SQLException](db.initialize()).getSQLState,"23514")
      assertEquals(identity,legacy)
      db.transaction { c =>
        assertEquals(Sql.one(c,"SELECT count(*) FROM ch_schema_migrations WHERE version=17")(_.getInt(1)),Some(0))
        assertEquals(Sql.rows(c,"SELECT revision,ordinal,head_candidate FROM ch_archive_fragments WHERE session_id=? ORDER BY revision,ordinal",out.sessionId)(r => (r.getInt(1),r.getInt(2),r.getBoolean(3))),flags)
      }
    } finally db.transaction(c => Sql.exec(c,"ALTER TABLE ch_schema_migrations DROP CONSTRAINT reject_head_migration"))
    db.initialize()
    assert(identity._1!=legacy._1)
    db.transaction(c => assertEquals(Sql.one(c,"SELECT pg_get_expr(indpred,indrelid) FROM pg_index WHERE indexrelid='ch_archive_fragments_lower_trgm'::regclass")(_.getString(1)),Some("head_candidate")))
  }}
  test("Effectual GoodCommunication specified: failed ingest rolls back every projection and receipt") { database { (config,db,archive) =>
    db.transaction(c => Sql.exec(c,"ALTER TABLE ch_archive_fragments ADD CONSTRAINT projection_reject CHECK(value<>'projection-reject')"))
    val original=Fixtures.snapshot(); val request=original.copy(messages=original.messages.map(_.copy(text="projection-reject")))
    try intercept[java.sql.SQLException](archive.ingest("a",request))
    finally db.transaction(c => Sql.exec(c,"ALTER TABLE ch_archive_fragments DROP CONSTRAINT projection_reject"))
    db.transaction { c =>
      List("ch_sources","ch_revisions","ch_revision_info","ch_messages","ch_archive_fragments","ch_ingest_receipts","ch_jobs").foreach { table =>
        assertEquals(Sql.one(c,s"SELECT count(*) FROM $table")(_.getInt(1)),Some(0),table)
      }
    }
  }}
  test("BG GoodCommunication specified: concurrent backfill, ingest and purge leave no missing or orphan projection") { database { (config,db,archive) =>
    val old=(1 to 6).map(_ => archive.ingest("a",Fixtures.snapshot())).toList
    db.transaction { c => Sql.exec(c,"DELETE FROM ch_revision_info"); Sql.exec(c,"DELETE FROM ch_messages"); Sql.exec(c,"DELETE FROM ch_archive_fragments") }
    val backfill=IO.blocking(ArchiveProjection.backfill(db))
    val mutate=IO.blocking {
      val next=archive.ingest("a",Fixtures.snapshot())
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
        statement.execute(s"CREATE ROLE $role LOGIN PASSWORD '${Fixtures.databasePassword}' NOSUPERUSER")
        try {
          statement.execute(s"CREATE DATABASE $database OWNER $role")
          try Using.resource(DriverManager.getConnection(jdbc,role,Fixtures.databasePassword)) { connection =>
            Using.resource(connection.createStatement()) { setup =>
              setup.execute("CREATE TABLE ch_users(id text PRIMARY KEY); CREATE TABLE ch_sources(id uuid PRIMARY KEY,revision integer NOT NULL); CREATE TABLE ch_revisions(session_id uuid,revision integer,PRIMARY KEY(session_id,revision)); CREATE TABLE ch_generations(id uuid PRIMARY KEY); CREATE TABLE ch_chunks(generation uuid,value jsonb); CREATE TABLE ch_schema_migrations(version integer PRIMARY KEY)")
              List("/006_archive_projection.sql","/017_head_literal_candidates.sql").foreach { file =>
                val stream=getClass.getResourceAsStream(file)
                Check(stream!=null,"test","missing migration resource")
                val migration=Using.resource(scala.io.Source.fromInputStream(stream))(_.mkString)
                setup.execute(migration)
              }
            }
            assertEquals(Sql.one(connection,"SELECT rolsuper FROM pg_roles WHERE rolname=current_user")(_.getBoolean(1)),Some(false))
            assertEquals(Sql.one(connection,"SELECT extversion FROM pg_extension WHERE extname='pg_trgm'")(_.getString(1)),Some("1.6"))
            assertEquals(Sql.one(connection,"SELECT count(*) FROM ch_schema_migrations WHERE version=17")(_.getInt(1)),Some(1))
            assertEquals(Sql.one(connection,"SELECT indexprs IS NULL FROM pg_index WHERE indexrelid='ch_archive_fragments_lower_trgm'::regclass")(_.getBoolean(1)),Some(true))
          } finally statement.execute(s"DROP DATABASE $database")
        } finally statement.execute(s"DROP ROLE $role")
      }
    }
  }
  test("BG GoodCommunication specified: bounded idempotent backfill skips historic invalid timestamps and cascades purge") { database { (config,db,archive) =>
    val original=Fixtures.snapshot(); val out=archive.ingest("a",original.copy(messages=original.messages.map(_.copy(timestamp=Some("historically accepted")))))
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
