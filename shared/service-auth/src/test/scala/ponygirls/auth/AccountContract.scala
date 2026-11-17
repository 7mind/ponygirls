package ponygirls.auth

import java.time.Instant
import scala.collection.mutable

abstract class AccountContract extends munit.FunSuite {
  protected def withRepository(body: AccountRepository => Unit): Unit
  private lazy val passwordHash = Password.hash("synthetic-account-password".toCharArray)
  protected def users: Vector[AccountUser] = Vector(
    AccountUser("alice", "human", "Alice", Some("alice"), Some(passwordHash), true, AccountOrigin.Declarative),
    AccountUser("bob", "human", "Bob", Some("bob"), Some(passwordHash), true, AccountOrigin.Declarative),
    AccountUser("agent", "agent", "Agent", None, None, true, AccountOrigin.Declarative))
  private def merged: Vector[AccountUser] =
    users :+ AccountUser("carol", "human", "Carol", Some("carol"), Some(passwordHash), true, AccountOrigin.Imperative)

  private def rejected(code: String)(body: => Any): Unit = assertEquals(intercept[AccountFailure](body).code, code)

  test("BG specified: password login creates a distinct durable browser-only credential") {
    withRepository { repository =>
      val accounts = new Accounts(repository)
      val session = accounts.login(users, "alice", "synthetic-account-password")
      assertEquals(accounts.browser(users, session.secret), Some(session.credential))
      assertEquals(accounts.bearer(users, session.secret), None)
      assertEquals(session.credential.userId, "alice")
      assert(session.credential.browser)
      assert(!session.toString.contains(session.secret))
      accounts.reconcile(users)
      val restarted = new Accounts(repository)
      assertEquals(restarted.browser(users, session.secret), Some(session.credential))
      assertEquals(repository.session(session.credential.digest).get.passwordIdentity, Secrets.digest(passwordHash))
    }
  }

  test("BG specified: logout revokes a copied session without revoking API credentials or other sessions") {
    withRepository { repository =>
      val accounts = new Accounts(repository)
      val first = accounts.login(users, "alice", "synthetic-account-password")
      val second = accounts.login(users, "alice", "synthetic-account-password")
      val issued = accounts.issue(users, first.credential, "Synthetic client")
      accounts.logout(users, first.secret)
      assertEquals(accounts.browser(users, first.secret), None)
      assert(accounts.browser(users, second.secret).nonEmpty)
      assert(accounts.bearer(users, issued.secret).nonEmpty)
      rejected("unauthorized")(accounts.issue(users, first.credential, "Stale session"))
      rejected("unauthorized")(accounts.logout(users, first.secret))
    }
  }

  test("BG specified: atomic cross-account login replaces only the presented valid session") {
    withRepository { repository =>
      val accounts = new Accounts(repository)
      val alice = accounts.login(users, "alice", "synthetic-account-password")
      val independent = accounts.login(users, "alice", "synthetic-account-password")
      val bearer = accounts.issue(users, alice.credential, "Alice client")
      val bob = accounts.loginReplacing(users, "bob", "synthetic-account-password", Some(alice.secret))
      assertEquals(bob.replaced, Some(alice.credential))
      assertEquals(bob.session.credential.userId, "bob")
      assertEquals(accounts.browser(users, alice.secret), None)
      assert(accounts.browser(users, bob.session.secret).nonEmpty)
      assert(accounts.browser(users, independent.secret).nonEmpty)
      assert(accounts.bearer(users, bearer.secret).nonEmpty)
      assert(!bob.toString.contains(bob.session.secret))
    }
  }

  test("BG specified: failed replacement preserves the old session and stale cookies cannot block password login") {
    withRepository { repository =>
      val accounts = new Accounts(repository)
      val alice = accounts.login(users, "alice", "synthetic-account-password")
      rejected("unauthorized")(accounts.loginReplacing(users, "bob", "wrong", Some(alice.secret)))
      assertEquals(accounts.browser(users, alice.secret), Some(alice.credential))
      val bob = accounts.loginReplacing(users, "bob", "synthetic-account-password", Some("stale-cookie"))
      assertEquals(bob.replaced, None)
      assert(accounts.browser(users, alice.secret).nonEmpty)
      assert(accounts.browser(users, bob.session.secret).nonEmpty)
    }
  }

