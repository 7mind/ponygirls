package chronicle

class ReadSourcesTest extends munit.FunSuite {
  test("BA: unrestricted materialization never evaluates numeric source work") {
    ReadMaterialization.unrestricted.admit(throw new AssertionError("ordinary flow evaluated a preflight"))
  }
  test("BA: numeric preflight totals are exact nonnegative Longs, never truncated or wrapped") {
    assertEquals(ReadSources.checked(new java.math.BigDecimal(Long.MaxValue)),Long.MaxValue)
    assertEquals(ReadSources.checked(java.math.BigDecimal.ZERO),0L)
    List("-1","0.5","9223372036854775808").foreach { value =>
      assertEquals(intercept[DomainError](ReadSources.checked(new java.math.BigDecimal(value))).code,"read-budget")
    }
    assertEquals(ReadSources.sum(List(1L,2L,3L)),6L)
    List(List(-1L),List(Long.MaxValue,1L)).foreach(values => assertEquals(intercept[DomainError](ReadSources.sum(values)).code,"read-budget"))
  }
}
