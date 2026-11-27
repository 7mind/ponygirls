package ponygirls.auth.boundary

/** BA: Blabber's declared-id rule (an id is the owner part of a chat handle); token ids and logins as Haystack's. */
final class BlabberIdRulesSuite extends munit.FunSuite {
  private val rules = DeclaredIdRules.Blabber
  test("a declared id is one lower-case letter or digit, then up to 31 of letters, digits, dot, underscore and hyphen") {
    Vector("a", "0", "alice", "ci", "a.b_c-d", "a" * 32, "9lives").foreach(id => assert(rules.userId(id, admin = false), id))
    Vector("", "Alice", "-a", ".a", "_a", "a" * 33, "a b", "a:b", "a/b", "al\u00efce", "a\n").foreach(id => assert(!rules.userId(id, admin = false), id))
    assertEquals(rules.userId("a" * 33, admin = true), false)
  }
  test("token ids and logins follow Haystack's rules") {
    Vector("laptop", "x" * 64, "x" * 65, "a b", "a:b", "").foreach(id => assertEquals(rules.tokenId(id), DeclaredIdRules.Haystack.tokenId(id), id))
    Vector("alice", " alice", "Alice Smith", "a\u0001", "").foreach(login => assertEquals(rules.login(login), DeclaredIdRules.Haystack.login(login), login))
  }
}