  test("BG specified: session validity has no idle or absolute clock boundary") {
    withRepository { repository =>
      val accounts = new Accounts(repository)
      val session = accounts.login(users, "alice", "synthetic-account-password")
      assert(accounts.browser(users, session.secret).nonEmpty)
      val future = new Accounts(repository, java.time.Clock.fixed(Instant.parse("2999-01-01T00:00:00Z"), java.time.ZoneOffset.UTC))
      assertEquals(future.browser(users, session.secret), Some(session.credential))
    }
  }

  test("BG specified: only human passwords log in, malformed and wrong credentials fail without state") {
    withRepository { repository =>
      val accounts = new Accounts(repository)
      Vector(("alice", "wrong"), ("missing", "synthetic-account-password"), ("agent", "synthetic-account-password")).foreach { case (login, password) =>
        rejected("unauthorized")(accounts.login(users, login, password))
      }
      rejected("invalid")(accounts.login(users, "alice", "x" * 1025))
      assertEquals(repository.sessions, Vector.empty)
      rejected("config")(accounts.reconcile(users :+ users.head))
    }
  }

  test("BG specified: owner removal disable and password replacement permanently invalidate sessions") {
    withRepository { repository =>
      val accounts = new Accounts(repository)
      Vector("removed", "disabled", "password").foreach { mode =>
        val session = accounts.login(users, "alice", "synthetic-account-password")
        val changed = mode match {
          case "removed" => users.filterNot(_.id == "alice")
          case "disabled" => users.map(u => if (u.id == "alice") u.copy(enabled = false) else u)
          case _ => users.map(u => if (u.id == "alice") u.copy(passwordHash = Some(Password.hash("changed-synthetic".toCharArray))) else u)
        }
        accounts.reconcile(changed)
        assertEquals(accounts.browser(changed, session.secret), None)
        accounts.reconcile(users)
        assertEquals(accounts.browser(users, session.secret), None)
      }
    }
  }

  test("BG specified: issued bearer tokens persist, are owner-scoped, and cannot mint tokens") {
    withRepository { repository =>
      val accounts = new Accounts(repository)
      val session = accounts.login(users, "alice", "synthetic-account-password")
      val bob = accounts.login(users, "bob", "synthetic-account-password")
      val issued = accounts.issue(users, session.credential, "Synthetic client")
      assertEquals(issued.token.source, "issued")
      assertEquals(issued.token.scopes, Vector("api"))
      assert(!issued.toString.contains(issued.secret))
      assertEquals(accounts.browser(users, issued.secret), None)
      val bearer = accounts.bearer(users, issued.secret).get
      assert(!bearer.browser)
      assert(accounts.live(users, bearer.userId, bearer.tokenId, bearer.digest))
      assert(!accounts.live(users, "bob", bearer.tokenId, bearer.digest))
      rejected("forbidden")(accounts.issue(users, bearer, "Escalation"))
      rejected("not-found")(accounts.revoke(users, bob.credential, issued.token.id))
      accounts.reconcile(users)
      assert(new Accounts(repository).bearer(users, issued.secret).nonEmpty)
      accounts.revoke(users, session.credential, issued.token.id)
      assertEquals(accounts.bearer(users, issued.secret), None)
      assert(!accounts.live(users, bearer.userId, bearer.tokenId, bearer.digest))
      assert(accounts.tokens("alice").exists(t => t.id == issued.token.id && t.revoked))
      assertEquals(accounts.tokens("bob"), Vector.empty)
      assert(!AccountJson.issued(issued).noSpaces.contains(bearer.digest))
    }
  }

  test("BG specified: removed or disabled owners' issued tokens never revive after re-add") {
    withRepository { repository =>
      val accounts = new Accounts(repository)
      val session = accounts.login(users, "alice", "synthetic-account-password")
      val issued = accounts.issue(users, session.credential, "Synthetic client")
      accounts.reconcile(users.filterNot(_.id == "alice"))
      accounts.reconcile(users)
      assertEquals(accounts.bearer(users, issued.secret), None)
    }
  }

