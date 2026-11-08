package rites

import java.nio.file.Files
import scala.concurrent.duration.*

final class ProcessesTest extends munit.FunSuite {
  private val cwd = Files.createTempDirectory("rites-process-test")
  test("subprocess output is bounded without waiting for unlimited producer") {
    val error = intercept[DomainError](Processes.run(List("/bin/sh", "-c", "head -c 2048 /dev/zero"), cwd, Processes.pathEnvironment, Array.emptyByteArray, 32, 1, "deadline"))
    assertEquals(error.code, "worker-protocol")
  }
  test("monotonic deadline overrides shell that could otherwise ignore protocol completion") {
    val error = intercept[DomainError](Processes.run(List("/bin/sh", "-c", "sleep 30 & wait"), cwd, Processes.pathEnvironment, Array.emptyByteArray, 32, 1, "deadline"))
    assertEquals(error.code, "deadline")
  }
  test("ordinary bounded result retains exit status and bytes") {
    val output = Processes.run(List("/bin/sh", "-c", "printf fixture-result"), cwd, Processes.pathEnvironment, Array.emptyByteArray, 32, 1, "deadline")
    assertEquals(output.code, 0); assertEquals(new String(output.stdout, java.nio.charset.StandardCharsets.UTF_8), "fixture-result")
  }
}
