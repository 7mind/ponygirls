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
}
