package chronicle

import chronicle.api.Message
import cats.effect.{IO,Ref,Resource}
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import io.circe.Json
import java.nio.charset.StandardCharsets.UTF_8
import java.util.UUID
import scala.compiletime.testing.typeChecks
import ProblemPassages.*

object ProblemPassageFixtures {
  val sessionId: UUID = new UUID(0,1)
  val namespace: UUID = new UUID(0,2)
  def message(id: String,text: String,role: String,position: Int): Message = Message(id,None,role,text,None,position)
  def one(window: Window,continued: Boolean,summary: String,tags: List[String]): Decision = Decision(Vector(Part(Point(0,0),window.terminal,continued,summary,tags)))
  def pointJson(point: Point): Json = Json.obj("fragmentIndex"->Json.fromInt(point.fragmentIndex),"scalarOffset"->Json.fromInt(point.scalarOffset))
  def json(decision: Decision): Json = Json.obj("parts"->Json.arr(decision.parts.map(part => Json.obj("start"->pointJson(part.start),"end"->pointJson(part.end),
    "continuePrevious"->Json.fromBoolean(part.continuePrevious),"summary"->Json.fromString(part.summary),"tags"->Json.arr(part.tags.map(Json.fromString)*)))*))
  def envelope(content: String,finish: String): Json = Json.obj("choices"->Json.arr(Json.obj("finish_reason"->Json.fromString(finish),"message"->Json.obj("content"->Json.fromString(content)))))

  // Synthetic A/B markers define the fixture's problems; all other scalars are substeps of the current problem.
  def plan(texts: Vector[String],previousTopic: Option[String]): Decision = {
    val output=Vector.newBuilder[Part]
    var start=Point(0,0); var topic=previousTopic.getOrElse("A"); var first=true; var initialized=false; var continued=false
    texts.zipWithIndex.foreach { (text,index) =>
      var chars=0; var offset=0
      while(chars<text.length) {
        val cp=text.codePointAt(chars)
        val next=if(cp=='A') "A" else if(cp=='B') "B" else topic
        if(!initialized) { topic=next; continued=previousTopic.contains(topic); initialized=true }
        else if(next!=topic) {
          val end=Point(index,offset)
          output+=Part(start,end,first && continued,s"problem $topic",List(topic)); first=false; start=end; topic=next
        }
        chars+=Character.charCount(cp); offset+=1
      }
    }
    output+=Part(start,Point(texts.size,0),first && continued,s"problem $topic",List(topic))
    Decision(output.result())
  }
  final class Dummy extends ProblemPassageAnnotator {
    def annotate(window: Window,previous: Option[Carry]): IO[Decision] = IO {
      val decision=plan(window.fragments.map(_.text),previous.flatMap(_.tags.headOption))
      validate(window,previous.nonEmpty,decision); decision
    }
  }
  final case class Run(source: Source,deltas: Vector[Delta]) {
    def pieces: Vector[RetrievalPiece] = deltas.flatMap(_.pieces)
    def passages: Vector[Passage] = deltas.flatMap(_.passages).foldLeft(Map.empty[UUID,Passage])((all,update) => all.updated(update.passage.id,update.passage)).values.toVector.sortBy(_.ordinal)
    def spans: Vector[SpanUpdate] = deltas.flatMap(_.spans).foldLeft(Map.empty[(UUID,Long),SpanUpdate])((all,update) => all.updated((update.passageId,update.ordinal),update)).values.toVector.sortBy(x => (passages.indexWhere(_.id==x.passageId),x.ordinal))
  }
  def run(messages: List[Message],annotator: ProblemPassageAnnotator,embed: Delta => IO[Unit]): IO[Run] = IO.defer {
    val source=Source(messages)
    def loop(state: State,deltas: Vector[Delta]): IO[Run] = source.next(state.nextSource) match {
      case None => IO.pure(Run(source,deltas :+ finish(state,source)))
      case Some(window) => annotator.annotate(window,state.carry).flatMap { decision =>
        val delta=accept(state,window,decision)
        embed(delta) *> loop(delta.state,deltas :+ delta)
      }
    }
    loop(State.start(sessionId,namespace),Vector.empty)
  }
  def run(messages: List[Message],annotator: ProblemPassageAnnotator): IO[Run] = run(messages,annotator,_ => IO.unit)
}

