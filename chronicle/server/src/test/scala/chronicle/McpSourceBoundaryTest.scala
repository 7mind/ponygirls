package chronicle

import chronicle.api.*
import cats.effect.{Deferred,IO}
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import io.circe.Json
import java.sql.Connection
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import scala.concurrent.duration.*

class McpSourceBoundaryTest extends munit.FunSuite {
  private val maximum=64L*1024
  private val vector=ProblemPublicationFixtures.vector
  private def string(value: String): Json=Json.fromString(value)
  private def args(id: UUID): Json=Json.obj("sessionId"->string(id.toString))
  private def query(mode: String): Json=Json.obj("query"->string("archive"),"mode"->string(mode))
  private def admission(f: ReadSourceFixture,after: Long => Unit): ReadAdmission=f.probe.admission(ReadAdmission.limited(maximum).unsafeRunSync(),after)
  private def seed(f: ReadSourceFixture): IngestReceipt=f.publish(Fixtures.snapshot(),"archive synthetic","archive",Nil,Nil)
  private def payloads(f: ReadSourceFixture): List[SourceEvent.Payload]=f.probe.observations.collect { case value: SourceEvent.Payload => value }
  private def authority(f: ReadSourceFixture,user: String): (Auth,Identity,McpRunAccess) = {
    val auth=new Auth(f.db,f.config); val identity=auth.browser(auth.login(LoginRequest(user,"synthetic"))._2)
    val authorization=new PostgresRunAuthorization(f.db,auth); val stamp=authorization.capture(identity).unsafeRunSync()
    (auth,identity,new McpRunAccess { def fresh: IO[Identity]=authorization.verify(stamp) })
  }
  test("BG GoodCommunication: admitted semantic and hybrid read the actual deployment guard and one frozen scalar page") { ReadSourceFixture.withFixture(_ => IO.pure(vector)) { f =>
    seed(f)
    List("semantic","hybrid").foreach { mode =>
      val result=f.tools.invoke(f.access,"search_sessions",query(mode),admission(f,_ => ())).unsafeRunSync()
      assertEquals(result.hcursor.get[Boolean]("isError").toOption,Some(false))
    }
    val statements=f.probe.observations.collect { case SourceEvent.Query(sql,columns) if sql.startsWith("WITH ann AS") => columns.toSet }
    assertEquals(statements,List.fill(2)(Set("total","id","generation","session_id","revision","score")))
    assert(payloads(f).exists(_.column=="descriptor"))
  }}
  List("descriptor","profile").foreach { field =>
    test(s"WG GoodCommunication: huge deployment $field is preflighted before the authoritative guard fetches any text") { ReadSourceFixture.withFixture(_ => IO.pure(vector)) { f =>
      val selected=if(field=="descriptor") f.config.copy(embedding=f.config.embedding.copy(documentPrefix="\u0080"*50000)) else f.config
      if(field=="descriptor") {
        val catalog=IndexProfileCatalog.legacyOnly(selected); new Database(selected,catalog).initialize()
        f.db.transaction(c => Sql.exec(c,"UPDATE ch_owner_targets SET profile=? WHERE owner='a'",selected.profile))
      } else f.db.transaction(c => Sql.exec(c,"UPDATE ch_owner_targets SET profile=? WHERE owner='a'","opaque"*20000))
      val tools=new LiveMcpRunTools(new Mcp(f.application(selected)))
      assertEquals(intercept[DomainError](tools.invoke(f.access,"search_sessions",query("semantic"),admission(f,_ => ())).unsafeRunSync()).code,"read-budget")
      assertEquals(payloads(f),Nil)
      assert(!f.probe.observations.exists { case SourceEvent.Query(sql,_) => sql.startsWith("WITH ann AS"); case _ => false })
    }}
  }
  test("BG GoodCommunication: real sharing revocation while query embedding awaits denies before any source database statement") {
    val entered=Deferred[IO,Unit].unsafeRunSync(); val release=Deferred[IO,Unit].unsafeRunSync()
    ReadSourceFixture.withFixture(_ => entered.complete(()).void *> release.get.as(vector)) { f =>
      seed(f); val group=UUID.randomUUID()
      f.db.transaction { c => Sql.exec(c,"INSERT INTO ch_groups VALUES(?,'a','synthetic')",group); Sql.exec(c,"INSERT INTO ch_members VALUES(?,'a'),(?,'b')",group,group) }
      val (_,_,access)=authority(f,"b")
      val result=(for {
        fiber <- f.tools.invoke(access,"search_sessions",query("semantic"),admission(f,_ => ())).start
        _ <- entered.get.timeout(3.seconds)
        _ <- IO.blocking(f.db.transaction(c => Sql.exec(c,"DELETE FROM ch_members WHERE group_id=? AND user_id='b'",group)))
        _ <- release.complete(())
        result <- fiber.joinWithNever.attempt
      } yield result).unsafeRunSync()
      assertEquals(result.swap.toOption.map(_.asInstanceOf[DomainError].code),Some("authorization-changed"))
      assertEquals(f.probe.observations,Nil)
    }
  }
  test("BG GoodCommunication: logout after numeric admission cannot deliver an already-running bounded source read") { ReadSourceFixture.withFixture(_ => IO.pure(vector)) { f =>
    val receipt=f.archive.ingest("a",Fixtures.snapshot()); val (auth,identity,access)=authority(f,"a"); val fired=new AtomicBoolean()
    val counted=admission(f,bytes => if(bytes>100 && fired.compareAndSet(false,true)) auth.logout(identity))
    val result=f.tools.invoke(access,"get_messages",args(receipt.sessionId),counted).attempt.unsafeRunSync()
    assert(fired.get()); assert(payloads(f).nonEmpty)
    assert(result.swap.toOption.exists { case d: DomainError => Set("unauthorized","authorization-changed")(d.code); case _ => false })
  }}
  List("sharing","tombstone","purge","append").foreach { change =>
    test(s"BG GoodCommunication: late $change between preflight and fetch keeps one RR snapshot, then fresh reads observe the change") { ReadSourceFixture.withFixture(_ => IO.pure(vector)) { f =>
      val original=Fixtures.snapshot(); val receipt=f.archive.ingest("a",original); val group=UUID.randomUUID()
      f.db.transaction { c => Sql.exec(c,"INSERT INTO ch_groups VALUES(?,'a','synthetic')",group); Sql.exec(c,"INSERT INTO ch_members VALUES(?,'a'),(?,'b')",group,group) }
      val selected=f.config.copy(jdbcUrl=f.probe.url(f.config.jdbcUrl)); val reader=new PostgresArchive(new Database(selected,f.catalog),selected)
      val fired=new AtomicBoolean(); val who=if(change=="sharing") "b" else "a"
      val counted=admission(f,bytes => if(bytes>100 && fired.compareAndSet(false,true)) {
        change match {
          case "sharing" => f.db.transaction(c => Sql.exec(c,"DELETE FROM ch_members WHERE group_id=? AND user_id='b'",group))
          case "tombstone" => f.db.transaction(c => Sql.exec(c,"UPDATE ch_sources SET tombstone=true WHERE id=?",receipt.sessionId))
          case "purge" => val (auth,identity,_)=authority(f,"a"); auth.mutate(identity,ClientEnvelope(UUID.randomUUID(),Operation.Purge(receipt.sessionId)))
          case "append" => f.archive.ingest("a",original.copy(requestId=UUID.randomUUID(),expectedRevision=1,metadata=original.metadata.copy(title="new head")))
        }
        ()
      })
      val result=reader.messages(who,receipt.sessionId,0,100,None,ReadMaterialization.admitted(counted))
      assert(fired.get()); assertEquals(result.messages,original.messages); assertEquals(result.view,ContentView(1,None))
      if(change=="append") assertEquals(reader.messages(who,receipt.sessionId,0,100,None).view,ContentView(2,None))
      else assertEquals(intercept[DomainError](reader.messages(who,receipt.sessionId,0,100,None)).code,"not-found")
      assert(f.probe.observations.collect { case SourceEvent.Isolation(_,level) => level }.forall(_==Connection.TRANSACTION_REPEATABLE_READ))
    }}
  }
  test("BG GoodCommunication: facet selections cap each field at 100, retain published metadata/order and deduplicate metadata/generated tags") { ReadSourceFixture.withFixture(_ => IO.pure(vector)) { f =>
    val originals=(0 until 160).map { index =>
      val original=Fixtures.snapshot(); val tag=f"t$index%03d"
      val request=original.copy(metadata=original.metadata.copy(project=Some(f"p$index%03d"),gitBranch=Some(f"b$index%03d"),tags=List("common",tag)))
      val receipt=f.publish(request,"archive","archive",List("common",tag),Nil)
      (request,receipt)
    }
    val original=originals.head._1
    f.archive.ingest("a",original.copy(requestId=UUID.randomUUID(),expectedRevision=1,metadata=original.metadata.copy(project=Some("unpublished"))))
    val privateRequest=Fixtures.snapshot().copy(metadata=original.metadata.copy(project=Some("AAA-private")))
    val other=f.archive.ingest("b",privateRequest); val claim=f.archive.claim(f.catalog.knownProfiles,ClaimScope.Owner("b"),300).get
    StoredPublicationFixtures.publish(f.db,claim,List(IndexedChunk(Chunk(UUID.randomUUID(),other.sessionId,"archive","archive",List("private"),Nil,0.0),vector)))
    val result=f.tools.invoke(f.access,"list_facets",Json.obj(),admission(f,_ => ())).unsafeRunSync()
    val content=result.hcursor.downField("content").downN(0).get[String]("text").toOption.get
    val facets=Wire.decode(Result.codecJson,Wire.parse(content)).asInstanceOf[Result.Facets].result
    assertEquals(facets.projects,(0 until 100).map(i => Facet(f"p$i%03d",1)).toList)
    assertEquals(facets.branches,(0 until 100).map(i => Facet(f"b$i%03d",1)).toList)
    assertEquals(facets.tags,Facet("common",160)::(0 until 99).map(i => Facet(f"t$i%03d",1)).toList)
    val events=f.probe.observations
    val consume=events.indexWhere { case _: SourceEvent.Consumed => true; case _ => false }
    val payload=events.indexWhere { case SourceEvent.Query(sql,_) => sql=="FETCH FORWARD 300 FROM ch_mcp_selected_sources"; case _ => false }
    assert(consume>=0 && payload>consume)
    assertEquals(payloads(f).size,300)
  }}
  test("WG GoodCommunication: all eight tools work with a SELECT-only role that is explicitly denied TEMP privilege") { ReadSourceFixture.withFixture(_ => IO.pure(vector)) { f =>
    val receipt=seed(f); val role="mcp_source_"+UUID.randomUUID().toString.replace("-","")
    val database=f.db.transaction(c => Sql.one(c,"SELECT current_database()")(_.getString(1)).get)
    val databaseIdentifier="\""+database.replace("\"","\"\"")+"\""
    f.db.transaction { c =>
      Sql.exec(c,s"CREATE ROLE $role LOGIN")
      Sql.exec(c,s"REVOKE TEMP ON DATABASE $databaseIdentifier FROM PUBLIC")
      Sql.exec(c,s"GRANT USAGE ON SCHEMA public TO $role")
      Sql.exec(c,s"GRANT SELECT ON ch_sources,ch_users,ch_members,ch_generations,ch_revision_info,ch_messages,ch_chunks,ch_generation_tags,ch_search_chunks,ch_jobs,ch_profile,ch_owner_targets,ch_index_profiles,ch_embedding_spaces TO $role")
      Sql.exec(c,s"GRANT SELECT(session_id,revision) ON ch_revisions TO $role")
    }
    try {
      val denied=new Database(f.config.copy(databaseUser=role),f.catalog)
      assertEquals(intercept[java.sql.SQLException](denied.transaction(c => Sql.exec(c,"CREATE TEMP TABLE forbidden(i integer)"))).getSQLState,"42501")
      val tools=new LiveMcpRunTools(new Mcp(f.application(f.config.copy(databaseUser=role))))
      List("get_session"->args(receipt.sessionId),"get_chunks"->args(receipt.sessionId),"get_messages"->args(receipt.sessionId),"list_facets"->Json.obj(),
        "search_sessions"->query("semantic"),"related_sessions"->args(receipt.sessionId),"ingest_status"->Json.obj(),"whoami"->Json.obj()).foreach { (name,arguments) =>
        val result=tools.invoke(f.access,name,arguments,admission(f,_ => ())).unsafeRunSync()
        assertEquals(result.hcursor.get[Boolean]("isError").toOption,Some(false))
      }
      assert(!f.probe.observations.exists { case SourceEvent.Statement(_,sql) => sql.startsWith("CREATE") || sql.startsWith("INSERT") || sql.startsWith("UPDATE") || sql.startsWith("DELETE"); case _ => false })
    } finally f.db.transaction { c => Sql.exec(c,s"GRANT TEMP ON DATABASE $databaseIdentifier TO PUBLIC"); Sql.exec(c,s"DROP OWNED BY $role"); Sql.exec(c,s"DROP ROLE $role") }
  }}
  test("WG GoodCommunication: admitted SQL deadline cancels a controlled numeric preflight delay without changing model policy") { ReadSourceFixture.withFixture(_ => IO.pure(vector)) { f =>
    val receipt=f.archive.ingest("a",Fixtures.snapshot())
    f.db.transaction { c =>
      Sql.exec(c,"ALTER TABLE ch_messages RENAME TO ch_test_source_messages")
      Sql.exec(c,"CREATE VIEW ch_messages AS SELECT session_id,revision,position,message_id,value || jsonb_build_object('delayed',(SELECT pg_sleep(8))) AS value FROM ch_test_source_messages")
    }
    try {
      val before=System.nanoTime()
      val error=intercept[java.sql.SQLException](f.tools.invoke(f.access,"get_messages",args(receipt.sessionId),admission(f,_ => ())).unsafeRunSync())
      val elapsed=(System.nanoTime()-before).nanos
      assertEquals(error.getSQLState,"57014"); assert(elapsed>=4.seconds && elapsed<12.seconds)
      assertEquals(payloads(f),Nil)
      assert(f.probe.observations.exists { case SourceEvent.Statement(_,sql) => sql=="SET LOCAL statement_timeout = '5s'"; case _ => false })
    } finally f.db.transaction { c => Sql.exec(c,"DROP VIEW ch_messages"); Sql.exec(c,"ALTER TABLE ch_test_source_messages RENAME TO ch_messages") }
  }}
  test("BG GoodCommunication: ordinary public MCP source reads evaluate no numeric admission, cursor, or local SQL deadline") { ReadSourceFixture.withFixture(_ => IO.pure(vector)) { f =>
    val receipt=seed(f)
    List("get_session"->args(receipt.sessionId),"get_chunks"->args(receipt.sessionId),"get_messages"->args(receipt.sessionId),"list_facets"->Json.obj(),
      "search_sessions"->query("semantic"),"related_sessions"->args(receipt.sessionId),"ingest_status"->Json.obj(),"whoami"->Json.obj()).foreach { (name,arguments) =>
      val rpc=Json.obj("jsonrpc"->string("2.0"),"id"->Json.fromInt(1),"method"->string("tools/call"),"params"->Json.obj("name"->string(name),"arguments"->arguments))
      val result=f.mcp.handle(f.identity,rpc).unsafeRunSync().get
      assertEquals(result.hcursor.downField("result").get[Boolean]("isError").toOption,Some(false))
    }
    val statements=f.probe.observations.collect { case SourceEvent.Statement(_,sql) => sql }
    assert(!statements.exists(sql => sql.contains(" AS source_bytes") || sql.startsWith("DECLARE") || sql.startsWith("FETCH") || sql.contains("statement_timeout")))
    assert(!f.probe.observations.exists { case _: SourceEvent.Consumed => true; case _ => false })
  }}
  test("BG GoodCommunication: accepted empty owner IDs remain exact in budgeted session and identity source") { ReadSourceFixture.withFixture(_ => IO.pure(vector)) { f =>
    val config=f.config.copy(users=f.config.users:+f.config.users.head.copy(id="",login="empty-owner"))
    val db=new Database(config,f.catalog); db.initialize()
    try {
      val archive=new PostgresArchive(db,config); val receipt=archive.ingest("",Fixtures.snapshot())
      val identity=f.identity.copy(user=f.identity.user.copy(id="",login="empty-owner"))
      val access=new McpRunAccess { def fresh: IO[Identity]=IO.pure(identity) }
      val result=f.tools.invoke(access,"get_session",args(receipt.sessionId),admission(f,_ => ())).unsafeRunSync()
      val content=result.hcursor.downField("content").downN(0).get[String]("text").toOption.get
      val session=Wire.decode(Result.codecJson,Wire.parse(content)).asInstanceOf[Result.Session].result.session
      assertEquals(session.ownerId,"")
    } finally new Database(f.config,f.catalog).initialize()
  }}
}
