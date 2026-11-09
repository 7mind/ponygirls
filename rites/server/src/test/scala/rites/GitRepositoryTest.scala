package rites

import java.nio.file.{Files, Path}
import java.time.Instant
import java.util.UUID
import rites.api.*
import scala.sys.process.*

final class GitRepositoryTest extends munit.FunSuite {
  private def repository(root: Path): Path = {
    val source = root.resolve("source"); val bare = root.resolve("remote.git"); Files.createDirectories(source)
    assert(("git init -b main " + source.toString).! == 0)
    assert(Seq("git", "-C", source.toString, "config", "user.name", "Fixture").! == 0)
    assert(Seq("git", "-C", source.toString, "config", "user.email", "fixture@example.invalid").! == 0)
    Files.writeString(source.resolve("prompt.md"), "Make a tracked change.\n"); Files.writeString(source.resolve("run.sh"), "#!/bin/sh\nexit 0\n"); Files.writeString(source.resolve("obsolete.txt"), "remove\n")
    assert(Seq("git", "-C", source.toString, "add", "--", ".").! == 0); assert(Seq("git", "-C", source.toString, "commit", "-m", "fixture base").! == 0)
    assert(Seq("git", "clone", "--bare", "--", source.toString, bare.toString).! == 0); bare
  }
  private def authority(root: Path, remote: Path): (MemoryStore, Config, GitRepository, Authority) = {
    val config = StoreFixture.config(root)
    val store = new MemoryStore(config, () => Instant.now()); store.initialize()
    val owner = store.login("owner", StoreFixture.plaintext, 3600)._1
    val credential = store.saveCredential(owner, SaveCredentialRequest(None, "fixture", ForgeKind.Gitlab, "git.example.invalid", "fixture-secret", 0, CredentialMode.Token, None, None, None),
      (user, id, kind, host, _) => EncryptedPair(StoreFixture.vault.encrypt(user, id, kind.toString, host, "fixture-secret"), None))
    store.saveRepository(owner, SaveRepositoryRequest("repo-git", ForgeKind.Gitlab, "git.example.invalid", "group/project", "main", credential.id, 0))
    store.saveRite(owner, SaveRiteRequest("repo-git", "site", "* * * * *", "prompt.md", "model", true, 0), _ == "model")
    val id = store.manualRun(owner, ManualRunRequest("repo-git", "site", UUID.randomUUID())).run.id
    (store, config, new GitRepository(config, TestRemoteCatalog.fixture(Map("repo-git" -> remote.toString))), store.claimNext(Instant.now()).get)
  }
  test("coordinator ignores worker Git metadata and exports new/delete/mode changes") {
    val root = Files.createTempDirectory("rites-git-delta"); val bare = repository(root); val (store, config, git, run) = authority(root, bare)
    try {
      val ready = git.prepare(run, "fixture-secret"); assert(git.publishDelta(ready, run).isEmpty)
      Files.writeString(ready.workspace.resolve("new.txt"), "new\n"); Files.delete(ready.workspace.resolve("obsolete.txt"))
      Files.writeString(ready.workspace.resolve(".rites-model.json"), "public-output-history-not-a-credential\n")
      Files.setPosixFilePermissions(ready.workspace.resolve("run.sh"), java.util.Set.of(java.nio.file.attribute.PosixFilePermission.OWNER_READ, java.nio.file.attribute.PosixFilePermission.OWNER_WRITE, java.nio.file.attribute.PosixFilePermission.OWNER_EXECUTE))
      Files.createDirectories(ready.workspace.resolve(".git/hooks")); Files.writeString(ready.workspace.resolve(".git/config"), "[core]\nrepositoryformatversion=99\n")
      val delta = git.publishDelta(ready, run).get
      assertEquals(delta.commit, (s"git -C ${ready.publication} rev-parse HEAD").!!.trim)
      assert(!(s"git -C ${ready.publication} diff HEAD^ HEAD --name-status").!!.contains(".git/config"))
      val diff = (s"git -C ${ready.publication} diff HEAD^ HEAD --summary").!!
      assert(diff.contains("mode change 100644 => 100755 run.sh")); assert(diff.contains("delete mode 100644 obsolete.txt")); assert(diff.contains("create mode 100644 new.txt"))
      assertEquals((s"git -C ${ready.publication} show HEAD:.rites-model.json").!!.trim, "public-output-history-not-a-credential")
      git.push(ready, run, delta, "fixture-secret")
      assertEquals((s"git --git-dir=$bare rev-parse refs/heads/${delta.branch}").!!.trim, delta.commit)
      git.cleanup(ready)
    } finally store.close()
  }
  test("restart after push verifies recorded head on unique branch before one create") {
    val root = Files.createTempDirectory("rites-git-push-recovery"); val bare = repository(root); val (store, config, git, run) = authority(root, bare)
    try {
      val ready = git.prepare(run, "fixture-secret"); Files.writeString(ready.workspace.resolve("change.txt"), "committed-before-crash\n"); val value = git.publishDelta(ready, run).get
      store.persistIntent(run.run.id, value.branch, value.marker, value.commit)
      git.push(ready, run, value, "fixture-secret")
      // Simulate crash after remote push but before publication_stage=Pushed. No
      // process-local delta or prepared publication checkout reaches the new service.
      val forge = new FixtureForge
      val tokens = new ForgeTokens { def withToken[A](authority: Authority)(operation: String => A): A = operation("fixture-secret") }
      new PublicationService(store, git, forge, tokens, config).reconcile(run.run.id, None)
      assertEquals(forge.createCalls, 1); assertEquals(store.run(store.login("owner", StoreFixture.plaintext, 3600)._1, run.run.id).state, RunState.Published)
      assertEquals((s"git --git-dir=$bare rev-parse refs/heads/${value.branch}").!!.trim, value.commit)
    } finally store.close()
  }
  test("remote branch mismatch blocks create and retains explicit owner-intervention uncertainty") {
    val root = Files.createTempDirectory("rites-git-mismatch-recovery"); val bare = repository(root); val (store, config, git, run) = authority(root, bare)
    try {
      val ready = git.prepare(run, "fixture-secret"); Files.writeString(ready.workspace.resolve("change.txt"), "expected-change\n"); val value = git.publishDelta(ready, run).get
      store.persistIntent(run.run.id, value.branch, value.marker, value.commit); git.push(ready, run, value, "fixture-secret")
      val main = (s"git --git-dir=$bare rev-parse refs/heads/main").!!.trim
      assert(Seq("git", "--git-dir=" + bare, "update-ref", "refs/heads/" + value.branch, main).! == 0)
      val forge = new FixtureForge
      val tokens = new ForgeTokens { def withToken[A](authority: Authority)(operation: String => A): A = operation("fixture-secret") }
      val error = intercept[DomainError](new PublicationService(store, git, forge, tokens, config).reconcile(run.run.id, None))
      val owner = store.login("owner", StoreFixture.plaintext, 3600)._1
      assertEquals(error.code, "publication-head-unverified"); assertEquals(forge.createCalls, 0)
      assertEquals(store.run(owner, run.run.id).state, RunState.PublicationUncertain)
      assertEquals(store.publicationStage(run.run.id), "Intent"); assertEquals(intercept[DomainError](store.manualRun(owner, ManualRunRequest("repo-git", "site", UUID.randomUUID()))).code, "conflict")
      assertEquals((s"git --git-dir=$bare rev-parse refs/heads/${value.branch}").!!.trim, main, "mismatched remote branch is never rewritten during reconciliation")
    } finally store.close()
  }
  test("worker symlinks and special files never reach coordinator checkout") {
    val root = Files.createTempDirectory("rites-git-symlink"); val bare = repository(root); val (store, config, git, run) = authority(root, bare)
    try {
      val ready = git.prepare(run, "fixture-secret"); Files.createSymbolicLink(ready.workspace.resolve("link"), ready.workspace.resolve("run.sh"))
      assertEquals(intercept[DomainError](git.publishDelta(ready, run)).code, "hostile-workspace")
    } finally store.close()
  }
  test("fresh base and exact regular Markdown prompt are required") {
    val root = Files.createTempDirectory("rites-git-base"); val source = root.resolve("source"); val bare = repository(root)
    Files.writeString(source.resolve("prompt.md"), "Second base prompt.\n"); assert(Seq("git", "-C", source.toString, "add", "prompt.md").! == 0); assert(Seq("git", "-C", source.toString, "commit", "-m", "new prompt").! == 0); assert(Seq("git", "-C", source.toString, "push", bare.toString, "main").! == 0)
    val (store, config, git, run) = authority(root, bare)
    try {
      val ready = git.prepare(run, "fixture-secret"); assertEquals(ready.prompt, "Second base prompt.\n")
      val head = (s"git --git-dir=$bare rev-parse refs/heads/main").!!.trim; assertEquals(ready.base, head)
    } finally store.close()
  }
}
