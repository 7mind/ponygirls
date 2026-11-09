package rites

import io.circe.Json
import java.nio.charset.StandardCharsets
import java.nio.file.{Files, LinkOption, Path, StandardOpenOption}
import java.nio.file.attribute.{PosixFilePermission, PosixFilePermissions}
import rites.worker.{ModelSelection, RunOutcome, RunRequest, RunResult}
import scala.jdk.CollectionConverters.*

trait AgentRunner { def run(workspace: Path, prompt: String, runId: java.util.UUID, model: ModelConfig): RunOutcome }
final class ProcessAgentRunner(config: Config) extends AgentRunner {
  private def modelFile(model: ModelConfig): Json = model.workerDocument
  private val directoryPermissions = java.util.Set.of(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE, PosixFilePermission.OWNER_EXECUTE)
  private val filePermissions = java.util.Set.of(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE)
  /** The tool workspace is untrusted. Model settings live only in a private,
    * coordinator-owned sibling of the repository workspace, never in a tool mount.
    */
  def run(workspace: Path, prompt: String, runId: java.util.UUID, model: ModelConfig): RunOutcome = {
    Files.createDirectories(config.cacheRootPath)
    val cache = config.cacheRootPath.toRealPath(LinkOption.NOFOLLOW_LINKS)
    val configuration = Files.createTempDirectory(cache, "model-run-").toRealPath(LinkOption.NOFOLLOW_LINKS)
    try {
      Files.setPosixFilePermissions(configuration, directoryPermissions)
      val canonicalWorkspace = workspace.toRealPath(LinkOption.NOFOLLOW_LINKS)
      Check(!configuration.startsWith(canonicalWorkspace) && configuration.startsWith(cache), "workspace-boundary", "model configuration must be outside tool workspace")
      val secretPath = configuration.resolve("model.json")
      Files.createFile(secretPath, PosixFilePermissions.asFileAttribute(filePermissions))
      Files.writeString(secretPath, modelFile(model).noSpaces, StandardOpenOption.WRITE, StandardOpenOption.TRUNCATE_EXISTING)
      Files.setPosixFilePermissions(secretPath, filePermissions)
      val home = Files.createDirectory(configuration.resolve("home"))
      Files.setPosixFilePermissions(home, directoryPermissions)
      try runWithSecret(workspace, prompt, runId, model, secretPath, home) finally deleteTree(configuration)
    } catch { case error: Throwable => deleteTree(configuration); throw error }
  }
  private def deleteTree(root: Path): Unit = if (Files.exists(root, LinkOption.NOFOLLOW_LINKS)) {
    val paths = scala.util.Using.resource(Files.walk(root))(_.iterator.asScala.toList.sorted.reverse)
    paths.foreach(Files.deleteIfExists)
  }
  private def runWithSecret(workspace: Path, prompt: String, runId: java.util.UUID, model: ModelConfig, secretPath: Path, home: Path): RunOutcome = {
    val selection = ModelSelection(model.provider, model.model, model.thinkingLevel)
    val request = RunRequest("0.1.0", runId, prompt, selection)
    val stdin = (JsonSupport.encode(RunRequest.codecJson, request).noSpaces + "\n").getBytes(StandardCharsets.UTF_8)
    Check(stdin.length <= 1048576, "invalid", "worker input exceeds bound")
    val output = Processes.run(List(config.workerCommand, workspace.toString, secretPath.toString, config.scheduler.runTimeoutSeconds.toString), workspace, Processes.pathEnvironment + ("HOME" -> home.toString), stdin, 1048576, config.scheduler.runTimeoutSeconds + 5, "deadline")
    // A deadline/worker tree failure above overrides any previously captured completion.
    val deadlineFailure = output.code != 0
    val result = try JsonSupport.decode(RunResult.codecJson, JsonSupport.parse(new String(output.stdout, StandardCharsets.UTF_8))) catch { case _: DomainError => throw DomainError("worker-protocol", "invalid worker response") }
    Check(!deadlineFailure && result.protocolVersion == "0.1.0" && result.runId == runId, "worker-protocol", "worker exit or identity mismatch")
    result.outcome match {
      case RunOutcome.Completed => Check(result.failureCode.isEmpty, "worker-protocol", "completion cannot carry a failure"); RunOutcome.Completed
      case RunOutcome.Failed | RunOutcome.Cancelled => Check(result.failureCode.exists(c => c.nonEmpty && c.length <= 128 && c.matches("[a-z0-9-]+")), "worker-protocol", "invalid terminal failure"); result.outcome
    }
  }
}
