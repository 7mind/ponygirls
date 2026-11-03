package haystack.domain

/** BA, specified-origin: externally visible codec contract; no I/O or mocks. */
class QualifiedIdTest extends munit.FunSuite {
  private val vectors = Vector(
    ("example-project", "fact-mcp-auth", "example-project:fact-mcp-auth"),
    ("a:b", "i%d", "a%3Ab:i%25d"),
    ("proj", "sp ace/x?", "proj:sp%20ace%2Fx%3F"),
    ("uni", "café 🐎", "uni:caf%C3%A9%20%F0%9F%90%8E"),
    ("a", "B", "a:B"),
    ("~tilde", ".dot-dash_under", "~tilde:.dot-dash_under")
  )
  vectors.foreach { case (project, item, external) =>
    test("qualified ID round-trip: " + external) {
      val key = ItemKey(project, item)
      assertEquals(QualifiedId.encodeKey(key), external)
      assertEquals(key.qualified, external)
      assertEquals(QualifiedId.decodeKey(external), key)
    }
  }
  test("one decode, never a second percent interpretation") {
    assertEquals(QualifiedId.decodeKey("a%253Ab:x"), ItemKey("a%3Ab", "x"))
  }
  val invalid = Vector(
    "a:b:c", "a%3ab:x", "a%2Dx:y", "p:ab%", "p:a%ZZ", "p:%E2%82", "p:a%00", "p:a+b",
    "abc", ":x", "p:", "p:é", "p:%C0%AF", "p:%ED%A0%80", "p:%F4%90%80%80", "p:%80", "p:%FF"
  )
  invalid.zipWithIndex.foreach { case (key, i) =>
    test(s"reject noncanonical ID $i") {
      assertEquals(intercept[Fault](QualifiedId.decodeKey(key)).code, "invalid-id")
    }
  }
  test("component bounds are inclusive, Unicode is not normalized") {
    assertEquals(QualifiedId.decodeComponent(QualifiedId.encodeComponent("x" * 256)), "x" * 256)
    assertEquals(intercept[Fault](QualifiedId.encodeComponent("x" * 257)).code, "invalid-id")
    assertEquals(intercept[Fault](QualifiedId.encodeComponent("\uD800")).code, "invalid-id")
    assertEquals(intercept[Fault](QualifiedId.encodeComponent("\uDC00")).code, "invalid-id")
    assertEquals(intercept[Fault](QualifiedId.encodeComponent("x\u0000")).code, "invalid-id")
    assertNotEquals(QualifiedId.encodeComponent("é"), QualifiedId.encodeComponent("e\u0301"))
    assertEquals(QualifiedId.decodeComponent(QualifiedId.encodeComponent("🐎" * 128)), "🐎" * 128)
    assertEquals(intercept[Fault](QualifiedId.encodeComponent("🐎" * 129)).code, "invalid-id")
  }
}
