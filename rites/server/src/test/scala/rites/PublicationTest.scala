package rites

import java.nio.file.Files
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
  private def setup(): (MemoryStore, Config, Identity, FixtureForge, GitRepository) = {
    val root = Files.createTempDirectory("rites-publication"); val config = StoreFixture.config(root)
    val store = new MemoryStore(config, () => Instant.now()); store.initialize(); val owner = store.login("owner", StoreFixture.plaintext, 3600)._1
    val credential = store.saveCredential(owner, SaveCredentialRequest(None, "fixture", ForgeKind.Gitlab, "git.example.invalid", "fixture-secret", 0, CredentialMode.Token, None, None, None), (user, id, kind, host, _) => EncryptedPair(StoreFixture.vault.encrypt(user, id, kind.toString, host, "fixture-secret"), None))
    store.saveRepository(owner, SaveRepositoryRequest("repo-pub", ForgeKind.Gitlab, "git.example.invalid", "group/project", "main", credential.id, 0))
    store.saveRite(owner, SaveRiteRequest("repo-pub", "site", "* * * * *", "prompt.md", "model", true, 0), _ == "model")
    (store, config, owner, new FixtureForge, new GitRepository(config, TestRemoteCatalog.disabled))
  }
  private def run(store: RitesStore, owner: Identity): Authority = {
    store.manualRun(owner, ManualRunRequest("repo-pub", "site", UUID.randomUUID())); store.claimNext(Instant.now()).get
  }
  private def delta(run: Authority): CommitDelta = CommitDelta(s"rites/repo-pub/site/${run.run.id}", s"rites-run:${run.run.id}", "fixture")
  private def predecessor(store: RitesStore, owner: Identity, forge: FixtureForge, remote: String, humanMarker: Boolean = false): Authority = {
    val old = run(store, owner); val value = delta(old); store.persistIntent(old.run.id, value.branch, value.marker)
    val marker = if (humanMarker) "manual-proposal" else value.marker
    forge.proposals.update(remote, Proposal(remote, "http://git.example.invalid/p/" + remote, "recording-author", value.branch, "main", marker + "\nbase-target:main"))
    store.markPublication(old.run.id, remote, forge.proposals(remote).url, "recording-author", Nil); old
  }
  test("new verified proposal precedes own predecessor closure, never closes human proposal") {
    val (store, config, owner, forge, git) = setup(); try {
      val old = predecessor(store, owner, forge, "old")
      val oldDelta = delta(old)
      val human = run(store, owner); val humanDelta = delta(human); store.persistIntent(human.run.id, humanDelta.branch, humanDelta.marker)
      forge.proposals.update("human", Proposal("human", "http://git.example.invalid/p/human", "current-author", humanDelta.branch, "main", "human-proposal"))
      store.markPublication(human.run.id, "human", forge.proposals("human").url, "current-author", Nil)
      val current = run(store, owner); val value = delta(current); store.persistIntent(current.run.id, value.branch, value.marker); store.markPushed(current.run.id)
      new PublicationService(store, git, forge, tokens, config).reconcile(current.run.id, Some(value))
      assertEquals(forge.createCalls, 1); assertEquals(store.run(owner, current.run.id).state, RunState.Published)
      assert(!forge.proposals.contains("old")); assert(forge.proposals.contains("human"))
      assert(forge.events.indexOf("create-new") < forge.events.indexOf("close-old")); assert(forge.events.indexOf("verify-new") < forge.events.indexOf("close-old"))
    } finally store.close()
  }
  test("uncertain create reconciles unique marker and never blind re-creates") {
    val (store, config, owner, forge, git) = setup(); try {
      val current = run(store, owner); val value = delta(current); store.persistIntent(current.run.id, value.branch, value.marker); store.markCreateDispatched(current.run.id)
      val existing = Proposal("existing", "http://git.example.invalid/p/existing", "current-author", value.branch, "main", value.marker)
      forge.proposals.update(existing.remoteId, existing)
      new PublicationService(store, git, forge, tokens, config).reconcile(current.run.id, None)
      assertEquals(forge.createCalls, 0); assertEquals(store.run(owner, current.run.id).state, RunState.Published)
    } finally store.close()
  }
  test("durable pushed stage can recover pre-dispatch create after restart") {
    val (store, config, owner, forge, git) = setup(); try {
      val current = run(store, owner); val value = delta(current); store.persistIntent(current.run.id, value.branch, value.marker); store.markPushed(current.run.id)
      new PublicationService(store, git, forge, tokens, config).reconcile(current.run.id, None)
      assertEquals(forge.createCalls, 1); assertEquals(store.run(owner, current.run.id).state, RunState.Published)
    } finally store.close()
  }
  test("empty observation after dispatched create remains uncertain and creates nothing") {
    val (store, config, owner, forge, git) = setup(); try {
      val current = run(store, owner); val value = delta(current); store.persistIntent(current.run.id, value.branch, value.marker); store.markCreateDispatched(current.run.id)
      assertEquals(intercept[DomainError](new PublicationService(store, git, forge, tokens, config).reconcile(current.run.id, None)).code, "publication-uncertain")
      assertEquals(forge.createCalls, 0); store.markUncertain(current.run.id, "publication-reconciliation-required")
      assertEquals(store.run(owner, current.run.id).state, RunState.PublicationUncertain)
    } finally store.close()
  }
  test("close permission failure retains verified replacement as supersession pending") {
    val (store, config, owner, forge, git) = setup(); try {
      predecessor(store, owner, forge, "old"); forge.rejectClose = true
      val current = run(store, owner); val value = delta(current); store.persistIntent(current.run.id, value.branch, value.marker); store.markPushed(current.run.id)
      intercept[DomainError](new PublicationService(store, git, forge, tokens, config).reconcile(current.run.id, Some(value)))
      store.markSupersessionPending(current.run.id)
      assertEquals(store.run(owner, current.run.id).state, RunState.SupersessionPending); assert(forge.proposals.contains("new")); assert(forge.proposals.contains("old"))
    } finally store.close()
  }
}
