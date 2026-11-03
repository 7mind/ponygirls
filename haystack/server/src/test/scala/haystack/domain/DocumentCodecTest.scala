package haystack.domain

import java.time.Instant
import ponygirls.losslessjson.LosslessJson

private[domain] object DomainFixtures {
  def document(fields: String = "{}", tail: String = ""): String =
    "{\"title\":\"t\",\"description\":\"d\",\"fields\":" + fields +
      ",\"type\":\"fact\",\"status\":\"actual\",\"importance\":\"low\",\"human-attention\":\"cleared\"" + tail + "}"
  val RequestId = "0193e8d5-1234-7abc-8def-1234567890ab"
  val Human = Principal("alice", "human", "human-token")
  val Agent = Principal("bot", "agent", "agent-token")
}

/** BA, specified-origin: the shared AST is exercised via the actual public boundary. */
class DocumentCodecTest extends munit.FunSuite {
  import DomainFixtures.*

  Vector("null", "true", "false", "9007199254740993", "0.123456789012345678901234567890",
    "-0", "1.00E+00002", "\"café 🐎\"", "[]", "{}", "[1,{\"a\":null}]").foreach { fields =>
    test("all JSON field roots preserve exact encoding: " + fields) {
      val doc = DocumentCodec.parse(document(fields))
      assertEquals(LosslessJson.encode(doc.fields), fields)
      val roundtrip = DocumentCodec.parse(DocumentCodec.canonical(doc))
      assertEquals(LosslessJson.encode(roundtrip.fields), fields)
    }
  }
  test("prototype names, empty keys, arrays and exact numeric spelling survive") {
    val fields = "{\"\":null,\"__proto__\":9007199254740993,\"constructor\":{\"prototype\":[0.10,1e2,-0]}}"
    assertEquals(LosslessJson.encode(DocumentCodec.parse(document(fields)).fields), fields)
  }
  test("object key order and string escape spelling are not authoritative") {
    val doc = DocumentCodec.parse(document("{\"z\":1,\"a\":\"\\u0061\"}"))
    assertEquals(LosslessJson.encode(doc.fields), "{\"a\":\"a\",\"z\":1}")
  }
  test("missing optional arrays default empty; repetitions and order preserved") {
    val minimal = DocumentCodec.parse(document())
    assertEquals(minimal.links, Vector.empty)
    assertEquals(minimal.tags, Vector.empty)
    val doc = DocumentCodec.parse(document(tail = ",\"links\":[[\"self\",\"p:i\"],[\"self\",\"p:i\"],[\"other\",\"else:absent\"]],\"tags\":[\"Z\",\"a\",\"Z\"]"))
    assertEquals(doc.links, Vector("self" -> "p:i", "self" -> "p:i", "other" -> "else:absent"))
    assertEquals(doc.tags, Vector("Z", "a", "Z"))
    assertEquals(DocumentCodec.parse(DocumentCodec.canonical(doc)).links, doc.links)
  }
  test("vocabularies are extensible; only attention is closed") {
    val doc = DocumentCodec.parse(document()).copy(docType = "future-kind", status = "future-state", importance = "not-a-rank")
    assertEquals(DocumentCodec.parse(DocumentCodec.canonical(doc)).docType, "future-kind")
    assertEquals(DocumentCodec.parse(DocumentCodec.canonical(doc.copy(status = "archived"))).status, "archived")
    assertEquals(intercept[Fault](DocumentCodec.canonical(doc.copy(humanAttention = "approved"))).code, "invalid-document")
  }
  Vector(
    "null", "[]", "42", "{}", document().replace("\"title\":\"t\"", "\"title\":\"\""),
    document().replace("\"description\":\"d\"", "\"description\":null"),
    document().replace("\"fields\":{},", ""),
    document(tail = ",\"metadata\":{}"),
    document(tail = ",\"links\":[[\"x\",\"bad\"]]"),
    document(tail = ",\"links\":[[\"x\",\"p:%41\"]]"),
    document(tail = ",\"links\":[[\"x\",\"p:i\",\"third\"]]"),
    document(tail = ",\"links\":[[\"\",\"p:i\"]]"),
    document(tail = ",\"links\":null"),
    document(tail = ",\"tags\":[\"\"]"),
    document(tail = ",\"tags\":[\" x\"]"),
    document(tail = ",\"tags\":[\"x \"]"),
    document(tail = ",\"tags\":[42]"),
    document(tail = ",\"tags\":\"one\"")
  ).zipWithIndex.foreach { case (raw, i) =>
    test(s"semantic invalid-document $i") {
      assertEquals(intercept[Fault](DocumentCodec.parse(raw)).code, "invalid-document")
    }
  }
  Vector(
    "", "[", "{\"a\":1,}", "NaN", "Infinity", "{\"a\":1,\"a\":2}",
    document("{\"a\":1,\"\\u0061\":2}"),
    document("{\"🐎\":1,\"\\uD83D\\uDC0E\":2}"),
    document("\"\\u0000\""), document("{\"\\u0000\":1}"),
    document("\"\\uD800\""), document("\"\\uDC00\""),
    document("1e1000000"), document("1e-1000000")
  ).zipWithIndex.foreach { case (raw, i) =>
    test(s"syntax/codec invalid envelope $i") {
      val fault = intercept[Fault](DocumentCodec.parse(raw))
      assertEquals(fault.code, "bad-envelope")
      assert(!fault.message.contains("9007199254740993"))
    }
  }
  test("tag edge whitespace includes Unicode NBSP, space separators and BOM") {
    Vector("\\u00a0x", "x\\u00a0", "\\ufeffx", "x\\ufeff", "\\u2003x", "x\\u2003").foreach { tag =>
      assertEquals(intercept[Fault](DocumentCodec.parse(document(tail = ",\"tags\":[\"" + tag + "\"]"))).code, "invalid-document")
    }
  }
  test("validate rejects over-depth ASTs parsed under wider shared-codec limits") {
    val admitted = document("[" * 64 + "0" + "]" * 64)
    val admittedValue = LosslessJson.parse(admitted, DocumentCodec.Limits.copy(maxDepth = 128)).toOption.get
    DocumentCodec.validate(admittedValue)
    val raw = document("[" * 65 + "0" + "]" * 65)
    val value = LosslessJson.parse(raw, DocumentCodec.Limits.copy(maxDepth = 128)).toOption.get
    assertEquals(intercept[Fault](DocumentCodec.validate(value)).code, "invalid-document")
  }
  test("title, description, metadata, tags and links inclusive bounds") {
    val doc = DocumentCodec.parse(document()).copy(title = "t" * 512, description = "d" * 65536,
      docType = "x" * 128, links = Vector.fill(256)("l" * 128 -> "p:i"), tags = Vector.fill(64)("x" * 128))
    DocumentCodec.canonical(doc)
    Vector(doc.copy(title = "t" * 513), doc.copy(description = "d" * 65537), doc.copy(docType = "x" * 129),
      doc.copy(links = doc.links :+ ("x" -> "p:i")), doc.copy(tags = doc.tags :+ "x"),
      doc.copy(tags = Vector("x" * 129)), doc.copy(links = Vector("x" * 129 -> "p:i"))).foreach { invalid =>
      assertEquals(intercept[Fault](DocumentCodec.canonical(invalid)).code, "invalid-document")
    }
  }
  test("field strings retain their leaf bound; object keys have only the document byte bound") {
    val string = "x" * DocumentCodec.StringLeafMax
    val raw = document("\"" + string + "\"")
    assertEquals(LosslessJson.encode(DocumentCodec.parse(raw).fields).length, string.length + 2)
    assertEquals(intercept[Fault](DocumentCodec.parse(document("\"" + string + "x\""))).code, "invalid-document")
    val longKey = string + "x"
    val keyDocument = DocumentCodec.parse(document("{\"" + longKey + "\":0}"))
    assertEquals(keyDocument.fields.asInstanceOf[LosslessJson.Obj].fields.head._1, longKey)
    val emptyKeyDocument = document("{\"\":0}")
    val maxKey = "k" * (DocumentCodec.DocumentMaxBytes - emptyKeyDocument.length)
    DocumentCodec.parse(document("{\"" + maxKey + "\":0}"))
    assertEquals(intercept[Fault](DocumentCodec.parse(document("{\"" + maxKey + "x\":0}"))).code, "bad-envelope")
  }
  test("source byte, nesting, number token bounds include exact edge") {
    val base = document()
    DocumentCodec.parse(base + " " * (DocumentCodec.DocumentMaxBytes - base.length))
    assertEquals(intercept[Fault](DocumentCodec.parse(base + " " * (DocumentCodec.DocumentMaxBytes - base.length + 1))).code, "bad-envelope")
    DocumentCodec.parse(document("[" * 63 + "0" + "]" * 63))
    DocumentCodec.parse(document("[" * 64 + "0" + "]" * 64))
    DocumentCodec.parse(document("[" * 65 + "]" * 65))
    assertEquals(intercept[Fault](DocumentCodec.parse(document("[" * 65 + "0" + "]" * 65))).code, "invalid-document")
    assertEquals(intercept[Fault](DocumentCodec.parse(document("[" * 66 + "]" * 66))).code, "bad-envelope")
    DocumentCodec.parse(document("1" * 65536))
    DocumentCodec.parse(document("1" * 65537))
    DocumentCodec.parseRaw("1" * DocumentCodec.DocumentMaxBytes)
    assertEquals(intercept[Fault](DocumentCodec.parseRaw("1" * (DocumentCodec.DocumentMaxBytes + 1))).code, "bad-envelope")
    val oversizedToken = LosslessJson.parse("1" * (DocumentCodec.DocumentMaxBytes + 1), DocumentCodec.StoredLimits)
    assertEquals(oversizedToken.left.toOption.map(_.code), Some("number-limit"))
  }
  test("PostgreSQL integral and scale admission is explicit and exact") {
    DocumentCodec.parse(document("1e131071"))
    DocumentCodec.parse(document("1e-16383"))
    DocumentCodec.parse(document("123.00e131069"))
    Vector("1e131072", "123e131070", "1e-16384", "0.1e-16383").foreach { number =>
      assertEquals(intercept[Fault](DocumentCodec.parse(document(number))).code, "invalid-document")
    }
    assertEquals(LosslessJson.encode(DocumentCodec.parse(document("1.2300E+00004")).fields), "1.2300E+00004")
  }
  test("metadata clock/principal are authoritative; creation metadata immutable") {
    val first = Instant.parse("2026-10-07T18:00:00Z")
    val second = first.plusSeconds(3600)
    val created = ItemMetadata.stamp(None, Human, first)
    val edited = ItemMetadata.stamp(Some(created), Agent, second)
    assertEquals(created, ItemMetadata(first, "alice", first, "alice"))
    assertEquals(edited, ItemMetadata(first, "alice", second, "bot"))
    val item = StoredItem(ItemKey("p", "i"), 1L, DocumentCodec.parse(document()), "original-text", created)
    assertEquals(item.project, "p")
    assertEquals(item.item, "i")
    assertEquals(item.documentCanonical, "original-text")
  }
}
