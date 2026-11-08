package rites

import java.time.Instant
import java.util.UUID
import rites.api.*
import scala.collection.mutable

/** Hand-written behavioral dummy for the shared control/admission contract. All public
  * operations are atomic under one lock; PostgreSQL-only skip-lock/isolation behavior
  * has separate real-adapter tests rather than being approximated here.
  */
final class MemoryStore(config: Config, clock: () => Instant) extends RitesStore {
  private case class Account(config: UserConfig, credential: String)
  private case class Credential(public: CredentialInfo, owner: String, encrypted: VaultCiphertext, refresh: Option[VaultCiphertext], generation: Long, refreshIntent: Boolean)
  private case class Rite(public: RiteInfo, cursor: Option[Instant], active: Option[UUID])
  private case class Run(public: RunInfo, actor: String, requestId: Option[UUID], digest: Option[String], repositoryRevision: Int, riteRevision: Int, credentialId: UUID, credentialRevision: Int, intent: Boolean, remoteId: Option[String])
  private val accounts = mutable.Map.empty[String, Account]
  private val sessions = mutable.Map.empty[String, (String, Instant)]
  private val credentialsMap = mutable.Map.empty[UUID, Credential]
  private val repositoriesMap = mutable.Map.empty[String, RepositoryInfo]
  private val ritesMap = mutable.Map.empty[(String, String), Rite]
  private val runsMap = mutable.Map.empty[UUID, Run]
  private val publicationStages = mutable.Map.empty[UUID, String]
  private val remoteAuthors = mutable.Map.empty[UUID, String]
  private val runMarkers = mutable.Map.empty[UUID, String]
  private val runTargets = mutable.Map.empty[UUID, String]
  private val predecessors = mutable.Map.empty[(UUID, String), Boolean]
  def initialize(): Unit = synchronized {
    config.users.foreach(u => accounts.update(u.id, Account(u, config.password(u))))
    accounts.values.filterNot(a => config.users.exists(_.id == a.config.id)).foreach(a => accounts.update(a.config.id, a.copy(config = a.config.copy(enabled = false))))
    sessions.filterInPlace { case (_, (owner, expires)) => expires.isAfter(clock()) && accounts.get(owner).exists(_.config.enabled) }
  }
  def close(): Unit = ()
  private def account(id: String): Option[Account] = accounts.get(id).filter(_.config.enabled)
  private def requireCurrent(identity: Identity): Identity = synchronized {
    sessions.get(identity.sessionHash).filter { case (owner, expires) => owner == identity.userId && expires.isAfter(clock()) && account(owner).nonEmpty }
      .map(_ => identity).getOrElse(throw DomainError("unauthorized", "session expired or revoked"))
  }
  def login(login: String, password: String, ttlSeconds: Int): (Identity, String) = synchronized {
    Check(Valid.text(login, 128) && password.nonEmpty && password.length <= 1024, "invalid", "invalid login")
    val configured = config.users.find(_.login == login)
    val credential = configured.map(config.password).orElse(config.users.headOption.map(config.password)).getOrElse(Password.hash("invalid".toCharArray))
    Check(configured.exists(_.enabled) && Password.verify(password.toCharArray, credential), "unauthorized", "invalid credentials")
    initialize()
    val secret = Hash.secret(); val hash = Hash.sha256(secret); val user = configured.get
    sessions.update(hash, (user.id, clock().plusSeconds(ttlSeconds.toLong)))
    (Identity(user.id, user.login, hash), secret)
  }
  def authenticate(secret: String): Identity = synchronized {
    Check(secret.nonEmpty && secret.length <= 128, "unauthorized", "session required")
    val hash = Hash.sha256(secret)
    sessions.get(hash).filter { case (owner, expires) => expires.isAfter(clock()) && account(owner).nonEmpty }.map { case (owner, _) =>
      val login = accounts(owner).config.login; requireCurrent(Identity(owner, login, hash))
    }.getOrElse(throw DomainError("unauthorized", "session expired or revoked"))
  }
  def current(identity: Identity): Identity = requireCurrent(identity)
  def logout(identity: Identity): Unit = synchronized { requireCurrent(identity); sessions.remove(identity.sessionHash); () }
  def users(identity: Identity): List[UserInfo] = synchronized { requireCurrent(identity); accounts.values.filter(_.config.enabled).map(a => UserInfo(a.config.id, a.config.login)).toList.sortBy(_.login) }
  def beginTokenUse(credentialId: UUID, now: Instant, leadSeconds: String => Int): TokenDecision = synchronized {
    val credential = credentialsMap.get(credentialId).getOrElse(throw DomainError("credential-unavailable", "credential not found")); val public = credential.public
    if (public.mode == CredentialMode.Token) AccessGrant(credential.owner, credentialId, credential.encrypted) else {
      Check(!public.refreshHealth.contains(RefreshHealth.Uncertain) && !public.refreshHealth.contains(RefreshHealth.Failed) && !credential.refreshIntent, "refresh-uncertain", "OAuth credential requires owner replacement")
      val expiry = Instant.parse(public.expiresAt.getOrElse(throw DomainError("credential-unavailable", "OAuth expiry missing")))
      if (!expiry.isAfter(now.plusSeconds(leadSeconds(public.oauthClientId.get).toLong))) {
        val ticket = RefreshTicket(credential.owner, credentialId, public.forge, public.host, public.oauthClientId.get, public.revision, credential.generation, credential.refresh.getOrElse(throw DomainError("credential-unavailable", "refresh token missing")))
        credentialsMap.update(credentialId, credential.copy(public = public.copy(refreshHealth = Some(RefreshHealth.Due)), refreshIntent = true)); ticket
      } else AccessGrant(credential.owner, credentialId, credential.encrypted)
    }
  }
  def finishRefresh(ticket: RefreshTicket, access: VaultCiphertext, refresh: VaultCiphertext, expiresAt: Instant): Unit = synchronized {
    val credential = credentialsMap.get(ticket.credentialId).getOrElse(throw DomainError("credential-unavailable", "credential not found"))
    Check(credential.owner == ticket.owner && credential.public.revision == ticket.revision && credential.generation == ticket.generation && credential.refreshIntent, "credential-replaced", "credential changed during OAuth refresh")
    credentialsMap.update(ticket.credentialId, credential.copy(public = credential.public.copy(expiresAt = Some(expiresAt.toString), refreshHealth = Some(RefreshHealth.Healthy)), encrypted = access, refresh = Some(refresh), generation = credential.generation + 1, refreshIntent = false))
  }
  def failRefresh(ticket: RefreshTicket, uncertain: Boolean): Unit = synchronized {
    credentialsMap.get(ticket.credentialId).filter(c => c.owner == ticket.owner && c.public.revision == ticket.revision && c.generation == ticket.generation).foreach { c => credentialsMap.update(ticket.credentialId, c.copy(public = c.public.copy(refreshHealth = Some(if (uncertain) RefreshHealth.Uncertain else RefreshHealth.Failed)), refreshIntent = uncertain)) }
  }
  def credentials(identity: Identity): List[CredentialInfo] = synchronized { requireCurrent(identity); credentialsMap.values.filter(_.owner == identity.userId).map(_.public).toList.sortBy(_.id.toString) }
  def saveCredential(identity: Identity, request: SaveCredentialRequest, material: (String, UUID, ForgeKind, String, Int) => EncryptedPair): CredentialInfo = synchronized {
    requireCurrent(identity); Check(Valid.text(request.name, 128) && Valid.host(request.host) && request.secret.nonEmpty && request.secret.length <= 16384, "invalid", "invalid credential"); config.forge(request.forge, request.host)
    val old = request.id.map(id => credentialsMap.get(id).filter(_.owner == identity.userId).getOrElse(throw DomainError("not-found", "credential not found")))
    old.foreach { c => Check(c.public.forge == request.forge && c.public.host == request.host, "conflict", "credential forge identity is immutable"); Check(c.public.mode == request.mode, "conflict", "credential mode is immutable"); RitesStore.requireRevision(request.expectedRevision, c.public.revision) }
    if (old.isEmpty) Check(request.id.isEmpty && request.expectedRevision == 0, "conflict", "new credential revision must be zero")
    val id = old.map(_.public.id).getOrElse(UUID.randomUUID()); val revision = old.map(_.public.revision + 1).getOrElse(1); val now = clock()
    val public = CredentialInfo(id, request.name, request.forge, request.host, revision, old.map(_.public.createdAt).getOrElse(now.toString), now.toString, request.mode, request.oauthClientId, request.expiresAt, if (request.mode == CredentialMode.Oauth) Some(RefreshHealth.Healthy) else None)
    val pair = material(identity.userId, id, request.forge, request.host, revision)
    credentialsMap.update(id, Credential(public, identity.userId, pair.access, pair.refresh, old.map(_.generation + 1).getOrElse(1), false)); public
  }
  def deleteCredential(identity: Identity, request: DeleteCredentialRequest): Unit = synchronized {
    requireCurrent(identity); val credential = credentialsMap.get(request.id).filter(_.owner == identity.userId).getOrElse(throw DomainError("not-found", "credential not found"))
    RitesStore.requireRevision(request.expectedRevision, credential.public.revision)
    Check(!repositoriesMap.values.exists(_.credentialId == request.id), "conflict", "credential is bound to a repository"); credentialsMap.remove(request.id); ()
  }
  private def visible(repo: RepositoryInfo, identity: Identity): Boolean = repo.owner == identity.userId || repo.grants.exists(g => g.userId == identity.userId && g.role != GrantRole.Owner && account(g.userId).nonEmpty)
  private def repo(identity: Identity, id: String, required: GrantRole): RepositoryInfo = synchronized {
    val found = repositoriesMap.get(id).filter(visible(_, identity)).getOrElse(throw DomainError("not-found", "repository not found"))
    val role = RitesStore.role(found.grants, identity.userId, found.owner)
    Check(required == GrantRole.Viewer || role == GrantRole.Owner || (required == GrantRole.Editor && role == GrantRole.Editor), "not-found", "repository not found"); found
  }
  def repositories(identity: Identity): List[RepositoryInfo] = synchronized { requireCurrent(identity); repositoriesMap.values.filter(visible(_, identity)).toList.sortBy(_.id) }
  def repository(identity: Identity, id: String): RepositoryInfo = synchronized { requireCurrent(identity); repo(identity, id, GrantRole.Viewer) }
  def saveRepository(identity: Identity, request: SaveRepositoryRequest): RepositoryInfo = synchronized {
    requireCurrent(identity); Check(Valid.repository(request.id) && Valid.project(request.project) && Valid.branch(request.baseBranch), "invalid", "invalid repository"); config.forge(request.forge, request.host)
    Check(credentialsMap.get(request.credentialId).exists(c => c.owner == identity.userId && c.public.forge == request.forge && c.public.host == request.host), "forbidden", "credential must be owned by repository owner and exactly match forge")
    val old = repositoriesMap.get(request.id); old.foreach { r => Check(r.owner == identity.userId, "not-found", "repository not found"); RitesStore.requireRevision(request.expectedRevision, r.revision) }
    if (old.isEmpty) Check(request.expectedRevision == 0, "conflict", "new repository revision must be zero")
    val revision = old.map(_.revision + 1).getOrElse(1); val grants = old.map(_.grants).getOrElse(List(GrantInfo(identity.userId, identity.login, GrantRole.Owner)))
    val updated = RepositoryInfo(request.id, identity.userId, request.forge, request.host, request.project, request.baseBranch, request.credentialId, revision, grants)
    repositoriesMap.update(request.id, updated)
    if (old.nonEmpty) failQueued(request.id, None)
    updated
  }
  def deleteRepository(identity: Identity, request: DeleteRepositoryRequest): Unit = synchronized {
    requireCurrent(identity); val found = repo(identity, request.id, GrantRole.Owner); RitesStore.requireRevision(request.expectedRevision, found.revision)
    repositoriesMap.remove(request.id); ritesMap.keys.filter(_._1 == request.id).toList.foreach(ritesMap.remove); runsMap.keys.filter(id => runsMap(id).public.repositoryId == request.id).toList.foreach(runsMap.remove); ()
  }
  def setGrant(identity: Identity, request: SetGrantRequest): RepositoryInfo = synchronized {
    requireCurrent(identity); val found = repo(identity, request.repositoryId, GrantRole.Owner); RitesStore.requireRevision(request.expectedRevision, found.revision)
    Check(request.userId != found.owner && !request.role.contains(GrantRole.Owner) && account(request.userId).nonEmpty, "forbidden", "owner grant is immutable or user unavailable")
    val retained = found.grants.filterNot(g => g.userId == request.userId && g.role != GrantRole.Owner)
    val grants = request.role.map(role => retained :+ GrantInfo(request.userId, accounts(request.userId).config.login, role)).getOrElse(retained)
    val updated = found.copy(grants = grants.sortBy(g => (g.role.toString, g.login)), revision = found.revision + 1)
    repositoriesMap.update(found.id, updated); failQueued(found.id, Some(request.userId)); updated
  }
  def rites(identity: Identity, repositoryId: String): List[RiteInfo] = synchronized { requireCurrent(identity); repo(identity, repositoryId, GrantRole.Viewer); ritesMap.values.filter(_.public.repositoryId == repositoryId).map(_.public).toList.sortBy(_.id) }
  def saveRite(identity: Identity, request: SaveRiteRequest, validModel: String => Boolean): RiteInfo = synchronized {
    requireCurrent(identity); repo(identity, request.repositoryId, GrantRole.Editor); Check(Valid.rite(request.id) && Valid.prompt(request.promptPath) && validModel(request.modelId), "invalid", "invalid rite"); Cron(request.schedule)
    val key = (request.repositoryId, request.id); val old = ritesMap.get(key); old.foreach(r => RitesStore.requireRevision(request.expectedRevision, r.public.revision))
    if (old.isEmpty) Check(request.expectedRevision == 0, "conflict", "new rite revision must be zero")
    val public = RiteInfo(request.repositoryId, request.id, request.schedule, request.promptPath, request.modelId, request.enabled, old.map(_.public.revision + 1).getOrElse(1))
    ritesMap.update(key, Rite(public, old.flatMap(_.cursor).orElse(Some(clock().truncatedTo(java.time.temporal.ChronoUnit.MINUTES))), old.flatMap(_.active)))
    if (old.nonEmpty) failRiteQueued(request.repositoryId, request.id); public
  }
  def deleteRite(identity: Identity, request: DeleteRiteRequest): Unit = synchronized {
    requireCurrent(identity); repo(identity, request.repositoryId, GrantRole.Editor); val key = (request.repositoryId, request.id)
    ritesMap.get(key).foreach(r => RitesStore.requireRevision(request.expectedRevision, r.public.revision)); ritesMap.remove(key); ()
  }
  def manualRun(identity: Identity, request: ManualRunRequest): RunAdmission = synchronized {
    requireCurrent(identity); repo(identity, request.repositoryId, GrantRole.Viewer)
    val digest = Hash.sha256(List(request.repositoryId, request.riteId, request.requestId.toString).mkString("\u0000"))
    val old = runsMap.values.find(r => r.actor == identity.userId && r.requestId.contains(request.requestId))
    old.foreach(r => Check(r.digest.contains(digest), "conflict", "request ID bound to different payload"))
    old.map(r => RunAdmission(r.public, false)).getOrElse {
      repo(identity, request.repositoryId, GrantRole.Editor)
      val key = (request.repositoryId, request.riteId); val rite = ritesMap.get(key).filter(_.public.enabled).getOrElse(throw DomainError("not-found", "rite not found"))
      Check(rite.active.isEmpty, "conflict", "rite already has an active run")
      Check(runsMap.values.count(r => r.public.state == RunState.Queued || r.public.state == RunState.Running) < config.scheduler.queueBound, "unavailable", "run queue is full")
      val repository = repositoriesMap(request.repositoryId); val credential = credentialsMap(repository.credentialId)
      val now = clock(); val id = UUID.randomUUID()
      val public = RunInfo(id, request.repositoryId, request.riteId, RunTrigger.Manual, now.toString, now.toString, None, None, RunState.Queued, None, None, None, None, None)
      runsMap.update(id, Run(public, identity.userId, Some(request.requestId), Some(digest), repository.revision, rite.public.revision, credential.public.id, credential.public.revision, false, None)); runTargets.update(id, repository.baseBranch); ritesMap.update(key, rite.copy(active = Some(id)))
      RunAdmission(public, true)
    }
  }
  private def authorizedRun(i: Identity, run: Run): Boolean = repositoriesMap.get(run.public.repositoryId).exists(visible(_, i))
  def run(identity: Identity, id: UUID): RunInfo = synchronized { requireCurrent(identity); runsMap.get(id).filter(authorizedRun(identity, _)).map(_.public).getOrElse(throw DomainError("not-found", "run not found")) }
  def runs(identity: Identity, repositoryId: String, riteId: String): List[RunInfo] = synchronized { requireCurrent(identity); repo(identity, repositoryId, GrantRole.Viewer); runsMap.values.filter(r => r.public.repositoryId == repositoryId && r.public.riteId == riteId).map(_.public).toList.sortBy(_.createdAt).reverse.take(100) }
  def status(identity: Identity): StatusInfo = synchronized {
    requireCurrent(identity); val visibleRuns = runsMap.values.filter(authorizedRun(identity, _)); StatusInfo(visibleRuns.count(_.public.state == RunState.Queued).toLong, visibleRuns.count(_.public.state == RunState.Running).toLong, true)
  }
  private def latestDue(cron: Cron, cursor: Instant, now: Instant): Option[Instant] = {
    val latest = cron.previousOrCurrent(now); if (latest.isAfter(cursor)) Some(latest) else None
  }
  def admitScheduled(now: Instant, maximum: Int): Int = synchronized {
    var admitted = 0
    ritesMap.values.toList.sortBy(r => (r.public.repositoryId, r.public.id)).foreach { rite =>
      val repository = repositoriesMap.get(rite.public.repositoryId)
      val due = if (repository.nonEmpty && rite.public.enabled && rite.active.isEmpty && account(repository.get.owner).nonEmpty) latestDue(Cron(rite.public.schedule), rite.cursor.getOrElse(now), now) else None
      if (due.nonEmpty && runsMap.values.count(r => r.public.state == RunState.Queued || r.public.state == RunState.Running) < maximum) {
        val repo = repository.get; val credential = credentialsMap(repo.credentialId); val id = UUID.randomUUID(); val public = RunInfo(id, repo.id, rite.public.id, RunTrigger.Schedule, due.get.toString, now.toString, None, None, RunState.Queued, None, None, None, None, None)
        if (!runsMap.values.exists(r => r.public.trigger == RunTrigger.Schedule && r.public.repositoryId == repo.id && r.public.riteId == rite.public.id && r.public.scheduledFor == due.get.toString)) {
          runsMap.update(id, Run(public, repo.owner, None, None, repo.revision, rite.public.revision, credential.public.id, credential.public.revision, false, None)); runTargets.update(id, repo.baseBranch); ritesMap.update((repo.id, rite.public.id), rite.copy(cursor = due, active = Some(id))); admitted += 1
        }
      }
    }
    admitted
  }
  private def toAuthority(run: Run): Option[Authority] = synchronized {
    for {
      repository <- repositoriesMap.get(run.public.repositoryId); rite <- ritesMap.get((run.public.repositoryId, run.public.riteId)); credential <- credentialsMap.get(run.credentialId); actor <- account(run.actor)
      if repository.revision == run.repositoryRevision && rite.public.revision == run.riteRevision && credential.public.revision == run.credentialRevision && rite.public.enabled && visible(repository, Identity(run.actor, actor.config.login, "internal"))
      role = RitesStore.role(repository.grants, run.actor, repository.owner) if role == GrantRole.Owner || role == GrantRole.Editor
    } yield Authority(run.public, repository.owner, repository, rite.public, credential.owner, repository.forge, repository.host, repository.project, repository.baseBranch, credential.encrypted)
  }
  def claimNext(now: Instant): Option[Authority] = synchronized {
    val candidate = runsMap.values.filter(_.public.state == RunState.Queued).toList.sortBy(r => (r.public.createdAt, r.public.id.toString)).headOption
    candidate.flatMap { run =>
      toAuthority(run) match {
        case None => complete(run.public.id, RunCompletion(RunState.Failed, Some("authorization-revoked"))); None
        case Some(authority) =>
          val public = run.public.copy(state = RunState.Running, startedAt = Some(now.toString)); runsMap.update(run.public.id, run.copy(public = public)); Some(authority.copy(run = public))
      }
    }
  }
  def recoverInterrupted(): Unit = synchronized {
    runsMap.values.filter(_.public.state == RunState.Running).toList.foreach { run =>
      val state = if (run.intent) RunState.PublicationUncertain else RunState.Failed; val code = if (run.intent) "publication-reconciliation-required" else "interrupted-agent"
      val public = run.public.copy(state = state, failureCode = Some(code), finishedAt = Some(clock().toString)); runsMap.update(run.public.id, run.copy(public = public))
      if (!run.intent) clearActive(run.public.id)
    }
  }
  private def clearActive(id: UUID): Unit = runsMap.get(id).foreach { run => val key = (run.public.repositoryId, run.public.riteId); ritesMap.get(key).filter(_.active.contains(id)).foreach(r => ritesMap.update(key, r.copy(active = None))) }
  private def failRiteQueued(repository: String, rite: String): Unit = runsMap.values.filter(r => r.public.repositoryId == repository && r.public.riteId == rite && r.public.state == RunState.Queued).map(_.public.id).toList.foreach(id => complete(id, RunCompletion(RunState.Failed, Some("authorization-revoked"))))
  private def failQueued(repository: String, actor: Option[String]): Unit = runsMap.values.filter(r => r.public.repositoryId == repository && r.public.state == RunState.Queued && actor.forall(_ == r.actor)).map(_.public.id).toList.foreach(id => complete(id, RunCompletion(RunState.Failed, Some("authorization-revoked"))))
  def complete(id: UUID, completion: RunCompletion): Unit = synchronized {
    runsMap.get(id).foreach { run =>
      val public = run.public.copy(state = completion.state, failureCode = completion.failureCode, finishedAt = Some(clock().toString), baseRevision = completion.baseRevision.orElse(run.public.baseRevision), promptDigest = completion.promptDigest.orElse(run.public.promptDigest), branch = completion.branch.orElse(run.public.branch), proposalUrl = completion.proposalUrl.orElse(run.public.proposalUrl))
      runsMap.update(id, run.copy(public = public)); clearActive(id)
    }
  }
  def authority(id: UUID): Option[Authority] = synchronized { runsMap.get(id).filter(r => Set(RunState.Running, RunState.PublicationUncertain, RunState.SupersessionPending).contains(r.public.state)).flatMap(toAuthority) }
  def persistIntent(id: UUID, branch: String, marker: String): Unit = synchronized {
    runsMap.get(id).filter(_.public.state == RunState.Running).foreach { run => runsMap.update(id, run.copy(public = run.public.copy(state = RunState.PublicationUncertain, failureCode = Some("publication-in-progress"), branch = Some(branch)), intent = true)); publicationStages.update(id, "Intent"); runMarkers.update(id, marker) }
  }
  def publicationStage(id: UUID): String = synchronized { publicationStages.getOrElse(id, "None") }
  def markPushed(id: UUID): Unit = synchronized { if (runsMap.get(id).exists(_.intent)) publicationStages.update(id, "Pushed") }
  def markCreateDispatched(id: UUID): Unit = synchronized { if (runsMap.get(id).exists(_.intent)) publicationStages.update(id, "CreateDispatched") }
  def markPublication(id: UUID, remoteId: String, url: String, author: String, previous: List[String]): Unit = synchronized {
    runsMap.get(id).foreach { run =>
      publicationStages.update(id, "Created"); remoteAuthors.update(id, author); previous.foreach(p => predecessors.update((id, p), false))
      val state = if (previous.isEmpty) RunState.Published else RunState.SupersessionPending; val public = run.public.copy(state = state, failureCode = if (previous.isEmpty) None else Some("supersession-pending"), proposalUrl = Some(url), finishedAt = Some(clock().toString)); runsMap.update(id, run.copy(public = public, remoteId = Some(remoteId))); if (previous.isEmpty) clearActive(id)
    }
  }
  def knownMarker(repositoryId: String, riteId: String, marker: String, source: String, target: String, author: String): Boolean = synchronized {
    runsMap.values.exists(r => r.public.repositoryId == repositoryId && r.public.riteId == riteId && r.public.branch.contains(source) && remoteAuthors.get(r.public.id).contains(author) && runTargets.get(r.public.id).contains(target) && runMarkers.get(r.public.id).contains(marker))
  }
  def predecessorClosed(id: UUID, remoteId: String): Unit = synchronized {
    predecessors.update((id, remoteId), true); if (!predecessors.exists { case ((run, _), closed) => run == id && !closed }) complete(id, RunCompletion(RunState.Published, None))
  }
  def pendingPublication(limit: Int): List[UUID] = synchronized { runsMap.values.filter(r => r.intent && Set(RunState.PublicationUncertain, RunState.SupersessionPending).contains(r.public.state)).map(_.public.id).toList.sortBy(_.toString).take(limit) }
  def markUncertain(id: UUID, code: String): Unit = synchronized { runsMap.get(id).foreach(run => runsMap.update(id, run.copy(public = run.public.copy(state = RunState.PublicationUncertain, failureCode = Some(code), finishedAt = Some(clock().toString))))) }
  def markSupersessionPending(id: UUID): Unit = synchronized { runsMap.get(id).foreach(run => runsMap.update(id, run.copy(public = run.public.copy(state = RunState.SupersessionPending, failureCode = Some("supersession-pending"), finishedAt = Some(clock().toString))))) }
}
