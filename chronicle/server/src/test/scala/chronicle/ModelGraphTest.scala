package chronicle

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import chronicle.api.*
import distage.{Identity as _,*}
import org.http4s.{Http as _,*}
import org.http4s.client.Client

final class ModelUsageGraph(val http: ModelHttp,val usage: ModelUsageView,val worker: Worker)

final class ModelGraphTest extends munit.FunSuite {
  test("BG: the production effectful graph shares actual-call telemetry with owner usage and operator capacity") {
    val config=Fixtures.config().copy(indexing=IndexingCapacity(2,3,4))
    val reply="""{"usage":{"prompt_tokens":11,"completion_tokens":7,"completion_tokens_details":{"reasoning_tokens":3}}}"""
    val client=Client.fromHttpApp[IO](cats.data.Kleisli(_ => IO.pure(Response[IO](Status.Ok).withEntity(reply))))
    val production: Module=_root_.chronicle.plugins.ChroniclePlugin
    val module=production.overriddenBy(new ModuleDef {
      make[Config].fromValue(config)
      make[Client[IO]].fromValue(client)
      make[ModelUsageGraph]
    })
    ChronicleInjector().produceGet[ModelUsageGraph](module).use { graph =>
      val owner=Identity(UserInfo("a","a",List(Scope.Read)),false,"synthetic")
      val other=Identity(UserInfo("b","b",List(Scope.Read)),false,"synthetic")
      for {
        _ <- graph.http.post(ModelCallContext(owner.user.id,ModelWorkload.McpTest),config.annotation.endpoint,config.annotation.credentialFile,1,65536,io.circe.Json.obj())
        usage <- graph.usage.read(owner)
        foreign <- graph.usage.read(other)
        _ <- IO {
          assertEquals(usage.settings,IndexingSettings(2,3,4))
          val sample=usage.samples.find(_.purpose==ModelPurpose.McpTest).get
          assertEquals(sample.finishedCalls,1L); assertEquals(sample.inFlight,0)
          assertEquals(sample.input.knownTokens,11L); assertEquals(sample.output.get.knownTokens,7L)
          assertEquals(sample.reasoningSubset.get.knownTokens,3L)
          assert(usage.samples.filterNot(_.purpose==ModelPurpose.McpTest).forall(_.finishedCalls==0L))
          assert(foreign.samples.forall(_.finishedCalls==0L))
        }
      } yield ()
    }.unsafeRunSync()
  }
}
