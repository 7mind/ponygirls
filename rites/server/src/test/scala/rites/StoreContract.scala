package rites

import java.nio.file.Files
import java.time.Instant
import java.util.UUID
import rites.api.*

object StoreFixture {
  val plaintext = "fixture-password" // test fixture only, never a configured identity credential
  val passwordHash = Password.hash(plaintext.toCharArray)
  def config(root: java.nio.file.Path, jdbc: Option[(String, String, String)] = None): Config = {
    Files.createDirectories(root.resolve("work")); Files.createDirectories(root.resolve("cache"))
    val hashFile = root.resolve("password.hash"); Files.writeString(hashFile, passwordHash)
    val dbPassword = root.resolve("database.password"); Files.writeString(dbPassword, jdbc.map(_._3).getOrElse("fixture"))
    val users = List("owner", "editor", "viewer").map(id => UserConfig(id, id, hashFile.toString, true))
    val jdbcParts = jdbc.getOrElse(("jdbc:postgresql://127.0.0.1:5432/rites", "rites", "fixture"))
    Config("127.0.0.1", 18448, "http://127.0.0.1:18448", false, true, jdbcParts._1, jdbcParts._2, dbPassword.toString,
      ponygirls.runtime.JdbcLimits(8, 64, scala.concurrent.duration.DurationInt(5).seconds, scala.concurrent.duration.DurationInt(5).seconds, scala.concurrent.duration.DurationInt(30).seconds, scala.concurrent.duration.DurationInt(35).seconds, scala.concurrent.duration.DurationInt(60).seconds, scala.concurrent.duration.DurationInt(35).seconds),
      users, root.resolve("vault").toString, "true", None, root.resolve("work").toString, root.resolve("cache").toString,
      65536, 3600, 262144, 1048576, 1000, SchedulerConfig(100, 32, 4, 30),
      List(ForgeConfig(ForgeKind.Gitlab, "git.example.invalid", "https://git.example.invalid/api/v4", "https://git.example.invalid")), List(ModelRef("model", "fixture", "fixture-model", "off", root.resolve("model.json").toString)),
      List(OAuthClientConfig("client", "git.example.invalid", "Fixture client", "https://git.example.invalid/oauth/token", "fixture-client-id", None, "https://app.example.invalid/oauth/callback", 300)), true)
  }
  val vault = new Vault(new javax.crypto.spec.SecretKeySpec(Array.fill[Byte](32)(9), "AES"), "fixture")
}
abstract class StoreContract extends munit.FunSuite {
  protected def newStore: RitesStore
  protected def identity(store: RitesStore, user: String): Identity = store.login(user, StoreFixture.plaintext, 3600)._1
  private def request(id: Option[UUID] = None, revision: Int = 0, mode: CredentialMode = CredentialMode.Token): SaveCredentialRequest =
    SaveCredentialRequest(id, "Maintenance 🐎", ForgeKind.Gitlab, "git.example.invalid", "fixture-secret", revision, mode,
      if (mode == CredentialMode.Oauth) Some("client") else None, if (mode == CredentialMode.Oauth) Some("fixture-refresh") else None,
      if (mode == CredentialMode.Oauth) Some(Instant.now().plusSeconds(200).toString) else None)
  private def material(request: SaveCredentialRequest)(owner: String, id: UUID, forge: ForgeKind, host: String, generation: Int): EncryptedPair =
    EncryptedPair(StoreFixture.vault.encrypt(owner, id, forge.toString, host, request.secret), request.refreshToken.map(StoreFixture.vault.encryptRefresh(owner, id, forge.toString, host, _)))
  protected def credential(store: RitesStore, owner: Identity, request: SaveCredentialRequest = request()): CredentialInfo = store.saveCredential(owner, request, material(request))
  protected def repository(store: RitesStore, owner: Identity, id: String, credentialId: UUID, revision: Int = 0): RepositoryInfo =
    store.saveRepository(owner, SaveRepositoryRequest(id, ForgeKind.Gitlab, "git.example.invalid", "group/project", "main", credentialId, revision))
  protected def rite(store: RitesStore, owner: Identity, id: String, repositoryId: String, revision: Int = 0, schedule: String = "0 0 * * *"): RiteInfo =
    store.saveRite(owner, SaveRiteRequest(repositoryId, id, schedule, "prompt.md", "model", true, revision), _ == "model")
  private def configured(body: RitesStore => Unit): Unit = { val store = newStore; try body(store) finally store.close() }
  test("credential ownership and metadata never expose secrets") { configured { store =>
    val owner = identity(store, "owner"); val viewer = identity(store, "viewer")
    val saved = credential(store, owner)
    assertEquals(store.credentials(owner).map(_.id), List(saved.id)); assert(store.credentials(viewer).isEmpty)
    val encoded = JsonSupport.encode(CredentialInfo.codecJson, saved).noSpaces
    assert(!encoded.contains("fixture-secret") && !encoded.contains("ciphertext") && !encoded.contains("fixture-client-id"))
  } }
  test("credential deletion cannot cross users") { configured { store =>
    val owner = identity(store, "owner"); val viewer = identity(store, "viewer"); val saved = credential(store, owner)
    val error = intercept[DomainError](store.deleteCredential(viewer, DeleteCredentialRequest(saved.id, saved.revision)))
    assertEquals(error.code, "not-found"); assertEquals(store.credentials(owner).size, 1)
  } }
  test("owner grants editors rites and viewers read while owner remains immutable") { configured { store =>
    val owner = identity(store, "owner"); val editor = identity(store, "editor"); val viewer = identity(store, "viewer")
    val cred = credential(store, owner); val repo = repository(store, owner, "repo-grants", cred.id)
    intercept[DomainError](rite(store, viewer, "site", repo.id))
    val shared = store.setGrant(owner, SetGrantRequest(repo.id, "editor", Some(GrantRole.Editor), repo.revision))
    assertEquals(rite(store, editor, "site", repo.id).repositoryId, repo.id)
    intercept[DomainError](store.rites(viewer, repo.id))
    assertEquals(store.repositories(viewer).size, 0)
    intercept[DomainError](store.setGrant(owner, SetGrantRequest(repo.id, "owner", Some(GrantRole.Viewer), shared.revision)))
    store.setGrant(owner, SetGrantRequest(repo.id, "editor", None, shared.revision))
  } }
  test("grant removal revokes queued work and status is caller-scoped") { configured { store =>
    val owner = identity(store, "owner"); val editor = identity(store, "editor"); val viewer = identity(store, "viewer")
    val cred = credential(store, owner); val repo = repository(store, owner, "repo-revoke", cred.id); rite(store, owner, "site", repo.id)
    val shared = store.setGrant(owner, SetGrantRequest(repo.id, "editor", Some(GrantRole.Editor), repo.revision))
    val run = store.manualRun(editor, ManualRunRequest(repo.id, "site", UUID.randomUUID())).run
    assertEquals(store.status(editor).queuedRuns, 1L); assertEquals(store.status(viewer).queuedRuns, 0L)
    store.setGrant(owner, SetGrantRequest(repo.id, "editor", None, shared.revision))
    assertEquals(store.run(owner, run.id).state, RunState.Failed); assert(store.claimNext(Instant.now()).isEmpty)
  } }
  test("two coordinators atomically admit one scheduled cursor and coalesce after completion") { configured { store =>
    val owner = identity(store, "owner"); val cred = credential(store, owner); repository(store, owner, "repo-cron", cred.id)
    rite(store, owner, "site", "repo-cron", schedule = "* * * * *")
    val now = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MINUTES).plusSeconds(86400)
    val other = newStore
    val admitted = try {
      import scala.concurrent.ExecutionContext.Implicits.global
      val first = scala.concurrent.Future(store.admitScheduled(now, 32)); val second = scala.concurrent.Future(other.admitScheduled(now, 32))
      scala.concurrent.Await.result(first.zip(second), scala.concurrent.duration.DurationInt(30).seconds) match { case (a, b) => a + b }
    } finally other.close()
    assertEquals(admitted, 1); assertEquals(store.admitScheduled(now, 32), 0)
    val authority = store.claimNext(now).get; store.complete(authority.run.id, RunCompletion(RunState.NoChange, None))
    assertEquals(store.admitScheduled(now, 32), 0)
    assertEquals(store.admitScheduled(now.plusSeconds(86400), 32), 1)
  } }
  test("exact manual retry rechecks current repository access") { configured { store =>
    val owner = identity(store, "owner"); val editor = identity(store, "editor")
    val cred = credential(store, owner); val repo = repository(store, owner, "repo-replay", cred.id); rite(store, owner, "site", repo.id)
    val shared = store.setGrant(owner, SetGrantRequest(repo.id, "editor", Some(GrantRole.Editor), repo.revision))
    val requestId = UUID.randomUUID(); store.manualRun(editor, ManualRunRequest(repo.id, "site", requestId))
    store.setGrant(owner, SetGrantRequest(repo.id, "editor", None, shared.revision))
    assertEquals(intercept[DomainError](store.manualRun(editor, ManualRunRequest(repo.id, "site", requestId))).code, "not-found")
  } }
  test("claimed authority retains distinct repository and rite identities/revisions") { configured { store =>
    val owner = identity(store, "owner"); val cred = credential(store, owner); val created = repository(store, owner, "repo-distinct", cred.id)
    rite(store, owner, "rite-distinct", created.id)
    repository(store, owner, created.id, cred.id, created.revision)
    rite(store, owner, "rite-distinct", created.id, revision = 1)
    store.manualRun(owner, ManualRunRequest(created.id, "rite-distinct", UUID.randomUUID()))
    val authority = store.claimNext(Instant.now()).get
    assertEquals(authority.repository.id, "repo-distinct"); assertEquals(authority.rite.id, "rite-distinct")
    assertEquals(authority.repository.revision, 2); assertEquals(authority.rite.revision, 2)
  } }
  test("rite edit revokes every actor queued run and clears active cursor") { configured { store =>
    val owner = identity(store, "owner"); val editor = identity(store, "editor"); val cred = credential(store, owner); val repo = repository(store, owner, "repo-edit-rite", cred.id); val site = rite(store, owner, "site", repo.id)
    val shared = store.setGrant(owner, SetGrantRequest(repo.id, "editor", Some(GrantRole.Editor), repo.revision))
    store.manualRun(editor, ManualRunRequest(repo.id, "site", UUID.randomUUID()))
    rite(store, owner, "site", repo.id, revision = site.revision)
    val admitted = store.manualRun(editor, ManualRunRequest(repo.id, "site", UUID.randomUUID()))
    assert(admitted.admitted); assertEquals(store.run(owner, admitted.run.id).state, RunState.Queued)
  } }
  test("long downtime coalesces to one latest occurrence without minute iteration exhaustion") { configured { store =>
    val owner = identity(store, "owner"); val cred = credential(store, owner); repository(store, owner, "repo-catchup", cred.id); rite(store, owner, "site", "repo-catchup", schedule = "* * * * *")
    val now = Instant.now().plusSeconds(150L * 86400L)
    assertEquals(store.admitScheduled(now, 32), 1)
    val runs = store.runs(owner, "repo-catchup", "site"); assertEquals(runs.size, 1)
    assertEquals(runs.head.trigger, RunTrigger.Schedule)
  } }
  test("restart fails interrupted agent without reviving queued work") { configured { store =>
    val owner = identity(store, "owner"); val cred = credential(store, owner); repository(store, owner, "repo-restart", cred.id); rite(store, owner, "site", "repo-restart")
    val run = store.manualRun(owner, ManualRunRequest("repo-restart", "site", UUID.randomUUID())).run
    assertEquals(store.claimNext(Instant.now()).get.run.id, run.id)
    store.recoverInterrupted(); assertEquals(store.run(owner, run.id).state, RunState.Failed)
    assert(store.claimNext(Instant.now()).isEmpty)
  } }
  test("OAuth rotation preserves user revision but CAS rejects manual replacement race") { configured { store =>
    val owner = identity(store, "owner"); val saved = credential(store, owner, request(mode = CredentialMode.Oauth))
    val first = store.beginTokenUse(saved.id, Instant.now(), _ => 300).asInstanceOf[RefreshTicket]
    val access = StoreFixture.vault.encrypt(owner.userId, saved.id, "Gitlab", saved.host, "new-access")
    val refresh = StoreFixture.vault.encryptRefresh(owner.userId, saved.id, "Gitlab", saved.host, "new-refresh")
    val replacement = request(Some(saved.id), saved.revision, CredentialMode.Oauth)
    store.saveCredential(owner, replacement, material(replacement))
    intercept[DomainError](store.finishRefresh(first, access, refresh, Instant.now().plusSeconds(7200)))
  } }
  test("OAuth refresh uncertain state fails closed without secret echo") { configured { store =>
    val owner = identity(store, "owner"); val saved = credential(store, owner, request(mode = CredentialMode.Oauth))
    val ticket = store.beginTokenUse(saved.id, Instant.now(), _ => 300).asInstanceOf[RefreshTicket]
    store.failRefresh(ticket, uncertain = true)
    assertEquals(store.credentials(owner).head.refreshHealth, Some(RefreshHealth.Uncertain))
    assertEquals(intercept[DomainError](store.beginTokenUse(saved.id, Instant.now(), _ => 300)).code, "refresh-uncertain")
    val text = JsonSupport.encode(CredentialsResult.codecJson, CredentialsResult(store.credentials(owner))).noSpaces
    assert(!text.contains("fixture-secret") && !text.contains("fixture-refresh"))
  } }
}
final class MemoryStoreContract extends StoreContract {
  private val root = Files.createTempDirectory("rites-memory-contract")
  private val config = StoreFixture.config(root)
  protected def newStore: RitesStore = { val store = new MemoryStore(config, () => Instant.now()); store.initialize(); store }
}
