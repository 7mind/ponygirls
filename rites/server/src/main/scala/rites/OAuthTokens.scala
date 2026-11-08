package rites

import java.net.URI
import java.time.Instant
import java.util.UUID
import java.util.concurrent.locks.ReentrantLock
import ponygirls.runtime.CredentialFile
import rites.api.CredentialMode

final class CredentialLocks {
  private val locks = Array.fill(64)(new ReentrantLock(true))
  def apply[A](credentialId: UUID)(operation: => A): A = {
    val lock = locks((credentialId.hashCode() & Int.MaxValue) % locks.length)
    lock.lockInterruptibly()
    try operation finally lock.unlock()
  }
}
trait ForgeTokens { def withToken[A](authority: Authority)(operation: String => A): A }
final class OAuthForgeTokens(store: RitesStore, vault: Vault, transport: HttpTransport, config: Config, locks: CredentialLocks, clock: java.time.Clock) extends ForgeTokens {
  def withToken[A](authority: Authority)(operation: String => A): A = locks(authority.repository.credentialId) {
    val grant = store.beginTokenUse(authority.repository.credentialId, clock.instant(), client => config.oauthClient(client, authority.host).expiryLeadSeconds)
    grant match {
      case AccessGrant(owner, id, encrypted) => operation(vault.decrypt(owner, id, authority.forge.toString, authority.host, encrypted))
      case ticket: RefreshTicket =>
        refresh(ticket)
        store.beginTokenUse(authority.repository.credentialId, clock.instant(), client => config.oauthClient(client, authority.host).expiryLeadSeconds) match {
          case AccessGrant(owner, id, encrypted) => operation(vault.decrypt(owner, id, authority.forge.toString, authority.host, encrypted))
          case _: RefreshTicket => throw DomainError("refresh-uncertain", "OAuth refresh did not produce usable credential")
        }
    }
  }
  private def refresh(ticket: RefreshTicket): Unit = {
    val client = config.oauthClient(ticket.clientId, ticket.host)
    val refreshSecret = vault.decryptRefresh(ticket.owner, ticket.credentialId, ticket.forge.toString, ticket.host, ticket.refresh)
    val fields = List("grant_type" -> "refresh_token", "client_id" -> client.clientId, "refresh_token" -> refreshSecret, "redirect_uri" -> client.redirectUri) ++ client.clientSecretFile.map(path => "client_secret" -> CredentialFile.read(java.nio.file.Path.of(path))).toList
    try {
      val reply = transport.form(URI.create(client.tokenEndpoint), fields)
      val invalidGrant = reply.json.hcursor.get[String]("error").contains("invalid_grant")
      if (invalidGrant) { store.failRefresh(ticket, uncertain = false); throw DomainError("oauth-grant-invalid", "OAuth grant was rejected") }
      if (reply.status != 200) { store.failRefresh(ticket, uncertain = true); throw DomainError("refresh-uncertain", "OAuth refresh outcome unavailable") }
      val access = reply.json.hcursor.get[String]("access_token").getOrElse(throw DomainError("refresh-uncertain", "OAuth response incomplete"))
      val refresh = reply.json.hcursor.get[String]("refresh_token").getOrElse(throw DomainError("refresh-uncertain", "OAuth response incomplete"))
      val expiresIn = reply.json.hcursor.get[Long]("expires_in").getOrElse(throw DomainError("refresh-uncertain", "OAuth response incomplete"))
      Check(access.nonEmpty && access.length <= 16384 && refresh.nonEmpty && refresh.length <= 16384 && expiresIn >= 60 && expiresIn <= 86400, "refresh-uncertain", "OAuth response invalid")
      val now = clock.instant()
      store.finishRefresh(ticket, vault.encrypt(ticket.owner, ticket.credentialId, ticket.forge.toString, ticket.host, access), vault.encryptRefresh(ticket.owner, ticket.credentialId, ticket.forge.toString, ticket.host, refresh), now.plusSeconds(expiresIn))
    } catch {
      case error: DomainError if Set("oauth-grant-invalid", "refresh-uncertain", "credential-replaced").contains(error.code) => throw error
      case _: DomainError => store.failRefresh(ticket, uncertain = true); throw DomainError("refresh-uncertain", "OAuth refresh outcome unavailable")
      case scala.util.control.NonFatal(_) => store.failRefresh(ticket, uncertain = true); throw DomainError("refresh-uncertain", "OAuth refresh outcome unavailable")
    }
  }
}
