package chronicle

import chronicle.api.*
import io.circe.Json
import java.nio.charset.StandardCharsets.UTF_8
import java.time.Instant
import java.util.UUID

class ExpressionHintContextTest extends munit.FunSuite {
  private val archive=ExpressionHintTarget.Archive()
  private val collectors=ExpressionHintTarget.ActivityCollectors()
  private val jobs=ExpressionHintTarget.ActivityJobs(ActivityJobScope.All,None)
  private val now=Instant.parse("2026-10-26T12:00:00Z")
  private def request(marked: String,target: ExpressionHintTarget,limit: Int): ExpressionHintQuery = {
    val caret=marked.indexOf('¦')
    Check(caret>=0 && marked.indexOf('¦',caret+1)<0,"test","one fixture caret required")
    ExpressionHintQuery(target,marked.patch(caret,"",1),caret,limit)
  }
  private def index(values: List[String]): ExpressionHintIndex = new CorpusExpressionHintIndex(new ExpressionHintStore {
    def read(reader: String,target: ExpressionHintTarget,field: Option[HintField],prefix: String,limit: Int): HintValues = {
      val matched=if(field.isEmpty) Nil else values.filter(_.toLowerCase(java.util.Locale.ROOT).startsWith(prefix.toLowerCase(java.util.Locale.ROOT)))
      val admitted=matched.filter(value => value.nonEmpty && value.getBytes(UTF_8).length<=512)
      HintValues(now,admitted.take(limit),matched.size!=admitted.size)
    }
  })
  private def hints(marked: String,target: ExpressionHintTarget,values: List[String]): ExpressionHintsResult = index(values).hints("a",request(marked,target,20))
  private def replacement(q: ExpressionHintQuery,r: ExpressionHintsResult,h: ExpressionHint): String = {
    assert(r.replaceStartUtf16<=q.caretUtf16 && q.caretUtf16<=r.replaceEndUtf16)
    assert(r.replaceStartUtf16>=0 && r.replaceEndUtf16<=q.expression.length)
    assert(h.caretOffsetUtf16>=0 && h.caretOffsetUtf16<=h.insertText.length)
    val before=q.expression.substring(0,r.replaceStartUtf16)
    val after=q.expression.substring(r.replaceEndUtf16)
    val updated=before+h.insertText+after
    assert(updated.startsWith(before) && updated.endsWith(after))
    assert(UTF_8.newEncoder().canEncode(updated))
    updated
  }
  test("BG specified: field and operator vocabularies are the existing parser vocabularies, not table column names") {
    def fields(target: ExpressionHintTarget): Set[String] = hints("¦",target,Nil).hints.filter(_.kind==ExpressionHintKind.Field).map(_.label).toSet
    assertEquals(fields(archive),Set("after","before","branch","format","mode","model","producer","project","status","tag","tags","user"))
    assertEquals(fields(collectors),Set("after","before","collector","phase","freshness"))
    assertEquals(fields(jobs),fields(archive)-"mode"++Set("collector","profile","classification","reason","lease"))
    List("attempts¦","revision¦","messageCount¦","completedWindows¦","unknown:¦").foreach(marked => assertEquals(hints(marked,jobs,Nil).hints,Nil))
    val q=request("text AN¦D project:keep",archive,20)
    val r=index(Nil).hints("a",q)
    assertEquals(r.hints.map(_.kind),List(ExpressionHintKind.Operator))
    assertEquals(r.hints.map(_.insertText),List("AND"))
    assertEquals(replacement(q,r,r.hints.head),"text AND project:keep")
    assertEquals(hints("A¦",archive,Nil).hints.filter(_.kind==ExpressionHintKind.Operator),Nil)
    assertEquals(hints("text ¦",archive,Nil).hints.filter(_.kind==ExpressionHintKind.Operator).map(_.label),List("AND","NOT","OR"))
  }
  test("BG specified: field replacement includes an existing colon and replaces the full mid-token name") {
    val q=request("(pro¦ducer:old) AND tag:keep",archive,20)
    val r=index(Nil).hints("a",q)
    val project=r.hints.find(_.label=="project").get
    assertEquals(replacement(q,r,project),"(project:old) AND tag:keep")
    assertEquals(project.caretOffsetUtf16,"project:".length)
    val result=hints("project: ¦",archive,List("whole"))
    assertEquals(result.hints.map(_.label),List("whole"))
    assertEquals(result.replaceStartUtf16,"project: ".length)
  }
  test("BG specified: values replace the whole quoted or colon-containing active value, preserving every outside character") {
    List("project:pr¦evious AND tag:keep","project:\"pr¦evious\" AND tag:keep","project:pr¦evious:part AND tag:keep").foreach { marked =>
      val q=request(marked,archive,20); val r=index(List("project Ω")).hints("a",q)
      assertEquals(r.hints.map(_.kind),List(ExpressionHintKind.Value))
      assertEquals(replacement(q,r,r.hints.head),"project:\"project Ω\" AND tag:keep")
      ArchiveExpression.parse(replacement(q,r,r.hints.head))
    }
    val q=request("after:2026-10-26T10:¦20:30Z AND project:keep",archive,20)
    val r=index(List("2026-10-26T10:22:30Z")).hints("a",q)
    assertEquals(replacement(q,r,r.hints.head),"after:\"2026-10-26T10:22:30Z\" AND project:keep")
  }
  test("BG specified: caret before a known field value replaces the whitespace gap and whole value, not a new text operand") {
    List(("project:¦ old AND tag:keep","project:\"new\" AND tag:keep"),("project:¦ \"old\" AND tag:keep","project:\"new\" AND tag:keep"),("project: ¦ old AND tag:keep","project: \"new\" AND tag:keep")).foreach { case (marked,expected) =>
      val q=request(marked,archive,20)
      val result=index(List("new")).hints("a",q)
      assertEquals(result.replaceStartUtf16,q.caretUtf16)
      assertEquals(replacement(q,result,result.hints.head),expected)
      ArchiveExpression.parse(expected)
    }
  }
  test("BG specified: a missing value before a Boolean operator does not consume the following clause operator") {
    List("AND","OR","NOT").foreach { operator =>
      val q=request("project:¦ "+operator+" tag:keep",archive,20)
      val result=index(List("new")).hints("a",q)
      assertEquals(result.replaceEndUtf16,q.caretUtf16)
      assertEquals(replacement(q,result,result.hints.head),"project:\"new\" "+operator+" tag:keep")
    }
    assertEquals(hints("project:O¦R",archive,List("OR whole")).hints.map(_.label),List("OR whole"))
    val q=request("project: ¦AND tag:keep",archive,20)
    val result=index(List("new")).hints("a",q)
    assertEquals(replacement(q,result,result.hints.head),"project: \"new\" AND tag:keep")
    ArchiveExpression.parse(replacement(q,result,result.hints.head))
  }
  test("BG specified: a dangling contiguous colon remains part of the incomplete unquoted field value") {
    val q=request("after:2026-10-26T10:¦ AND project:keep",archive,20)
    val result=index(List("2026-10-26T10:22:30Z")).hints("a",q)
    assertEquals(result.hints.map(_.label),List("2026-10-26T10:22:30Z"))
    assertEquals(replacement(q,result,result.hints.head),"after:\"2026-10-26T10:22:30Z\" AND project:keep")
  }
  test("BG specified: quoted and escaped colons do not become field syntax; unfinished escape contexts never invent partial values") {
    List("\"project:pr¦\"","project\\:pr¦","\"project\":¦","pro\\ject:¦","project:\"abc\\uD8¦3D\"","project:\"abc\\¦").foreach { marked =>
      assertEquals(hints(marked,archive,List("private", "abc" )).hints,Nil,marked)
    }
    assertEquals(hints("project:pr\\:¦",archive,List("pr:whole")).hints.map(_.label),List("pr:whole"))
    assertEquals(hints("project:\"\\uD83D\\uDE00¦\"",archive,List("😀 whole")).hints.map(_.label),List("😀 whole"))
  }
  test("BG specified: all values are complete JSON literals, including Boolean words, quotes, backslashes and ISO controls") {
    val values=List("OR NOT user:b","a:b","quote\"slash\\","line\n\ttab","del\u007fnext","control\u0085next","🙂é")
    val q=request("project:¦ AND tag:keep",archive,20)
    val r=index(values).hints("a",q)
    assertEquals(r.hints.map(_.label),values)
    r.hints.foreach { hint =>
      assertEquals(Wire.parse(hint.insertText).asString,Some(hint.label))
      assertEquals(hint.caretOffsetUtf16,hint.insertText.length)
      ArchiveExpression.parse(replacement(q,r,hint))
    }
  }
  test("BG specified: static states and modes stay target-specific and mode is offered only in an outer conjunction") {
    assertEquals(hints("status:¦",archive,Nil).hints.map(_.label),List("complete","failed","queued","running","unscheduled"))
    assertEquals(hints("status:¦",jobs,Nil).hints.map(_.label),List("complete","failed","queued","running"))
    assertEquals(hints("phase:¦",collectors,Nil).hints.map(_.label),List("discovering","failed","idle","scanning","uploading"))
    assertEquals(hints("mode:¦",jobs,Nil).hints,Nil)
    assertEquals(hints("mode:¦",collectors,Nil).hints,Nil)
    List("(mode:¦)","NOT mode:¦","text OR mode:¦","mode:¦ OR text","mode:lexical AND mode:¦").foreach(marked => assertEquals(hints(marked,archive,Nil).hints,Nil,marked))
    List("(text OR other) AND mode:¦","mode:¦ AND (text OR other)").foreach { marked =>
      assertEquals(hints(marked,archive,Nil).hints.map(_.label),List("hybrid","lexical","semantic"))
    }
    assert(hints("NOT (text) ¦",archive,Nil).hints.exists(_.label=="mode"))
    assert(!hints("mode:lexical mo¦",archive,Nil).hints.exists(_.label=="mode"))
  }
  test("BG specified: UTF16 carets and ranges retain non-BMP text and reject a split scalar") {
    val q=request("\"😀\" AND project:\"🙂¦old\" AND tag:keep",archive,20)
    val r=index(List("🙂whole")).hints("a",q)
    assertEquals(replacement(q,r,r.hints.head),"\"😀\" AND project:\"🙂whole\" AND tag:keep")
    assertEquals(r.replaceStartUtf16,q.expression.indexOf('"',q.expression.indexOf("project:")))
    val split=q.copy(caretUtf16=q.expression.indexOf("🙂")+1)
    assertEquals(intercept[DomainError](index(Nil).hints("a",split)).code,"invalid")
  }
  test("BG specified: queryHash binds opaque reader, whole target, query, caret and requested limit without echoing identity") {
    val q=request("project:¦",archive,20)
    val service=index(List("whole"))
    val base=service.hints("",q)
    assertEquals(base.observedAt,now.toString)
    assertEquals(base.queryHash,service.hints("",q).queryHash)
    val variants=List(service.hints("x"*50000,q),service.hints("x"*50000+"y",q),service.hints("",q.copy(target=jobs)),service.hints("",q.copy(target=ExpressionHintTarget.ActivityJobs(ActivityJobScope.Current,Some("")))) ,service.hints("",q.copy(limit=1)),service.hints("",q.copy(caretUtf16=q.caretUtf16-1)),service.hints("",q.copy(expression=q.expression+" ")))
    assertEquals((base::variants).map(_.queryHash).distinct.size,variants.size+1)
    assert((base::variants).forall(_.queryHash.matches("[0-9a-f]{64}")))
  }
  test("BG specified: parser byte/token/node/depth/distinct-literal bounds apply without requiring complete Boolean syntax") {
    val service=index(Nil)
    val invalid=List(" "*4097,"🙂"*1025,"project:"+"a"*513,"project:\""+"\\u0061"*513+"\"","project:"+"x:"*256+"x","x "*33,"("*17,(1 to 17).map(n => "text"+n).mkString(" "),"x "*129,"bad\u0000","bad"+0xd800.toChar,"bad\u0001")
    invalid.foreach { expression => assertEquals(intercept[DomainError](service.hints("a",ExpressionHintQuery(archive,expression,expression.length,20))).code,"invalid") }
    List(0,21,-1).foreach(limit => assertEquals(intercept[DomainError](service.hints("a",ExpressionHintQuery(archive,"",0,limit))).code,"invalid"))
    List("(","NOT ","project:\"unfinished","project:\\").foreach { expression => service.hints("a",ExpressionHintQuery(archive,expression,expression.length,20)) }
  }
  test("BG specified: complete insertions never push the unchanged outside expression past its byte bound") {
    val empty=" "*4096
    val fields=index(Nil).hints("a",ExpressionHintQuery(archive,empty,empty.length,20))
    assertEquals(fields.hints,Nil); assert(fields.truncated)
    val full=" "*(4096-"project:".length)+"project:"
    val values=index(List("whole")).hints("a",ExpressionHintQuery(archive,full,full.length,20))
    assertEquals(values.hints,Nil); assert(values.truncated)
  }
  test("BG specified: every scalar-safe mid-value edit preserves the surrounding Boolean expression and remains parseable") {
    val values=List("OR NOT user:b","colon:a:b","quote\"slash\\","line\n\ttab","🙂é","a\\b","plain")
    val service=index(values)
    var checked=0
    values.foreach { value =>
      val literal=Json.fromString(value).noSpaces
      val prefix="(tag:keep OR tag:other) AND project:"
      val expression=prefix+literal+" AND NOT project:unrelated"
      (1 until literal.length).foreach { offset =>
        val caret=prefix.length+offset
        if(!Character.isHighSurrogate(expression.charAt(caret-1)) || !Character.isLowSurrogate(expression.charAt(caret))) {
          val q=ExpressionHintQuery(archive,expression,caret,20)
          val result=service.hints("a",q)
          result.hints.foreach { hint =>
            assertEquals(hint.kind,ExpressionHintKind.Value)
            assert(values.contains(hint.label))
            ArchiveExpression.parse(replacement(q,result,hint))
            checked+=1
          }
        }
      }
    }
    assert(checked>100)
  }
  test("BG specified: response budgets omit whole candidates, never shorten labels or inserted metadata") {
    val values=(1 to 20).map(n => "\u0001"*509+f"$n%03d").toList
    val q=request("project:¦",archive,20)
    val r=index(values).hints("a",q)
    assert(r.truncated); assert(r.hints.nonEmpty && r.hints.size<20)
    val bytes=Wire.encode(ServerEnvelope.codecJson,ServerEnvelope(new UUID(0,0),Result.ExpressionHints(r))).noSpaces.getBytes(UTF_8).length
    assert(bytes<=48*1024)
    r.hints.foreach(hint => assert(values.contains(hint.label)))
    val over=hints("project:¦",archive,List("a"*513,"", "whole"))
    assertEquals(over.hints.map(_.label),List("whole")); assert(over.truncated)
  }
}
