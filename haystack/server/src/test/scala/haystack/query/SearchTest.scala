package haystack.query

import munit.FunSuite
import java.time.Instant
import java.util.Base64
import java.nio.charset.StandardCharsets.UTF_8
import ponygirls.losslessjson.LosslessJson as J
import haystack.domain.*

/** BG, specified: complete pure search characterization from TS suites/search.ts.
  * Transport, DB and mutation/replay tests belong to their respective adapters.
  */
class SearchTest extends FunSuite {
  private val baseTime = Instant.parse("2026-10-07T18:00:00Z")
  def json(s: String): J.Value = J.parse(s, J.StandardLimits).toOption.get
  def row(key: String, title: String = "t", docType: String = "fact", status: String = "actual", importance: String = "low",
    attention: String = "cleared", fields: String = "{}", links: Vector[(String, String)] = Vector.empty,
    tags: Vector[String] = Vector.empty, revision: Long = 1, at: Instant = baseTime): StoredItem = {
    val split = key.indexOf(':')
    val doc = ItemDocument(title, "d", json(fields), docType, status, importance, attention, links, tags)
    StoredItem(ItemKey(key.take(split), key.substring(split + 1)), revision, doc, "", ItemMetadata(at, "alice", at, "alice"))
  }
  private def fixture: Vector[StoredItem] = Vector(
    row("projA:note1", "MCP auth pattern", importance = "high", attention = "required",
      fields = """{"count":5,"tags":["repeated","pattern"],"gh":{"state":"open"}}""",
      links = Vector("motivated-by" -> "projB:fact1"), tags = Vector("mcp", "urgent")),
    row("projA:note2", "Unrelated todo", docType = "todo", fields = """{"count":2}"""),
    row("projA:old1", "Archived memory", status = "archived", tags = Vector("mcp")),
    row("projB:fact1", "fact mcp auth", fields = """{"observations":{"count":3}}""", links = Vector("see-also" -> "projA:note1"), tags = Vector("mcp")),
    row("projB:uni", "café notes", fields = """{"n":9007199254740993}""", tags = Vector("Machine Learning")),
    row("projA:self", "self reference", links = Vector("rel" -> "projA:self")),
    row("projA:dangle", "dangling pointer", links = Vector("rel" -> "ghost:nowhere")),
    row("projA:same", "same in A"), row("projB:same", "same in B", docType = "todo"),
    row("projA:fresh", "fresh item", at = baseTime.plusSeconds(60))
  )
  def keys(result: SearchResult): Vector[String] = result.items.map(s => s.project + ":" + s.item)
  def find(q: String, project: Option[String] = None, items: Vector[StoredItem] = fixture): Vector[String] =
    keys(Search.search(items, SearchInput(q, project, limit = 100))).sorted
  def check(q: String, expected: String*): Unit = assertEquals(find(q), expected.toVector.sorted, q)
  private val visible = Vector("projA:dangle", "projA:fresh", "projA:note1", "projA:note2", "projA:same", "projA:self", "projB:fact1", "projB:same", "projB:uni")

