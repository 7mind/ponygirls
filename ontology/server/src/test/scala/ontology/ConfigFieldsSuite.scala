package ontology

import java.nio.charset.StandardCharsets.UTF_8
import munit.FunSuite
import ontology.api.ActorKind
import ontology.domain.Fault

final class ConfigFieldsSuite extends FunSuite {
  private def fields(text: String): ConfigFields = ConfigFields(Wire.parse(text.getBytes(UTF_8)), "config")
  test("objects require exact keys and nullable fields still require presence") {
    val valid = fields("""{"path":null,"enabled":true}""").exact(Set("path", "enabled"))
    assertEquals(valid.optionalPath("path"), None)
    assert(valid.boolean("enabled"))
    assertEquals(intercept[Fault](fields("""{"enabled":true}""").exact(Set("path", "enabled"))).code, "config")
    assertEquals(intercept[Fault](fields("""{"enabled":true,"extra":0}""").exact(Set("enabled"))).code, "config")
    assertEquals(intercept[Fault](fields("{}").optionalString("missing")).code, "config")
  }
  test("integer lexemes reject strings fractions exponents and range overflow") {
    List("\"1\"", "1.0", "1e3", "9223372036854775808").foreach { value =>
      assertEquals(intercept[Fault](fields(s"{\"n\":$value}").long("n")).code, "config")
    }
    assertEquals(fields("""{"n":9223372036854775807}""").long("n"), Long.MaxValue)
    assertEquals(intercept[Fault](fields("""{"n":2147483648}""").int("n")).code, "config")
    assertEquals(intercept[Fault](fields("""{"n":0}""").duration("n")).code, "config")
    assertEquals(intercept[Fault](fields("""{"n":9223372036854775807}""").duration("n")).code, "config")
  }
  test("paths enums and set inputs do not silently normalize or discard invalid values") {
    assertEquals(intercept[Fault](fields("""{"p":"relative"}""").absolutePath("p")).code, "config")
    assert(fields("""{"p":"/synthetic/not-required-to-exist"}""").absolutePath("p").isAbsolute)
    assertEquals(fields("""{"kind":"Service"}""").enumValue("kind", ActorKind.parse), ActorKind.Service)
    assertEquals(intercept[Fault](fields("""{"kind":" Service "}""").enumValue("kind", ActorKind.parse)).code, "config")
    assertEquals(intercept[Fault](fields("""{"scopes":["s","s"]}""").uniqueStrings("scopes")).code, "config")
  }
}
