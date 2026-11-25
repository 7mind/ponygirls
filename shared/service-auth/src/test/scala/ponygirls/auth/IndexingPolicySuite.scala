package ponygirls.auth

final class IndexingPolicySuite extends munit.FunSuite {
  import IndexingChoice.*

  test("indexing flags are optional and reject non-boolean values") {
    import io.circe.Json
    def decode(fields: (String, Json)*) = IndexingPolicy.decode(Json.obj(fields*).hcursor)
    assertEquals(decode(), Right(IndexingPolicy.defaults))
    assertEquals(decode("indexing" -> Json.obj("annotationSessions" -> Json.fromInt(4),
      "defaultEnabled" -> Json.False, "allowOptIn" -> Json.True, "allowOptOut" -> Json.True)),
      Right(IndexingPolicy(false, true, true)))
    assert(decode("indexing" -> Json.Null).isLeft)
    for (key <- List("defaultEnabled", "allowOptIn", "allowOptOut"); bad <- List(Json.Null, Json.fromString("true"), Json.fromInt(0)))
      assert(decode("indexing" -> Json.obj(key -> bad)).isLeft, key)
  }

  test("accounts without a preference follow the configured default") {
    assert(IndexingPolicy(true, false, false).enabled(Inherit, Inherit))
    assert(!IndexingPolicy(false, false, false).enabled(Inherit, Inherit))
  }

  test("the opt-in and opt-out switches govern their respective explicit choices") {
    for {
      defaultEnabled <- List(false, true)
      allowOptIn <- List(false, true)
      allowOptOut <- List(false, true)
    } {
      val policy = IndexingPolicy(defaultEnabled, allowOptIn, allowOptOut)
      assertEquals(policy.permitsOpt(true, Inherit), allowOptIn)
      assertEquals(policy.permitsOpt(false, Inherit), allowOptOut)
    }
    val on = IndexingPolicy(true, false, true)
    assert(on.permitsOpt(false, Inherit))
    assert(!on.enabled(Disable, Inherit))
    val off = IndexingPolicy(false, true, false)
    assert(off.permitsOpt(true, Inherit))
    assert(off.enabled(Enable, Inherit))
  }

  test("admin overrides win over the default and a conflicting user choice, regardless of self-service flags") {
    for {
      defaultEnabled <- List(false, true)
      allowOptIn <- List(false, true)
      allowOptOut <- List(false, true)
      userChoice <- IndexingChoice.values
    } {
      val policy = IndexingPolicy(defaultEnabled, allowOptIn, allowOptOut)
      assert(policy.enabled(userChoice, Enable))
      assert(!policy.enabled(userChoice, Disable))
      for (enabling <- List(false, true); forced <- List(Enable, Disable))
        assert(!policy.permitsOpt(enabling, forced))
    }
  }

  test("clearing an override restores the user's choice instead of resetting it") {
    val on = IndexingPolicy(true, true, true)
    assert(on.enabled(Disable, Enable))
    assert(!on.enabled(Disable, Inherit))
    val off = IndexingPolicy(false, true, true)
    assert(!off.enabled(Enable, Disable))
    assert(off.enabled(Enable, Inherit))
  }
}
