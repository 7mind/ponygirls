package chronicle
class IngestionBoundsTest extends munit.FunSuite {
  test("BA regression: large observed imports need the explicit 512MiB maximum, default remains 8MiB") {
    val c=Fixtures.config(); assertEquals(c.maxBodyBytes,8*1024*1024)
    c.copy(maxBodyBytes=512*1024*1024).validate()
    assertEquals(intercept[DomainError](c.copy(maxBodyBytes=512*1024*1024+1).validate()).code,"config")
    c.copy(maxBodyBytes=256*1024*1024,maxFileBytes=256*1024*1024,maxMessages=100000).validate()
  }
}
