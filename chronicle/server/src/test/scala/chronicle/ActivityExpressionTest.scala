package chronicle

import chronicle.api.{ActivityJobClass, CollectorPhase, SourceFormat}
import java.time.Instant

// Specified-origin, blackbox atomic tests for the approved metadata-only Activity policies.
class ActivityExpressionTest extends munit.FunSuite {
  import BooleanExpression.*

  private val parsers: List[String => BooleanExpression[?]]=List(ActivityExpression.jobs,ActivityExpression.collectors)

  private def invalid[P](parse: String => BooleanExpression[P], input: String): DomainError = {
    val error=intercept[DomainError](parse(input))
    assertEquals(error.code,"invalid")
    assert(error.detail.contains("at character "),error.detail)
    error
  }

  private def invalidAt[P](parse: String => BooleanExpression[P], input: String, location: Int): Unit =
    assert(invalid(parse,input).detail.endsWith(s"at character $location"),input)

  test("BA: both empty Activity policies produce true") {
    parsers.foreach { parse =>
      List(""," \t\r\n","　").foreach(input => assertEquals(parse(input),True))
    }
  }

  test("BA: job common fields are typed source predicates and preserve scalar values") {
    val cases=List(
      ("USER:OwnerA",ArchivePredicate.User("OwnerA")),
      ("tag:TagA",ArchivePredicate.Tag("TagA")),
      ("TaGs:TagB",ArchivePredicate.Tag("TagB")),
      ("PROJECT:ProjectA",ArchivePredicate.Project("ProjectA")),
      ("branch:Main",ArchivePredicate.Branch("Main")),
      ("producer:Pi",ArchivePredicate.Producer("Pi")),
      ("model:ModelA",ArchivePredicate.Model("ModelA")),
      ("format:CLAUDE",ArchivePredicate.Format(SourceFormat.Claude)),
      ("format:Codex",ArchivePredicate.Format(SourceFormat.Codex)),
      ("format:pi",ArchivePredicate.Format(SourceFormat.Pi)),
      ("status:QUEUED",ArchivePredicate.Status(ArchiveStatus.Queued)),
      ("status:Running",ArchivePredicate.Status(ArchiveStatus.Running)),
      ("status:failed",ArchivePredicate.Status(ArchiveStatus.Failed)),
      ("status:complete",ArchivePredicate.Status(ArchiveStatus.Complete))
    )
    cases.foreach { case (input,predicate) =>
      assertEquals(ActivityExpression.jobs(input),Field(ActivityJobPredicate.Source(predicate)),input)
    }
    assertEquals(ActivityExpression.jobs("project : \"some project\""),Field(ActivityJobPredicate.Source(ArchivePredicate.Project("some project"))))
    invalidAt(ActivityExpression.jobs,"status:unscheduled",7)
    invalidAt(ActivityExpression.jobs,"format:gemini",7)
  }

  test("BA: job identities and reason remain opaque literals while typed keywords are case insensitive") {
    val cases=List(
      ("COLLECTOR:CaseSensitive:ID",ActivityJobPredicate.Collector("CaseSensitive:ID")),
      ("PROFILE:\"Exact Profile\"",ActivityJobPredicate.Profile("Exact Profile")),
      ("reason:\"Some Reason\"",ActivityJobPredicate.Reason("Some Reason")),
      ("classification:CURRENT",ActivityJobPredicate.Classification(ActivityJobClass.Current)),
      ("classification:Superseded-Revision",ActivityJobPredicate.Classification(ActivityJobClass.SupersededRevision)),
      ("classification:OBSOLETE-PROFILE",ActivityJobPredicate.Classification(ActivityJobClass.ObsoleteProfile)),
      ("classification:Superseded-Revision-And-Profile",ActivityJobPredicate.Classification(ActivityJobClass.SupersededRevisionAndProfile)),
      ("lease:ACTIVE",ActivityJobPredicate.Lease(ActivityLease.Active)),
      ("lease:Expired",ActivityJobPredicate.Lease(ActivityLease.Expired)),
      ("lease:UNLEASED",ActivityJobPredicate.Lease(ActivityLease.Unleased)),
      ("lease:Inactive",ActivityJobPredicate.Lease(ActivityLease.Inactive))
    )
    cases.foreach { case (input,predicate) => assertEquals(ActivityExpression.jobs(input),Field(predicate),input) }
    List("classification:other","classification:SupersededRevision","lease:pending").foreach(input => invalid(ActivityExpression.jobs,input))
  }