abstract class ProblemPassageContract extends munit.FunSuite {
  import ProblemPassageFixtures.*
  protected def annotator: Resource[IO,ProblemPassageAnnotator]
  private def check(messages: List[Message])(assertions: Run => Unit): Unit = annotator.use(run(messages,_).map(assertions)).unsafeRunSync()
  protected def exactSource(result: Run,messages: List[Message]): Unit = {
    messages.zipWithIndex.foreach { (message,position) =>
      val pieces=result.pieces.filter(_.sourceSpan.messagePosition==position)
      assertEquals(pieces.map(_.chunk.text).mkString,message.text)
      var end=0
      pieces.foreach { piece =>
        val span=piece.sourceSpan
        assertEquals(span.messageId,message.id); assertEquals(span.start,end)
        assertEquals(span.end-span.start,piece.chunk.text.getBytes(UTF_8).length)
        assertEquals(new String(message.text.getBytes(UTF_8).slice(span.start,span.end),UTF_8),piece.chunk.text)
        assert(piece.chunk.text.nonEmpty && piece.chunk.text.getBytes(UTF_8).length<=maximumFragmentBytes)
        assertEquals(piece.chunk.spans,List(chronicle.api.Span(message.id,span.start,span.end)))
        end=span.end
      }
      assertEquals(end,message.text.getBytes(UTF_8).length)
    }
    assertEquals(result.pieces.map(_.chunk.id).distinct.size,result.pieces.size)
    assertEquals(result.pieces.map(_.sourceSpan.messagePosition),result.pieces.map(_.sourceSpan.messagePosition).sorted)
  }

