package ontology

import munit.FunSuite
import ontology.api.*
import ontology.domain.*
import java.util.UUID
import java.nio.charset.StandardCharsets.UTF_8

final class StoredJsonSuite extends FunSuite {
  test("stored graph bytes may exceed a single admitted HTTP request") {
    val id = UUID.randomUUID()
    val snapshot = new AdmissionEngine().apply(Graph.empty("s"), ApplyRequest("s", id, 0L, List(Operation.Create("node", ontology.TestApplicability.unresolved, Content.Statement("x" * (Wire.MaxBodyBytes + 1), Modality.Assertion), Nil))), Admission(Actor("a", ActorKind.Agent), Actor("r", ActorKind.Service), id, "now")).snapshot
    val raw = StoredJson.encode(GraphSnapshot.codecJson, snapshot)
    assertEquals(StoredJson.decode(GraphSnapshot.codecJson, raw), snapshot)
    assertEquals(intercept[Fault](Wire.parse(raw.getBytes(UTF_8))).code, "bad-envelope")
  }
  test("canonical stored record roundtrip") {
    val value = Graph.empty("s")
    assertEquals(StoredJson.decode(GraphSnapshot.codecJson, StoredJson.encode(GraphSnapshot.codecJson, value)), value)
  }
  test("duplicate and unknown fields are storage faults") {
    val raw = StoredJson.encode(GraphSnapshot.codecJson, Graph.empty("s"))
    val duplicate = "{\"scope\":\"ignored\"," + raw.drop(1)
    val extra = "{\"extra\":true," + raw.drop(1)
    List(duplicate, extra, "not json").foreach { text => assertEquals(intercept[Fault](StoredJson.decode(GraphSnapshot.codecJson, text)).code, "corrupt") }
  }
  test("network admission still rejects duplicate keys and invalid UTF8") {
    assertEquals(intercept[Fault](Wire.parse("{\"scope\":\"a\",\"scope\":\"b\"}".getBytes(UTF_8))).code, "bad-envelope")
    assertEquals(intercept[Fault](Wire.parse(Array(0xc3.toByte, 0x28.toByte))).code, "bad-envelope")
  }
}
