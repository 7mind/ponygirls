package haystack

import cats.effect.{IO,IOApp,ExitCode,Resource}
import cats.syntax.all.*
import distage.*
import ponygirls.runtime.{JdbcDatabase,CatsIOInjector,StartFailure}
import ponygirls.retrieval.{EmbeddingClient,EmbeddingTelemetry,RetrievalProfile}
import ponygirls.retrieval.postgres.PostgresRetrieval
import haystack.auth.{Auth,AccountService,ImperativeRuntime}
import ponygirls.auth.{AccountFailure,PasswordHasher}
import haystack.storage.{MigrationRefused,Migrations,PostgresItemRepository,ItemRepository}
import haystack.application.ItemService
import haystack.http.{Http,LiveHub}
import haystack.retrieval.HaystackRetrieval
import haystack.domain.Fault
import org.http4s.ember.server.EmberServerBuilder
import com.comcast.ip4s.{Host,Port}
import java.nio.file.Path
import java.time.Clock
import java.util.concurrent.atomic.AtomicReference
import scala.concurrent.duration.*

final class Services(val http:Http,val retrieval:HaystackRetrieval)
object Main extends IOApp {
  def run(args:List[String]):IO[ExitCode]=(args match{
    case List(command,path) if Set("serve","migrate","check-config").contains(command)=>
      val file=Path.of(path)
      stage("config",IO.blocking { val c=Config.load(file);Auth.load(c.auth);c }).flatMap { config=>
        if(command=="check-config")IO.unit
        else JdbcDatabase.resource(config.database).adaptError(staged("database")).use { database=>
          stage("migrate",Migrations.initialize(database,config.auth.activityProjectId)) *>
          (if(command=="migrate")IO.unit else serve(config,file,database))
        }
      }.as(ExitCode.Success)
    case _=>IO.println("usage: haystack-server serve CONFIG.json | migrate CONFIG.json | check-config CONFIG.json").as(ExitCode.Error)
  }).handleErrorWith(failure)

  private final case class StageFailure(stage:String,port:Option[Int],error:Throwable) extends RuntimeException(stage,error)
  /** Names the start step that failed; the innermost stage wins, a failure outside every stage is `start`. */
  private def staged(name:String,port:Option[Int]=None):PartialFunction[Throwable,Throwable]={ case error if !error.isInstanceOf[StageFailure]=>StageFailure(name,port,error) }
  private def stage[A](name:String,work: =>IO[A],port:Option[Int]=None):IO[A]=IO.defer(work).adaptError(staged(name,port))
  /** Fault texts are fixed only for configuration faults; a migration refusal is fixed text and a row count. */
  private val known:StartFailure.Known={
    case refused:MigrationRefused=>("migration-refused",refused.getMessage)
    case fault:Fault if fault.code=="config"=>(fault.code,fault.message)
    case fault:Fault=>(fault.code,fault.code)
    case account:AccountFailure=>(account.code,account.code)
  }
  private def failure(error:Throwable):IO[ExitCode]={
    val (name,port,cause)=error match{
      case failed:StageFailure=>(failed.stage,failed.port,failed.error)
      case other=>("start",None,other)
    }
    IO(System.err.println(StartFailure.line("haystack",name,StartFailure.classify(cause,known),port))).as(ExitCode.Error)
  }

  private def serve(config:Config,file:Path,database:JdbcDatabase):IO[Unit]=GracefulShutdown.resource.use(stop=>serveOwned(config,file,database).race(stop).void)
  private def serveOwned(config:Config,file:Path,database:JdbcDatabase):IO[Unit]={
    val client:Resource[IO,Option[EmbeddingClient]]=config.retrieval.embedding match{
      case None=>Resource.pure(None)
      case Some(endpoint)=>EmbeddingClient.resource(endpoint,config.retrieval.maxConcurrent,config.retrieval.maxQueued,EmbeddingTelemetry.noop).map(Some(_))
    }
    (client,ImperativeRuntime.resource(Clock.systemUTC(),PasswordHasher.Pbkdf2)).tupled.use { (embedding,imperative)=>for{
      initial<-stage("config",IO.blocking(Auth.load(config.auth)))
      reference=new AtomicReference[Either[Throwable,Auth]](Right(initial))
      getAuth=()=>reference.get().fold(throw _,identity)
      accounts=new AccountService(database,getAuth,imperative)
      suspended<-stage("accounts",accounts.install(initial) *> accounts.suspended(initial))
      _<-IO.whenA(suspended>0)(IO.println(s"haystack: $suspended imperative accounts suspended (auth.accounts.enabled is off)"))
      hub<-LiveHub.create
      projection=new HaystackRetrieval(database,config.retrieval.policy,new PostgresRetrieval("haystack",config.retrieval.embedding.map(e=>RetrievalProfile(e.space,config.retrieval.policy.id))),embedding,config.retrieval.batchSize)
      repository=new PostgresItemRepository(database,Some(projection))
      _<-stage("projection",repository.initializeProjection())
      // Every reload is fail-closed; invalid/unreadable replacement config
      // revokes access until repaired, rather than retaining stale authority.
      reload=(IO.sleep(config.authReloadMs.millis) *> accounts.reloaded(IO.blocking { val next=Config.load(file);if(next.auth.activityProjectId!=config.auth.activityProjectId)throw haystack.domain.Fault("config","activity namespace mismatch");Auth.load(next.auth) }).flatMap(value=>IO(reference.set(value)))).foreverM
      graph=new ModuleDef{
        make[ItemRepository].fromValue(repository)
        make[LiveHub].fromValue(hub)
        make[ItemService].from((repo:ItemRepository,live:LiveHub)=>new ItemService(repo,(key,revision)=>live.changed(key,revision,accounts)))
        make[HaystackRetrieval].fromValue(projection)
        make[Http].from((service:ItemService,live:LiveHub)=>new Http(getAuth,service,live,config.webRoot,projection,accounts))
        make[Services]
      }
      _<-stage("wiring",CatsIOInjector().produceGet[Services](graph).use { services=>
        stage("bind",EmberServerBuilder.default[IO].withHost(Host.fromString(config.listenHost).getOrElse(throw haystack.domain.Fault("config","invalid listen host")))
          .withPort(Port.fromInt(config.listenPort).getOrElse(throw haystack.domain.Fault("config","invalid port")))
          .withShutdownTimeout(2.seconds).withMaxConnections(128).withMaxHeaderSize(16384).withMaxWebSocketMessageSize(1024*1024).withHttpWebSocketApp(ws=>services.http.routes(ws).orNotFound).build.use { _=>
            IO.println("haystack: ready") *> stage("serve",(reload,services.retrieval.run(event=>IO.println("haystack: "+event.line))).parTupled.void)
          },Some(config.listenPort))
      })
    }yield()}
  }
}
