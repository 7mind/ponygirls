package chronicle

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import chronicle.api.*
import java.nio.charset.StandardCharsets.UTF_8
import java.sql.Connection
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

class TagSearchTest extends munit.FunSuite {
  private val emptyFilter=SearchFilter(None,None,None,None,Nil)
  private def query(text: String,after: Option[String],limit: Int): TagSearchQuery=TagSearchQuery(text,emptyFilter,after,limit)
  private def binary(values: List[String]): List[String]=values.sortWith((a,b) => java.util.Arrays.compareUnsigned(a.getBytes(UTF_8),b.getBytes(UTF_8))<0)
  private def fixture(test: ReadSourceFixture => Unit): Unit=ReadSourceFixture.withFixture(_ => IO.raiseError(new AssertionError("tag catalog must not call a provider")))(test)
  private def index(f: ReadSourceFixture): PostgresSearch = {
    val config=f.config.copy(jdbcUrl=f.probe.url(f.config.jdbcUrl))
    val db=new Database(config,f.catalog)
    new PostgresSearch(db,new PostgresArchive(db,config),config)
  }
  private def publish(f: ReadSourceFixture,owner: String,request: IngestRequest,tags: List[List[String]]): IngestReceipt = {
    val receipt=f.archive.ingest(owner,request)
    val claim=f.archive.claim(f.catalog.knownProfiles,ClaimScope.Owner(owner),300).get
    val chunks=tags.map(values => IndexedChunk(Chunk(UUID.randomUUID(),receipt.sessionId,"synthetic tag source","synthetic",values,Nil,0.0),ProblemPublicationFixtures.vector))
    StoredPublicationFixtures.publish(f.db,claim,chunks)
    receipt
  }
  private def request(tags: List[String]): IngestRequest = {
    val original=Fixtures.snapshot()
    original.copy(metadata=original.metadata.copy(tags=tags))
  }
  private def share(f: ReadSourceFixture): UUID = {
    val group=UUID.randomUUID()
    f.db.transaction { c => Sql.exec(c,"INSERT INTO ch_groups VALUES(?,'a','tag catalog fixture')",group); Sql.exec(c,"INSERT INTO ch_members VALUES(?,'a'),(?,'b')",group,group) }
    group
  }
  private def admission(f: ReadSourceFixture,maximum: Long,after: Long => Unit): ReadMaterialization =
    ReadMaterialization.admitted(f.probe.admission(ReadAdmission.limited(maximum).unsafeRunSync(),after))
  private def payloads(f: ReadSourceFixture): List[SourceEvent.Payload]=f.probe.observations.collect { case event: SourceEvent.Payload => event }

  // Specified-origin: exact live catalog pages, not the existing top-100 frequency facets.
  test("BG GoodCommunication: more than 100 tags traverse exact binary keyset pages through the empty end page") { fixture { f =>
    val values=(0 until 205).map(i => f"tag-$i%03d").toList++List("A","a","\ue000","🐎")
    publish(f,"a",request(Nil),values.grouped(20).toList)
    val search=index(f)
    val expected=binary(values).map(Facet(_,1))
    val first=search.tags("a",query("",None,100))
    val second=search.tags("a",query("",Some(first.last.value),100))
    val third=search.tags("a",query("",Some(second.last.value),100))
    assertEquals(first.size,100); assertEquals(second.size,100); assertEquals(third.size,9)
    assertEquals(first++second++third,expected)
    assertEquals(search.tags("a",query("",Some(third.last.value),100)),Nil)
    assertEquals(search.tags("a",query("",Some("tag-050x"),3)),List("tag-051","tag-052","tag-053").map(Facet(_,1)))
    assertEquals(search.tags("a",query("",Some("zzzz"),100)),expected.filter(facet => java.util.Arrays.compareUnsigned(facet.value.getBytes(UTF_8),"zzzz".getBytes(UTF_8))>0))
    val exact=search.tags("a",query("tag-00",None,10))
    assertEquals(exact,(0 until 10).map(i => Facet(f"tag-$i%03d",1)).toList)
    assertEquals(search.tags("a",query("tag-00",Some(exact.last.value),10)),Nil)
    assertEquals(search.tags("a",query("",None,1)),expected.take(1))
  }}

