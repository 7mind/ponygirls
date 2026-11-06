package chronicle

final class RelocatedModelIdentityTest extends munit.FunSuite {
  test("Blackbox GoodCommunication regression: identity approval plans are exact, explicit and bounded") {
    import io.circe.Json
    import java.nio.file.Files
    val file=Files.createTempFile("model-identity-plan-",".json")
    val valid=Json.obj("version"->Json.fromString("model-identity-migration-v2"),"legacyProfiles"->Json.arr(Json.fromString("a"*64)),"retainedProfiles"->Json.arr(),"canonicalProfile"->Json.fromString("b"*64))
    def load(json: Json): ModelIdentityPlan = { Files.writeString(file,json.noSpaces); ModelIdentityPlan.load(file.toString) }
    try {
      assertEquals(load(valid),ModelIdentityPlan(Set("a"*64),Vector.empty,"b"*64))
      val retained=Json.obj("profile"->Json.fromString("c"*64),"embeddingSpace"->Json.fromString("d"*64),"policy"->Json.fromString("ContiguousPassagesV1"),"descriptorSha256"->Json.fromString("e"*64))
      val readOnly=valid.mapObject(_.add("legacyProfiles",Json.arr()).add("retainedProfiles",Json.arr(retained)))
      assertEquals(load(readOnly),ModelIdentityPlan(Set.empty,Vector(RetainedReadApproval("c"*64,"d"*64,ReadableIndexPolicy.ContiguousPassagesV1,"e"*64)),"b"*64))
      val malformed=List(retained.mapObject(_.remove("policy")),retained.mapObject(_.add("extra",Json.True)),retained.mapObject(_.add("policy",Json.fromString("unknown"))),retained.mapObject(_.add("embeddingSpace",Json.fromString("not-a-hash"))),retained.mapObject(_.add("descriptorSha256",Json.fromString("not-a-hash"))),retained.mapObject(_.add("profile",Json.fromString("a"*64))))
      malformed.foreach(value=>assertEquals(intercept[DomainError](load(valid.mapObject(_.add("retainedProfiles",Json.arr(value))))).code,"invalid"))
      List(valid.mapObject(_.remove("retainedProfiles")),valid.mapObject(_.add("version",Json.fromString("model-identity-migration-v1"))),valid.mapObject(_.add("retainedProfiles",Json.arr(retained,retained))),valid.mapObject(_.add("legacyProfiles",Json.arr((1 to 129).map(value=>Json.fromString(f"$value%064x"))*)))).foreach(value=>assertEquals(intercept[DomainError](load(value)).code,"invalid"))
      List(Json.Null,valid.mapObject(_.remove("version")),valid.mapObject(_.add("endpoint",Json.fromString("transport is not an approval"))),valid.mapObject(_.add("legacyProfiles",Json.arr())),valid.mapObject(_.add("legacyProfiles",Json.arr(Json.fromString("a"*64),Json.fromString("a"*64)))),valid.mapObject(_.add("canonicalProfile",Json.fromString("not-a-hash")))).foreach { json=>
        assertEquals(intercept[DomainError](load(json)).code,"invalid")
      }
      Files.writeString(file," "*32769)
      assertEquals(intercept[DomainError](ModelIdentityPlan.load(file.toString)).code,"invalid")
    } finally Files.delete(file)
  }
  test("Whitebox Atomic regression: standby does not even construct a background worker action") {
    Main.background(false,throw new AssertionError("standby constructed indexing workers"))
    var constructed=false
    Main.background(true,{ constructed=true; cats.effect.IO.unit })
    assert(constructed)
  }
  test("Blackbox Atomic regression: relocating model transports preserves artifact and index identity") {
    val original = Fixtures.config()
    val relocated = original.copy(
      embedding = original.embedding.copy(endpoint = "http://embedding:8000/v1/embeddings"),
      annotation = original.annotation.copy(endpoint = "https://relocated.synthetic.invalid/v1/chat/completions"),
    )
    assertEquals(EmbeddingSpaceDescriptor.from(relocated.embedding).id, EmbeddingSpaceDescriptor.from(original.embedding).id)
    assertEquals(IndexProfileCatalog.current(relocated).preferred.profile, IndexProfileCatalog.current(original).preferred.profile)
  }
}
