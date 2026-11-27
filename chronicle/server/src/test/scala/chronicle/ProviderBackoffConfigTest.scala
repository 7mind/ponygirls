package chronicle

import cats.effect.{Deferred,IO}
import cats.effect.unsafe.implicits.global
import distage.*
import io.circe.Json
import izumi.logstage.api.Log
import org.http4s.{Http as _,*}
import org.http4s.client.Client
import java.nio.file.{Files,Path}
import java.util.concurrent.ConcurrentLinkedQueue
import scala.jdk.CollectionConverters.*
import scala.concurrent.duration.*

/** `indexing.providerBackoff`: read at start from the server's loader, default false, a wrong type a named start failure;
  * the line a serving server logs with it on, and none with it off. */
final class ProviderBackoffConfigTest extends munit.FunSuite {
  test("Off: indexing.providerBackoff from the server's loader: omitted false, true and false as given; any other value refuses the start naming the key") {
    val example=Wire.parse(Files.readString(Path.of("config.example.json"))).asObject.get
    val directory=Files.createTempDirectory("chronicle-config"); val file=directory.resolve("server.json")
    def load(indexing: Option[Json]): Config = {
      Files.writeString(file,Json.fromJsonObject(indexing.fold(example.remove("indexing"))(example.add("indexing",_))).noSpaces)
      Config.load(file.toString)
    }
    try {
      assert(!IndexingCapacity.defaults.providerBackoff)
      assertEquals(load(None).indexing,IndexingCapacity.defaults)
      assertEquals(load(Some(Json.obj("providerBackoff"->Json.True))).indexing,IndexingCapacity.defaults.copy(providerBackoff=true))
      assertEquals(load(Some(Json.obj("providerBackoff"->Json.False))).indexing,IndexingCapacity.defaults)
      assertEquals(load(Some(Json.obj("providerBackoff"->Json.True,"claimOrder"->Json.fromString("waiting")))).indexing,IndexingCapacity.defaults.copy(providerBackoff=true,claimOrder=ClaimOrderSetting.Waiting))
      List(Json.fromString("true"),Json.fromString("on"),Json.fromInt(1),Json.Null,Json.obj()).foreach { value =>
        val refused=intercept[DomainError](load(Some(Json.obj("providerBackoff"->value))))
        assertEquals((refused.code,refused.detail),("config","indexing.providerBackoff must be true or false"),value.noSpaces)
      }
      assertEquals(IndexingCapacity.providerBackoffInvalid,"indexing.providerBackoff must be true or false")
    } finally { Files.deleteIfExists(file); Files.delete(directory) }
  }
  test("Off: ModelHttp's statuses follow the flag: typed only with indexing.providerBackoff on") {
    val config=Fixtures.config()
    assertEquals(ModelHttp.Statuses.of(config),ModelHttp.Statuses(false))
    assertEquals(ModelHttp.Statuses.of(config.copy(indexing=config.indexing.copy(providerBackoff=true))),ModelHttp.Statuses(true))
  }
  private def served(indexing: IndexingCapacity): List[String] = {
    var lines=List.empty[String]
    ClaimOrderPostgres.withDatabase(ClaimOrderPostgres.config().copy(listenPort=0,indexing=indexing)) { (config,_,_) =>
      val entries=new ConcurrentLinkedQueue[String]()
      (for {
        logged <- Deferred[IO,Unit]
        logger=logstage.IzLogger(Log.Level.Info,List(new izumi.logstage.api.logger.LogSink {
          def flush(entry: Log.Entry): Unit = {
            val line=entry.message.template.parts.zipAll(entry.message.args.map(arg => String.valueOf(arg.value)),"","").map(_+_).mkString
            entries.add(line)
            if(line.startsWith("claim order ")) logged.complete(()).unsafeRunSync()
          }
        }))
        module=(_root_.chronicle.plugins.ChroniclePlugin: Module).overriddenBy(new ModuleDef {
          make[Config].fromValue(config)
          make[Client[IO]].fromValue(Client.fromHttpApp[IO](HttpApp.notFound[IO]))
          make[logstage.IzLogger].fromValue(logger)
        })
        // The line after the claim order's is logged in the same step; the server is stopped once both had their chance.
        _ <- ChronicleInjector().produceGet[RuntimeServices](module).use { services =>
          Main.serve(config,services,false).start.flatMap(server => (logged.get *> IO.sleep(200.millis)).timeout(30.seconds).guarantee(server.cancel))
        }
      } yield ()).unsafeRunSync()
      lines=entries.asScala.toList.filter(line => line.startsWith("claim order ") || line.startsWith("provider back-off") || line.startsWith("chronicle listening "))
    }
    lines
  }
  test("Off: a serving server with indexing.providerBackoff off logs no provider back-off line") {
    assertEquals(served(IndexingCapacity.defaults).map(_.takeWhile(_!=' ')),List("chronicle","claim"))
  }
  test("a serving server with indexing.providerBackoff on logs its hold schedule and lane cool-down once, after the claim order line") {
    val lines=served(IndexingCapacity.defaults.copy(providerBackoff=true))
    assertEquals(lines.map(_.takeWhile(_!=' ')),List("chronicle","claim","provider"))
    assertEquals(lines.last,"provider back-off on holdMinutes=1,2,4,8,15 consecutiveLimit=10 laneCoolDownMinutes=1,2,4,8,15")
  }
}
