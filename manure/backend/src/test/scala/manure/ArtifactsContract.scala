package manure

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import java.nio.file.Files
import munit.FunSuite

/** Specified-origin shared business contract. Memory metadata is a handwritten
  * dummy; BOTH legs use actual no-follow filesystem payloads. BG + controlled
  * Good-Communication. Exact PostgreSQL locks are separately tested, not faked.
  */
abstract class ArtifactsContract(postgres: Boolean) extends FunSuite:
  private def run(body: BackendFixture => IO[Unit]): Unit = BackendFixture.resource(postgres).use(body).unsafeRunSync()
  private val bytes = Exact.utf8("durable 馬 payload")
  private def request(visibility: Visibility = Visibility.Internal,data: Array[Byte] = bytes): InitUpload =
    InitUpload("name\u0000É",ArtifactKind.File,visibility,Vector(ManifestEntry("資料/file.txt",false,data.length,SecretCodec.sha256(data))),None)
  private def uploaded(f: BackendFixture,visibility: Visibility = Visibility.Internal): IO[Artifact] = for
    initialized <- f.artifacts.init(f.identity,request(visibility))
    _ <- f.artifacts.putChunk(f.identity,initialized.artifact.id,"資料/file.txt",0,bytes,SecretCodec.sha256(bytes))
    ready <- f.artifacts.finish(f.identity,initialized.artifact.id)
  yield ready
  private def fails[A](code: String,work: IO[A]): IO[Unit] = work.attempt.map {
    case Left(error: DomainError) => assertEquals(error.code,code)
    case result => fail("expected sanitized " + code + ", got " + result.map(_ => "success"))
  }
  test("NUL/Unicode metadata, exact reservations and complete upload/publish/read/delete") { run { f => for
    initialized <- f.artifacts.init(f.identity,request(Visibility.Public))
    _ <- IO { assertEquals(initialized.externalPassword,None); assertEquals(initialized.artifact.name,"name\u0000É") }
    reservation <- f.metadata.transaction(_.reservation)
    _ <- IO(assertEquals(reservation,bytes.length.toLong))
    _ <- f.artifacts.putChunk(f.identity,initialized.artifact.id,"資料/file.txt",0,bytes,SecretCodec.sha256(bytes))
    progress <- f.artifacts.status(f.identity,initialized.artifact.id)
    _ <- IO(assertEquals(progress.files.head.ranges,Vector((0L,bytes.length.toLong))))
    ready <- f.artifacts.finish(f.identity,initialized.artifact.id)
    _ <- IO(assertEquals(ready.state,UploadState.Ready))
    _ <- f.artifacts.openContent(ready.id,"資料/file.txt",None,None,None).use { (_,file) => IO.blocking(assertEquals(file.read(0,1024).toVector,bytes.toVector)) }
    _ <- f.artifacts.delete(f.other,ready.id) // Shared ready catalogue: any live manager may delete.
    _ <- fails("not-found",f.artifacts.contentInfo(ready.id,None,None,None))
    total <- f.metadata.transaction(_.reservation)
    _ <- IO(assertEquals(total,0L))
  yield () }}
  test("shared incomplete reads and abort coexist with owner-only upload mutations") { run { f => for
    a <- f.artifacts.init(f.identity,request())
    visible <- f.artifacts.info(f.other,a.artifact.id)
    _ <- IO(assertEquals(visible.id,a.artifact.id))
    status <- f.artifacts.status(f.other,a.artifact.id)
    _ <- IO(assertEquals(status.state,UploadState.Uploading))
    page <- new Catalogue(f.artifacts,f.config.limits,f.clock).list(f.other,manure.api.CatalogueQuery("",false,None,None,manure.api.CatalogueSort.CreatedAt,manure.api.SortDirection.Desc,20,None))
    _ <- IO(assert(page._1.exists(_.id == a.artifact.id)))
    _ <- fails("session-not-owned",f.artifacts.patch(f.other,a.artifact.id,ArtifactPatch(Some("forbidden"),None,TtlPatch.Unchanged)))
    updated <- f.artifacts.patch(f.identity,a.artifact.id,ArtifactPatch(Some("owner patch"),None,TtlPatch.Unchanged))
    _ <- IO(assertEquals(updated.artifact.name,"owner patch"))
    _ <- fails("session-not-owned",f.artifacts.putChunk(f.other,a.artifact.id,"資料/file.txt",0,bytes,SecretCodec.sha256(bytes)))
    _ <- f.metadata.transaction(tx => tx.put(a.artifact.copy(state=UploadState.Publishing)))
    _ <- fails("session-not-owned",f.artifacts.finish(f.other,a.artifact.id))
    state <- f.metadata.transaction(_.artifact(a.artifact.id).get.state)
    _ <- IO(assertEquals(state,UploadState.Publishing))
    _ <- f.artifacts.delete(f.other,a.artifact.id)
    _ <- fails("not-found",f.artifacts.info(f.identity,a.artifact.id))
  yield () }}
  test("any manager may rotate an incomplete external password without advancing activity") { run { f => for
    a <- f.artifacts.init(f.identity,request(Visibility.External))
    _ <- IO { f.clock.now += 5 }
    password <- f.artifacts.rotate(f.other,a.artifact.id)
    updated <- f.artifacts.info(f.other,a.artifact.id)
    _ <- IO { assert(SecretCodec.verify(password,updated.externalPasswordHash.get)); assertEquals(updated.lastActivityAt,a.artifact.lastActivityAt) }
  yield () }}
  test("chunk ACK follows file+parent fsync and durable receipt commit; retry heals corrupt bytes") { run { f => for
    a <- f.artifacts.init(f.identity,request())
    _ <- IO { f.faults.armed = Set("before_receipt_commit") }
    _ <- fails("unavailable",f.artifacts.putChunk(f.identity,a.artifact.id,"資料/file.txt",0,bytes,SecretCodec.sha256(bytes)))
    missing <- f.artifacts.status(f.identity,a.artifact.id)
    _ <- IO(assertEquals(missing.files.head.receivedBytes,0L))
    _ <- f.artifacts.putChunk(f.identity,a.artifact.id,"資料/file.txt",0,bytes,SecretCodec.sha256(bytes))
    _ <- IO.blocking(Files.write(f.rootPath.resolve("staging/" + a.artifact.id + "/tree/資料/file.txt"),Exact.utf8("corrupt")))
    _ <- f.artifacts.putChunk(f.identity,a.artifact.id,"資料/file.txt",0,bytes,SecretCodec.sha256(bytes))
    data <- IO.blocking(Files.readAllBytes(f.rootPath.resolve("staging/" + a.artifact.id + "/tree/資料/file.txt")))
    _ <- IO(assertEquals(data.toVector,bytes.toVector))
    conflict = bytes.updated(0,'X'.toByte)
    _ <- fails("chunk-conflict",f.artifacts.putChunk(f.identity,a.artifact.id,"資料/file.txt",0,conflict,SecretCodec.sha256(conflict)))
  yield () }}
  test("each publish crash window remains unserved then restart reconciles ready or resumable") { run { f =>
    List("publishing_commit","after_publishing_commit","after_tree_fsync","after_rename","fsync_live_dir","fsync_data_dir","before_ready_commit","ready_commit").traverse_ { window => for
      a <- f.artifacts.init(f.identity,request(Visibility.Public))
      _ <- f.artifacts.putChunk(f.identity,a.artifact.id,"資料/file.txt",0,bytes,SecretCodec.sha256(bytes))
      _ <- IO { f.faults.armed = Set(window) }
      _ <- fails("unavailable",f.artifacts.finish(f.identity,a.artifact.id))
      before <- f.metadata.transaction(_.artifact(a.artifact.id).get)
      _ <- IO(assert(before.state != UploadState.Ready))
      _ <- fails("not-found",f.artifacts.contentInfo(a.artifact.id,None,None,None))
      _ <- f.artifacts.reconcile()
      reconciled <- f.metadata.transaction(_.artifact(a.artifact.id).get)
      ready <- if reconciled.state == UploadState.Ready then IO.pure(reconciled) else f.artifacts.finish(f.identity,a.artifact.id)
      _ <- IO(assertEquals(ready.state,UploadState.Ready))
      _ <- f.artifacts.openContent(ready.id,"資料/file.txt",None,None,None).use((_,file) => IO.blocking(assertEquals(file.read(0,1024).toVector,bytes.toVector)))
    yield () }
  }}
  test("hash mismatch repairs receipts before reporting and never serves a partial ready tree") { run { f => for
    a <- f.artifacts.init(f.identity,request(Visibility.Public))
    _ <- f.artifacts.putChunk(f.identity,a.artifact.id,"資料/file.txt",0,bytes,SecretCodec.sha256(bytes))
    _ <- IO.blocking(Files.write(f.rootPath.resolve("staging/" + a.artifact.id + "/tree/資料/file.txt"),Array.fill(bytes.length)('x'.toByte)))
    _ <- fails("hash-mismatch",f.artifacts.finish(f.identity,a.artifact.id))
    progress <- f.artifacts.status(f.identity,a.artifact.id)
    _ <- IO(assertEquals(progress.files.head.receivedBytes,0L))
    _ <- fails("not-found",f.artifacts.contentInfo(a.artifact.id,None,None,None))
    _ <- f.artifacts.putChunk(f.identity,a.artifact.id,"資料/file.txt",0,bytes,SecretCodec.sha256(bytes))
    _ <- f.artifacts.finish(f.identity,a.artifact.id)
  yield () }}
  test("directory-only, zero-byte and nested manifests preserve real empty topology") { run { f =>
    val entries = Vector(ManifestEntry("empty/deep",true),ManifestEntry("zero",false,0,SecretCodec.sha256(Array.emptyByteArray)))
    for
      a <- f.artifacts.init(f.identity,InitUpload("dirs",ArtifactKind.Directory,Visibility.Public,entries,None))
      ready <- f.artifacts.finish(f.identity,a.artifact.id)
      _ <- IO { assert(Files.isDirectory(f.rootPath.resolve("live/"+ready.id+"/empty/deep"))); assertEquals(Files.size(f.rootPath.resolve("live/"+ready.id+"/zero")),0L) }
    yield ()
  }}
  test("external password one-time disclosure, original grant expiry/binding and rotation") { run { f => for
    a <- f.artifacts.init(f.identity,request(Visibility.External))
    password = a.externalPassword.get
    _ <- IO(assert(!a.artifact.toString.contains(password)))
    _ <- f.artifacts.putChunk(f.identity,a.artifact.id,"資料/file.txt",0,bytes,SecretCodec.sha256(bytes))
    _ <- f.artifacts.finish(f.identity,a.artifact.id)
    issued <- f.artifacts.unlock(a.artifact.id,password)
    _ <- f.artifacts.contentInfo(a.artifact.id,Some(issued._1),None,None)
    other <- uploaded(f,Visibility.External)
    _ <- fails("password-required",f.artifacts.contentInfo(other.id,Some(issued._1),None,None))
    rotated <- f.artifacts.rotate(f.identity,a.artifact.id)
    _ <- IO(assert(rotated != password))
    _ <- fails("password-required",f.artifacts.contentInfo(a.artifact.id,Some(issued._1),None,None))
    _ <- fails("password-invalid",f.artifacts.unlock(a.artifact.id,password))
    newer <- f.artifacts.unlock(a.artifact.id,rotated)
    _ <- IO { f.clock.now = newer._2 }
    _ <- fails("password-required",f.artifacts.contentInfo(a.artifact.id,Some(newer._1),None,None))
  yield () }}
  test("grant capacity keeps newly issued grant even when its hash sorts below timestamp-tied predecessor") { run { f =>
    val tokens = Vector(0.toByte,1.toByte).map(b => java.util.Base64.getUrlEncoder.withoutPadding().encodeToString(Array.fill[Byte](32)(b))).sortBy(SecretCodec.sha256)
    for
      a <- uploaded(f,Visibility.External)
      _ <- f.metadata.transaction { tx =>
        val now = f.clock.now
        tx.putContent(ContentGrant(SecretCodec.sha256(tokens(1)),a.id,now+100,now,None,None,None,a.externalPasswordHash))
        tx.putContent(ContentGrant(SecretCodec.sha256(tokens(0)),a.id,now+100,now,None,None,None,a.externalPasswordHash))
        tx.trimContent(a.id,1,SecretCodec.sha256(tokens(0)))
      }
      _ <- f.artifacts.contentInfo(a.id,Some(tokens(0)),None,None)
      _ <- fails("password-required",f.artifacts.contentInfo(a.id,Some(tokens(1)),None,None))
    yield ()
  }}
  test("single-use handoff and token-bound content grant revoke at logout and credential change") { run { f => for
    a <- uploaded(f)
    handoff <- f.artifacts.createGrant(f.identity,a.id)
    grant <- f.artifacts.redeem(a.id,handoff)
    _ <- fails("grant-invalid",f.artifacts.redeem(a.id,handoff))
    _ <- f.artifacts.contentInfo(a.id,Some(grant._1),None,None)
    _ <- f.artifacts.logout(f.identity)
    _ <- fails("grant-required",f.artifacts.contentInfo(a.id,Some(grant._1),None,None))
    second <- f.artifacts.createGrant(f.identity,a.id)
    secondGrant <- f.artifacts.redeem(a.id,second)
    _ <- IO.blocking(Files.writeString(f.config.users.head.tokens.head.hashFile,SecretCodec.sha256(SecretCodec.token())+"\n"))
    _ <- fails("grant-required",f.artifacts.contentInfo(a.id,Some(secondGrant._1),None,None))
    _ <- fails("unauthorized",f.artifacts.info(f.identity,a.id))
  yield () }}
  test("expiry uses original float64 boundary; publishing is not idle-swept") { run { f => for
    a <- f.artifacts.init(f.identity,request(Visibility.Public).copy(expiresInSeconds=Some(60)))
    expiry = a.artifact.expiresAtSeconds.get
    _ <- IO { f.clock.now = Math.nextDown(expiry) }
    _ <- f.artifacts.info(f.identity,a.artifact.id)
    _ <- IO { f.clock.now = expiry }
    _ <- fails("expired",f.artifacts.info(f.identity,a.artifact.id))
    removed <- f.artifacts.sweep()
    _ <- IO(assertEquals(removed,1))
    b <- f.artifacts.init(f.identity,request())
    _ <- f.metadata.transaction(tx => tx.put(b.artifact.copy(state=UploadState.Publishing)))
    _ <- IO { f.clock.now += f.config.limits.incompleteSessionTtl+1 }
    _ <- f.artifacts.sweep()
    still <- f.metadata.transaction(_.artifact(b.artifact.id))
    _ <- IO(assertEquals(still.map(_.state),Some(UploadState.Publishing)))
  yield () }}
  test("symlink payload parent/leaf cannot redirect writes, hashes, serving or deletion") { run { f => for
    a <- f.artifacts.init(f.identity,request())
    outside <- IO.blocking(Files.createTempDirectory(f.rootPath.getParent,"outside-"))
    sentinel <- IO.blocking(Files.writeString(outside.resolve("sentinel"),"untouched"))
    parent = f.rootPath.resolve("staging/" + a.artifact.id + "/tree/資料")
    _ <- IO.blocking { Files.delete(parent); Files.createSymbolicLink(parent,outside) }
    result <- f.artifacts.putChunk(f.identity,a.artifact.id,"資料/file.txt",0,bytes,SecretCodec.sha256(bytes)).attempt
    _ <- IO { assert(result.isLeft); assertEquals(Files.readString(sentinel),"untouched"); assert(!Files.exists(outside.resolve("file.txt"))) }
    _ <- f.artifacts.delete(f.identity,a.artifact.id)
    _ <- IO(assertEquals(Files.readString(sentinel),"untouched"))
  yield () }}

final class ArtifactsMemorySuite extends ArtifactsContract(false)
final class ArtifactsPostgresSuite extends ArtifactsContract(true)
