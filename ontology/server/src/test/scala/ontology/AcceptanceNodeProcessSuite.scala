package ontology

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import scala.concurrent.duration.*
import cats.effect.unsafe.IORuntime
import java.nio.file.{Files, Path}
import munit.FunSuite

final class AcceptanceNodeProcessSuite extends FunSuite {
  private val runtime = IORuntime.builder().build()
  override def afterAll(): Unit = runtime.shutdown()
  for (mode <- List("normal", "nonzero", "leak", "resistant", "late")) test(s"owned supervisor preserves $mode outcome and joins descendants") {
    RdfTestDirectory.resource.use { directory =>
      val pidFile = directory.resolve("child.pid")
      val readyFile = directory.resolve("ready")
      val grandchildFile = directory.resolve("grandchild.pid")
      val driver = directory.resolve("driver.mjs")
      def js(value: String): String = io.circe.Json.fromString(value).noSpaces
      val idle = "setInterval(() => {}, 1000); setTimeout(() => process.exit(0), 30000);"
      val descendant = mode match {
        case "normal" => "setTimeout(() => process.exit(0), 100);"
        case "resistant" => s"process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(${js(readyFile.toString)}, 'ready'); $idle"
        case "late" => s"process.on('SIGTERM', () => { const child = require('node:child_process').spawn(process.execPath, ['-e', ${js(idle)}], { detached: true, stdio: 'ignore' }); require('node:fs').writeFileSync(${js(grandchildFile.toString)}, String(child.pid)); process.exit(0); }); require('node:fs').writeFileSync(${js(readyFile.toString)}, 'ready'); $idle"
        case _ => idle
      }
      val source = if (mode == "nonzero") "process.exit(7);" else s"""
        import { spawn } from 'node:child_process';
        import { writeFileSync } from 'node:fs';
        const child = spawn(process.execPath, ['-e', ${js(descendant)}], { detached: true, stdio: 'ignore' });
        writeFileSync(${js(pidFile.toString)}, String(child.pid));
        ${if (mode == "normal") "child.on('exit', () => process.exit(0));" else if (mode == "leak") "process.exit(0);" else "setInterval(() => {}, 1000);"}
        """
      for {
        _ <- IO.blocking(Files.writeString(driver, source))
        result <- AcceptanceNodeProcess.run(Path.of("python3"), Path.of("node"), driver, Nil, directory, mode, 3L).attempt
        _ = assertEquals(result.isRight, mode == "normal")
        _ <- IO.blocking {
          val receipt = Wire.parse(Files.readAllBytes(directory.resolve(mode + "-process.json"))).hcursor
          assertEquals(receipt.get[Boolean]("cleanupConfirmed"), Right(true))
          if (mode == "nonzero") assertEquals(receipt.get[Int]("mainExit"), Right(7))
          if (mode == "leak") {
            assertEquals(receipt.get[Int]("mainExit"), Right(0))
            assertEquals(receipt.get[Boolean]("forcedCleanup"), Right(true))
          }
          if (mode == "resistant") {
            assert(Files.exists(readyFile), "resistant descendant was not ready")
            assert(receipt.get[Int]("killSignals").toOption.exists(_ > 0))
          }
          if (mode == "late") {
            assert(Files.exists(grandchildFile), "late descendant was not created")
            assert(receipt.get[Int]("reapedDescendants").toOption.exists(_ >= 2))
          }
          if (Set("leak", "resistant", "late").contains(mode)) assert(receipt.get[Int]("reapedDescendants").toOption.exists(_ > 0))
        }
      } yield ()
    }.unsafeRunSync()(using runtime)
  }

  test("timed-out Node ownership includes a detached descendant") {
    RdfTestDirectory.resource.use { directory =>
      val pidFile = directory.resolve("descendant.pid")
      val driver = directory.resolve("driver.mjs")
      val nonce = java.util.UUID.randomUUID().toString
      def ready: IO[Unit] = IO.defer(IO.blocking(Files.exists(pidFile)).flatMap(exists => if (exists) IO.unit else IO.sleep(10.millis) *> ready))
      for {
        _ <- IO.blocking(Files.writeString(driver, """
          import { spawn } from 'node:child_process';
          import { writeFileSync } from 'node:fs';
          const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000); setTimeout(() => process.exit(0), 30000);', process.argv[3]], { detached: true, stdio: 'ignore' });
          writeFileSync(process.argv[2], String(child.pid));
          setInterval(() => {}, 1000);
          """))
        _ <- Resource.make(AcceptanceNodeProcess.run(Path.of("python3"), Path.of("node"), driver, List(pidFile.toString, nonce), directory, "descendant-control", 3L).attempt.start)(_.cancel).use { fiber => for {
          _ <- ready.timeout(2.seconds)
          owned <- IO.blocking {
            val child = ProcessHandle.of(Files.readString(pidFile).trim.toLong)
            assert(child.isPresent && child.get.isAlive, "fixture descendant was not observed alive")
            val arguments = child.get.info().arguments()
            assert(arguments.isPresent && arguments.get.contains(nonce), "fixture descendant identity differs")
            child.get
          }
          result <- fiber.joinWithNever
          _ = assert(result.isLeft, "controlled timeout unexpectedly succeeded")
          _ = assert(!owned.isAlive, "owned descendant survived Node timeout cleanup")
        } yield () }
      } yield ()
    }.unsafeRunSync()(using runtime)
  }
}
