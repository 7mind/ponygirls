package chronicle

import chronicle.api.*
import cats.effect.unsafe.implicits.global
import java.util.UUID

trait MessageSearchFixture {
  def archive: SessionArchive
  def reader: MessageSearchReader
  def share(): Unit
  def revoke(): Unit
  def disableReader(): Unit
  def disableOwner(): Unit
  def purge(id: UUID): Unit
}
// Specified-origin: one behavioral blackbox contract, dummy and controllable PostgreSQL legs.
abstract class SessionMessageSearchContract extends munit.FunSuite {
  def withFixture(f: MessageSearchFixture => Unit): Unit
  private def request(texts: List[String]): IngestRequest = Fixtures.snapshot().copy(messages=texts.zipWithIndex.map { (text,i) => Message(s"m$i",None,"user",text,None,2) })
  private def find(f: MessageSearchFixture,id: UUID,view: ContentView,q: String,cursor: Option[String],reader: String,limit: Int): SessionMessageSearchResult =
    f.reader.searchSessionMessages(reader,id,view,q,cursor,limit)
  private val sourceViewBytes=JsonUtf8Size(io.circe.Json.obj("revision"->io.circe.Json.fromInt(1),"published"->io.circe.Json.Null,"indexed"->io.circe.Json.Null))
  // PostgreSQL jsonb::text adds a space after each of two colons and the comma.
  private def locatorSourceBytes(hit: MessageSearchHit): Long = JsonUtf8Size(Wire.encode(MessageSearchHit.codecJson,hit))+3L