  test("BG specified: account reconciliation also bounds retained revoked metadata") {
    withRepository { repository =>
      val accounts = new Accounts(repository)
      val session = accounts.login(users, "alice", "synthetic-account-password")
      val old = (1 to Accounts.maximumRetainedRevoked).map(n => accounts.issue(users, session.credential, s"Old $n"))
      old.foreach(issued => accounts.revoke(users, session.credential, issued.token.id))
      (1 to Accounts.maximumActiveTokens).foreach(n => accounts.issue(users, session.credential, s"Current $n"))
      accounts.reconcile(users.filterNot(_.id == "alice"))
      assertEquals(accounts.tokens("alice").count(_.revoked), Accounts.maximumRetainedRevoked)
    }
  }

  test("BG specified: reconciling an unchanged directory reads fingerprints only, without locks or writes") {
    withRepository { repository =>
      val accounts = new Accounts(repository)
      val session = accounts.login(users, "alice", "synthetic-account-password")
      accounts.issue(users, session.credential, "Synthetic client")
      val withoutBob = users.filterNot(_.id == "bob")
      accounts.reconcile(withoutBob)
      val unchanged = new RecordingAccounts(repository)
      new Accounts(unchanged).reconcile(withoutBob)
      assertEquals(unchanged.calls.toVector, Vector("allUsers"))
      val changed = new RecordingAccounts(repository)
      new Accounts(changed).reconcile(users)
      assert(Vector("lockDirectory", "lockOwner", "putUser").forall(changed.calls.contains))
    }
  }

  test("BG specified: reconciliation leaves owners outside its scope untouched while targeted revocation reaches them") {
    withRepository { repository =>
      val accounts = new Accounts(repository)
      val first = accounts.establish(merged, "carol", None).session
      val second = accounts.establish(merged, "carol", None).session
      val issued = accounts.issue(merged, first.credential, "Carol client")
      rejected("config")(accounts.reconcile(merged))
      accounts.reconcile(users.filterNot(_.id == "alice"))
      assertEquals(repository.user("carol"), None)
      assertEquals(accounts.browser(users, first.secret), None)
      assertEquals(accounts.browser(merged, first.secret), Some(first.credential))
      assert(accounts.bearer(merged, issued.secret).nonEmpty)
      accounts.revokeSessions("carol", Some(second.credential))
      assertEquals(accounts.browser(merged, first.secret), None)
      assertEquals(accounts.browser(merged, second.secret), Some(second.credential))
      accounts.revokeTokens("carol")
      assertEquals(accounts.bearer(merged, issued.secret), None)
    }
  }

  test("BG specified: establish has password-login session semantics and declarative login never selects an imperative entry") {
    withRepository { repository =>
      val accounts = new Accounts(repository)
      rejected("unauthorized")(accounts.login(merged, "carol", "synthetic-account-password"))
      rejected("unauthorized")(accounts.loginReplacing(merged, "carol", "synthetic-account-password", None))
      Vector("agent", "missing").foreach(id => rejected("unauthorized")(accounts.establish(merged, id, None)))
      val alice = accounts.establish(merged, "alice", None)
      assertEquals(alice.replaced, None)
      assertEquals(accounts.browser(merged, alice.session.secret), Some(alice.session.credential))
      assertEquals(accounts.bearer(merged, alice.session.secret), None)
      assertEquals(repository.session(alice.session.credential.digest).get.passwordIdentity, Secrets.digest(passwordHash))
      val carol = accounts.establish(merged, "carol", Some(alice.session.secret))
      assertEquals(carol.replaced, Some(alice.session.credential))
      assertEquals(carol.session.credential.userId, "carol")
      assertEquals(accounts.browser(merged, alice.session.secret), None)
      accounts.logout(merged, carol.session.secret)
      assertEquals(accounts.browser(merged, carol.session.secret), None)
    }
  }

  test("BG specified: active issued tokens have a bounded per-owner limit") {
    withRepository { repository =>
      val accounts = new Accounts(repository)
      val session = accounts.login(users, "alice", "synthetic-account-password")
      val issued = (1 to Accounts.maximumActiveTokens).map(n => accounts.issue(users, session.credential, s"Client $n"))
      rejected("invalid")(accounts.issue(users, session.credential, "Overflow"))
      accounts.revoke(users, session.credential, issued.head.token.id)
      accounts.issue(users, session.credential, "Replacement")
      assertEquals(accounts.tokens("alice").count(!_.revoked), Accounts.maximumActiveTokens)
    }
  }
}