  test("BG regression: twelve same-problem messages form one logical passage, not three independent partitions") {
    val messages=(0 until 12).map(i => message(s"m$i",s"A substep $i","assistant",i*2)).toList
    check(messages) { result => assertEquals(result.passages.size,1); assertEquals(result.passages.head.spanCount,12L); exactSource(result,messages) }
  }
  test("BG regression: one long problem continues across at least three bounded windows with original UTF8 source") {
    val messages=List(message("large","A"+"α🙂\u0001\n"*50000,"assistant",91))
    check(messages) { result =>
      assert(result.deltas.count(_.pieces.nonEmpty)>=3)
      assertEquals(result.passages.size,1); assertEquals(result.passages.head.spanCount,1L)
      assertEquals(result.passages.head.sourceBytes,messages.head.text.getBytes(UTF_8).length.toLong)
      assertEquals(result.passages.head.pieceCount,result.pieces.size.toLong)
      assertEquals(result.spans.size,1); assertEquals(result.spans.head.span.end,messages.head.text.getBytes(UTF_8).length)
      exactSource(result,messages)
    }
  }
  test("BG: the 64-fragment operational cap carries one problem across three windows without semantic cuts") {
    val messages=(0 until 160).map(i => message(s"m$i","A","tool",200-i)).toList
    check(messages) { result =>
      assertEquals(result.deltas.filter(_.pieces.nonEmpty).map(_.pieces.size),Vector(64,64,32))
      assertEquals(result.passages.size,1); assertEquals(result.passages.head.spanCount,160L); exactSource(result,messages)
    }
  }
  test("BG: A/B/A is three contiguous passages with distinct IDs, including inside one message") {
    val messages=List(message("mixed","AAAABBBBAAAA","user",0))
    check(messages) { result =>
      assertEquals(result.passages.map(_.tags),Vector(List("A"),List("B"),List("A")))
      assertEquals(result.passages.map(_.ordinal),Vector(0,1,2)); assertEquals(result.passages.map(_.id).distinct.size,3)
      assertEquals(result.passages.map(_.sourceBytes),Vector(4L,4L,4L)); exactSource(result,messages)
    }
  }
  test("BG regression: intramessage scalar cuts handle emoji, control Unicode and repeated text without substring search") {
    val messages=List(message("unicode","A🙂\u0001same🙂Bsame🙂Asame🙂","user",17))
    check(messages) { result =>
      assertEquals(result.pieces.map(_.chunk.text),Vector("A🙂\u0001same🙂","Bsame🙂","Asame🙂"))
      assertEquals(result.passages.map(_.start.byteOffset),Vector(0,"A🙂\u0001same🙂".getBytes(UTF_8).length,"A🙂\u0001same🙂Bsame🙂".getBytes(UTF_8).length))
      exactSource(result,messages)
    }
  }
  test("BG: tool-only and branching inputs retain linear normalized order, not record index or ancestry order") {
    val messages=List(message("tool1","A first tool","tool",91),Message("empty",Some("tool1"),"assistant","",None,2),
      Message("branch2",Some("tool1"),"tool"," tool result",None,19),Message("branch1",Some("tool1"),"assistant"," implementation and verification",None,3))
    check(messages) { result =>
      assertEquals(result.passages.size,1); assertEquals(result.passages.head.spanCount,3L)
      assertEquals(result.spans.map(_.span.messagePosition),Vector(0,2,3)); exactSource(result,messages)
    }
  }
  test("BG: empty-only transcripts and empty lists do not invoke a model or hallucinate a passage") {
    List(Nil,List(message("empty","","tool",0),message("alsoempty","","user",1))).foreach { messages =>
      val forbidden=new ProblemPassageAnnotator { def annotate(window: Window,previous: Option[Carry]): IO[Decision] = IO.raiseError(new AssertionError("empty source called model")) }
      val result=run(messages,forbidden).unsafeRunSync()
      assertEquals(result.passages,Vector.empty); assertEquals(result.pieces,Vector.empty); assert(result.deltas.last.state.finished)
    }
  }
  test("BG: one fragment may contain more distinct problems than the fragment count") {
    val messages=List(message("dense","ABABABAB","user",0))
    check(messages) { result => assertEquals(result.passages.size,8); exactSource(result,messages) }
  }
  test("BG: every validated window is embedded before the next call; a later model failure retains the embedded prefix") {
    annotator.use { base =>
      for {
        calls <- Ref.of[IO,Int](0)
        embedded <- Ref.of[IO,Vector[RetrievalPiece]](Vector.empty)
        checked=new ProblemPassageAnnotator {
          def annotate(window: Window,previous: Option[Carry]): IO[Decision] = calls.getAndUpdate(_+1).flatMap { index =>
            if(index==0) base.annotate(window,previous)
            else embedded.get.flatMap { prefix =>
              IO(assert(prefix.nonEmpty && prefix.map(_.chunk.text).mkString.forall(_=='A'))) *> IO.raiseError(DomainError("model-output","synthetic later-window failure"))
            }
          }
        }
        result <- run(List(message("large","A"*300000,"assistant",0)),checked,delta => embedded.update(_++delta.pieces)).attempt
        prefix <- embedded.get
        count <- calls.get
      } yield {
        assertEquals(result.swap.toOption.map(_.asInstanceOf[DomainError].code),Some("model-output")); assertEquals(count,2)
        assert(prefix.nonEmpty && prefix.size<=maximumWindowFragments); assert(prefix.map(_.chunk.text).mkString.length<300000)
      }
    }.unsafeRunSync()
  }
}

class ProblemPassagesTest extends ProblemPassageContract {
  import ProblemPassageFixtures.*
  protected def annotator: Resource[IO,ProblemPassageAnnotator] = Resource.pure(new Dummy)
  private def sample: Window = Source(List(message("one","A🙂","user",0),message("two","Bé","assistant",1))).next(SourceCursor.start).get
  private def bad(decision: Decision): Unit = assertEquals(intercept[DomainError](validate(sample,true,decision)).code,"model-output")

