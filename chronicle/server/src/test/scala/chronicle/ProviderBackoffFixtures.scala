package chronicle

import cats.effect.{IO,Resource}
import cats.effect.unsafe.implicits.global
import com.comcast.ip4s.*
import io.circe.Json
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import org.http4s.{HttpApp,Response,Status}
import org.http4s.ember.server.EmberServerBuilder

/** A model provider on loopback for the provider back-off cases: `/chat` and `/embedding` answer the status their script
  * gives for the call's number (1-based, per path); a 200 carries a valid answer (an annotation covering the request's
  * fragments as one Problem part, or one vector per input), any other status the body `{}`. `partial`: that 200 answer of
  * `/chat` stops at the request's middle fragment boundary (a kept answer under annotation continuations); `stall`: the
  * call is answered after `stallFor` (beyond the client's deadline); `beforeChat` runs before a `/chat` call is answered. */
final class ProviderStub(val base: String) {
  val chatCalls = new AtomicInteger(0)
  val embeddingCalls = new AtomicInteger(0)
  @volatile var chat: Int => Int = _ => 200
  @volatile var embedding: Int => Int = _ => 200
  @volatile var partial: Int => Boolean = _ => false
  @volatile var stall: (String,Int) => Boolean = (_,_) => false
  @volatile var beforeChat: Int => Unit = _ => ()
  val stallFor: scala.concurrent.duration.FiniteDuration = scala.concurrent.duration.DurationInt(2).seconds
  def configure(config: Config): Config =
    config.copy(annotation=config.annotation.copy(endpoint=s"$base/chat"),embedding=config.embedding.copy(endpoint=s"$base/embedding"))
}
object ProviderStub {
  private def chatAnswer(body: String,partial: Boolean): String = {
    val messages=Wire.parse(body).hcursor.get[List[Json]]("messages").toOption.get
    val source=Wire.parse(messages(1).hcursor.get[String]("content").toOption.get)
    val all=source.hcursor.get[List[Json]]("fragments").toOption.get.size
    val fragments=if(partial) (all/2).max(1) else all
    val previous=source.hcursor.downField("previous").focus.exists(!_.isNull)
    val parts=Json.obj("parts"->Json.arr(Json.obj("kind"->Json.fromString("Problem"),
      "start"->Json.obj("fragmentIndex"->Json.fromInt(0),"scalarOffset"->Json.fromInt(0)),
      "end"->Json.obj("fragmentIndex"->Json.fromInt(fragments),"scalarOffset"->Json.fromInt(0)),
      "continuePrevious"->Json.fromBoolean(previous),"summary"->Json.fromString("synthetic goal"),"tags"->Json.arr(Json.fromString("synthetic")))))
    Json.obj("choices"->Json.arr(Json.obj("finish_reason"->Json.fromString("stop"),"message"->Json.obj("content"->Json.fromString(parts.noSpaces))))).noSpaces
  }
  private def embeddingAnswer(body: String): String = {
    val inputs=Wire.parse(body).hcursor.get[List[Json]]("input").toOption.get.size
    Json.obj("data"->Json.arr((0 until inputs).map(i => Json.obj("index"->Json.fromInt(i),"embedding"->Json.arr(Json.fromInt(1),Json.fromInt(0),Json.fromInt(0))))*)).noSpaces
  }
  def resource: Resource[IO,ProviderStub] = Resource.suspend(IO {
    val holder=new java.util.concurrent.atomic.AtomicReference[ProviderStub]()
    val app: HttpApp[IO]=cats.data.Kleisli { request => request.as[String].map { body =>
      val stub=holder.get
      val path=request.uri.path.renderString
      val (call,status,answer)=path match {
        case "/chat" => val n=stub.chatCalls.incrementAndGet(); stub.beforeChat(n); (n,stub.chat(n),() => chatAnswer(body,stub.partial(n)))
        case "/embedding" => val n=stub.embeddingCalls.incrementAndGet(); (n,stub.embedding(n),() => embeddingAnswer(body))
        case other => (0,404,() => "{}")
      }
      (path,call,status,answer)
    }.flatMap { (path,call,status,answer) =>
      val response=if(status==200) Response[IO](Status.Ok).withEntity(answer()) else Response[IO](Status.fromInt(status).toOption.get).withEntity("{}")
      if(holder.get.stall(path,call)) IO.sleep(holder.get.stallFor).as(response) else IO.pure(response)
    }}
    EmberServerBuilder.default[IO].withHost(Host.fromString("127.0.0.1").get).withPort(Port.fromInt(0).get).withHttpApp(app).build.map { server =>
      val stub=new ProviderStub(s"http://127.0.0.1:${server.address.getPort}"); holder.set(stub); stub
    }
  })
}
/** A job row as the provider back-off cases read it. `leaseSeconds`: `lease_until` less now, in seconds. */
final case class JobRow(state: String,attempts: Int,error: Option[String],stage: Option[String],leaseSeconds: Option[Double],transientFailures: Int)
object ProviderBackoffFixtures {
  def configured(config: Config,order: ClaimOrderSetting,continuations: Boolean,backoff: Boolean): Config = {
    val capacity=order match {
      case ClaimOrderSetting.SourceId => config.indexing
      case ClaimOrderSetting.Waiting => config.indexing.copy(annotationSessions=3,claimOrder=ClaimOrderSetting.Waiting,bulkLanes=1)
    }
    config.copy(indexing=capacity.copy(annotationContinuations=continuations,providerBackoff=backoff))
  }
  def row(db: Database,id: UUID): JobRow = db.transaction { c =>
    Sql.one(c,"SELECT state,attempts,error,failure_stage,EXTRACT(EPOCH FROM lease_until-clock_timestamp())::float8,transient_failures FROM ch_jobs WHERE id=?",id) { r =>
      JobRow(r.getString(1),r.getInt(2),Option(r.getString(3)),Option(r.getString(4)),Option(r.getObject(5)).map(_ => r.getDouble(5)),r.getInt(6))
    }.get
  }
  def ledger(db: Database,id: UUID): Int = db.transaction(c => Sql.one(c,"SELECT count(*) FROM ch_annotation_attempts WHERE job_id=?",id)(_.getInt(1)).get)
  /** A worker of `config` over the stub through the production annotator, embedder and ModelHttp. */
  def worker(archive: SessionArchive,config: Config,client: org.http4s.client.Client[IO],logger: logstage.IzLogger): Worker = {
    val http=ProviderBackoffFixtures.http(client,config)
    new Worker(archive,new OpenAIProblemPassageAnnotator(http,config),new OpenAIEmbedder(http,config),config,IndexProfileCatalog.current(config),
      ModelAdmission.make(config.indexing).unsafeRunSync(),logger,ModelFixtures.failureBackoff,ModelFixtures.snapshots)
  }
  /** As `worker`, with its model admission and its lanes' cool-down given. */
  def workerWith(archive: SessionArchive,config: Config,client: org.http4s.client.Client[IO],logger: logstage.IzLogger,admission: ModelAdmission,coolDown: Worker.CoolDown): Worker = {
    val http=ProviderBackoffFixtures.http(client,config)
    new Worker(archive,new OpenAIProblemPassageAnnotator(http,config),new OpenAIEmbedder(http,config),config,IndexProfileCatalog.current(config),
      admission,logger,ModelFixtures.failureBackoff,ModelFixtures.snapshots,Worker.Leases.production,coolDown)
  }
  /** The production ModelHttp of `config` (its statuses typed when `indexing.providerBackoff` is on) over `client`. */
  def http(client: org.http4s.client.Client[IO],config: Config): ModelHttp = {
    val clock=new JavaModelTelemetryClock(java.time.Clock.systemUTC(),cats.effect.Clock[IO])
    (for { telemetry <- ModelTelemetry.make(clock); admission <- ModelAdmission.make(config.indexing) } yield new ModelHttp(client,telemetry,admission,ModelHttp.Statuses.of(config))).unsafeRunSync()
  }
  /** One claim of `worker` in the configured order: today's iteration, or the first fresh lane of the waiting order. */
  def once(worker: Worker,config: Config): Boolean = ClaimOrderMode.of(config) match {
    case ClaimOrderMode.SourceId => worker.once.unsafeRunSync()
    case ClaimOrderMode.Waiting(bulkLanes) => worker.onceInLane(ClaimLane.of(bulkLanes+1,bulkLanes)).unsafeRunSync()
  }
  /** The stub and a model client for it; the client's transport deadline is above every case's call deadline, which
    * JsonHttp applies per call from the configuration. */
  def provider: Resource[IO,(ProviderStub,org.http4s.client.Client[IO])] =
    for { stub <- ProviderStub.resource; client <- ponygirls.retrieval.JsonHttp.client(scala.concurrent.duration.DurationInt(5).seconds) } yield (stub,client)
}
/** Forwards the provider record too (ForwardingArchive predates it); tests override the calls they observe or fail. */
class ProviderForwardingArchive(delegate: SessionArchive) extends ForwardingArchive(delegate) {
  override def holdProvider(c: Claim,failure: ProviderFailure,deadline: scala.concurrent.duration.Deadline): ProviderOutcome = delegate.holdProvider(c,failure,deadline)
}
object ProviderSources {
  /** A source of `count` user messages (64 fragments make a window). */
  def source(count: Int,label: String="synthetic message"): chronicle.api.IngestRequest = {
    val messages=(0 until count).map(i => chronicle.api.Message(s"m$i",None,"user",s"$label $i",None,i)).toList
    val raw=messages.map(m => Json.obj("id"->Json.fromString(m.id),"text"->Json.fromString(m.text)).noSpaces+"\n").mkString
    Fixtures.snapshot().copy(messages=messages,files=List(chronicle.api.RawFile("source.jsonl",Wire.hash(raw),raw)),digest=Wire.hash(raw))
  }
  /** The next revision of `first`'s source, with `count` messages. */
  def append(first: chronicle.api.IngestRequest,count: Int,revision: Int): chronicle.api.IngestRequest =
    source(count).copy(requestId=UUID.randomUUID(),source=first.source,expectedRevision=revision)
}
