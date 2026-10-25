package chronicle
import chronicle.api.*
import java.util.UUID
class CoreTest extends munit.FunSuite {
  test("BA: private HTTP is denied by default and explicitly permitted without relaxing HTTPS or loopback rules") {
    val local=Fixtures.config()
    local.validate()
    val remote=local.copy(listenHost="0.0.0.0",allowedOrigin="http://192.168.50.10:47330")
    assertEquals(intercept[DomainError](remote.validate()).code,"config")
    remote.copy(allowInsecureHttp=true).validate()
    assertEquals(intercept[DomainError](remote.copy(allowInsecureHttp=true,secureCookies=true).validate()).code,"config")
    remote.copy(allowedOrigin="https://chronicle.example.net",secureCookies=true).validate()
    assertEquals(intercept[DomainError](remote.copy(allowedOrigin="https://chronicle.example.net",allowInsecureHttp=true).validate()).code,"config")
    assertEquals(intercept[DomainError](local.copy(listenHost="0.0.0.0").validate()).code,"config")
    List("http://192.168.50.10/path","http://user@192.168.50.10","http://192.168.50.10?x=1","http://192.168.50.10#x","http:///missing","ftp://192.168.50.10").foreach { origin =>
      assertEquals(intercept[DomainError](remote.copy(allowedOrigin=origin,allowInsecureHttp=true).validate()).code,"config")
    }
  }
  test("BG: runtime JSON defaults insecure HTTP opt-in to false and requires an explicit boolean") {
    val example=Wire.parse(java.nio.file.Files.readString(java.nio.file.Path.of("config.example.json"))).asObject.get.remove("allowInsecureHttp")
    val omitted=io.circe.Json.fromJsonObject(example).as[Config].toOption.get
    assert(!omitted.allowInsecureHttp)
    val remote=example.add("allowedOrigin",io.circe.Json.fromString("http://192.168.50.10:47330"))
    assertEquals(intercept[DomainError](io.circe.Json.fromJsonObject(remote).as[Config].toOption.get.validate()).code,"config")
    io.circe.Json.fromJsonObject(remote.add("allowInsecureHttp",io.circe.Json.True)).as[Config].toOption.get.validate()
    List(io.circe.Json.Null,io.circe.Json.fromString("true"),io.circe.Json.fromInt(1)).foreach { value =>
      assert(io.circe.Json.fromJsonObject(remote.add("allowInsecureHttp",value)).as[Config].isLeft)
    }
  }
  test("BA: credential-file relocation does not change model profile identity") {
    val c=Fixtures.config(); assertEquals(c.profile,c.copy(annotation=c.annotation.copy(credentialFile="/relocated",timeoutSeconds=99),embedding=c.embedding.copy(credentialFile="/relocated",timeoutSeconds=99)).profile)
  }
  test("BA: model profile separates revision dimensions prefix and endpoint identities") {
    val c=Fixtures.config()
    List(c.copy(annotation=c.annotation.copy(revision="v2")),c.copy(embedding=c.embedding.copy(revision="v2")),c.copy(embedding=c.embedding.copy(dimensions=4)),c.copy(embedding=c.embedding.copy(queryPrefix="different")),c.copy(annotation=c.annotation.copy(endpoint="http://different/chat"))).foreach(n => assert(n.profile!=c.profile))
  }
  test("BA: password helper verifies only the original password") {
    val h = Password.hash("synthetic password".toCharArray)
    assert(Password.verify("synthetic password".toCharArray,h)); assert(!Password.verify("wrong".toCharArray,h))
  }
  test("BA: generated ADT codec round trips Unicode and optionals") {
    val e = ClientEnvelope(UUID.randomUUID(), Operation.Search(SearchQuery("λ🐎", SearchMode.Lexical, SearchFilter(None,None,None,None,Nil),20,0)))
    assertEquals(Wire.decode(ClientEnvelope.codecJson, Wire.encode(ClientEnvelope.codecJson,e)),e)
  }
  test("BA: split spans exhaust UTF8 messages without overlap") {
    val m = Message("m",None,"user",("λ🐎" * 2000),None,0)
    val chunks = Fragments.split(List(m))
    assertEquals(chunks.map(_.text).mkString,m.text)
    assertEquals(chunks.head.spans.head.start,0)
    assertEquals(chunks.last.spans.head.end,m.text.getBytes(java.nio.charset.StandardCharsets.UTF_8).length)
    assert(chunks.sliding(2).forall(p => p.size < 2 || p.head.spans.head.end == p.last.spans.head.start))
  }
}
