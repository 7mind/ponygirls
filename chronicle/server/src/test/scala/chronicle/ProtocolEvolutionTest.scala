package chronicle

import chronicle.api.*

class ProtocolEvolutionTest extends munit.FunSuite {
  test("BA specified: version info advertises exactly the generated current API") {
    assertEquals(ClientEnvelope.baboonDomainVersion,"1.9.0")
    assertEquals(Wire.versions,VersionInfo("1.9.0","1.9.0",List("1.9.0")))
    assertEquals(Wire.negotiate(List("1.0.0","1.9.0","2.0.0")),"1.9.0")
  }

  test("BA specified: negotiation rejects all removed versions and future-only offers") {
    ((0 to 8).map(minor => List(s"1.$minor.0")) ++ List(List("2.0.0"),Nil)).foreach { offered =>
      assertEquals(intercept[DomainError](Wire.negotiate(offered)).code,"version-mismatch")
    }
  }
}
