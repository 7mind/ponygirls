package rites

import izumi.functional.bio.{Error2, F}
import java.time.Instant
import java.util.UUID
import rites.api.*

/** BIO authorization decisions are shared by HTTP mutations and run publication.
  * The production and in-memory contracts both execute this pure policy; transport
  * failures remain at the cats-effect/JDBC boundary.
  */
final class AuthorizationPolicy[F[+_, +_]: Error2] {
  def decide(role: GrantRole, required: GrantRole): F[DomainError, Unit] = {
    val allowed = required == GrantRole.Viewer || role == GrantRole.Owner || (required == GrantRole.Editor && role == GrantRole.Editor)
    if (allowed) F.unit else F.fail(DomainError("forbidden", "grant required"))
  }
  def ownerGrantMutable(currentOwner: String, target: String, requested: Option[GrantRole]): F[DomainError, Unit] =
    if (currentOwner != target && !requested.contains(GrantRole.Owner)) F.unit else F.fail(DomainError("forbidden", "owner grant is immutable"))
}
final case class RuntimeModels(values: List[ModelConfig]) {
  val byId: Map[String, ModelConfig] = values.map(m => m.id -> m).toMap
  def publicValues: List[ModelInfo] = values.map(_.publicInfo)
}
final case class LoginResult(response: LoginResponse, secret: String)
final class ControlService(store: RitesStore, config: Config, vault: Vault, models: RuntimeModels, locks: CredentialLocks) {
  val versions: VersionInfo = VersionInfo("0.2.0", "0.2.0", List("0.2.0"))
  private val authorization = new AuthorizationPolicy[Either]
  private def authorize(role: GrantRole, required: GrantRole): Unit = authorization.decide(role, required).left.foreach(throw _)
  def login(request: LoginRequest): LoginResult = {
    val (identity, secret) = store.login(request.login, request.password, config.sessionTtlSeconds)
    LoginResult(LoginResponse(UserInfo(identity.userId, identity.login), versions, config.sessionTtlSeconds.toLong), secret)
  }
  def me(identity: Identity): UserInfo = { val current = store.current(identity); UserInfo(current.userId, current.login) }
  def logout(identity: Identity): Unit = store.logout(identity)
  def credentials(identity: Identity): CredentialsResult = CredentialsResult(store.credentials(identity))
  def saveCredential(identity: Identity, request: SaveCredentialRequest): CredentialResult = {
    request.mode match {
      case CredentialMode.Token => Check(request.oauthClientId.isEmpty && request.refreshToken.isEmpty && request.expiresAt.isEmpty, "invalid", "token credentials cannot include OAuth fields")
      case CredentialMode.Oauth =>
        Check(request.forge == ForgeKind.Gitlab && request.oauthClientId.nonEmpty && request.refreshToken.exists(_.nonEmpty) && request.expiresAt.nonEmpty, "invalid", "OAuth requires client, access/refresh tokens and expiry")
        config.oauthClient(request.oauthClientId.get, request.host)
        Check(scala.util.Try(Instant.parse(request.expiresAt.get)).isSuccess, "invalid", "invalid OAuth expiry")
    }
    def save = store.saveCredential(identity, request, (owner, id, forge, host, _) => EncryptedPair(vault.encrypt(owner, id, forge.toString, host, request.secret), request.refreshToken.map(vault.encryptRefresh(owner, id, forge.toString, host, _))))
    CredentialResult(request.id.map(id => locks(id)(save)).getOrElse(save))
  }
  def deleteCredential(identity: Identity, request: DeleteCredentialRequest): Ack = { store.deleteCredential(identity, request); Ack(true) }
  def repositories(identity: Identity): RepositoriesResult = RepositoriesResult(store.repositories(identity))
  def saveRepository(identity: Identity, request: SaveRepositoryRequest): RepositoryResult = RepositoryResult(store.saveRepository(identity, request))
  def deleteRepository(identity: Identity, request: DeleteRepositoryRequest): Ack = { store.deleteRepository(identity, request); Ack(true) }
  def setGrant(identity: Identity, request: SetGrantRequest): RepositoryResult = {
    val repo = store.repository(identity, request.repositoryId)
    authorization.ownerGrantMutable(repo.owner, request.userId, request.role).left.foreach(throw _)
    RepositoryResult(store.setGrant(identity, request))
  }
  def rites(identity: Identity, repository: String): RitesResult = RitesResult(store.rites(identity, repository))
  def saveRite(identity: Identity, request: SaveRiteRequest): RiteResult = {
    val repo = store.repository(identity, request.repositoryId); authorize(RitesStore.role(repo.grants, identity.userId, repo.owner), GrantRole.Editor)
    RiteResult(store.saveRite(identity, request, models.byId.contains))
  }
  def deleteRite(identity: Identity, request: DeleteRiteRequest): Ack = { store.deleteRite(identity, request); Ack(true) }
  def manualRun(identity: Identity, request: ManualRunRequest): RunResult = {
    val repo = store.repository(identity, request.repositoryId); authorize(RitesStore.role(repo.grants, identity.userId, repo.owner), GrantRole.Editor)
    RunResult(store.manualRun(identity, request).run)
  }
  def run(identity: Identity, id: UUID): RunResult = RunResult(store.run(identity, id))
  def runs(identity: Identity, repository: String, rite: String): RunsResult = RunsResult(store.runs(identity, repository, rite))
  def users(identity: Identity): UsersResult = UsersResult(store.users(identity))
  def status(identity: Identity): StatusInfo = store.status(identity)
  def modelList: ModelsResult = ModelsResult(models.publicValues)
  def oauthClients: OAuthClientsResult = OAuthClientsResult(config.oauthClients.map(_.publicInfo))
}
