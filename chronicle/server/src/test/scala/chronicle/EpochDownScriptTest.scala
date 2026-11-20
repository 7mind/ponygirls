package chronicle

import chronicle.api.*
import io.circe.Json
import java.nio.file.{Files,Path}
import java.sql.{Connection,DriverManager}
import java.util.{Properties,UUID}
import scala.concurrent.duration.*

/** The S1 down-script scripts/down-024-epoch-layout.sql, run as the operator runs it (psql -f), on copies of one fresh
  * database of the current binary. */
final class EpochDownScriptTest extends munit.FunSuite {
  override val munitTimeout=3.minutes
  private val script=Path.of("scripts","down-024-epoch-layout.sql")
  private val original=Fixtures.config()
  private def url(database: String): String = original.jdbcUrl.take(original.jdbcUrl.lastIndexOf('/')+1)+database
  private val maintenance=original.jdbcUrl.drop(original.jdbcUrl.lastIndexOf('/')+1)
  private def connected[A](database: String)(f: Connection => A): A = {
    val properties=new Properties; properties.setProperty("user",original.databaseUser); properties.setProperty("password",Fixtures.databasePassword)
    val connection=DriverManager.getConnection(url(database),properties)
    try f(connection) finally connection.close()
  }
  private def admin(database: String,statements: String*): Unit = connected(database)(c => statements.foreach(sql => Sql.exec(c,sql)))
  private val fresh=new Fixture[String]("fresh database of the current binary") {
    private var name=Option.empty[String]
    def apply(): String = name.getOrElse(fail("fresh database was not created"))
    override def beforeAll(): Unit = {
      Check(sys.env.contains("CHRONICLE_TEST_JDBC"),"test","owned PostgreSQL fixture required")
      val created="down024_"+UUID.randomUUID().toString.replace("-","")
      admin(maintenance,s"CREATE DATABASE $created"); name=Some(created)
      admin(created,"CREATE EXTENSION vector","CREATE EXTENSION pg_trgm")
      val config=original.copy(jdbcUrl=url(created)); val db=new Database(config,IndexProfileCatalog.current(config))
      try db.initialize() finally db.close()
    }
    override def afterAll(): Unit = name.foreach(created => admin(maintenance,s"DROP DATABASE $created WITH (FORCE)"))
  }
  override def munitFixtures = List(fresh)
  private def copy[A](body: String => A): A = {
    val name="down024_case_"+UUID.randomUUID().toString.replace("-","")
    admin(maintenance,s"CREATE DATABASE $name TEMPLATE ${fresh()}")
    try body(name) finally admin(maintenance,s"DROP DATABASE $name WITH (FORCE)")
  }
  /** The current binary on the database: its start-up, an Epochs archive and a Legacy one; closed afterwards, so the
    * script sees no other client. */
  private def binary[A](database: String)(f: (PostgresArchive,PostgresArchive) => A): A = {
    val config=original.copy(jdbcUrl=url(database)); val db=new Database(config,IndexProfileCatalog.current(config))
    try { db.initialize(); f(new PostgresArchive(db,config,RevisionLayoutPolicy.Epochs),new PostgresArchive(db,config,RevisionLayoutPolicy.Legacy)) } finally db.close()
  }

