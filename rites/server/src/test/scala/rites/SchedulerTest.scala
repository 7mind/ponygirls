package rites

import cats.effect.IO
import java.nio.file.{Files, Path}
import java.time.Instant
import java.util.UUID
import rites.api.*
import scala.concurrent.duration.*

final class SchedulerTest extends munit.FunSuite {
  private implicit val runtime: cats.effect.unsafe.IORuntime = cats.effect.unsafe.implicits.global
  private val head = "cccccccccccccccccccccccccccccccccccccccc"
  private case class Fixture(store: MemoryStore, config: Config, owner: Identity, editor: Identity, run: Authority, forge: FixtureForge, git: GitRepository, tokens: ForgeTokens, coordinator: RunCoordinator, scheduler: Scheduler)
  private def fixture(pushed: Boolean): Fixture = {
    val root = Files.createTempDirectory("rites-scheduler-revocation"); val config = StoreFixture.config(root); val store = new MemoryStore(config, () => Instant.now()); store.initialize()
    val owner = store.login("owner", StoreFixture.plaintext, 3600)._1; val credential = store.saveCredential(owner, SaveCredentialRequest(None, "fixture", ForgeKind.Gitlab, "git.example.invalid", "fixture-secret", 0, CredentialMode.Token, None, None, None), (user, id, kind, host, _) => EncryptedPair(StoreFixture.vault.encrypt(user, id, kind.toString, host, "fixture-secret"), None))
    val repository = store.saveRepository(owner, SaveRepositoryRequest("repo-scheduler", ForgeKind.Gitlab, "git.example.invalid", "group/project", "main", credential.id, 0))
    store.saveRite(owner, SaveRiteRequest(repository.id, "site", "0 0 29 2 *", "prompt.md", "model", true, 0), _ == "model")
    val shared = store.setGrant(owner, SetGrantRequest(repository.id, "editor", Some(GrantRole.Editor), repository.revision)); val editor = store.login("editor", StoreFixture.plaintext, 3600)._1
    store.manualRun(editor, ManualRunRequest(repository.id, "site", UUID.randomUUID())); val run = store.claimNext(Instant.now()).get
    store.persistIntent(run.run.id, s"rites/${repository.id}/site/${run.run.id}", s"rites-run:${run.run.id}", head); if (pushed) store.markPushed(run.run.id)
    store.setGrant(owner, SetGrantRequest(repository.id, "editor", None, shared.revision))
    val forge = new FixtureForge
    val git = new GitRepository(config, TestRemoteCatalog.disabled) {
      override def branchHead(authority: Authority, branch: String, token: String): Option[String] = throw DomainError("unexpected-branch-read")
      override def push(prepared: PreparedRun, authority: Authority, delta: CommitDelta, token: String): Unit = throw DomainError("unexpected-push")
    }
    val tokens = new ForgeTokens { def withToken[A](authority: Authority)(operation: String => A): A = operation("fixture-secret") }
    val publication = new PublicationService(store, git, forge, tokens, config)
    val coordinator = new RunCoordinator(store, RuntimeModels(Nil), git, new AgentRunner { def run(workspace: Path, prompt: String, id: UUID, model: ModelConfig): rites.worker.RunOutcome = throw DomainError("unexpected-agent") }, publication, logstage.IzLogger())
    Fixture(store, config, owner, editor, run, forge, git, tokens, coordinator, new Scheduler(store, config, coordinator, publication, logstage.IzLogger()))
  }
  private def revokedIntentReleases(pushed: Boolean): Unit = {
    val f = fixture(pushed); try {
      val result = f.scheduler.run.timeout(1.second).attempt.unsafeRunSync(); assert(result.isLeft, "scheduler cycle bounded by the fixture only")
      assertEquals(f.store.run(f.owner, f.run.run.id).state, RunState.Failed); assertEquals(f.store.publicationStage(f.run.run.id), "None"); assert(f.store.pendingPublication(32).isEmpty)
      assert(f.forge.events.isEmpty); assert(f.store.manualRun(f.owner, ManualRunRequest("repo-scheduler", "site", UUID.randomUUID())).admitted)
    } finally f.store.close()
  }
  test("actual scheduler cycle releases revoked Intent before any remote call") { revokedIntentReleases(false) }
  test("actual scheduler cycle releases revoked Pushed before create") { revokedIntentReleases(true) }
  test("actual scheduler preserves uncertain CreateDispatched and Created suspension after revocation") {
    val f = fixture(false); try {
      f.store.markCreateDispatched(f.run.run.id); f.scheduler.run.timeout(1.second).attempt.unsafeRunSync()
      assertEquals(f.store.run(f.owner, f.run.run.id).state, RunState.PublicationUncertain); assertEquals(f.store.publicationStage(f.run.run.id), "CreateDispatched")
      val second = fixture(false); try {
        second.store.markPushed(second.run.run.id); second.store.markPublication(second.run.run.id, "new", "http://git.example.invalid/new", "recording-author", List("old"))
        second.scheduler.run.timeout(1.second).attempt.unsafeRunSync()
        assertEquals(second.store.run(second.owner, second.run.run.id).state, RunState.SupersessionPending); assertEquals(second.store.publicationStage(second.run.run.id), "Created")
        assert(intercept[DomainError](second.store.manualRun(second.owner, ManualRunRequest("repo-scheduler", "site", UUID.randomUUID()))).code == "conflict")
      } finally second.store.close()
    } finally f.store.close()
  }
}