final class MemoryAccountSuite extends AccountContract {
  protected def withRepository(body: AccountRepository => Unit): Unit = {
    val repository = new MemoryAccounts
    new Accounts(repository).reconcile(users)
    body(repository)
  }
}

private final class MemoryAccounts extends AccountRepository {
  private val userRows = mutable.Map.empty[String, StoredUser]
  private val sessionRows = mutable.Map.empty[String, StoredSession]
  private val tokenRows = mutable.Map.empty[String, StoredToken]
  def lockDirectory(): Unit = ()
  def lockOwner(owner: String): Unit = ()
  def allUsers: Vector[StoredUser] = userRows.values.toVector
  def user(owner: String): Option[StoredUser] = userRows.get(owner)
  def putUser(row: StoredUser): Unit = userRows.update(row.id, row)
  def sessions: Vector[StoredSession] = sessionRows.values.toVector
  def ownerSessions(owner: String): Vector[StoredSession] = sessionRows.values.filter(_.owner == owner).toVector
  def session(digest: String): Option[StoredSession] = sessionRows.get(digest)
  def insertSession(row: StoredSession): Unit = {
    require(!sessionRows.contains(row.digest) && !sessionRows.values.exists(_.id == row.id))
    sessionRows.update(row.digest, row)
  }
  def deleteSession(digest: String): Unit = { sessionRows.remove(digest); () }
  def allTokens: Vector[StoredToken] = tokenRows.values.toVector
  def tokenByDigest(digest: String): Option[StoredToken] = tokenRows.values.find(_.digest == digest)
  def token(id: String): Option[StoredToken] = tokenRows.get(id)
  def tokens(owner: String): Vector[StoredToken] = tokenRows.values.filter(_.owner == owner).toVector.sortBy(t => (t.revoked, t.createdAt, t.id))
  def insertToken(row: StoredToken): Unit = {
    require(!tokenRows.contains(row.id) && !tokenRows.values.exists(_.digest == row.digest))
    tokenRows.update(row.id, row)
  }
  def revokeToken(id: String): Unit = { val row = tokenRows(id); tokenRows.update(id, row.copy(revoked = true)) }
  def deleteToken(id: String): Unit = { tokenRows.remove(id); () }
}

/** Records repository calls so a contract can assert that an operation takes no locks and writes nothing. */
private final class RecordingAccounts(underlying: AccountRepository) extends AccountRepository {
  val calls = mutable.ArrayBuffer.empty[String]
  private def record[A](name: String)(value: => A): A = { calls += name; value }
  def lockDirectory(): Unit = record("lockDirectory")(underlying.lockDirectory())
  def lockOwner(owner: String): Unit = record("lockOwner")(underlying.lockOwner(owner))
  def allUsers: Vector[StoredUser] = record("allUsers")(underlying.allUsers)
  def user(owner: String): Option[StoredUser] = record("user")(underlying.user(owner))
  def putUser(row: StoredUser): Unit = record("putUser")(underlying.putUser(row))
  def sessions: Vector[StoredSession] = record("sessions")(underlying.sessions)
  def ownerSessions(owner: String): Vector[StoredSession] = record("ownerSessions")(underlying.ownerSessions(owner))
  def session(digest: String): Option[StoredSession] = record("session")(underlying.session(digest))
  def insertSession(row: StoredSession): Unit = record("insertSession")(underlying.insertSession(row))
  def deleteSession(digest: String): Unit = record("deleteSession")(underlying.deleteSession(digest))
  def allTokens: Vector[StoredToken] = record("allTokens")(underlying.allTokens)
  def tokenByDigest(digest: String): Option[StoredToken] = record("tokenByDigest")(underlying.tokenByDigest(digest))
  def token(id: String): Option[StoredToken] = record("token")(underlying.token(id))
  def tokens(owner: String): Vector[StoredToken] = record("tokens")(underlying.tokens(owner))
  def insertToken(row: StoredToken): Unit = record("insertToken")(underlying.insertToken(row))
  def revokeToken(id: String): Unit = record("revokeToken")(underlying.revokeToken(id))
  def deleteToken(id: String): Unit = record("deleteToken")(underlying.deleteToken(id))
}
