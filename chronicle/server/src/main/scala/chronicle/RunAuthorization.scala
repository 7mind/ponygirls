package chronicle

import cats.effect.IO
import java.sql.Connection

final case class RunAuthority(identity: Identity,revision: Long) {
  override def toString: String = "RunAuthority(redacted)"
}

trait RunAuthorization {
  def capture(identity: Identity): IO[RunAuthority]
  def verify(authority: RunAuthority): IO[Identity]
}

object SecurityEpoch {
  def current(c: Connection): Long =
    Sql.one(c,"SELECT revision FROM ch_security_epoch WHERE singleton")(_.getLong(1))
      .getOrElse(throw DomainError("security-state","security epoch is unavailable"))
}

final class PostgresRunAuthorization(db: Database,auth: Auth) extends RunAuthorization {
  def capture(identity: Identity): IO[RunAuthority] = IO.blocking {
    identity.requireBrowser()
    identity.requireScope(chronicle.api.Scope.Read)
    db.transaction { c =>
      c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ)
      val current=auth.currentBrowser(c,identity)
      RunAuthority(current,SecurityEpoch.current(c))
    }
  }

  def verify(authority: RunAuthority): IO[Identity] = capture(authority.identity).map { current =>
    Check(current.revision==authority.revision,"authorization-changed","access changed; run data is no longer available")
    current.identity
  }
}
