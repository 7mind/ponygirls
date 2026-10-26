package chronicle
import chronicle.api.*
import java.util.UUID
class AnnotationTest extends munit.FunSuite {
  private val fragments = Fragments.split(List(Message("m1",None,"user","first",None,0),Message("m2",Some("m1"),"assistant","second",None,1)))
  test("BA: model selects semantic boundary while source text/spans remain authoritative") {
    val joined = AnnotationPartition.project(fragments,Wire.parse("""{"chunks":[{"first":0,"last":1,"summary":"both","tags":["topic"]}]}"""))
    assertEquals(joined.size,1); assertEquals(joined.head.text,"first\nsecond"); assertEquals(joined.head.spans,fragments.flatMap(_.spans))
  }
  test("BA regression: contiguous UTF8 fragments of one message retain exact text and original spans") {
    val text="α" * 1100
    val source=Fragments.split(List(Message("long",None,"user",text,None,0)))
    val joined=AnnotationPartition.project(source,Wire.parse("""{"chunks":[{"first":0,"last":1,"summary":"x","tags":[]}]}"""))
    assertEquals(joined.head.text,text); assertEquals(joined.head.spans,source.flatMap(_.spans))
    assertEquals(joined.head.spans.map(s => s.end-s.start).sum,text.getBytes(java.nio.charset.StandardCharsets.UTF_8).length)
  }
  List(
    "gap" -> """{"chunks":[{"first":1,"last":1,"summary":"x","tags":[]}]}""",
    "overlap" -> """{"chunks":[{"first":0,"last":1,"summary":"x","tags":[]},{"first":1,"last":1,"summary":"x","tags":[]}]}""",
    "out of bounds" -> """{"chunks":[{"first":0,"last":2,"summary":"x","tags":[]}]}""",
    "malicious reference" -> """{"chunks":[{"first":0,"last":1,"summary":"x","tags":[],"ref":"secret-session"}]}"""
  ).foreach { case (name,json) => test(s"BA: reject partition $name") { intercept[DomainError](AnnotationPartition.project(fragments,Wire.parse(json))) } }
  private def metadata(summary: String,tags: List[String]): io.circe.Json = io.circe.Json.obj("chunks"->io.circe.Json.arr(io.circe.Json.obj("first"->io.circe.Json.fromInt(0),"last"->io.circe.Json.fromInt(1),"summary"->io.circe.Json.fromString(summary),"tags"->io.circe.Json.arr(tags.map(io.circe.Json.fromString)*))))
  test("BA: schema character bounds count Unicode scalars not UTF16 units") {
    assertEquals(AnnotationPartition.project(fragments,metadata("🙂"*1000,List("🙂"*64))).head.summary,"🙂"*1000)
    List(metadata("🙂"*1001,Nil),metadata("x",List("🙂"*65)),metadata("x",List.fill(17)("tag"))).foreach(json => assertEquals(intercept[DomainError](AnnotationPartition.project(fragments,json)).code,"model-output"))
  }
  test("BA regression: generated metadata rejects PostgreSQL NUL and unpaired surrogates") {
    List("\u0000",new String(Array(0xd800.toChar)),new String(Array(0xdc00.toChar))).foreach { invalid =>
      List(metadata(invalid,Nil),metadata("x",List(invalid))).foreach(json => assertEquals(intercept[DomainError](AnnotationPartition.project(fragments,json)).code,"model-output"))
    }
  }

}
