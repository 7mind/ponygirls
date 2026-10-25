package chronicle
class ProvenanceTest extends munit.FunSuite {
  test("BA: preserve valid Pi parent edge to raw metadata entry") {
    val request=Fixtures.snapshot(); SnapshotValidation.validate(request,Fixtures.config())
    assertEquals(request.messages.head.parentId,Some("meta"))
  }
  test("BA: reject out of bounds source record index") {
    val r=Fixtures.snapshot(); intercept[DomainError](SnapshotValidation.validate(r.copy(messages=r.messages.map(_.copy(recordIndex=999,parentId=None))),Fixtures.config()))
  }
  test("BA: reject nonexistent parent instead of deleting original edge") {
    val r=Fixtures.snapshot(); intercept[DomainError](SnapshotValidation.validate(r.copy(messages=r.messages.map(_.copy(parentId=Some("missing")))),Fixtures.config()))
  }
}
