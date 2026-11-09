package rites

import io.circe.Json
import java.nio.file.{Files, Path}
import java.nio.file.attribute.PosixFilePermission
import java.time.Instant
import java.util.UUID
import rites.worker.RunOutcome
import scala.sys.process.*

final class AgentRunnerTest extends munit.FunSuite {
  private val runId = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
  private def quote(value: String): String = "'" + value.replace("'", "'\"'\"'") + "'"
  private def model: ModelConfig = {
    val document = Json.obj(
      "provider" -> Json.fromString("fixture"),
      "modelsJson" -> Json.obj("providers" -> Json.obj("fixture" -> Json.obj(
        "name" -> Json.fromString("Synthetic provider"), "baseUrl" -> Json.fromString("https://model.example.invalid/v1"),
        "api" -> Json.fromString("synthetic-broker-api"), "headers" -> Json.obj("X-Synthetic" -> Json.fromString("preserved")),
        "models" -> Json.arr(Json.obj("id" -> Json.fromString("fixture-model"), "name" -> Json.fromString("Synthetic model"), "reasoning" -> Json.fromBoolean(false), "contextWindow" -> Json.fromInt(4096), "maxTokens" -> Json.fromInt(512), "cost" -> Json.obj("input" -> Json.fromInt(0), "output" -> Json.fromInt(0), "cacheRead" -> Json.fromInt(0), "cacheWrite" -> Json.fromInt(0)))
      )))),
      "credential" -> Json.obj("type" -> Json.fromString("api_key"), "key" -> Json.fromString("synthetic-inference-secret"))
    )
    ModelConfig("model", "fixture", "fixture-model", "off", document)
  }
  private def worker(root: Path, report: Path, succeed: Boolean): Path = {
    val script = root.resolve("fake-worker")
    val output = if (succeed) "printf '%s\\n' '{\"protocolVersion\":\"0.1.0\",\"runId\":\"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\",\"outcome\":\"Completed\",\"failureCode\":null}'" else "exit 1"
    Files.writeString(script, s"""#!/bin/sh
set -eu
cat >/dev/null
readlink -f "$$2" >${quote(report.resolve("provided-path").toString)}
stat -c '%a' "$$(dirname "$$2")" >${quote(report.resolve("directory-mode").toString)}
stat -c '%a' "$$2" >${quote(report.resolve("file-mode").toString)}
stat -c '%u' "$$(dirname "$$2")" >${quote(report.resolve("directory-owner").toString)}
cp "$$2" ${quote(report.resolve("document.json").toString)}
$output
""")
    Files.setPosixFilePermissions(script, java.util.Set.of(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE, PosixFilePermission.OWNER_EXECUTE)); script
  }
  private def fixture(succeed: Boolean): (ProcessAgentRunner, ModelConfig, Path, Path, Path) = {
    val root = Files.createTempDirectory("rites-agent-boundary"); val observed = root.resolve("observed"); Files.createDirectory(observed)
    val cache = root.resolve("coordinator-cache"); val workspace = root.resolve("workspace"); Files.createDirectories(workspace)
    val config = StoreFixture.config(root.resolve("config")).copy(cacheRoot = cache.toString, workerCommand = worker(root, observed, succeed).toString)
    Files.createDirectories(cache)
    (new ProcessAgentRunner(config), model, workspace, observed, cache)
  }
  private def text(path: Path): String = Files.readString(path).trim
  private def assertBoundary(observed: Path, expected: ModelConfig, workspace: Path): Unit = {
    val path = Path.of(text(observed.resolve("provided-path"))); val canonicalWorkspace = workspace.toRealPath()
    assertEquals(JsonSupport.parse(Files.readString(observed.resolve("document.json"))), expected.workerDocument)
    assert(Files.readString(observed.resolve("document.json")).contains("synthetic-inference-secret"), "fake worker must actually read the synthetic credential while running")
    assert(!path.startsWith(canonicalWorkspace), s"model configuration leaked into tool workspace: $path")
    assertEquals(text(observed.resolve("directory-mode")), "700"); assertEquals(text(observed.resolve("file-mode")), "600")
    assertEquals(text(observed.resolve("directory-owner")), Files.getAttribute(observed, "unix:uid", java.nio.file.LinkOption.NOFOLLOW_LINKS).toString)
    assert(!Files.exists(path, java.nio.file.LinkOption.NOFOLLOW_LINKS), "private configuration must be deleted after worker termination")
    assert(!Files.exists(path.getParent, java.nio.file.LinkOption.NOFOLLOW_LINKS), "private configuration directory must be deleted after worker termination")
    assert(!Files.exists(workspace.resolve(".rites-model.json"), java.nio.file.LinkOption.NOFOLLOW_LINKS)); assert(!Files.exists(workspace.resolve("home"), java.nio.file.LinkOption.NOFOLLOW_LINKS))
  }
  test("completed worker receives exact model fragment only through private outside-workspace config") {
    val (runner, selected, workspace, observed, cache) = fixture(true)
    assertEquals(runner.run(workspace, "Synthetic prompt", runId, selected), RunOutcome.Completed)
    assertBoundary(observed, selected, workspace)
  }
  test("failed worker also cleans private outside-workspace config") {
    val (runner, selected, workspace, observed, cache) = fixture(false)
    assertEquals(intercept[DomainError](runner.run(workspace, "Synthetic prompt", runId, selected)).code, "worker-protocol")
    assertBoundary(observed, selected, workspace)
  }
}
