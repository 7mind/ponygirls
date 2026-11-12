package ontology

import cats.effect.{IO, Resource}
import java.nio.file.Files
import cats.effect.unsafe.IORuntime
import munit.FunSuite
import java.util.concurrent.TimeUnit

final class PackagedAcceptanceControls extends FunSuite {
  private val runtime = IORuntime.builder().build()
  override def afterAll(): Unit = runtime.shutdown()

  test("failed fixture cleanup leaves no acceptance success marker") {
    RdfTestDirectory.resource.use { directory =>
      val marker = directory.resolve("passed.json")
      val resource = Resource.make(IO.unit)(_ => IO.raiseError(new IllegalStateException("controlled cleanup failure")))
      PackagedRuntimeAcceptance.complete(resource)(_ => IO.pure("passed"))(value => IO.blocking { Files.writeString(marker, value); () }).attempt.map { result =>
        assert(result.isLeft)
        assert(!Files.exists(marker), "success marker published before failed cleanup")
      }
    }.unsafeRunSync()(using runtime)
  }

  test("acceptance rejects a server that exited before intentional shutdown") {
    RdfTestDirectory.resource.use { directory => for {
      child <- IO.blocking(new ProcessBuilder("sh", "-c", "exit 7").start())
      exited <- IO.blocking(child.waitFor(5L, TimeUnit.SECONDS))
      _ = assert(exited)
      result <- PackagedRuntimeAcceptance.stop(child, directory).attempt
      _ = assert(result.isLeft, "already-dead error exit was accepted as intentional shutdown")
    } yield () }.unsafeRunSync()(using runtime)
  }
}
