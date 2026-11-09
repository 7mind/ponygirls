package rites

import java.net.URI
import java.util.UUID
import rites.api.RunState

final class PublicationService(store: RitesStore, git: GitRepository, forge: Forge, tokens: ForgeTokens, config: Config) {
  private[rites] def withForgeToken[A](authority: Authority)(operation: String => A): A = tokens.withToken(current(authority.run.id))(operation)
  private def current(id: UUID): Authority = store.authority(id).getOrElse(throw DomainError("authorization-revoked", "run authority changed"))
  private def verify(authority: Authority, proposal: Proposal, branch: String, marker: String, target: String, expectedAuthor: String): Proposal = {
    Check(proposal.source == branch && proposal.target == target && proposal.marker.linesIterator.contains(marker) && proposal.author == expectedAuthor, "publication-unowned", "proposal ownership verification failed")
    val url = URI.create(proposal.url)
    Check(url.getHost == authority.host && (url.getScheme == "https" || (config.testMode && url.getScheme == "http")) && url.getUserInfo == null, "publication-unowned", "proposal URL is outside configured forge")
    proposal
  }
  private def read(id: UUID, remoteId: String): Option[Proposal] = { val authority = current(id); tokens.withToken(authority)(token => forge.get(authority, token, remoteId)) }
  private def list(id: UUID): List[Proposal] = { val authority = current(id); tokens.withToken(authority)(token => forge.list(authority, token)) }
  def publish(prepared: PreparedRun, initial: Authority, delta: CommitDelta): Unit = {
    val runId = initial.run.id
    try {
      store.persistIntent(runId, delta.branch, delta.marker, delta.commit)
      tokens.withToken(current(runId))(token => git.push(prepared, current(runId), delta, token))
      store.markPushed(runId)
      reconcile(runId, Some(delta))
    } catch {
      case error: DomainError if error.code == "authorization-revoked" =>
        // Stage Intent proves create was not dispatched; Pushed proves only a unique
        // branch exists. Never apply this to CreateDispatched/Created uncertainty.
        if (Set("Intent", "Pushed").contains(store.publicationStage(runId))) store.abandonUndelivered(runId)
        throw error
    }
  }
  /** CreateDispatched never re-creates when observation is empty: a timeout is not
    * evidence that the remote write failed. Only a pre-dispatch durable stage can create.
    */
  def reconcile(id: UUID, delta: Option[CommitDelta]): Unit = {
    val authority = current(id); val run = authority.run
    val branch = run.branch.getOrElse(throw DomainError("publication-uncertain", "branch intent missing"))
    val marker = delta.map(_.marker).getOrElse(s"rites-run:${run.id.toString}")
    val virtualDelta = delta.getOrElse(CommitDelta(branch, marker, ""))
    val stage = store.publicationStage(id)
    if (stage == "Intent") {
      // Crash after branch push but before the staged acknowledgement. Re-read the
      // exact ownership identity and recorded immutable head; never replay push blindly.
      val expected = store.publicationHead(id).getOrElse(throw DomainError("publication-uncertain", "expected head intent missing"))
      val observed = tokens.withToken(current(id))(token => git.branchHead(current(id), branch, token))
      Check(observed.contains(expected), "publication-head-unverified", "remote branch head does not match persisted intent")
      store.markPushed(id)
    }
    val user = tokens.withToken(authority)(token => forge.user(authority, token))
    var proposal = list(id).find(p => p.source == branch && p.marker.linesIterator.contains(marker) && p.target == authority.baseBranch && p.author == user.id)
    if (proposal.isEmpty) {
      val createStage = store.publicationStage(id)
      Check(createStage != "CreateDispatched" && (delta.nonEmpty || createStage == "Pushed"), "publication-uncertain", "remote create outcome cannot be proven")
      store.markCreateDispatched(id)
      val fresh = current(id)
      proposal = Some(tokens.withToken(fresh)(token => forge.create(fresh, token, virtualDelta)))
      val observed = read(id, proposal.get.remoteId).getOrElse(throw DomainError("publication-uncertain", "created proposal cannot be read back"))
      proposal = Some(verify(current(id), observed, branch, marker, authority.baseBranch, user.id))
    } else {
      val observed = read(id, proposal.get.remoteId).getOrElse(throw DomainError("publication-uncertain", "proposal disappeared"))
      proposal = Some(verify(current(id), observed, branch, marker, authority.baseBranch, user.id))
    }
    val created = proposal.get; val open = list(id)
    val older = open.filter { candidate =>
      candidate.remoteId != created.remoteId && candidate.marker.linesIterator.exists(line => line.startsWith("rites-run:")) &&
        store.knownMarker(authority.repository.id, authority.rite.id, candidate.marker.linesIterator.find(_.startsWith("rites-run:")).get, candidate.source, candidate.target, candidate.author, candidate.remoteId, candidate.url)
    }
    store.markPublication(id, created.remoteId, created.url, user.id, older.map(_.remoteId))
    older.foreach { before =>
      val latest = current(id)
      val observed = read(id, before.remoteId).getOrElse(throw DomainError("supersession-pending", "predecessor is no longer open"))
      val markerLine = observed.marker.linesIterator.find(_.startsWith("rites-run:")).get
      verify(latest, observed, before.source, markerLine, before.target, before.author)
      Check(store.knownMarker(latest.repository.id, latest.rite.id, markerLine, observed.source, observed.target, observed.author, observed.remoteId, observed.url), "supersession-pending", "predecessor ownership changed")
      tokens.withToken(current(id))(token => forge.close(latest, token, observed))
      store.predecessorClosed(id, before.remoteId)
    }
  }
}
final class RunCoordinator(store: RitesStore, models: RuntimeModels, git: GitRepository, agent: AgentRunner, publication: PublicationService, logger: logstage.IzLogger) {
  private def safeCode(error: Throwable): String = error match {
    case d: DomainError if d.code.matches("[a-z0-9-]{1,64}") => d.code
    case _ => "run-failed"
  }
  def execute(authority: Authority): Unit = {
    var prepared: Option[PreparedRun] = None; var intended = false; var phase = "model"
    try {
      val model = models.byId.getOrElse(authority.rite.modelId, throw DomainError("model-revoked", "configured model unavailable"))
      phase = "prepare-workspace"; val ready = withForgePrepared(authority); prepared = Some(ready)
      phase = "agent"
      agent.run(ready.workspace, ready.prompt, authority.run.id, model) match {
        case rites.worker.RunOutcome.Completed =>
          phase = "export-delta"
          git.publishDelta(ready, authority) match {
            case None => store.complete(authority.run.id, RunCompletion(RunState.NoChange, None, Some(ready.base), Some(ready.promptDigest)))
            case Some(delta) => phase = "publication"; intended = true; publication.publish(ready, authority, delta)
          }
        case rites.worker.RunOutcome.Failed => store.complete(authority.run.id, RunCompletion(RunState.Failed, Some("agent-failed"), Some(ready.base), Some(ready.promptDigest)))
        case rites.worker.RunOutcome.Cancelled => store.complete(authority.run.id, RunCompletion(RunState.Cancelled, Some("agent-cancelled"), Some(ready.base), Some(ready.promptDigest)))
      }
    } catch {
      case scala.util.control.NonFatal(error) =>
        val frames = error.getStackTrace.iterator.filter(f => f.getClassName.startsWith("rites.") || f.getClassName.startsWith("ponygirls.") || f.getClassName.startsWith("org.postgresql.")).take(12).map(f => f.getClassName + "." + f.getMethodName + ":" + Option(f.getFileName).getOrElse("native") + ":" + f.getLineNumber).toList
        val errorClass = error.getClass.getName
        logger.error(s"run failed phase=$phase errorClass=$errorClass frames=$frames")
        if (safeCode(error) == "authorization-revoked" && store.publicationStage(authority.run.id) == "None") store.complete(authority.run.id, RunCompletion(RunState.Failed, Some("authorization-revoked")))
        else if (intended && store.publicationStage(authority.run.id) == "Created") store.markSupersessionPending(authority.run.id)
        else if (intended) store.markUncertain(authority.run.id, safeCode(error))
        else store.complete(authority.run.id, RunCompletion(if (safeCode(error) == "deadline" || safeCode(error) == "cancelled") RunState.Cancelled else RunState.Failed, Some(safeCode(error))))
    } finally prepared.foreach(git.cleanup)
  }
  private def withForgePrepared(authority: Authority): PreparedRun = publication.withForgeToken(authority)(token => git.prepare(authority, token))
}
