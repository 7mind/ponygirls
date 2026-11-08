package rites

import io.circe.Json
import java.nio.charset.StandardCharsets
import java.nio.file.{Files, OpenOption, Path, StandardOpenOption}
import rites.worker.{ModelSelection, RunOutcome, RunRequest, RunResult}
import scala.collection.mutable

trait AgentRunner { def run(workspace: Path, prompt: String, runId: java.util.UUID, model: ModelConfig): RunOutcome }
final class ProcessAgentRunner(config: Config) extends AgentRunner {
  private def modelFile(model: ModelConfig): Json = model.workerDocument
  def run(workspace: Path, prompt: String, runId: java.util.UUID, model: ModelConfig): RunOutcome = {
    val secretPath = workspace.resolve(".rites-model.json")
    try runWithSecret(workspace, prompt, runId, model, secretPath) finally Files.deleteIfExists(secretPath)
  }
  private def runWithSecret(workspace: Path, prompt: String, runId: java.util.UUID, model: ModelConfig, secretPath: Path): RunOutcome = {
    val selection = ModelSelection(model.provider, model.model, model.thinkingLevel)
    val request = RunRequest("0.1.0", runId, prompt, selection)
    val stdin = (JsonSupport.encode(RunRequest.codecJson, request).noSpaces + "\n").getBytes(StandardCharsets.UTF_8)
    Check(stdin.length <= 1048576, "invalid", "worker input exceeds bound")
    Files.createDirectories(workspace.resolve("home"))
    Files.writeString(secretPath, modelFile(model).noSpaces, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)
    try Files.setPosixFilePermissions(secretPath, java.util.Set.of(java.nio.file.attribute.PosixFilePermission.OWNER_READ, java.nio.file.attribute.PosixFilePermission.OWNER_WRITE))
    catch { case _: UnsupportedOperationException => () }
    val output = Processes.run(List(config.workerCommand, workspace.toString, secretPath.toString, config.scheduler.runTimeoutSeconds.toString), workspace, Processes.pathEnvironment + ("HOME" -> workspace.resolve("home").toString), stdin, 1048576, config.scheduler.runTimeoutSeconds + 5, "deadline")
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
