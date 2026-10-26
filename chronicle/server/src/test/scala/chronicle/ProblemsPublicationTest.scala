package chronicle

import chronicle.api.*
import java.util.UUID
import ProblemPassages.*

object ProblemPublicationFixtures {
  val vector: List[Double] = List(1.0,0.0,0.0)
  def build(claim: Claim,decide: (Window,Option[Carry]) => Decision): ProblemsPublication = {
    val source=Source(claim.snapshot.messages)
    var state=State.start(claim.sessionId,UUID.randomUUID()); var builder=ProblemsPublication.empty
    var pending=source.next(state.nextSource)
    while(pending.nonEmpty) {
      val window=pending.get
      val delta=accept(state,window,decide(window,state.carry))
      builder=builder.append(delta,delta.pieces.map(piece => IndexedChunk(piece.chunk,vector)).toList)
      state=delta.state; pending=source.next(state.nextSource)
    }
    builder.append(finish(state,source),Nil).result
  }
  def oneProblem(claim: Claim): ProblemsPublication = build(claim,(window,previous) => Decision(Vector(Part(Point(0,0),window.terminal,previous.nonEmpty,
    if(previous.isEmpty) "initial synthetic goal" else "updated synthetic goal",List("synthetic")))))
  def topics(claim: Claim): ProblemsPublication = build(claim,(window,previous) => ProblemPassageFixtures.plan(window.fragments.map(_.text),previous.flatMap(_.tags.headOption)))
  def publish(archive: SessionArchive,claim: Claim,catalog: IndexProfileCatalog): Boolean = catalog.resolve(claim.profile).policy match {
    case IndexPolicy.LegacyV4 => archive.publish(claim,Nil)
    case IndexPolicy.ContiguousPassagesV1 => archive.publishProblems(claim,oneProblem(claim))
  }
  def request(texts: List[String]): IngestRequest = {
    val base=Fixtures.snapshot()
    val messages=texts.zipWithIndex.map((text,index) => Message(s"m$index",None,if(index%2==0) "tool" else "assistant",text,None,texts.size-index-1))
    val raw=messages.map(message => io.circe.Json.obj("id"->io.circe.Json.fromString(message.id),"text"->io.circe.Json.fromString(message.text)).noSpaces+"\n").mkString
    val content=if(raw.isEmpty) "{}\n" else raw
    base.copy(messages=messages,files=List(RawFile("synthetic.jsonl",Wire.hash(content),content)),digest=Wire.hash(content))
  }
}

class ProblemsPublicationTest extends munit.FunSuite {
  import ProblemPublicationFixtures.*
  private def claim(request: IngestRequest): Claim = Claim(UUID.randomUUID(),UUID.randomUUID(),1,1,"synthetic",SnapshotProjection(request),"a",0)
  test("BG: builder requires finish and matching indexed pieces, preserves embeddings and finalizes annotations separately") {
    val c=claim(request(List("A"*300000)))
    val publication=oneProblem(c)
    publication.validate(c,3)
    assertEquals(publication.passages.size,1); assertEquals(publication.passages.head.initialSummary,"initial synthetic goal")
    assertEquals(publication.passages.head.summary,"updated synthetic goal")
    assertEquals(publication.chunks.map(_.chunk.text).mkString,c.snapshot.messages.head.text)
    assert(publication.chunks.forall(indexed => indexed.vector==vector && indexed.chunk.summary=="updated synthetic goal"))
    assertEquals(publication.spans.size,1); assertEquals(publication.spans.head.source.end,300000)
    assertEquals(publication.links.map(_.passageOrdinal).distinct,Vector(0))
    val source=Source(c.snapshot.messages); val window=source.next(SourceCursor.start).get
    val delta=accept(State.start(c.sessionId,UUID.randomUUID()),window,Decision(Vector(Part(Point(0,0),window.terminal,false,"first",Nil))))
    assertEquals(intercept[DomainError](ProblemsPublication.empty.result).code,"invalid")
    assertEquals(intercept[DomainError](ProblemsPublication.empty.append(delta,Nil)).code,"invalid")
    assertEquals(intercept[DomainError](ProblemsPublication.empty.append(delta,delta.pieces.map(p => IndexedChunk(p.chunk,vector)).toList).result).code,"invalid")
    assertEquals(intercept[DomainError](publication.validate(c.copy(sessionId=UUID.randomUUID()),3)).code,"invalid")
    assertEquals(intercept[DomainError](publication.validate(c,4)).code,"invalid")
  }
  test("BG: source-faithful validation rejects publication from a different transcript and accepts empty projected input") {
    val c=claim(request(List("A🙂BαA🙂"))); val publication=topics(c)
    publication.validate(c,3)
    assertEquals(publication.passages.map(_.ordinal),Vector(0,1,2)); assertEquals(publication.links.map(_.passageOrdinal),Vector(0,1,2))
    assertEquals(intercept[DomainError](publication.validate(c.copy(snapshot=c.snapshot.copy(messages=c.snapshot.messages.map(_.copy(text="unrelated")))),3)).code,"invalid")
    val empty=claim(request(List("",""))); val result=oneProblem(empty)
    result.validate(empty,3); assertEquals(result.passages,Vector.empty); assertEquals(result.chunks,Nil)
  }
}