  // Regression-origin: dummy previously omitted the metadata charge on no-match reads.
  test("BG/GoodCommunication: no-match reads still consume the caller view metadata budget") { withFixture { f =>
    val out=f.archive.ingest("a",request(List("source text")))
    val materialization=ReadMaterialization.admitted(ReadAdmission.limited(0).unsafeRunSync())
    assertEquals(intercept[DomainError](f.reader.searchSessionMessages("a",out.sessionId,ContentView(1,None),"absent",None,1,materialization)).code,"read-budget")
  }}
  test("BG/GoodCommunication: caller budget admits metadata then fails on the separate selected locator charge") { withFixture { f =>
    val out=f.archive.ingest("a",request(List("source text")))
    val limit=ReadAdmission.limited(sourceViewBytes).unsafeRunSync()
    val charges=scala.collection.mutable.ListBuffer.empty[Long]
    val admission=new ReadAdmission { def consume(bytes: Long): Unit = { charges+=bytes; limit.consume(bytes) } }
    assertEquals(intercept[DomainError](f.reader.searchSessionMessages("a",out.sessionId,ContentView(1,None),"source",None,1,ReadMaterialization.admitted(admission))).code,"read-budget")
    assertEquals(charges.toList,List(sourceViewBytes,locatorSourceBytes(MessageSearchHit("m0",0))))
  }}
  test("BG/GoodCommunication: caller admission accumulates metadata and exact locator framing across reads") { withFixture { f =>
    val out=f.archive.ingest("a",request(List("source text"))); val view=ContentView(1,None)
    val oneRead=sourceViewBytes+locatorSourceBytes(MessageSearchHit("m0",0))
    val exact=ReadMaterialization.admitted(ReadAdmission.limited(oneRead).unsafeRunSync())
    assertEquals(f.reader.searchSessionMessages("a",out.sessionId,view,"source",None,1,exact).hits,List(MessageSearchHit("m0",0)))
    val shared=ReadMaterialization.admitted(ReadAdmission.limited(2*oneRead-1).unsafeRunSync())
    assertEquals(f.reader.searchSessionMessages("a",out.sessionId,view,"source",None,1,shared).hits,List(MessageSearchHit("m0",0)))
    assertEquals(intercept[DomainError](f.reader.searchSessionMessages("a",out.sessionId,view,"source",None,1,shared)).code,"read-budget")
    val noMatch=ReadMaterialization.admitted(ReadAdmission.limited(sourceViewBytes).unsafeRunSync())
    assertEquals(f.reader.searchSessionMessages("a",out.sessionId,view,"absent",None,1,noMatch).hits,Nil)
    assertEquals(intercept[DomainError](f.reader.searchSessionMessages("a",out.sessionId,view,"absent",None,1,noMatch)).code,"read-budget")
  }}
  test("BG/GoodCommunication: locator source accounting preserves PostgreSQL JSON escaping for opaque IDs") { withFixture { f =>
    val original=request(List("source text"))
    val messageId="α🙂\"\t\\\u007f\u0085"
    val out=f.archive.ingest("a",original.copy(messages=original.messages.map(_.copy(id=messageId))))
    val charges=scala.collection.mutable.ListBuffer.empty[Long]
    val admission=new ReadAdmission { def consume(bytes: Long): Unit = { charges+=bytes; () } }
    val hits=f.reader.searchSessionMessages("a",out.sessionId,ContentView(1,None),"source",None,1,ReadMaterialization.admitted(admission)).hits
    assertEquals(hits,List(MessageSearchHit(messageId,0)))
    // JSONB leaves DEL/C1 scalars literal, saving 5+4 bytes over Circe's escapes.
    assertEquals(charges.toList,List(sourceViewBytes,locatorSourceBytes(hits.head)-9L))
  }}
  test("BG/GoodCommunication: historical text pin charges current view metadata without following HEAD") { withFixture { f =>
    val original=request(List("source text")); val out=f.archive.ingest("a",original)
    val claim=f.archive.claim(f.archive.knownProfiles,ClaimScope.Owner("a"),300).get
    assert(f.archive.publish(claim,Nil)); val published=f.archive.session("a",out.sessionId).view
    f.archive.ingest("a",original.copy(requestId=UUID.randomUUID(),expectedRevision=1))
    val charges=scala.collection.mutable.ListBuffer.empty[Long]
    val admission=new ReadAdmission { def consume(bytes: Long): Unit = { charges+=bytes; () } }
    val result=f.reader.searchSessionMessages("a",out.sessionId,ContentView(1,None),"absent",None,1,ReadMaterialization.admitted(admission))
    val expected=JsonUtf8Size(io.circe.Json.obj("revision"->io.circe.Json.fromInt(2),"published"->io.circe.Json.fromString(published.generationId.get.toString),"indexed"->io.circe.Json.fromInt(1)))
    assertEquals(result.view,ContentView(1,None)); assertEquals(result.hits,Nil)
    assertEquals(charges.toList,List(expected,0L))
  }}
  test("BG/GoodCommunication: lookahead-only locator excess counts PostgreSQL JSON spacing before any partial page") { withFixture { f =>
    def largeRequest(count: Int): IngestRequest = {
      val original=request(List.fill(count)("echo"))
      original.copy(messages=original.messages.zipWithIndex.map { (message,i) => message.copy(id="界"*249+f"$i%02d") })
    }
    val values=largeRequest(84)
    val selected=values.messages.zipWithIndex.map { (message,i) => MessageSearchHit(message.id,i) }
    assert(selected.map(hit => JsonUtf8Size(Wire.encode(MessageSearchHit.codecJson,hit))).sum<=SessionMessageSearchPolicy.maximumLocatorBytes)
    assert(selected.take(83).map(locatorSourceBytes).sum<=SessionMessageSearchPolicy.maximumLocatorBytes)
    assert(selected.map(locatorSourceBytes).sum>SessionMessageSearchPolicy.maximumLocatorBytes)
    val out=f.archive.ingest("a",values); val view=ContentView(1,None)
    assertEquals(find(f,out.sessionId,view,"echo",None,"a",82).hits.size,82)
    assertEquals(intercept[DomainError](find(f,out.sessionId,view,"echo",None,"a",83)).code,"read-budget")
    val withoutLookahead=f.archive.ingest("a",largeRequest(83))
    assertEquals(find(f,withoutLookahead.sessionId,view,"echo",None,"a",83).hits.size,83)
  }}
  test("BG/GoodCommunication: all normalized text in an unindexed exact revision, beyond first 100 and fragment boundaries") { withFixture { f =>
    val texts=List.fill(110)("nothing")++List("a"*(ArchiveProjection.fragmentBytes-2)+"BoundaryNeedle", "NEEDLE needle", "literal %_\\ α🙂\u0001", "A\u0000B")
    val original=request(texts); val out=f.archive.ingest("a",original); val view=ContentView(1,None)
    assertEquals(find(f,out.sessionId,view,"boundaryneedle",None,"a",100).hits,List(MessageSearchHit("m110",110)))
    assertEquals(find(f,out.sessionId,view,"Needle",None,"a",100).hits.map(_.position),List(110,111))
    assertEquals(find(f,out.sessionId,view,"%_\\ α🙂\u0001",None,"a",100).hits.map(_.position),List(112))
    assertEquals(find(f,out.sessionId,view,"\\u0000",None,"a",100).hits.map(_.position),List(113))
    assertEquals(find(f,out.sessionId,view,"\u0000",None,"a",100).hits.map(_.position),List(113))
    List("synthetic","PostgreSQL","project","model_change").foreach(q => assertEquals(find(f,out.sessionId,view,q,None,"a",100).hits,Nil))
    assertEquals(find(f,out.sessionId,view,"%_",None,"a",100).hits.map(_.position),List(112))
    assertEquals(find(f,out.sessionId,view,"absent",None,"a",100).nextCursor,None)
  }}
  test("BG/GoodCommunication: published annotations and generated tags are excluded from selected text find") { withFixture { f =>
    val out=f.archive.ingest("a",request(List("source text")))
    val claim=f.archive.claim(f.archive.knownProfiles,ClaimScope.Owner("a"),300).get
    val chunk=Fragments.split(claim.snapshot.messages).head.copy(sessionId=out.sessionId,summary="annotationonly",tags=List("tagonly"))
    assert(f.archive.publish(claim,List(IndexedChunk(chunk,List(1.0,0.0,0.0)))))
    val view=f.archive.session("a",out.sessionId).view
    List("annotationonly","tagonly").foreach { query => assertEquals(find(f,out.sessionId,view,query,None,"a",100).hits,Nil) }
    assertEquals(find(f,out.sessionId,view,"SOURCE",None,"a",100).hits,List(MessageSearchHit("m0",0)))
  }}
  test("BG/GoodCommunication: database lower semantics for Greek sigma, dotted I and accented capitals") { withFixture { f =>
    val out=f.archive.ingest("a",request(List("ΟΣ","οσ","ος","İ","i","i\u0307","ÉCOLE"))); val view=ContentView(1,None)
    List(("οσ",List(1)),("ος",List(0,2)),("i",List(3,4,5)),("i\u0307",List(3,5)),("école",List(6))).foreach { (query,positions) =>
      assertEquals(find(f,out.sessionId,view,query,None,"a",100).hits.map(_.position),positions,s"query=$query")
    }
  }}
  test("BG/GoodCommunication: one locator per matching message, stable keyset pages and bound authenticated cursor") { withFixture { f =>
    val out=f.archive.ingest("a",request(List.fill(105)("Echo echo"))); val view=ContentView(1,None)
    val first=find(f,out.sessionId,view,"echo",None,"a",100); assertEquals(first.view,view)
    assertEquals(first.hits.map(_.position),(0 until 100).toList); assert(first.nextCursor.nonEmpty)
    val next=find(f,out.sessionId,view,"echo",first.nextCursor,"a",100)
    assertEquals(next.hits.map(_.position),(100 until 105).toList); assertEquals(next.nextCursor,None)
    assertEquals(find(f,out.sessionId,view,"echo",first.nextCursor,"a",100),next)
    assertEquals(intercept[DomainError](find(f,out.sessionId,view,"other",first.nextCursor,"a",100)).code,"invalid")
    f.share()
    assertEquals(intercept[DomainError](find(f,out.sessionId,view,"echo",first.nextCursor,"b",100)).code,"invalid")
    val token=first.nextCursor.get
    assertEquals(intercept[DomainError](find(f,out.sessionId,view,"echo",Some(token.dropRight(5)+"AAAAA"),"a",100)).code,"invalid")
    val foreign=f.archive.ingest("a",request(List("echo")))
    assertEquals(intercept[DomainError](find(f,foreign.sessionId,view,"echo",first.nextCursor,"a",100)).code,"invalid")
  }}
  test("BG/GoodCommunication: full generation pin echoed, old source and indexed pins survive append and replacement") { withFixture { f =>
    val original=request(List("old needle","needle")); val out=f.archive.ingest("a",original); val source=ContentView(1,None)
    val first=find(f,out.sessionId,source,"needle",None,"a",1)
    val claim=f.archive.claim(f.archive.knownProfiles,ClaimScope.Owner("a"),300).get; assert(f.archive.publish(claim,Nil))
    val published=f.archive.session("a",out.sessionId).view
    assertEquals(find(f,out.sessionId,published,"old",None,"a",100).view,published)
    assertEquals(intercept[DomainError](find(f,out.sessionId,published,"needle",first.nextCursor,"a",100)).code,"invalid")
    val updated=request(List("new replacement")).copy(source=original.source,expectedRevision=1)
    f.archive.ingest("a",updated)
    assertEquals(intercept[DomainError](find(f,out.sessionId,ContentView(2,None),"needle",first.nextCursor,"a",100)).code,"invalid")
    assertEquals(find(f,out.sessionId,source,"old",None,"a",100).hits,List(MessageSearchHit("m0",0)))
    assertEquals(find(f,out.sessionId,source,"needle",first.nextCursor,"a",100).hits,List(MessageSearchHit("m1",1)))
    val fresh=f.archive.claim(f.archive.knownProfiles,ClaimScope.Owner("a"),300).get; assert(f.archive.publish(fresh,Nil))
    assertEquals(find(f,out.sessionId,published,"old",None,"a",100).hits,List(MessageSearchHit("m0",0)))
    assertEquals(find(f,out.sessionId,source,"new",None,"a",100).hits,Nil)
    List(ContentView(2,published.generationId),ContentView(99,None),ContentView(1,Some(UUID.randomUUID()))).foreach { bad =>
      assertEquals(intercept[DomainError](find(f,out.sessionId,bad,"old",None,"a",100)).code,"not-found")
    }
    val other=f.archive.ingest("a",request(List("old")))
    assertEquals(intercept[DomainError](find(f,other.sessionId,published,"old",None,"a",100)).code,"not-found")
  }}
  test("BG/GoodCommunication: fresh authorization on later pages after revocation, reader disable, owner disable and purge") { withFixture { f =>
    val out=f.archive.ingest("a",request(List.fill(3)("echo"))); val view=ContentView(1,None)
    f.share(); val page=find(f,out.sessionId,view,"echo",None,"b",1)
    f.revoke(); assertEquals(intercept[DomainError](find(f,out.sessionId,view,"echo",page.nextCursor,"b",100)).code,"not-found")
    f.share(); f.disableReader(); assertEquals(intercept[DomainError](find(f,out.sessionId,view,"echo",page.nextCursor,"b",100)).code,"not-found")
    f.disableOwner(); assertEquals(intercept[DomainError](find(f,out.sessionId,view,"echo",None,"a",100)).code,"not-found")
  }}
  test("BG/GoodCommunication: a cursor grants no access to a purged source") { withFixture { f =>
    val out=f.archive.ingest("a",request(List.fill(3)("echo"))); val view=ContentView(1,None)
    val page=find(f,out.sessionId,view,"echo",None,"a",1); f.purge(out.sessionId)
    assertEquals(intercept[DomainError](find(f,out.sessionId,view,"echo",page.nextCursor,"a",100)).code,"not-found")
  }}
  test("BG/GoodCommunication: named UTF8 query/cursor/page bounds and unconditional locator byte budget") { withFixture { f =>
    val original=request(List.fill(100)("echo")); val huge=original.copy(messages=original.messages.zipWithIndex.map { (m,i) => m.copy(id="界"*250+i) })
    val out=f.archive.ingest("a",huge); val view=ContentView(1,None)
    assertEquals(intercept[DomainError](find(f,out.sessionId,view,"echo",None,"a",100)).code,"read-budget")
    assertEquals(find(f,out.sessionId,view,"echo",None,"a",1).hits.size,1)
    List("", "🙂"*513,"x"*2049,"\ud800").foreach { q => assertEquals(intercept[DomainError](find(f,out.sessionId,view,q,None,"a",100)).code,"invalid") }
    List(0,101,Int.MaxValue).foreach { n => assertEquals(intercept[DomainError](find(f,out.sessionId,view,"echo",None,"a",n)).code,"invalid") }
    assertEquals(intercept[DomainError](find(f,out.sessionId,view,"echo",Some("x"*4097),"a",100)).code,"invalid")
    assertEquals(find(f,out.sessionId,view,"x"*2048,None,"a",100).hits,Nil)
  }}
}
final class SessionMessageSearchDummyTest extends SessionMessageSearchContract {
  def withFixture(f: MessageSearchFixture => Unit): Unit = {
    val c=Fixtures.config(); val value=new DummyArchive(c,IndexProfileCatalog.legacyOnly(c))
    f(new MessageSearchFixture {
      val archive: SessionArchive=value; val reader: MessageSearchReader=value
      def share(): Unit=value.share("a","b"); def revoke(): Unit=value.revokeSharing("a","b")
      def disableReader(): Unit=value.setEnabled("b",false); def disableOwner(): Unit=value.setEnabled("a",false)
      def purge(id: UUID): Unit=value.purge(id)
    })
  }
}
final class SessionMessageSearchPostgresTest extends SessionMessageSearchContract {
  def withFixture(f: MessageSearchFixture => Unit): Unit = OwnerProfilePostgres.withDatabase { (c,db,value,_) =>
    val group=UUID.randomUUID()
    f(new MessageSearchFixture {
      val archive: SessionArchive=value; val reader: MessageSearchReader=value
      def share(): Unit=db.transaction { x => Sql.exec(x,"INSERT INTO ch_groups VALUES(?,'a','synthetic') ON CONFLICT DO NOTHING",group); Sql.exec(x,"INSERT INTO ch_members VALUES(?,'a'),(?,'b') ON CONFLICT DO NOTHING",group,group); () }
      def revoke(): Unit=db.transaction { x => Sql.exec(x,"DELETE FROM ch_members WHERE group_id=? AND user_id='b'",group); () }
      def disableReader(): Unit=db.transaction { x => Sql.exec(x,"UPDATE ch_users SET enabled=false WHERE id='b'"); () }
      def disableOwner(): Unit=db.transaction { x => Sql.exec(x,"UPDATE ch_users SET enabled=false WHERE id='a'"); () }
      def purge(id: UUID): Unit={ val auth=new Auth(db,c); val owner=auth.browser(auth.login(LoginRequest("a","synthetic"))._2); auth.mutate(owner,ClientEnvelope(UUID.randomUUID(),Operation.Purge(id))); () }
    })
  }
}
