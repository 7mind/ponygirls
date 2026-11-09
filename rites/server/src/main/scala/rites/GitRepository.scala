package rites

import java.nio.charset.StandardCharsets
import java.nio.file.{DirectoryNotEmptyException, FileVisitResult, Files, LinkOption, Path, SimpleFileVisitor, StandardCopyOption}
import java.nio.file.attribute.BasicFileAttributes
import scala.collection.mutable
import scala.jdk.CollectionConverters.*

final case class PreparedRun(root: Path, workspace: Path, publication: Path, base: String, prompt: String, promptDigest: String)
final case class CommitDelta(branch: String, marker: String, commit: String)
trait TestRemoteCatalog { def lookup(repositoryId: String): Option[String] }
object TestRemoteCatalog {
  val disabled: TestRemoteCatalog = new TestRemoteCatalog { def lookup(repositoryId: String): Option[String] = None }
  def fixture(values: Map[String, String]): TestRemoteCatalog = new TestRemoteCatalog { def lookup(repositoryId: String): Option[String] = values.get(repositoryId) }
}
class GitRepository(config: Config, remotes: TestRemoteCatalog) {
  private val maintenance = new Object
  private val baseEnv = Processes.pathEnvironment ++ Map("GIT_CONFIG_NOSYSTEM" -> "1", "GIT_TERMINAL_PROMPT" -> "0", "GIT_CONFIG_GLOBAL" -> "/dev/null", "GIT_CEILING_DIRECTORIES" -> config.workspaceRoot)
  private def text(bytes: Array[Byte]): String = StandardCharsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT).decode(java.nio.ByteBuffer.wrap(bytes)).toString
  private def git(args: List[String], cwd: Path, token: Option[String], allow: Set[Int] = Set(0)): String = {
    val baseArgs = List("git", "-c", "core.hooksPath=/dev/null", "-c", "credential.helper=", "-c", "http.followRedirects=false", "-c", "protocol.ext.allow=never") ++ args
    token match {
      case None =>
        val output = Processes.run(baseArgs, cwd, baseEnv, Array.emptyByteArray, 65536, 120, "git-timeout"); Check(allow.contains(output.code), "git-failed", "git operation failed"); text(output.stdout).trim
      case Some(secret) =>
        val home = Files.createTempDirectory(config.workspaceRootPath, "auth-"); val ask = home.resolve("askpass")
        // The token appears only in this mode-0700/0600 private askpass scratch file.
        Files.writeString(home.resolve("credential"), secret, java.nio.file.StandardOpenOption.CREATE_NEW)
        val content = "#!/bin/sh\ncase \"$1\" in *Password*) exec /bin/cat \"" + home.resolve("credential") + "\";; *) exit 1;; esac\n"
        Files.writeString(ask, content, java.nio.file.StandardOpenOption.CREATE_NEW); Files.setPosixFilePermissions(ask, java.util.Set.of(java.nio.file.attribute.PosixFilePermission.OWNER_READ, java.nio.file.attribute.PosixFilePermission.OWNER_WRITE, java.nio.file.attribute.PosixFilePermission.OWNER_EXECUTE))
        try {
          val output = Processes.run(baseArgs, cwd, baseEnv ++ Map("GIT_ASKPASS" -> ask.toString, "HOME" -> home.toString), Array.emptyByteArray, 65536, 120, "git-timeout"); Check(allow.contains(output.code), "git-failed", "git operation failed"); text(output.stdout).trim
        } finally delete(home)
    }
  }
  private def forgeUrl(authority: Authority): String = {
    config.forge(authority.forge, authority.host)
    remotes.lookup(authority.repository.id) match {
      case Some(local) => Check(config.testMode && (local.startsWith("file://") || local.startsWith("/")), "config", "test remotes require explicit test mode"); local
      case None =>
        val user = if (authority.forge == rites.api.ForgeKind.Github) "x-access-token" else "oauth2"
        val clone = config.forge(authority.forge, authority.host).cloneUri(config.testMode)
        val project = authority.project.split('/').map(p => java.net.URLEncoder.encode(p, java.nio.charset.StandardCharsets.UTF_8).replace("+", "%20")).mkString("/")
        s"${clone.getScheme}://$user@${clone.getRawAuthority}${clone.getRawPath.stripSuffix("/")}/$project.git"
    }
  }
  private def validateBasePaths(cache: Path, base: String): Unit = {
    val raw = git(List("-C", cache.toString, "ls-tree", "-r", base), config.root, None)
    raw.linesIterator.filter(_.nonEmpty).foreach { line =>
      val mode = line.takeWhile(_ != ' '); val path = line.dropWhile(_ != '\t').drop(1)
      Check(mode != "120000" && mode != "160000", "unsupported-repository", "symlinks and submodules are not supported")
    }
  }
  def prepare(authority: Authority, token: String): PreparedRun = maintenance.synchronized {
    val repoId = authority.repository.id; val cache = config.cachePath(repoId); Files.createDirectories(config.root); Files.createDirectories(config.cacheRootPath)
    val url = forgeUrl(authority)
    if (!Files.exists(cache)) {
      delete(cache); git(List("clone", "--mirror", "--no-checkout", "--", url, cache.toString), config.root, Some(token))
    } else {
      git(List("-C", cache.toString, "remote", "set-url", "origin", url), config.root, None)
      git(List("-C", cache.toString, "fetch", "--prune", "--no-tags", "origin", "+refs/heads/*:refs/heads/*"), config.root, Some(token))
    }
    val base = git(List("-C", cache.toString, "rev-parse", s"refs/heads/${authority.baseBranch}^{commit}"), config.root, None)
    Check(base.matches("[0-9a-f]{40,64}"), "git-failed", "invalid base revision")
    validateBasePaths(cache, base)
    val entry = git(List("-C", cache.toString, "ls-tree", base, "--", authority.rite.promptPath), config.root, None)
    Check(entry.nonEmpty && (entry.startsWith("100644 blob ") || entry.startsWith("100755 blob ")), "invalid-prompt", "prompt must be a regular Markdown blob")
    val promptBytes = gitBytes(List("-C", cache.toString, "cat-file", "blob", s"$base:${authority.rite.promptPath}"), config.maxPromptBytes)
    Check(promptBytes.nonEmpty && promptBytes.length <= config.maxPromptBytes, "invalid-prompt", "prompt empty or too large")
    val prompt = text(promptBytes)
    val root = Files.createTempDirectory(config.workspaceRootPath, "run-"); val workspace = root.resolve("workspace"); val publication = root.resolve("publication")
    freshCheckout(cache, workspace, base); freshCheckout(cache, publication, base)
    deleteGitMetadata(workspace)
    PreparedRun(root, workspace, publication, base, prompt, Hash.sha256(promptBytes))
  }
  private def gitBytes(args: List[String], bound: Int): Array[Byte] = {
    val full = List("git", "-c", "core.hooksPath=/dev/null", "-c", "credential.helper=", "-c", "protocol.ext.allow=never") ++ args
    val output = Processes.run(full, config.root, baseEnv, Array.emptyByteArray, bound, 120, "git-timeout"); Check(output.code == 0, "invalid-prompt", "prompt read failed"); output.stdout
  }
  private def freshCheckout(cache: Path, target: Path, base: String): Unit = {
    git(List("clone", "--no-hardlinks", "--shared", "--no-checkout", "--no-tags", "--", cache.toString, target.toString), config.root, None)
    git(List("-C", target.toString, "checkout", "--detach", base), config.root, None)
  }
  private def deleteGitMetadata(workspace: Path): Unit = {
    val dot = workspace.resolve(".git")
    if (Files.isDirectory(dot, LinkOption.NOFOLLOW_LINKS)) delete(dot)
    else if (Files.isRegularFile(dot, LinkOption.NOFOLLOW_LINKS)) {
      val text = Files.readString(dot); val location = text.stripPrefix("gitdir:").trim; val path = workspace.resolve(location).normalize(); delete(path); Files.delete(dot)
    } else Check(!Files.exists(dot, LinkOption.NOFOLLOW_LINKS), "git-failed", "invalid workspace metadata")
  }
  def publishDelta(prepared: PreparedRun, authority: Authority): Option[CommitDelta] = {
    val pub = prepared.publication
    val branch = s"rites/${authority.repository.id}/${authority.rite.id}/${authority.run.id.toString}"
    val marker = s"rites-run:${authority.run.id.toString}"
    git(List("-C", pub.toString, "checkout", "-B", branch, prepared.base), config.root, None)
    scala.util.Using.resource(Files.list(pub))(_.filter(p => p.getFileName.toString != ".git").forEach(p => delete(p)))
    var files = 0
    Files.walkFileTree(prepared.workspace, new SimpleFileVisitor[Path] {
      override def preVisitDirectory(dir: Path, attrs: BasicFileAttributes): FileVisitResult = {
        val relative = prepared.workspace.relativize(dir)
        if (relative.iterator.asScala.exists(_.toString == ".git")) FileVisitResult.SKIP_SUBTREE else {
          val target = pub.resolve(relative); Files.createDirectories(target); FileVisitResult.CONTINUE
        }
      }
      override def visitFile(file: Path, attrs: BasicFileAttributes): FileVisitResult = {
        val relative = prepared.workspace.relativize(file)
        Check(!relative.iterator.asScala.exists(_.toString == ".git") && attrs.isRegularFile && !Files.isSymbolicLink(file), "hostile-workspace", "worker export contains unsupported file")
        files += 1; Check(files <= config.maxRunFiles && attrs.size() <= config.maxFileBytes, "hostile-workspace", "worker export exceeds bounds")
        val target = pub.resolve(relative); Check(target.normalize().startsWith(pub), "hostile-workspace", "worker export traversal")
        Files.copy(file, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.COPY_ATTRIBUTES, LinkOption.NOFOLLOW_LINKS); FileVisitResult.CONTINUE
      }
      override def visitFileFailed(file: Path, error: java.io.IOException): FileVisitResult = throw DomainError("hostile-workspace", "worker export contains symlink or unreadable file")
    })
    git(List("-C", pub.toString, "add", "-A", "--", "."), config.root, None)
    val code = gitExit(List("-C", pub.toString, "diff", "--cached", "--quiet", "--exit-code"), config.root)
    if (code == 0) None else {
      val message = s"Rites ${authority.rite.id}\n\n$marker\nbase:${prepared.base}\nprompt:${prepared.promptDigest}\n"
      git(List("-C", pub.toString, "-c", "user.name=Rites", "-c", "user.email=rites@localhost", "commit", "--no-gpg-sign", "-m", message), config.root, None)
      val commit = git(List("-C", pub.toString, "rev-parse", "HEAD"), config.root, None)
      Some(CommitDelta(branch, marker, commit))
    }
  }
  private def gitExit(args: List[String], cwd: Path): Int = Processes.run(List("git", "-c", "core.hooksPath=/dev/null", "-c", "credential.helper=") ++ args, cwd, baseEnv, Array.emptyByteArray, 4096, 120, "git-timeout").code
  /** Read-only verification after a crash; does not update mirrors or trust branch contents. */
  def branchHead(authority: Authority, branch: String, token: String): Option[String] = {
    Check(branch.startsWith("rites/"), "publication-denied", "invalid publication branch")
    val raw = git(List("ls-remote", "--heads", "--exit-code", "--", forgeUrl(authority), s"refs/heads/$branch"), config.root, Some(token), Set(0, 2))
    if (raw.isEmpty) None else {
      val lines = raw.linesIterator.filter(_.nonEmpty).toList
      Check(lines.size == 1 && lines.head.takeWhile(_ != '\t').matches("[0-9a-f]{40,64}") && lines.head.endsWith(s"refs/heads/$branch"), "publication-head-unverified", "unexpected branch identity")
      Some(lines.head.takeWhile(_ != '\t'))
    }
  }
  def push(prepared: PreparedRun, authority: Authority, delta: CommitDelta, token: String): Unit = {
    Check(delta.branch.startsWith("rites/") && delta.branch != authority.baseBranch, "publication-denied", "invalid publication branch")
    git(List("-C", prepared.publication.toString, "push", "--no-force", "--", forgeUrl(authority), s"${delta.commit}:refs/heads/${delta.branch}"), config.root, Some(token))
  }
  def cleanup(prepared: PreparedRun): Unit = delete(prepared.root)
  private def delete(path: Path): Unit = if (Files.exists(path, LinkOption.NOFOLLOW_LINKS)) {
    if (Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS)) Files.walkFileTree(path, new SimpleFileVisitor[Path] {
      override def visitFile(file: Path, attrs: BasicFileAttributes): FileVisitResult = { Files.deleteIfExists(file); FileVisitResult.CONTINUE }
      override def postVisitDirectory(dir: Path, error: java.io.IOException): FileVisitResult = { Files.deleteIfExists(dir); FileVisitResult.CONTINUE }
    }) else Files.deleteIfExists(path)
  }
}