  test("BG GoodCommunication: a legal empty metadata tag traverses with an explicit empty exclusive position") { fixture { f =>
    publish(f,"a",request(List("","next")),List(Nil))
    val search=index(f)
    assertEquals(search.tags("a",query("",None,1)),List(Facet("",1)))
    assertEquals(search.tags("a",query("",Some(""),1)),List(Facet("next",1)))
    assertEquals(search.tags("a",query("",Some("next"),1)),Nil)
  }}

  test("BG GoodCommunication: literal Unicode-lower substrings preserve exact distinct values whitespace and punctuation") { fixture { f =>
    val values=List("A","a","Ä","ä","Σ","σ","ς","ẞ","ß","ss","Straße","STRASSE","é","e\u0301","🐎","𐐀","𐐨","  padded  ","100%","under_score","a/b","a\\b","a\"b","a'b")
    publish(f,"a",request(Nil),List(values))
    val search=index(f)
    List("Ä"->List("Ä","ä"),"Σ"->List("Σ","σ"),"ß"->List("ẞ","ß","Straße"),"ss"->List("ss","STRASSE"),
      "é"->List("é"),"e\u0301"->List("e\u0301"),"🐎"->List("🐎"),"𐐨"->List("𐐀","𐐨"),"  "->List("  padded  "),
      "%"->List("100%"),"_"->List("under_score"),"/"->List("a/b"),"\\"->List("a\\b"),"\""->List("a\"b"),"'"->List("a'b")).foreach { (text,matched) =>
      assertEquals(search.tags("a",query(text,None,100)),binary(matched).map(Facet(_,1)),text)
    }
    assertEquals(search.tags("a",query("",None,100)),binary(values).map(Facet(_,1)))
    assertEquals(search.tags("a",query("",Some("Ä"),100)),binary(values).filter(value => java.util.Arrays.compareUnsigned(value.getBytes(UTF_8),"Ä".getBytes(UTF_8))>0).map(Facet(_,1)))
  }}

  test("BG GoodCommunication: full public tag positions including long normalized values are traversable without a byte cap") { fixture { f =>
    val long="\\u0000"*128
    val values=List(long,"😀"*128,"z"*2048,"zz")
    publish(f,"a",request(Nil),List(values))
    val search=index(f); val expected=binary(values)
    expected.foreach(value => assertEquals(search.tags("a",query("",Some(value),100)),expected.dropWhile(_!=value).drop(1).map(Facet(_,1))))
    assertEquals(search.tags("a",query("z"*2048,None,1)),List(Facet("z"*2048,1)))
    assertEquals(search.tags("a",query("",Some("zz"),1)),List(Facet("z"*2048,1)))
  }}

  test("BG GoodCommunication: legacy generated tags longer than the query bound remain exact reusable public positions") { fixture { f =>
    val firstTag="a"*2049; val secondTag="a"*4096
    publish(f,"a",request(Nil),List(List(firstTag,secondTag,"z")))
    val search=index(f)
    val first=search.tags("a",query("",None,1))
    assertEquals(first,List(Facet(firstTag,1)))
    val second=search.tags("a",query("",Some(first.last.value),1))
    assertEquals(second,List(Facet(secondTag,1)))
    val third=search.tags("a",query("",Some(second.last.value),1))
    assertEquals(third,List(Facet("z",1)))
    assertEquals(search.tags("a",query("",Some(third.last.value),1)),Nil)
    assertEquals(search.tags("a",query("",Some("z"*10000),1)),Nil)
  }}

