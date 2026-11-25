package chronicle

import cats.effect.{Deferred,IO}
import cats.effect.unsafe.implicits.global
import distage.*
import izumi.logstage.api.Log
import org.http4s.{Http as _,*}
import org.http4s.client.Client
import java.util.concurrent.ConcurrentLinkedQueue
import scala.jdk.CollectionConverters.*
import scala.concurrent.duration.*

/** A serving server logs its effective claim order once, after its listening line: the evidence of the mode a run used. */
final class ClaimOrderStartLineTest extends munit.FunSuite {
  private def served(indexing: IndexingCapacity): List[String] = {
    var lines=List.empty[String]
    // Port 0: the server binds a free port itself (no port picked and released before the bind).
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
        _ <- ChronicleInjector().produceGet[RuntimeServices](module).use { services =>
          Main.serve(config,services,false).start.flatMap(server => logged.get.timeout(30.seconds).guarantee(server.cancel))
        }
      } yield ()).unsafeRunSync()
      lines=entries.asScala.toList.filter(line => line.startsWith("claim order ") || line.startsWith("chronicle listening "))
    }
    lines
  }
  test("the server logs `claim order mode=source-id lanes=L` once it serves under today's order") {
    val lines=served(IndexingCapacity.defaults)
    assertEquals(lines.map(_.takeWhile(_!=' ')),List("chronicle","claim"))
    assertEquals(lines.last,"claim order mode=source-id lanes=4")
  }
  test("the server logs `claim order mode=waiting bulkLanes=B lanes=L` once it serves under the waiting order") {
    val lines=served(IndexingCapacity.defaults.copy(annotationSessions=5,claimOrder=ClaimOrderSetting.Waiting,bulkLanes=2))
    assertEquals(lines.map(_.takeWhile(_!=' ')),List("chronicle","claim"))
    assertEquals(lines.last,"claim order mode=waiting bulkLanes=2 lanes=5")
  }
}
