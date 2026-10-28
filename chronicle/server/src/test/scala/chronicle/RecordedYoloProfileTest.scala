package chronicle

class RecordedYoloProfileTest extends munit.FunSuite {
  import RecordedYoloProfileTest.*
  test("BA: recorded yolo profile uses exact case-preserving whole-root claims, not tags or prose") {
    cases.foreach { fixture => assertEquals(RecordedYoloProfile.fromRootId(fixture.rootId),fixture.profile,fixture.rootId) }
    val request=Fixtures.snapshot()
    val misleading=request.copy(source=request.source.copy(discoveryRootId="native"),metadata=request.metadata.copy(title="yolo:pretend",tags=List("yolo-profile:pretend")))
    assertEquals(RecordedYoloProfile.fromRootId(misleading.source.discoveryRootId),None)
  }
}
private[chronicle] object RecordedYoloProfileTest {
  final case class ProfileCase(rootId: String,profile: Option[String])
  given io.circe.Decoder[ProfileCase] = io.circe.Decoder.forProduct2("rootId","profile")(ProfileCase.apply)
  def cases: List[ProfileCase] = io.circe.parser.decode[List[ProfileCase]](java.nio.file.Files.readString(java.nio.file.Path.of("tests/recorded-yolo-profile-cases.json"))).toOption.get
}