  test("BG GoodCommunication: counts deduplicate session tags across metadata generated tags and multiple chunks") { fixture { f =>
    publish(f,"a",request(List("shared","metadata","shared")),List(List("shared","generated"),List("shared","generated")))
    publish(f,"a",request(List("shared")),List(List("shared","generated")))
    val search=index(f)
    assertEquals(search.tags("a",query("",None,100)),List(Facet("generated",2),Facet("metadata",1),Facet("shared",2)))
    assertEquals(search.facets("a",emptyFilter).tags,List(Facet("generated",2),Facet("shared",2),Facet("metadata",1)))
  }}

  test("BG GoodCommunication: published revision metadata and only the current generation survive pending heads and republishing") { fixture { f =>
    val original=request(List("published-metadata"))
    val receipt=publish(f,"a",original,List(List("old-generation")))
    val pending=original.copy(requestId=UUID.randomUUID(),expectedRevision=1,metadata=original.metadata.copy(tags=List("pending-head")))
    f.archive.ingest("a",pending)
    val search=index(f)
    assertEquals(search.tags("a",query("",None,100)),List(Facet("old-generation",1),Facet("published-metadata",1)))
    val claim=f.archive.claim(f.catalog.knownProfiles,ClaimScope.Owner("a"),300).get
    StoredPublicationFixtures.publish(f.db,claim,List(IndexedChunk(Chunk(UUID.randomUUID(),receipt.sessionId,"synthetic","synthetic",List("new-generation"),Nil,0.0),ProblemPublicationFixtures.vector)))
    assertEquals(search.tags("a",query("",None,100)),List(Facet("new-generation",1),Facet("pending-head",1)))
    assertEquals(search.tags("a",query("old-generation",None,100)),Nil)
    assertEquals(search.tags("a",query("published-metadata",None,100)),Nil)
    f.archive.ingest("a",request(List("unpublished-only")))
    assertEquals(search.tags("a",query("unpublished-only",None,100)),Nil)
  }}

  test("BG GoodCommunication: existing structured filters apply conjunctively to the current published metadata and generation tags") { fixture { f =>
    val original=request(List("metadata"))
    val published=original.copy(metadata=original.metadata.copy(project=Some("chosen"),gitBranch=Some("branch"),startedAt=Some("2026-02-03T00:00:00Z")))
    publish(f,"a",published,List(List("generated")))
    publish(f,"a",request(List("other")),List(Nil))
    f.archive.ingest("a",published.copy(requestId=UUID.randomUUID(),expectedRevision=1,metadata=published.metadata.copy(project=Some("pending"),tags=List("pending"))))
    val search=index(f)
    val filter=SearchFilter(Some("chosen"),Some("branch"),Some("2026-02-01T00:00:00Z"),Some("2026-02-04T00:00:00Z"),List("metadata","generated"))
    assertEquals(search.tags("a",TagSearchQuery("",filter,None,100)),List(Facet("generated",1),Facet("metadata",1)))
    List(filter.copy(project=Some("pending")),filter.copy(gitBranch=Some("wrong")),filter.copy(after=Some("2026-02-04T00:00:00Z")),filter.copy(before=Some("2026-02-01T00:00:00Z")),filter.copy(tags=List("missing"))).foreach { denied =>
      assertEquals(search.tags("a",TagSearchQuery("",denied,None,100)),Nil)
    }
  }}

