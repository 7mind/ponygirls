package haystack

import cats.effect.{IO,IOApp,ExitCode,Resource}
import cats.syntax.all.*
import distage.*
import ponygirls.runtime.{JdbcDatabase,CatsIOInjector}
import ponygirls.retrieval.{EmbeddingClient,EmbeddingTelemetry,RetrievalProfile}
import ponygirls.retrieval.postgres.PostgresRetrieval
import haystack.auth.Auth
import haystack.storage.{Migrations,PostgresItemRepository,ItemRepository}
import haystack.application.ItemService
import haystack.http.{Http,LiveHub}
import haystack.retrieval.HaystackRetrieval
import org.http4s.ember.server.EmberServerBuilder
import com.comcast.ip4s.{Host,Port}
import java.nio.file.Path
import java.util.concurrent.atomic.AtomicReference
import scala.concurrent.duration.*

final class Services(val http:Http,val retrieval:HaystackRetrieval)
object Main extends IOApp {
  def run(args:List[String]):IO[ExitCode]=(args match{
    case List(command,path) if Set("serve","migrate","check-config").contains(command)=>
      val file=Path.of(path)
      IO.blocking { val c=Config.load(file);Auth.load(c.auth);c }.flatMap { config=>
        if(command=="check-config")IO.unit
        else JdbcDatabase.resource(config.database).use { database=>
          Migrations.initialize(database,config.auth.activityProjectId) *>
          (if(command=="migrate")IO.unit else serve(config,file,database))
        }
      }.as(ExitCode.Success)
    case _=>IO.println("usage: haystack-server serve CONFIG.json | migrate CONFIG.json | check-config CONFIG.json").as(ExitCode.Error)
  }).handleErrorWith(_=>IO.println("haystack: startup or runtime failure").as(ExitCode.Error))

  private def serve(config:Config,file:Path,database:JdbcDatabase):IO[Unit]=GracefulShutdown.resource.use(stop=>serveOwned(config,file,database).race(stop).void)
  private def serveOwned(config:Config,file:Path,database:JdbcDatabase):IO[Unit]={
    val client:Resource[IO,Option[EmbeddingClient]]=config.retrieval.embedding match{
      case None=>Resource.pure(None)
      case Some(endpoint)=>EmbeddingClient.resource(endpoint,config.retrieval.maxConcurrent,config.retrieval.maxQueued,EmbeddingTelemetry.noop).map(Some(_))
    }
    client.use { embedding=>for{
      initial<-IO.blocking(Auth.load(config.auth))
      reference=new AtomicReference[Either[Throwable,Auth]](Right(initial))
      getAuth=()=>reference.get().fold(throw _,identity)
      hub<-LiveHub.create
      projection=new HaystackRetrieval(database,config.retrieval.policy,new PostgresRetrieval("haystack",config.retrieval.embedding.map(e=>RetrievalProfile(e.space,config.retrieval.policy.id))),embedding,config.retrieval.batchSize)
      repository=new PostgresItemRepository(database,Some(projection))
      _<-repository.initializeProjection()
      // Every reload is fail-closed; invalid/unreadable replacement config
      // revokes access until repaired, rather than retaining stale authority.
      reload=(IO.sleep(config.authReloadMs.millis) *> IO.blocking { val next=Config.load(file);if(next.auth.activityProjectId!=config.auth.activityProjectId)throw haystack.domain.Fault("config","activity namespace mismatch");Auth.load(next.auth) }.attempt.flatMap(value=>IO(reference.set(value)))).foreverM
      graph=new ModuleDef{
        make[ItemRepository].fromValue(repository)
        make[LiveHub].fromValue(hub)
        make[ItemService].from((repo:ItemRepository,live:LiveHub)=>new ItemService(repo,(key,revision)=>live.changed(key,revision,getAuth())))
        make[HaystackRetrieval].fromValue(projection)
        make[Http].from((service:ItemService,live:LiveHub)=>new Http(getAuth,service,live,config.webRoot,projection))
        make[Services]
      }
      _<-CatsIOInjector().produceGet[Services](graph).use { services=>
        EmberServerBuilder.default[IO].withHost(Host.fromString(config.listenHost).getOrElse(throw haystack.domain.Fault("config","invalid listen host")))
          .withPort(Port.fromInt(config.listenPort).getOrElse(throw haystack.domain.Fault("config","invalid port")))
          .withShutdownTimeout(2.seconds).withMaxConnections(128).withMaxHeaderSize(16384).withMaxWebSocketMessageSize(1024*1024).withHttpWebSocketApp(ws=>services.http.routes(ws).orNotFound).build.use { _=>
            IO.println("haystack: ready") *> (reload,services.retrieval.run).parTupled.void
          }
      }
    }yield()}
  }
}
