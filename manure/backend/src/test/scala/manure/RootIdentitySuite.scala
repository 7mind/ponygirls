package manure

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import java.nio.file.{Files,Path}
import manure.storage.*
import scala.util.Using

final class RootIdentitySuite extends munit.FunSuite:
  private def witness(handle: String,pod: String): RootVolumeWitness =
    RootVolumeWitness(RootVolume("storage.example.test",handle),pod,"pvc-witness","pv-witness",Path.of("/data"))
  private def writeMarker(root: ConfinedDirectory,bytes: Array[Byte]): Unit =
    Using.resource(root.createFile(RootMarker.Name)) { file => file.write(0,bytes);file.forceFile() }
    root.forceRootDirectory()
  test("CSI identity preserves opaque handles and rejects malformed identifiers") {
    val driver="storage.example.test"
    val volume=RootVolume(driver,"tenant/volume:horse-馬")
    val expected=io.circe.Json.arr(io.circe.Json.fromString("manure-csi-volume-v1"),io.circe.Json.fromString(driver),
      io.circe.Json.fromString(volume.handle)).noSpaces.getBytes(java.nio.charset.StandardCharsets.UTF_8)
    assertEquals(volume.digest,SecretCodec.sha256(expected))
    Vector("", "a..b", "-a.example", "UPPER.example").foreach(value => intercept[DomainError](RootVolume(value,"owned")))
    Vector("", "bad\nhandle", "x"*257, 0xd800.toChar.toString).foreach(value => intercept[DomainError](RootVolume(driver,value)))
  }
  test("versioned root codecs preserve unsigned inode bits and reject unknown/truncated formats") {
    val physical=PhysicalRootBinding(64800L,-1L)
    val portable=PortableRootBinding("ab"*32,-1L,"cd"*32)
    Vector(physical,portable).foreach(binding => assertEquals(RootBinding.decode(binding.bytes),binding))
    Vector(Array.emptyByteArray,new Array[Byte](17),portable.bytes.drop(1),portable.bytes.updated(0,0.toByte)).foreach { invalid =>
      intercept[DomainError](RootBinding.decode(invalid))
    }
  }
  test("durable binding excludes pod/object/mount witnesses but distinguishes cloned volume") {
    BackendFixture.resource(false).use { fixture => IO {
      val bytes=Array.tabulate[Byte](RootMarker.Bytes)(_.toByte)
      writeMarker(fixture.root,bytes)
      val first=RootMarker.binding(fixture.root,witness("computedisk-original","pod-before"))
      val moved=witness("computedisk-original","pod-after").copy(pvcUid="recreated-pvc",pvUid="recreated-pv",mountPath=Path.of("/other-mount"))
      assertEquals(RootMarker.binding(fixture.root,moved),first)
      assert(RootMarker.binding(fixture.root,witness("computedisk-clone","pod-clone")) != first)
      assertEquals(Files.readAllBytes(fixture.rootPath.resolve(RootMarker.Name.toString)).toVector,bytes.toVector)
    }}.unsafeRunSync()
  }
  test("directory copy on the same volume does not inherit root ownership") {
    BackendFixture.resource(false).use { fixture => IO {
      val bytes=Array.fill[Byte](RootMarker.Bytes)(7)
      writeMarker(fixture.root,bytes)
      val observed=witness("computedisk-original","pod")
      val first=RootMarker.binding(fixture.root,observed)
      val copied=Files.createDirectory(fixture.rootPath.resolve("copied-root"))
      Using.resource(ConfinedDirectory.open(copied,PosixNative.shared(sys.env("MANURE_POSIX_LIBRARY")))) { root =>
        writeMarker(root,bytes)
        assert(RootMarker.binding(root,observed) != first)
      }
    }}.unsafeRunSync()
  }
  test("missing or partial marker refuses and is never created or completed by observation") {
    BackendFixture.resource(false).use { fixture => IO {
      assertEquals(RootMarker.read(fixture.root),None)
      intercept[DomainError](RootMarker.binding(fixture.root,witness("computedisk-original","pod")))
      assert(!Files.exists(fixture.rootPath.resolve(RootMarker.Name.toString)))
      writeMarker(fixture.root,Array[Byte](1))
      intercept[DomainError](RootMarker.read(fixture.root))
      assertEquals(Files.size(fixture.rootPath.resolve(RootMarker.Name.toString)),1L)
    }}.unsafeRunSync()
  }
  test("replacing marker bytes changes the binding even when the root inode is unchanged") {
    BackendFixture.resource(false).use { fixture => IO {
      val observed=witness("computedisk-original","pod")
      writeMarker(fixture.root,Array.fill[Byte](RootMarker.Bytes)(1))
      val first=RootMarker.binding(fixture.root,observed)
      Using.resource(fixture.root.openExistingFile(RootMarker.Name,ExistingFileAccess.ReadWrite))(_.write(0,Array.fill[Byte](RootMarker.Bytes)(2)))
      val second=RootMarker.binding(fixture.root,observed)
      assertEquals(first.inode,second.inode)
      assert(first != second)
    }}.unsafeRunSync()
  }
