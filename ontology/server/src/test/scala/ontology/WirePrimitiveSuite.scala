package ontology

import io.circe.Json
import java.util.UUID
import munit.FunSuite
import ontology.api.*
import ontology.domain.Fault

final class WirePrimitiveSuite extends FunSuite {
  private def applyRequest(generation: Json): Json = Json.obj("scope" -> Json.fromString("fixture"),
    "requestId" -> Json.fromString(UUID.randomUUID().toString), "expectedGeneration" -> generation,
    "operations" -> Json.arr(), "contributionContext" -> Json.Null)
  private def reference(revision: Json, id: String): Json = Json.obj("id" -> Json.fromString(id), "revision" -> revision)

  test("signed i64 endpoints preserve exact values in canonical strings and numeric JSON") {
    List(BigInt(Long.MinValue), BigInt(Long.MaxValue)).foreach { value =>
      List(Json.fromString(value.toString), Json.fromBigInt(value)).foreach { json =>
        assertEquals(Wire.decode(ApplyRequest.codecJson, applyRequest(json)).expectedGeneration, value.longValue)
      }
    }
  }
  test("i64 overflow is rejected before a generated decoder can narrow it") {
    List(BigInt(Long.MinValue) - 1, BigInt(Long.MaxValue) + 1).foreach { value =>
      List(Json.fromString(value.toString), Json.fromBigInt(value)).foreach { json =>
        assertEquals(intercept[Fault](Wire.decode(ApplyRequest.codecJson, applyRequest(json))).code, "bad-envelope")
      }
    }
  }
  test("i32 overflow is rejected before a generated decoder can narrow it") {
    List(BigInt(Int.MinValue) - 1, BigInt(Int.MaxValue) + 1).foreach { value =>
      assertEquals(intercept[Fault](Wire.decode(Ref.codecJson, reference(Json.fromBigInt(value), UUID.randomUUID().toString))).code, "bad-envelope")
    }
  }
  test("i32 fields require numeric JSON rather than decoder string coercion") {
    assertEquals(intercept[Fault](Wire.decode(Ref.codecJson, reference(Json.fromString("1"), UUID.randomUUID().toString))).code, "bad-envelope")
  }
  test("UUID fields reject abbreviated non-wire spellings") {
    assertEquals(intercept[Fault](Wire.decode(Ref.codecJson, reference(Json.fromInt(1), "1-1-1-1-1"))).code, "bad-envelope")
  }
  test("raw decimal and exponent fractions cannot round into integer fields") {
    List("1.00000000000000001", "1e-999", "-1e-999", "2147483647.0000000001").foreach { token =>
      val ref = s"""{"id":"${UUID.randomUUID()}","revision":$token}"""
      val request = applyRequest(Json.fromInt(0)).noSpaces.replace("\"expectedGeneration\":0", "\"expectedGeneration\":" + token)
      assertEquals(intercept[Fault](Wire.decode(Ref.codecJson, Wire.parse(ref.getBytes(java.nio.charset.StandardCharsets.UTF_8)))).code, "bad-envelope")
      assertEquals(intercept[Fault](Wire.decode(ApplyRequest.codecJson, Wire.parse(request.getBytes(java.nio.charset.StandardCharsets.UTF_8)))).code, "bad-envelope")
    }
  }
  test("line terminators inside integer and UUID strings are not accepted") {
    List("\n", "\r", "\u2028", "\u2029").foreach { ending =>
      assertEquals(intercept[Fault](Wire.decode(Ref.codecJson, reference(Json.fromInt(1), UUID.randomUUID().toString + ending))).code, "bad-envelope")
      assertEquals(intercept[Fault](Wire.decode(ApplyRequest.codecJson, applyRequest(Json.fromString("1" + ending)))).code, "bad-envelope")
    }
  }
  test("wrong booleans and fractional integers remain invalid") {
    assertEquals(intercept[Fault](Wire.decode(Ack.codecJson, Json.obj("ok" -> Json.fromString("true")))).code, "bad-envelope")
    assertEquals(intercept[Fault](Wire.decode(Ref.codecJson, reference(Json.fromBigDecimal(BigDecimal("1.5")), UUID.randomUUID().toString))).code, "bad-envelope")
  }
}
