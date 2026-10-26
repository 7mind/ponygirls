package chronicle

import chronicle.api.{SearchMode, SourceFormat}
import java.time.Instant

// Specified-origin tests for the approved Archive expression and candidate-domain contract.
class ArchiveExpressionTest extends munit.FunSuite {
  import ArchiveExpression.*

  private def parsed(input: String): ParsedArchiveExpression = ArchiveExpression.parse(input)
  private def user(value: String): ArchiveExpression = Field(ArchivePredicate.User(value))
  private def tag(value: String): ArchiveExpression = Field(ArchivePredicate.Tag(value))
  private def invalid(input: String): DomainError = {
    val error=intercept[DomainError](parsed(input))
    assertEquals(error.code,"invalid")
    assert(error.detail.contains("at character "),error.detail)
    error
  }
  private def invalidAt(input: String, location: Int): Unit =
    assert(invalid(input).detail.endsWith(s"at character $location"),input)

  test("BA: shared frontend and backend mode fixtures have identical stripped expression semantics") {
    final case class ExpressionCase(input: String, valid: Boolean, mode: Option[String], body: Option[String])
    given io.circe.Decoder[ExpressionCase] = io.circe.Decoder.forProduct4("input","valid","mode","body")(ExpressionCase.apply)
    val json=java.nio.file.Files.readString(java.nio.file.Path.of("tests/archive-expression-cases.json"))
    val cases=io.circe.parser.decode[List[ExpressionCase]](json).toOption.get
    assert(cases.nonEmpty)
    cases.foreach { fixture =>
      if(fixture.valid) {
        val result=parsed(fixture.input)
        assertEquals(result.mode.toString,fixture.mode.getOrElse(fail("valid fixture requires mode")),fixture.input)
        assertEquals(result.expression,parsed(fixture.body.getOrElse(fail("valid fixture requires body"))).expression,fixture.input)
      } else invalid(fixture.input)
    }
  }

  test("BA: empty and whitespace expressions are true without text operands") {
    List(""," \t\r\n","　").foreach { input =>
      assertEquals(parsed(input),ParsedArchiveExpression(True,SearchMode.Hybrid,Nil,True))
    }
  }

  test("BA: mode-only expressions are true and all mode values are case insensitive") {
    List(("lexical",SearchMode.Lexical),("SEMANTIC",SearchMode.Semantic),("hYbRiD",SearchMode.Hybrid)).foreach { case (value,mode) =>
      assertEquals(parsed(s"MoDe:$value"),ParsedArchiveExpression(True,mode,Nil,True))
    }
  }

  test("BA: adjacency and explicit AND bind more tightly than OR and less tightly than NOT") {
    val expression=Or(Text("a"),And(And(Text("b"),Not(Text("c"))),Text("d")))
    assertEquals(parsed("a oR b AnD nOt c d").expression,expression)
    assertEquals(parsed("NOT NOT a").expression,Not(Not(Text("a"))))
    assertEquals(parsed("candy OR orbit AND notable").expression,Or(Text("candy"),And(Text("orbit"),Text("notable"))))
  }

  test("BA: parentheses and braces preserve precedence and match only their own kinds") {
    assertEquals(parsed("{a OR b} AND (c OR NOT d)").expression,And(Or(Text("a"),Text("b")),Or(Text("c"),Not(Text("d")))))
    assertEquals(parsed("NOT(a OR {b AND c})").expression,Not(Or(Text("a"),And(Text("b"),Text("c")))))
    List("(a}","{a)","(a","{a","a)","a}","()","{}","( )").foreach(invalid)
  }

  test("BA: quoted and escaped operators and separators are literal text") {
    assertEquals(parsed("\"AND\" \\OR N\\OT").textOperands,List("AND","OR","NOT"))
    assertEquals(parsed("a\\ b c\\:d e\\(f\\) g\\{h\\} i\\\"j k\\\\l").textOperands,List("a b","c:d","e(f)","g{h}","i\"j","k\\l"))
    assertEquals(parsed("\"user:a OR b\"").expression,Text("user:a OR b"))
    assertEquals(parsed("project:\"a:b (c) OR d\"").expression,Field(ArchivePredicate.Project("a:b (c) OR d")))
  }