  test("BA: partition validation rejects gaps, overlaps, empty, reversed, range and noncanonical scalar coordinates") {
    val window=sample; val part=one(window,false,"summary",Nil).parts.head
    Vector(
      Decision(Vector.empty),Decision(Vector(part.copy(start=Point(0,1)))),Decision(Vector(part.copy(end=Point(1,0)))),
      Decision(Vector(part.copy(end=Point(0,0)))),Decision(Vector(part.copy(start=Point(1,1),end=Point(0,1)))),
      Decision(Vector(part.copy(start=Point(-1,0)))),Decision(Vector(part.copy(end=Point(3,0)))),Decision(Vector(part.copy(end=Point(2,1)))),
      Decision(Vector(part.copy(end=Point(0,2)))),Decision(Vector(part.copy(end=Point(1,2)))),Decision(Vector(part.copy(start=Point(0,-1)))),
      Decision(Vector(part.copy(end=Point(1,0)),part.copy(start=Point(0,1)))),
      Decision(Vector(part.copy(end=Point(0,1)),part.copy(start=Point(1,0))))
    ).foreach(bad)
  }
  test("BA: canonical fragment transition is next fragment offset zero, and terminal is fragmentCount offset zero") {
    val window=sample
    val decision=Decision(Vector(Part(Point(0,0),Point(1,0),false,"first",Nil),Part(Point(1,0),window.terminal,false,"second",Nil)))
    validate(window,false,decision)
    val delta=accept(State.start(sessionId,namespace),window,decision)
    assertEquals(delta.pieces.map(_.chunk.text),Vector("A🙂","Bé"))
    assertEquals(delta.passages.map(_.passage.start),Vector(SourcePoint("one",0,0),SourcePoint("two",1,0)))
  }
  test("BA: every internal Unicode scalar boundary converts to an exact absolute UTF8 cut") {
    val scalars=List(0x1,0x7f,0x80,0x7ff,0x800,0xd7ff,0xe000,0xffff,0x10000,0x10ffff,0x1f642,0x200d,0xfe0f,'x'.toInt,'x'.toInt)
    val text=scalars.map(cp => new String(Character.toChars(cp))).mkString
    val value=Source(List(message("all-scalars",text,"user",0))).next(SourceCursor.start).get
    (1 until scalars.size).foreach { cut =>
      val decision=Decision(Vector(Part(Point(0,0),Point(0,cut),false,"left",Nil),Part(Point(0,cut),value.terminal,false,"right",Nil)))
      val projected=accept(State.start(sessionId,namespace),value,decode(value,false,json(decision)))
      val prefix=text.substring(0,text.offsetByCodePoints(0,cut))
      assertEquals(projected.pieces.map(_.chunk.text).mkString,text)
      assertEquals(projected.pieces.head.chunk.text,prefix)
      assertEquals(projected.pieces.head.sourceSpan.end,prefix.getBytes(UTF_8).length)
      assertEquals(projected.pieces(1).sourceSpan.start,prefix.getBytes(UTF_8).length)
    }
  }
  test("BA: continuation requires an open passage and is only permitted on the first part") {
    val window=sample
    assertEquals(intercept[DomainError](validate(window,false,one(window,true,"x",Nil))).code,"model-output")
    bad(Decision(Vector(Part(Point(0,0),Point(1,0),true,"first",Nil),Part(Point(1,0),window.terminal,true,"second",Nil))))
  }
  test("BA: strict JSON rejects missing, extra, wrongly typed, and reference fields") {
    val window=sample; val valid=json(one(window,false,"summary",List("tag")))
    val part=valid.hcursor.downField("parts").focus.get.asArray.get.head
    val invalid=List(Json.arr(),Json.obj("parts"->Json.Null),valid.mapObject(_.add("extra",Json.True)),Json.obj("parts"->Json.arr(part.mapObject(_.remove("end")))),
      Json.obj("parts"->Json.arr(part.mapObject(_.add("passageId",Json.fromString("closed-id"))))),
      Json.obj("parts"->Json.arr(part.mapObject(_.add("start",pointJson(Point(0,0)).mapObject(_.add("byteOffset",Json.fromInt(0))))))),
      Json.obj("parts"->Json.arr(part.mapObject(_.add("continuePrevious",Json.fromString("true"))))),
      Json.obj("parts"->Json.arr(part.mapObject(_.add("tags",Json.arr(Json.fromInt(1)))))))
    invalid.foreach(value => assertEquals(intercept[DomainError](decode(window,false,value)).code,"model-output"))
  }
  test("BA: metadata scalar limits are exact; NUL, invalid surrogates, duplicate and out-of-bound tags fail") {
    val window=sample
    val tags=(0 until maximumTags).map(i => "🙂"*62+f"$i%02d").toList
    validate(window,false,one(window,false,"🙂"*summaryScalars,tags))
    val invalid=List(("",Nil),("🙂"*(summaryScalars+1),Nil),("x",List("")),("x",List("🙂"*(tagScalars+1))),
      ("x",(0 to maximumTags).map(_.toString).toList),("x",List("same","same"))) ++
      List("\u0000",new String(Array(0xd800.toChar)),new String(Array(0xdc00.toChar))).flatMap(value => List((value,Nil),("x",List(value))))
    invalid.foreach((summary,tags) => assertEquals(intercept[DomainError](validate(window,false,one(window,false,summary,tags))).code,"model-output"))
  }
  test("BA: source validation rejects non-storable Unicode and invalid structured field bounds without normalizing source") {
    List("\u0000",new String(Array(0xd800.toChar)),new String(Array(0xdc00.toChar))).foreach { invalid =>
      List(message("id",invalid,"tool",0),message(invalid,"A","tool",0),message("id","A",invalid,0)).foreach { value =>
        assertEquals(intercept[DomainError](Source(List(value))).code,"invalid")
      }
    }
    List(message("i"*257,"A","tool",0),message("id","A","r"*65,0),message("","A","tool",0)).foreach(value => intercept[DomainError](Source(List(value))))
  }
  test("WA: standalone source UTF8/i32 admission checks Long bounds without allocating a multi-gigabyte transcript") {
    assertEquals(checkedUtf8Length(0L,"invalid"),0)
    assertEquals(checkedUtf8Length(Int.MaxValue.toLong,"invalid"),Int.MaxValue)
    List(-1L,Int.MaxValue.toLong+1,Long.MaxValue).foreach { bytes =>
      assertEquals(intercept[DomainError](checkedUtf8Length(bytes,"invalid")).code,"invalid")
    }
  }
  test("BA: immutable assembly preserves initial goal and source embeddings while metadata evolves, and coalesces source spans across windows") {
    val source=Source(List(message("long","A"*300000,"assistant",0)))
    val first=source.next(SourceCursor.start).get
    val initial=State.start(sessionId,namespace)
    val delta1=accept(initial,first,one(first,false,"original goal",List("A")))
    val frozen=delta1.pieces
    assertEquals(accept(initial,first,one(first,false,"original goal",List("A"))),delta1)
    val second=source.next(delta1.state.nextSource).get
    val delta2=accept(delta1.state,second,one(second,true,"updated status",List("updated")))
    assertEquals(initial.open,None); assertEquals(delta1.state.open.get.passage.summary,"original goal")
    assertEquals(delta2.state.carry.get.initialSummary,"original goal"); assertEquals(delta2.state.carry.get.updatedSummary,"updated status")
    assertEquals(delta2.state.carry.get.tags,List("updated")); assert(delta2.state.carry.get.omittedPrefixBytes>0)
    assertEquals(delta1.pieces,frozen)
    assert(delta1.pieces.forall(piece => piece.chunk.summary=="original goal" && piece.chunk.tags==List("A")))
    assert(delta2.pieces.forall(piece => piece.chunk.summary=="updated status" && piece.chunk.tags==List("updated")))
    assertEquals(delta2.state.open.get.passage.id,delta1.state.open.get.passage.id)
    assertEquals(delta2.state.open.get.passage.spanCount,1L); assertEquals(delta2.spans.map(_.ordinal),Vector(0L))
    assertEquals(delta2.spans.head.span.start,0); assertEquals(delta2.spans.head.span.end,first.fragments.map(_.text.length).sum+second.fragments.map(_.text.length).sum)
    assert(delta2.state.nextSource.utf16Offset>delta1.state.nextSource.utf16Offset)
    assert(delta2.state.nextSource.byteOffset>delta1.state.nextSource.byteOffset)
    assertEquals(intercept[DomainError](accept(delta2.state,first,one(first,true,"x",Nil))).code,"invalid")
    assertEquals(intercept[DomainError](finish(delta1.state,source)).code,"invalid")
  }
  test("BA: bounded context is an exact contiguous UTF8 suffix with explicit omissions, including many short messages and escaped metadata") {
    val longText=(0 until 2500).map(i => f"line-$i%04d🙂α\\\n").mkString
    val cases=List(List(message("long",longText,"assistant",0)),
      (0 until 160).map(i => message(s"short$i",f"step-$i%03d🙂", "tool",i)).toList,
      (0 until 160).map(i => message("\u0001"*253+f"$i%03d",f"step-$i%03d🙂\u0002","\u0003"*64,i)).toList)
    cases.zipWithIndex.foreach { (messages,caseIndex) =>
      val source=Source(messages)
      val original=messages.map(_.text.getBytes(UTF_8)).toVector
      val starts=original.scanLeft(0L)((sum,text) => sum+text.length)
      var state=State.start(sessionId,namespace); var pending=source.next(state.nextSource)
      while(pending.nonEmpty) {
        val value=pending.get
        state=accept(state,value,one(value,state.open.nonEmpty,"one ongoing problem",Nil)).state
        val carry=state.carry.get
        val tail=carry.sourceTail
        val tailBytes=tail.map(_.text.getBytes(UTF_8).length).sum
        assert(tail.nonEmpty && tail.size<=maximumTailFragments); assert(tailBytes<=maximumTailBytes)
        assert(carryJson(carry).hcursor.downField("sourceTail").focus.get.noSpaces.getBytes(UTF_8).length<=maximumTailJsonBytes)
        var expected=carry.omittedPrefixBytes
        tail.foreach { excerpt =>
          val span=excerpt.span
          assertEquals(starts(span.messagePosition)+span.start,expected)
          assert(span.start>=0 && span.end<=original(span.messagePosition).length && span.end>span.start)
          assertEquals(new String(original(span.messagePosition).slice(span.start,span.end),UTF_8),excerpt.text)
          assertEquals(excerpt.text.getBytes(UTF_8).length,span.end-span.start)
          expected=starts(span.messagePosition)+span.end
        }
        assertEquals(expected,carry.sourceBytes)
        assertEquals(carry.omittedPrefixBytes,carry.sourceBytes-tailBytes)
        if(caseIndex==2) assert(tail.size<maximumTailFragments && tailBytes<maximumTailBytes)
        pending=source.next(state.nextSource)
      }
      assert(state.carry.get.omittedPrefixBytes>0)
    }
  }
  test("WA: progress cursors and bounded excerpts cannot be forged with generated apply/copy methods outside the kernel") {
    assert(!typeChecks("chronicle.ProblemPassages.SourceCursor(0,0,0)"))
    assert(!typeChecks("chronicle.ProblemPassages.SourceCursor.start.copy(utf16Offset=1,byteOffset=1)"))
    assert(!typeChecks("null.asInstanceOf[chronicle.ProblemPassages.SourceExcerpt].copy(text=\"forged\")"))
    assert(!typeChecks("chronicle.ProblemPassages.State.start(new java.util.UUID(0L,1L),new java.util.UUID(0L,2L)).copy(finished=true)"))
  }
  test("BA: original goal survives arbitrarily many windows but A/B/A cannot resurrect a closed passage ID") {
    val source=Source(List(message("long","A"*280000+"B"*280000+"A"*280000,"tool",31)))
    val result=run(source.messages.toList,new Dummy).unsafeRunSync()
    assertEquals(result.passages.map(_.tags),Vector(List("A"),List("B"),List("A")))
    assertEquals(result.passages.map(_.id).distinct.size,3); assert(result.deltas.count(_.pieces.nonEmpty)>=7)
    exactSource(result,source.messages.toList)
  }
  test("BA: scalar counts and line starts include emoji and are independent of UTF16 and UTF8 offsets") {
    val window=Source(List(message("line","🙂\nα\nlast","user",0))).next(SourceCursor.start).get
    assertEquals(window.fragments.head.scalarCount,8); assertEquals(window.fragments.head.lineStarts,Vector(0,2,4))
    assertEquals(window.fragments.head.byteEnd,12)
    val schema=responseFormat(window).hcursor.downField("json_schema").downField("schema").downField("properties").downField("parts")
    assertEquals(schema.get[Int]("maxItems").toOption,Some(8))
  }
  test("BA: stable new policy identity includes prompt/schema/window/context/piece policy without changing legacy identity") {
    assert(identity.startsWith("contiguous-problems-v1:")); assertEquals(identity.length,"contiguous-problems-v1:".length+64)
    assertEquals(AnnotationPartition.identity,"partition-v4:utf8:2048:windowFragments4:windowBytes8192:policyResponseTokens:strictJsonSchema:summary1000unicode:tags16x64unicode:messageBoundaryLF")
  }
}
