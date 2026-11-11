package manure

import munit.FunSuite
import java.nio.file.Files
import manure.{api => wire}

/** Specified-origin BA: current codec/validation, no external state. */
final class DomainSuite extends FunSuite:
  test("canonical token and strict credential byte rules preserve original hashes") {
    val token = "A"*43
    assert(SecretCodec.canonical(token)); assert(!SecretCodec.canonical("A"*42+"B"))
    Vector(" "+token,token+" ","\""+token+"\"",token+"=",token+"\n").foreach(v => assert(!SecretCodec.canonical(v)))
    assert(SecretCodec.verify(token,SecretCodec.sha256(token)))
    assertEquals(Cookies.parse(Some(" x= first; x=second; y=\"quoted\"")),Map("x" -> " first","y" -> "\"quoted\""))
    assertEquals(Cookies.sessionName(false,false),"__Host-manure")
    assertEquals(Cookies.grantName(false,false,"a"*32,true),"__Secure-mgrant-"+"a"*32)
  }
  test("metadata UTF8 NUL and IEEE754 timestamp bits roundtrip without normalization") {
    Vector("a\u0000b","é","e\u0301","馬💩","𐐀").foreach(v => assertEquals(Exact.string(Exact.utf8(v)),v))
    Vector(0.0,-0.0,1700000000.125,Math.nextUp(1700000000.125),Double.MinPositiveValue,Double.MaxValue).foreach { v =>
      assertEquals(java.lang.Double.doubleToRawLongBits(Exact.timestamp(Exact.timestamp(v))),java.lang.Double.doubleToRawLongBits(v))
    }
    assert(Exact.compare("\ue000","𐀀") < 0) // UTF8 byte/codepoint, NOT JVM UTF16 order.
    assertEquals(Exact.matching("Straße Σ İ"),"strasse σ i\u0307")
    assert(Exact.matching("Straße").contains("strasse")) // Normative full fold, not ROOT lowercase.
  }
  test("manifest canonical path and topology bounds reject every traversal form") {
    Vector("","/x","C:x","a\\b","a//b","a/",".","..","a/../b","a/./b","api/x","__manure/x","a\u0000b","a\nb","a\u007fb",("x/"*64)+"x").foreach(v => intercept[DomainError](Manifest.path(v)))
    Manifest.path("résumé/馬💩.txt"); Manifest.path("%2e%2e")
    val limits = Limits()
    val file = ManifestEntry("f",false,1,"a"*64)
    intercept[DomainError](Manifest.validate(Vector(file,file),ArtifactKind.Directory,limits))
    intercept[DomainError](Manifest.validate(Vector(file,ManifestEntry("f/x",true)),ArtifactKind.Directory,limits))
    intercept[DomainError](Manifest.validate(Vector(ManifestEntry("dir",true,1,"")),ArtifactKind.Directory,limits))
    assertEquals(Manifest.validate(Vector(ManifestEntry("empty",true)),ArtifactKind.Directory,limits),0L)
  }
  test("chunk alignment, tail, overflow and single byte ranges remain bounded") {
    val l = Limits(); UploadRules.chunk(1048577L,1048576L,1,l); UploadRules.chunk(2,0,2,l)
    Vector((2L,1L,1),(1048577L,1L,1048576),(1L,0L,0),(Long.MaxValue,Long.MaxValue,1)).foreach((s,o,n) => intercept[DomainError](UploadRules.chunk(s,o,n,l)))
    assertEquals(UploadRules.range("bytes=1-2",4),(1L,3L)); assertEquals(UploadRules.range("bytes=-100",4),(0L,4L))
    Vector("bytes=","bytes=0-0,2-2","bytes=-0","bytes=4-","bytes=2-1","bytes=0-9223372036854775807").foreach(h => intercept[DomainError](UploadRules.range(h,4)))
  }
  test("explicit metadata uses scalar bounds, exact unique tags and ECMAScript nonblank strings") {
    val tags=Vector(" release ","Release","release","nul\u0000value","𐀀"*128)
    MetadataRules.validate(tags,Some("𐀀"*253),Some("𐀀"*4096))
    assertEquals(MetadataRules.decodeTags(MetadataRules.encodeTags(tags)),tags)
    MetadataRules.validate(Vector("\u0085"),Some(" Host "),Some(" /project "))
    val invalid=Vector(
      (Vector.fill(33)("tag"),None,None), (Vector("x","x"),None,None),
      (Vector(""),None,None), (Vector("\u00a0\ufeff"),None,None), (Vector("𐀀"*129),None,None),
      (Vector("\ud800"),None,None), (Vector.empty,Some("\ufeff"),None),
      (Vector.empty,Some("𐀀"*254),None), (Vector.empty,None,Some(" \t\u3000")),
      (Vector.empty,None,Some("𐀀"*4097)))
    invalid.foreach { (tags,hostname,projectPath) =>
      assertEquals(intercept[DomainError](MetadataRules.validate(tags,hostname,projectPath)).code,"bad-envelope")
    }
  }
  test("current Baboon fixtures roundtrip all 76 Scala/TS/Python golden vectors") {
    val fixtures = BackendFixture.source.resolve("manure/models/fixtures")
    var count = 0
    def check[A](file: String,codec: baboon.runtime.shared.BaboonJsonCodec[A]): Unit =
      val values = CurrentWire.parse(Files.readString(fixtures.resolve(file))).asArray.get
      values.foreach { value =>
        val decoded = CurrentWire.decode(codec,value)
        assertEquals(CurrentWire.encode(codec,decoded),value); count += 1
      }
    check("commands.json",wire.ClientEnvelope.codecJson); check("results.json",wire.ServerEnvelope.codecJson)
    check("content.json",wire.ContentEnvelope.codecJson); check("chunks.json",wire.ChunkReceipt.codecJson)
    assertEquals(count,76)
  }
  test("duplicate keys, unknown fields, versions and non-string i64 rejected closed") {
    intercept[DomainError](CurrentWire.parse("{\"x\":1,\"x\":2}"))
    val command = CurrentWire.parse("""{"requestId":"01234567-89ab-4def-8123-456789abcdef","apiVersion":"0.0.0","command":{"Version":{}}}""")
    assertEquals(intercept[DomainError](CurrentWire.command(command)).code,"unsupported-version")
    intercept[DomainError](CurrentWire.command(command.mapObject(_.add("apiVersion",io.circe.Json.fromString("1.0.0")).add("unknown",io.circe.Json.True))))
    intercept[DomainError](CurrentWire.decode(wire.ChunkReceipt.codecJson,CurrentWire.parse("""{"path":"x","offset":0,"length":1,"receivedBytes":"1"}""")))
  }
