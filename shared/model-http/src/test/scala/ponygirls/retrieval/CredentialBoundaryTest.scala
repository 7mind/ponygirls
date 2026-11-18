package ponygirls.retrieval

import cats.effect.unsafe.implicits.global
import java.nio.file.Files

class CredentialBoundaryTest extends munit.FunSuite {
  test("Blackbox-GoodCommunication: actual byte bound, strict UTF8, managed symlinks and explicit empty auth policy") {
    val directory=Files.createTempDirectory("controlled-model-credential")
    val regular=directory.resolve("resolved"); val link=directory.resolve("managed")
    try {
      Files.write(regular,Array.emptyByteArray); Files.createSymbolicLink(link,regular)
      assertEquals(JsonHttp.credential(link.toString).unsafeRunSync(),"")
      Files.writeString(regular,"controlled-bearer\n")
      assertEquals(JsonHttp.credential(link.toString).unsafeRunSync(),"controlled-bearer")
      Files.write(regular,Array.fill[Byte](16385)('x'.toByte))
      assert(JsonHttp.credential(link.toString).attempt.unsafeRunSync().isLeft)
      Files.write(regular,Array[Byte](0xc3.toByte,0x28.toByte))
      assert(JsonHttp.credential(link.toString).attempt.unsafeRunSync().isLeft)
    } finally { Files.deleteIfExists(link); Files.deleteIfExists(regular); Files.delete(directory) }
  }
}
