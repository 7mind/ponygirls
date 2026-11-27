package haystack.auth

import haystack.domain.Fault
import ponygirls.auth.{AccountRefusal,AccountRefused}
import ponygirls.runtime.JdbcFailure

/** BA: a refusal of the shared account service becomes Haystack's `Fault` with today's code and message, and keeps the
  * sanitised cleanup failures the transaction engine attached to it. */
class AccountFaultTranslationTest extends munit.FunSuite {
  test("refusals become today's Faults and keep their suppressed cleanup failures") {
    val expected=Map(AccountRefusal.InvalidCredentials->("unauthorized","invalid credentials"),AccountRefusal.BrowserSessionRequired->("unauthorized","browser session required"),
      AccountRefusal.AuthorityChanged->("unauthorized","request authority changed"),AccountRefusal.InvalidTokenScopes->("forbidden","invalid token scopes"),
      AccountRefusal.ConfiguredTokenImmutable->("forbidden","configured tokens are immutable"))
    AccountRefusal.values.foreach { refusal=>
      val refused=AccountRefused(refusal)
      val rollback=JdbcFailure("database-rollback-failed",None);val close=JdbcFailure("database-close-failed",Some("08006"))
      refused.addSuppressed(rollback);refused.addSuppressed(close)
      val fault:Fault=AccountService.translated(refused)
      assertEquals((fault.code,fault.message),expected(refusal))
      assertEquals(fault.getSuppressed.toVector,Vector[Throwable](rollback,close))
    }
  }
}
