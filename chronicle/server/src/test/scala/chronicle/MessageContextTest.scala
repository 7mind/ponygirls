package chronicle

import chronicle.api.*
import cats.effect.unsafe.implicits.global
import java.nio.charset.StandardCharsets.UTF_8
import java.util.UUID

private[chronicle] object DummyMessageContext {
  def read(id: UUID,view: ContentView,messages: List[Message],anchor: Span,before: Int,after: Int,materialization: ReadMaterialization): MessageContextResult = {
    val position=messages.indexWhere(_.id==anchor.messageId)
    Check(position>=0,"not-found","message not found")
    val bytes=messages.map(_.text.getBytes(UTF_8)).toVector
    def boundary(p: Int,n: Int): Boolean = n>=0 && n<=bytes(p).length && (n==bytes(p).length || (bytes(p)(n)&192)!=128)
    Check(boundary(position,anchor.start) && boundary(position,anchor.end),"invalid","invalid scalar boundary")
    val ranges=scala.collection.mutable.Map(position -> (anchor.start,anchor.end))
    def walk(direction: Int,budget: Int): Unit = if(budget>0) {
      var p=position; var remaining=budget; var stopped=false
      while(p>=0 && p<messages.size && math.abs(p-position)<=MessageContextPolicy.maximumAdjacentMessages && !stopped) {
        val at=if(p==position) { if(direction<0) anchor.start else anchor.end } else if(direction<0) bytes(p).length else 0
        var outer=if(direction<0) math.max(0,at-remaining) else math.min(bytes(p).length,at+remaining)
        while(!boundary(p,outer)) outer-=direction
        val (start,end)=ranges.getOrElse(p,(at,at))
        if(p==position || bytes(p).isEmpty || outer!=at) ranges(p)=if(direction<0) (outer,end) else (start,outer)
        remaining-=math.abs(outer-at)
        stopped=if(direction<0) outer>0 else outer<bytes(p).length
        p+=direction
      }
    }
    walk(-1,before); walk(1,after)
    val excerpts=ranges.toList.sortBy(_._1).map { (p,range) => ContextExcerpt(PassageSourceSpan(messages(p).id,p,range._1,range._2),messages(p).role,new String(bytes(p).slice(range._1,range._2),UTF_8)) }
    val first=excerpts.head.source; val last=excerpts.last.source
    val previous=if(first.start>0 || first.messagePosition>0) Some(Span(first.messageId,first.start,first.start)) else None
    val next=if(last.end<bytes(last.messagePosition).length || last.messagePosition<messages.size-1) Some(Span(last.messageId,last.end,last.end)) else None
    val result=MessageContextResult(id,view,PassageSourceSpan(anchor.messageId,position,anchor.start,anchor.end),excerpts,previous,next)
    val measured=JsonUtf8Size(Wire.encode(MessageContextResult.codecJson,result))
    Check(measured<=MessageContextPolicy.maximumSourceBytes,"read-budget","context source byte budget exceeded")
    materialization.admit(measured)
    MessageContextPolicy.result(result)
  }
}
trait MessageContextFixture {
  def archive: SessionArchive
  def reader: ContextReader
  def share(): Unit
  def revoke(): Unit
  def disableReader(): Unit
  def disableOwner(): Unit
  def purge(id: UUID): Unit
  def retire(view: ContentView): Unit
}
// Specified behavioral blackbox contract, shared by the manual dummy and PostgreSQL adapter.
abstract class MessageContextContract extends munit.FunSuite {
  def withFixture(f: MessageContextFixture => Unit): Unit
  private def request(texts: List[String]): IngestRequest = Fixtures.snapshot().copy(messages=texts.zipWithIndex.map { (text,i) => Message(s"m$i",None,if(i%2==0) "user" else "assistant",text,None,2) })
  private def read(f: MessageContextFixture,id: UUID,anchor: Span,before: Int,after: Int): MessageContextResult = f.reader.readMessageContext("a",id,ContentView(1,None),anchor,before,after)
  private def exact(result: MessageContextResult,original: IngestRequest): Unit = {
    val source=SnapshotProjection(original).messages
    assertEquals(result.excerpts.map(_.source.messagePosition),result.excerpts.map(_.source.messagePosition).sorted.distinct)
    assert(result.excerpts.size<=9)
    result.excerpts.foreach { excerpt =>
      val span=excerpt.source; val message=source(span.messagePosition)
      assertEquals(span.messageId,message.id); assertEquals(excerpt.role,message.role)
      assertEquals(excerpt.text.getBytes(UTF_8).toList,message.text.getBytes(UTF_8).slice(span.start,span.end).toList)
    }
    assert(JsonUtf8Size(Wire.encode(Result.codecJson,Result.MessageContext(result)))<=MessageContextPolicy.maximumResultBytes)
  }
  test("BG/GoodCommunication: direct giant interior anchor and distant message positions preserve full source evidence") { withFixture { f =>
    val original=request(List.fill(120)("early")++List("x"*70000+"needle"+"y"*70000,"last"))
    val out=f.archive.ingest("a",original)
    val result=read(f,out.sessionId,Span("m120",70000,70006),2048,2048)
    assertEquals(result.anchor,PassageSourceSpan("m120",120,70000,70006))
    assertEquals(result.excerpts.map(_.text),List("x"*2048+"needle"+"y"*2048)); exact(result,original)
    assertEquals(result.previous,Some(Span("m120",67952,67952))); assertEquals(result.next,Some(Span("m120",72054,72054)))
  }}
  test("BG/GoodCommunication: Unicode scalars, combining marks, NUL normalization and independent spans") { withFixture { f =>
    val original=request(List("A🙂e\u0301Z\u0000B")); val out=f.archive.ingest("a",original)
    val first=read(f,out.sessionId,Span("m0",5,6),4,4)
    assertEquals(first.excerpts.head.text,"🙂e\u0301Z\\"); exact(first,original)
    val second=read(f,out.sessionId,Span("m0",1,5),0,0)
    assertEquals(second.excerpts.head.text,"🙂"); exact(second,original)
    List(Span("m0",2,5),Span("m0",1,4),Span("m0",0,999),Span("m0",-1,0),Span("m0",4,1)).foreach { anchor =>
      assertEquals(intercept[DomainError](read(f,out.sessionId,anchor,4,4)).code,"invalid")
    }
  }}
  test("BG/GoodCommunication: stop at the first nonfitting scalar, never skip it to spend remaining bytes") { withFixture { f =>
    val original=request(List("za🙂Q🙂az")); val out=f.archive.ingest("a",original)
    val result=read(f,out.sessionId,Span("m0",6,7),4,4)
    assertEquals(result.excerpts.head.text,"🙂Q🙂"); exact(result,original)
    val clipped=read(f,out.sessionId,Span("m0",0,1),0,4)
    assertEquals(clipped.excerpts.head.text,"za"); assertEquals(clipped.next,Some(Span("m0",2,2)))
  }}
  test("BG/GoodCommunication: anchor is never clipped by directional budgets; malformed budgets fail explicitly") { withFixture { f =>
    val original=request(List("x"*2049)); val out=f.archive.ingest("a",original)
    assertEquals(read(f,out.sessionId,Span("m0",0,2048),0,0).excerpts.head.text,"x"*2048)
    assertEquals(intercept[DomainError](read(f,out.sessionId,Span("m0",0,2049),0,0)).code,"read-budget")
    List(-1,1,2,3,2049,Int.MaxValue).foreach { budget =>
      assertEquals(intercept[DomainError](read(f,out.sessionId,Span("m0",0,1),budget,4)).code,"invalid")
      assertEquals(intercept[DomainError](read(f,out.sessionId,Span("m0",0,1),4,budget)).code,"invalid")
    }
  }}
  List(true,false).foreach { forward =>
    test(s"BG/GoodCommunication: exact side budget stops before a nonempty neighbor without a zero-text excerpt, forward=$forward") { withFixture { f =>
      val original=request(List("abcd","efgh")); val out=f.archive.ingest("a",original)
      val anchor=if(forward) Span("m0",0,0) else Span("m1",4,4)
      val result=read(f,out.sessionId,anchor,if(forward) 0 else 4,if(forward) 4 else 0)
      assertEquals(result.excerpts.map(_.source.messagePosition),List(if(forward) 0 else 1))
      assertEquals(result.excerpts.map(_.text),List(if(forward) "abcd" else "efgh"))
      assertEquals(if(forward) result.next else result.previous,Some(if(forward) Span("m0",4,4) else Span("m1",0,0)))
      exact(result,original)
    }}
    test(s"BG/GoodCommunication: a nonfitting adjacent scalar produces no zero-text excerpt and never skips farther text, forward=$forward") { withFixture { f =>
      val original=request(List("far","🙂","abc","🙂","far")); val out=f.archive.ingest("a",original)
      val anchor=if(forward) Span("m2",0,0) else Span("m2",3,3)
      val result=read(f,out.sessionId,anchor,if(forward) 0 else 4,if(forward) 4 else 0)
      assertEquals(result.excerpts.map(_.source.messagePosition),List(2)); assertEquals(result.excerpts.map(_.text),List("abc"))
      assertEquals(if(forward) result.next else result.previous,Some(if(forward) Span("m2",3,3) else Span("m2",0,0)))
      exact(result,original)
    }}
  }
  test("BG/GoodCommunication: nine-excerpt cap includes encountered empties and preserves roles and source order") { withFixture { f =>
    val original=request(List.fill(6)(""):::List("Q"):::List.fill(6)("")); val out=f.archive.ingest("a",original)
    val result=read(f,out.sessionId,Span("m6",0,1),4,4)
    assertEquals(result.excerpts.map(_.source.messagePosition),(2 to 10).toList)
    assertEquals(result.previous,Some(Span("m2",0,0))); assertEquals(result.next,Some(Span("m10",0,0)))
    exact(result,original)
  }}
  test("BG/GoodCommunication: both zero-width continuation directions reconstruct text and empty sequences without duplication or skipping") { withFixture { f =>
    val original=request(List.fill(7)(""):::List("🙂e\u0301xyz"*5,""):::List.fill(7)(""):::List("ABCD🙂Z"):::List.fill(7)("")); val out=f.archive.ingest("a",original)
    def reconstruct(forward: Boolean): String = {
      var anchor=if(forward) Span("m0",0,0) else Span(s"m${original.messages.size-1}",0,0)
      var texts=List.empty[String]; var finished=false; var rounds=0
      var previousPosition=if(forward) -1 else Int.MaxValue
      var previousOffset=if(forward) -1 else Int.MaxValue
      while(!finished && rounds<100) {
        val result=read(f,out.sessionId,anchor,if(forward) 0 else 4,if(forward) 4 else 0); exact(result,original)
        val text=result.excerpts.map(_.text).mkString
        texts=if(forward) texts:+text else text::texts
        val next=if(forward) result.next else result.previous
        next match {
          case None => finished=true
          case Some(value) =>
            val position=original.messages.indexWhere(_.id==value.messageId)
            assert(if(forward) position>previousPosition || (position==previousPosition && value.start>previousOffset) else position<previousPosition || (position==previousPosition && value.start<previousOffset))
            previousPosition=position; previousOffset=value.start; anchor=value
        }
        rounds+=1
      }
      assert(finished,"continuation did not terminate"); texts.mkString
    }
    val expected=SnapshotProjection(original).messages.map(_.text).mkString
    assertEquals(reconstruct(true),expected); assertEquals(reconstruct(false),expected)
  }}
  test("BG/GoodCommunication: exact caller N and N-1 admission and cumulative request budget") { withFixture { f =>
    val original=request(List("\u0001α🙂\"\\"*100)); val out=f.archive.ingest("a",original); val view=ContentView(1,None); val anchor=Span("m0",0,1)
    var bytes=0L
    val recorder=ReadMaterialization.admitted(new ReadAdmission { def consume(n: Long): Unit={ bytes+=n; () } })
    val result=f.reader.readMessageContext("a",out.sessionId,view,anchor,0,2048,recorder)
    assert(bytes>0 && bytes<=MessageContextPolicy.maximumSourceBytes)
    val exactLimit=ReadMaterialization.admitted(ReadAdmission.limited(bytes).unsafeRunSync())
    assertEquals(f.reader.readMessageContext("a",out.sessionId,view,anchor,0,2048,exactLimit),result)
    val short=ReadMaterialization.admitted(ReadAdmission.limited(bytes-1).unsafeRunSync())
    assertEquals(intercept[DomainError](f.reader.readMessageContext("a",out.sessionId,view,anchor,0,2048,short)).code,"read-budget")
    val shared=ReadMaterialization.admitted(ReadAdmission.limited(bytes*2-1).unsafeRunSync())
    assertEquals(f.reader.readMessageContext("a",out.sessionId,view,anchor,0,2048,shared),result)
    assertEquals(intercept[DomainError](f.reader.readMessageContext("a",out.sessionId,view,anchor,0,2048,shared)).code,"read-budget")
  }}
  test("BG/GoodCommunication: exact old source and indexed pins survive append and republication; foreign pins never fall back") { withFixture { f =>
    val original=request(List("old source")); val out=f.archive.ingest("a",original)
    val claim=f.archive.claim(f.archive.knownProfiles,ClaimScope.Owner("a"),300).get; assert(f.archive.publish(claim,Nil))
    val pin=f.archive.session("a",out.sessionId).view
    f.archive.ingest("a",original.copy(requestId=UUID.randomUUID(),expectedRevision=1,messages=List(original.messages.head.copy(text="new text"))))
    val fresh=f.archive.claim(f.archive.knownProfiles,ClaimScope.Owner("a"),300).get; assert(f.archive.publish(fresh,Nil))
    List(ContentView(1,None),pin).foreach { view => assertEquals(f.reader.readMessageContext("a",out.sessionId,view,Span("m0",0,3),0,0).excerpts.head.text,"old") }
    val other=f.archive.ingest("a",request(List("other")))
    List((out.sessionId,ContentView(2,pin.generationId)),(other.sessionId,pin),(out.sessionId,ContentView(99,None))).foreach { (id,view) =>
      assertEquals(intercept[DomainError](f.reader.readMessageContext("a",id,view,Span("m0",0,3),0,0)).code,"not-found")
    }
    f.retire(pin)
    assertEquals(intercept[DomainError](f.reader.readMessageContext("a",out.sessionId,pin,Span("m0",0,3),0,0)).code,"indexed-view-retired")
  }}
  test("BG/GoodCommunication: fresh ACL, reader disable and owner disable reject copied anchors") { withFixture { f =>
    val out=f.archive.ingest("a",request(List("shared"))); val view=ContentView(1,None); val anchor=Span("m0",0,6)
    assertEquals(intercept[DomainError](f.reader.readMessageContext("b",out.sessionId,view,anchor,0,0)).code,"not-found")
    f.share(); assertEquals(f.reader.readMessageContext("b",out.sessionId,view,anchor,0,0).excerpts.head.text,"shared")
    f.revoke(); assertEquals(intercept[DomainError](f.reader.readMessageContext("b",out.sessionId,view,anchor,0,0)).code,"not-found")
    f.share(); f.disableReader(); assertEquals(intercept[DomainError](f.reader.readMessageContext("b",out.sessionId,view,anchor,0,0)).code,"not-found")
    f.disableOwner(); assertEquals(intercept[DomainError](read(f,out.sessionId,anchor,0,0)).code,"not-found")
  }}
  test("BG/GoodCommunication: purged sessions and absent message IDs return not-found") { withFixture { f =>
    val out=f.archive.ingest("a",request(List("source")))
    assertEquals(intercept[DomainError](read(f,out.sessionId,Span("absent",0,0),0,0)).code,"not-found")
    f.purge(out.sessionId); assertEquals(intercept[DomainError](read(f,out.sessionId,Span("m0",0,0),0,0)).code,"not-found")
  }}
}
final class MessageContextDummyTest extends MessageContextContract {
  def withFixture(f: MessageContextFixture => Unit): Unit = {
    val c=Fixtures.config(); val value=new DummyArchive(c,IndexProfileCatalog.legacyOnly(c))
    f(new MessageContextFixture {
      val archive: SessionArchive=value; val reader: ContextReader=value
      def share(): Unit=value.share("a","b"); def revoke(): Unit=value.revokeSharing("a","b")
      def disableReader(): Unit=value.setEnabled("b",false); def disableOwner(): Unit=value.setEnabled("a",false)
      def purge(id: UUID): Unit=value.purge(id)
      def retire(view: ContentView): Unit=value.retireGeneration(view.generationId.get)
    })
  }
}
final class MessageContextPostgresTest extends MessageContextContract {
  def withFixture(f: MessageContextFixture => Unit): Unit = OwnerProfilePostgres.withDatabase { (c,db,value,_) =>
    val group=UUID.randomUUID()
    f(new MessageContextFixture {
      val archive: SessionArchive=value; val reader: ContextReader=value
      def share(): Unit=db.transaction { x => Sql.exec(x,"INSERT INTO ch_groups VALUES(?,'a','synthetic') ON CONFLICT DO NOTHING",group); Sql.exec(x,"INSERT INTO ch_members VALUES(?,'a'),(?,'b') ON CONFLICT DO NOTHING",group,group); () }
      def revoke(): Unit=db.transaction { x => Sql.exec(x,"DELETE FROM ch_members WHERE group_id=? AND user_id='b'",group); () }
      def disableReader(): Unit=db.transaction { x => Sql.exec(x,"UPDATE ch_users SET enabled=false WHERE id='b'"); () }
      def disableOwner(): Unit=db.transaction { x => Sql.exec(x,"UPDATE ch_users SET enabled=false WHERE id='a'"); () }
      def purge(id: UUID): Unit={ val auth=new Auth(db,c); val owner=auth.browser(auth.login(LoginRequest("a","synthetic"))._2); auth.mutate(owner,ClientEnvelope(UUID.randomUUID(),Operation.Purge(id))); () }
      def retire(view: ContentView): Unit=db.transaction { x => Sql.exec(x,"UPDATE ch_generations SET retired=true WHERE id=?",view.generationId.get); () }
    })
  }
}
