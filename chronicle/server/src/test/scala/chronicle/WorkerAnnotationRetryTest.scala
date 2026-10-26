package chronicle
import chronicle.api.*
import cats.effect.{Deferred,IO}
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import org.http4s.{Message as _,*}
import org.http4s.client.Client
import io.circe.Json
import java.util.UUID

abstract class WorkerAnnotationRetryContract extends munit.FunSuite {
  def withArchive(f: (Config,Database,SessionArchive) => Unit): Unit
  private final class RecordingArchive(delegate: SessionArchive) extends SessionArchive {
    val completed=scala.collection.mutable.ListBuffer.empty[Int]
    val failures=scala.collection.mutable.ListBuffer.empty[String]
    var claims=0; var publications=0
    def ingest(owner: String,r: IngestRequest,profile: String): IngestReceipt = delegate.ingest(owner,r,profile)
    def headSnapshot(reader: String,id: UUID): IngestRequest = delegate.headSnapshot(reader,id)
    def session(reader: String,id: UUID): SessionInfo = delegate.session(reader,id)
    def claim(profile: String,seconds: Int): Option[Claim] = { claims+=1; delegate.claim(profile,seconds) }
    def progress(c: Claim,count: Int,total: Int): Boolean = { completed += count; delegate.progress(c,count,total) }
    def publish(c: Claim,chunks: List[IndexedChunk]): Boolean = { publications+=1; delegate.publish(c,chunks) }
    def fail(c: Claim,code: String): Unit = { failures += code; delegate.fail(c,code) }
  }
  private def source: IngestRequest = {
    val text="a"*(Fragments.maxBytes*4)+"b"*(Fragments.maxBytes*4)+"c"
    val raw=Json.obj("id"->Json.fromString("u"),"text"->Json.fromString(text)).noSpaces+"\n"
    Fixtures.snapshot().copy(messages=List(Message("u",None,"user",text,None,0)),files=List(RawFile("session.jsonl",Wire.hash(raw),raw)),digest=Wire.hash(raw))
  }
  private def response(fragments: List[Json],finish: String): Json = {
    val content=Json.obj("chunks"->Json.arr(Json.obj("first"->Json.fromInt(0),"last"->Json.fromInt(fragments.size-1),"summary"->Json.fromString("synthetic"),"tags"->Json.arr())))
    Json.obj("choices"->Json.arr(Json.obj("finish_reason"->Json.fromString(finish),"message"->Json.obj("content"->Json.fromString(content.noSpaces)))))
  }
  private def annotator(config: Config,calls: scala.collection.mutable.ListBuffer[Json],respond: (List[Json],Int) => IO[Json]): Annotator = {
    val app: HttpApp[IO]=cats.data.Kleisli { request => request.as[String].flatMap { body =>
      val payload=Wire.parse(body)
      assertEquals(payload.hcursor.get[Int]("max_tokens").toOption,Some(65536))
      assertEquals(payload.hcursor.get[String]("model").toOption,Some(config.annotation.model))
      assertEquals(payload.hcursor.downField("chat_template_kwargs").get[String]("reasoning_effort").toOption,Some("max"))
      val source=Wire.parse(payload.hcursor.downField("messages").downN(1).get[String]("content").toOption.get)
      val fragments=source.hcursor.get[List[Json]]("fragments").toOption.get
      assertEquals(payload.hcursor.downField("response_format").focus,Some(AnnotationPartition.responseFormat(fragments.size)))
      calls += payload
      respond(fragments,calls.size).map(result => Response[IO](Status.Ok).withEntity(result.noSpaces))
    }}
    new OpenAIAnnotator(new ModelHttp(Client.fromHttpApp(app)),config)
  }
  private final class RecordingEmbedder extends Embedder {
    val calls=scala.collection.mutable.ListBuffer.empty[String]
    def query(text: String): IO[List[Double]] = IO.pure(List(1.0,0.0,0.0))
    def documents(text: List[String]): IO[List[List[Double]]] = IO { calls ++= text; text.map(_ => List(1.0,0.0,0.0)) }
  }
  private def labels(calls: scala.collection.mutable.ListBuffer[Json]): List[Char] = calls.toList.map { payload =>
    val source=Wire.parse(payload.hcursor.downField("messages").downN(1).get[String]("content").toOption.get)
    source.hcursor.downField("fragments").downN(0).get[String]("text").toOption.get.head
  }
  test("BG/GoodCommunication: one truncation retries only the same window and preserves validated embedded prefix") { withArchive { (config,db,delegate) =>
    val archive=new RecordingArchive(delegate); val receipt=archive.ingest("a",source,config.profile)
    val calls=scala.collection.mutable.ListBuffer.empty[Json]; val embedder=new RecordingEmbedder
    val model=annotator(config,calls,(fragments,attempt) => IO.pure(response(fragments,if(attempt==2) "length" else "stop")))
    assert(new Worker(archive,model,embedder,db,config,logstage.IzLogger()).once.unsafeRunSync())
    assertEquals(labels(calls),List('a','b','b','c'))
    assertEquals(calls(1),calls(2))
    assertEquals(embedder.calls.toList.map(_.head),List('a','b','c'))
    assertEquals(archive.completed.toList,List(0,1,2,3)); assertEquals(archive.claims,1)
    assertEquals(archive.failures.toList,Nil); assertEquals(archive.publications,1)
    assertEquals(archive.session("a",receipt.sessionId).indexedRevision,Some(1))
  }}
  test("BG/GoodCommunication: five total truncations exhaust into existing job failure without publication") { withArchive { (config,db,delegate) =>
    val archive=new RecordingArchive(delegate); val receipt=archive.ingest("a",source,config.profile)
    val calls=scala.collection.mutable.ListBuffer.empty[Json]; val embedder=new RecordingEmbedder
    val model=annotator(config,calls,(fragments,attempt) => IO.pure(response(fragments,if(attempt==1) "stop" else "length")))
    assert(new Worker(archive,model,embedder,db,config,logstage.IzLogger()).once.unsafeRunSync())
    assertEquals(labels(calls),List('a','b','b','b','b','b'))
    assert(calls.drop(1).forall(_==calls(1)))
    assertEquals(embedder.calls.toList.map(_.head),List('a'))
    assertEquals(archive.completed.toList,List(0,1)); assertEquals(archive.claims,1)
    assertEquals(archive.failures.toList,List("model-output/truncated")); assertEquals(archive.publications,0)
    assertEquals(archive.session("a",receipt.sessionId).indexedRevision,None)
    assert(archive.claim(config.profile,300).nonEmpty)
  }}
  List("model-output","model-http","model-timeout","stale-claim","worker-fault").foreach { code =>
    test(s"BG/GoodCommunication: annotation $code is not retried") { withArchive { (config,db,delegate) =>
      val archive=new RecordingArchive(delegate); archive.ingest("a",source,config.profile)
      var calls=0; val embedder=new RecordingEmbedder
      val model=new Annotator {
        def annotate(window: List[Chunk],messages: List[Message]): IO[List[Chunk]] = IO { calls+=1 }.flatMap { _ =>
          IO.raiseError(if(code=="worker-fault") new IllegalStateException("synthetic") else DomainError(code,"synthetic"))
        }
      }
      assert(new Worker(archive,model,embedder,db,config,logstage.IzLogger()).once.unsafeRunSync())
      assertEquals(calls,1); assertEquals(embedder.calls.toList,Nil)
      assertEquals(archive.failures.toList,List(code)); assertEquals(archive.publications,0)
    }}
  }
  test("BG/GoodCommunication: invalid structured output is not retried") { withArchive { (config,db,delegate) =>
    val archive=new RecordingArchive(delegate); archive.ingest("a",source,config.profile)
    val calls=scala.collection.mutable.ListBuffer.empty[Json]; val embedder=new RecordingEmbedder
    val invalid=Json.obj("choices"->Json.arr(Json.obj("finish_reason"->Json.fromString("stop"),"message"->Json.obj("content"->Json.fromString("{}")))))
    val model=annotator(config,calls,(_,_) => IO.pure(invalid))
    assert(new Worker(archive,model,embedder,db,config,logstage.IzLogger()).once.unsafeRunSync())
    assertEquals(calls.size,1); assertEquals(embedder.calls.toList,Nil)
    assertEquals(archive.failures.toList,List("model-output")); assertEquals(archive.publications,0)
  }}
  test("BG/GoodCommunication: even a truncation code from embedding does not retry annotation or embedding") { withArchive { (config,db,delegate) =>
    val archive=new RecordingArchive(delegate); archive.ingest("a",source,config.profile)
    val calls=scala.collection.mutable.ListBuffer.empty[Json]; var embeddings=0
    val model=annotator(config,calls,(fragments,_) => IO.pure(response(fragments,"stop")))
    val embedder=new Embedder {
      def query(text: String): IO[List[Double]] = IO.pure(Nil)
      def documents(text: List[String]): IO[List[List[Double]]] = IO { embeddings+=1 }.flatMap(_ => IO.raiseError(DomainError("model-output/truncated","synthetic")))
    }
    assert(new Worker(archive,model,embedder,db,config,logstage.IzLogger()).once.unsafeRunSync())
    assertEquals(calls.size,1); assertEquals(embeddings,1)
    assertEquals(archive.completed.toList,List(0)); assertEquals(archive.publications,0)
    assertEquals(archive.failures.toList,List("model-output/truncated"))
  }}
  test("BG/GoodCommunication: cancellation during a retried annotation does not retry or fail the job") { withArchive { (config,db,delegate) =>
    val archive=new RecordingArchive(delegate); archive.ingest("a",source,config.profile)
    val calls=scala.collection.mutable.ListBuffer.empty[Json]; val embedder=new RecordingEmbedder
    val program=for {
      started <- Deferred[IO,Unit]
      cancelled <- Deferred[IO,Unit]
      model=annotator(config,calls,(fragments,attempt) =>
        if(attempt==1) IO.pure(response(fragments,"length"))
        else started.complete(()).flatMap(_ => IO.never[Json]).onCancel(cancelled.complete(()).void))
      fiber <- new Worker(archive,model,embedder,db,config,logstage.IzLogger()).once.start
      _ <- started.get
      _ <- fiber.cancel
      _ <- cancelled.get
      outcome <- fiber.join
    } yield outcome
    assert(program.unsafeRunSync().isCanceled)
    assertEquals(calls.size,2); assertEquals(calls(0),calls(1))
    assertEquals(embedder.calls.toList,Nil); assertEquals(archive.completed.toList,List(0))
    assertEquals(archive.failures.toList,Nil); assertEquals(archive.publications,0)
  }}
}
class DummyWorkerAnnotationRetryTest extends WorkerAnnotationRetryContract {
  def withArchive(f: (Config,Database,SessionArchive) => Unit): Unit = {
    val base=Fixtures.config(); val config=base.copy(annotation=base.annotation.copy(requestPolicy=AnnotationRequestPolicy.GlmMaxReasoning))
    f(config,new Database(config),new DummyArchive(config))
  }
}
class PostgresWorkerAnnotationRetryTest extends WorkerAnnotationRetryContract {
  def withArchive(f: (Config,Database,SessionArchive) => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh") }
    val base=Fixtures.config(); val config=base.copy(annotation=base.annotation.copy(requestPolicy=AnnotationRequestPolicy.GlmMaxReasoning))
    val db=new Database(config); db.initialize()
    db.transaction(c => { Sql.exec(c,"TRUNCATE ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks CASCADE"); Sql.exec(c,"UPDATE ch_profile SET active=?,target=?,maintenance=false",config.profile,config.profile) })
    f(config,db,new PostgresArchive(db,config))
  }
}
