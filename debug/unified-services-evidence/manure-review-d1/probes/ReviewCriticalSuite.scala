package manure

import cats.effect.IO
import cats.effect.std.Semaphore
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import java.nio.file.Files
import java.sql.Connection
import java.util.concurrent.TimeUnit
import manure.storage.{ConfinedFile,OpenFileHandles}
import munit.FunSuite

object ReviewFifoChild {
  def main(args: Array[String]): Unit = {
    println("READ_STARTED")
    try { SecretCodec.readHash(java.nio.file.Path.of(args(0))); println("READ_ACCEPTED") }
    catch { case _: Exception => println("READ_REJECTED") }
  }
}

class ReviewCriticalSuite extends FunSuite {
  test("review d1: live credential FIFO must reject promptly rather than block indefinitely") {
    val dir=Files.createTempDirectory("manure-review-fifo")
    val fifo=dir.resolve("hash")
    assertEquals(new ProcessBuilder("mkfifo",fifo.toString).start().waitFor(),0)
    val outputFile=dir.resolve("child.txt")
    val child=new ProcessBuilder(java.nio.file.Path.of(System.getProperty("java.home"),"bin","java").toString,"-cp",System.getProperty("java.class.path"),"manure.ReviewFifoChild",fifo.toString).redirectErrorStream(true).redirectOutput(outputFile.toFile).start()
    try {
      val completed=child.waitFor(2,TimeUnit.SECONDS)
      if(!completed) child.destroyForcibly().waitFor()
      val output=scala.util.Using.resource(Files.newInputStream(outputFile))(input => new String(input.readNBytes(2048),java.nio.charset.StandardCharsets.UTF_8))
      println(s"REVIEW_FIFO completedWithin2s=$completed output=${output.trim}")
      assert(completed && output.contains("READ_REJECTED"),"64-byte credential FIFO was not rejected before blocking read")
    } finally { child.destroyForcibly().waitFor(); Files.deleteIfExists(fifo); Files.deleteIfExists(outputFile); Files.delete(dir) }
  }
  private val data=Exact.utf8("controlled acknowledged payload")
  private def upload(f: BackendFixture): IO[Artifact] = for {
    a <- f.artifacts.init(f.identity,InitUpload("controlled",ArtifactKind.File,Visibility.Internal,Vector(ManifestEntry("file.txt",false,data.length,SecretCodec.sha256(data))),None))
    _ <- f.artifacts.putChunk(f.identity,a.artifact.id,"file.txt",0,data,SecretCodec.sha256(data))
    ready <- f.artifacts.finish(f.identity,a.artifact.id)
  } yield ready
  test("review d1: actual PostgreSQL connection death after content FD open must not leak root-pinning handle") {
    BackendFixture.resource(true).use { f => for {
      a <- upload(f)
      gate <- Semaphore[IO](1)
      saved <- cats.effect.Ref.of[IO,Option[(Artifact,ConfinedFile)]](None)
      capture = new java.util.concurrent.atomic.AtomicReference[Option[(Artifact,ConfinedFile)]](None)
      failing = new Metadata {
        def transaction[A](body: MetadataTxn => A): IO[A] = f.database.get.transaction { c =>
          val result=body(new PostgresTxn(c,f.projection.get))
          capture.set(Some(result.asInstanceOf[(Artifact,ConfinedFile)]))
          // Owned connection only, real PostgreSQL failure after descriptor acquisition.
          Jdbc.exec(c,"SELECT pg_terminate_backend(pg_backend_pid())")
          result
        }
      }
      bad = new Artifacts(failing,f.payloads,f.config.limits,f.clock,f.auth,f.lease,gate,f.faults)
      result <- bad.openContent(a.id,"file.txt",None,None,Some(f.identity)).use(_ => IO.unit).attempt
      close <- IO.blocking(f.root.close()).attempt
      _ <- IO.blocking(capture.get().foreach(_._2.close())) // review-only cleanup of otherwise lost FD
      _ <- IO {
        println("REVIEW_FD dbFailure="+result.isLeft+" rootCloseError="+close.left.toOption.map(_.getClass.getSimpleName))
        assert(result.isLeft)
        assert(!close.left.toOption.exists(_.isInstanceOf[OpenFileHandles]),"failed Resource acquisition leaked opened content descriptor")
      }
    } yield () }.unsafeRunSync()
  }
  // Behavioral-Active Effectual GoodCommunication; regression: commit-time
  // failure is distinct from the original post-open connection-death failure.
  test("review d1: real deferred PostgreSQL COMMIT failure after content FD acquisition must close descriptor") {
    BackendFixture.resource(true).use { f => for {
      a <- upload(f)
      gate <- Semaphore[IO](1)
      capture = new java.util.concurrent.atomic.AtomicReference[Option[(Artifact,ConfinedFile)]](None)
      returned = new java.util.concurrent.atomic.AtomicBoolean(false)
      failing = new Metadata {
        def transaction[A](body: MetadataTxn => A): IO[A] = f.database.get.transaction { c =>
          val result=body(new PostgresTxn(c,f.projection.get))
          capture.set(Some(result.asInstanceOf[(Artifact,ConfinedFile)]))
          Jdbc.exec(c,"CREATE TABLE manure.review_commit_parent(id integer PRIMARY KEY)")
          Jdbc.exec(c,"CREATE TABLE manure.review_commit_child(id integer REFERENCES manure.review_commit_parent(id) DEFERRABLE INITIALLY DEFERRED)")
          Jdbc.exec(c,"INSERT INTO manure.review_commit_child VALUES(1)")
          returned.set(true) // all statements and FD acquisition succeeded; COMMIT alone must fail.
          result
        }
      }
      bad = new Artifacts(failing,f.payloads,f.config.limits,f.clock,f.auth,f.lease,gate,f.faults)
      result <- bad.openContent(a.id,"file.txt",None,None,Some(f.identity)).use(_ => IO.unit).attempt
      close <- IO.blocking(f.root.close()).attempt
      _ <- IO.blocking(capture.get().foreach(_._2.close()))
      _ <- IO {
        val state=result.left.toOption.collect {case e:ponygirls.runtime.JdbcFailure=>e.sqlState}.flatten
        println("REVIEW_COMMIT_FD callbackReturned="+returned.get()+" commitFailureState="+state+" rootCloseError="+close.left.toOption.map(_.getClass.getSimpleName))
        assert(returned.get());assertEquals(state,Some("23503"))
        assertEquals(close.left.toOption.map(_.getClass.getSimpleName),Some("OpenRootLeases"))
      }
    } yield () }.unsafeRunSync()
  }
  test("review d1: same-clock grant trimming must not delete newly issued credential") {
    BackendFixture.resource(true).use { f => for {
      a <- upload(f)
      tokens = Vector("A"*43,"A"*42+"E").sortBy(SecretCodec.sha256)
      newer = tokens.head
      older = tokens.last
      _ <- IO { assert(SecretCodec.canonical(newer)); assert(SecretCodec.canonical(older)) }
      _ <- f.metadata.transaction { tx =>
        def grant(token: String)=ContentGrant(SecretCodec.sha256(token),a.id,f.clock.now+60,f.clock.now,Some(f.identity.userId),Some(f.identity.tokenId),Some(f.identity.tokenDigest),None)
        tx.putContent(grant(older))
        tx.putContent(grant(newer))
        tx.trimContent(a.id,1,SecretCodec.sha256(newer))
      }
      newResult <- f.artifacts.contentInfo(a.id,Some(newer),None,None).attempt
      oldResult <- f.artifacts.contentInfo(a.id,Some(older),None,None).attempt
      _ <- IO {
        println("REVIEW_GRANT newlyInsertedAccepted="+newResult.isRight+" olderAccepted="+oldResult.isRight+" sameTimestamp=true bound=1")
        assert(newResult.isRight,"newest content grant was immediately removed at capacity")
      }
    } yield () }.unsafeRunSync()
  }
  test("review d1: imported first startup must refuse replaced data root instead of blessing replacement payload") {
    BackendFixture.configuration.use { (original,_,_) =>
      val control=original.dataDir.getParent.resolve("import-control")
      val dataRoot=control.resolve("data")
      val aid="1"*32; val destination="2"*32; val source="3"*64
      val good=Exact.utf8("good"); val wrong=Exact.utf8("evil")
      val cfg=original.copy(dataDir=dataRoot,migrationReceiptDir=Some(control))
      for {
        _ <- IO.blocking {
          Files.createDirectory(control)
          Files.setPosixFilePermissions(control,java.nio.file.attribute.PosixFilePermissions.fromString("rwx------"))
          Files.createDirectories(dataRoot.resolve("staging")); Files.createDirectories(dataRoot.resolve("live/"+aid))
          Files.write(dataRoot.resolve("live/"+aid+"/file.txt"),good)
          val dev=Files.getAttribute(control,"unix:dev").asInstanceOf[java.lang.Long].longValue()
          val ino=Files.getAttribute(control,"unix:ino").asInstanceOf[java.lang.Long].longValue()
          val owner=io.circe.Json.obj("id"->io.circe.Json.fromString(destination),"root"->io.circe.Json.fromString(control.toString),"device"->io.circe.Json.fromLong(dev),"inode"->io.circe.Json.fromLong(ino))
          Files.writeString(control.resolve("OWNER.json"),owner.noSpaces)
          Files.writeString(control.resolve("COMPLETE"),io.circe.Json.obj("source"->io.circe.Json.fromString(source),"destination"->io.circe.Json.fromString(destination)).noSpaces)
          cfg.validate()
        }
        _ <- ponygirls.runtime.JdbcDatabase.resource(cfg.database.copy(user=sys.env("MANURE_TEST_JDBC_USER"),passwordFile=java.nio.file.Path.of(sys.env("MANURE_TEST_JDBC_PASSWORD_FILE")))).use(_.transaction { c =>
          val ddl=Files.readString(BackendFixture.source.resolve("manure/migration/schema.sql"))
          scala.util.Using.resource(c.createStatement())(_.execute(ddl))
          Jdbc.exec(c,"CREATE SCHEMA manure_offline")
          Jdbc.exec(c,"CREATE TABLE manure_offline.destination(id text PRIMARY KEY,root text NOT NULL,source text,writes_started boolean NOT NULL)")
          Jdbc.exec(c,"INSERT INTO manure_offline.destination VALUES(?,?,?,true)",destination,control.toString,source)
          val projection=new SearchProjection(cfg,new ponygirls.retrieval.postgres.PostgresRetrieval("manure",None))
          projection.initialize(c)
          val a=Artifact(aid,"acknowledged",ArtifactKind.File,Visibility.Public,"owner","token","2023-11-14T22:13:20Z",1700000000.0,None,None,UploadState.Ready,4,1,4,None,1700000000.0,Manifest.encode(Vector(ManifestEntry("file.txt",false,4,SecretCodec.sha256(good)))))
          new PostgresTxn(c,projection).put(a)
          Require(cfg.database.user.matches("manure_runtime_[0-9a-f]+"),"controlled-fixture")
          Jdbc.exec(c,"GRANT USAGE ON SCHEMA manure_offline TO "+cfg.database.user)
          Jdbc.exec(c,"GRANT SELECT ON manure_offline.destination TO "+cfg.database.user)
          Jdbc.exec(c,"GRANT ALL ON ALL TABLES IN SCHEMA manure,public TO "+cfg.database.user)
        })
        _ <- IO.blocking {
          // Simulate a wrong physical payload directory substituted after verified import,
          // BEFORE the backend has ever initialized its root_owner table.
          Files.move(dataRoot,control.resolve("preserved-original-data"))
          Files.createDirectories(dataRoot.resolve("staging")); Files.createDirectories(dataRoot.resolve("live/"+aid))
          Files.write(dataRoot.resolve("live/"+aid+"/file.txt"),wrong)
        }
        result <- Main.resources(cfg).use { services =>
          services.artifacts.openContent(aid,"file.txt",None,None,None).use { (_,file) => IO.blocking(file.read(0,4).toVector) }
        }.attempt
        _ <- IO {
          println("REVIEW_HANDOFF startupAccepted="+result.isRight+" servedExpectedHash="+result.toOption.map(bytes => SecretCodec.sha256(bytes.toArray)==SecretCodec.sha256(good)))
          assert(result.isLeft,"first import startup bound a replacement data root and served unverified same-size bytes")
        }
      } yield ()
    }.unsafeRunSync()
  }

}