  private final case class Ran(exit: Int,lines: List[String],err: String) {
    def last: String = lines.lastOption.getOrElse("")
    def values(key: String): List[String] = lines.filter(_.startsWith(s"DOWN024.$key|")).map(_.drop(key.length+9))
    def value(key: String): String = values(key) match { case List(one) => one; case other => fail(s"DOWN024.$key: $other\n${lines.mkString("\n")}\n$err") }
  }
  private def run(database: String,variables: (String,String)*): Ran = {
    val psql=Path.of(sys.env.getOrElse("POSTGRES_HOME",throw DomainError("test","POSTGRES_HOME required (nix develop .#chronicle)")),"bin","psql").toString
    val address=original.jdbcUrl.stripPrefix("jdbc:postgresql://").takeWhile(_!='/')
    val connection=Map("PGHOST"->address.takeWhile(_!=':'),"PGPORT"->address.dropWhile(_!=':').drop(1),
      "PGUSER"->original.databaseUser,"PGPASSWORD"->Fixtures.databasePassword,"PGDATABASE"->database,
      // The service's tables are in public: a session whose search_path does not reach them must still find them.
      "PGOPTIONS"->"-c search_path=down_nowhere")
    val arguments=variables.toList.flatMap((name,value) => List("-v",s"$name=$value"))
    val ran=CheckChild.run(List(psql,"-X","-q","-v","ON_ERROR_STOP=1")++arguments++List("-f",script.toString),sys.env,connection,90.seconds)
    Ran(ran.exit,ran.out.linesIterator.toList,ran.err)
  }
  private def preflight(database: String): Ran = { val ran=run(database,"mode"->"preflight"); assertEquals((ran.exit,ran.last),(0,"DOWN024.result|preflight-complete"),ran.err); ran }
  private def apply(database: String,plan: String,more: (String,String)*): Ran =
    run(database,(List("mode"->"apply","apply_irreversible"->"yes","confirm_database"->database,"expect_plan"->plan,"backup_reference"->"test-copy:none")++more)*)
  private def refused(ran: Ran,result: String): Unit = { assertEquals((ran.exit,ran.last),(3,s"DOWN024.result|$result"),ran.lines.mkString("\n")+"\n"+ran.err) }
  /** Everything the script may change, while the epoch layout exists. */
  private def census(database: String): String = connected(database)(c => Sql.one(c,"""SELECT md5(concat_ws('#',
      (SELECT string_agg(md5(to_jsonb(r)::text),',' ORDER BY session_id,revision) FROM ch_revisions r),
      (SELECT string_agg(concat_ws('|',id,session_id,octet_length(raw_path),candidates),',' ORDER BY id) FROM ch_epochs),
      (SELECT string_agg(md5(to_jsonb(x)::text),',' ORDER BY epoch,position) FROM ch_epoch_messages x),
      (SELECT string_agg(md5(to_jsonb(x)::text),',' ORDER BY epoch,byte_offset) FROM ch_epoch_raw x),
      (SELECT string_agg(md5(to_jsonb(x)::text),',' ORDER BY epoch,record_index,record_key) FROM ch_epoch_records x),
      (SELECT string_agg(md5(to_jsonb(x)::text),',' ORDER BY epoch,position,part) FROM ch_epoch_fragments x),
      (SELECT string_agg(md5(to_jsonb(x)::text),',' ORDER BY session_id,revision,position) FROM ch_messages x),
      (SELECT string_agg(md5(to_jsonb(x)::text),',' ORDER BY session_id,revision,ordinal) FROM ch_archive_fragments x),
      (SELECT string_agg(to_jsonb(x)::text,',' ORDER BY id) FROM ch_sources x),
      (SELECT string_agg(to_jsonb(x)::text,',' ORDER BY id) FROM ch_jobs x),
      (SELECT string_agg(version::text,',' ORDER BY version) FROM ch_schema_migrations),
      (SELECT string_agg(attname,',' ORDER BY attnum) FROM pg_attribute WHERE attrelid='ch_revisions'::regclass AND attnum>0 AND NOT attisdropped)))""")(_.getString(1)).get)
  /** The pre-024 schema: no epoch table or column, snapshots required, migration 013's immutability body. */
  private def downgraded(database: String): Unit = connected(database) { c =>
    assertEquals(Sql.one(c,"SELECT to_regclass('ch_epochs') IS NULL AND to_regclass('ch_epoch_messages') IS NULL")(_.getBoolean(1)),Some(true))
    assertEquals(Sql.rows(c,"SELECT attname||':'||attnotnull FROM pg_attribute WHERE attrelid='ch_revisions'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum")(_.getString(1)),
      List("session_id:true","revision:true","snapshot:true","binding_id:true"))
    assertEquals(Sql.one(c,"SELECT count(*) FROM ch_schema_migrations WHERE version=24")(_.getInt(1)),Some(0))
    assert(!Sql.one(c,"SELECT pg_get_functiondef('ch_immutable_revision'::regproc)")(_.getString(1)).get.contains("epoch"))
  }

  private def request(identity: SourceIdentity,expected: Int,records: List[(String,String)]): IngestRequest = {
    val raw=records.map((id,text) => Json.obj("id"->Json.fromString(id),"text"->Json.fromString(text)).noSpaces+"\n").mkString
    val messages=records.zipWithIndex.map { case ((id,text),index) => Message(id,None,"user",text,Some(s"2026-01-01T00:00:${10+index}Z"),index) }
    Fixtures.snapshot().copy(requestId=UUID.randomUUID(),source=identity,expectedRevision=expected,digest=Wire.hash(raw),messages=messages,files=List(RawFile("session.jsonl",Wire.hash(raw),raw)))
  }
  /** Reads of every revision of a session through the current binary. */
  private def reads(archive: PostgresArchive,owner: String,id: UUID): List[Any] = {
    val head=archive.session(owner,id).revision
    (1 to head).toList.flatMap { revision =>
      val view=ContentView(revision,None); val page=archive.messages(owner,id,0,100,Some(view))
      List(page,archive.raw(owner,id,Some(revision)),archive.searchSessionMessages(owner,id,view,"needle",None,10))++page.messages.map(m => archive.locateMessage(owner,id,view,m.id))
    }
  }