  test("BG GoodCommunication: live pages reflect direct group visibility loss tombstones and disabled owners without transitive sharing") { fixture { f =>
    publish(f,"a",request(List("own")),List(List("common")))
    val shared=publish(f,"b",request(List("shared")),List(List("common")))
    publish(f,"c",request(List("private")),List(List("common")))
    val search=index(f)
    assertEquals(search.tags("a",query("",None,100)),List(Facet("common",1),Facet("own",1)))
    val group=share(f)
    val bc=UUID.randomUUID()
    f.db.transaction { c => Sql.exec(c,"INSERT INTO ch_groups VALUES(?,'b','BC')",bc); Sql.exec(c,"INSERT INTO ch_members VALUES(?,'b'),(?,'c')",bc,bc) }
    assertEquals(search.tags("a",query("",None,100)),List(Facet("common",2),Facet("own",1),Facet("shared",1)))
    f.db.transaction(c => Sql.exec(c,"DELETE FROM ch_members WHERE group_id=? AND user_id='b'",group))
    assertEquals(search.tags("a",query("",Some("own"),100)),Nil)
    f.db.transaction(c => Sql.exec(c,"INSERT INTO ch_members VALUES(?,'b')",group))
    f.db.transaction(c => Sql.exec(c,"UPDATE ch_users SET enabled=false WHERE id='b'"))
    assertEquals(search.tags("a",query("shared",None,100)),Nil)
    f.db.transaction(c => Sql.exec(c,"UPDATE ch_users SET enabled=true WHERE id='b'"))
    f.db.transaction(c => Sql.exec(c,"UPDATE ch_sources SET tombstone=true WHERE id=?",shared.sessionId))
    assertEquals(search.tags("a",query("shared",None,100)),Nil)
    f.db.transaction(c => Sql.exec(c,"UPDATE ch_users SET enabled=false WHERE id='a'"))
    assertEquals(search.tags("a",query("",None,100)),Nil)
  }}

  test("BG GoodCommunication: catalog reads do not depend on embedding profile availability or maintenance state") { fixture { f =>
    publish(f,"a",request(List("available")),List(Nil))
    f.db.transaction { c => Sql.exec(c,"UPDATE ch_owner_targets SET profile='unresolvable' WHERE owner='a'"); Sql.exec(c,"UPDATE ch_profile SET maintenance=true") }
    assertEquals(index(f).tags("a",query("",None,100)),List(Facet("available",1)))
  }}

  test("BA specified: count conversion rejects negative or overflowing SQL bigint values without truncation") {
    assertEquals(TagSearchPolicy.count(0L),0); assertEquals(TagSearchPolicy.count(Int.MaxValue.toLong),Int.MaxValue)
    List(-1L,Int.MaxValue.toLong+1,Long.MaxValue).foreach(value => assertEquals(intercept[DomainError](TagSearchPolicy.count(value)).code,"projection"))
  }

  test("BG GoodCommunication: invalid bounds Unicode NUL and structured filters are rejected before any SQL") { fixture { f =>
    val search=index(f); val valid=query("",None,100)
    val malformed=List("\u0000","\ud800","\udc00","a\ud800b")
    val invalid=List(valid.copy(limit=0),valid.copy(limit=101),valid.copy(query="x"*2049))++
      malformed.flatMap(value => List(valid.copy(query=value),valid.copy(afterTag=Some(value)),valid.copy(filter=emptyFilter.copy(project=Some(value))),valid.copy(filter=emptyFilter.copy(gitBranch=Some(value))),valid.copy(filter=emptyFilter.copy(after=Some(value))),valid.copy(filter=emptyFilter.copy(before=Some(value))),valid.copy(filter=emptyFilter.copy(tags=List(value)))))++
      List(valid.copy(filter=emptyFilter.copy(project=Some("x"*257))),valid.copy(filter=emptyFilter.copy(gitBranch=Some("x"*257))),valid.copy(filter=emptyFilter.copy(tags=List("x"*129))),valid.copy(filter=emptyFilter.copy(tags=List.fill(33)("a"))),valid.copy(filter=emptyFilter.copy(after=Some("not a timestamp"))))
    invalid.foreach(q => assertEquals(intercept[DomainError](search.tags("a",q,ReadMaterialization.admitted(ReadAdmission.limited(1).unsafeRunSync()))).code,"invalid"))
    assertEquals(f.probe.observations,Nil)
  }}

