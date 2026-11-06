package manure

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import io.circe.Json
import java.nio.file.{Files,Path}
import scala.concurrent.duration.*

final class RootAuthoritySuite extends munit.FunSuite:
  override val munitTimeout=60.seconds
  private def changed(value: Json,path: List[String],replacement: Json): Json = path match
    case key :: tail =>
      val objectValue=value.asObject.get
      Json.fromJsonObject(objectValue.add(key,if tail.isEmpty then replacement else changed(objectValue(key).get,tail,replacement)))
    case Nil => replacement
  test("authority configuration requires an explicit CSI driver pin") {
    val value=Json.obj("kind" -> Json.fromString("kubernetes-csi-v1"),"api_origin" -> Json.fromString("https://kubernetes.default.svc"),
      "ca_file" -> Json.fromString("/authority/ca"),"token_file" -> Json.fromString("/authority/token"),
      "pod_uid_file" -> Json.fromString("/authority/uid"),"namespace" -> Json.fromString("owned"),
      "pod_name" -> Json.fromString("core-0"),"container_name" -> Json.fromString("manure"))
    assertEquals(intercept[DomainError](KubernetesRootConfig.parse(value)).code,"config")
    val valid=value.mapObject(_.add("expected_csi_driver",Json.fromString("storage.example.test")))
    assertEquals(KubernetesRootConfig.parse(valid).expectedCsiDriver,"storage.example.test")
    Vector("", "UPPER.example", "a..b").foreach { driver =>
      assertEquals(intercept[DomainError](KubernetesRootConfig.parse(valid.mapObject(_.add("expected_csi_driver",Json.fromString(driver))))).code,"config")
    }
  }
  test("controlled TLS adapter independently observes Pod/PVC/PV and rechecks pod identity") {
    RootAuthorityFixture.resource.use { fixture => fixture.authority.use { authority => IO {
      val witness=authority.observe(fixture.backend.root)
      assertEquals(witness.volume,RootVolume("storage.example.test","computedisk-original"))
      assertEquals(witness.podUid,RootAuthorityFixture.PodUid)
      assertEquals(witness.pvcUid,RootAuthorityFixture.PvcUid)
      assertEquals(witness.pvUid,RootAuthorityFixture.PvUid)
      assertEquals(fixture.requests.get(),4)
    }}}.unsafeRunSync()
  }
  test("transport rejects status errors, redirect and oversized responses without retry") {
    RootAuthorityFixture.resource.use { fixture =>
      val faults=Vector(RootApiFault.Status(401),RootApiFault.Status(403),RootApiFault.Status(429),RootApiFault.Redirect,RootApiFault.Oversize)
      faults.foldLeft(IO.unit) { (previous,fault) => previous *> fixture.authority.use { authority => IO {
        fixture.fault.set(fault);val before=fixture.requests.get()
        assertEquals(intercept[DomainError](authority.observe(fixture.backend.root)).code,"authority-unavailable")
        assertEquals(fixture.requests.get()-before,1)
      }}}
    }.unsafeRunSync()
  }
  test("body deadline includes a response whose headers have already arrived") {
    RootAuthorityFixture.resource.use { fixture => fixture.authority.use { authority => IO {
      fixture.fault.set(RootApiFault.StalledBody)
      val before=System.nanoTime()
      assertEquals(intercept[DomainError](authority.observe(fixture.backend.root)).code,"authority-unavailable")
      assert((System.nanoTime()-before).nanos < 6500.millis)
    }}}.unsafeRunSync()
  }
  test("an unknown TLS authority is rejected before an API request") {
    (for
      fixture <- RootAuthorityFixture.resource
      foreign <- RootAuthorityFixture.resource
      authority <- KubernetesRootAuthority.resource(fixture.settings.copy(caFile=foreign.settings.caFile),fixture.backend.rootPath,fixture.mounts)
    yield (fixture,authority)).use { (fixture,authority) => IO {
      assertEquals(intercept[DomainError](authority.observe(fixture.backend.root)).code,"authority-unavailable")
      assertEquals(fixture.requests.get(),0)
    }}.unsafeRunSync()
  }
  test("a trusted certificate with the wrong SAN is rejected before an API request") {
    RootAuthorityFixture.withSan("DNS:wrong.example").use { fixture =>
      fixture.authority.use { authority => IO {
        assertEquals(intercept[DomainError](authority.observe(fixture.backend.root)).code,"authority-unavailable")
        assertEquals(fixture.requests.get(),0)
      }}
    }.unsafeRunSync()
  }
  test("authority rejects stale pod UID, wrong claim, unsupported access and non-CSI storage") {
    RootAuthorityFixture.resource.use { fixture =>
      val original=fixture.documents.get()
      val cases=Vector(
        original.copy(pod=changed(original.pod,List("metadata","uid"),Json.fromString("44444444-4444-4444-8444-444444444444"))),
        original.copy(pvc=changed(original.pvc,List("status","phase"),Json.fromString("Pending"))),
        original.copy(pvc=changed(original.pvc,List("spec","accessModes"),Json.arr(Json.fromString("ReadWriteMany")))),
        original.copy(pvc=changed(original.pvc,List("spec","volumeMode"),Json.fromString("Block"))),
        original.copy(pv=changed(original.pv,List("spec","claimRef","uid"),Json.fromString("44444444-4444-4444-8444-444444444444"))),
        original.copy(pv=changed(original.pv,List("spec","csi","driver"),Json.fromString("untrusted.example"))),
        original.copy(pvc=changed(original.pvc,List("metadata","ownerReferences"),Json.arr(Json.obj("kind" -> Json.fromString("Pod")))))
      )
      cases.foldLeft(IO.unit) { (previous,documents) => previous *> fixture.authority.use { authority => IO {
        fixture.documents.set(documents)
        intercept[DomainError](authority.observe(fixture.backend.root))
      }}}
    }.unsafeRunSync()
  }
  test("token alone is not a local pod witness and managed token rotation is re-read") {
    RootAuthorityFixture.resource.use { fixture => fixture.authority.use { authority => IO {
      Files.writeString(fixture.settings.podUidFile,"44444444-4444-4444-8444-444444444444")
      assertEquals(intercept[DomainError](authority.observe(fixture.backend.root)).code,"authority-mismatch")
      assertEquals(fixture.requests.get(),0)
      Files.writeString(fixture.settings.podUidFile,RootAuthorityFixture.PodUid)
      val rotated=RootAuthorityFixture.token(RootAuthorityFixture.PodUid,"rotated")
      val file=fixture.settings.tokenFile.resolveSibling("rotated-token")
      Files.writeString(file,rotated);Files.delete(fixture.settings.tokenFile);Files.createSymbolicLink(fixture.settings.tokenFile,file.getFileName)
      fixture.expectedToken.set(rotated)
      assertEquals(authority.observe(fixture.backend.root).volume.handle,"computedisk-original")
    }}}.unsafeRunSync()
  }
  test("deep malformed bounded API JSON is rejected without a fatal parser error") {
    assertEquals(intercept[DomainError](RootAuthorityJson.decode(("["*32768).getBytes(java.nio.charset.StandardCharsets.UTF_8))).code,"authority-unavailable")
  }
  test("authority inputs cannot live under the writable payload root") {
    BackendFixture.resource(false).use { fixture => IO {
      val outside=fixture.rootPath.getParent
      val settings=KubernetesRootConfig(java.net.URI.create("https://127.0.0.1:1"),outside.resolve("ca"),outside.resolve("token"),outside.resolve("uid"),"owned","core-0","manure","storage.example.test")
      Vector(settings.copy(caFile=fixture.rootPath.resolve("ca")),settings.copy(tokenFile=fixture.rootPath.resolve("token")),
        settings.copy(podUidFile=fixture.rootPath.resolve("uid"))).foreach { unsafe =>
        assertEquals(intercept[DomainError](fixture.config.copy(rootAuthority=Some(unsafe)).validate()).code,"config")
      }
    }}.unsafeRunSync()
  }
  test("kernel witness rejects propagated mounts and volume subtrees") {
    BackendFixture.resource(false).use { fixture => IO {
      val observed=fixture.root.filesystemIdentity
      val kind=observed.kind match
        case 0xef53L => "ext4"
        case 0x58465342L => "xfs"
        case _ => "unsupported"
      val snapshot=fixture.rootPath.getParent.resolve("mountinfo")
      val verifier=new KernelRootMounts(snapshot)
      val path=fixture.rootPath.toString.replace("\\","\\134").replace(" ","\\040")
      def line(root: String,optional: String): String = s"1 0 ${observed.deviceMajor}:${observed.deviceMinor} $root $path rw$optional - $kind /dev/owned rw\n"
      Files.writeString(snapshot,line("/",""))
      if kind == "unsupported" then
        assertEquals(intercept[DomainError](verifier.verify(fixture.root,fixture.rootPath,fixture.rootPath)).code,"authority-unavailable")
      else
        verifier.verify(fixture.root,fixture.rootPath,fixture.rootPath)
        Vector(line("/"," shared:7"),line("/"," master:7"),line("/"," propagate_from:7"),line("/subtree","")).foreach { contents =>
          Files.writeString(snapshot,contents)
          assertEquals(intercept[DomainError](verifier.verify(fixture.root,fixture.rootPath,fixture.rootPath)).code,"authority-mismatch")
        }
    }}.unsafeRunSync()
  }
  test("kernel mount verifier rejects a fabricated API mount against the real descriptor filesystem") {
    BackendFixture.resource(false).use { fixture => IO {
      val verifier=new KernelRootMounts(Path.of("/proc/self/mountinfo"))
      intercept[DomainError](verifier.verify(fixture.root,fixture.rootPath,fixture.rootPath))
    }}.unsafeRunSync()
  }