  test("empty/whitespace browse returns every nonarchived summary in raw key order") {
    val p = Search.search(fixture, SearchInput("   ", limit = 100))
    assertEquals(keys(p), visible); assertEquals(p.cursor, None)
    assertEquals(p.items.find(_.item == "note1").get.tags, Vector("mcp", "urgent"))
  }
  test("Boolean precedence over text") {
    check("mcp auth", "projA:note1", "projB:fact1")
    check("mcp todo")
    check("mcp OR todo", "projA:note1", "projA:note2", "projB:fact1")
    check("mcp NOT auth")
  }
  test("phrases cannot cross array/tag/field/title-description segments") {
    check("\"auth pattern\"", "projA:note1")
    check("\"repeated pattern\"")
    check("repeated pattern", "projA:note1")
    val r = row("p:i", "one", fields = """{"a":["three","four"],"b":"five","c":"six"}""", tags = Vector("seven", "eight"))
    Vector("\"one d\"", "\"three four\"", "\"five six\"", "\"seven eight\"").foreach(q => assertEquals(find(q, items = Vector(r)), Vector.empty))
    assertEquals(Text.corpusSegments(r.document), Vector("one", "d", "seven", "eight", "three", "four", "five", "six"))
  }
  test("Unicode search and punctuation diagnostics") {
    check("café", "projB:uni")
    Vector("\"🐎\"", "!!!").foreach(q => intercept[InvalidQuery](find(q)))
  }
  test("JSON predicates distinguish missing, null, arrays and wrong numeric types") {
    check("field[\"/gh/state\"] = \"open\"", "projA:note1")
    check("field[\"/nope\"] = \"x\""); check("field[\"/nope\"] != \"x\"")
    assert(find("NOT exists[\"/nope\"]").contains("projA:note1"))
    check("field[\"/tags/0\"] = \"repeated\"", "projA:note1")
    check("field[\"/tags/-1\"] = \"pattern\""); check("field[\"/tags/00\"] = \"repeated\"")
    val r = row("p:i", fields = """{"null":null,"n":5,"s":"5","b":true}""")
    assertEquals(find("exists[\"/null\"] field[\"/null\"] = null", items = Vector(r)), Vector("p:i"))
    assertEquals(find("field[\"/missing\"] != null", items = Vector(r)), Vector.empty)
    assertEquals(find("field[\"/s\"] != 5", items = Vector(r)), Vector.empty)
    assertEquals(find("field[\"/b\"] = true", items = Vector(r)), Vector("p:i"))
  }
  test("exact JSON numbers, no floating point coercion") {
    check("field[\"/count\"] >= 3", "projA:note1")
    check("field[\"/count\"] = 5", "projA:note1")
    check("field[\"/n\"] = 9007199254740993", "projB:uni")
    check("field[\"/count\"] = \"5\"")
    check("field[\"/observations/count\"] >= 3", "projB:fact1")
    val r = row("p:i", fields = """{"a":1e999999,"b":-0,"c":-2.500e3,"d":1.000000000000000000000001}""")
    Vector("field[\"/a\"] > 9e999998", "field[\"/b\"] = 0", "field[\"/c\"] = -2500", "field[\"/d\"] > 1").foreach(q => assertEquals(find(q, items = Vector(r)), Vector("p:i")))
    Vector("=", "!=", "<", "<=", ">", ">=").foreach(op => assert(!Evaluator.compareJson(json("\"5\""), op, json("5"))))
  }
  test("exact link tuples, linked-to/from, self-links and dangling targets") {
    check("link:[\"motivated-by\",\"projB:fact1\"]", "projA:note1")
    check("linked-to:\"projA:note1\"", "projB:fact1")
    check("linked-from:\"projB:fact1\"", "projA:note1")
    check("type:todo linked-to:\"projB:fact1\"")
    check("link:[\"rel\",\"projA:self\"]", "projA:self")
    check("linked-to:\"ghost:nowhere\"", "projA:dangle")
    val r = row("p:i", links = Vector("a" -> "q:j", "b" -> "q:k"))
    assertEquals(find("link:[\"a\",\"q:k\"]", items = Vector(r)), Vector.empty)
  }
  test("tag exact case sensitivity, aliases, Boolean composition and text indexing") {
    Vector("tag:mcp", "tags:mcp", "TAG:mcp").foreach(q => check(q, "projA:note1", "projB:fact1"))
    check("TAG:MCP")
    check("tag:\"Machine Learning\"", "projB:uni")
    check("tag:mcp tag:urgent", "projA:note1")
    assert(!find("tag:mcp").contains("projA:old1"))
    check("archived:all tag:mcp", "projA:note1", "projA:old1", "projB:fact1")
    val neg = find("NOT tag:mcp")
    assert(neg.contains("projA:note2")); assert(!neg.contains("projA:note1")); assert(!neg.contains("projB:fact1"))
    check("urgent", "projA:note1"); check("machine", "projB:uni")
    Vector("tag:", "tag:\"\"").foreach(q => intercept[InvalidQuery](find(q)))
  }
  test("scope intersects predicates, not link target/source projects") {
    check("project:projB", "projB:fact1", "projB:same", "projB:uni")
    assertEquals(find("project:projB", Some("projA")), Vector.empty)
    assertEquals(find("link:[\"motivated-by\",\"projB:fact1\"]", Some("projA")), Vector("projA:note1"))
    assertEquals(find("link:[\"motivated-by\",\"projB:fact1\"]", Some("projB")), Vector.empty)
    assertEquals(find("linked-from:\"projB:fact1\"", Some("projA")), Vector("projA:note1"))
  }
  test("archive filter wraps the entire Boolean tree unless selector anywhere") {
    check("memory"); check("status:archived", "projA:old1")
    check("archived:all memory", "projA:old1"); check("archived:false memory")
    check("type:todo OR status:archived", "projA:note2", "projA:old1", "projB:same")
    check("archived:true", "projA:old1")
    assert(find("NOT archived:false").contains("projA:old1"))
    assert(!find("todo OR memory").contains("projA:old1"))
    assert(find("NOT NOT status:archived").contains("projA:old1"))
  }
  test("time and author metadata predicates") {
    check("modified-at >= \"2026-10-07T18:01:00Z\"", "projA:fresh")
    assertEquals(find("modified-at < \"2026-10-07T18:01:00Z\"").length, 8)
    assertEquals(find("created-by:alice modified-by:alice").length, 9)
    check("created-by:Alice")
    val r = row("p:i", at = Instant.parse("2026-10-07T18:00:00.123456Z"))
    assertEquals(find("modified-at > \"2026-10-07T18:00:00.123455Z\"", items = Vector(r)), Vector("p:i"))
  }
  test("exact IDs and diagnostic bare IDs") {
    check("id:\"projA:same\"", "projA:same")
    intercept[InvalidQuery](find("projA:same"))
    val r = row("a:b", title = "encoded").copy(key = ItemKey("a:b", "%/"))
    assertEquals(find("id:\"a%3Ab:%25%2F\"", items = Vector(r)), Vector("a:b:%/"))
  }
  def traverse(items: Vector[StoredItem], in: SearchInput): Vector[String] = {
    var cursor: Option[String] = None
    val seen = Vector.newBuilder[String]
    var done = false
    var pages = 0
    while (!done && pages < 20) {
      val p = Search.search(items, in.copy(cursor = cursor)); seen ++= keys(p); cursor = p.cursor
      done = cursor.isEmpty; pages += 1
    }
    assert(done, "paging failed to terminate")
    val result = seen.result(); assertEquals(result.distinct.length, result.length)
    result
  }
  test("unchanged live keyset traversal has no duplicates/loss") {
    assertEquals(traverse(fixture, SearchInput("", limit = 2)), visible)
  }
  private val a = "sortA:a"; private val b = "sortA:b"; private val c = "sortA:\uE000"
  private val d = "sortA:😀"; private val e = "sortB:a"; private val f = "sortB:b"
  private def sortedRows: Vector[StoredItem] = Vector(
    row(a, "same", "zeta", "actual", "urgent", "required", tags = Vector("sorting"), revision = 1, at = baseTime.plusSeconds(1)),
    row(b, "Z", "alpha", "waiting", "low", "cleared", tags = Vector("sorting"), revision = 2, at = baseTime.plusSeconds(3)),
    row(c, "same", "alpha", "actual", "high", "required", tags = Vector("sorting"), revision = 10, at = baseTime.plusSeconds(2)),
    row(d, "\uE000", "beta", "waiting", "medium", "cleared", tags = Vector("sorting"), revision = 3, at = baseTime.plusSeconds(1)),
    row(e, "😀", "beta", "actual", "critical", "required", tags = Vector("sorting"), revision = 2, at = baseTime.plusSeconds(3)),
    row(f, "same", "alpha", "archived", "low", "cleared", tags = Vector("sorting"), revision = 1, at = baseTime.plusSeconds(1))
  )
  private val groups = Vector(
    "key" -> Vector(Vector(a), Vector(b), Vector(c), Vector(d), Vector(e), Vector(f)),
    "title" -> Vector(Vector(b), Vector(a,c,f), Vector(d), Vector(e)),
    "project" -> Vector(Vector(a,b,c,d), Vector(e,f)),
    "type" -> Vector(Vector(b,c,f), Vector(d,e), Vector(a)),
    "status" -> Vector(Vector(a,c,e), Vector(f), Vector(b,d)),
    "importance" -> Vector(Vector(e), Vector(c), Vector(b,f), Vector(d), Vector(a)),
    "human-attention" -> Vector(Vector(b,d,f), Vector(a,c,e)),
    "modified-at" -> Vector(Vector(a,d,f), Vector(c), Vector(b,e)),
    "revision" -> Vector(Vector(a,f), Vector(b,e), Vector(d), Vector(c))
  )
  for ((field, g) <- groups; direction <- Vector("asc", "desc")) test(s"global $field $direction sorting including ties across pages") {
    val expected = (if (direction == "asc") g else g.reverse).flatten
    assertEquals(traverse(sortedRows.reverse ++ fixture, SearchInput("archived:all tag:sorting", limit = 2, sort = SearchSort(field, direction))), expected)
  }
  test("project/archive/text eligibility is applied before global sort") {
    for (direction <- Vector("asc", "desc")) {
      val in = SearchInput("tag:sorting same", Some("sortA"), 1, sort = SearchSort("title", direction))
      val p = Search.search(sortedRows, in)
      assertEquals(keys(p), Vector(a)); assert(p.cursor.nonEmpty)
      val next = Search.search(sortedRows, in.copy(cursor = p.cursor))
      assertEquals(keys(next), Vector(c)); assertEquals(next.cursor, None)
    }
    assertEquals(keys(Search.search(sortedRows, SearchInput("tag:sorting same", sort = SearchSort("key", "desc")))), Vector(c,a))
    assertEquals(keys(Search.search(sortedRows, SearchInput("archived:all tag:sorting same", sort = SearchSort("key", "desc")))), Vector(f,c,a))
  }
  test("cursor binds exact query, scope, limit, effective sort field and direction") {
    val in = SearchInput("archived:all tag:sorting", limit = 1, sort = SearchSort("title", "asc"))
    val cursor = Search.search(sortedRows, in).cursor
    assert(cursor.nonEmpty)
    Vector(in.copy(query = "tag:sorting"), in.copy(query = in.query + " "), in.copy(project = Some("sortA")), in.copy(limit = 2),
      in.copy(sort = SearchSort("importance", "asc")), in.copy(sort = SearchSort("title", "desc")), in.copy(sort = SearchSort())).foreach { changed =>
      intercept[InvalidCursor](Search.search(sortedRows, changed.copy(cursor = cursor)))
    }
    val default = SearchInput(in.query, limit = 1)
    val p = Search.search(sortedRows, default)
    assert(p.cursor.nonEmpty)
    assertEquals(keys(Search.search(sortedRows, default.copy(cursor = p.cursor, sort = SearchSort("key", "asc")))), Vector(b))
  }
  test("saved boundary survives moved, archived and deleted rows without looking them up") {
    val in = SearchInput("tag:sorting same", limit = 1, sort = SearchSort("title", "asc"))
    val first = Search.search(sortedRows, in)
    assertEquals(keys(first), Vector(a)); assert(first.cursor.nonEmpty)
    val moved = sortedRows.map(s => if (s.key.qualified == a) s.copy(document = s.document.copy(title = "same z"), revision = 2) else s)
    val second = Search.search(moved, in.copy(cursor = first.cursor))
    assertEquals(keys(second), Vector(c)); assert(second.cursor.nonEmpty)
    val third = Search.search(moved, in.copy(cursor = second.cursor))
    assertEquals(keys(third), Vector(a)); assertEquals(third.cursor, None)
    val archived = moved.map(s => if (s.key.qualified == a) s.copy(document = s.document.copy(status = "archived")) else s)
    assertEquals(keys(Search.search(archived, in.copy(cursor = first.cursor))), Vector(c))
    assertEquals(keys(Search.search(moved.filterNot(_.key.qualified == a), in.copy(cursor = first.cursor))), Vector(c))
  }
  test("sort transport decoder rejects all invalid untrusted shapes rather than defaulting") {
    assertEquals(Search.parseSearchSort(None), SearchSort())
    assertEquals(Search.parseSearchSort(Some(json("""{"field":"title","direction":"desc"}"""))), SearchSort("title", "desc"))
    Vector("null", "\"title\"", "[]", "{}", """{"field":"title"}""", """{"direction":"asc"}""",
      """{"field":"title","direction":"ASC"}""", """{"field":"title; DROP TABLE items; --","direction":"asc"}""",
      """{"field":"constructor","direction":"asc"}""", """{"field":"title","direction":"asc","extra":true}""").foreach { s =>
      val fault = intercept[Fault](Search.parseSearchSort(Some(json(s)))); assertEquals(fault.code, "bad-envelope")
    }
  }
  private def cursorArray(parts: String*): String = Base64.getUrlEncoder.withoutPadding.encodeToString(parts.mkString("[", ",", "]").getBytes(UTF_8))
  test("rejects malformed, obsolete and foreign cursors and malformed saved positions") {
    for (field <- Vector("key", "project", "title", "type", "status", "importance", "human-attention", "revision", "modified-at")) {
      val in = SearchInput("archived:all tag:sorting", limit = 1, sort = SearchSort(field))
      val p = Search.search(sortedRows, in)
      val cursor = p.cursor.get
      Vector("", "nope", cursor + "=", cursor + "\n", "a" * 20000, "_w", "W10", "e30").foreach { bad =>
        intercept[InvalidCursor](Search.search(sortedRows, in.copy(cursor = Some(bad))))
      }
      val fp = Search.fingerprint(in)
      def encode(project: String = "sortA", item: String = "a", value: String = "same"): String = Search.encodeCursor(fp, SearchPosition(project, item, value))
      Vector(encode(project = ""), encode(item = "\u0000"), encode(project = "a" * 257), encode(item = "\uD800")).foreach { bad =>
        intercept[InvalidCursor](Search.search(sortedRows, in.copy(cursor = Some(bad))))
      }
      val invalidValues = field match {
        case "key" | "project" => Vector("other", "")
        case "revision" => Vector("0", "-1", "1.0", "01", "9223372036854775808", "nope")
        case "modified-at" => Vector("0000-01-01T00:00:00Z", "-000001-01-01T00:00:00Z", "+010000-01-01T00:00:00Z", "2026-02-30T00:00:00Z", "yesterday")
        case "human-attention" => Vector("", "other")
        case "title" => Vector("", "x" * 513)
        case _ => Vector("", "x" * 129)
      }
      invalidValues.foreach(v => intercept[InvalidCursor](Search.search(sortedRows, in.copy(cursor = Some(encode(value = v))))))
      Vector("null", "{}", "[]", "42", "\"v0\"").foreach { version =>
        val bad = cursorArray(version, "\"" + fp + "\"", "\"sortA\"", "\"a\"", "\"same\"")
        intercept[InvalidCursor](Search.search(sortedRows, in.copy(cursor = Some(bad))))
      }
      val parsed = json(new String(Base64.getUrlDecoder.decode(cursor), UTF_8)).asInstanceOf[J.Arr]
      for (index <- Vector(2, 3, 4); replacement <- Vector("null", "{}", "[]", "1")) {
        val parts = parsed.values.map(J.encode).updated(index, replacement)
        intercept[InvalidCursor](Search.search(sortedRows, in.copy(cursor = Some(cursorArray(parts*)))) )
      }
    }
    intercept[InvalidCursor](Search.search(fixture, SearchInput("", limit = 2, cursor = Some("nope"))))
    val foreign = Search.search(fixture, SearchInput("mcp", limit = 1)).cursor
    assert(foreign.nonEmpty)
    intercept[InvalidCursor](Search.search(fixture, SearchInput("todo", limit = 1, cursor = foreign)))
  }
  test("modified-at cursors preserve nanosecond Instant metadata exactly") {
    // Regression: Instant.now can carry more precision than a query literal.
    val rows = Vector(row("p:a", at = Instant.parse("2026-10-07T18:00:00.123456789Z")),
      row("p:b", at = Instant.parse("2026-10-07T18:00:00.123456790Z")))
    assertEquals(traverse(rows, SearchInput("", limit = 1, sort = SearchSort("modified-at"))), Vector("p:a", "p:b"))
    assertEquals(traverse(rows, SearchInput("", limit = 1, sort = SearchSort("modified-at", "desc"))), Vector("p:b", "p:a"))
  }
  test("limit 1–100 validation and default 20") {
    assertEquals(SearchInput("").limit, 20)
    Vector(-1, 0, 101).foreach(n => intercept[InvalidQuery](Search.search(fixture, SearchInput("", limit = n))))
  }
  test("injection strings are grammar data, never structures") {
    for (q <- Vector("type:todo OR 1=1", "\" OR TRUE --", "type:fact; DROP TABLE items; --", "archived:all OR archived:all")) {
      try {
        val result = find(q)
        if (q == "archived:all OR archived:all") assert(result.contains("projA:old1"))
        else assert(!result.contains("projA:old1"))
      } catch { case _: InvalidQuery => () }
    }
    assert(find("").nonEmpty)
  }
  test("completion emits canonical encoded IDs, builtins, metadata and quoted tag values") {
    val special = fixture ++ Vector(row("plain:key"), row("a:key").copy(key = ItemKey("a:b", "key")))
    val ids = Search.complete(special, "key")
    assert(ids.contains("id:\"a%3Ab:key\"")); assert(!ids.exists(s => s.contains("a:b:key") && !s.contains("%3A")))
    assert(Search.complete(fixture, "typ").contains("type:"))
    assert(Search.complete(fixture, "type:").exists(_.startsWith("type:")))
    assert(Search.complete(fixture, "projA:no").contains("id:\"projA:note1\""))
    assert(Search.analyze("bogus:1").nonEmpty); assertEquals(Search.analyze("type:todo"), Vector.empty)
    assert(Search.complete(fixture, "ta").contains("tag:")); assert(Search.complete(fixture, "ta").contains("tags:"))
    assert(Search.complete(fixture, "tag:m").contains("tag:mcp"))
    assert(Search.complete(fixture, "tag:").contains("tag:\"Machine Learning\""))
    assertEquals(Search.analyze("tag:mcp"), Vector.empty); assert(Search.analyze("tag:").nonEmpty)
  }
}
