package chronicle

import chronicle.api.*
import java.util.UUID
import scala.concurrent.duration.*

class ArchiveContentBoundaryTest extends munit.FunSuite {
  override val munitTimeout=2.minutes
  private def database(maxMessages: Int)(f: (Config,Database,PostgresArchive,PostgresArchiveIndex) => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh") }
    val original=Fixtures.config(); val config=original.copy(maxMessages=maxMessages,maxBodyBytes=32*1024*1024)
    val db=new Database(config,IndexProfileCatalog.legacyOnly(config)); db.initialize()
    db.transaction { c =>
      Sql.exec(c,"TRUNCATE ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks CASCADE")
      Sql.exec(c,"UPDATE ch_profile SET active=?,target=?,maintenance=false",config.profile,config.profile); Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=0",config.profile)
    }
    val archive=new PostgresArchive(db,config)
    f(config,db,archive,new PostgresArchiveIndex(db,archive,config))
  }
  test("BG GoodCommunication regression: whole-field contextual Sigma folding neither loses sigma nor invents final sigma") { database(10000) { (config,db,archive,index) =>
    val original=Fixtures.snapshot(); val text="aΣ"+"\u0301"*5000+"b"
    val raw=io.circe.Json.obj("id"->io.circe.Json.fromString("u"),"text"->io.circe.Json.fromString(text)).noSpaces+"\n"
    val request=original.copy(messages=List(Message("u",None,"user",text,None,0)),files=List(RawFile("sigma.jsonl",Wire.hash(raw),raw)),digest=Wire.hash(raw))
    archive.ingest("a",request)
    def count(value: String): Long = {
      val q=ArchiveQuery("mode:lexical "+value,ArchiveSort.LastTimestamp,SortDirection.Desc,None,100,false)
      index.browse("a",q,ArchiveExpression.parse(q.expression),Nil).total
    }
    val (goldSigma,goldFinal)=db.transaction(c => Sql.one(c,"SELECT ? COLLATE pg_unicode_fast ILIKE '%σ%',? COLLATE pg_unicode_fast ILIKE '%ς%'",text,text)(r => (r.getBoolean(1),r.getBoolean(2))).get)
    val sigma=count("σ"); val finalSigma=count("ς")
    println(s"CONTEXTUAL SIGMA wholeILIKE_sigma=$goldSigma wholeILIKE_final=$goldFinal archive_sigma=$sigma archive_final=$finalSigma")
    assert(goldSigma); assert(!goldFinal)
    assertEquals(sigma,1L); assertEquals(finalSigma,0L)
  }}
  test("BG GoodCommunication regression: locator and normalized messages reach every supported100101-message position") { database(100101) { (config,db,archive,index) =>
    val size=100101; val original=Fixtures.snapshot()
    val messages=List.tabulate(size)(position => Message(s"m$position",None,"user","",None,position))
    val raw=messages.iterator.map(message => s"{\"id\":\"${message.id}\"}\n").mkString
    val request=original.copy(messages=messages,files=List(RawFile("messages.jsonl",Wire.hash(raw),raw)),digest=Wire.hash(raw))
    val started=System.nanoTime()
    val receipt=archive.ingest("a",request); val view=ContentView(1,None)
    println(s"CONTENT INGEST messages=$size milliseconds=${(System.nanoTime()-started)/1000000}")
    val located=archive.locateMessage("a",receipt.sessionId,view,"m100100")
    println(s"CONTENT POSITION located=${located.position} total=${located.total}")
    assertEquals(located.position,100100); assertEquals(located.total,size)
    val page=archive.messages("a",receipt.sessionId,located.position,100,Some(view))
    assertEquals(page.total,size); assertEquals(page.messages.map(_.id),List("m100100"))
    assertEquals(archive.messages("a",receipt.sessionId,Int.MaxValue,100,Some(view)).messages,Nil)
    assertEquals(intercept[DomainError](archive.messages("a",receipt.sessionId,-1,100,Some(view))).code,"invalid")
    val plan=db.transaction(c => Sql.rows(c,"EXPLAIN (ANALYZE,BUFFERS) SELECT value FROM ch_messages WHERE session_id=? AND revision=1 AND position>=100100 ORDER BY position LIMIT 100",receipt.sessionId)(_.getString(1)).mkString("\n"))
    println("CONTENT POSITION SEEK PLAN\n"+plan)
    assert(plan.contains("Index Scan using ch_messages_pkey"),plan)

  }}
  test("BG GoodCommunication regression: annotation content pages have no unrelated100000 offset ceiling") { database(10000) { (config,db,archive,index) =>
    val receipt=archive.ingest("a",Fixtures.snapshot()); val view=ContentView(1,None)
    val page=archive.pageChunks("a",receipt.sessionId,100100,100,Some(view))
    assertEquals(page,ChunksResult(Nil,0,100100,view))
  }}
}
