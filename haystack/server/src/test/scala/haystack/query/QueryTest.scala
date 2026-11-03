package haystack.query

import munit.FunSuite
import ponygirls.losslessjson.LosslessJson as J
import java.util.Locale

/** BA/BG, specified: every assertion in TS query.test.ts, plus pinned Unicode
  * and safety-limit boundary vectors. No filesystem/network/clock dependencies.
  */
class QueryTest extends FunSuite {
  def ast(q: String): AstNode = Parser.parseQuery(q).get
  def fails(q: String): InvalidQuery = intercept[InvalidQuery](Parser.parseQuery(q))
  def json(s: String): J.Value = J.parse(s, J.StandardLimits).toOption.get
  def resolved(v: J.Value, p: String): String = Pointer.resolvePointer(v, p).map(J.encode).getOrElse("MISSING")

  test("NOT > AND/juxtaposition > OR") {
    val node = ast("a OR b c NOT d").asInstanceOf[AstNode.Or]
    val and = node.children(1).asInstanceOf[AstNode.And]
    assertEquals(and.children.length, 3)
    assert(and.children(2).isInstanceOf[AstNode.Not])
  }
  test("parentheses, case-insensitive operators, android text, minus negation") {
    val n = ast("a (b OR c)").asInstanceOf[AstNode.And]
    assert(n.children(1).isInstanceOf[AstNode.Or])
    assert(ast("android AnD robot").isInstanceOf[AstNode.And])
    assert(ast("a -b").asInstanceOf[AstNode.And].children(1).isInstanceOf[AstNode.Not])
  }
  test("JSON escaped quoted phrases") {
    val n = ast("\"repeated pattern\" \"a \\\"b\\\"\"").asInstanceOf[AstNode.And]
    assertEquals(n.children.head.asInstanceOf[AstNode.Phrase].words, Vector("repeated", "pattern"))
    assertEquals(n.children(1).asInstanceOf[AstNode.Phrase].words, Vector("a", "b"))
  }
  test("all documented examples parse") {
    Vector(
      "project:example-project type:todo importance:high human-attention:required",
      "(type:github-issue OR type:github-pr) field[\"/github/state\"] = \"open\"",
      "type:skill-draft \"repeated pattern\" NOT importance:low",
      "project:example-project link:[\"motivated-by\",\"shared-knowledge:fact-mcp-auth\"]",
      "archived:all field[\"/observations/count\"] >= 3",
      "NOT exists[\"/review\"] modified-at >= \"2026-10-01T00:00:00Z\"",
      "project:example-project tag:mcp", "tag:\"machine learning\" NOT tag:wip"
    ).foreach(q => assert(ast(q) != null, q))
  }
  test("tag aliases/names are insensitive, values exact") {
    Vector("tag:mcp", "tags:mcp", "TAG:mcp").foreach(q => assertEquals(ast(q), AstNode.Pred(Predicate.Tag("mcp", Span(0, q.length)))))
    assertEquals(ast("tag:\"Machine Learning\"").asInstanceOf[AstNode.Pred].pred.asInstanceOf[Predicate.Tag].value, "Machine Learning")
    fails("tag:"); fails("tag:\"\"")
    fails("tag:" + "a" * 129); fails("tag:\"\\u0000\"")
  }
  test("field scalar literals include lossless negative exponents, booleans and null") {
    val p = ast("field[\"/n\"] >= -2.5e3").asInstanceOf[AstNode.Pred].pred.asInstanceOf[Predicate.Field]
    assertEquals(J.encode(p.value), "-2.5e3")
    ast("field[\"/b\"] = true"); ast("field[\"/z\"] != null")
    Vector("[]", "{}", "NaN", "01", "1e", "-true").foreach(v => fails(s"field[\"/n\"] = $v"))
  }
  test("qualified IDs require quoted, canonical, exactly-once encodings") {
    Vector("id:foo", "linked-to:foo", "linked-from:foo", "id:\"p:i:j\"", "id:\"p:%61\"", "id:\"p:%ff\"").foreach(fails)
    Vector("id:\"p:i\"", "linked-to:\"p:i\"", "linked-from:\"s:j\"", "id:\"a%3Ab:%252F\"").foreach(ast)
  }
  test("strict UTC instant validation includes impossible dates and fractional seconds") {
    Vector("2026-10-01T00:00:00Z", "2026-01-02T03:04:05.123456Z", "2024-02-29T23:59:59Z").foreach(t => assert(Parser.isUtcInstant(t), t))
    Vector("2026-13-01T00:00:00Z", "2026-02-30T00:00:00Z", "2026-10-01T00:00:00+02:00", "2026-10-01",
      "2026-01-01T24:00:00Z", "2026-01-01T00:00:60Z", "2026-01-01T00:00:00.1234567Z").foreach(t => assert(!Parser.isUtcInstant(t), t))
    ast("modified-at >= \"2026-10-01T00:00:00Z\"")
    ast("created-at:\"2026-01-02T03:04:05.123456Z\"")
    Vector("\"2026-13-01T00:00:00Z\"", "\"2026-02-30T00:00:00Z\"", "\"yesterday\"", "2026").foreach(v => fails("modified-at >= " + v))
  }
  test("unknown attributes, bare IDs, empty atoms and bad syntax never fall back") {
    Vector("bogus:1", "p:i", "\"\"", "\"!!!\"", "!!!", "(a", "a OR", "field[", "field[\"/x\"]",
      "field[\"/x\"] == 1", "archived:sometimes", "link:[\"only-one\"]", "a AND", "NOT", "()",
      "field[\"x\"] = 1", "exists[\"x\"]", "link:[\"\",\"p:i\"]", "\"bad\\q\"", "\"unterminated").foreach(fails)
  }
  test("empty query browses; lexer emits no whitespace tokens") {
    assertEquals(Parser.parseQuery("   "), None)
    assertEquals(Lexer.lex("   "), Lexer.Result(Vector.empty, Vector.empty))
  }
  test("half-open diagnostics use UTF16 units, including supplementary characters") {
    val e = fails("bogus:1")
    assert(e.diagnostics.nonEmpty)
    e.diagnostics.foreach(d => assert(d.span.start < d.span.end && d.span.end <= 7))
    assertEquals(fails("𐐀 bogus:1").diagnostics.head.span, Span(3, 10))
    assertEquals(Lexer.lex("𐐀 \"x\"").tokens.map(_.span), Vector(Span(0, 2), Span(3, 6)))
  }
  test("query UTF16 size bound applies to all input, including whitespace") {
    fails("a " * 3000); fails(" " * 4097)
    ast("a" * 4096)
    assertEquals(Parser.parseQuery(" " * 4096), None)
  }
  test("token, node, atom word and depth ceilings terminate with typed errors") {
    assertEquals(Lexer.lex("a " * 512).tokens.length, 512)
    assert(Lexer.lex("a " * 513).diagnostics.nonEmpty)
    ast(Vector.fill(127)("a").mkString(" "))
    fails(Vector.fill(128)("a").mkString(" "))
    ast("\"" + Vector.fill(64)("a").mkString(" ") + "\"")
    fails("\"" + Vector.fill(65)("a").mkString(" ") + "\"")
    ast("(" * 16 + "a" + ")" * 16)
    fails("(" * 17 + "a" + ")" * 17)
    fails("(" * 20 + "a" + ")" * 20)
    fails("NOT " * 17 + "a")
  }
  test("basic normalization and string-leaf-only corpus segmentation") {
    assertEquals(Text.extractWords("Hello, WORLD!"), Vector("hello", "world"))
    assertEquals(Text.extractWords("café 🐎 123"), Vector("café", "123"))
    assertEquals(Text.extractWords("!!!"), Vector.empty)
    assertEquals(Text.corpusSegments("Title words", "desc here", json("{\"a\":[\"x y\",42,true],\"b\":\"z w\"}")),
      Vector(Vector("title", "words"), Vector("desc", "here"), Vector("x", "y"), Vector("z", "w")))
  }
  test("pinned NFKC ROOT lowercase Unicode vectors, independent of Turkish locale") {
    // Origin: specified. Deliberate vectors cover expansion, compatibility,
    // contextual sigma, supplementary letters, marks and non-ASCII numbers.
    val vectors = Vector(
      "ＡＢＣ ① ﬁ K" -> Vector("abc", "1", "fi", "k"),
      "I İ ı" -> Vector("i", "i\u0307", "ı"),
      "ΟΣ ΟΣΑ" -> Vector("ος", "οσα"),
      "e\u0301 CAFÉ" -> Vector("é", "café"),
      "𐐀 𝔄 ١٢٣" -> Vector("𐐨", "a", "١٢٣"),
      "\u0301 alone" -> Vector("\u0301", "alone")
    )
    val previous = Locale.getDefault
    try { Locale.setDefault(Locale.forLanguageTag("tr-TR")); vectors.foreach { case (in, want) => assertEquals(Text.words(in), want, in) } }
    finally Locale.setDefault(previous)
  }
  private val fields = json("""{"github":{"state":"open"},"n":3,"a":[{"b":1},2],"":"empty-key","~":"tilde","weird/key":1,"~1":7,"-1":8,"01":9}""")
  test("RFC6901 objects, arrays, root, and single decoding") {
    assert(Pointer.resolvePointer(fields, "").contains(fields))
    assertEquals(resolved(fields, "/github/state"), "\"open\"")
    assertEquals(resolved(fields, "/a/0/b"), "1")
    assertEquals(resolved(fields, "/a/1"), "2")
    assertEquals(resolved(fields, "/~/"), "MISSING")
    assertEquals(resolved(fields, "/"), "\"empty-key\"")
    assertEquals(resolved(fields, "/~0"), "\"tilde\"")
    assertEquals(resolved(fields, "/weird~1key"), "1")
    assertEquals(resolved(fields, "/~01"), "7")
    assertEquals(resolved(fields, "/-1"), "8")
    assertEquals(resolved(fields, "/01"), "9")
  }
  test("missing differs from present null and arrays reject negative/padded/dash/huge indexes") {
    assertEquals(Pointer.resolvePointer(fields, "/absent"), None)
    assertEquals(Pointer.resolvePointer(json("{\"z\":null}"), "/z"), Some(J.Null))
    Vector("/a/-1", "/a/-", "/a/01", "/a/9", "/n/0", "/a/9999999999999999999999999999").foreach(p => assertEquals(Pointer.resolvePointer(fields, p), None))
  }
}
