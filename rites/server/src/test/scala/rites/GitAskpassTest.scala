package rites

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path}
import java.nio.file.attribute.PosixFilePermissions
import munit.FunSuite

class GitAskpassTest extends FunSuite {
  test("askpass uses provisioned executables without conventional host paths") {
    for ((forge, username) <- List("github" -> "x-access-token", "gitlab" -> "oauth2")) {
      val root = Path.of("target/askpass-portability", forge).toAbsolutePath
      Files.createDirectories(root)
      val credential = root.resolve("credential")
      Files.writeString(credential, "synthetic-credential")
      Files.setPosixFilePermissions(credential, PosixFilePermissions.fromString("rw-------"))
      val content = GitAskpass.render(credential, username, sys.env("PATH"))
      assert(!content.startsWith("#!/bin/sh\n"))
      assert(!content.contains("exec /bin/cat "))
      val artifact = root.resolve("askpass")
      Files.writeString(artifact, content)
      Files.setPosixFilePermissions(artifact, PosixFilePermissions.fromString("rwx------"))
    }
  }

  test("askpass preserves credential paths containing shell metacharacters") {
    val root = Files.createTempDirectory("rites-askpass-test-")
    try {
      val credential = root.resolve("credential '$value with spaces")
      val expected = "synthetic-credential-é"
      Files.writeString(credential, expected)
      Files.setPosixFilePermissions(credential, PosixFilePermissions.fromString("rw-------"))
      val script = root.resolve("askpass")
      Files.writeString(script, GitAskpass.render(credential, "x-access-token", sys.env("PATH")))
      Files.setPosixFilePermissions(script, PosixFilePermissions.fromString("rwx------"))
      val output = Processes.run(List(script.toString, "Password for 'https://Username.example.invalid'"), root, Map("PATH" -> "/no-runtime-tools"), Array.emptyByteArray, 4096, 5, "deadline")
      assertEquals(output.code, 0)
      assert(java.util.Arrays.equals(output.stdout, expected.getBytes(StandardCharsets.UTF_8)), "credential response differs")
      val unsupported = Processes.run(List(script.toString, "Unexpected Username Password prompt"), root, Map("PATH" -> "/no-runtime-tools"), Array.emptyByteArray, 4096, 5, "deadline")
      assertEquals(unsupported.code, 1)
      assertEquals(unsupported.stdout.length, 0)
    } finally {
      val files = Files.walk(root)
      try files.sorted(java.util.Comparator.reverseOrder()).forEach(path => { Files.delete(path); () }) finally files.close()
    }
  }

  test("askpass recovers the known username after rejected URL-only authentication") {
    for (username <- List("x-access-token", "oauth2", "user '$value with spaces")) {
      val root = Files.createTempDirectory("rites-askpass-username-")
      try {
        val credential = root.resolve("credential")
        Files.writeString(credential, "synthetic-credential")
        val script = root.resolve("askpass")
        Files.writeString(script, GitAskpass.render(credential, username, sys.env("PATH")))
        Files.setPosixFilePermissions(script, PosixFilePermissions.fromString("rwx------"))
        val output = Processes.run(List(script.toString, "Username for 'http://Password.example.invalid'"), root, Map("PATH" -> "/no-runtime-tools"), Array.emptyByteArray, 4096, 5, "deadline")
        assertEquals(output.code, 0)
        assertEquals(new String(output.stdout, StandardCharsets.UTF_8), username)
      } finally {
        val files = Files.walk(root)
        try files.sorted(java.util.Comparator.reverseOrder()).forEach(path => { Files.delete(path); () }) finally files.close()
      }
    }
  }

  test("missing helper executables fail before constructing an unusable askpass") {
    val error = intercept[DomainError](GitAskpass.render(Path.of("/repro/credential"), "x-access-token", "/no-runtime-tools"))
    assertEquals(error.code, "toolchain-unavailable")
  }
}
