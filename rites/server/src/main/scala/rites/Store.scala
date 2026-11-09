package rites

import java.time.Instant
import java.util.UUID
import rites.api.*

final case class Identity(userId: String, login: String, sessionHash: String)
final case class SecretMaterial(id: UUID, owner: String, name: String, forge: ForgeKind, host: String, revision: Int, createdAt: Instant, updatedAt: Instant, encrypted: VaultCiphertext)
final case class EncryptedPair(access: VaultCiphertext, refresh: Option[VaultCiphertext])
final case class RunAdmission(run: RunInfo, admitted: Boolean)
sealed trait TokenDecision
final case class AccessGrant(owner: String, credentialId: UUID, access: VaultCiphertext) extends TokenDecision
final case class RefreshTicket(owner: String, credentialId: UUID, forge: ForgeKind, host: String, clientId: String, revision: Int, generation: Long, refresh: VaultCiphertext) extends TokenDecision
final case class Authority(
  run: RunInfo, owner: String, repository: RepositoryInfo, rite: RiteInfo,
  credentialOwner: String, forge: ForgeKind, host: String, project: String, baseBranch: String,
  encrypted: VaultCiphertext
)
final case class RunCompletion(state: RunState, failureCode: Option[String], baseRevision: Option[String] = None, promptDigest: Option[String] = None, branch: Option[String] = None, proposalUrl: Option[String] = None)

trait RitesStore extends AutoCloseable {
  /** One production coordinator per database, backed by a lifecycle-owned DB session. */
  def acquireCoordinator(): Unit
  def coordinatorBackendId: Option[Int]
  def initialize(): Unit
  def login(login: String, password: String, ttlSeconds: Int): (Identity, String)
  def authenticate(secret: String): Identity
  def current(identity: Identity): Identity
  def logout(identity: Identity): Unit
  def users(identity: Identity): List[UserInfo]
  def beginTokenUse(credentialId: UUID, now: Instant, leadSeconds: String => Int): TokenDecision
  def finishRefresh(ticket: RefreshTicket, access: VaultCiphertext, refresh: VaultCiphertext, expiresAt: Instant): Unit
  def failRefresh(ticket: RefreshTicket, uncertain: Boolean): Unit
  def credentials(identity: Identity): List[CredentialInfo]
  def saveCredential(identity: Identity, request: SaveCredentialRequest, material: (String, UUID, ForgeKind, String, Int) => EncryptedPair): CredentialInfo
  def deleteCredential(identity: Identity, request: DeleteCredentialRequest): Unit
  def repositories(identity: Identity): List[RepositoryInfo]
  def repository(identity: Identity, id: String): RepositoryInfo
  def saveRepository(identity: Identity, request: SaveRepositoryRequest): RepositoryInfo
  def deleteRepository(identity: Identity, request: DeleteRepositoryRequest): Unit
  def setGrant(identity: Identity, request: SetGrantRequest): RepositoryInfo
  def rites(identity: Identity, repositoryId: String): List[RiteInfo]
  def saveRite(identity: Identity, request: SaveRiteRequest, validModel: String => Boolean): RiteInfo
  def deleteRite(identity: Identity, request: DeleteRiteRequest): Unit
  def manualRun(identity: Identity, request: ManualRunRequest): RunAdmission
  def run(identity: Identity, id: UUID): RunInfo
  def runs(identity: Identity, repositoryId: String, riteId: String): List[RunInfo]
  def status(identity: Identity): StatusInfo
  def admitScheduled(now: Instant, maximum: Int): Int
  def claimNext(now: Instant): Option[Authority]
  def recoverInterrupted(): Unit
  def complete(id: UUID, completion: RunCompletion): Unit
  def authority(id: UUID): Option[Authority]
  def persistIntent(id: UUID, branch: String, marker: String, expectedHead: String): Unit
  def publicationHead(id: UUID): Option[String]
  /** Fail only a locally proven pre-dispatch revocation, never an uncertain remote attempt. */
  def abandonUndelivered(id: UUID): Unit
  def publicationStage(id: UUID): String
  def markPushed(id: UUID): Unit
  def markCreateDispatched(id: UUID): Unit
  def markPublication(id: UUID, remoteId: String, url: String, author: String, predecessors: List[String]): Unit
  def knownMarker(repositoryId: String, riteId: String, marker: String, source: String, target: String, author: String, remoteId: String, url: String): Boolean
  def predecessorClosed(id: UUID, remoteId: String): Unit
  def pendingPublication(limit: Int): List[UUID]
  def markUncertain(id: UUID, code: String): Unit
  def markSupersessionPending(id: UUID): Unit
}
object RitesStore {
  def requireRevision(expected: Int, actual: Int): Unit = Check(expected == actual, "conflict", "revision mismatch")
  def role(grants: List[GrantInfo], userId: String, repositoryOwner: String): GrantRole =
    if (repositoryOwner == userId) GrantRole.Owner else grants.find(_.userId == userId).map(_.role).getOrElse(GrantRole.Viewer)
  def runState(value: String): RunState = value match {
    case "Queued" => RunState.Queued; case "Running" => RunState.Running; case "NoChange" => RunState.NoChange
    case "Published" => RunState.Published; case "Failed" => RunState.Failed; case "PublicationUncertain" => RunState.PublicationUncertain
    case "SupersessionPending" => RunState.SupersessionPending; case "Cancelled" => RunState.Cancelled
    case _ => throw DomainError("corrupt", "unknown run state")
  }
  def trigger(value: String): RunTrigger = if (value == "Schedule") RunTrigger.Schedule else RunTrigger.Manual
  def forge(value: String): ForgeKind = if (value == "Github") ForgeKind.Github else if (value == "Gitlab") ForgeKind.Gitlab else throw DomainError("corrupt", "unknown forge")
  def grant(value: String): GrantRole = if (value == "Owner") GrantRole.Owner else if (value == "Editor") GrantRole.Editor else GrantRole.Viewer
  def credentialMode(value: String): CredentialMode = if (value == "Oauth") CredentialMode.Oauth else CredentialMode.Token
  def refreshHealth(value: String): RefreshHealth = value match { case "Due" => RefreshHealth.Due; case "Uncertain" => RefreshHealth.Uncertain; case "Failed" => RefreshHealth.Failed; case _ => RefreshHealth.Healthy }
}