  test("WG GoodCommunication: source budget rejects the bounded numeric page before any JDBC JSON or tag payload") { fixture { f =>
    val values=(0 until 100).map(i => f"long-$i%03d-"+("x"*1000)).toList
    publish(f,"a",request(Nil),values.grouped(10).toList)
    val failure=intercept[DomainError](index(f).tags("a",query("",None,100),admission(f,65536L,_ => ())))
    assertEquals(failure.code,"read-budget"); assertEquals(payloads(f),Nil)
    val statements=f.probe.observations.collect { case SourceEvent.Statement(_,sql) => sql }
    assert(statements.exists(_.startsWith("DECLARE ch_mcp_selected_sources")))
    assert(!statements.contains("FETCH FORWARD 100 FROM ch_mcp_selected_sources"))
    assertEquals(f.probe.activeResults.get(),0)
  }}

  test("WG GoodCommunication: admitted tags use a bounded frozen RR selection before decode and fresh pages see sharing loss") { fixture { f =>
    publish(f,"a",request(List("visible")),List(List("also-visible")))
    val group=share(f); val changed=new AtomicBoolean()
    val materialization=admission(f,65536L,_ => if(changed.compareAndSet(false,true)) f.db.transaction(c => Sql.exec(c,"DELETE FROM ch_members WHERE group_id=? AND user_id='b'",group)))
    val search=index(f)
    assertEquals(search.tags("b",query("",None,2),materialization),List(Facet("also-visible",1),Facet("visible",1)))
    assert(changed.get()); assertEquals(search.tags("b",query("",None,2)),Nil)
    val events=f.probe.observations
    val consumed=events.indexWhere { case _: SourceEvent.Consumed => true; case _ => false }
    val payload=events.indexWhere { case _: SourceEvent.Payload => true; case _ => false }
    assert(consumed>=0 && payload>consumed)
    assert(events.exists { case SourceEvent.Statement(_,sql) => sql=="FETCH FORWARD 2 FROM ch_mcp_selected_sources"; case _ => false })
    assert(events.exists { case SourceEvent.Statement(_,sql) => sql=="SET LOCAL statement_timeout = '5s'"; case _ => false })
    assert(events.collect { case SourceEvent.Isolation(_,level) => level }.forall(_==Connection.TRANSACTION_REPEATABLE_READ))
    assertEquals(f.probe.activeResults.get(),0)
  }}

  test("WG GoodCommunication: admitted catalog works with SELECT only and no TEMP privilege") { fixture { f =>
    publish(f,"a",request(List("select-only")),List(Nil))
    val role="tag_catalog_"+UUID.randomUUID().toString.replace("-","")
    val database=f.db.transaction(c => Sql.one(c,"SELECT current_database()")(_.getString(1)).get)
    val identifier="\""+database.replace("\"","\"\"")+"\""
    f.db.transaction { c =>
      Sql.exec(c,s"CREATE ROLE $role LOGIN"); Sql.exec(c,s"REVOKE TEMP ON DATABASE $identifier FROM PUBLIC")
      Sql.exec(c,s"GRANT USAGE ON SCHEMA public TO $role")
      Sql.exec(c,s"GRANT SELECT ON ch_sources,ch_users,ch_members,ch_generations,ch_revision_info,ch_generation_tags TO $role")
    }
    try {
      val config=f.config.copy(databaseUser=role,jdbcUrl=f.probe.url(f.config.jdbcUrl)); val db=new Database(config,f.catalog)
      assertEquals(intercept[java.sql.SQLException](db.transaction(c => Sql.exec(c,"CREATE TEMP TABLE forbidden(i integer)"))).getSQLState,"42501")
      val search=new PostgresSearch(db,new PostgresArchive(db,config),config)
      assertEquals(search.tags("a",query("",None,100),admission(f,65536L,_ => ())),List(Facet("select-only",1)))
      assert(!f.probe.observations.exists { case SourceEvent.Statement(_,sql) => List("INSERT","UPDATE","DELETE").exists(sql.startsWith); case _ => false })
    } finally f.db.transaction { c => Sql.exec(c,s"GRANT TEMP ON DATABASE $identifier TO PUBLIC"); Sql.exec(c,s"DROP OWNED BY $role"); Sql.exec(c,s"DROP ROLE $role") }
  }}
}
