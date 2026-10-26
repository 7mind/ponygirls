package chronicle
import chronicle.api.*
import cats.effect.{Deferred,IO}
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import org.http4s.{Message as _,*}
import org.http4s.client.Client
import io.circe.Json
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import scala.jdk.CollectionConverters.*
import izumi.logstage.api.Log
import izumi.logstage.api.logger.{LogQueue,LogRouter,LogSink}
import izumi.logstage.api.rendering.{RenderingOptions,StringRenderingPolicy}

abstract class WorkerAnnotationRetryContract extends munit.FunSuite {
  def withArchive(f: (Config,Database,SessionArchive) => Unit): Unit
  private final class CapturedLogs extends LogSink {
    private val captured=new ConcurrentLinkedQueue[Log.Entry]
    val logger=new logstage.IzLogger(LogRouter(Log.Level.Trace,this,Map.empty,LogQueue.Immediate),Log.CustomContext.empty)
    def flush(entry: Log.Entry): Unit = { captured.add(entry); () }
    def entries: List[Log.Entry] = captured.iterator().asScala.toList
    def messages: List[String] = entries.map(entry => entry.message.template.s(entry.message.args.map(_.value)*))
    def rendered: String = {
      val renderer=new StringRenderingPolicy(RenderingOptions.colorless,None)
      entries.map(renderer.render).mkString("\n")
    }
  }
  private final class RecordingArchive(delegate: SessionArchive) extends SessionArchive {
    val completed=scala.collection.mutable.ListBuffer.empty[Int]
    val failures=scala.collection.mutable.ListBuffer.empty[String]
    val claimed=scala.collection.mutable.ListBuffer.empty[Claim]
    var claims=0; var publications=0
    def ingest(owner: String,r: IngestRequest): IngestReceipt = delegate.ingest(owner,r)
    def headSnapshot(reader: String,id: UUID): IngestRequest = delegate.headSnapshot(reader,id)
    def session(reader: String,id: UUID): SessionInfo = delegate.session(reader,id)
    def knownProfiles: Set[String] = delegate.knownProfiles
    def claim(profiles: Set[String],scope: ClaimScope,seconds: Int): Option[Claim] = { claims+=1; val result=delegate.claim(profiles,scope,seconds); claimed++=result; result }
    def renew(c: Claim,seconds: Int): Boolean = delegate.renew(c,seconds)
    def progress(c: Claim,count: Int,total: Int): Boolean = { completed += count; delegate.progress(c,count,total) }
    def publish(c: Claim,chunks: List[IndexedChunk]): Boolean = { publications+=1; delegate.publish(c,chunks) }
    def publishProblems(c: Claim,publication: ProblemsPublication): Boolean = { publications+=1; delegate.publishProblems(c,publication) }
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
    new OpenAIAnnotator(ModelFixtures.http(Client.fromHttpApp(app),config),config)
  }
  private final class RecordingEmbedder extends Embedder {
    val calls=scala.collection.mutable.ListBuffer.empty[String]
    def query(owner: String,text: String): IO[List[Double]] = IO.pure(List(1.0,0.0,0.0))
    def documents(owner: String,text: List[String]): IO[List[List[Double]]] = IO { calls ++= text; text.map(_ => List(1.0,0.0,0.0)) }
  }
  private def labels(calls: scala.collection.mutable.ListBuffer[Json]): List[Char] = calls.toList.map { payload =>
    val source=Wire.parse(payload.hcursor.downField("messages").downN(1).get[String]("content").toOption.get)
    source.hcursor.downField("fragments").downN(0).get[String]("text").toOption.get.head
  }
  test("BG/GoodCommunication: one truncation retries only the same window and preserves validated embedded prefix") { withArchive { (config,db,delegate) =>
    val archive=new RecordingArchive(delegate); val receipt=archive.ingest("a",source)
    val calls=scala.collection.mutable.ListBuffer.empty[Json]; val embedder=new RecordingEmbedder
    val model=annotator(config,calls,(fragments,attempt) => IO.pure(response(fragments,if(attempt==2) "length" else "stop")))
    val logs=new CapturedLogs
    assert(ModelFixtures.legacyWorker(archive,model,embedder,config,logs.logger).once.unsafeRunSync())
    assertEquals(logs.messages.size,1); assert(logs.messages.head.startsWith("annotation attempt failed "))
    assertEquals(labels(calls),List('a','b','b','c'))
    assertEquals(calls(1),calls(2))
    assertEquals(embedder.calls.toList.map(_.head),List('a','b','c'))
    assertEquals(archive.completed.toList,List(0,1,2,3)); assertEquals(archive.claims,1)
    assertEquals(archive.failures.toList,Nil); assertEquals(archive.publications,1)
    assertEquals(archive.session("a",receipt.sessionId).indexedRevision,Some(1))
  }}
  test("BG/GoodCommunication: five total truncations exhaust into existing job failure without publication") { withArchive { (config,db,delegate) =>
    val archive=new RecordingArchive(delegate); val receipt=archive.ingest("a",source)
    val calls=scala.collection.mutable.ListBuffer.empty[Json]; val embedder=new RecordingEmbedder
    val model=annotator(config,calls,(fragments,attempt) => IO.pure(response(fragments,if(attempt==1) "stop" else "length")))
    val logs=new CapturedLogs
    assert(ModelFixtures.legacyWorker(archive,model,embedder,config,logs.logger).once.unsafeRunSync())
    val retries=logs.messages.filter(_.startsWith("annotation attempt failed "))
    assertEquals(retries.size,5); assertEquals(retries.count(_.endsWith("outcome=retry")),4); assert(retries.last.endsWith("attempt=5 attemptLimit=5 code=model-output/truncated outcome=exhaust"))
    val terminal=logs.messages.filter(_.startsWith("window failed "))
    assertEquals(terminal.size,1); assert(terminal.head.contains("stage=annotation annotationAttempt=5 annotationAttemptLimit=5 code=model-output/truncated"))
    assertEquals(logs.messages.count(_.startsWith("job failed ")),1); assertEquals(logs.messages.size,7)
    assertEquals(labels(calls),List('a','b','b','b','b','b'))
    assert(calls.drop(1).forall(_==calls(1)))
    assertEquals(embedder.calls.toList.map(_.head),List('a'))
    assertEquals(archive.completed.toList,List(0,1)); assertEquals(archive.claims,1)
    assertEquals(archive.failures.toList,List("model-output/truncated")); assertEquals(archive.publications,0)
    assertEquals(archive.session("a",receipt.sessionId).indexedRevision,None)
    assert(archive.claim(Set(config.profile),ClaimScope.AllOwners,300).nonEmpty)
  }}
  List("model-output","model-http","model-timeout","stale-claim","worker-fault").foreach { code =>
    test(s"BG/GoodCommunication: annotation $code is not retried") { withArchive { (config,db,delegate) =>
      val archive=new RecordingArchive(delegate); archive.ingest("a",source)
      var calls=0; val embedder=new RecordingEmbedder
      val model=new Annotator {
        def annotate(owner: String,window: List[Chunk],messages: List[Message]): IO[List[Chunk]] = IO { calls+=1 }.flatMap { _ =>
          IO.raiseError(if(code=="worker-fault") new IllegalStateException("synthetic") else DomainError(code,"synthetic"))
        }
      }
      assert(ModelFixtures.legacyWorker(archive,model,embedder,config,logstage.IzLogger()).once.unsafeRunSync())
      assertEquals(calls,1); assertEquals(embedder.calls.toList,Nil)
      assertEquals(archive.failures.toList,List(code)); assertEquals(archive.publications,0)
    }}
  }
  test("BG/GoodCommunication: invalid structured output is not retried") { withArchive { (config,db,delegate) =>
    val archive=new RecordingArchive(delegate); archive.ingest("a",source)
    val calls=scala.collection.mutable.ListBuffer.empty[Json]; val embedder=new RecordingEmbedder
    val invalid=Json.obj("choices"->Json.arr(Json.obj("finish_reason"->Json.fromString("stop"),"message"->Json.obj("content"->Json.fromString("{}")))))
    val model=annotator(config,calls,(_,_) => IO.pure(invalid))
    assert(ModelFixtures.legacyWorker(archive,model,embedder,config,logstage.IzLogger()).once.unsafeRunSync())
    assertEquals(calls.size,1); assertEquals(embedder.calls.toList,Nil)
    assertEquals(archive.failures.toList,List("model-output")); assertEquals(archive.publications,0)
  }}
  test("BG/GoodCommunication: even a truncation code from embedding does not retry annotation or embedding") { withArchive { (config,db,delegate) =>
    val archive=new RecordingArchive(delegate); archive.ingest("a",source)
    val calls=scala.collection.mutable.ListBuffer.empty[Json]; var embeddings=0
    val model=annotator(config,calls,(fragments,_) => IO.pure(response(fragments,"stop")))
    val embedder=new Embedder {
      def query(owner: String,text: String): IO[List[Double]] = IO.pure(Nil)
      def documents(owner: String,text: List[String]): IO[List[List[Double]]] = IO { embeddings+=1 }.flatMap(_ => IO.raiseError(DomainError("model-output/truncated","synthetic")))
    }
    val logs=new CapturedLogs
    assert(ModelFixtures.legacyWorker(archive,model,embedder,config,logs.logger).once.unsafeRunSync())
    assertEquals(logs.messages.count(_.startsWith("annotation attempt failed ")),0)
    assertEquals(logs.messages.count(_.contains("stage=embedding annotationAttempt=1 annotationAttemptLimit=5 code=model-output/truncated")),1)
    assertEquals(logs.messages.size,2)
    assertEquals(calls.size,1); assertEquals(embeddings,1)
    assertEquals(archive.completed.toList,List(0)); assertEquals(archive.publications,0)
    assertEquals(archive.failures.toList,List("model-output/truncated"))
  }}
  List("annotation","embedding").foreach { stage => List(false,true).foreach { unexpected =>
    test(s"BG/GoodCommunication regression: terminal $stage ${if(unexpected) "worker fault" else "model output"} records private-free window context without extra attempts") { withArchive { (config,db,delegate) =>
      val archive=new RecordingArchive(delegate); val receipt=archive.ingest("a",source)
      val logs=new CapturedLogs
      val poison="PRIVATE_EXCEPTION_DETAIL_AUTHORIZATION_BEARER_SYNTHETIC_SECRET"
      var messageReads=0
      val error=if(unexpected) new IllegalStateException(poison) {
        override def getMessage(): String = { messageReads+=1; super.getMessage() }
      } else DomainError("model-output",poison)
      error.setStackTrace(Array(new StackTraceElement("chronicle.SyntheticModel","respond",poison,321)))
      var annotations=0; var embeddings=0
      val model=new Annotator {
        def annotate(owner: String,window: List[Chunk],messages: List[Message]): IO[List[Chunk]] = IO { annotations+=1 }.flatMap { _ =>
          if(annotations==2) IO.raiseError(DomainError("model-output/truncated",poison))
          else if(stage=="annotation" && annotations==3) IO.raiseError(error)
          else IO.pure(window.map(_.copy(summary=poison,tags=List(poison))))
        }
      }
      val embedder=new Embedder {
        def query(owner: String,text: String): IO[List[Double]] = IO.raiseError(new AssertionError("unexpected query"))
        def documents(owner: String,text: List[String]): IO[List[List[Double]]] = {
          embeddings+=1
          if(stage=="embedding" && embeddings==2) throw error
          IO.pure(text.map(_ => List(0.1234567898765432,0.5,1.0)))
        }
      }
      assert(ModelFixtures.legacyWorker(archive,model,embedder,config,logs.logger).once.unsafeRunSync())
      val claim=archive.claimed.head
      val code=if(unexpected) "worker-fault" else "model-output"
      assertEquals(annotations,3); assertEquals(embeddings,if(stage=="annotation") 1 else 2)
      assertEquals(archive.claims,1); assertEquals(archive.completed.toList,List(0,1))
      assertEquals(archive.failures.toList,List(code)); assertEquals(archive.publications,0)
      assertEquals(archive.session("a",receipt.sessionId).indexedRevision,None)
      val messages=logs.messages
      val terminal=messages.filter(_.startsWith("window failed "))
      assertEquals(terminal.size,1,"missing terminal stage/window diagnostic")
      assertEquals(terminal.head,s"window failed jobId=${claim.jobId} fence=${claim.fence} windowOrdinal=1 totalWindows=3 stage=$stage annotationAttempt=2 annotationAttemptLimit=5 code=$code exceptionClass=${error.getClass.getName} origin=chronicle.SyntheticModel.respond:321")
      assertEquals(messages.filter(_.startsWith("annotation attempt failed ")),List(s"annotation attempt failed jobId=${claim.jobId} fence=${claim.fence} windowOrdinal=1 totalWindows=3 attempt=1 attemptLimit=5 code=model-output/truncated outcome=retry"))
      assertEquals(messages.filter(_.startsWith("job failed ")),List(s"job failed jobId=${claim.jobId} code=$code exceptionClass=${error.getClass.getName} origin=chronicle.SyntheticModel.respond:321"))
      assertEquals(messages.size,3); assertEquals(messageReads,0)
      val recorded=logs.rendered+logs.entries.mkString
      List(poison,"a"*128,"b"*128,"0.1234567898765432").foreach(secret => assert(!recorded.contains(secret),"private content reached log entry"))
      assert(logs.entries.forall(_.firstThrowable.isEmpty))
      val next=archive.claim(Set(config.profile),ClaimScope.AllOwners,300).get
      assertEquals(next.fence,claim.fence+1)
    }}
  }}
  test("BG/GoodCommunication: cancellation during a retried annotation does not retry or fail the job") { withArchive { (config,db,delegate) =>
    val archive=new RecordingArchive(delegate); archive.ingest("a",source)
    val calls=scala.collection.mutable.ListBuffer.empty[Json]; val embedder=new RecordingEmbedder
    val logs=new CapturedLogs
    val program=for {
      started <- Deferred[IO,Unit]
      cancelled <- Deferred[IO,Unit]
      model=annotator(config,calls,(fragments,attempt) =>
        if(attempt==1) IO.pure(response(fragments,"length"))
        else started.complete(()).flatMap(_ => IO.never[Json]).onCancel(cancelled.complete(()).void))
      fiber <- ModelFixtures.legacyWorker(archive,model,embedder,config,logs.logger).once.start
      _ <- started.get
      _ <- fiber.cancel
      _ <- cancelled.get
      outcome <- fiber.join
    } yield outcome
    assert(program.unsafeRunSync().isCanceled)
    assertEquals(calls.size,2); assertEquals(calls(0),calls(1))
    assertEquals(embedder.calls.toList,Nil); assertEquals(archive.completed.toList,List(0))
    assertEquals(archive.failures.toList,Nil); assertEquals(archive.publications,0)
    assertEquals(logs.messages.size,1); assert(logs.messages.head.startsWith("annotation attempt failed "))
  }}
  test("BG/GoodCommunication: cancellation during embedding emits no terminal diagnostic or job failure") { withArchive { (config,db,delegate) =>
    val archive=new RecordingArchive(delegate); archive.ingest("a",source)
    val logs=new CapturedLogs
    var annotations=0; var embeddings=0
    val model=new Annotator {
      def annotate(owner: String,window: List[Chunk],messages: List[Message]): IO[List[Chunk]] = IO { annotations+=1 }.flatMap { _ =>
        if(annotations==1) IO.raiseError(DomainError("model-output/truncated","synthetic")) else IO.pure(window)
      }
    }
    val program=for {
      started <- Deferred[IO,Unit]
      cancelled <- Deferred[IO,Unit]
      embedder=new Embedder {
        def query(owner: String,text: String): IO[List[Double]] = IO.raiseError(new AssertionError("unexpected query"))
        def documents(owner: String,text: List[String]): IO[List[List[Double]]] = IO { embeddings+=1 } *> started.complete(()) *> IO.never[List[List[Double]]].onCancel(cancelled.complete(()).void)
      }
      fiber <- ModelFixtures.legacyWorker(archive,model,embedder,config,logs.logger).once.start
      _ <- started.get
      _ <- fiber.cancel
      _ <- cancelled.get
      outcome <- fiber.join
    } yield outcome
    assert(program.unsafeRunSync().isCanceled)
    assertEquals(annotations,2); assertEquals(embeddings,1)
    assertEquals(archive.completed.toList,List(0)); assertEquals(archive.failures.toList,Nil); assertEquals(archive.publications,0)
    assertEquals(logs.messages.size,1); assert(logs.messages.head.startsWith("annotation attempt failed "))
  }}
}
class DummyWorkerAnnotationRetryTest extends WorkerAnnotationRetryContract {
  def withArchive(f: (Config,Database,SessionArchive) => Unit): Unit = {
    val base=Fixtures.config(); val config=base.copy(annotation=base.annotation.copy(requestPolicy=AnnotationRequestPolicy.GlmMaxReasoning))
    f(config,new Database(config,IndexProfileCatalog.legacyOnly(config)),new DummyArchive(config,IndexProfileCatalog.legacyOnly(config)))
  }
}
class PostgresWorkerAnnotationRetryTest extends WorkerAnnotationRetryContract {
  def withArchive(f: (Config,Database,SessionArchive) => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh") }
    val base=Fixtures.config(); val config=base.copy(annotation=base.annotation.copy(requestPolicy=AnnotationRequestPolicy.GlmMaxReasoning))
    val db=new Database(config,IndexProfileCatalog.legacyOnly(config)); db.initialize()
    db.transaction(c => { Sql.exec(c,"TRUNCATE ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks CASCADE"); Sql.exec(c,"UPDATE ch_profile SET active=?,target=?,maintenance=false",config.profile,config.profile); Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=0",config.profile) })
    f(config,db,new PostgresArchive(db,config))
  }
}
