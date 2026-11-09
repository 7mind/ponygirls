package rites

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path}
import java.nio.file.attribute.PosixFilePermissions
import munit.FunSuite

class GitAskpassTest extends FunSuite {
  test("askpass uses provisioned executables without conventional host paths") {
    val content = GitAskpass.render(Path.of("/repro/credential"), sys.env("PATH"))
    assert(!content.startsWith("#!/bin/sh\n"))
    assert(!content.contains("exec /bin/cat "))
    val artifact = Path.of("target/askpass-portability/askpass")
    Files.createDirectories(artifact.getParent)
    Files.writeString(artifact, content)
    Files.setPosixFilePermissions(artifact, PosixFilePermissions.fromString("rwx------"))
  }

  test("askpass preserves credential paths containing shell metacharacters") {
    val root = Files.createTempDirectory("rites-askpass-test-")
    try {
      val credential = root.resolve("credential '$value with spaces")
      val expected = "synthetic-credential-é"
      Files.writeString(credential, expected)
      Files.setPosixFilePermissions(credential, PosixFilePermissions.fromString("rw-------"))
      val script = root.resolve("askpass")
      Files.writeString(script, GitAskpass.render(credential, sys.env("PATH")))
      Files.setPosixFilePermissions(script, PosixFilePermissions.fromString("rwx------"))
      val output = Processes.run(List(script.toString, "Password"), root, Map("PATH" -> "/no-runtime-tools"), Array.emptyByteArray, 4096, 5, "deadline")
      assertEquals(output.code, 0)
      assertEquals(new String(output.stdout, StandardCharsets.UTF_8), expected)
      val unsupported = Processes.run(List(script.toString, "Username"), root, Map("PATH" -> "/no-runtime-tools"), Array.emptyByteArray, 4096, 5, "deadline")
      assertEquals(unsupported.code, 1)
      assertEquals(unsupported.stdout.length, 0)
    } finally {
      val files = Files.walk(root)
      try files.sorted(java.util.Comparator.reverseOrder()).forEach(path => { Files.delete(path); () }) finally files.close()
    }
  }

  test("missing helper executables fail before constructing an unusable askpass") {
    val error = intercept[DomainError](GitAskpass.render(Path.of("/repro/credential"), "/no-runtime-tools"))
    assertEquals(error.code, "toolchain-unavailable")
  }
}
