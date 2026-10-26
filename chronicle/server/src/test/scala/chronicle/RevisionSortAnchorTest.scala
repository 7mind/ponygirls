package chronicle

import io.circe.Json

class RevisionSortAnchorTest extends munit.FunSuite {
  test("BA specified: immutable revision references fingerprint complete exact keys in bounded JSON") {
    val keys=List(None,Some(""),Some("MiXeD Kİ𐐀"),Some("X"*50000))
    List(1,Int.MaxValue).foreach { revision => keys.foreach { key =>
      val anchor=RevisionSortAnchor.capture(revision,key)
      assertEquals(anchor.keyHash,Wire.hash(key.fold(Json.Null)(Json.fromString).noSpaces))
      val json=RevisionSortAnchor.encode(anchor)
      assert(json.noSpaces.length<100)
      assertEquals(RevisionSortAnchor.decode(json),anchor)
      assertEquals(RevisionSortAnchor.resolve(anchor,key),key)
    }}
    assertNotEquals(RevisionSortAnchor.capture(1,None).keyHash,RevisionSortAnchor.capture(1,Some("")).keyHash)
    assertNotEquals(RevisionSortAnchor.capture(1,Some("A")).keyHash,RevisionSortAnchor.capture(1,Some("a")).keyHash)
  }
  test("BA specified: references require exact arrays with canonical positive integer revisions and lowercase SHA256") {
    val hash=Json.fromString("a"*64)
    val invalid=List(Json.Null,Json.obj(),Json.arr(),Json.arr(Json.fromInt(1)),Json.arr(Json.fromInt(1),hash,Json.Null),
      Json.arr(Json.fromInt(0),hash),Json.arr(Json.fromInt(-1),hash),Json.arr(Json.fromLong(Int.MaxValue.toLong+1),hash),
      Json.arr(Json.fromString("1"),hash),Json.arr(Wire.parse("1.0"),hash),Json.arr(Wire.parse("1e0"),hash),
      Json.arr(Json.fromInt(1),Json.Null),Json.arr(Json.fromInt(1),Json.fromInt(1)),
      Json.arr(Json.fromInt(1),Json.fromString("A"*64)),Json.arr(Json.fromInt(1),Json.fromString("a"*63)),
      Json.arr(Json.fromInt(1),Json.fromString("a"*63+"\u0000")),Json.arr(Json.fromInt(1),Json.fromString("a"*63+'\ud800')))
    invalid.foreach { json => assertEquals(intercept[DomainError](RevisionSortAnchor.decode(json)).code,"invalid",json.noSpaces) }
  }
  test("BA specified: capture and encode reject invalid anchor invariants") {
    List(0,-1).foreach { revision => assertEquals(intercept[DomainError](RevisionSortAnchor.capture(revision,Some("key"))).code,"invalid") }
    List(RevisionSortAnchor(0,"a"*64),RevisionSortAnchor(1,"A"*64),RevisionSortAnchor(1,"short")).foreach { anchor =>
      assertEquals(intercept[DomainError](RevisionSortAnchor.encode(anchor)).code,"invalid")
    }
  }
  test("BA specified: changed or null-different resolved keys explicitly require a restart") {
    val anchor=RevisionSortAnchor.capture(1,Some("captured"))
    List(None,Some(""),Some("CAPTURED"),Some("replacement")).foreach { key =>
      val error=intercept[DomainError](RevisionSortAnchor.resolve(anchor,key))
      assertEquals(error.code,"conflict")
      assertEquals(error.detail,"sort cursor anchor changed; restart query")
    }
  }
}
