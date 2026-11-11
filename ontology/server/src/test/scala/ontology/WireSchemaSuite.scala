package ontology

import baboon.runtime.shared.BaboonJsonCodec
import io.circe.Json
import munit.FunSuite
import ontology.api.*
import ontology.domain.Fault
import ontology.http.CompiledToolSchemas
import java.nio.charset.StandardCharsets.UTF_8
import scala.util.Using

final class WireSchemaSuite extends FunSuite {
  private def resource(name: String): Json = {
    val stream = Option(getClass.getResourceAsStream("/" + name)).getOrElse(fail("missing fixture " + name))
    val text = Using.resource(stream)(value => new String(value.readAllBytes(), UTF_8))
    io.circe.parser.parse(text).fold(throw _, identity)
  }
  private def roundtrip[A](codec: BaboonJsonCodec[A], input: Json): Unit = {
    val decoded = Wire.decode(codec, input)
    assertEquals(Wire.encode(codec, decoded), input)
  }
  test("actual TypeScript codec fixtures validate and roundtrip through Scala codecs") {
    val fixtures = resource("ontology-wire-fixtures.json").asArray.get
    val registry = resource("ontology-wire-plan.json").hcursor.downField("registry").focus.get.asArray.get
    assertEquals(fixtures.map(_.hcursor.get[String]("typeId").toOption.get).toSet, registry.map(_.hcursor.get[String]("typeId").toOption.get).toSet)
    fixtures.foreach { fixture =>
      val id = fixture.hcursor.get[String]("scalaTypeId").toOption.get
      val input = fixture.hcursor.downField("scalaWire").focus.get
      BaboonCodecsJson.find(id).value match {
        case codec: BaboonJsonCodec[?] => roundtrip(codec, input)
        case _ => fail("not a JSON codec: " + id)
      }
    }
  }
  test("production MCP schemas match the generated reachable wire schemas") {
    val schemas = new CompiledToolSchemas
    val numeric = schemas.apply.hcursor.downField("properties").downField("expectedGeneration").downField("anyOf").downN(1)
    assertEquals(numeric.downField("minimum").focus.flatMap(_.asNumber).flatMap(_.toBigInt), Some(BigInt(Long.MinValue)))
    assertEquals(numeric.downField("maximum").focus.flatMap(_.asNumber).flatMap(_.toBigInt), Some(BigInt(Long.MaxValue)))
    List("find" -> schemas.find, "read" -> schemas.read, "apply" -> schemas.apply).foreach { case (name, actual) =>
      assertEquals(actual, resource("ontology-mcp-" + name + ".json"))
      assertEquals(actual.hcursor.get[String]("type"), Right("object"))
    }
  }
  test("all i64 lexical variants reject before narrowing while negative zero remains supported") {
    def body(number: String): Json = Json.obj("scope" -> Json.fromString("fixture"), "requestId" -> Json.fromString(java.util.UUID.randomUUID().toString),
      "expectedGeneration" -> Json.fromString(number), "operations" -> Json.arr(), "contributionContext" -> Json.Null)
    List("01", "-01", "+1", " 1", "1 ", "0x10", "1e0", "").foreach { number =>
      assertEquals(intercept[Fault](Wire.decode(ApplyRequest.codecJson, body(number))).code, "bad-envelope")
    }
    assertEquals(Wire.decode(ApplyRequest.codecJson, body("-0")).expectedGeneration, 0L)
  }
}
