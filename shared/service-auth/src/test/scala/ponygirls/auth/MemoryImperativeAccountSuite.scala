package ponygirls.auth

final class MemoryImperativeAccountSuite extends ImperativeAccountContract {
  protected def withBackend(body: ImperativeBackend => Unit): Unit = {
    val users = new MemoryImperativeUsers
    val accounts = new MemoryAccounts
    body(new ImperativeBackend {
      private var open = false
      def transaction[A](work: (ImperativeUserRepository, AccountRepository) => A): A = {
        // A real backend has one connection: the contract must never open a transaction inside another.
        assert(!open, "nested transaction")
        open = true
        val (sessions, tokens) = (accounts.sessions, accounts.allTokens)
        try users.transaction(work(users, accounts))
        catch {
          case failure: Throwable =>
            accounts.sessions.foreach(row => accounts.deleteSession(row.digest))
            sessions.foreach(accounts.insertSession)
            accounts.allTokens.foreach(row => accounts.deleteToken(row.id))
            tokens.foreach(accounts.insertToken)
            throw failure
        } finally open = false
      }
    })
  }
}