  test("an exact down: the dry-run changes nothing, a cut apply resumes from a new preflight, converted revisions equal a Legacy ingest, the worst-case bound holds and the reads are unchanged") { copy { database =>
    val identity=SourceIdentity(UUID.randomUUID().toString,"native",SourceFormat.Pi,"session",None)
    // A new epoch, an append, a non-prefix revision (a new epoch) and an append.
    val history=List(
      List("u1"->"first needle","a1"->"answer"),
      List("u1"->"first needle","a1"->"answer","u2"->"appended Σ needle"),
      List("u1"->"[redacted]","a1"->"answer","u2"->"appended Σ needle"),
      List("u1"->"[redacted]","a1"->"answer","u2"->"appended Σ needle","a2"->"x"*5000)).zipWithIndex.map((records,expected) => request(identity,expected,records))
    // Many tiny messages with nulls and the largest record index: the most jsonb overhead per stored byte.
    val records=100000
    val tinyRaw="{}\n"*records
    val tiny=Fixtures.snapshot().copy(digest=Wire.hash(tinyRaw),messages=List.tabulate(5000)(i => Message(s"t$i",None,"u","",None,records-1)),files=List(RawFile("tiny.jsonl",Wire.hash(tinyRaw),tinyRaw)))
    val (epochSession,legacySession,tinySession,before,binding)=binary(database) { (epochs,legacy) =>
      val receipts=history.map(revision => (epochs.ingest("a",revision),legacy.ingest("b",revision)))
      val (e,l)=(receipts.last._1.sessionId,receipts.last._2.sessionId)
      val t=epochs.ingest("a",tiny).sessionId
      (e,l,t,reads(epochs,"a",e)++reads(epochs,"a",t),connected(database)(c => Sql.rows(c,"SELECT concat_ws('|',session_id,revision,binding_id) FROM ch_revisions ORDER BY 1")(_.getString(1))))
    }
    val jobs=connected(database)(c => Sql.rows(c,"SELECT to_jsonb(j)::text FROM ch_jobs j ORDER BY id")(_.getString(1)))
    val unchanged=census(database)
    val dry=run(database,"mode"->"dry-run")
    assertEquals((dry.exit,dry.last,dry.value("converted_sources")),(0,"DOWN024.result|dry-run-rolled-back","2"),dry.err)
    assertEquals(census(database),unchanged)

    val first=preflight(database)
    assertEquals((first.value("epoch_revisions"),first.value("non_downgradable"),first.values("non_downgradable_owner")),("5","0|sources=0",Nil))
    val List(largestSession,largestRevision,bound)=first.value("largest_bound").split('|').toList: @unchecked
    assertEquals((UUID.fromString(largestSession),largestRevision),(tinySession,"1"))
    val cut=apply(database,first.value("plan"),"max_sources"->"1")
    assert(cut.last.startsWith("DOWN024.result|incomplete|remaining="),cut.lines.mkString("\n"))
    assertEquals((cut.exit,cut.value("converted_sources")),(3,"1"))
    val afterCut=census(database)
    refused(apply(database,first.value("plan")),"refused-stale-plan")
    assertEquals(census(database),afterCut)
    val second=preflight(database)
    assertNotEquals(second.value("plan"),first.value("plan"))
    val applied=apply(database,second.value("plan"))
    assertEquals((applied.exit,applied.last),(0,"DOWN024.result|applied"),applied.err)
    downgraded(database)

    connected(database) { c =>
      def stored(id: UUID): List[String] = Sql.rows(c,"SELECT revision||' '||md5(snapshot::text) FROM ch_revisions WHERE session_id=? ORDER BY revision",id)(_.getString(1))
      def messages(id: UUID): List[String] = Sql.rows(c,"SELECT concat_ws(' ',revision,position,message_id,md5(value::text)) FROM ch_messages WHERE session_id=? ORDER BY revision,position",id)(_.getString(1))
      def fragments(id: UUID): List[String] = Sql.rows(c,"SELECT concat_ws(' ',revision,md5(value),head_candidate) FROM ch_archive_fragments WHERE session_id=? ORDER BY 1",id)(_.getString(1))
      assertEquals(stored(epochSession),stored(legacySession)); assertEquals(stored(epochSession).size,4)
      assertEquals(messages(epochSession),messages(legacySession))
      assertEquals(fragments(epochSession),fragments(legacySession))
      assert(Sql.one(c,"SELECT pg_column_size(snapshot::text::jsonb) FROM ch_revisions WHERE session_id=? AND revision=1",tinySession)(_.getLong(1)).get<=bound.toLong)
      assertEquals(Sql.rows(c,"SELECT concat_ws('|',session_id,revision,binding_id) FROM ch_revisions ORDER BY 1")(_.getString(1)),binding)
      assertEquals(Sql.rows(c,"SELECT to_jsonb(j)::text FROM ch_jobs j ORDER BY id")(_.getString(1)),jobs)
    }
    assertEquals(binary(database)((epochs,_) => reads(epochs,"a",epochSession)++reads(epochs,"a",tinySession)),before)
  }}

