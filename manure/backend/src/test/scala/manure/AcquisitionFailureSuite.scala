package manure

import cats.effect.IO
import cats.effect.std.Semaphore
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import java.nio.channels.ClosedChannelException
import java.nio.file.Files
import java.sql.DriverManager
import java.util.concurrent.atomic.AtomicBoolean
import scala.util.Using
import manure.storage.{ConfinedFile,OpenRootLeases}
import munit.FunSuite

/** Regression: real PostgreSQL backend termination AFTER pinned payload open,
  * BEFORE transaction commit/resource-acquisition success. No fake JDBC failure.
  */
final class AcquisitionFailureSuite extends FunSuite:
  test("failed PG commit during content resource acquisition closes the pinned file") {
    BackendFixture.resource(true).use { f =>
      var captured: Option[ConfinedFile] = None
      val payloads = new Payloads:
        export f.payloads.{initialize,stage,sidecar,write,receiptValid,truncateTo,complete,structureComplete,hasLive,publish,forceLive,cleanupStage,cleanup,cleanupOrphans}
        def open(a: Artifact,path: String): ConfinedFile =
          val file = f.payloads.open(a,path); captured=Some(file); file
      val armed = new AtomicBoolean(false)
      val transactions = new JdbcTransactions:
        def transaction[A](body: java.sql.Connection => A): IO[A] = f.database.get.transaction { c =>
          val pid = Jdbc.rows(c,"SELECT pg_backend_pid()")(_.getInt(1)).head
          val value = body(c)
          if armed.getAndSet(false) then
            val password = Files.readString(f.config.database.passwordFile).stripSuffix("\n")
            Using.resource(DriverManager.getConnection(f.config.database.jdbcUrl,f.config.database.user,password)) { killer =>
              assert(Jdbc.rows(killer,"SELECT pg_terminate_backend(?)",pid)(_.getBoolean(1)).head)
            }
          value
        }
      val bytes = Exact.utf8("real committed bytes")
      val work = for
        a <- f.artifacts.init(f.identity,InitUpload("commit-fault",ArtifactKind.File,Visibility.Public,Vector(ManifestEntry("file",false,bytes.length,SecretCodec.sha256(bytes))),None))
        _ <- f.artifacts.putChunk(f.identity,a.artifact.id,"file",0,bytes,SecretCodec.sha256(bytes))
        _ <- f.artifacts.finish(f.identity,a.artifact.id)
        gate <- Semaphore[IO](1L)
        service = new Artifacts(new PostgresMetadata(transactions,f.lease,f.projection.get),payloads,f.config.limits,f.clock,f.auth,f.lease,gate,NoFaults)
        _ <- IO(armed.set(true))
        result <- service.openContent(a.artifact.id,"file",None,None,None).use(_ => IO.unit).attempt
        _ <- IO {
          assert(result.isLeft,"terminated commit must fail acquisition")
          assert(captured.nonEmpty,"failure must follow actual descriptor acquisition")
          intercept[ClosedChannelException](captured.get.size())
          // No file counter may remain, even though service lease still lives.
          intercept[OpenRootLeases](f.root.close())
        }
      yield ()
      work.guarantee(IO.blocking(captured.foreach(_.close())))
    }.unsafeRunSync()
  }
