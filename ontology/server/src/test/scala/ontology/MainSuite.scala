package ontology

import cats.effect.{ExitCode, IO}
import cats.effect.unsafe.IORuntime
import cats.syntax.all.*
import distage.ModuleDef
import java.nio.file.Files
import munit.FunSuite
import ponygirls.runtime.CatsIOInjector
import scala.util.Using

final case class RuntimeWiringProbe(application: RuntimeApplication, concrete: PostgresGraphRepository,
  graph: GraphRepository, read: GraphReadRepository, curation: CurationRepository)
final class MainSuite extends FunSuite {
  private val runtime = IORuntime.builder().build()
  override def afterAll(): Unit = runtime.shutdown()
  test("check-config does not construct the runtime environment or read referenced secrets") {
    RdfTestDirectory.resource.use { directory => for {
      bytes <- IO.blocking(Using.resource(getClass.getResourceAsStream("/runtime-config.json"))(_.readAllBytes()))
      path = directory.resolve("config.json")
      _ <- IO.blocking(Files.write(path, bytes))
      result <- Main.execute(List("check-config", path.toString), IO.raiseError(new AssertionError("environment must not be acquired")), value => IO.println(value))
      _ = assertEquals(result, ExitCode.Success)
      invalid <- Main.execute(List("invalid"), IO.raiseError(new AssertionError("environment must not be acquired")), value => IO.println(value))
      _ = assertEquals(invalid, ExitCode.Error)
    } yield () }.unsafeRunSync()(using runtime)
  }
  test("CLI failure output retains sanitized primary and secondary diagnostic qualifications") {
    RdfTestDirectory.resource.use { directory => for {
      bytes <- IO.blocking(Using.resource(getClass.getResourceAsStream("/runtime-config.json"))(_.readAllBytes()))
      path = directory.resolve("config.json")
      _ <- IO.blocking(Files.write(path, bytes))
      output <- cats.effect.Ref.of[IO, List[String]](Nil)
      error = ontology.domain.Fault("curation-work-uncertain", "controlled-sensitive-detail")
      _ = error.addSuppressed(ontology.domain.Fault("curation-diagnostic", "controlled-sensitive-detail"))
      result <- Main.execute(List("serve", path.toString), IO.raiseError(error), value => output.update(_ :+ value))
      messages <- output.get
      _ = assertEquals(result, ExitCode.Error)
      _ = assert(messages.exists(_.contains("curation-work-uncertain")))
      _ = assert(messages.exists(_.contains("curation-diagnostic")), "secondary diagnostic qualification disappeared at CLI")
      _ = assert(!messages.exists(_.contains("controlled-sensitive-detail")))
    } yield () }.unsafeRunSync()(using runtime)
  }
  test("migrate uses the repository-only module without Auth model RDF or HTTP") {
    RuntimeFixture.resource.use { fixture => for {
      _ <- IO.blocking {
        fixture.config.auth.credentials.foreach(c => Files.delete(c.hashFile))
        Files.delete(fixture.config.cursorKeyFile)
        Files.delete(java.nio.file.Path.of(fixture.config.curator.credentialFile))
      }
      result <- Main.execute(List("migrate", fixture.configFile.toString), IO.raiseError(new AssertionError("runtime environment must not be acquired")), value => IO.println(value))
      _ = assertEquals(result, ExitCode.Success)
      requests <- fixture.requests.get
      _ = assertEquals(requests, Nil)
      _ = assert(!Files.exists(fixture.directory.resolve("rdf")))
    } yield () }.unsafeRunSync()(using runtime)
  }
  test("actual runtime DI aliases one repository and does not eagerly open RDF or dispatch models") {
    RuntimeFixture.resource.use { fixture => RuntimeInputs.resource(fixture.config, fixture.environment).use { inputs =>
      val module = new ModuleDef {
        include(new RuntimeModule(inputs))
        make[RuntimeWiringProbe]
      }
      CatsIOInjector().produceGet[RuntimeWiringProbe](module).use { value => for {
        _ <- IO {
          assert(value.graph eq value.concrete)
          assert(value.read eq value.graph)
          assert(value.curation eq value.graph.curation)
          assert(value.application.repository eq value.concrete)
          assert(!Files.exists(fixture.directory.resolve("rdf")))
        }
        requests <- fixture.requests.get
        _ = assertEquals(requests, Nil)
      } yield () }
    } }.unsafeRunSync()(using runtime)
  }
}