  test("a revision above the jsonb cap (its raw path): listed, every change refused before it starts until the purge of its source is chosen with its count; then exactly that source is purged and the rest converted") { copy { database =>
    val (kept,purged)=binary(database) { (epochs,_) =>
      def session(text: String): UUID = epochs.ingest("a",request(SourceIdentity(UUID.randomUUID().toString,"native",SourceFormat.Pi,"session",None),0,List("u1"->text))).sessionId
      (session("kept"),session("purged"))
    }
    // Revision 2 of `purged`: its first revision's rows in an epoch whose raw path alone exceeds the jsonb string cap.
    admin(database,
      s"INSERT INTO ch_epochs(id,session_id,raw_path) SELECT '00000000-0000-4000-8000-0000000000e2',session_id,repeat('p',268435456) FROM ch_epochs WHERE session_id='$purged'",
      s"INSERT INTO ch_epoch_messages(epoch,position,message_id,value) SELECT '00000000-0000-4000-8000-0000000000e2',position,message_id,value FROM ch_epoch_messages WHERE epoch=(SELECT epoch FROM ch_revisions WHERE session_id='$purged' AND revision=1)",
      s"INSERT INTO ch_epoch_raw(epoch,byte_offset,content) SELECT '00000000-0000-4000-8000-0000000000e2',byte_offset,content FROM ch_epoch_raw WHERE epoch=(SELECT epoch FROM ch_revisions WHERE session_id='$purged' AND revision=1)",
      s"""INSERT INTO ch_revisions(session_id,revision,epoch,envelope,message_count,record_count,raw_bytes,message_bytes,fragment_count,raw_state,message_chain,message_time)
        SELECT session_id,2,'00000000-0000-4000-8000-0000000000e2',envelope,message_count,record_count,raw_bytes,message_bytes,fragment_count,raw_state,message_chain,message_time FROM ch_revisions WHERE session_id='$purged' AND revision=1""",
      s"""INSERT INTO ch_revision_info(session_id,revision,metadata,source,completion,redacted,last_timestamp,last_timestamp_order,message_count,lexical_version)
        SELECT session_id,2,metadata,source,completion,redacted,last_timestamp,last_timestamp_order,message_count,lexical_version FROM ch_revision_info WHERE session_id='$purged' AND revision=1""",
      s"UPDATE ch_sources SET revision=2 WHERE id='$purged'")
    val listed=preflight(database)
    val List(session,revision,_,exact)=(listed.values("non_downgradable").filter(_.contains('-')) match { case List(one) => one.split('|').toList; case other => fail(other.toString) }): @unchecked
    assertEquals((UUID.fromString(session),revision,exact),(purged,"2","rejected:54000"))
    assertEquals((listed.values("non_downgradable").filterNot(_.contains('-')),listed.value("non_downgradable_owner")),(List("1|sources=1"),"a|1"))
    val plan=listed.value("plan")
    val unchanged=census(database)
    refused(run(database,"mode"->"apply"),"refused-apply-flags")
    refused(run(database,"mode"->"dry-run"),"refused-non-downgradable|1|sources=1")
    refused(apply(database,plan),"refused-non-downgradable|1|sources=1")
    refused(apply(database,plan,"purge_non_downgradable"->"yes","confirm_purge_sources"->"2"),"refused-purge-count|sources=1")
    assertEquals(census(database),unchanged)
    val applied=apply(database,plan,"purge_non_downgradable"->"yes","confirm_purge_sources"->"1")
    assertEquals((applied.exit,applied.last,applied.value("purged_sources"),applied.value("converted_sources")),(0,"DOWN024.result|applied","1","1"),applied.err)
    downgraded(database)
    connected(database) { c =>
      def count(sql: String,id: UUID): Option[Int] = Sql.one(c,sql,id)(_.getInt(1))
      assertEquals(Sql.one(c,"SELECT tombstone FROM ch_sources WHERE id=?",purged)(_.getBoolean(1)),Some(true))
      assertEquals(List("ch_revisions","ch_jobs","ch_generations").map(table => count(s"SELECT count(*) FROM $table WHERE session_id=?",purged)),List(Some(0),Some(0),Some(0)))
      assertEquals(Sql.one(c,"SELECT tombstone FROM ch_sources WHERE id=?",kept)(_.getBoolean(1)),Some(false))
      assertEquals(count("SELECT count(*) FROM ch_revisions WHERE session_id=? AND snapshot IS NOT NULL",kept),Some(1))
      assertEquals(count("SELECT count(*) FROM ch_jobs WHERE session_id=?",kept),Some(1))
    }
  }}
}
