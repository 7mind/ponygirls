package chronicle

import chronicle.api.*
import io.circe.Json
import java.util.UUID

// Specified: the model supplies explicit coverage classification. Roles and bootstrap-looking prose are never filters.
class ContextCoverageTest extends munit.FunSuite {
  private def source(texts: List[(String,String)]): ProblemPassages.Source = ProblemPassages.Source(texts.zipWithIndex.map { case ((role,text),i) => Message(s"m$i",None,role,text,None,i) })
  private def point(fragment: Int): Json = Json.obj("fragmentIndex"->Json.fromInt(fragment),"scalarOffset"->Json.fromInt(0))
  private def context(first: Int,last: Int): Json = Json.obj("kind"->Json.fromString("Context"),"start"->point(first),"end"->point(last))
  private def problem(first: Int,last: Int,continued: Boolean,summary: String): Json = Json.obj("kind"->Json.fromString("Problem"),"start"->point(first),"end"->point(last),"continuePrevious"->Json.fromBoolean(continued),"summary"->Json.fromString(summary),"tags"->Json.arr())
  private def decision(parts: Json*): Json = Json.obj("parts"->Json.arr(parts*))
  test("BA: bootstrap plus genuine goal has explicit context coverage and only the goal yields a piece") {
    val value=source(List("system"->"synthetic setup", "user"->"implement a synthetic goal")); val window=value.next(ProblemPassages.SourceCursor.start).get
    val parsed=ProblemPassages.decode(window,false,decision(context(0,1),problem(1,2,false,"goal")))
    val delta=ProblemPassages.accept(ProblemPassages.State.start(UUID.randomUUID(),UUID.randomUUID()),window,parsed)
    assertEquals(delta.pieces.map(_.sourceSpan.messagePosition),Vector(1))
    assertEquals(delta.pieces.map(_.chunk.text),Vector("implement a synthetic goal"))
  }
  test("BA: pure bootstrap advances the exact cursor with zero invented problems or retrieval vectors") {
    val value=source(List("developer"->"synthetic runtime context")); val window=value.next(ProblemPassages.SourceCursor.start).get
    val parsed=ProblemPassages.decode(window,false,decision(context(0,1)))
    val delta=ProblemPassages.accept(ProblemPassages.State.start(UUID.randomUUID(),UUID.randomUUID()),window,parsed)
    assertEquals(delta.pieces,Vector.empty); assertEquals(delta.passages,Vector.empty)
    assert(value.next(delta.state.nextSource).isEmpty)
  }
  test("BA: more than64 context fragments advance without buffering or inventing a problem") {
    val value=source(List.fill(130)("system"->"synthetic context")); var state=ProblemPassages.State.start(UUID.randomUUID(),UUID.randomUUID()); var windows=0
    while(value.next(state.nextSource).nonEmpty) {
      val window=value.next(state.nextSource).get
      val delta=ProblemPassages.accept(state,window,ProblemPassages.decode(window,state.carry.nonEmpty,decision(context(0,window.fragments.size))))
      assertEquals(delta.pieces,Vector.empty); assertEquals(delta.state.carry,None); state=delta.state; windows+=1
    }
    assertEquals(windows,3)
  }
  test("BA: context does not close an open problem, but closed topics cannot be reopened") {
    val value=source(List("user"->"A goal","system"->"context","assistant"->"A verification","user"->"B goal","developer"->"context","user"->"A later return"))
    val window=value.next(ProblemPassages.SourceCursor.start).get
    val parsed=ProblemPassages.decode(window,false,decision(problem(0,1,false,"A"),context(1,2),problem(2,3,true,"A"),problem(3,4,false,"B"),context(4,5),problem(5,6,false,"A later")))
    val delta=ProblemPassages.accept(ProblemPassages.State.start(UUID.randomUUID(),UUID.randomUUID()),window,parsed)
    assertEquals(delta.state.nextPassageOrdinal,3)
    assertEquals(delta.pieces.map(_.passageId).distinct.size,3)
    assertEquals(delta.pieces(0).passageId,delta.pieces(1).passageId)
    assert(delta.pieces.last.passageId!=delta.pieces.head.passageId)
  }
  test("BA: genuine system developer and subagent assignments and prompt analysis remain eligible problems") {
    List("system"->"implement a real assignment", "developer"->"verify this assignment", "assistant"->"subagent assignment", "user"->"analyze this synthetic bootstrap prompt", "user"->"setup-looking text is my actual task").foreach { item =>
      val value=source(List(item)); val window=value.next(ProblemPassages.SourceCursor.start).get
      val delta=ProblemPassages.accept(ProblemPassages.State.start(UUID.randomUUID(),UUID.randomUUID()),window,ProblemPassages.decode(window,false,decision(problem(0,1,false,"genuine assignment"))))
      assertEquals(delta.pieces.map(_.chunk.text),Vector(item._2))
    }
  }
  test("BA: context rejects metadata kind spoofing coordinates and incomplete coverage, never repairs into an empty result") {
    val value=source(List("user"->"🙂α")); val window=value.next(ProblemPassages.SourceCursor.start).get
    List(context(0,1).mapObject(_.add("summary",Json.fromString("invented"))),context(0,1).mapObject(_.add("kind",Json.fromString("Unknown"))),context(0,1).mapObject(_.add("tags",Json.arr())),context(1,1),context(0,2)).foreach { bad =>
      assertEquals(intercept[DomainError](ProblemPassages.decode(window,false,decision(bad))).code,"model-output")
    }
  }
}
