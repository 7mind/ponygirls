package rites

import cats.effect.IO
import java.nio.file.{Files, Path}
import java.time.Instant
import java.util.concurrent.{CountDownLatch, TimeUnit}
import java.util.concurrent.atomic.AtomicInteger
import java.util.UUID
import rites.api.*
import scala.concurrent.duration.*

final class SchedulerConcurrencyTest extends munit.FunSuite {
  private implicit val runtime: cats.effect.unsafe.IORuntime = cats.effect.unsafe.implicits.global
  private val base = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  private val head = "cccccccccccccccccccccccccccccccccccccccc"
  private case class Fixture(store: MemoryStore, owner: Identity, run: RunInfo, scheduler: Scheduler, forge: TrackingForge, git: GitRepository, tokens: ForgeTokens, prepared: PreparedRun)
  private final class TrackingForge(gate: Option[(CountDownLatch, CountDownLatch)]) extends FixtureForge {
    val userCalls = new AtomicInteger(0)
    var userError: Option[DomainError] = None
    override def user(authority: Authority, token: String): ForgeUser = {
      userCalls.incrementAndGet(); userError.foreach(error => throw error); gate.foreach { case (entered, release) => entered.countDown(); if (!release.await(30, TimeUnit.SECONDS)) throw DomainError("fixture-timeout") }
      super.user(authority, token)
    }
  }
  private def fixture(pushGate: Option[(CountDownLatch, CountDownLatch)] = None, userGate: Option[(CountDownLatch, CountDownLatch)] = None): Fixture = {
    val root = Files.createTempDirectory("rites-scheduler-race"); val config = StoreFixture.config(root); val store = new MemoryStore(config, () => Instant.now()); store.initialize()
    val owner = store.login("owner", StoreFixture.plaintext, 3600)._1; val credential = store.saveCredential(owner, SaveCredentialRequest(None, "fixture", ForgeKind.Gitlab, "git.example.invalid", "fixture-secret", 0, CredentialMode.Token, None, None, None), (user, id, kind, host, _) => EncryptedPair(StoreFixture.vault.encrypt(user, id, kind.toString, host, "fixture-secret"), None))
    store.saveRepository(owner, SaveRepositoryRequest("repo-race", ForgeKind.Gitlab, "git.example.invalid", "group/project", "main", credential.id, 0))
    store.saveRite(owner, SaveRiteRequest("repo-race", "site", "0 0 29 2 *", "prompt.md", "model", true, 0), _ == "model")
    val run = store.manualRun(owner, ManualRunRequest("repo-race", "site", UUID.randomUUID())).run
    val prepared = PreparedRun(root, root, root, base, "Synthetic prompt", "digest-aaaa")
    val delta = CommitDelta(s"rites/repo-race/site/${run.id}", s"rites-run:${run.id}", head)
    val forge = new TrackingForge(userGate)
    val git = new GitRepository(config, TestRemoteCatalog.disabled) {
      override def prepare(authority: Authority, token: String): PreparedRun = prepared
      override def publishDelta(prepared: PreparedRun, authority: Authority): Option[CommitDelta] = Some(delta)
      override def branchHead(authority: Authority, branch: String, token: String): Option[String] = Some(head)
      override def push(prepared: PreparedRun, authority: Authority, delta: CommitDelta, token: String): Unit = pushGate.foreach { case (entered, release) => entered.countDown(); assert(release.await(30, TimeUnit.SECONDS)) }
    }
    val tokens = new ForgeTokens { def withToken[A](authority: Authority)(operation: String => A): A = operation("fixture-secret") }
    val publication = new PublicationService(store, git, forge, tokens, config)
    val agent = new AgentRunner { def run(workspace: Path, prompt: String, id: UUID, model: ModelConfig): rites.worker.RunOutcome = rites.worker.RunOutcome.Completed }
    val models = RuntimeModels(List(ModelConfig("model", "fixture", "fixture-model", "off", io.circe.Json.obj())))
    val coordinator = new RunCoordinator(store, models, git, agent, publication, logstage.IzLogger())
    Fixture(store, owner, run, new Scheduler(store, config, coordinator, publication, logstage.IzLogger()), forge, git, tokens, prepared)
  }
  test("production scheduler never reconciles the same in-flight run before original completion") {
    val entered = new CountDownLatch(1); val release = new CountDownLatch(1); val f = fixture(pushGate = Some((entered, release)))
    val fiber = f.scheduler.run.start.unsafeRunSync()
    try {
      assert(entered.await(10, TimeUnit.SECONDS), "original execution reached post-intent barrier")
      // Keep polling while the original worker holds its post-intent barrier.
      Thread.sleep(500)
      assertEquals(f.forge.userCalls.get, 0); assertEquals(f.forge.createCalls, 0)
      assertEquals(f.store.run(f.owner, f.run.id).state, RunState.PublicationUncertain)
      release.countDown()
      val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
      while (f.store.run(f.owner, f.run.id).state != RunState.Published && System.nanoTime() < deadline) Thread.sleep(25)
      val result = f.store.run(f.owner, f.run.id)
      assertEquals(result.state, RunState.Published); assertEquals(f.forge.createCalls, 1)
      assertEquals(result.baseRevision, Some(base)); assertEquals(result.promptDigest, Some("digest-aaaa")); assert(result.proposalUrl.nonEmpty)
    } finally { release.countDown(); fiber.cancel.unsafeRunSync(); f.store.close() }
  }
  test("periodic reconciliation failure releases reservation for subsequent retry") {
    val f = fixture(); f.store.claimNext(Instant.now()); f.store.persistIntent(f.run.id, s"rites/repo-race/site/${f.run.id}", s"rites-run:${f.run.id}", head)
    try {
      f.forge.userError = Some(DomainError("fixture-remote-failure")); f.scheduler.reconcilePendingOnce().unsafeRunSync()
      assertEquals(f.forge.userCalls.get, 1); assertEquals(f.store.run(f.owner, f.run.id).state, RunState.PublicationUncertain)
      f.forge.userError = None; f.scheduler.reconcilePendingOnce().unsafeRunSync()
      assertEquals(f.forge.createCalls, 1); assertEquals(f.forge.userCalls.get, 2); assertEquals(f.store.run(f.owner, f.run.id).state, RunState.Published)
    } finally f.store.close()
  }
  test("held periodic reconciliation runs once per run and releases its guard for retry") {
    val entered = new CountDownLatch(1); val release = new CountDownLatch(1); val f = fixture(userGate = Some((entered, release)))
    f.store.claimNext(Instant.now()); f.store.persistIntent(f.run.id, s"rites/repo-race/site/${f.run.id}", s"rites-run:${f.run.id}", head)
    try {
      val first = f.scheduler.reconcilePendingOnce().start.unsafeRunSync()
      assert(entered.await(10, TimeUnit.SECONDS))
      val second = f.scheduler.reconcilePendingOnce().timeout(250.millis).attempt.unsafeRunSync()
      assert(second.isRight, "another poll for the same run must finish as a guarded no-op, not enter callback")
      assertEquals(f.forge.userCalls.get, 1); assertEquals(f.forge.createCalls, 0)
      release.countDown(); first.joinWithNever.timeout(10.seconds).unsafeRunSync()
      assertEquals(f.forge.createCalls, 1); assertEquals(f.store.run(f.owner, f.run.id).state, RunState.Published)
    } finally { release.countDown(); f.store.close() }
  }
}
