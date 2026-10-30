package chronicle

import chronicle.api.*
import cats.effect.IO
import cats.effect.unsafe.implicits.global
import io.circe.Json
import java.sql.Connection
import java.util.UUID
import java.util.concurrent.{CountDownLatch,TimeUnit}
import java.util.concurrent.atomic.AtomicBoolean

// Specified-origin: these exact transfer, transaction and authority checks require PostgreSQL.
class MessageContextBoundaryTest extends munit.FunSuite {
  private val vector=ProblemPublicationFixtures.vector
  private def context(f: ReadSourceFixture,id: UUID,anchor: Span,admission: ReadAdmission): MessageContextResult = {
    val reader=new PostgresArchive(new Database(f.config.copy(jdbcUrl=f.probe.url(f.config.jdbcUrl)),f.catalog),f.config)
    reader.readMessageContext("a",id,ContentView(1,None),anchor,2048,2048,ReadMaterialization.admitted(f.probe.admission(admission,_ => ())))
  }
  private def args(id: UUID,messageId: String): Json=Json.obj("sessionId"->Json.fromString(id.toString),"view"->Wire.encode(ContentView.codecJson,ContentView(1,None)),"anchor"->Wire.encode(Span.codecJson,Span(messageId,0,1)),"beforeBytes"->Json.fromInt(4),"afterBytes"->Json.fromInt(4))
  private def payloads(f: ReadSourceFixture): List[SourceEvent.Payload]=f.probe.observations.collect { case event: SourceEvent.Payload => event }
  List("parentId","timestamp").foreach { field =>
    test(s"GoodCommunication: giant accepted $field is neither projected nor charged by context reads") { ReadSourceFixture.withFixture(_ => IO.pure(vector)) { f =>
      val original=Fixtures.snapshot(); val message=original.messages.head; val huge="α\"\\"*50000
      val request=if(field=="timestamp") original.copy(messages=List(message.copy(text="x"*150000,timestamp=Some(huge)))) else {
        val raw=original.files.head.content+Json.obj("id"->Json.fromString(huge)).noSpaces+"\n"
        original.copy(messages=List(message.copy(text="x"*150000,parentId=Some(huge))),files=List(original.files.head.copy(content=raw,sha256=Wire.hash(raw))),digest=Wire.hash(raw))
      }
      val out=f.archive.ingest("a",request)
      val result=context(f,out.sessionId,Span(message.id,70000,70001),ReadAdmission.limited(64L*1024).unsafeRunSync())
      assertEquals(result.excerpts.head.text,"x"*4097)
      assertEquals(payloads(f).map(_.column),List("source_value"))
      val queries=f.probe.observations.collect { case SourceEvent.Query(sql,_) => sql }
      assert(!queries.exists(sql => sql.contains("snapshot") || sql.contains("parentId") || sql.contains("timestamp") || sql.startsWith("SELECT value")))
      val levels=f.probe.observations.collect { case SourceEvent.Isolation(_,level) => level }
      assertEquals(levels,List(Connection.TRANSACTION_REPEATABLE_READ))
    }}
  }
  test("GoodCommunication: endpoint cap rejects overlarge essential role framing before any textual payload even without caller admission") { ReadSourceFixture.withFixture(_ => IO.pure(vector)) { f =>
    val original=Fixtures.snapshot(); val out=f.archive.ingest("a",original)
    f.db.transaction(c => Sql.exec(c,"UPDATE ch_messages SET value=jsonb_set(value,'{role}',to_jsonb(repeat('x',70000))) WHERE session_id=?",out.sessionId))
    assertEquals(intercept[DomainError](context(f,out.sessionId,Span(original.messages.head.id,0,1),new ReadAdmission { def consume(bytes: Long): Unit=() })).code,"read-budget")
    assertEquals(payloads(f),Nil)
    val selected=f.config.copy(jdbcUrl=f.probe.url(f.config.jdbcUrl)); val reader=new PostgresArchive(new Database(selected,f.catalog),selected)
    assertEquals(intercept[DomainError](reader.readMessageContext("a",out.sessionId,ContentView(1,None),Span(original.messages.head.id,0,1),0,0)).code,"read-budget")
    assertEquals(payloads(f),Nil)
  }}
  test("GoodCommunication: full serialized MCP text-content framing shares the result cap, including escaped controls") { ReadSourceFixture.withFixture(_ => IO.pure(vector)) { f =>
    val original=Fixtures.snapshot(); val out=f.archive.ingest("a",original)
    // Deliberately corrupted essential metadata exercises framing outside valid ingestion's role-length bound.
    f.db.transaction(c => Sql.exec(c,"UPDATE ch_messages SET value=jsonb_set(value,'{role}',to_jsonb(repeat(chr(127),20000))) WHERE session_id=?",out.sessionId))
    val result=context(f,out.sessionId,Span(original.messages.head.id,0,1),ReadAdmission.unlimited)
    assert(JsonUtf8Size(Wire.encode(Result.codecJson,Result.MessageContext(result)))<MessageContextPolicy.maximumResultBytes)
    assertEquals(intercept[DomainError](f.tools.invoke(f.access,"read_message_context",args(out.sessionId,original.messages.head.id),ReadAdmission.unlimited).unsafeRunSync()).code,"read-budget")
  }}
  test("GoodCommunication: exact measured endpoint N vs N-1 fails before textual cursor payload") { ReadSourceFixture.withFixture(_ => IO.pure(vector)) { f =>
    val original=Fixtures.snapshot(); val out=f.archive.ingest("a",original)
    var total=0L
    val expected=context(f,out.sessionId,Span(original.messages.head.id,0,1),new ReadAdmission { def consume(bytes: Long): Unit={ total+=bytes; () } })
    assertEquals(context(f,out.sessionId,Span(original.messages.head.id,0,1),ReadAdmission.limited(total).unsafeRunSync()),expected)
    val before=payloads(f).size
    assertEquals(intercept[DomainError](context(f,out.sessionId,Span(original.messages.head.id,0,1),ReadAdmission.limited(total-1).unsafeRunSync())).code,"read-budget")
    assertEquals(payloads(f).size,before)
    assert(f.probe.observations.collect { case SourceEvent.Closed(_,exhausted) => exhausted }.forall(identity))
  }}
  test("GoodCommunication: direct locator and bounded per-side metadata do not transfer earlier messages or lookahead text") { ReadSourceFixture.withFixture(_ => IO.pure(vector)) { f =>
    val original=Fixtures.snapshot(); val messages=(0 until 151).map(i => Message(s"m$i",None,"user",if(i==150) "Z" else "x"*1000,None,2)).toList
    val out=f.archive.ingest("a",original.copy(messages=messages))
    val result=context(f,out.sessionId,Span("m150",0,1),ReadAdmission.limited(64L*1024).unsafeRunSync())
    assertEquals(result.excerpts.map(_.source.messagePosition),List(147,148,149,150))
    val queries=f.probe.observations.collect { case SourceEvent.Query(sql,columns) => (sql,columns) }
    assert(queries.exists { (sql,_) => sql.contains("message_id=?") })
    assert(queries.exists { (sql,columns) => sql.contains("position<? ORDER BY position DESC LIMIT ?") && columns==List("position","bytes") })
    assertEquals(payloads(f).size,4)
    assert(!queries.exists { (_,columns) => columns.exists(Set("snapshot","value","parentId","timestamp")) })
  }}
  test("GoodCommunication: fresh post-read authorization rejects logout after admission, without delivering already materialized context") { ReadSourceFixture.withFixture(_ => IO.pure(vector)) { f =>
    val original=Fixtures.snapshot(); val out=f.archive.ingest("a",original)
    val auth=new Auth(f.db,f.config); val identity=auth.browser(auth.login(LoginRequest("a","synthetic"))._2)
    val authorization=new PostgresRunAuthorization(f.db,auth); val stamp=authorization.capture(identity).unsafeRunSync()
    val access=new McpRunAccess { def fresh: IO[Identity]=authorization.verify(stamp) }
    val fired=new AtomicBoolean()
    val admission=f.probe.admission(ReadAdmission.limited(64L*1024).unsafeRunSync(),bytes => if(bytes>100 && fired.compareAndSet(false,true)) auth.logout(identity))
    val failure=f.tools.invoke(access,"read_message_context",args(out.sessionId,original.messages.head.id),admission).attempt.unsafeRunSync()
    assert(fired.get()); assert(payloads(f).nonEmpty)
    assert(failure.swap.toOption.exists { case error: DomainError => Set("unauthorized","authorization-changed")(error.code); case _ => false })
  }}
  test("GoodCommunication: SELECT-only role without TEMP or snapshot-column privilege can read bounded context") { ReadSourceFixture.withFixture(_ => IO.pure(vector)) { f =>
    val original=Fixtures.snapshot(); val out=f.archive.ingest("a",original); val role="context_"+UUID.randomUUID().toString.replace("-","")
    val database=f.db.transaction(c => Sql.one(c,"SELECT current_database()")(_.getString(1)).get)
    val identifier="\""+database.replace("\"","\"\"")+"\""
    f.db.transaction { c =>
      Sql.exec(c,s"CREATE ROLE $role LOGIN"); Sql.exec(c,s"REVOKE TEMP ON DATABASE $identifier FROM PUBLIC")
      Sql.exec(c,s"GRANT USAGE ON SCHEMA public TO $role")
      Sql.exec(c,s"GRANT SELECT ON ch_sources,ch_users,ch_members,ch_generations,ch_revision_info,ch_messages TO $role")
      Sql.exec(c,s"GRANT SELECT(session_id,revision) ON ch_revisions TO $role")
    }
    try {
      val config=f.config.copy(databaseUser=role); val db=new Database(config,f.catalog); val reader=new PostgresArchive(db,config)
      assertEquals(intercept[java.sql.SQLException](db.transaction(c => Sql.exec(c,"CREATE TEMP TABLE forbidden(i integer)"))).getSQLState,"42501")
      assertEquals(reader.readMessageContext("a",out.sessionId,ContentView(1,None),Span(original.messages.head.id,0,1),4,4).excerpts.head.text,original.messages.head.text.take(5))
    } finally f.db.transaction { c => Sql.exec(c,s"GRANT TEMP ON DATABASE $identifier TO PUBLIC"); Sql.exec(c,s"DROP OWNED BY $role"); Sql.exec(c,s"DROP ROLE $role") }
  }}
  List(false,true).foreach { stricter =>
    test(s"GoodCommunication: real lock wait has explicit deadline and preserves stricter configured deadline=$stricter") { OwnerProfilePostgres.withDatabase { (_,db,reader,_) =>
      val original=Fixtures.snapshot(); val out=reader.ingest("a",original); val acquired=new CountDownLatch(1); val release=new CountDownLatch(1)
      val blocker=new Thread(() => db.transaction { c => Sql.exec(c,"LOCK TABLE ch_messages IN ACCESS EXCLUSIVE MODE"); acquired.countDown(); release.await(20,TimeUnit.SECONDS); () })
      if(stricter) db.transaction(c => Sql.exec(c,"ALTER ROLE postgres SET statement_timeout='100ms'"))
      blocker.start()
      try {
        assert(acquired.await(5,TimeUnit.SECONDS)); val started=System.nanoTime()
        assertEquals(intercept[DomainError](reader.readMessageContext("a",out.sessionId,ContentView(1,None),Span(original.messages.head.id,0,1),4,4)).code,"deadline")
        val elapsed=(System.nanoTime()-started)/1000000
        if(stricter) assert(elapsed<3000) else assert(elapsed>=4000 && elapsed<15000,s"elapsed=$elapsed")
      } finally {
        release.countDown(); blocker.join(5000); assert(!blocker.isAlive)
        if(stricter) db.transaction(c => Sql.exec(c,"ALTER ROLE postgres RESET statement_timeout"))
      }
    }}
  }
}