  test("BA: quoted literals decode every JSON escape and scalar Unicode without normalization") {
    val input="\"\\\"\\\\\\/\\b\\f\\n\\r\\t\\u0041\\u03bb\\uD83D\\uDE80é\""
    val value="\"\\/\b\f\n\r\tAλ🚀é"
    assertEquals(parsed(input).expression,Text(value))
    assertEquals(parsed("\"é\"").expression,Text("é"))
    assertEquals(parsed("\"λ🐎\"").expression,Text("λ🐎"))
  }

  test("BA: text operand sets deduplicate decoded identical literals in stable occurrence order including negative text") {
    val query=parsed("NOT foo \"\\u0066oo\" bar foo NOT \"bar\" FOO")
    assertEquals(query.textOperands,List("foo","bar","FOO"))
    assertEquals(query.expression,And(And(And(And(And(Not(Text("foo")),Text("foo")),Text("bar")),Text("foo")),Not(Text("bar"))),Text("FOO")))
  }

  test("BA: all supported metadata fields have typed predicates and preserve literal string values") {
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
      ("status:complete",ArchivePredicate.Status(ArchiveStatus.Complete)),
      ("status:unscheduled",ArchivePredicate.Status(ArchiveStatus.Unscheduled))
    )
    cases.foreach { case (input,predicate) =>
      val query=parsed(input)
      assertEquals(query.expression,Field(predicate),input)
      assertEquals(query.candidateFilter,Field(predicate),input)
      assertEquals(query.textOperands,Nil,input)
    }
    assertEquals(parsed("project : \"some project\"").expression,Field(ArchivePredicate.Project("some project")))
  }

  test("BA: repeated metadata atoms remain ordinary Boolean operands") {
    assertEquals(parsed("tag:a tags:b").expression,And(tag("a"),tag("b")))
    assertEquals(parsed("tag:a OR tags:b").expression,Or(tag("a"),tag("b")))
  }

  test("BA: time predicates carry Instants with UTC date bounds and preserve timestamp precision") {
    assertEquals(parsed("after:2026-10-26").expression,Field(ArchivePredicate.After(Instant.parse("2026-10-26T00:00:00Z"))))
    assertEquals(parsed("before:2026-10-27").expression,Field(ArchivePredicate.Before(Instant.parse("2026-10-27T00:00:00Z"))))
    assertEquals(parsed("after:2026-10-26T11:12:13.123456789Z").expression,Field(ArchivePredicate.After(Instant.parse("2026-10-26T11:12:13.123456789Z"))))
    assertEquals(parsed("before:\"2026-10-26T11:12:13+02:00\"").expression,Field(ArchivePredicate.Before(Instant.parse("2026-10-26T09:12:13Z"))))
    List("after:2026-02-30","before:2026-13-01","after:2026-1-01","after:2026-10-26T11:12:13","before:yesterday").foreach(invalid)
  }

  test("BA: unsupported fields and enum values fail without partial parsing") {
    List("unknown:value","owner:a","format:gemini","status:pending","mode:other","a unknown:x").foreach(invalid)
    invalidAt("🐎 unknown:x",2)
    invalidAt("user:a unknown:x",7)
  }

  test("BA: mode directives are removed only from the outer conjunction") {
    List("mode:lexical foo AND user:a","foo AND mode:lexical user:a","foo user:a AND mode:lexical").foreach { input =>
      val query=parsed(input)
      assertEquals(query.expression,And(Text("foo"),user("a")),input)
      assertEquals(query.mode,SearchMode.Lexical,input)
      assertEquals(query.textOperands,List("foo"),input)
      assertEquals(query.candidateFilter,user("a"),input)
    }
    assertEquals(parsed("mode:lexical (foo OR bar)").expression,Or(Text("foo"),Text("bar")))
    assertEquals(parsed("(foo OR bar) AND mode:lexical").expression,Or(Text("foo"),Text("bar")))
    assertEquals(parsed("\"mode:lexical\"").expression,Text("mode:lexical"))
  }

  test("BA: grouped OR and negative modes and every duplicate mode are invalid with directive location") {
    List("(mode:lexical)","{mode:lexical}","NOT mode:lexical","NOT(mode:lexical)","mode:lexical OR foo","foo OR mode:lexical","foo OR bar mode:lexical").foreach(invalid)
    invalidAt("(mode:lexical)",1)
    invalidAt("NOT mode:lexical",4)
    invalidAt("foo OR mode:lexical",7)
    invalidAt("mode:lexical mode:hybrid",13)
    invalidAt("mode:lexical (mode:lexical)",14)
    List("mode:lexical AND","AND mode:lexical","mode:lexical OR","mode:lexical AND OR foo").foreach(invalid)
  }

  test("BA: missing operands malformed escapes quotes and unsupported punctuation do not produce partial expressions") {
    List("AND","OR","NOT","a AND","a OR","a AND OR b","a OR OR b",":a","user:","user:()","user:\"\"","\"\"","a\\","\"unterminated","\"bad\\q\"","\"bad\\u12\"","\"bad\\uXYZ0\"","foo\"bar\"","\"foo\"bar","\"user\":a").foreach(invalid)
    invalidAt("🐎 \"unterminated",2)
    invalidAt("a AND",5)
    invalidAt("user:",5)
  }

  test("BA: Unicode JSON escape digits must be ASCII hexadecimal") {
    invalid("\"\\u００４１\"")
    invalid("\"\\u٠٠٤١\"")
    assertEquals(parsed("\"\\u00aF\"").expression,Text("¯"))
  }

  test("BA: raw control separators other than tab CR and LF are rejected") {
    List('\u000b','\f','\u001c','\u0085').foreach { control =>
      invalidAt("a" + control + "b",1)
    }
    assertEquals(parsed("a\tb\nc\rd").textOperands,List("a","b","c","d"))
  }

  test("BA: raw controls NUL and non-scalar Unicode are invalid at scalar character locations") {
    invalidAt("🐎 " + '\u0000',2)
    invalidAt("🐎 " + 0xd800.toChar,2)
    invalidAt("🐎 " + 0xdc00.toChar,2)
    invalidAt("\"a" + '\u0001' + "b\"",2)
    invalidAt("a" + '\u007f',1)
    invalidAt("\"\\u0000\"",1)
    invalidAt("\"\\uD800\"",1)
    invalidAt("\"\\uDC00\"",1)
    invalidAt("\"\\uD800\\u0041\"",1)
    assertEquals(parsed("\"\\uD800\\uDC00\"").textOperands,List("𐀀"))
  }

  test("BA: expression size is bounded by UTF8 bytes at the exact boundary") {
    val expression=List.fill(8)("x" * 511).mkString(" ") + " "
    assertEquals(expression.getBytes(java.nio.charset.StandardCharsets.UTF_8).length,4096)
    assertEquals(parsed(expression).textOperands,List("x" * 511))
    invalidAt(expression+" ",4096)
    val unicode="　" * 1365 + " "
    assertEquals(unicode.getBytes(java.nio.charset.StandardCharsets.UTF_8).length,4096)
    assertEquals(parsed(unicode).expression,True)
    invalidAt(unicode+" ",1366)
  }

  test("BA: literals are bounded by decoded UTF8 bytes for both text and metadata") {
    assertEquals(parsed("x" * 512).textOperands,List("x" * 512))
    assertEquals(parsed("\"" + "🐎" * 128 + "\"").textOperands,List("🐎" * 128))
    assertEquals(parsed("tag:\"" + "🐎" * 128 + "\"").expression,tag("🐎" * 128))
    invalid("x" * 513)
    invalid("\"" + "🐎" * 129 + "\"")
    invalid("tag:\"" + "🐎" * 129 + "\"")
    assertEquals(parsed("\"" + "\\u0061" * 512 + "\"").textOperands,List("a" * 512))
  }

  test("BA: distinct decoded text operands are bounded at sixteen including negative operands") {
    val inputs=(1.to(16)).map(i => s"t$i")
    assertEquals(parsed(inputs.mkString(" ")).textOperands,inputs.toList)
    assertEquals(parsed((inputs :+ "\"\\u00741\"").mkString(" ")).textOperands,inputs.toList)
    invalid((inputs :+ "NOT extra").mkString(" "))
  }

  test("BA: AST node count is bounded at sixty-four without counting parentheses or removed mode directives") {
    val expression=List.fill(32)("x").mkString(" ")
    assertEquals(parsed("NOT " + expression).textOperands,List("x"))
    assertEquals(parsed("mode:lexical NOT " + expression).textOperands,List("x"))
    assert(invalid("NOT NOT " + expression).detail.contains("node"))
  }

  test("BA: token count is bounded at one hundred twenty-eight independently of AST nodes") {
    val expression="NOT " + List.fill(32)("(x)").mkString(" AND ")
    assertEquals(parsed(expression).textOperands,List("x"))
    assert(invalid("("+expression+")").detail.contains("token"))
  }

  test("BA: nesting bounds include parentheses braces and unary NOT at exactly sixteen levels") {
    assertEquals(parsed("(" * 16 + "x" + ")" * 16).expression,Text("x"))
    assertEquals(parsed("{" * 16 + "x" + "}" * 16).expression,Text("x"))
    assertEquals(parsed("NOT " * 16 + "x").textOperands,List("x"))
    assertEquals(parsed("(" * 8 + "NOT " * 8 + "x" + ")" * 8).textOperands,List("x"))
    List("(" * 17 + "x" + ")" * 17,"{" * 17 + "x" + "}" * 17,"NOT " * 17 + "x","(" * 8 + "NOT " * 9 + "x" + ")" * 8).foreach { input =>
      assert(invalid(input).detail.contains("nesting"))
    }
  }

  test("BA: public evaluation preserves full Boolean semantics and treats missing metadata as false atoms") {
    val expression=parsed("user:a OR foo AND NOT tag:spam").expression
    assert(expression.evaluate(_ => false,_ == ArchivePredicate.User("a")))
    assert(expression.evaluate(_ == "foo",_ => false))
    assert(!expression.evaluate(_ == "foo",_ == ArchivePredicate.Tag("spam")))
    assert(parsed("NOT project:missing").expression.evaluate(_ => false,_ => false))
    assert(True.evaluate(_ => fail("true must not inspect text"),_ => fail("true must not inspect metadata")))
    assert(!parsed("tag:a AND foo").expression.evaluate(_ => fail("AND must short circuit"),_ => false))
    assert(parsed("tag:a OR foo").expression.evaluate(_ => fail("OR must short circuit"),_ => true))
  }

  test("BA: candidate filter collects every metadata-only outer conjunct including OR and NOT") {
    val query=parsed("(user:a OR user:b) foo NOT tag:spam project:p (branch:main OR NOT producer:other)")
    val filter=And(And(And(Or(user("a"),user("b")),Not(tag("spam"))),Field(ArchivePredicate.Project("p"))),Or(Field(ArchivePredicate.Branch("main")),Not(Field(ArchivePredicate.Producer("other")))))
    assertEquals(query.candidateFilter,filter)
    assert(!query.candidateFilter.containsText)
    assert(query.expression.containsText)
    assertEquals(query.textOperands,List("foo"))
    assertEquals(parsed("NOT (tag:spam OR user:a) AND foo").candidateFilter,Not(Or(tag("spam"),user("a"))))
  }

  test("BA: candidate filter never extracts metadata through mixed OR or NOT subtrees") {
    List("user:a OR foo","NOT(user:a AND foo)","(tag:a AND foo) OR (tag:b AND bar)","NOT (foo OR tag:a)").foreach { input =>
      assertEquals(parsed(input).candidateFilter,True,input)
    }
    assertEquals(parsed("user:a AND NOT(foo OR tag:spam)").candidateFilter,user("a"))
    assertEquals(parsed("foo AND (tag:a OR tag:b) AND bar AND NOT project:p").candidateFilter,And(Or(tag("a"),tag("b")),Not(Field(ArchivePredicate.Project("p")))))
  }

  test("BA: metadata-only expressions use the entire expression as the candidate filter") {
    List("tag:a OR NOT tag:b","NOT (user:a AND project:p)","{tag:a OR tag:b} NOT status:failed").foreach { input =>
      val query=parsed(input)
      assertEquals(query.candidateFilter,query.expression,input)
      assertEquals(query.textOperands,Nil,input)
      assert(!query.expression.containsText,input)
    }
  }

  test("BA: candidate-domain policy is intentionally syntax dependent under distributive rewrites") {
    val factored=parsed("user:a AND (foo OR bar)")
    val distributed=parsed("(user:a AND foo) OR (user:a AND bar)")
    assertEquals(factored.candidateFilter,user("a"))
    assertEquals(distributed.candidateFilter,True)
    assertEquals(factored.textOperands,distributed.textOperands)
    List(false,true).foreach { owner =>
      List(false,true).foreach { foo =>
        List(false,true).foreach { bar =>
          val text: String => Boolean = value => if(value=="foo") foo else bar
          val metadata: ArchivePredicate => Boolean = _ => owner
          assertEquals(factored.expression.evaluate(text,metadata),distributed.expression.evaluate(text,metadata))
        }
      }
    }
  }
}
