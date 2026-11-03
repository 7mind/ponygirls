package haystack.domain

import java.nio.charset.StandardCharsets

/** BA, specified-origin: accepted-envelope/replay fingerprint contract, no repository mocks. */
class OperationEnvelopeTest extends munit.FunSuite {
  import DomainFixtures.*
  private def accept(raw: String = document(), key: String = "p:i", revision: Long = 0L, id: String = RequestId): AcceptedOperation =
    OperationEnvelope.accept(key, raw, revision, id)

  test("exact independently hashed current-format golden vector") {
    val raw = "{\"x\":0.10,\"n\":9007199254740993}"
    val expected = "[\"haystack-op-scala-v1\",\"lossless-json-v1\",\"v1\",\"p:golden\",0,{\"n\":9007199254740993,\"x\":0.10}]"
    assertEquals(new String(OperationDigest.canonicalBytes(ItemKey("p", "golden"), 0L, raw), StandardCharsets.UTF_8), expected)
    assertEquals(OperationDigest.compute(ItemKey("p", "golden"), 0L, raw),
      OperationDigest("haystack-op-scala-v1", "3004fd5056346ccf52867a87caf5f0da8be5b149f31a7f509aa0431abc971b7e"))
  }
  test("key order/whitespace do not alter replay; numeric spellings do") {
    val first = accept(document("{\"b\":0.10,\"a\":9007199254740993}"))
    val reordered = accept("  " + document("{\"a\":9007199254740993,\"b\":0.10}") + "\n")
    assertEquals(first.digest, reordered.digest)
    assertEquals(first.documentCanonical, reordered.documentCanonical)
    assertNotEquals(first.digest, accept(document("{\"a\":9007199254740993,\"b\":0.1}")).digest)
  }
  test("every operation input is bound; request id is replay identity not content") {
    val original = accept()
    assertNotEquals(original.digest, accept(key = "p:other").digest)
    assertNotEquals(original.digest, accept(revision = 1).digest)
    assertNotEquals(original.digest, accept(document("[1,2]")).digest)
    assertNotEquals(accept(document("[1,2]")).digest, accept(document("[2,1]")).digest)
    assertEquals(original.digest, accept(id = RequestId.dropRight(1) + "c").digest)
    assertNotEquals(OperationDigest.Format, "haystack-op-v1")
  }
  test("UUIDv7 all variant nibbles accepted and case canonicalized") {
    Vector('8', '9', 'a', 'b').foreach { variant =>
      val id = "0193e8d5-1234-7abc-" + variant + "def-1234567890ab"
      assertEquals(accept(id = id.toUpperCase(java.util.Locale.ROOT)).requestId, id)
    }
  }
  Vector("", "0193e8d5-1234-4abc-8def-1234567890ab", "0193e8d5-1234-7abc-cdef-1234567890ab",
    "0193e8d5-1234-7abc-0def-1234567890ab", "0193e8d5-1234-7abc-8def-1234567890ab\n",
    " 0193e8d5-1234-7abc-8def-1234567890ab", "not-a-uuid").zipWithIndex.foreach { case (id, i) =>
    test(s"invalid request ID $i is an unaccepted bad-envelope") {
      assertEquals(intercept[Fault](accept(id = id)).code, "bad-envelope")
    }
  }
  test("invalid revision/key/JSON fails before acceptance") {
    assertEquals(intercept[Fault](accept(revision = -1)).code, "bad-envelope")
    assertEquals(intercept[Fault](accept(key = "p:%69")).code, "invalid-id")
    assertEquals(intercept[Fault](accept("{\"x\":1,\"x\":2}")).code, "bad-envelope")
    assertEquals(intercept[Fault](accept("nope")).code, "bad-envelope")
  }
  test("semantic invalid documents are accepted terminal outcomes with digest") {
    Vector("null", "{}", document("1e999999"), document(tail = ",\"links\":[[\"x\",\"bad\"]]")).foreach { raw =>
      val result = accept(raw)
      assertEquals(result.document.left.toOption.map(_.code), Some("invalid-document"))
      assertEquals(result.digest.format, OperationDigest.Format)
      assertEquals(result.digest.hex.length, 64)
      assertEquals(result.digest, accept(raw).digest)
      assertNotEquals(result.digest, accept(document()).digest)
    }
  }
  test("successful document carries canonical original text, not JSONB-normalized numbers") {
    val result = accept(document("{\"x\":1.00e2,\"y\":-0}"))
    assert(result.document.isRight)
    assert(result.documentCanonical.contains("1.00e2"))
    assert(result.documentCanonical.contains("-0"))
    assertEquals(result.document.toOption.get.tags, Vector.empty)
    assert(!result.documentCanonical.contains("\"tags\""))
  }
  test("typed fault carries revision without changing stable code/message") {
    val fault = Fault("conflict", "revision conflict", Some(3L))
    val throwable: Throwable = fault
    assertEquals(throwable.getMessage, "revision conflict")
    assertEquals(fault.currentRevision, Some(3L))
    assertEquals(fault.code, "conflict")
  }
}
