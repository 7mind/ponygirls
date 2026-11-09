package rites

import io.circe.Json
import java.nio.file.{Files, Path}
import java.time.Instant
import java.util.UUID
import rites.api.*
import scala.collection.mutable

private final class FixtureForge extends Forge {
  val proposals = mutable.Map.empty[String, Proposal]
  val events = mutable.ArrayBuffer.empty[String]
  var current = ForgeUser("current-author")
  var createCalls = 0
  var rejectClose = false
  def user(authority: Authority, token: String): ForgeUser = { events += "user"; current }
  def create(authority: Authority, token: String, delta: CommitDelta): Proposal = {
    createCalls += 1; events += "create-new"
    val value = Proposal("new", "http://git.example.invalid/group/project/merge_requests/new", current.id, delta.branch, authority.baseBranch, delta.marker + "\nbase-target:" + authority.baseBranch)
    proposals.update(value.remoteId, value); value
  }
  def get(authority: Authority, token: String, remoteId: String): Option[Proposal] = { if (remoteId == "new") events += "verify-new" else events += "reread-" + remoteId; proposals.get(remoteId) }
  def list(authority: Authority, token: String): List[Proposal] = proposals.values.toList.sortBy(_.remoteId)
  def close(authority: Authority, token: String, proposal: Proposal): Unit = { events += "close-" + proposal.remoteId; if (rejectClose) throw DomainError("remote-auth") else proposals.remove(proposal.remoteId) }
}
final class PublicationTest extends munit.FunSuite {
  private val tokens = new ForgeTokens { def withToken[A](authority: Authority)(operation: String => A): A = operation("fixture-secret") }
  private def setup(): (MemoryStore, Config, Identity, FixtureForge, GitRepository) = setupWithStore(config => new MemoryStore(config, () => Instant.now()))
  private def setupWithStore(create: Config => MemoryStore): (MemoryStore, Config, Identity, FixtureForge, GitRepository) = {
    val root = Files.createTempDirectory("rites-publication"); val config = StoreFixture.config(root)
    val store = create(config); store.initialize(); val owner = store.login("owner", StoreFixture.plaintext, 3600)._1
    val credential = store.saveCredential(owner, SaveCredentialRequest(None, "fixture", ForgeKind.Gitlab, "git.example.invalid", "fixture-secret", 0, CredentialMode.Token, None, None, None), (user, id, kind, host, _) => EncryptedPair(StoreFixture.vault.encrypt(user, id, kind.toString, host, "fixture-secret"), None))
    store.saveRepository(owner, SaveRepositoryRequest("repo-pub", ForgeKind.Gitlab, "git.example.invalid", "group/project", "main", credential.id, 0))
    store.saveRite(owner, SaveRiteRequest("repo-pub", "site", "* * * * *", "prompt.md", "model", true, 0), _ == "model")
    (store, config, owner, new FixtureForge, new GitRepository(config, TestRemoteCatalog.disabled))
  }
  private def run(store: RitesStore, owner: Identity): Authority = {
    store.manualRun(owner, ManualRunRequest("repo-pub", "site", UUID.randomUUID())); store.claimNext(Instant.now()).get
  }
  private def delta(run: Authority): CommitDelta = CommitDelta(s"rites/repo-pub/site/${run.run.id}", s"rites-run:${run.run.id}", "cccccccccccccccccccccccccccccccccccccccc")
  private def assertNoDispatch(store: MemoryStore, owner: Identity, runId: UUID): Unit = {
    assertEquals(store.run(owner, runId).state, RunState.Failed); assertEquals(store.publicationStage(runId), "None")
    assert(store.pendingPublication(32).isEmpty); assert(store.manualRun(owner, ManualRunRequest("repo-pub", "site", UUID.randomUUID())).admitted)
  }
  private def prepared(run: Authority, root: Path): PreparedRun = PreparedRun(root, root.resolve("workspace"), root.resolve("publication"), "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "Synthetic prompt", "fixture-digest")
  test("post-intent pre-dispatch revocation is failed as known non-publication, not uncertain") {
    var afterIntent: () => Unit = () => ()
    val (store, config, owner, forge, gitBase) = setupWithStore(config => new MemoryStore(config, () => Instant.now()) {
      override def persistIntent(id: UUID, branch: String, marker: String, expectedHead: String): Unit = { super.persistIntent(id, branch, marker, expectedHead); afterIntent() }
    }); var gitCalls = 0
    val git = new GitRepository(config, TestRemoteCatalog.disabled) { override def push(prepared: PreparedRun, authority: Authority, delta: CommitDelta, token: String): Unit = { gitCalls += 1; () } }
    try {
      val repo = store.repository(owner, "repo-pub"); val shared = store.setGrant(owner, SetGrantRequest(repo.id, "editor", Some(GrantRole.Editor), repo.revision))
      val editor = store.login("editor", StoreFixture.plaintext, 3600)._1; val current = run(store, editor); val value = delta(current)
      afterIntent = () => { store.setGrant(owner, SetGrantRequest(repo.id, "editor", None, shared.revision)); () }
      assertEquals(intercept[DomainError](new PublicationService(store, git, forge, tokens, config).publish(prepared(current, Files.createTempDirectory("rites-no-dispatch")), current, value)).code, "authorization-revoked")
      assertEquals(gitCalls, 0); assert(forge.events.isEmpty); assertNoDispatch(store, owner, current.run.id)
    } finally store.close()
  }
  test("full coordinator does not reclassify atomic revocation as uncertain intent") {
    val (store, config, owner, forge, gitBase) = setup(); val repo = store.repository(owner, "repo-pub")
    val shared = store.setGrant(owner, SetGrantRequest(repo.id, "editor", Some(GrantRole.Editor), repo.revision)); val editor = store.login("editor", StoreFixture.plaintext, 3600)._1; val current = run(store, editor)
    var remoteCalls = 0; val root = Files.createTempDirectory("rites-coordinator-revocation"); val synthetic = delta(current)
    val git = new GitRepository(config, TestRemoteCatalog.disabled) {
      override def prepare(authority: Authority, token: String): PreparedRun = PreparedRun(root, root, root, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "Synthetic prompt", "fixture-digest")
      override def publishDelta(prepared: PreparedRun, authority: Authority): Option[CommitDelta] = Some(synthetic)
      override def push(prepared: PreparedRun, authority: Authority, delta: CommitDelta, token: String): Unit = { remoteCalls += 1; () }
    }
    val agent = new AgentRunner { def run(workspace: Path, prompt: String, runId: UUID, model: ModelConfig): rites.worker.RunOutcome = { store.setGrant(owner, SetGrantRequest(repo.id, "editor", None, shared.revision)); rites.worker.RunOutcome.Completed } }
    val models = RuntimeModels(List(ModelConfig("model", "fixture", "fixture-model", "off", Json.obj())))
    val publication = new PublicationService(store, git, forge, tokens, config)
    new RunCoordinator(store, models, git, agent, publication, logstage.IzLogger()).execute(current)
    assertEquals(remoteCalls, 0); assert(forge.events.isEmpty); assertNoDispatch(store, owner, current.run.id)
    store.close()
  }
  test("coordinator failure diagnostics include phase/class/frame but never exception messages") {
    val (store, config, owner, forge, gitBase) = setup(); val current = run(store, owner); val root = Files.createTempDirectory("rites-sanitized-log")
    val git = new GitRepository(config, TestRemoteCatalog.disabled) { override def prepare(authority: Authority, token: String): PreparedRun = PreparedRun(root, root, root, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "Synthetic prompt", "fixture-digest") }
    val agent = new AgentRunner { def run(workspace: Path, prompt: String, runId: UUID, model: ModelConfig): rites.worker.RunOutcome = throw new RuntimeException("synthetic-secret-error-message") }
    final class CaptureSink extends izumi.logstage.api.logger.LogSink { val entries = mutable.ArrayBuffer.empty[izumi.logstage.api.Log.Entry]; def flush(entry: izumi.logstage.api.Log.Entry): Unit = entries += entry }
    val sink = new CaptureSink
    val logger = new logstage.IzLogger(logstage.LogRouter(logstage.Log.Level.Trace, sink), logstage.Log.CustomContext.empty)
    val models = RuntimeModels(List(ModelConfig("model", "fixture", "fixture-model", "off", Json.obj()))); val publication = new PublicationService(store, git, forge, tokens, config)
    new RunCoordinator(store, models, git, agent, publication, logger).execute(current)
    val output = sink.entries.map(_.message.toString).mkString("\n")
    assert(output.contains("agent"))
    assert(output.contains("java.lang.RuntimeException"))
    assert(!output.contains("synthetic-secret-error-message"))
    assert(store.run(owner, current.run.id).state == RunState.Failed)
    store.close()
  }
  private def predecessor(store: RitesStore, owner: Identity, forge: FixtureForge, remote: String, humanMarker: Boolean = false): Authority = {
    val old = run(store, owner); val value = delta(old); store.persistIntent(old.run.id, value.branch, value.marker, value.commit)
    val marker = if (humanMarker) "manual-proposal" else value.marker
    forge.proposals.update(remote, Proposal(remote, "http://git.example.invalid/p/" + remote, "recording-author", value.branch, "main", marker + "\nbase-target:main"))
    store.markPublication(old.run.id, remote, forge.proposals(remote).url, "recording-author", Nil); old
  }
  test("new verified proposal precedes own predecessor closure, never closes human proposal") {
    val (store, config, owner, forge, git) = setup(); try {
      val old = predecessor(store, owner, forge, "old")
      val oldDelta = delta(old)
      forge.proposals.update("copied-id", forge.proposals("old").copy(remoteId = "copied-id", url = "http://git.example.invalid/unrecorded/copy"))
      val human = run(store, owner); val humanDelta = delta(human); store.persistIntent(human.run.id, humanDelta.branch, humanDelta.marker, humanDelta.commit)
      forge.proposals.update("human", Proposal("human", "http://git.example.invalid/p/human", "current-author", humanDelta.branch, "main", "human-proposal"))
      store.markPublication(human.run.id, "human", forge.proposals("human").url, "current-author", Nil)
      val current = run(store, owner); val value = delta(current); store.persistIntent(current.run.id, value.branch, value.marker, value.commit); store.markPushed(current.run.id)
      new PublicationService(store, git, forge, tokens, config).reconcile(current.run.id, Some(value))
      assertEquals(forge.createCalls, 1); assertEquals(store.run(owner, current.run.id).state, RunState.Published)
      assert(!forge.proposals.contains("old")); assert(forge.proposals.contains("human")); assert(forge.proposals.contains("copied-id"), "same marker/author cloned under a different remote id and URL is not Rites-owned")
      assert(forge.events.indexOf("create-new") < forge.events.indexOf("close-old")); assert(forge.events.indexOf("verify-new") < forge.events.indexOf("close-old"))
    } finally store.close()
  }
  test("uncertain create reconciles unique marker and never blind re-creates") {
    val (store, config, owner, forge, git) = setup(); try {
      val current = run(store, owner); val value = delta(current); store.persistIntent(current.run.id, value.branch, value.marker, value.commit); store.markCreateDispatched(current.run.id)
      val existing = Proposal("existing", "http://git.example.invalid/p/existing", "current-author", value.branch, "main", value.marker)
      forge.proposals.update(existing.remoteId, existing)
      new PublicationService(store, git, forge, tokens, config).reconcile(current.run.id, None)
      assertEquals(forge.createCalls, 0); assertEquals(store.run(owner, current.run.id).state, RunState.Published)
    } finally store.close()
  }
  test("durable pushed stage can recover pre-dispatch create after restart") {
    val (store, config, owner, forge, git) = setup(); try {
      val current = run(store, owner); val value = delta(current); store.persistIntent(current.run.id, value.branch, value.marker, value.commit); store.markPushed(current.run.id)
      new PublicationService(store, git, forge, tokens, config).reconcile(current.run.id, None)
      assertEquals(forge.createCalls, 1); assertEquals(store.run(owner, current.run.id).state, RunState.Published)
    } finally store.close()
  }
  test("empty observation after dispatched create remains uncertain and creates nothing") {
    val (store, config, owner, forge, git) = setup(); try {
      val current = run(store, owner); val value = delta(current); store.persistIntent(current.run.id, value.branch, value.marker, value.commit); store.markCreateDispatched(current.run.id)
      assertEquals(intercept[DomainError](new PublicationService(store, git, forge, tokens, config).reconcile(current.run.id, None)).code, "publication-uncertain")
      assertEquals(forge.createCalls, 0); store.markUncertain(current.run.id, "publication-reconciliation-required")
      assertEquals(store.run(owner, current.run.id).state, RunState.PublicationUncertain)
    } finally store.close()
  }
  test("close permission failure retains verified replacement as supersession pending") {
    val (store, config, owner, forge, git) = setup(); try {
      predecessor(store, owner, forge, "old"); forge.rejectClose = true
      val current = run(store, owner); val value = delta(current); store.persistIntent(current.run.id, value.branch, value.marker, value.commit); store.markPushed(current.run.id)
      intercept[DomainError](new PublicationService(store, git, forge, tokens, config).reconcile(current.run.id, Some(value)))
      store.markSupersessionPending(current.run.id)
      assertEquals(store.run(owner, current.run.id).state, RunState.SupersessionPending); assert(forge.proposals.contains("new")); assert(forge.proposals.contains("old"))
    } finally store.close()
  }
}