  test("BA: collector fields use typed phases and freshness with exact collector identity") {
    assertEquals(ActivityExpression.collectors("COLLECTOR:\"Case Sensitive ID\""),Field(ActivityCollectorPredicate.Collector("Case Sensitive ID")))
    val phases=List(
      ("DISCOVERING",CollectorPhase.Discovering),("Scanning",CollectorPhase.Scanning),
      ("uploading",CollectorPhase.Uploading),("IDLE",CollectorPhase.Idle),("Failed",CollectorPhase.Failed)
    )
    phases.foreach { case (value,phase) => assertEquals(ActivityExpression.collectors(s"phase:$value"),Field(ActivityCollectorPredicate.Phase(phase))) }
    val freshness=List(("RECENT",ActivityFreshness.Recent),("Stale",ActivityFreshness.Stale),("unknown",ActivityFreshness.Unknown))
    freshness.foreach { case (value,state) => assertEquals(ActivityExpression.collectors(s"freshness:$value"),Field(ActivityCollectorPredicate.Freshness(state))) }
    invalidAt(ActivityExpression.collectors,"phase:queued",6)
    invalidAt(ActivityExpression.collectors,"freshness:active",10)
  }

  test("BA: inapplicable and unknown fields fail at scalar-character field locations") {
    List("phase:idle","freshness:recent","owner:a","unknown:a").foreach { input =>
      invalidAt(ActivityExpression.jobs,"🐎 " + input,2)
    }
    List("user:a","tag:a","tags:a","project:a","branch:a","producer:a","format:pi","model:a","status:failed","profile:a","classification:current","reason:a","lease:active","unknown:a").foreach { input =>
      invalidAt(ActivityExpression.collectors,"🐎 " + input,2)
    }
  }

  test("BA: every Activity mode directive is rejected including lexical and grouped directives") {
    parsers.foreach { parse =>
      List("mode:lexical","mode:semantic","mode:hybrid","MoDe:LEXICAL","mode:\"lexical\"","mode:other","NOT mode:lexical","(mode:lexical)","a OR mode:lexical","mode:lexical mode:hybrid").foreach(input => invalid(parse,input))
      invalidAt(parse,"🐎 mode:lexical",2)
      assertEquals(parse("\"mode:lexical\""),Text("mode:lexical"))
      assertEquals(parse("mode\\:lexical"),Text("mode:lexical"))
      assertEquals(parse("mo\\de\\:semantic"),Text("mode:semantic"))
      assertEquals(parse("mode"),Text("mode"))
    }
  }

  test("BA: Activity dates use UTC dates or Java Instants including extreme values") {
    val times=List(
      ("2026-10-26",Instant.parse("2026-10-26T00:00:00Z")),
      ("2026-10-26T11:12:13.123456789Z",Instant.parse("2026-10-26T11:12:13.123456789Z")),
      ("2026-10-26T11:12:13+02:00",Instant.parse("2026-10-26T09:12:13Z")),
      (Instant.MIN.toString,Instant.MIN),(Instant.MAX.toString,Instant.MAX)
    )
    times.foreach { case (literal,time) =>
      List(literal,"\"" + literal + "\"").foreach { value =>
        assertEquals(ActivityExpression.jobs(s"after:$value"),Field(ActivityJobPredicate.Source(ArchivePredicate.After(time))))
        assertEquals(ActivityExpression.jobs(s"before:$value"),Field(ActivityJobPredicate.Source(ArchivePredicate.Before(time))))
        assertEquals(ActivityExpression.collectors(s"after:$value"),Field(ActivityCollectorPredicate.After(time)))
        assertEquals(ActivityExpression.collectors(s"before:$value"),Field(ActivityCollectorPredicate.Before(time)))
      }
    }
    parsers.foreach { parse =>
      List("after:2026-02-30","before:2026-13-01","after:2026-1-01","after:2026-10-26T11:12:13","before:yesterday","after:+1000000001-01-01T00:00:00Z").foreach(input => invalid(parse,input))
      invalidAt(parse,"🐎 after:yesterday",8)
    }
  }

  test("BA: both policies preserve Boolean precedence grouping and literal text semantics") {
    parsers.foreach { parse =>
      assertEquals(parse("a oR b AnD nOt c d"),Or(Text("a"),And(And(Text("b"),Not(Text("c"))),Text("d"))))
      assertEquals(parse("{a OR b} AND (c OR NOT d)"),And(Or(Text("a"),Text("b")),Or(Text("c"),Not(Text("d")))))
      assertEquals(parse("NOT NOT a"),Not(Not(Text("a"))))
      assertEquals(parse("\"AND\" \\OR N\\OT"),And(And(Text("AND"),Text("OR")),Text("NOT")))
      assertEquals(parse("a\\ b c\\:d"),And(Text("a b"),Text("c:d")))
      List("(a}","{a)","(a","a)","()","AND","NOT","a AND","a OR OR b","collector:","collector:()","\"collector\":a","collec\\tor:a").foreach(input => invalid(parse,input))
    }
  }

  test("BA: shared scalar Unicode and JSON escapes are decoded without normalization") {
    parsers.foreach { parse =>
      val input="\"\\\"\\\\\\/\\b\\f\\n\\r\\t\\u0041\\u03bb\\uD83D\\uDE80é\""
      assertEquals(parse(input),Text("\"\\/\b\f\n\r\tAλ🚀é"))
      assertEquals(parse("\"é\""),Text("é"))
      assertEquals(parse("collector:\"\\uD83D\\uDC0Eé\""),parse("collector:\"🐎é\""))
      List("\"\"","collector:\"\"","a\\","\"unterminated","\"bad\\q\"","\"bad\\u12\"","\"\\u００４１\"","\"\\uD800\"","\"\\uDC00\"","\"\\uD800\\u0041\"","\"\\u0000\"","foo\"bar\"","\"foo\"bar").foreach(input => invalid(parse,input))
      invalidAt(parse,"🐎 " + '\u0000',2)
      invalidAt(parse,"🐎 " + 0xd800.toChar,2)
      invalidAt(parse,"🐎 " + 0xdc00.toChar,2)
      List('\u000b','\f','\u001c','\u0085','\u007f').foreach(control => invalidAt(parse,"a" + control + "b",1))
    }
  }

  test("BA: both policies enforce the same exact UTF8 expression and decoded literal bounds") {
    parsers.foreach { parse =>
      val expression=List.fill(8)("x" * 511).mkString(" ") + " "
      assertEquals(expression.getBytes(java.nio.charset.StandardCharsets.UTF_8).length,4096)
      parse(expression)
      invalidAt(parse,expression + " ",4096)
      val unicode="　" * 1365 + " "
      assertEquals(parse(unicode),True)
      invalidAt(parse,unicode + " ",1366)
      assertEquals(parse("x" * 512),Text("x" * 512))
      assertEquals(parse("\"" + "🐎" * 128 + "\""),Text("🐎" * 128))
      assertEquals(parse("\"" + "\\u0061" * 512 + "\""),Text("a" * 512))
      parse("collector:\"" + "🐎" * 128 + "\"")
      List("x" * 513,"\"" + "🐎" * 129 + "\"","collector:\"" + "🐎" * 129 + "\"").foreach(input => invalid(parse,input))
    }
  }

  test("BA: both policies share distinct text AST node token and nesting limits") {
    parsers.foreach { parse =>
      val texts=1.to(16).map(i => s"t$i")
      parse(texts.mkString(" "))
      parse((texts :+ "\"\\u00741\"").mkString(" "))
      assert(invalid(parse,(texts :+ "NOT extra").mkString(" ")).detail.contains("distinct text"))
      val nodes=List.fill(32)("x").mkString(" ")
      parse("NOT " + nodes)
      assert(invalid(parse,"NOT NOT " + nodes).detail.contains("node"))
      val tokens="NOT " + List.fill(32)("(x)").mkString(" AND ")
      parse(tokens)
      assert(invalid(parse,"(" + tokens + ")").detail.contains("token"))
      assertEquals(parse("(" * 16 + "x" + ")" * 16),Text("x"))
      assertEquals(parse("{" * 16 + "x" + "}" * 16),Text("x"))
      parse("NOT " * 16 + "x")
      parse("(" * 8 + "NOT " * 8 + "x" + ")" * 8)
      List("(" * 17 + "x" + ")" * 17,"{" * 17 + "x" + "}" * 17,"NOT " * 17 + "x","(" * 8 + "NOT " * 9 + "x" + ")" * 8).foreach { input =>
        assert(invalid(parse,input).detail.contains("nesting"))
      }
    }
  }

  test("BA: metadata atoms and text retain ordinary short circuit Boolean evaluation") {
    val jobs=ActivityExpression.jobs("collector:Exact OR needle AND NOT tag:spam")
    assert(jobs.containsText)
    assert(jobs.evaluate(_ => false,_ == ActivityJobPredicate.Collector("Exact")))
    assert(jobs.evaluate(_ == "needle",_ => false))
    assert(!jobs.evaluate(_ == "needle",_ == ActivityJobPredicate.Source(ArchivePredicate.Tag("spam"))))
    assert(ActivityExpression.jobs("NOT project:missing").evaluate(_ => false,_ => false))
    assert(!ActivityExpression.jobs("collector:a AND needle").evaluate(_ => fail("AND must short circuit"),_ => false))
    val collectors=ActivityExpression.collectors("phase:idle OR needle")
    assert(collectors.evaluate(_ => fail("OR must short circuit"),_ == ActivityCollectorPredicate.Phase(CollectorPhase.Idle)))
    assert(!ActivityExpression.collectors("NOT collector:a").containsText)
    assert(ActivityExpression.collectors("").evaluate(_ => fail("true must not inspect text"),_ => fail("true must not inspect metadata")))
  }
}
